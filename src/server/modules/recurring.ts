import { Hono } from 'hono';
import { z } from 'zod';
import type { Db, Q } from '../db/index.js';
import { getDb } from '../db/index.js';
import { type AppEnv, type CompanyCtx, need, can, audit } from '../http/context.js';
import { body } from '../lib/util.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { occurrences, billingPeriods, localDate, addDays, zonedToUtc, type VisitRule } from '../../shared/schedule.js';
import { missingForOpen } from '../../shared/jobs.js';
import { computeTotals, type DraftLine } from '../../shared/billing.js';
import { billingRuleSchema, readBillingRule, isPeriodic, rentalLines, totalUnits, periodCharges, depositDue, creditForDays, newDaysCredit, applyCredits, periodLabel, PLAN_VISIT_LABEL, type BillingRule, type Excluded, type PlanVisit, type PendingCredit } from '../../shared/rentals.js';
import { emit } from '../automation/engine.js';
import { notifyPermission, resolveNotices } from './inbox.js';
import { persistLines, lineFromRow } from './invoicing.js';

// Recurring service and rentals: visit schedules are separate from billing schedules.
// Generation is idempotent (one occurrence row per plan/date) and runs while the server is up;
// after a restart it catches up from where it left off. Rental visits are covered by the rent;
// rent is billed per unit line, and pauses and early ends are prorated by the day (D5).

export const recurringRoutes = new Hono<AppEnv>();
const HORIZON_DAYS = 14;

const visitRule = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly']), interval: z.number().int().min(1).max(12).default(1),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]), dayOfMonth: z.number().int().min(1).max(31).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Use a time like 08:30').default('08:00'), durationMinutes: z.number().int().min(15).max(720).default(60),
});
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date');

const planInput = z.object({
  name: z.string().trim().min(1, 'Name the plan').max(80), kind: z.enum(['service', 'rental']), customerId: z.string().uuid(), locationId: z.string().uuid().nullable(),
  serviceId: z.string().uuid(), visitRule, billingRule: billingRuleSchema, units: z.number().int().min(0).max(500).default(1), startsOn: date, endsOn: date.nullable().default(null),
  details: z.record(z.string(), z.unknown()).default({}),
  /** Visits arrive assigned to this driver and truck (R8-m5). */
  defaultUserId: z.string().uuid().nullable().default(null), defaultResourceIds: z.array(z.string().uuid()).max(10).default([]),
  /** Rentals: create the delivery job on the start date. */
  createDelivery: z.boolean().default(true),
});

const RATED_FIELDS = (r: BillingRule) => r.lines.some((l) => l.rateE4 !== null) || r.rateMinor !== null || Object.values(r.visitPrices).some((v) => v !== null && v !== undefined) || !!r.deposit;

/** Rates are financial: without finance access the plan comes back without them (removed here, not in the UI). */
function serializePlan(cc: CompanyCtx, p: any) {
  const rule = readBillingRule(p.billing_rule);
  const fin = can(cc, 'finance.view');
  const units = totalUnits(rule, p.units);
  return {
    ...p, units,
    billing_rule: fin ? rule : { ...rule, rateMinor: undefined, lines: rentalLines(rule, p.units).map((l) => ({ ...l, rateE4: undefined, rateSet: l.rateE4 !== null })), visitPrices: {}, deposit: rule.deposit ? { type: rule.deposit.type } : null },
    ratesSet: rentalLines(rule, p.units).every((l) => l.rateE4 !== null),
    depositDueMinor: fin ? depositDue(rule, p.units) : undefined, deposit_received_minor: fin ? Number(p.deposit_received_minor ?? 0) : undefined,
    pending_credits: fin ? p.pending_credits : undefined, tax_rate_bp: fin ? p.tax_rate_bp : undefined,
  };
}

recurringRoutes.get('/recurring', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.view_all');
  const today = localDate(new Date(), cc.company.timezone);
  const { rows } = await cc.db.query<any>(
    `select p.*, c.name as customer_name, s.name as service_name, s.category, l.address,
        (select count(*)::int from rigo.plan_occurrences o join rigo.jobs j on j.id = o.job_id where o.plan_id = p.id and o.occurrence_date < $2 and j.status in ('draft','open','in_progress')) as missed,
        (select min(o.occurrence_date) from rigo.plan_occurrences o where o.plan_id = p.id and o.occurrence_date >= $2 and o.state = 'scheduled') as next_visit
       from rigo.recurring_plans p join rigo.customers c on c.id = p.customer_id join rigo.services s on s.id = p.service_id left join rigo.locations l on l.id = p.location_id
      where p.company_id = $1 order by p.status, p.name`, [cc.company.id, today]);
  return c.json({ plans: rows.map((p) => serializePlan(cc, p)), today, timezone: cc.company.timezone });
});

