import { Hono } from 'hono';
import { z } from 'zod';
import type { Q } from '../db/index.js';
import { type AppEnv, type CompanyCtx, need, audit, can } from '../http/context.js';
import { body, patchSchema } from '../lib/util.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { redactValues, mergeHidden, seesContact, seesMoney } from '../lib/redact.js';
import { cleanValues, wordsOf } from '../../shared/workspace.js';
import { similarNames, fold, digits } from '../../shared/customers.js';
import { loadFields } from './workspaces.js';
import { localDate } from '../../shared/schedule.js';

// Customers (each workspace names them): contacts, places and history. A customer's page leads
// with the next visit and what they owe. Contact details are removed on the server for roles
// without contact access; amounts for roles without money access.

export const customerRoutes = new Hono<AppEnv>();

const uuid = z.string().uuid('Choose one from the list');
const optText = (max: number) => z.string().trim().max(max, `Use ${max} characters or fewer.`);
const emailText = z.string().trim().max(254).email('Enter a valid email address.').or(z.literal('')).optional();
const phoneText = optText(40).optional();

export const placeSchema = z.object({
  label: optText(60).default(''),
  address: z.string().trim().min(1, 'Enter the address').max(300, 'Use 300 characters or fewer.'),
  notes: optText(1000).default(''),
});
const contactSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(80, 'Use 80 characters or fewer.'),
  label: optText(40).default(''),
  email: emailText, phone: phoneText,
});
const customerSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120, 'Use 120 characters or fewer.'),
  email: emailText, phone: phoneText,
  notes: optText(2000).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  taxExempt: z.boolean().optional(),
});

/** A customer of this workspace, or 404: an id from another workspace is never found. */
export async function getClient(q: Q, companyId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Customer');
  const { rows } = await q.query<any>(`select * from rigo.clients where id = $1 and company_id = $2`, [id, companyId]);
  if (!rows[0]) throw notFound('Customer');
  return rows[0];
}

/** What each customer owes on issued invoices (null for people who can't see money). */
export async function owedByClient(q: Q, cc: CompanyCtx, clientIds: string[]) {
  const out = new Map<string, { owes: number; overdue: number }>();
  if (!seesMoney(cc) || !clientIds.length) return out;
  const today = localDate(new Date(), cc.company.timezone);
  const { rows } = await q.query<{ client_id: string; owes: number; overdue: number }>(
    `select client_id, coalesce(sum(total_minor - paid_minor), 0)::bigint as owes,
            coalesce(sum(total_minor - paid_minor) filter (where due_on < $3), 0)::bigint as overdue
       from rigo.money_invoices where company_id = $1 and client_id = any($2) and status = 'issued' and payment_status <> 'paid' group by client_id`,
    [cc.company.id, clientIds, today]);
  for (const r of rows) out.set(r.client_id, { owes: Number(r.owes), overdue: Number(r.overdue) });
  return out;
}

/** Next open or active visit per customer. */
async function nextVisits(q: Q, companyId: string, clientIds: string[]) {
  if (!clientIds.length) return new Map<string, { id: string; number: number; title: string; starts_at: string }>();
  const { rows } = await q.query<any>(
    `select distinct on (w.client_id) w.client_id, w.id, w.number, w.title, w.starts_at from rigo.work_items w join rigo.stages s on s.id = w.stage_id
      where w.company_id = $1 and w.client_id = any($2) and s.meaning in ('open','active') and w.starts_at >= now() - interval '12 hours'
      order by w.client_id, w.starts_at`, [companyId, clientIds]);
  return new Map(rows.map((r) => [r.client_id, { id: r.id, number: r.number, title: r.title, starts_at: r.starts_at }]));
}

function shapeClient(cc: CompanyCtx, defs: any, c: any) {
  const contact = seesContact(cc);
  return {
    id: c.id, name: c.name, notes: c.notes, archived_at: c.archived_at, version: c.version, created_at: c.created_at,
    email: contact ? c.email : undefined, phone: contact ? c.phone : undefined,
    taxExempt: seesMoney(cc) ? c.tax_exempt : undefined,
    fields: redactValues(cc, defs, c.fields),
  };
}

