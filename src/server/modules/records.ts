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

// Customers, service locations, resources (trucks/equipment) and service definitions.

export const recordRoutes = new Hono<AppEnv>();

function customDefs(cc: CompanyCtx, kind: 'customers' | 'locations' | 'jobs') {
  return customFieldsSchema.parse(cc.company.settings?.customFields ?? {})[kind];
}

function serializeCustomer(cc: CompanyCtx, r: any) {
  const contact = can(cc, 'customers.contact');
  return { id: r.id, name: r.name, email: contact ? r.email : undefined, phone: contact ? r.phone : undefined, billingAddress: contact ? r.billing_address : undefined,
    notes: r.notes, custom: r.custom, version: r.version, createdAt: r.created_at, locationCount: r.location_count, openJobs: r.open_jobs, contactHidden: !contact,
    taxExempt: !!r.tax_exempt, taxExemptNote: r.tax_exempt_note ?? '',
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
  const locations = await cc.db.query(`select * from rigo.locations where customer_id = $1 and company_id = $2 order by created_at`, [c.req.param('id'), cc.company.id]);
  const jobs = await cc.db.query(`select j.id, j.number, j.status, j.scheduled_start, s.name as service_name from rigo.jobs j left join rigo.services s on s.id = j.service_id where j.customer_id = $1 and j.company_id = $2 order by j.created_at desc limit 50`, [c.req.param('id'), cc.company.id]);
  const invoices = can(cc, 'invoices.view') ? (await cc.db.query(`select id, number, status, ${can(cc, 'finance.view') ? 'total_minor' : 'null as total_minor'}, currency, created_at from rigo.invoices where customer_id = $1 and company_id = $2 order by created_at desc limit 50`, [c.req.param('id'), cc.company.id])).rows : null;
  const messages = can(cc, 'messages.view') ? (await cc.db.query(`select id, channel, subject, status, created_at from rigo.messages where customer_id = $1 and company_id = $2 order by created_at desc limit 50`, [c.req.param('id'), cc.company.id])).rows : null;
  return c.json({ customer: serializeCustomer(cc, rows[0]), locations: locations.rows, jobs: jobs.rows, invoices, messages, customFields: { customers: customDefs(cc, 'customers'), locations: customDefs(cc, 'locations') } });
});