recurringRoutes.get('/recurring/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.view_all');
  const plan = await loadPlan(cc, cc.db, c.req.param('id'));
  const occ = await cc.db.query(`select o.occurrence_date, o.state, j.id as job_id, j.number, j.status, j.details->>'_visit' as visit from rigo.plan_occurrences o left join rigo.jobs j on j.id = o.job_id where o.plan_id = $1 order by o.occurrence_date desc limit 60`, [plan.id]);
  // Delivery, pickup and extra visits made for the plan (not from the visit schedule).
  const otherJobs = (await cc.db.query(`select id, number, status, scheduled_start, details->>'_visit' as visit from rigo.jobs where company_id = $1 and recurring_plan_id = $2 and details->>'_visit' in ('delivery','pickup','extra') order by scheduled_start`, [cc.company.id, plan.id])).rows;
  const invoices = can(cc, 'invoices.view') ? (await cc.db.query(`select id, number, status, payment_status, ${can(cc, 'finance.view') ? 'total_minor' : 'null as total_minor'}, period_start, period_end, created_at from rigo.invoices where recurring_plan_id = $1 and company_id = $2 order by period_start desc nulls last, created_at desc`, [plan.id, cc.company.id])).rows : [];
  const units = (await cc.db.query(`select id, name, identifier, placement, placed_at from rigo.resources where company_id = $1 and plan_id = $2 order by name`, [cc.company.id, plan.id])).rows;
  const yard = (await cc.db.query(`select id, name from rigo.resources where company_id = $1 and kind = 'unit' and plan_id is null and placement = 'yard' and status <> 'retired' order by name`, [cc.company.id])).rows;
  const today = localDate(new Date(), cc.company.timezone);
  // "Next 30 days" lists only the dates a visit will really happen: paused dates are left out (R8-m3).
  const paused = (d: string) => plan.paused_from && d >= plan.paused_from && (!plan.paused_until || d <= plan.paused_until);
  const preview = plan.status === 'ended' ? [] : occurrences(plan.visit_rule, plan.starts_on, plan.ends_on, today, addDays(today, 30)).filter((d) => !paused(d));
  const defaults = plan.default_user_id ? (await cc.db.query<any>(`select coalesce(m.display_name, u.name) as name from rigo.users u left join rigo.memberships m on m.user_id = u.id and m.company_id = $2 where u.id = $1`, [plan.default_user_id, cc.company.id])).rows[0]?.name : null;
  return c.json({ plan: { ...serializePlan(cc, plan), default_user_name: defaults }, occurrences: occ.rows, otherJobs, invoices, preview, today, units, yard });
});

async function loadPlan(cc: CompanyCtx, q: Q, id: string, lock = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Plan');
  const p = (await q.query<any>(`select p.*, s.fields, s.category, s.tax_rate_bp from rigo.recurring_plans p join rigo.services s on s.id = p.service_id where p.id = $1 and p.company_id = $2${lock ? ' for update of p' : ''}`, [id, cc.company.id])).rows[0];
  if (!p) throw notFound('Plan');
  return p;
}

/** The driver must be able to work jobs, the trucks must be this company's (same checks as assigning a job). */
async function checkDefaults(q: Q, cc: CompanyCtx, userId: string | null, resourceIds: string[]) {
  if (userId) {
    const m = await q.query(`select 1 from rigo.memberships m join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key where m.company_id = $1 and m.user_id = $2 and m.status = 'active' and (r.is_owner or 'jobs.work' = any(r.permissions))`, [cc.company.id, userId]);
    if (!m.rows.length) throw badRequest('Choose a driver from this company.', { fields: { defaultUserId: 'Not an eligible driver' } });
  }
  if (resourceIds.length) {
    const r = await q.query(`select 1 from rigo.resources where company_id = $1 and id = any($2)`, [cc.company.id, resourceIds]);
    if (r.rows.length !== resourceIds.length) throw badRequest('Choose trucks from this company.', { fields: { defaultResourceIds: 'Unknown truck' } });
  }
}

