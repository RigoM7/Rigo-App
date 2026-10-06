import { Hono } from 'hono';
import { z } from 'zod';
import type { Db, Q } from '../db/index.js';
import { getDb } from '../db/index.js';
import { type AppEnv, type CompanyCtx, need, can, audit } from '../http/context.js';
import { body } from '../lib/util.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { occurrences, billingPeriods, localDate, addDays, zonedToUtc, type VisitRule } from '../../shared/schedule.js';
import { missingForOpen } from '../../shared/jobs.js';
import { emit } from '../automation/engine.js';
import { notifyPermission } from './inbox.js';

// Recurring service and rentals: visit schedules are separate from billing schedules.
// Generation is idempotent (one occurrence row per plan/date) and runs while the server is up;
// after a restart it catches up from where it left off.

export const recurringRoutes = new Hono<AppEnv>();
const HORIZON_DAYS = 14;

const visitRule = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly']), interval: z.number().int().min(1).max(12).default(1),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]), dayOfMonth: z.number().int().min(1).max(31).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Use a time like 08:30').default('08:00'), durationMinutes: z.number().int().min(15).max(720).default(60),
});
const billingRule = z.object({ frequency: z.enum(['none', 'per_visit', 'weekly', 'monthly']), rateMinor: z.number().int().min(0).nullable().default(null), description: z.string().max(120).default('Rental') });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date');

const planInput = z.object({
  name: z.string().trim().min(1, 'Name the plan').max(80), kind: z.enum(['service', 'rental']), customerId: z.string().uuid(), locationId: z.string().uuid().nullable(),
  serviceId: z.string().uuid(), visitRule, billingRule, units: z.number().int().min(1).max(500).default(1), startsOn: date, endsOn: date.nullable().default(null),
  details: z.record(z.string(), z.unknown()).default({}),
});

recurringRoutes.get('/recurring', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.view_all');
  const today = localDate(new Date(), cc.company.timezone);
  const { rows } = await cc.db.query<any>(
    `select p.*, c.name as customer_name, s.name as service_name, l.address,
        (select count(*)::int from rigo.plan_occurrences o join rigo.jobs j on j.id = o.job_id where o.plan_id = p.id and o.occurrence_date < $2 and j.status in ('draft','open','in_progress')) as missed,
        (select min(o.occurrence_date) from rigo.plan_occurrences o where o.plan_id = p.id and o.occurrence_date >= $2 and o.state = 'scheduled') as next_visit
       from rigo.recurring_plans p join rigo.customers c on c.id = p.customer_id join rigo.services s on s.id = p.service_id left join rigo.locations l on l.id = p.location_id
      where p.company_id = $1 order by p.status, p.name`, [cc.company.id, today]);
  return c.json({ plans: rows.map((p) => ({ ...p, billing_rule: can(cc, 'finance.view') ? p.billing_rule : { ...p.billing_rule, rateMinor: undefined } })), today, timezone: cc.company.timezone });
});

recurringRoutes.get('/recurring/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.view_all');
  const { rows } = await cc.db.query<any>(`select * from rigo.recurring_plans where id = $1 and company_id = $2`, [c.req.param('id'), cc.company.id]);
  if (!rows[0]) throw notFound('Plan');
  const occ = await cc.db.query(`select o.occurrence_date, o.state, j.id as job_id, j.number, j.status from rigo.plan_occurrences o left join rigo.jobs j on j.id = o.job_id where o.plan_id = $1 order by o.occurrence_date desc limit 60`, [rows[0].id]);
  const invoices = can(cc, 'invoices.view') ? (await cc.db.query(`select id, number, status, ${can(cc, 'finance.view') ? 'total_minor' : 'null as total_minor'}, billable_key, created_at from rigo.invoices where recurring_plan_id = $1 order by created_at desc`, [rows[0].id])).rows : [];
  const today = localDate(new Date(), cc.company.timezone);
  const preview = occurrences(rows[0].visit_rule, rows[0].starts_on, rows[0].ends_on, today, addDays(today, 30));
  return c.json({ plan: rows[0], occurrences: occ.rows, invoices, preview, today });
});

