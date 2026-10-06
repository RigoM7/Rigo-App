import { Hono } from 'hono';
import { z } from 'zod';
import { type AppEnv, type CompanyCtx, need, can, audit } from '../http/context.js';
import type { Q } from '../db/index.js';
import { body } from '../lib/util.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { customFieldsSchema, validateValues, serviceInputSchema, readPricing, storedPricing, datePriceChanges } from '../../shared/services.js';
import { localDate } from '../../shared/schedule.js';
import { parseCapacity } from '../../shared/billing.js';
import { insertService } from './structure.js';
import { invalidateApprovalsFor } from '../automation/engine.js';
import { rebuildHeldInvoice } from './invoicing.js';
import { notifyUsers, notifyPermission } from './inbox.js';
import { paymentState } from '../../shared/invoices.js';

// Customers, service locations, resources (trucks/equipment) and service definitions.

export const recordRoutes = new Hono<AppEnv>();

function customDefs(cc: CompanyCtx, kind: 'customers' | 'locations' | 'jobs') {
  return customFieldsSchema.parse(cc.company.settings?.customFields ?? {})[kind];
}

function serializeCustomer(cc: CompanyCtx, r: any) {
  const contact = can(cc, 'customers.contact');
  return { id: r.id, name: r.name, email: contact ? r.email : undefined, phone: contact ? r.phone : undefined, billingAddress: contact ? r.billing_address : undefined,
    notes: r.notes, custom: r.custom, version: r.version, createdAt: r.created_at, locationCount: r.location_count, openJobs: r.open_jobs, contactHidden: !contact,
    taxExempt: !!r.tax_exempt, taxExemptNote: r.tax_exempt_note ?? '', paymentTermsDays: r.payment_terms_days ?? null, monthlyStatement: !!r.monthly_statement,
    // Customer-specific rates are prices: only for finance roles, removed here otherwise.
    priceOverrides: can(cc, 'finance.view') ? (r.price_overrides ?? {}) : undefined };
}

recordRoutes.get('/customers', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.view');
  const search = (c.req.query('q') ?? '').trim();
  const vals: unknown[] = [cc.company.id];
  let where = 'c.company_id = $1';
  if (search) {
    vals.push(`%${search.toLowerCase()}%`);
    where += ` and (lower(c.name) like $2 ${can(cc, 'customers.contact') ? 'or lower(coalesce(c.email,\'\')) like $2 or coalesce(c.phone,\'\') like $2' : ''} or exists (select 1 from rigo.locations l where l.customer_id = c.id and lower(l.address) like $2))`;
  }
  const { rows } = await cc.db.query(`select c.*, (select count(*)::int from rigo.locations l where l.customer_id = c.id) as location_count,
      (select count(*)::int from rigo.jobs j where j.customer_id = c.id and j.status in ('draft','open','in_progress')) as open_jobs
      from rigo.customers c where ${where} order by lower(c.name) limit 500`, vals);
  return c.json({ customers: rows.map((r) => serializeCustomer(cc, r)), customFields: customDefs(cc, 'customers') });
});

recordRoutes.get('/customers/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.view');
  const { rows } = await cc.db.query(`select * from rigo.customers where id = $1 and company_id = $2`, [c.req.param('id'), cc.company.id]);
  if (!rows[0]) throw notFound('Customer');
  // open_jobs: jobs not yet done at this location, offered for update when the address is edited.
  const locations = await cc.db.query(`select l.*, (select count(*)::int from rigo.jobs j where j.location_id = l.id and j.status in ('draft','open','in_progress')) as open_jobs
      from rigo.locations l where l.customer_id = $1 and l.company_id = $2 order by l.created_at`, [c.req.param('id'), cc.company.id]);
  const jobs = await cc.db.query(`select j.id, j.number, j.status, j.scheduled_start, s.name as service_name from rigo.jobs j left join rigo.services s on s.id = j.service_id where j.customer_id = $1 and j.company_id = $2 order by j.created_at desc limit 50`, [c.req.param('id'), cc.company.id]);
  const today = localDate(new Date(), cc.company.timezone);
  const invoices = can(cc, 'invoices.view') ? (await cc.db.query<any>(`select id, number, status, payment_status, due_date, ${can(cc, 'finance.view') ? 'total_minor' : 'null as total_minor'}, currency, created_at from rigo.invoices where customer_id = $1 and company_id = $2 order by created_at desc limit 50`, [c.req.param('id'), cc.company.id])).rows
    .map((i) => ({ ...i, payment: paymentState({ status: i.status, paymentStatus: i.payment_status, dueDate: i.due_date }, today) })) : null;
  const messages = can(cc, 'messages.view') ? (await cc.db.query(`select id, channel, subject, status, created_at from rigo.messages where customer_id = $1 and company_id = $2 order by created_at desc limit 50`, [c.req.param('id'), cc.company.id])).rows : null;
  return c.json({ customer: serializeCustomer(cc, rows[0]), locations: locations.rows, jobs: jobs.rows, invoices, messages, customFields: { customers: customDefs(cc, 'customers'), locations: customDefs(cc, 'locations') } });
});

