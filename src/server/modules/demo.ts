import { Hono } from 'hono';
import { z } from 'zod';
import type { Q } from '../db/index.js';
import { getDb } from '../db/index.js';
import { type AppEnv, requireUser, audit } from '../http/context.js';
import { body } from '../lib/util.js';
import { badRequest, forbidden } from '../http/errors.js';
import { seedRoles, insertService, seedDefaultWorkflows, exportStructure } from './structure.js';
import { starterService } from '../../shared/services.js';
import { stableHash } from '../../shared/workflows.js';
import { createCompany, createCompanySchema } from './companies.js';
import { localDate, addDays, zonedToUtc } from '../../shared/schedule.js';
import { prepareInvoiceForJob } from './invoicing.js';
import { processAll } from '../automation/engine.js';

// Each person's demo is their own isolated company (kind = 'demo') filled with clearly fictional
// records. The provider boundary treats demo companies as simulation-only.

export const demoPublic = new Hono<AppEnv>();
export const demoRoutes = new Hono<AppEnv>();

const TZ = 'America/Chicago';

async function fictionalUser(q: Q, name: string, tag: string) {
  // Fictional people cannot sign in: reserved .invalid domain and an unusable password hash.
  const email = `${tag}-${crypto.randomUUID()}@demo.rigo.invalid`;
  const { rows } = await q.query<{ id: string }>(`insert into rigo.users (email, name, password_hash) values ($1,$2,'!') returning id`, [email, name]);
  return rows[0].id;
}