/** A delivery, pickup or extra visit for a plan: a normal job, assigned to the plan's driver, at the visit time. */
async function planJob(q: Q, companyId: string, plan: any, day: string, visit: PlanVisit, userId: string | null, timezone: string) {
  const start = zonedToUtc(day, plan.visit_rule.time ?? '08:00', timezone);
  const end = new Date(start.getTime() + (plan.visit_rule.durationMinutes ?? 60) * 60000);
  const fields = (plan.fields ?? []) as any[];
  const details: Record<string, unknown> = { ...(plan.details ?? {}), _plan: plan.id, _visit: visit };
  const units = totalUnits(readBillingRule(plan.billing_rule), plan.units);
  if (fields.some((f) => f.key === 'units')) details.units = String(units);
  const vt = fields.find((f) => f.key === 'visit_type' && f.type === 'select');
  const want = visit === 'extra' ? 'Service' : PLAN_VISIT_LABEL[visit];
  if (vt?.options?.includes(want)) details.visit_type = want;
  const status = missingForOpen({ customer_id: plan.customer_id, location_id: plan.location_id, service_id: plan.service_id, details }, fields).length ? 'draft' : 'open';
  const seq = await q.query<{ job_seq: number }>(`update rigo.companies set job_seq = job_seq + 1 where id = $1 returning job_seq`, [companyId]);
  const job = await q.query<{ id: string }>(
    `insert into rigo.jobs (company_id, number, customer_id, location_id, service_id, status, scheduled_start, scheduled_end, notes, details, recurring_plan_id, assigned_user_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
    [companyId, seq.rows[0].job_seq, plan.customer_id, plan.location_id, plan.service_id, status, start.toISOString(), end.toISOString(),
      `${PLAN_VISIT_LABEL[visit]} for plan "${plan.name}".`, JSON.stringify(details), plan.id, status === 'open' ? plan.default_user_id : null, userId]);
  for (const rid of plan.default_resource_ids ?? []) await q.query(`insert into rigo.job_resources (job_id, resource_id, company_id) values ($1,$2,$3) on conflict do nothing`, [job.rows[0].id, rid, companyId]);
  await q.query(`insert into rigo.job_events (company_id, job_id, type, actor_label, data) values ($1,$2,'created','Recurring plan',$3)`, [companyId, job.rows[0].id, JSON.stringify({ plan: plan.name, visit })]);
  await emit(q, companyId, 'job.created', { type: 'job', id: job.rows[0].id }, { recurring: true });
  if (status === 'open' && plan.default_user_id) await emit(q, companyId, 'job.assigned', { type: 'job', id: job.rows[0].id }, { recurring: true });
  return { id: job.rows[0].id, number: seq.rows[0].job_seq };
}

recurringRoutes.post('/recurring', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.create');
  const input = await body(c, planInput);
  if (RATED_FIELDS(input.billingRule)) need(cc, 'finance.view');
  if (input.endsOn && input.endsOn < input.startsOn) throw badRequest('The end date must be after the start date.', { fields: { endsOn: 'Must be after the start date' } });
  if (input.billingRule.frequency === 'event' && !input.endsOn) throw badRequest('An event rental needs its last day (the pickup).', { fields: { endsOn: 'Choose the last day' } });
  if (input.visitRule.frequency === 'weekly' && input.visitRule.weekdays.length === 0) throw badRequest('Choose at least one day of the week.', { fields: { 'visitRule.weekdays': 'Choose a day' } });
  const out = await cc.db.tx(async (q) => {
    const ok = await q.query(`select 1 from rigo.customers c join rigo.services s on s.company_id = c.company_id where c.id = $1 and s.id = $2 and c.company_id = $3`, [input.customerId, input.serviceId, cc.company.id]);
    if (!ok.rows.length) throw badRequest('Choose a customer and service from this company.');
    if (input.locationId) { const l = await q.query(`select 1 from rigo.locations where id = $1 and customer_id = $2`, [input.locationId, input.customerId]); if (!l.rows.length) throw badRequest('That location belongs to another customer.'); }
    await checkDefaults(q, cc, input.defaultUserId, input.defaultResourceIds);
    const units = input.billingRule.lines.length ? totalUnits(input.billingRule, input.units) : input.units;
    const { rows } = await q.query<{ id: string }>(
      `insert into rigo.recurring_plans (company_id, name, kind, customer_id, location_id, service_id, visit_rule, billing_rule, units, starts_on, ends_on, details, default_user_id, default_resource_ids)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
      [cc.company.id, input.name, input.kind, input.customerId, input.locationId, input.serviceId, JSON.stringify(input.visitRule), JSON.stringify(input.billingRule), units, input.startsOn, input.endsOn, JSON.stringify(input.details), input.defaultUserId, input.defaultResourceIds]);
    const plan = await loadPlan(cc, q, rows[0].id);
    let delivery = null;
    if (input.kind === 'rental' && input.createDelivery) delivery = await planJob(q, cc.company.id, plan, input.startsOn, 'delivery', cc.user.id, cc.company.timezone);
    // Someone who can't see prices made a rental: billing is asked to set the rates (R8-m1).
    const ratesMissing = isPeriodic(input.billingRule.frequency) && rentalLines(input.billingRule, units).some((l) => l.rateE4 === null);
    if (ratesMissing) {
      await notifyPermission(q, cc.company.id, 'invoices.edit', { category: 'needs_action', title: `Set the rental rates for "${input.name}"`, body: `${cc.user.name} created the plan. Its rent invoices are held until the rates are set.`, link: `recurring/${rows[0].id}`, refType: 'plan_rates', refId: rows[0].id, dedupeKey: `plan-rates:${rows[0].id}` });
      await q.query(`update rigo.recurring_plans set rates_requested_at = now() where id = $1`, [rows[0].id]);
    }
    await audit(q, cc, 'plan.created', { id: rows[0].id });
    return { id: rows[0].id, deliveryJob: delivery, ratesRequested: ratesMissing };
  });
  await generateForCompany(cc.db, cc.company.id);
  return c.json(out);
});

/** Billing sets or changes the plan's prices: unit lines, visit prices, deposit. Draft and held rent invoices are rebuilt. */
recurringRoutes.put('/recurring/:id/billing', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.edit', 'finance.view');
  const input = await body(c, z.object({ billingRule: billingRuleSchema, version: z.number().int() }));
  const out = await cc.db.tx(async (q) => {
    const plan = await loadPlan(cc, q, c.req.param('id'), true);
    if (plan.version !== input.version) throw conflict('This plan changed since you opened it. Reload and try again.');
    const units = input.billingRule.lines.length ? totalUnits(input.billingRule, plan.units) : plan.units;
    await q.query(`update rigo.recurring_plans set billing_rule = $2, units = $3, version = version + 1 where id = $1`, [plan.id, JSON.stringify(input.billingRule), units]);
    const rebuilt = await rebuildOpenRentInvoices(q, { ...plan, billing_rule: input.billingRule, units });
    if (rentalLines(input.billingRule, units).every((l) => l.rateE4 !== null)) await resolveNotices(q, cc.company.id, 'plan_rates', plan.id);
    await audit(q, cc, 'plan.billing_changed', { id: plan.id, rebuilt });
    return { rebuiltInvoices: rebuilt };
  });
  return c.json(out);
});