customerRoutes.get('/customers', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.view');
  const q = (c.req.query('q') ?? '').trim().slice(0, 100);
  const archived = c.req.query('archived') === '1';
  const vals: unknown[] = [cc.company.id];
  let where = `c.company_id = $1 and c.archived_at is ${archived ? 'not null' : 'null'}`;
  if (q) {
    vals.push(`%${fold(q)}%`);
    // Phone digits match only for people who can see phone numbers.
    let phone = '';
    if (seesContact(cc) && digits(q).length >= 3) { vals.push(`%${digits(q)}%`); phone = ` or regexp_replace(coalesce(c.phone,''), '[^0-9]', '', 'g') like $${vals.length}`; }
    where += ` and (translate(lower(c.name), 'áàâäãåéèêëíìîïóòôöõúùûüñç', 'aaaaaaeeeeiiiiooooouuuunc') like $2 or exists (select 1 from rigo.client_places p where p.client_id = c.id and lower(p.address) like $2)${phone})`;
  }
  const { rows } = await cc.db.query<any>(
    `select c.*, (select p.address from rigo.client_places p where p.client_id = c.id order by p.created_at limit 1) as address,
            (select count(*)::int from rigo.client_places p where p.client_id = c.id) as places
       from rigo.clients c where ${where} order by lower(c.name) limit 500`, vals);
  const { fields } = await loadFields(cc.db, cc.company.id);
  const ids = rows.map((r) => r.id);
  const owed = await owedByClient(cc.db, cc, ids);
  const next = await nextVisits(cc.db, cc.company.id, ids);
  return c.json({
    customers: rows.map((r) => ({ ...shapeClient(cc, fields.customer, r), address: r.address, places: r.places, next: next.get(r.id) ?? null,
      owesMinor: seesMoney(cc) ? owed.get(r.id)?.owes ?? 0 : undefined, overdueMinor: seesMoney(cc) ? owed.get(r.id)?.overdue ?? 0 : undefined })),
  });
});

/** Possible duplicates by name, phone or email; contact details are compared only for people who can see them. */
async function duplicates(q: Q, cc: CompanyCtx, input: { name: string; email?: string; phone?: string }, exceptId?: string) {
  const { rows } = await q.query<any>(`select id, name, email, phone from rigo.clients where company_id = $1 and archived_at is null and id is distinct from $2`, [cc.company.id, exceptId ?? null]);
  const contact = seesContact(cc);
  return rows.filter((r) => similarNames(r.name, input.name)
    || (contact && input.email && r.email && r.email.toLowerCase() === input.email.toLowerCase())
    || (contact && input.phone && digits(input.phone).length >= 7 && digits(r.phone) === digits(input.phone)))
    .slice(0, 5).map((r) => ({ id: r.id, name: r.name }));
}