export async function seedDemo(q: Q, userId: string) {
  const { rows } = await q.query<{ id: string }>(
    `insert into rigo.companies (name, kind, demo_user_id, timezone, currency, service_categories, automation_mode, created_by, phone, email, address, settings)
     values ('Northwind Field Services (Demo)', 'demo', $1, $2, 'USD', '{fuel,portable_toilet,septic}', 'assisted', $1, '(555) 010-0199', 'office@northwind.example', '100 Example Way, Springfield', $3) returning id`,
    [userId, TZ, JSON.stringify({ setup: { basics: true, automation: true }, demo: { guide: { step: 0, dismissed: false }, simRole: 'owner' }, invoiceDueDays: 30 })]);
  const cid = rows[0].id;
  await seedRoles(q, cid);
  await q.query(`insert into rigo.memberships (company_id, user_id, role_key) values ($1,$2,'owner')`, [cid, userId]);
  const dana = await fictionalUser(q, 'Dana Driver', 'driver');
  const rafa = await fictionalUser(q, 'Rafa Route', 'driver2');
  const sam = await fictionalUser(q, 'Sam Dispatch', 'dispatcher');
  const olive = await fictionalUser(q, 'Olive Office', 'office');
  for (const [uid, role, name] of [[dana, 'driver', 'Dana Driver (fictional)'], [rafa, 'driver', 'Rafa Route (fictional)'], [sam, 'dispatcher', 'Sam Dispatch (fictional)'], [olive, 'office', 'Olive Office (fictional)']]) {
    await q.query(`insert into rigo.memberships (company_id, user_id, role_key, display_name, is_fictional) values ($1,$2,$3,$4,true)`, [cid, uid, role, name]);
  }
  await q.query(`update rigo.companies set settings = jsonb_set(settings, '{demo,driverUserId}', to_jsonb($2::text)) where id = $1`, [cid, dana]);

  // Services with fictional example rates (not recommendations).
  const fuel = starterService('fuel'); fuel.pricing[0].rateMinor = 389; fuel.pricing.push({ id: 'delivery', label: 'Delivery fee', basis: 'flat', quantityField: '', unit: '', rateMinor: 4500, taxable: false });
  const toilet = starterService('portable_toilet'); toilet.pricing[0].rateMinor = 3500; toilet.requiresPhoto = false;
  const septic = starterService('septic'); septic.pricing[0].rateMinor = null; septic.requiresPhoto = false; // left unset to show an invoice hold
  const sFuel = await insertService(q, cid, fuel), sToilet = await insertService(q, cid, toilet), sSeptic = await insertService(q, cid, septic);

  const res: Record<string, string> = {};
  for (const [kind, name, ident, cap] of [['truck', 'Tanker 12', 'TX-1234 (fictional)', '3,000 gal'], ['truck', 'Vac Truck 3', 'TX-5678 (fictional)', '2,500 gal'], ['truck', 'Flatbed 7', 'TX-9012 (fictional)', '8 units'], ['equipment', 'Hose reel B', '', '']]) {
    res[name] = (await q.query<{ id: string }>(`insert into rigo.resources (company_id, kind, name, identifier, capacity) values ($1,$2,$3,$4,$5) returning id`, [cid, kind, name, ident, cap])).rows[0].id;
  }
  const custs: { id: string; loc: string }[] = [];
  const data = [
    ['Acme Construction (fictional)', 'ap@acme-construction.example', '(555) 010-1001', '2200 Sample Rd, Springfield', 'Gate code 1234 (fictional). Tank behind trailer.'],
    ['Riverside Farm Co-op (fictional)', 'billing@riverside.example', '(555) 010-1002', '48 County Line Rd, Springfield', 'Call on arrival. Dog on site.'],
    ['Lakeview Events (fictional)', 'events@lakeview.example', '(555) 010-1003', 'Lakeview Park, North Lot, Springfield', 'Place units on gravel pad by the stage.'],
    ['Maple Street Residence (fictional)', '', '(555) 010-1004', '17 Maple St, Springfield', 'Septic lid in backyard, left of shed.'],
  ];
  for (const [name, email, phone, address, access] of data) {
    const c = await q.query<{ id: string }>(`insert into rigo.customers (company_id, name, email, phone, notes) values ($1,$2,$3,$4,'Fictional demo customer.') returning id`, [cid, name, email || null, phone]);
    const l = await q.query<{ id: string }>(`insert into rigo.locations (company_id, customer_id, label, address, access_instructions, site_contact) values ($1,$2,'Main site',$3,$4,'Site lead (fictional)') returning id`, [cid, c.rows[0].id, address, access]);
    custs.push({ id: c.rows[0].id, loc: l.rows[0].id });
  }

  // Workflows: the standard set, active, acting on behalf of the demo visitor.
  const wfs = await seedDefaultWorkflows(q, cid, userId);
  for (const w of wfs) {
    await q.query(`update rigo.workflow_versions set status = 'active', tested_hash = definition_hash, tested_at = now(), activated_at = now(), activated_by = $2, test_result = '{"note":"Pre-tested demo workflow"}' where id = $1`, [w.versionId, userId]);
    await q.query(`update rigo.workflows set active_version_id = $2 where id = $1`, [w.workflowId, w.versionId]);
  }

  const today = localDate(new Date(), TZ);
  let n = 0;
  const job = async (o: { cust: number; svc: string; status: string; day: string; time: string; driver?: string | null; resources?: string[]; details: Record<string, string>; notes?: string }) => {
    n++;
    const start = zonedToUtc(o.day, o.time, TZ);
    const { rows: j } = await q.query<{ id: string }>(
      `insert into rigo.jobs (company_id, number, customer_id, location_id, service_id, status, assigned_user_id, scheduled_start, scheduled_end, details, notes, access_instructions, contact_name, contact_phone, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'', 'Site lead (fictional)', '(555) 010-2000', $12) returning id`,
      [cid, n, custs[o.cust].id, custs[o.cust].loc, o.svc, o.status, o.driver ?? null, start.toISOString(), new Date(start.getTime() + 3600_000).toISOString(), JSON.stringify(o.details), o.notes ?? '', userId]);
    for (const r of o.resources ?? []) await q.query(`insert into rigo.job_resources (job_id, resource_id, company_id) values ($1,$2,$3)`, [j[0].id, res[r], cid]);
    await q.query(`insert into rigo.job_events (company_id, job_id, type, actor_label, data) values ($1,$2,'created','Demo data',$3)`, [cid, j[0].id, JSON.stringify({ status: o.status })]);
    return j[0].id;
  };
  await job({ cust: 0, svc: sFuel, status: 'open', day: today, time: '08:00', driver: dana, resources: ['Tanker 12'], details: { product: 'Diesel', requested_qty: '450' } });
  await job({ cust: 2, svc: sToilet, status: 'open', day: today, time: '10:30', driver: dana, resources: ['Flatbed 7'], details: { visit_type: 'Service', units: '6', placement: 'By the stage' } });
  await job({ cust: 1, svc: sFuel, status: 'open', day: today, time: '13:00', driver: null, details: { product: 'Gasoline', requested_qty: '200' }, notes: 'Unassigned: needs a driver.' });
  await job({ cust: 3, svc: sSeptic, status: 'open', day: addDays(today, 1), time: '09:00', driver: rafa, resources: ['Vac Truck 3'], details: { service_detail: 'Pump-out' } });
  await job({ cust: 2, svc: sToilet, status: 'draft', day: addDays(today, 2), time: '07:30', driver: null, details: { visit_type: 'Pickup' }, notes: 'Draft: unit count not confirmed yet.' });
  // A completed delivery whose invoice is waiting for the owner's approval.
  const done = await job({ cust: 0, svc: sFuel, status: 'completed', day: addDays(today, -1), time: '09:00', driver: dana, resources: ['Tanker 12'], details: { product: 'Diesel', requested_qty: '500' } });
  await q.query(`update rigo.jobs set completion = $2, completion_submission_id = 'demo-seed', completed_at = now() - interval '20 hours', billing_status = 'ready' where id = $1`,
    [done, JSON.stringify({ outcome: 'completed', values: { delivered_qty: '482.5' }, notes: 'Tank topped off. (fictional)', reason: '', photoIds: [], signatureId: null, signerName: '' })]);
  await q.query(`insert into rigo.job_events (company_id, job_id, type, actor_label, data) values ($1,$2,'completion','Dana Driver (fictional)',$3)`, [cid, done, JSON.stringify({ outcome: 'completed', values: { delivered_qty: '482.5' } })]);
  await q.query(`insert into rigo.events (company_id, type, subject_type, subject_id) values ($1,'job.completed','job',$2)`, [cid, done]);
  // A septic job completed without a configured rate: its invoice will be held.
  const held = await job({ cust: 3, svc: sSeptic, status: 'completed', day: addDays(today, -2), time: '14:00', driver: rafa, resources: ['Vac Truck 3'], details: { service_detail: 'Pump-out' } });
  await q.query(`update rigo.jobs set completion = $2, completion_submission_id = 'demo-seed-2', completed_at = now() - interval '44 hours', billing_status = 'ready' where id = $1`,
    [held, JSON.stringify({ outcome: 'completed', values: { volume_pumped: '1000', condition_notes: 'Normal levels. (fictional)' }, notes: '', reason: '', photoIds: [], signatureId: null, signerName: '' })]);
  await prepareInvoiceForJob(q, cid, held, { userId });
  await q.query(`update rigo.companies set job_seq = $2 where id = $1`, [cid, n]);

  // A rental plan: weekly servicing billed monthly.
  await q.query(`insert into rigo.recurring_plans (company_id, name, kind, customer_id, location_id, service_id, visit_rule, billing_rule, units, starts_on, generated_through, billed_through)
      values ($1,'Lakeview season rental (fictional)','rental',$2,$3,$4,$5,$6,6,$7,$8,$7)`,
    [cid, custs[2].id, custs[2].loc, sToilet, JSON.stringify({ frequency: 'weekly', interval: 1, weekdays: [5], time: '07:00', durationMinutes: 60 }),
      JSON.stringify({ frequency: 'monthly', rateMinor: 12500, description: 'Unit rental' }), addDays(today, -10), addDays(today, 14)]);
  return cid;
}