/** What a plan's rent periods must leave out: the current pause, and days after an early end. */
function exclusions(plan: any): Excluded[] {
  const out: Excluded[] = [...((plan.pause_history ?? []) as Excluded[])];
  if (plan.paused_from) out.push({ from: plan.paused_from, to: plan.paused_until ?? null, reason: `paused ${plan.paused_until ? periodLabel(plan.paused_from, plan.paused_until) : `from ${periodLabel(plan.paused_from, plan.paused_from)}`}` });
  return out;
}

/** Rebuild rent invoices that aren't issued yet, so they match the plan's prices, pause and end (an adjusted draft). */
async function rebuildOpenRentInvoices(q: Q, plan: any) {
  const rule = readBillingRule(plan.billing_rule);
  const invs = (await q.query<any>(`select * from rigo.invoices where recurring_plan_id = $1 and status in ('held','draft','pending_approval','approved') and period_start is not null for update`, [plan.id])).rows;
  let carried: PendingCredit[] = [];
  for (const inv of invs) {
    const end = plan.ends_on && plan.ends_on < inv.period_end ? plan.ends_on : inv.period_end;
    const lines = periodCharges(rule, plan.units, { start: inv.period_start, end }, exclusions(plan));
    // Credits already on the draft stay on it, up to its new charges; the rest waits for the next rent.
    const had = (await q.query<any>(`select * from rigo.invoice_lines where invoice_id = $1 and kind = 'discount' order by position`, [inv.id])).rows.map(lineFromRow)
      .map((l) => ({ description: l.description.replace(/ \(rest\)$/, ''), amountMinor: -(l.amountMinor ?? 0) }));
    const charges = lines.every((l) => l.amountMinor !== null) ? lines.reduce((t, l) => t + (l.amountMinor ?? 0), 0) : null;
    const { lines: creditLines, left } = charges === null ? { lines: [], left: had } : applyCredits(charges, had);
    carried = [...carried, ...left];
    await writeRentInvoice(q, inv.id, plan, [...lines, ...creditLines], rule);
  }
  if (carried.length) await q.query(`update rigo.recurring_plans set pending_credits = pending_credits || $2::jsonb where id = $1`, [plan.id, JSON.stringify(carried)]);
  return invs.length;
}

async function writeRentInvoice(q: Q, invoiceId: string, plan: any, lines: DraftLine[], rule: BillingRule) {
  const taxExempt = !!(await q.query<any>(`select tax_exempt from rigo.customers where id = $1`, [plan.customer_id])).rows[0]?.tax_exempt;
  const totals = computeTotals(lines, plan.tax_rate_bp ?? null, [], { taxExempt });
  const reasons = totals.holdReasons.length ? [rentalLines(rule, plan.units).some((l) => l.rateE4 === null) ? 'No rental rate is set on this plan. Billing sets it on the plan.' : totals.holdReasons[0]] : [];
  await persistLines(q, plan.company_id, invoiceId, lines);
  await q.query(`update rigo.invoices set subtotal_minor = $2, discount_minor = $3, tax_minor = $4, total_minor = $5, hold_reasons = $6, status = case when status = 'issued' then status else $7 end,
      approved_by = null, approved_at = null, version = version + 1, updated_at = now() where id = $1`,
    [invoiceId, totals.subtotalMinor, totals.discountMinor, totals.taxMinor, totals.totalMinor, JSON.stringify(reasons), totals.totalMinor === null ? 'held' : 'draft']);
}

/**
 * Pause or end: issued rent periods that now include days without service earn a credit, kept on
 * the plan and taken off the next rent invoice (or, when the plan has ended, credited on the invoice
 * itself); periods not yet issued are rebuilt with fewer days (R8-M2, D5).
 */
async function creditIssuedPeriods(q: Q, cc: CompanyCtx, plan: any, range: Excluded, final: boolean) {
  const rule = readBillingRule(plan.billing_rule);
  const issued = (await q.query<any>(`select * from rigo.invoices where recurring_plan_id = $1 and status = 'issued' and period_start is not null and period_end >= $2 ${range.to ? 'and period_start <= $3' : ''}`,
    range.to ? [plan.id, range.from, range.to] : [plan.id, range.from])).rows;
  // Days already credited on each issued invoice are never credited again (a pause, then an early end).
  const ledger = (await q.query<any>(`select credited_days from rigo.recurring_plans where id = $1`, [plan.id])).rows[0]?.credited_days ?? {};
  let credits = 0;
  for (const inv of issued) {
    const { days, amountMinor: amount } = newDaysCredit(rule, plan.units, { start: inv.period_start, end: inv.period_end }, range, ledger[inv.id] ?? []);
    if (!amount) continue;
    ledger[inv.id] = [...(ledger[inv.id] ?? []), ...days].sort();
    credits += amount;
    const description = `Credit: ${range.reason} (invoice ${inv.number})`;
    if (final) {
      const owed = Math.max(0, Number(inv.total_minor) - Number(inv.paid_minor) - Number(inv.credited_minor));
      const note = Math.min(owed, amount);
      if (note > 0) {
        await q.query(`insert into rigo.invoice_credits (company_id, invoice_id, amount_minor, source, note, created_by) values ($1,$2,$3,'credit_note',$4,$5)`, [cc.company.id, inv.id, note, description, cc.user.id]);
        const { refreshPayment } = await import('./invoicing.js');
        await refreshPayment(q, inv.id);
      }
      if (amount > note && inv.customer_id) {
        await q.query(`insert into rigo.credit_entries (company_id, customer_id, amount_minor, kind, invoice_id, note, created_by) values ($1,$2,$3,'overpayment',$4,$5,$6)`, [cc.company.id, inv.customer_id, amount - note, inv.id, description, cc.user.id]);
      }
    } else {
      const entry: PendingCredit = { description, amountMinor: amount, invoiceId: inv.id, days };
      await q.query(`update rigo.recurring_plans set pending_credits = pending_credits || $2::jsonb where id = $1`, [plan.id, JSON.stringify([entry])]);
    }
  }
  await q.query(`update rigo.recurring_plans set credited_days = $2 where id = $1`, [plan.id, JSON.stringify(ledger)]);
  return credits;
}