/** Tax exemption and customer prices are billing decisions: they need invoice editing and finance access. */
function billingFieldsAllowed(cc: CompanyCtx, input: { taxExempt?: boolean; taxExemptNote?: string; priceOverrides?: unknown; paymentTermsDays?: number | null; monthlyStatement?: boolean }) {
  if (input.priceOverrides !== undefined) need(cc, 'finance.view', 'invoices.edit');
  if (input.taxExempt !== undefined || input.taxExemptNote !== undefined || input.paymentTermsDays !== undefined || input.monthlyStatement !== undefined) need(cc, 'invoices.edit');
}

/** Keep only overrides for this company's services and their existing price lines; drop removed (null) ones. */
async function cleanOverrides(q: Q, cc: CompanyCtx, raw: Record<string, Record<string, number | null>>) {
  const ids = Object.keys(raw);
  if (!ids.length) return {};
  const { rows } = await q.query<{ id: string; pricing: unknown }>(`select id, pricing from rigo.services where company_id = $1 and id = any($2)`, [cc.company.id, ids]);
  const out: Record<string, Record<string, number>> = {};
  for (const svc of rows) {
    const lineIds = new Set(readPricing(svc.pricing).map((p) => p.id));
    const kept = Object.fromEntries(Object.entries(raw[svc.id] ?? {}).filter(([k, v]) => lineIds.has(k) && v !== null)) as Record<string, number>;
    if (Object.keys(kept).length) out[svc.id] = kept;
  }
  if (rows.length !== ids.length) throw badRequest('Choose services from this company for customer prices.');
  return out;
}

const customerInput = z.object({
  name: z.string().trim().min(1, 'Enter the customer name').max(120),
  email: z.string().trim().max(254).email('Enter a valid email').or(z.literal('')).optional(),
  phone: z.string().trim().max(40).optional(),
  billingAddress: z.string().trim().max(300).optional(),
  notes: z.string().max(2000).optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
  version: z.number().int().optional(),
  taxExempt: z.boolean().optional(),
  taxExemptNote: z.string().trim().max(200).optional(),
  /** Payment terms in days for this customer (0 = due on receipt); null uses the company's terms (D18). */
  paymentTermsDays: z.number().int().min(0).max(180).nullable().optional(),
  /** Prepare a statement for this customer on the 1st of each month (D20). */
  monthlyStatement: z.boolean().optional(),
  /** Customer prices: service id → price-line id → rate in ten-thousandths (null removes it). */
  priceOverrides: z.record(z.string().uuid(), z.record(z.string().max(40), z.number().int().min(0).max(1_000_000_000_000).nullable())).optional(),
  location: z.object({ label: z.string().max(80).optional(), address: z.string().trim().min(1, 'Enter the service address').max(300), accessInstructions: z.string().max(1000).optional(), siteContact: z.string().max(200).optional() }).optional(),
});