demoPublic.post('/demo', async (c) => {
  const user = requireUser(c);
  const db = await getDb();
  const existing = await db.query<{ id: string }>(`select id from rigo.companies where demo_user_id = $1 and kind = 'demo'`, [user.id]);
  if (existing.rows[0]) return c.json({ id: existing.rows[0].id, created: false });
  const id = await db.tx((q) => seedDemo(q, user.id));
  await processAll(3000);
  return c.json({ id, created: true });
});

function demoOnly(cc: any) {
  if (!cc.isDemo || cc.company.demo_user_id !== cc.user.id) throw forbidden('This only works in your own demo workspace.');
}

demoRoutes.post('/demo/reset', async (c) => {
  const cc = c.get('cc');
  demoOnly(cc);
  const db = cc.db;
  const id = await db.tx(async (q) => {
    const fict = await q.query<{ user_id: string }>(`select user_id from rigo.memberships where company_id = $1 and is_fictional`, [cc.company.id]);
    await q.query(`delete from rigo.companies where id = $1 and kind = 'demo' and demo_user_id = $2`, [cc.company.id, cc.user.id]);
    for (const f of fict.rows) await q.query(`delete from rigo.users where id = $1 and email like '%@demo.rigo.invalid'`, [f.user_id]);
    return seedDemo(q, cc.user.id);
  });
  await processAll(3000);
  return c.json({ id });
});

demoRoutes.post('/demo/role', async (c) => {
  const cc = c.get('cc');
  demoOnly(cc);
  const input = await body(c, z.object({ role: z.enum(['owner', 'dispatcher', 'driver', 'office']) }));
  await cc.db.query(`update rigo.companies set settings = jsonb_set(settings, '{demo,simRole}', to_jsonb($2::text)) where id = $1`, [cc.company.id, input.role]);
  return c.json({ ok: true });
});

demoRoutes.post('/demo/guide', async (c) => {
  const cc = c.get('cc');
  demoOnly(cc);
  const input = await body(c, z.object({ step: z.number().int().min(0).max(20).optional(), dismissed: z.boolean().optional() }));
  const guide = { ...(cc.company.settings?.demo?.guide ?? { step: 0, dismissed: false }), ...input };
  await cc.db.query(`update rigo.companies set settings = jsonb_set(settings, '{demo,guide}', $2::jsonb) where id = $1`, [cc.company.id, JSON.stringify(guide)]);
  return c.json({ guide });
});

/** Create a real company from the demo: approved structure only, never the fictional records. */
demoRoutes.post('/demo/convert', async (c) => {
  const cc = c.get('cc');
  demoOnly(cc);
  const input = await body(c, createCompanySchema.extend({ copyStructure: z.boolean().default(true) }));
  const structure = input.copyStructure ? await exportStructure(cc.db, cc.company.id) : undefined;
  if (structure) structure.workflows = structure.workflows.map((w) => ({ ...w, description: w.description }));
  const id = await cc.db.tx(async (q) => {
    const newId = await createCompany(q, cc.user.id, { ...input, start: structure ? 'blank' : input.start }, { structureFrom: structure });
    await audit(q, { company: { id: newId }, user: cc.user }, 'company.created_from_demo', { demoId: cc.company.id, structureHash: structure ? stableHash(structure) : null });
    return newId;
  });
  if (!id) throw badRequest('Could not create the company.');
  return c.json({ id });
});