recurringRoutes.post('/recurring/:id/pause', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.edit');
  const input = await body(c, z.object({ from: date, until: date.nullable() }));
  if (input.until && input.until < input.from) throw badRequest('"Until" must be after "from".');
  const out = await cc.db.tx(async (q) => {
    const plan = await loadPlan(cc, q, c.req.param('id'), true);
    await q.query(`update rigo.recurring_plans set paused_from = $2, paused_until = $3, status = 'paused', version = version + 1 where id = $1`, [plan.id, input.from, input.until]);
    // Already-generated visits inside the pause that have not started are cancelled with a reason; started work is untouched.
    const cancelled = await q.query<{ id: string }>(
      `update rigo.jobs j set status = 'cancelled', billing_status = 'not_billable', version = version + 1, updated_at = now()
         from rigo.plan_occurrences o where o.job_id = j.id and o.plan_id = $1 and o.occurrence_date >= $2 and ($3::date is null or o.occurrence_date <= $3) and j.status in ('draft','open') returning j.id`,
      [plan.id, input.from, input.until]);
    for (const j of cancelled.rows) await q.query(`insert into rigo.job_events (company_id, job_id, type, actor_user_id, data) values ($1,$2,'status',$3,$4)`, [cc.company.id, j.id, cc.user.id, JSON.stringify({ to: 'cancelled', reason: 'Recurring plan paused' })]);
    await q.query(`update rigo.plan_occurrences set state = 'skipped_paused' where plan_id = $1 and occurrence_date >= $2 and ($3::date is null or occurrence_date <= $3) and job_id = any($4)`, [plan.id, input.from, input.until, cancelled.rows.map((r) => r.id)]);
    const paused = { ...plan, paused_from: input.from, paused_until: input.until };
    const range = exclusions(paused)[0];
    const rule = readBillingRule(plan.billing_rule);
    let credits = 0; let rebuilt = 0;
    if (isPeriodic(rule.frequency) && rule.frequency !== 'event') {
      rebuilt = await rebuildOpenRentInvoices(q, paused);
      credits = await creditIssuedPeriods(q, cc, paused, range, false);
    }
    await audit(q, cc, 'plan.paused', { id: plan.id, from: input.from, until: input.until, credits });
    return { cancelledVisits: cancelled.rows.length, rebuiltInvoices: rebuilt, creditMinor: can(cc, 'finance.view') ? credits : undefined };
  });
  return c.json(out);
});

/**
 * Resume a paused plan from today. The days it was paused stay left out of the rent; days of the pause
 * after today are billed again: credits waiting for them are taken back, drafts are rebuilt, and a
 * period that was skipped because it was fully paused is billed for the days from today (R8-M2, D5).
 */
recurringRoutes.post('/recurring/:id/resume', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.edit');
  await cc.db.tx(async (q) => {
    const plan = await loadPlan(cc, q, c.req.param('id'), true);
    if (plan.status !== 'paused') throw conflict('Only paused plans can be resumed.');
    const today = localDate(new Date(), cc.company.timezone);
    const history = [...((plan.pause_history ?? []) as Excluded[])];
    const lastOff = addDays(today, -1);
    if (plan.paused_from && plan.paused_from <= lastOff) {
      const to = plan.paused_until && plan.paused_until < lastOff ? plan.paused_until : lastOff;
      history.push({ from: plan.paused_from, to, reason: `paused ${periodLabel(plan.paused_from, to)}` });
    }
    // Credits waiting for days from today on are taken back (service is back on those days).
    const rule = readBillingRule(plan.billing_rule);
    const ledger: Record<string, string[]> = plan.credited_days ?? {};
    const pending: PendingCredit[] = [];
    for (const cr of (plan.pending_credits ?? []) as PendingCredit[]) {
      if (!cr.invoiceId || !cr.days?.length) { pending.push(cr); continue; }
      const back = cr.days.filter((d) => d >= today);
      if (!back.length) { pending.push(cr); continue; }
      const inv = (await q.query<any>(`select period_start, period_end from rigo.invoices where id = $1`, [cr.invoiceId])).rows[0];
      const had = ledger[cr.invoiceId] ?? [];
      const kept = had.filter((d) => !back.includes(d));
      const less = inv ? creditForDays(rule, plan.units, { start: inv.period_start, end: inv.period_end }, had.length) - creditForDays(rule, plan.units, { start: inv.period_start, end: inv.period_end }, kept.length) : cr.amountMinor;
      ledger[cr.invoiceId] = kept;
      const rest = cr.amountMinor - less;
      if (rest > 0) pending.push({ ...cr, amountMinor: rest, days: cr.days.filter((d) => d < today) });
    }
    // Bill again from the last rent invoice, so a period skipped while fully paused is billed for its active days.
    const last = (await q.query<any>(`select max(period_start)::text as d from rigo.invoices where recurring_plan_id = $1`, [plan.id])).rows[0]?.d ?? null;
    await q.query(`update rigo.recurring_plans set status = 'active', paused_from = null, paused_until = null, pause_history = $2, pending_credits = $3, credited_days = $4,
        billed_through = $5, generated_through = least(generated_through, $6::date), version = version + 1 where id = $1`,
      [plan.id, JSON.stringify(history), JSON.stringify(pending), JSON.stringify(ledger), last, lastOff]);
    // Visits from today on are scheduled again.
    await q.query(`delete from rigo.plan_occurrences where plan_id = $1 and state = 'skipped_paused' and occurrence_date >= $2`, [plan.id, today]);
    await rebuildOpenRentInvoices(q, { ...plan, paused_from: null, paused_until: null, pause_history: history });
    await audit(q, cc, 'plan.resumed', { id: plan.id, on: today });
  });
  await generateForCompany(cc.db, cc.company.id);
  return c.json({ ok: true });
});