recordRoutes.post('/customers', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.edit');
  const input = await body(c, customerInput);
  billingFieldsAllowed(cc, input);
  const custom = validateValues(customDefs(cc, 'customers'), input.custom ?? {}, { enforceRequired: true });
  if (Object.keys(custom.errors).length) throw badRequest('Some information needs attention.', { fields: Object.fromEntries(Object.entries(custom.errors).map(([k, v]) => [`custom.${k}`, v])) });
  const id = await cc.db.tx(async (q) => {
    const overrides = input.priceOverrides ? await cleanOverrides(q, cc, input.priceOverrides) : {};
    const { rows } = await q.query<{ id: string }>(`insert into rigo.customers (company_id, name, email, phone, billing_address, notes, custom, tax_exempt, tax_exempt_note, price_overrides, payment_terms_days, monthly_statement) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [cc.company.id, input.name, input.email || null, input.phone || null, input.billingAddress || null, input.notes ?? '', JSON.stringify(custom.clean), !!input.taxExempt, input.taxExemptNote ?? '', JSON.stringify(overrides), input.paymentTermsDays ?? null, !!input.monthlyStatement]);
    if (input.location) {
      await q.query(`insert into rigo.locations (company_id, customer_id, label, address, access_instructions, site_contact) values ($1,$2,$3,$4,$5,$6)`,
        [cc.company.id, rows[0].id, input.location.label ?? '', input.location.address, input.location.accessInstructions ?? '', input.location.siteContact ?? '']);
    }
    await audit(q, cc, 'customer.created', { id: rows[0].id });
    return rows[0].id;
  });
  return c.json({ id });
});

recordRoutes.patch('/customers/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.edit');
  const input = await body(c, customerInput.partial().extend({ version: z.number().int() }));
  billingFieldsAllowed(cc, input);
  const custom = input.custom ? validateValues(customDefs(cc, 'customers'), input.custom, { enforceRequired: true }) : null;
  if (custom && Object.keys(custom.errors).length) throw badRequest('Some information needs attention.', { fields: custom.errors });
  const contact = can(cc, 'customers.contact');
  const overrides = input.priceOverrides ? await cleanOverrides(cc.db, cc, input.priceOverrides) : null;
  const { rows } = await cc.db.query(
    `update rigo.customers set name = coalesce($3, name),
        email = case when $9 then coalesce($4, email) else email end, phone = case when $9 then coalesce($5, phone) else phone end,
        billing_address = case when $9 then coalesce($6, billing_address) else billing_address end,
        notes = coalesce($7, notes), custom = coalesce($8::jsonb, custom), tax_exempt = coalesce($11, tax_exempt), tax_exempt_note = coalesce($12, tax_exempt_note),
        price_overrides = coalesce($13::jsonb, price_overrides), payment_terms_days = case when $14 then $15 else payment_terms_days end, monthly_statement = coalesce($16, monthly_statement),
        version = version + 1, updated_at = now()
      where id = $1 and company_id = $2 and version = $10 returning id`,
    [c.req.param('id'), cc.company.id, input.name ?? null, input.email ?? null, input.phone ?? null, input.billingAddress ?? null, input.notes ?? null, custom ? JSON.stringify(custom.clean) : null, contact, input.version,
      input.taxExempt ?? null, input.taxExemptNote ?? null, overrides ? JSON.stringify(overrides) : null, input.paymentTermsDays !== undefined, input.paymentTermsDays ?? null, input.monthlyStatement ?? null]);
  if (!rows.length) {
    const exists = await cc.db.query(`select 1 from rigo.customers where id = $1 and company_id = $2`, [c.req.param('id'), cc.company.id]);
    if (!exists.rows.length) throw notFound('Customer');
    throw conflict('Someone else changed this customer while you were editing. Reload to see their changes.');
  }
  return c.json({ ok: true });
});

const locationInput = z.object({
  label: z.string().max(80).optional(), address: z.string().trim().min(1, 'Enter the service address').max(300),
  accessInstructions: z.string().max(1000).optional(), siteContact: z.string().max(200).optional(), custom: z.record(z.string(), z.unknown()).optional(),
});

recordRoutes.post('/customers/:id/locations', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.edit');
  const input = await body(c, locationInput);
  const cust = await cc.db.query(`select 1 from rigo.customers where id = $1 and company_id = $2`, [c.req.param('id'), cc.company.id]);
  if (!cust.rows.length) throw notFound('Customer');
  const custom = validateValues(customDefs(cc, 'locations'), input.custom ?? {}, { enforceRequired: true });
  if (Object.keys(custom.errors).length) throw badRequest('Some information needs attention.', { fields: custom.errors });
  const { rows } = await cc.db.query<{ id: string }>(`insert into rigo.locations (company_id, customer_id, label, address, access_instructions, site_contact, custom) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [cc.company.id, c.req.param('id'), input.label ?? '', input.address, input.accessInstructions ?? '', input.siteContact ?? '', JSON.stringify(custom.clean)]);
  return c.json({ id: rows[0].id });
});

recordRoutes.patch('/locations/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.edit');
  const input = await body(c, locationInput.partial().extend({ updateOpenJobs: z.boolean().default(false) }));
  // Editing a location changes future jobs. Jobs already booked keep their address unless the person
  // asks to update the open ones too; finished jobs and issued invoices never change (R10-M4, R5-M3).
  const out = await cc.db.tx(async (q) => {
    const { rows } = await q.query(`update rigo.locations set label = coalesce($3,label), address = coalesce($4,address), access_instructions = coalesce($5,access_instructions), site_contact = coalesce($6,site_contact) where id = $1 and company_id = $2 returning id`,
      [c.req.param('id'), cc.company.id, input.label ?? null, input.address ?? null, input.accessInstructions ?? null, input.siteContact ?? null]);
    if (!rows.length) throw notFound('Location');
    if (!input.updateOpenJobs) return { updatedJobs: 0 };
    const jobs = await q.query<any>(
      `update rigo.jobs set location_snapshot = null, version = version + 1, updated_at = now() where location_id = $1 and company_id = $2 and status in ('draft','open','in_progress') returning *`, [c.req.param('id'), cc.company.id]);
    const { noteDriverChange } = await import('./jobs.js');
    for (const j of jobs.rows) {
      await q.query(`insert into rigo.job_events (company_id, job_id, type, actor_user_id, data) values ($1,$2,'edited',$3,$4)`, [cc.company.id, j.id, cc.user.id, JSON.stringify({ addressUpdated: true })]);
      if (j.assigned_user_id) await noteDriverChange(q, cc, j, [input.address ? `New address: ${input.address}` : 'The site details changed', ...(input.accessInstructions !== undefined ? ['New access instructions'] : [])]);
    }
    await audit(q, cc, 'location.updated', { id: c.req.param('id'), updatedJobs: jobs.rows.length });
    return { updatedJobs: jobs.rows.length };
  });
  return c.json(out);
});