customerRoutes.post('/customers', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.edit');
  const input = await body(c, customerSchema.extend({ place: placeSchema.optional(), allowDuplicate: z.boolean().default(false) }));
  const { fields } = await loadFields(cc.db, cc.company.id);
  const clean = cleanValues(fields.customer, mergeHidden(cc, fields.customer, {}, input.fields ?? {}, 'customer'));
  if (Object.keys(clean.problems).length) throw badRequest('Some information needs attention.', { fields: Object.fromEntries(Object.entries(clean.problems).map(([k, v]) => [`fields.${k}`, v])) });
  const id = await cc.db.tx(async (q) => {
    if (!input.allowDuplicate) {
      const dups = await duplicates(q, cc, input);
      if (dups.length) throw conflict(`You may already have ${dups[0].name}. Add a new ${wordsOf(cc.company.vocabulary).customer.one.toLowerCase()} anyway?`, { needsConfirm: 'duplicate', duplicates: dups });
    }
    const { rows } = await q.query<{ id: string }>(
      `insert into rigo.clients (company_id, name, email, phone, notes, fields, tax_exempt, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [cc.company.id, input.name, seesContact(cc) ? input.email || null : null, seesContact(cc) ? input.phone || null : null, input.notes ?? '',
        JSON.stringify(clean.values), can(cc, 'money.view') ? !!input.taxExempt : false, cc.user.id]);
    if (input.place) await q.query(`insert into rigo.client_places (company_id, client_id, label, address, notes) values ($1,$2,$3,$4,$5)`, [cc.company.id, rows[0].id, input.place.label, input.place.address, input.place.notes]);
    await audit(q, cc, 'customer.created', { id: rows[0].id, name: input.name });
    return rows[0].id;
  });
  return c.json({ id });
});

customerRoutes.get('/customers/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.view');
  const row = await getClient(cc.db, cc.company.id, c.req.param('id'));
  const { fields } = await loadFields(cc.db, cc.company.id);
  const places = (await cc.db.query(`select id, label, address, notes from rigo.client_places where client_id = $1 and company_id = $2 order by created_at`, [row.id, cc.company.id])).rows;
  const contact = seesContact(cc);
  const contacts = (await cc.db.query<any>(`select id, name, label, email, phone from rigo.client_contacts where client_id = $1 and company_id = $2 order by created_at`, [row.id, cc.company.id])).rows
    .map((x) => ({ ...x, email: contact ? x.email : undefined, phone: contact ? x.phone : undefined }));
  const history = (await cc.db.query<any>(
    `select w.id, w.number, w.title, w.starts_at, w.closed_at, w.billing, s.name as stage_name, s.meaning, p.address
       from rigo.work_items w join rigo.stages s on s.id = w.stage_id left join rigo.client_places p on p.id = w.place_id
      where w.company_id = $1 and w.client_id = $2 order by coalesce(w.starts_at, w.created_at) desc limit 100`, [cc.company.id, row.id])).rows;
  const next = (await nextVisits(cc.db, cc.company.id, [row.id])).get(row.id) ?? null;
  const owed = (await owedByClient(cc.db, cc, [row.id])).get(row.id);
  const invoices = seesMoney(cc)
    ? (await cc.db.query(`select id, number, status, total_minor, paid_minor, payment_status, due_on, issued_on from rigo.money_invoices where company_id = $1 and client_id = $2 and status <> 'void' order by created_at desc limit 50`, [cc.company.id, row.id])).rows
    : undefined;
  return c.json({
    customer: shapeClient(cc, fields.customer, row), places, contacts, history, next, invoices,
    owesMinor: seesMoney(cc) ? owed?.owes ?? 0 : undefined, overdueMinor: seesMoney(cc) ? owed?.overdue ?? 0 : undefined,
  });
});

customerRoutes.patch('/customers/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.edit');
  const input = await body(c, patchSchema(customerSchema.extend({ version: z.number().int() })));
  await cc.db.tx(async (q) => {
    const row = await getClient(q, cc.company.id, c.req.param('id'));
    if (row.version !== input.version) throw conflict('Someone else changed this customer. Reload to see their changes.', { stale: true });
    const { fields } = await loadFields(q, cc.company.id);
    let values = row.fields;
    if (input.fields) {
      const clean = cleanValues(fields.customer, mergeHidden(cc, fields.customer, row.fields, input.fields, 'customer'));
      if (Object.keys(clean.problems).length) throw badRequest('Some information needs attention.', { fields: Object.fromEntries(Object.entries(clean.problems).map(([k, v]) => [`fields.${k}`, v])) });
      values = clean.values;
    }
    const contact = seesContact(cc);
    await q.query(`update rigo.clients set name = coalesce($3, name), email = $4, phone = $5, notes = coalesce($6, notes), fields = $7, tax_exempt = $8,
        version = version + 1, updated_at = now() where id = $1 and company_id = $2`,
      [row.id, cc.company.id, input.name ?? null, contact && input.email !== undefined ? input.email || null : row.email, contact && input.phone !== undefined ? input.phone || null : row.phone,
        input.notes ?? null, JSON.stringify(values), seesMoney(cc) && input.taxExempt !== undefined ? input.taxExempt : row.tax_exempt]);
    await audit(q, cc, 'customer.updated', { id: row.id });
  });
  return c.json({ ok: true });
});

for (const [action, value] of [['archive', 'now()'], ['unarchive', 'null']] as const) {
  customerRoutes.post(`/customers/:id/${action}`, async (c) => {
    const cc = c.get('cc');
    need(cc, 'customers.edit');
    const row = await getClient(cc.db, cc.company.id, c.req.param('id'));
    await cc.db.query(`update rigo.clients set archived_at = ${value}, version = version + 1 where id = $1 and company_id = $2`, [row.id, cc.company.id]);
    await audit(cc.db, cc, `customer.${action}d`, { id: row.id });
    return c.json({ ok: true });
  });
}

customerRoutes.post('/customers/:id/places', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.edit');
  const input = await body(c, placeSchema);
  const row = await getClient(cc.db, cc.company.id, c.req.param('id'));
  const { rows } = await cc.db.query<{ id: string }>(`insert into rigo.client_places (company_id, client_id, label, address, notes) values ($1,$2,$3,$4,$5) returning id`, [cc.company.id, row.id, input.label, input.address, input.notes]);
  return c.json({ id: rows[0].id });
});

customerRoutes.patch('/customers/:id/places/:pid', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.edit');
  const input = await body(c, patchSchema(placeSchema));
  const row = await getClient(cc.db, cc.company.id, c.req.param('id'));
  const { rows } = await cc.db.query(`update rigo.client_places set label = coalesce($4, label), address = coalesce($5, address), notes = coalesce($6, notes)
      where id = $1 and client_id = $2 and company_id = $3 returning id`, [c.req.param('pid'), row.id, cc.company.id, input.label ?? null, input.address ?? null, input.notes ?? null]);
  if (!rows.length) throw notFound('Place');
  return c.json({ ok: true });
});

customerRoutes.delete('/customers/:id/places/:pid', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.edit');
  const row = await getClient(cc.db, cc.company.id, c.req.param('id'));
  const used = await cc.db.query(`select 1 from rigo.work_items where company_id = $1 and place_id = $2 limit 1`, [cc.company.id, c.req.param('pid')]);
  if (used.rows.length) throw conflict('Work was done at this place, so it stays in the history. Edit it instead.');
  const { rows } = await cc.db.query(`delete from rigo.client_places where id = $1 and client_id = $2 and company_id = $3 returning id`, [c.req.param('pid'), row.id, cc.company.id]);
  if (!rows.length) throw notFound('Place');
  return c.json({ ok: true });
});

customerRoutes.post('/customers/:id/contacts', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.edit', 'customers.contact');
  const input = await body(c, contactSchema);
  const row = await getClient(cc.db, cc.company.id, c.req.param('id'));
  const { rows } = await cc.db.query<{ id: string }>(`insert into rigo.client_contacts (company_id, client_id, name, label, email, phone) values ($1,$2,$3,$4,$5,$6) returning id`,
    [cc.company.id, row.id, input.name, input.label, input.email || null, input.phone || null]);
  return c.json({ id: rows[0].id });
});

customerRoutes.delete('/customers/:id/contacts/:kid', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.edit', 'customers.contact');
  const row = await getClient(cc.db, cc.company.id, c.req.param('id'));
  const { rows } = await cc.db.query(`delete from rigo.client_contacts where id = $1 and client_id = $2 and company_id = $3 returning id`, [c.req.param('kid'), row.id, cc.company.id]);
  if (!rows.length) throw notFound('Contact');
  return c.json({ ok: true });
});

export { uuid };