recurringRoutes.post('/recurring/:id/end', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.edit');
  const input = await body(c, z.object({ endsOn: date, createPickup: z.boolean().default(false) }));
  const out = await cc.db.tx(async (q) => {
    const plan = await loadPlan(cc, q, c.req.param('id'), true);
    if (input.endsOn < plan.starts_on) throw badRequest('The last day can\'t be before the plan starts.', { fields: { endsOn: 'Choose a later date' } });
    const today = localDate(new Date(), cc.company.timezone);
    await q.query(`update rigo.recurring_plans set ends_on = $2::date, status = case when $2::date < $3::date then 'ended' else status end, version = version + 1 where id = $1`, [plan.id, input.endsOn, today]);
    const cancelled = await q.query(`update rigo.jobs j set status = 'cancelled', billing_status = 'not_billable', version = version + 1 from rigo.plan_occurrences o where o.job_id = j.id and o.plan_id = $1 and o.occurrence_date > $2 and j.status in ('draft','open') returning j.id`, [plan.id, input.endsOn]);
    const ended = { ...plan, ends_on: input.endsOn };
    const rule = readBillingRule(plan.billing_rule);
    let credits = 0; let rebuilt = 0;
    if (isPeriodic(rule.frequency) && rule.frequency !== 'event') {
      rebuilt = await rebuildOpenRentInvoices(q, ended);
      credits = await creditIssuedPeriods(q, cc, ended, { from: addDays(input.endsOn, 1), to: null, reason: `plan ended ${periodLabel(input.endsOn, input.endsOn)}` }, true);
      // Credits still waiting for a next invoice that will never come are credited now.
      const pending = (plan.pending_credits ?? []) as { description: string; amountMinor: number }[];
      if (pending.length) {
        const total = pending.reduce((s, p) => s + p.amountMinor, 0);
        await q.query(`insert into rigo.credit_entries (company_id, customer_id, amount_minor, kind, note, created_by) values ($1,$2,$3,'overpayment',$4,$5)`, [cc.company.id, plan.customer_id, total, `Credits from plan "${plan.name}"`, cc.user.id]);
        await q.query(`update rigo.recurring_plans set pending_credits = '[]'::jsonb where id = $1`, [plan.id]);
        credits += total;
      }
    }
    // Collecting the units is a job too (R8-m4).
    const pickup = input.createPickup ? await planJob(q, cc.company.id, ended, input.endsOn, 'pickup', cc.user.id, cc.company.timezone) : null;
    await audit(q, cc, 'plan.ended', { id: plan.id, endsOn: input.endsOn, credits });
    return { cancelledVisits: cancelled.rows.length, rebuiltInvoices: rebuilt, creditMinor: can(cc, 'finance.view') ? credits : undefined, pickupJob: pickup };
  });
  return c.json(out);
});

/** Move an event rental: delivery, pickup and the dates between move together (R8-M4). */
recurringRoutes.post('/recurring/:id/move', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.edit');
  const input = await body(c, z.object({ startsOn: date }));
  const out = await cc.db.tx(async (q) => {
    const plan = await loadPlan(cc, q, c.req.param('id'), true);
    const shift = Math.round((Date.parse(input.startsOn) - Date.parse(plan.starts_on)) / 86400_000);
    if (!shift) return { movedJobs: 0 };
    const started = await q.query(`select 1 from rigo.jobs where recurring_plan_id = $1 and status in ('in_progress','completed','partial')`, [plan.id]);
    if (started.rows.length) throw conflict('Work on this plan has started, so it can\'t be moved. Change the visit schedule or end it instead.');
    await q.query(`update rigo.recurring_plans set starts_on = $2, ends_on = case when ends_on is null then null else ends_on + $3::int end, generated_through = null, version = version + 1 where id = $1`, [plan.id, input.startsOn, shift]);
    const moved = await q.query(`update rigo.jobs set scheduled_start = scheduled_start + ($2 || ' days')::interval, scheduled_end = scheduled_end + ($2 || ' days')::interval, version = version + 1, updated_at = now()
        where recurring_plan_id = $1 and status in ('draft','open') returning id`, [plan.id, String(shift)]);
    await q.query(`update rigo.plan_occurrences set occurrence_date = occurrence_date + $2::int where plan_id = $1`, [plan.id, shift]);
    for (const j of moved.rows) await q.query(`insert into rigo.job_events (company_id, job_id, type, actor_user_id, data) values ($1,$2,'rescheduled',$3,$4)`, [cc.company.id, j.id, cc.user.id, JSON.stringify({ movedDays: shift })]);
    await audit(q, cc, 'plan.moved', { id: plan.id, days: shift });
    return { movedJobs: moved.rows.length };
  });
  return c.json(out);
});