// ---------------------------------------------------------------- resources
const resourceInput = z.object({
  kind: z.enum(['truck', 'equipment', 'unit']), name: z.string().trim().min(1, 'Enter a name').max(80),
  identifier: z.string().max(60).optional(), capacity: z.string().max(60).optional(),
  /** What it holds as a number and unit (3000 gal); read from the capacity text when not given. */
  capacityQuantity: z.number().min(0).max(1_000_000).nullable().optional(), capacityUnit: z.string().max(20).optional(),
  status: z.enum(['available', 'in_service', 'out_of_service', 'retired']).optional(), notes: z.string().max(1000).optional(),
  /** Back in service on this day (shown to dispatch; the truck returns to "Available" then). */
  outOfServiceUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** The person confirmed taking a truck with open jobs out of service. */
  confirmJobs: z.boolean().optional(),
  /** The kinds of work it is for (fuel, septic, portable_toilet); empty means any (R11-m5). */
  categories: z.array(z.enum(['fuel', 'portable_toilet', 'septic', 'other'])).max(4).optional(),
});

/** Two trucks or units with the same name make assignment ambiguous (R11-m5). */
async function uniqueName(q: Q, companyId: string, name: string, exceptId: string | null) {
  const { rows } = await q.query(`select 1 from rigo.resources where company_id = $1 and lower(name) = lower($2) and ($3::uuid is null or id <> $3) limit 1`, [companyId, name.trim(), exceptId]);
  if (rows.length) throw badRequest(`Something is already called "${name.trim()}". Use a different name, like "${name.trim()} 2".`, { fields: { name: 'Name already used' } });
}

/** Trucks whose "out of service until" day has passed are available again. */
export async function returnToService(q: Q, companyId: string, today: string) {
  await q.query(`update rigo.resources set status = 'available', out_of_service_until = null where company_id = $1 and status = 'out_of_service' and out_of_service_until is not null and out_of_service_until <= $2`, [companyId, today]);
}

recordRoutes.get('/resources', async (c) => {
  const cc = c.get('cc');
  need(cc, 'resources.view');
  await returnToService(cc.db, cc.company.id, localDate(new Date(), cc.company.timezone));
  const { rows } = await cc.db.query(`select r.*, p.name as plan_name, (select count(*)::int from rigo.job_resources jr join rigo.jobs j on j.id = jr.job_id where jr.resource_id = r.id and j.status in ('open','in_progress')) as open_jobs,
      exists (select 1 from rigo.job_resources jr where jr.resource_id = r.id) or r.plan_id is not null as used
      from rigo.resources r left join rigo.recurring_plans p on p.id = r.plan_id where r.company_id = $1 order by r.kind, r.name`, [cc.company.id]);
  return c.json({ resources: rows });
});