recurringRoutes.post('/recurring', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.create');
  const input = await body(c, planInput);
  if (input.billingRule.rateMinor !== null) need(cc, 'finance.view');
  if (input.endsOn && input.endsOn < input.startsOn) throw badRequest('The end date must be after the start date.', { fields: { endsOn: 'Must be after the start date' } });
  if (input.visitRule.frequency === 'weekly' && input.visitRule.weekdays.length === 0) throw badRequest('Choose at least one day of the week.', { fields: { 'visitRule.weekdays': 'Choose a day' } });
  const id = await cc.db.tx(async (q) => {
    const ok = await q.query(`select 1 from rigo.customers c join rigo.services s on s.company_id = c.company_id where c.id = $1 and s.id = $2 and c.company_id = $3`, [input.customerId, input.serviceId, cc.company.id]);
    if (!ok.rows.length) throw badRequest('Choose a customer and service from this company.');
    if (input.locationId) { const l = await q.query(`select 1 from rigo.locations where id = $1 and customer_id = $2`, [input.locationId, input.customerId]); if (!l.rows.length) throw badRequest('That location belongs to another customer.'); }
    const { rows } = await q.query<{ id: string }>(
      `insert into rigo.recurring_plans (company_id, name, kind, customer_id, location_id, service_id, visit_rule, billing_rule, units, starts_on, ends_on, details) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [cc.company.id, input.name, input.kind, input.customerId, input.locationId, input.serviceId, JSON.stringify(input.visitRule), JSON.stringify(input.billingRule), input.units, input.startsOn, input.endsOn, JSON.stringify(input.details)]);
    await audit(q, cc, 'plan.created', { id: rows[0].id });
    return rows[0].id;
  });
  await generateForCompany(cc.db, cc.company.id);
  return c.json({ id });
});

recurringRoutes.post('/recurring/:id/pause', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.edit');
  const input = await body(c, z.object({ from: date, until: date.nullable() }));
  if (input.until && input.until < input.from) throw badRequest('"Until" must be after "from".');
  const out = await cc.db.tx(async (q) => {
    const plan = (await q.query<any>(`select * from rigo.recurring_plans where id = $1 and company_id = $2 for update`, [c.req.param('id'), cc.company.id])).rows[0];
    if (!plan) throw notFound('Plan');
    await q.query(`update rigo.recurring_plans set paused_from = $2, paused_until = $3, status = 'paused', version = version + 1 where id = $1`, [plan.id, input.from, input.until]);
    // Already-generated visits inside the pause that have not started are cancelled with a reason; started work is untouched.
    const cancelled = await q.query<{ id: string }>(
      `update rigo.jobs j set status = 'cancelled', billing_status = 'not_billable', version = version + 1, updated_at = now()
         from rigo.plan_occurrences o where o.job_id = j.id and o.plan_id = $1 and o.occurrence_date >= $2 and ($3::date is null or o.occurrence_date <= $3) and j.status in ('draft','open') returning j.id`,
      [plan.id, input.from, input.until]);
    for (const j of cancelled.rows) await q.query(`insert into rigo.job_events (company_id, job_id, type, actor_user_id, data) values ($1,$2,'status',$3,$4)`, [cc.company.id, j.id, cc.user.id, JSON.stringify({ to: 'cancelled', reason: 'Recurring plan paused' })]);
    await q.query(`update rigo.plan_occurrences set state = 'skipped_paused' where plan_id = $1 and occurrence_date >= $2 and ($3::date is null or occurrence_date <= $3) and job_id = any($4)`, [plan.id, input.from, input.until, cancelled.rows.map((r) => r.id)]);
    return { cancelledVisits: cancelled.rows.length };
  });
  return c.json(out);
});

recurringRoutes.post('/recurring/:id/resume', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.edit');
  const { rows } = await cc.db.query(`update rigo.recurring_plans set status = 'active', paused_from = null, paused_until = null, version = version + 1 where id = $1 and company_id = $2 and status = 'paused' returning id`, [c.req.param('id'), cc.company.id]);
  if (!rows.length) throw conflict('Only paused plans can be resumed.');
  await generateForCompany(cc.db, cc.company.id);
  return c.json({ ok: true });
});

recurringRoutes.post('/recurring/:id/end', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.edit');
  const input = await body(c, z.object({ endsOn: date }));
  const out = await cc.db.tx(async (q) => {
    const { rows } = await q.query<any>(`update rigo.recurring_plans set ends_on = $3, status = case when $3 <= current_date then 'ended' else status end, version = version + 1 where id = $1 and company_id = $2 returning id`, [c.req.param('id'), cc.company.id, input.endsOn]);
    if (!rows.length) throw notFound('Plan');
    const cancelled = await q.query(`update rigo.jobs j set status = 'cancelled', billing_status = 'not_billable', version = version + 1 from rigo.plan_occurrences o where o.job_id = j.id and o.plan_id = $1 and o.occurrence_date > $2 and j.status in ('draft','open') returning j.id`, [rows[0].id, input.endsOn]);
    return { cancelledVisits: cancelled.rows.length };
  });
  return c.json(out);
});

/** Change future visits from a date. Already-generated, unstarted visits from that date are replaced. */
recurringRoutes.post('/recurring/:id/change', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.edit');
  const input = await body(c, z.object({ effectiveFrom: date, visitRule, units: z.number().int().min(1).max(500).optional(), billingRule: billingRule.optional() }));
  if (input.billingRule?.rateMinor !== undefined && input.billingRule.rateMinor !== null) need(cc, 'finance.view');
  const out = await cc.db.tx(async (q) => {
    const plan = (await q.query<any>(`select * from rigo.recurring_plans where id = $1 and company_id = $2 for update`, [c.req.param('id'), cc.company.id])).rows[0];
    if (!plan) throw notFound('Plan');
    const cancelled = await q.query<{ id: string }>(`update rigo.jobs j set status = 'cancelled', billing_status = 'not_billable', version = version + 1 from rigo.plan_occurrences o where o.job_id = j.id and o.plan_id = $1 and o.occurrence_date >= $2 and j.status in ('draft','open') and j.assigned_user_id is null returning j.id`, [plan.id, input.effectiveFrom]);
    await q.query(`delete from rigo.plan_occurrences where plan_id = $1 and occurrence_date >= $2 and (job_id is null or job_id = any($3))`, [plan.id, input.effectiveFrom, cancelled.rows.map((r) => r.id)]);
    const keepBilling = can(cc, 'finance.view') ? (input.billingRule ?? plan.billing_rule) : { ...(input.billingRule ?? plan.billing_rule), rateMinor: plan.billing_rule.rateMinor };
    await q.query(`update rigo.recurring_plans set visit_rule = $2, units = coalesce($3, units), billing_rule = $4, generated_through = least(generated_through, ($5::date - 1)), version = version + 1 where id = $1`,
      [plan.id, JSON.stringify(input.visitRule), input.units ?? null, JSON.stringify(keepBilling), input.effectiveFrom]);
    return { replacedVisits: cancelled.rows.length, note: 'Assigned or started visits were kept unchanged.' };
  });
  await generateForCompany(cc.db, cc.company.id);
  return c.json(out);
});

// ---------------------------------------------------------------- generation
export async function generateForCompany(db: Db, companyId: string) {
  const co = (await db.query<any>(`select timezone, kind from rigo.companies where id = $1`, [companyId])).rows[0];
  if (!co) return { visits: 0, invoices: 0 };
  const today = localDate(new Date(), co.timezone);
  const horizon = addDays(today, HORIZON_DAYS);
  const plans = (await db.query<any>(`select p.*, s.fields from rigo.recurring_plans p join rigo.services s on s.id = p.service_id where p.company_id = $1 and p.status in ('active','paused')`, [companyId])).rows;
  let visits = 0, invoices = 0;
  for (const plan of plans) {
    await db.tx(async (q) => {
      const locked = (await q.query<any>(`select * from rigo.recurring_plans where id = $1 for update`, [plan.id])).rows[0];
      if (!locked || locked.status === 'ended') return;
      const from = locked.generated_through ? addDays(locked.generated_through, 1) : (locked.starts_on > today ? locked.starts_on : today);
      for (const d of occurrences(locked.visit_rule as VisitRule, locked.starts_on, locked.ends_on, from, horizon)) {
        const paused = locked.paused_from && d >= locked.paused_from && (!locked.paused_until || d <= locked.paused_until);
        const exists = await q.query(`select 1 from rigo.plan_occurrences where plan_id = $1 and occurrence_date = $2`, [locked.id, d]);
        if (exists.rows.length) continue;
        if (paused) { await q.query(`insert into rigo.plan_occurrences (plan_id, occurrence_date, company_id, state) values ($1,$2,$3,'skipped_paused')`, [locked.id, d, companyId]); continue; }
        const start = zonedToUtc(d, locked.visit_rule.time, co.timezone);
        const end = new Date(start.getTime() + (locked.visit_rule.durationMinutes ?? 60) * 60000);
        const details: Record<string, unknown> = { ...(locked.details ?? {}), _plan: locked.id, _occurrence: d };
        if (plan.fields?.some((f: any) => f.key === 'units')) details.units = String(locked.units);
        const status = missingForOpen({ customer_id: locked.customer_id, location_id: locked.location_id, service_id: locked.service_id, details }, plan.fields).length ? 'draft' : 'open';
        const seq = await q.query<{ job_seq: number }>(`update rigo.companies set job_seq = job_seq + 1 where id = $1 returning job_seq`, [companyId]);
        const job = await q.query<{ id: string }>(
          `insert into rigo.jobs (company_id, number, customer_id, location_id, service_id, status, scheduled_start, scheduled_end, notes, details, recurring_plan_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
          [companyId, seq.rows[0].job_seq, locked.customer_id, locked.location_id, locked.service_id, status, start.toISOString(), end.toISOString(), `Scheduled from plan "${locked.name}".`, JSON.stringify(details), locked.id]);
        await q.query(`insert into rigo.plan_occurrences (plan_id, occurrence_date, company_id, job_id) values ($1,$2,$3,$4)`, [locked.id, d, companyId, job.rows[0].id]);
        await q.query(`insert into rigo.job_events (company_id, job_id, type, actor_label, data) values ($1,$2,'created','Recurring plan',$3)`, [companyId, job.rows[0].id, JSON.stringify({ plan: locked.name, date: d })]);
        await emit(q, companyId, 'job.created', { type: 'job', id: job.rows[0].id }, { recurring: true });
        visits++;
      }
      if (horizon > (locked.generated_through ?? '')) await q.query(`update rigo.recurring_plans set generated_through = $2 where id = $1`, [locked.id, horizon]);
      // Billing schedule (rentals): one invoice per period, independent of visit frequency.
      const br = locked.billing_rule;
      for (const p of billingPeriods(br.frequency, locked.starts_on, locked.ends_on, locked.billed_through, today)) {
        const key = `plan:${locked.id}:${p.start}`;
        const held = br.rateMinor === null;
        const pausedWhole = locked.paused_from && p.start >= locked.paused_from && (!locked.paused_until || p.end <= locked.paused_until);
        if (pausedWhole) { await q.query(`update rigo.recurring_plans set billed_through = $2 where id = $1`, [locked.id, p.start]); continue; }
        const amount = held ? null : br.rateMinor * locked.units;
        const ins = await q.query<{ id: string }>(
          `insert into rigo.invoices (company_id, billable_key, customer_id, recurring_plan_id, status, currency, subtotal_minor, discount_minor, tax_minor, total_minor, hold_reasons)
           values ($1,$2,$3,$4,$5,(select currency from rigo.companies where id = $1),$6,0,0,$6,$7) on conflict (company_id, billable_key) do nothing returning id`,
          [companyId, key, locked.customer_id, locked.id, held ? 'held' : 'draft', amount, JSON.stringify(held ? ['No rental rate is set on this plan.'] : [])]);
        if (ins.rows[0]) {
          await q.query(`insert into rigo.invoice_lines (invoice_id, company_id, position, description, quantity, unit, rate_minor, amount_minor) values ($1,$2,0,$3,$4,'units',$5,$6)`,
            [ins.rows[0].id, companyId, `${br.description} ${p.start} to ${p.end}`, locked.units, br.rateMinor, amount]);
          await emit(q, companyId, 'invoice.prepared', { type: 'invoice', id: ins.rows[0].id }, { recurring: true });
          invoices++;
        }
        await q.query(`update rigo.recurring_plans set billed_through = $2 where id = $1`, [locked.id, p.start]);
      }
    });
  }
  if (invoices) await notifyPermission(db, companyId, 'invoices.edit', { category: 'update', title: `${invoices} rental invoice draft(s) prepared`, link: 'invoices?status=attention' });
  return { visits, invoices };
}

export async function generateAll() {
  const db = await getDb();
  const { rows } = await db.query<{ company_id: string }>(`select distinct company_id from rigo.recurring_plans where status in ('active','paused')`);
  let total = 0;
  for (const r of rows) total += (await generateForCompany(db, r.company_id)).visits;
  await db.query(`insert into rigo.system_state (key, value) values ('recurring_last_run', $1) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify({ at: new Date().toISOString(), visits: total })]);
  return total;
}

export type { Q };