/** An extra service visit for the plan: billed at the plan's extra price, or the service's pricing (R8-C1). */
recurringRoutes.post('/recurring/:id/extra', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.create');
  const input = await body(c, z.object({ day: date }));
  const out = await cc.db.tx(async (q) => planJob(q, cc.company.id, await loadPlan(cc, q, c.req.param('id')), input.day, 'extra', cc.user.id, cc.company.timezone));
  return c.json(out);
});

/** Record the deposit taken when booking (D22): it becomes customer credit and pays the rent. */
recurringRoutes.post('/recurring/:id/deposit', async (c) => {
  const cc = c.get('cc');
  need(cc, 'payments.record', 'finance.view');
  const input = await body(c, z.object({ amountMinor: z.number().int().positive('Enter an amount'), method: z.enum(['cash', 'check', 'card', 'card_terminal', 'bank_transfer', 'other']), reference: z.string().trim().max(80).default(''), idempotencyKey: z.string().min(8).max(80) }));
  await cc.db.tx(async (q) => {
    const plan = await loadPlan(cc, q, c.req.param('id'), true);
    const dup = await q.query(`select 1 from rigo.payments where company_id = $1 and idempotency_key = $2`, [cc.company.id, input.idempotencyKey]);
    if (dup.rows.length) return;
    const p = await q.query<{ id: string }>(`insert into rigo.payments (company_id, customer_id, amount_minor, method, reference, note, paid_on, recorded_by, idempotency_key, kind, state, applied_minor, applied_at, plan_id)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'deposit','confirmed',0,now(),$10) returning id`,
      [cc.company.id, plan.customer_id, input.amountMinor, input.method, input.reference, `Deposit for "${plan.name}"`, localDate(new Date(), cc.company.timezone), cc.user.id, input.idempotencyKey, plan.id]);
    await q.query(`insert into rigo.credit_entries (company_id, customer_id, amount_minor, kind, payment_id, note, created_by) values ($1,$2,$3,'deposit',$4,$5,$6)`, [cc.company.id, plan.customer_id, input.amountMinor, p.rows[0].id, `Deposit for "${plan.name}"`, cc.user.id]);
    await q.query(`update rigo.recurring_plans set deposit_received_minor = deposit_received_minor + $2 where id = $1`, [plan.id, input.amountMinor]);
    await audit(q, cc, 'plan.deposit', { id: plan.id, amountMinor: input.amountMinor });
  });
  return c.json({ ok: true });
});

/** Rental units at the site: place one from the yard, mark it back in the yard, or missing. */
recurringRoutes.post('/recurring/:id/units', async (c) => {
  const cc = c.get('cc');
  need(cc, 'resources.edit');
  const input = await body(c, z.object({ resourceId: z.string().uuid(), placement: z.enum(['on_site', 'yard', 'missing']) }));
  await cc.db.tx(async (q) => {
    const plan = await loadPlan(cc, q, c.req.param('id'));
    const r = (await q.query<any>(`select * from rigo.resources where id = $1 and company_id = $2 for update`, [input.resourceId, cc.company.id])).rows[0];
    if (!r) throw notFound('Unit');
    if (r.plan_id && r.plan_id !== plan.id) throw conflict(`${r.name} is placed with another plan. Bring it back to the yard first.`);
    await q.query(`update rigo.resources set placement = $2, plan_id = case when $2 = 'yard' then null else $3::uuid end, placed_at = now() where id = $1`, [r.id, input.placement, plan.id]);
    await audit(q, cc, 'unit.placed', { resourceId: r.id, planId: plan.id, placement: input.placement });
  });
  return c.json({ ok: true });
});