recordRoutes.post('/resources', async (c) => {
  const cc = c.get('cc');
  need(cc, 'resources.edit');
  const input = await body(c, resourceInput);
  const cap = input.capacityQuantity !== undefined ? { quantity: input.capacityQuantity, unit: input.capacityUnit ?? '' } : parseCapacity(input.capacity ?? '');
  const out = await cc.db.tx(async (q) => {
    await uniqueName(q, cc.company.id, input.name, null);
    const { rows } = await q.query<{ id: string }>(`insert into rigo.resources (company_id, kind, name, identifier, capacity, status, notes, capacity_quantity, capacity_unit, out_of_service_until, categories) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [cc.company.id, input.kind, input.name, input.identifier ?? '', input.capacity ?? '', input.status ?? 'available', input.notes ?? '', cap.quantity, cap.unit, input.status === 'out_of_service' ? input.outOfServiceUntil ?? null : null, input.categories ?? []]);
    return { id: rows[0].id };
  });
  return c.json(out);
});

/**
 * Edit a truck or unit. Taking one out of service while open jobs use it needs a confirmation that
 * names those jobs, and dispatch is told so they can swap the truck (R11-M1).
 */
recordRoutes.patch('/resources/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'resources.edit');
  const input = await body(c, resourceInput.partial());
  const cap = input.capacityQuantity !== undefined ? { quantity: input.capacityQuantity, unit: input.capacityUnit ?? '' } : input.capacity !== undefined ? parseCapacity(input.capacity) : null;
  const out = await cc.db.tx(async (q) => {
    const r = (await q.query<any>(`select * from rigo.resources where id = $1 and company_id = $2 for update`, [c.req.param('id'), cc.company.id])).rows[0];
    if (!r) throw notFound('Resource');
    if (input.name !== undefined) await uniqueName(q, cc.company.id, input.name, r.id);
    const goingOut = (input.status === 'out_of_service' || input.status === 'retired') && r.status !== input.status;
    const jobs = goingOut ? (await q.query<any>(`select j.id, j.number, j.scheduled_start from rigo.job_resources jr join rigo.jobs j on j.id = jr.job_id where jr.resource_id = $1 and j.status in ('open','in_progress') order by j.scheduled_start nulls last`, [r.id])).rows : [];
    if (jobs.length && !input.confirmJobs) {
      throw conflict(`${jobs.length} open job${jobs.length === 1 ? ' uses' : 's use'} ${r.name}.`, { needsConfirm: 'jobs', jobs: jobs.map((j) => ({ id: j.id, number: j.number, scheduledStart: j.scheduled_start })) });
    }
    const status = input.status ?? r.status;
    const until = status === 'out_of_service' ? (input.outOfServiceUntil !== undefined ? input.outOfServiceUntil : r.out_of_service_until) : null;
    await q.query(`update rigo.resources set kind = coalesce($3,kind), name = coalesce($4,name), identifier = coalesce($5,identifier), capacity = coalesce($6,capacity), status = $7, notes = coalesce($8,notes),
        capacity_quantity = case when $9 then $10 else capacity_quantity end, capacity_unit = case when $9 then $11 else capacity_unit end, out_of_service_until = $12, categories = coalesce($13, categories) where id = $1 and company_id = $2`,
      [r.id, cc.company.id, input.kind ?? null, input.name ?? null, input.identifier ?? null, input.capacity ?? null, status, input.notes ?? null, !!cap, cap?.quantity ?? null, cap?.unit ?? '', until, input.categories ?? null]);
    if (goingOut) {
      await audit(q, cc, 'resource.out_of_service', { id: r.id, name: r.name, status, until, openJobs: jobs.length });
      if (jobs.length) {
        await notifyPermission(q, cc.company.id, 'jobs.assign', { category: 'needs_action', title: `${r.name} is ${status === 'retired' ? 'retired' : 'out of service'}: ${jobs.length} open job${jobs.length === 1 ? '' : 's'} use it`,
          body: 'Swap the truck on those jobs.', link: `jobs?resource=${r.id}`, refType: 'resource_out', refId: r.id, dedupeKey: `resource-out:${r.id}:${new Date().toISOString().slice(0, 10)}` });
      }
    }
    return { ok: true, openJobs: jobs.length };
  });
  return c.json(out);
});

/** A truck or unit never used on a job or plan can be deleted; used ones are retired instead. */
recordRoutes.delete('/resources/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'resources.edit');
  await cc.db.tx(async (q) => {
    const r = (await q.query<any>(`select * from rigo.resources where id = $1 and company_id = $2 for update`, [c.req.param('id'), cc.company.id])).rows[0];
    if (!r) throw notFound('Resource');
    const used = (await q.query(`select 1 from rigo.job_resources where resource_id = $1 limit 1`, [r.id])).rows.length > 0 || !!r.plan_id;
    if (used) throw conflict(`${r.name} has been used on jobs, so it is kept for history. Mark it Retired instead.`);
    await q.query(`delete from rigo.resources where id = $1`, [r.id]);
    await audit(q, cc, 'resource.deleted', { id: r.id, name: r.name });
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- services
export function serializeService(cc: CompanyCtx, s: any) {
  const fin = can(cc, 'finance.view');
  return {
    id: s.id, name: s.name, category: s.category, description: s.description, fields: s.fields, active: s.active, version: s.version,
    requiresPhoto: s.requires_photo, requiresSignature: s.requires_signature, invoiceShowsNotes: !!s.invoice_shows_notes,
    // Rates are financial fields: removed from the response, not merely hidden, without finance.view.
    pricing: fin ? readPricing(s.pricing) : readPricing(s.pricing).map(({ rateE4, overageRateE4, minimumMinor, ...p }) => ({ ...p, rateSet: rateE4 !== null })),
    taxRateBp: fin ? s.tax_rate_bp : undefined,
  };
}

recordRoutes.get('/services', async (c) => {
  const cc = c.get('cc');
  const { rows } = await cc.db.query(`select * from rigo.services where company_id = $1 order by active desc, name`, [cc.company.id]);
  return c.json({ services: rows.map((s) => serializeService(cc, s)) });
});

recordRoutes.post('/services', async (c) => {
  const cc = c.get('cc');
  need(cc, 'services.manage');
  const input = await body(c, serviceInputSchema);
  const id = await insertService(cc.db, cc.company.id, input);
  await audit(cc.db, cc, 'service.created', { id, name: input.name });
  return c.json({ id });
});

recordRoutes.put('/services/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'services.manage', 'finance.view');
  const input = await body(c, z.object({ service: serviceInputSchema, version: z.number().int() }));
  const s = input.service;
  await cc.db.tx(async (q) => {
    const old = (await q.query<{ pricing: unknown }>(`select pricing from rigo.services where id = $1 and company_id = $2`, [c.req.param('id'), cc.company.id])).rows[0];
    // The server dates every rate change, so invoices can say "price on Oct 6" (WP1, D4).
    const pricing = datePriceChanges(readPricing(old?.pricing), s.pricing, localDate(new Date(), cc.company.timezone));
    const { rows } = await q.query(`update rigo.services set name=$3, category=$4, description=$5, fields=$6, pricing=$7, tax_rate_bp=$8, requires_photo=$9, requires_signature=$10, active=$11, invoice_shows_notes=$13, version = version + 1
        where id = $1 and company_id = $2 and version = $12 returning id`,
      [c.req.param('id'), cc.company.id, s.name, s.category, s.description, JSON.stringify(s.fields), JSON.stringify(storedPricing(pricing)), s.taxRateBp, s.requiresPhoto, s.requiresSignature, s.active, input.version, s.invoiceShowsNotes]);
    if (!rows.length) throw conflict('This service was changed by someone else. Reload and try again.');
    // Held invoices waiting on this service's pricing are rebuilt with the new rates. Issued invoices never change.
    const held = await q.query<{ id: string; job_id: string }>(`select i.id, i.job_id from rigo.invoices i join rigo.jobs j on j.id = i.job_id where j.service_id = $1 and i.company_id = $2 and i.status = 'held'`, [c.req.param('id'), cc.company.id]);
    for (const inv of held.rows) {
      await invalidateApprovalsFor(q, cc.company.id, 'invoice', inv.id);
      await rebuildHeldInvoice(q, inv.id);
    }
    await audit(q, cc, 'service.updated', { id: c.req.param('id'), heldInvoicesRecalculated: held.rows.length });
  });
  return c.json({ ok: true });
});