/** Tax exemption and customer prices are billing decisions: they need invoice editing and finance access. */
function billingFieldsAllowed(cc: CompanyCtx, input: { taxExempt?: boolean; taxExemptNote?: string; priceOverrides?: unknown }) {
  if (input.priceOverrides !== undefined) need(cc, 'finance.view', 'invoices.edit');
  if (input.taxExempt !== undefined || input.taxExemptNote !== undefined) need(cc, 'invoices.edit');
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
    const { rows } = await q.query<{ id: string }>(`insert into rigo.customers (company_id, name, email, phone, billing_address, notes, custom, tax_exempt, tax_exempt_note, price_overrides) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [cc.company.id, input.name, input.email || null, input.phone || null, input.billingAddress || null, input.notes ?? '', JSON.stringify(custom.clean), !!input.taxExempt, input.taxExemptNote ?? '', JSON.stringify(overrides)]);
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
        price_overrides = coalesce($13::jsonb, price_overrides), version = version + 1, updated_at = now()
      where id = $1 and company_id = $2 and version = $10 returning id`,
    [c.req.param('id'), cc.company.id, input.name ?? null, input.email ?? null, input.phone ?? null, input.billingAddress ?? null, input.notes ?? null, custom ? JSON.stringify(custom.clean) : null, contact, input.version,
      input.taxExempt ?? null, input.taxExemptNote ?? null, overrides ? JSON.stringify(overrides) : null]);
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
  const input = await body(c, locationInput.partial());
  const { rows } = await cc.db.query(`update rigo.locations set label = coalesce($3,label), address = coalesce($4,address), access_instructions = coalesce($5,access_instructions), site_contact = coalesce($6,site_contact) where id = $1 and company_id = $2 returning id`,
    [c.req.param('id'), cc.company.id, input.label ?? null, input.address ?? null, input.accessInstructions ?? null, input.siteContact ?? null]);
  if (!rows.length) throw notFound('Location');
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- resources
const resourceInput = z.object({
  kind: z.enum(['truck', 'equipment', 'unit']), name: z.string().trim().min(1, 'Enter a name').max(80),
  identifier: z.string().max(60).optional(), capacity: z.string().max(60).optional(),
  /** What it holds as a number and unit (3000 gal); read from the capacity text when not given. */
  capacityQuantity: z.number().min(0).max(1_000_000).nullable().optional(), capacityUnit: z.string().max(20).optional(),
  status: z.enum(['available', 'in_service', 'out_of_service', 'retired']).optional(), notes: z.string().max(1000).optional(),
});

recordRoutes.get('/resources', async (c) => {
  const cc = c.get('cc');
  need(cc, 'resources.view');
  const { rows } = await cc.db.query(`select r.*, (select count(*)::int from rigo.job_resources jr join rigo.jobs j on j.id = jr.job_id where jr.resource_id = r.id and j.status in ('open','in_progress')) as open_jobs from rigo.resources r where company_id = $1 order by kind, name`, [cc.company.id]);
  return c.json({ resources: rows });
});

recordRoutes.post('/resources', async (c) => {
  const cc = c.get('cc');
  need(cc, 'resources.edit');
  const input = await body(c, resourceInput);
  const cap = input.capacityQuantity !== undefined ? { quantity: input.capacityQuantity, unit: input.capacityUnit ?? '' } : parseCapacity(input.capacity ?? '');
  const { rows } = await cc.db.query<{ id: string }>(`insert into rigo.resources (company_id, kind, name, identifier, capacity, status, notes, capacity_quantity, capacity_unit) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [cc.company.id, input.kind, input.name, input.identifier ?? '', input.capacity ?? '', input.status ?? 'available', input.notes ?? '', cap.quantity, cap.unit]);
  return c.json({ id: rows[0].id });
});

recordRoutes.patch('/resources/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'resources.edit');
  const input = await body(c, resourceInput.partial());
  const cap = input.capacityQuantity !== undefined ? { quantity: input.capacityQuantity, unit: input.capacityUnit ?? '' } : input.capacity !== undefined ? parseCapacity(input.capacity) : null;
  const { rows } = await cc.db.query(`update rigo.resources set kind = coalesce($3,kind), name = coalesce($4,name), identifier = coalesce($5,identifier), capacity = coalesce($6,capacity), status = coalesce($7,status), notes = coalesce($8,notes),
      capacity_quantity = case when $9 then $10 else capacity_quantity end, capacity_unit = case when $9 then $11 else capacity_unit end where id = $1 and company_id = $2 returning id`,
    [c.req.param('id'), cc.company.id, input.kind ?? null, input.name ?? null, input.identifier ?? null, input.capacity ?? null, input.status ?? null, input.notes ?? null, !!cap, cap?.quantity ?? null, cap?.unit ?? '']);
  if (!rows.length) throw notFound('Resource');
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- services
export function serializeService(cc: CompanyCtx, s: any) {
  const fin = can(cc, 'finance.view');
  return {
    id: s.id, name: s.name, category: s.category, description: s.description, fields: s.fields, active: s.active, version: s.version,
    requiresPhoto: s.requires_photo, requiresSignature: s.requires_signature,
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
    const { rows } = await q.query(`update rigo.services set name=$3, category=$4, description=$5, fields=$6, pricing=$7, tax_rate_bp=$8, requires_photo=$9, requires_signature=$10, active=$11, version = version + 1
        where id = $1 and company_id = $2 and version = $12 returning id`,
      [c.req.param('id'), cc.company.id, s.name, s.category, s.description, JSON.stringify(s.fields), JSON.stringify(storedPricing(pricing)), s.taxRateBp, s.requiresPhoto, s.requiresSignature, s.active, input.version]);
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
