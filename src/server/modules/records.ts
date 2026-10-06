import { Hono } from 'hono';
import { z } from 'zod';
import { type AppEnv, type CompanyCtx, need, can, audit } from '../http/context.js';
import { body } from '../lib/util.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { customFieldsSchema, validateValues, serviceInputSchema } from '../../shared/services.js';
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
    notes: r.notes, custom: r.custom, version: r.version, createdAt: r.created_at, locationCount: r.location_count, openJobs: r.open_jobs, contactHidden: !contact };
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

const customerInput = z.object({
  name: z.string().trim().min(1, 'Enter the customer name').max(120),
  email: z.string().trim().max(254).email('Enter a valid email').or(z.literal('')).optional(),
  phone: z.string().trim().max(40).optional(),
  billingAddress: z.string().trim().max(300).optional(),
  notes: z.string().max(2000).optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
  version: z.number().int().optional(),
  location: z.object({ label: z.string().max(80).optional(), address: z.string().trim().min(1, 'Enter the service address').max(300), accessInstructions: z.string().max(1000).optional(), siteContact: z.string().max(200).optional() }).optional(),
});

recordRoutes.post('/customers', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.edit');
  const input = await body(c, customerInput);
  const custom = validateValues(customDefs(cc, 'customers'), input.custom ?? {}, { enforceRequired: true });
  if (Object.keys(custom.errors).length) throw badRequest('Some information needs attention.', { fields: Object.fromEntries(Object.entries(custom.errors).map(([k, v]) => [`custom.${k}`, v])) });
  const id = await cc.db.tx(async (q) => {
    const { rows } = await q.query<{ id: string }>(`insert into rigo.customers (company_id, name, email, phone, billing_address, notes, custom) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [cc.company.id, input.name, input.email || null, input.phone || null, input.billingAddress || null, input.notes ?? '', JSON.stringify(custom.clean)]);
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
  const custom = input.custom ? validateValues(customDefs(cc, 'customers'), input.custom, { enforceRequired: true }) : null;
  if (custom && Object.keys(custom.errors).length) throw badRequest('Some information needs attention.', { fields: custom.errors });
  const contact = can(cc, 'customers.contact');
  const { rows } = await cc.db.query(
    `update rigo.customers set name = coalesce($3, name),
        email = case when $9 then coalesce($4, email) else email end, phone = case when $9 then coalesce($5, phone) else phone end,
        billing_address = case when $9 then coalesce($6, billing_address) else billing_address end,
        notes = coalesce($7, notes), custom = coalesce($8::jsonb, custom), version = version + 1, updated_at = now()
      where id = $1 and company_id = $2 and version = $10 returning id`,
    [c.req.param('id'), cc.company.id, input.name ?? null, input.email ?? null, input.phone ?? null, input.billingAddress ?? null, input.notes ?? null, custom ? JSON.stringify(custom.clean) : null, contact, input.version]);
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
  const { rows } = await cc.db.query<{ id: string }>(`insert into rigo.resources (company_id, kind, name, identifier, capacity, status, notes) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [cc.company.id, input.kind, input.name, input.identifier ?? '', input.capacity ?? '', input.status ?? 'available', input.notes ?? '']);
  return c.json({ id: rows[0].id });
});

recordRoutes.patch('/resources/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'resources.edit');
  const input = await body(c, resourceInput.partial());
  const { rows } = await cc.db.query(`update rigo.resources set kind = coalesce($3,kind), name = coalesce($4,name), identifier = coalesce($5,identifier), capacity = coalesce($6,capacity), status = coalesce($7,status), notes = coalesce($8,notes) where id = $1 and company_id = $2 returning id`,
    [c.req.param('id'), cc.company.id, input.kind ?? null, input.name ?? null, input.identifier ?? null, input.capacity ?? null, input.status ?? null, input.notes ?? null]);
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
    pricing: fin ? s.pricing : (s.pricing as any[]).map(({ rateMinor, ...p }) => ({ ...p, rateMinor: undefined, rateSet: rateMinor !== null })),
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
    const { rows } = await q.query(`update rigo.services set name=$3, category=$4, description=$5, fields=$6, pricing=$7, tax_rate_bp=$8, requires_photo=$9, requires_signature=$10, active=$11, version = version + 1
        where id = $1 and company_id = $2 and version = $12 returning id`,
      [c.req.param('id'), cc.company.id, s.name, s.category, s.description, JSON.stringify(s.fields), JSON.stringify(s.pricing), s.taxRateBp, s.requiresPhoto, s.requiresSignature, s.active, input.version]);
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