/** Change future visits from a date. Already-generated, unstarted visits from that date are replaced. */
recurringRoutes.post('/recurring/:id/change', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.edit');
  const input = await body(c, z.object({ effectiveFrom: date, visitRule, units: z.number().int().min(1).max(500).optional(), defaultUserId: z.string().uuid().nullable().optional(), defaultResourceIds: z.array(z.string().uuid()).max(10).optional() }));
  const out = await cc.db.tx(async (q) => {
    const plan = await loadPlan(cc, q, c.req.param('id'), true);
    if (input.defaultUserId !== undefined || input.defaultResourceIds) await checkDefaults(q, cc, input.defaultUserId ?? null, input.defaultResourceIds ?? []);
    const cancelled = await q.query<{ id: string }>(`update rigo.jobs j set status = 'cancelled', billing_status = 'not_billable', version = version + 1 from rigo.plan_occurrences o where o.job_id = j.id and o.plan_id = $1 and o.occurrence_date >= $2 and j.status in ('draft','open') and (j.assigned_user_id is null or j.assigned_user_id = $3) returning j.id`, [plan.id, input.effectiveFrom, plan.default_user_id]);
    await q.query(`delete from rigo.plan_occurrences where plan_id = $1 and occurrence_date >= $2 and (job_id is null or job_id = any($3))`, [plan.id, input.effectiveFrom, cancelled.rows.map((r) => r.id)]);
    await q.query(`update rigo.recurring_plans set visit_rule = $2, units = coalesce($3, units), default_user_id = case when $5 then $6 else default_user_id end, default_resource_ids = coalesce($7, default_resource_ids),
        generated_through = least(generated_through, ($4::date - 1)), version = version + 1 where id = $1`,
      [plan.id, JSON.stringify(input.visitRule), input.units ?? null, input.effectiveFrom, input.defaultUserId !== undefined, input.defaultUserId ?? null, input.defaultResourceIds ?? null]);
    return { replacedVisits: cancelled.rows.length, note: 'Visits someone else was assigned to, or already started, were kept unchanged.' };
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
  const plans = (await db.query<any>(`select p.id from rigo.recurring_plans p where p.company_id = $1 and p.status in ('active','paused')`, [companyId])).rows;
  let visits = 0, invoices = 0;
  for (const { id } of plans) {
    await db.tx(async (q) => {
      const locked = (await q.query<any>(`select p.*, s.fields, s.tax_rate_bp from rigo.recurring_plans p join rigo.services s on s.id = p.service_id where p.id = $1 for update of p`, [id])).rows[0];
      if (!locked || locked.status === 'ended') return;
      const from = locked.generated_through ? addDays(locked.generated_through, 1) : (locked.starts_on > today ? locked.starts_on : today);
      for (const d of occurrences(locked.visit_rule as VisitRule, locked.starts_on, locked.ends_on, from, horizon)) {
        const paused = locked.paused_from && d >= locked.paused_from && (!locked.paused_until || d <= locked.paused_until);
        const exists = await q.query(`select 1 from rigo.plan_occurrences where plan_id = $1 and occurrence_date = $2`, [locked.id, d]);
        if (exists.rows.length) continue;
        if (paused) { await q.query(`insert into rigo.plan_occurrences (plan_id, occurrence_date, company_id, state) values ($1,$2,$3,'skipped_paused')`, [locked.id, d, companyId]); continue; }
        // Each visit is a normal job, assigned to the plan's driver and truck when it has them.
        const job = await planJob(q, companyId, locked, d, 'service', null, co.timezone);
        await q.query(`update rigo.jobs set details = details || jsonb_build_object('_occurrence', $2::text) where id = $1`, [job.id, d]);
        await q.query(`insert into rigo.plan_occurrences (plan_id, occurrence_date, company_id, job_id) values ($1,$2,$3,$4)`, [locked.id, d, companyId, job.id]);
        visits++;
      }
      if (horizon > (locked.generated_through ?? '')) await q.query(`update rigo.recurring_plans set generated_through = $2 where id = $1`, [locked.id, horizon]);
      // Billing schedule (rentals): one invoice per period, independent of visit frequency.
      const rule = readBillingRule(locked.billing_rule);
      for (const p of billingPeriods(rule.frequency, locked.starts_on, locked.ends_on, locked.billed_through, today, rule.everyDays ?? 28)) {
        const key = `plan:${locked.id}:${p.start}`;
        const lines = periodCharges(rule, locked.units, p, exclusions(locked));
        if (lines.every((l) => l.amountMinor === 0)) { await q.query(`update rigo.recurring_plans set billed_through = $2 where id = $1`, [locked.id, p.start]); continue; }
        // Credits from earlier periods (a pause after their invoice went out) come off this one, never
        // more than its charges; the rest waits for the next rent invoice.
        const pending = (locked.pending_credits ?? []) as PendingCredit[];
        const charges = lines.every((l) => l.amountMinor !== null) ? lines.reduce((t, l) => t + (l.amountMinor ?? 0), 0) : null;
        const { lines: credits, left } = charges === null ? { lines: [] as DraftLine[], left: pending } : applyCredits(charges, pending);
        const ins = await q.query<{ id: string }>(
          `insert into rigo.invoices (company_id, billable_key, customer_id, recurring_plan_id, status, currency, hold_reasons, kind, period_start, period_end, location_id, due_days)
           values ($1,$2,$3,$4,'draft',(select currency from rigo.companies where id = $1),'[]','rental',$5,$6,$7, coalesce((select payment_terms_days from rigo.customers where id = $3), (select (settings->>'invoiceDueDays')::int from rigo.companies where id = $1), 30))
           on conflict (company_id, billable_key) do nothing returning id`,
          [companyId, key, locked.customer_id, locked.id, p.start, p.end, locked.location_id]);
        if (ins.rows[0]) {
          await writeRentInvoice(q, ins.rows[0].id, { ...locked, company_id: companyId }, [...lines, ...credits], rule);
          if (pending.length) {
            await q.query(`update rigo.recurring_plans set pending_credits = $2 where id = $1`, [locked.id, JSON.stringify(left)]);
            locked.pending_credits = left;
          }
          await emit(q, companyId, 'invoice.prepared', { type: 'invoice', id: ins.rows[0].id }, { recurring: true });
          invoices++;
        }
        await q.query(`update rigo.recurring_plans set billed_through = $2 where id = $1`, [locked.id, p.start]);
      }
    });
  }
  if (invoices) await notifyPermission(db, companyId, 'invoices.edit', { category: 'update', title: `${invoices} rent invoice draft${invoices === 1 ? '' : 's'} prepared`, link: 'invoices?status=attention' });
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
