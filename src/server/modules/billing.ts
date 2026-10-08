import { Hono } from 'hono';
import { z } from 'zod';
import type { Q } from '../db/index.js';
import { type AppEnv, type CompanyCtx, need, needAny, audit, can } from '../http/context.js';
import { body, patchSchema } from '../lib/util.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { seesMoney } from '../lib/redact.js';
import { priceLines, computeTotals, parseRate, parseMoney, formatInvoiceNumber, formatMoney, type LineInput } from '../../shared/money.js';
import { dueDateFor, agingBucket, AGING_BUCKETS, paymentState, balanceDue, daysBetween } from '../../shared/invoices.js';
import { localDate } from '../../shared/schedule.js';
import { wordsOf } from '../../shared/workspace.js';
import { notifyPermission, resolveNotices } from './notify.js';

// Money: the price list, invoices built from finished work with exact totals, holds when a price is
// missing, approval, issuing, payments and what is owed by age. Amounts never reach a role without
// money access. AI never computes any of it.

export const billingRoutes = new Hono<AppEnv>();

const uuid = z.string().uuid('Choose one from the list');
const today = (cc: CompanyCtx) => localDate(new Date(), cc.company.timezone);

function needMoney(cc: CompanyCtx) {
  if (!seesMoney(cc)) throw forbidden(`Your role (${cc.roleName}) can't see amounts.`);
}

// ---------------------------------------------------------------- price list

const catalogSchema = z.object({
  name: z.string().trim().min(1, 'Name it').max(80, 'Use 80 characters or fewer.'),
  unit: z.string().trim().max(20).default(''),
  /** "45" or "3.8995"; empty: no price yet (invoices using it are held). */
  rate: z.string().max(20).nullable().default(null),
  taxable: z.boolean().default(false),
  active: z.boolean().default(true),
});

function rateOf(input: string | null | undefined) {
  if (input === null || input === undefined || input.trim() === '') return null;
  const r = parseRate(input);
  if (r === null) throw badRequest('Enter a price like 45 or 3.8995.', { fields: { rate: 'Enter a price like 45 or 3.8995' } });
  return r;
}

billingRoutes.get('/catalog', async (c) => {
  const cc = c.get('cc');
  needAny(cc, 'work.create', 'work.edit', 'catalog.manage', 'invoices.manage');
  const { rows } = await cc.db.query<any>(`select id, name, unit, rate_e4, taxable, active, position from rigo.catalog_items where company_id = $1 order by active desc, position, name`, [cc.company.id]);
  const money = seesMoney(cc);
  return c.json({ items: rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit, taxable: r.taxable, active: r.active, priced: r.rate_e4 !== null, rateE4: money ? (r.rate_e4 === null ? null : Number(r.rate_e4)) : undefined })) });
});

billingRoutes.post('/catalog', async (c) => {
  const cc = c.get('cc');
  need(cc, 'catalog.manage');
  const input = await body(c, catalogSchema);
  const rate = rateOf(input.rate);
  const pos = (await cc.db.query<{ n: number }>(`select count(*)::int n from rigo.catalog_items where company_id = $1`, [cc.company.id])).rows[0].n;
  const { rows } = await cc.db.query<{ id: string }>(`insert into rigo.catalog_items (company_id, name, unit, rate_e4, taxable, active, position) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [cc.company.id, input.name, input.unit, rate, input.taxable, input.active, pos]);
  await audit(cc.db, cc, 'catalog.created', { name: input.name, rateE4: rate });
  return c.json({ id: rows[0].id });
});

billingRoutes.patch('/catalog/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'catalog.manage');
  const input = await body(c, patchSchema(catalogSchema));
  const sets: string[] = []; const vals: unknown[] = [c.req.param('id'), cc.company.id];
  const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (input.name !== undefined) add('name', input.name);
  if (input.unit !== undefined) add('unit', input.unit);
  if (input.rate !== undefined) add('rate_e4', rateOf(input.rate));
  if (input.taxable !== undefined) add('taxable', input.taxable);
  if (input.active !== undefined) add('active', input.active);
  if (!sets.length) return c.json({ ok: true });
  if (!/^[0-9a-f-]{36}$/i.test(c.req.param('id'))) throw notFound('Item');
  const { rows } = await cc.db.query(`update rigo.catalog_items set ${sets.join(', ')} where id = $1 and company_id = $2 returning id`, vals);
  if (!rows.length) throw notFound('Item');
  await audit(cc.db, cc, 'catalog.updated', { id: c.req.param('id'), ...input });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- invoice building

interface InvoiceLineRow { description: string; quantity: string; unit: string; rate_e4: number | null; taxable: boolean; work_id: string | null; catalog_id: string | null }

/** Prices the lines and works out the totals and holds. One rule for every invoice. */
export function priceInvoice(lines: InvoiceLineRow[], taxRateBp: number | null, taxExempt: boolean) {
  const priced = priceLines(lines.map((l): LineInput => ({ description: l.description, quantity: l.quantity, unit: l.unit, rateE4: l.rate_e4 === null ? null : Number(l.rate_e4), taxable: l.taxable })));
  const totals = computeTotals(priced.lines, taxRateBp, [], { taxExempt });
  const holds = [...new Set([...priced.holdReasons, ...totals.holdReasons.filter((h) => !/missing a rate or quantity/.test(h))])];
  if (totals.holdReasons.some((h) => /no tax rate is configured/.test(h))) {
    holds.splice(holds.indexOf(totals.holdReasons.find((h) => /no tax rate/.test(h))!), 1, 'Some lines are taxable but no tax rate is set. Set it in Money, Prices.');
  }
  return { lines: priced.lines, totals, holds };
}

async function writeInvoiceTotals(q: Q, cc: CompanyCtx, invoiceId: string) {
  const inv = (await q.query<any>(`select * from rigo.money_invoices where id = $1 and company_id = $2`, [invoiceId, cc.company.id])).rows[0];
  const lines = (await q.query<InvoiceLineRow & { id: string }>(`select * from rigo.money_invoice_lines where invoice_id = $1 order by position`, [invoiceId])).rows;
  const p = priceInvoice(lines, inv.tax_rate_bp, inv.tax_exempt);
  for (let i = 0; i < lines.length; i++) await q.query(`update rigo.money_invoice_lines set amount_minor = $2 where id = $1`, [lines[i].id, p.lines[i].amountMinor]);
  const held = p.holds.length > 0;
  // A change after approval needs approving again: the approval was for other amounts.
  const status = held ? 'held' : inv.status === 'held' || inv.status === 'approved' ? 'draft' : inv.status;
  await q.query(`update rigo.money_invoices set hold_reasons = $3, subtotal_minor = $4, tax_minor = $5, total_minor = $6, status = $7,
      approved_by = case when $7 = 'approved' then approved_by else null end, approved_at = case when $7 = 'approved' then approved_at else null end,
      version = version + 1, updated_at = now() where id = $1 and company_id = $2`,
    [invoiceId, cc.company.id, p.holds, held ? null : p.totals.subtotalMinor, held ? null : p.totals.taxMinor, held ? null : p.totals.totalMinor, status]);
  return { status, holds: p.holds };
}

/** Builds an invoice from finished work for one customer. Each piece of work is billed once. */
export async function prepareInvoice(q: Q, cc: CompanyCtx, workIds: string[], opts: { by?: 'person' | 'rigo' } = {}) {
  const words = wordsOf(cc.company.vocabulary);
  const { rows: work } = await q.query<any>(
    `select w.id, w.number, w.title, w.client_id, w.billing, s.meaning from rigo.work_items w join rigo.stages s on s.id = w.stage_id
      where w.company_id = $1 and w.id = any($2) for update of w`, [cc.company.id, workIds]);
  if (work.length !== new Set(workIds).size) throw badRequest(`Choose ${words.work.many.toLowerCase()} from this workspace.`);
  const clients = new Set(work.map((w) => w.client_id));
  if (clients.size !== 1 || !work[0].client_id) throw badRequest(`An invoice is for one ${words.customer.one.toLowerCase()}. Choose ${words.work.many.toLowerCase()} for the same ${words.customer.one.toLowerCase()}.`);
  for (const w of work) {
    if (w.billing === 'invoiced') throw conflict(`#${w.number} is already on an invoice.`);
    if (w.meaning !== 'finished' && w.meaning !== 'failed') throw badRequest(`#${w.number} isn't finished yet.`);
  }
  const co = (await q.query<any>(`select tax_rate_bp, terms_days, currency from rigo.companies where id = $1`, [cc.company.id])).rows[0];
  const client = (await q.query<any>(`select tax_exempt from rigo.clients where id = $1`, [work[0].client_id])).rows[0];
  const { rows } = await q.query<{ id: string }>(
    `insert into rigo.money_invoices (company_id, client_id, status, currency, tax_rate_bp, tax_exempt, terms_days, prepared_by, created_by)
     values ($1,$2,'draft',$3,$4,$5,$6,$7,$8) returning id`,
    [cc.company.id, work[0].client_id, co.currency, co.tax_rate_bp, client.tax_exempt, co.terms_days, opts.by ?? 'person', cc.user.id]);
  const id = rows[0].id;
  let pos = 0;
  for (const w of work.sort((a, b) => a.number - b.number)) {
    const lines = (await q.query<any>(`select * from rigo.work_lines where work_id = $1 order by position`, [w.id])).rows;
    for (const l of lines) {
      const description = work.length > 1 ? `#${w.number}: ${l.description}` : l.description;
      await q.query(`insert into rigo.money_invoice_lines (company_id, invoice_id, work_id, catalog_id, description, quantity, unit, rate_e4, taxable, position) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [cc.company.id, id, w.id, l.catalog_id, description, l.quantity, l.unit, l.rate_e4, l.taxable, pos++]);
    }
    await q.query(`insert into rigo.money_invoice_work (company_id, invoice_id, work_id) values ($1,$2,$3)`, [cc.company.id, id, w.id]);
    await q.query(`update rigo.work_items set billing = 'invoiced', version = version + 1, updated_at = now() where id = $1`, [w.id]);
    await q.query(`insert into rigo.work_history (company_id, work_id, type, actor_user_id, data) values ($1,$2,'invoiced',$3,$4)`, [cc.company.id, w.id, opts.by === 'rigo' ? null : cc.user.id, JSON.stringify({ invoiceId: id, by: opts.by ?? 'person' })]);
  }
  const r = await writeInvoiceTotals(q, cc, id);
  await audit(q, cc, 'invoice.prepared', { id, work: workIds, by: opts.by ?? 'person', status: r.status });
  return { id, ...r };
}

// ---------------------------------------------------------------- reading

function shapeInvoice(i: any, todayStr: string) {
  const ps = paymentState({ status: i.status, paymentStatus: i.payment_status, dueDate: i.due_on }, todayStr);
  return {
    id: i.id, number: i.number, status: i.status, holdReasons: i.hold_reasons, currency: i.currency,
    client: i.client_id ? { id: i.client_id, name: i.client_name } : null,
    subtotalMinor: i.subtotal_minor, taxMinor: i.tax_minor, totalMinor: i.total_minor, paidMinor: Number(i.paid_minor),
    balanceMinor: balanceDue({ totalMinor: i.total_minor === null ? null : Number(i.total_minor), paidMinor: Number(i.paid_minor) }),
    payment: ps, issuedOn: i.issued_on, dueOn: i.due_on, termsDays: i.terms_days, taxRateBp: i.tax_rate_bp, taxExempt: i.tax_exempt,
    preparedBy: i.prepared_by, approvedAt: i.approved_at, approvedBy: i.approver_name ?? null, notes: i.notes, version: i.version, createdAt: i.created_at, voidReason: i.void_reason,
  };
}

const INVOICE_SELECT = `select i.*, c.name as client_name, (select name from rigo.users where id = i.approved_by) as approver_name
  from rigo.money_invoices i left join rigo.clients c on c.id = i.client_id`;

async function getInvoice(q: Q, cc: CompanyCtx, id: string, lock = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Invoice');
  const { rows } = await q.query<any>(`${INVOICE_SELECT} where i.id = $1 and i.company_id = $2${lock ? ' for update of i' : ''}`, [id, cc.company.id]);
  if (!rows[0]) throw notFound('Invoice');
  return rows[0];
}

billingRoutes.get('/invoices', async (c) => {
  const cc = c.get('cc');
  needMoney(cc);
  need(cc, 'customers.view');
  const status = c.req.query('status');
  const vals: unknown[] = [cc.company.id];
  let where = 'i.company_id = $1';
  if (status === 'unpaid') where += ` and i.status = 'issued' and i.payment_status <> 'paid'`;
  else if (status === 'paid') where += ` and i.status = 'issued' and i.payment_status = 'paid'`;
  else if (status && ['held', 'draft', 'approved', 'issued', 'void'].includes(status)) { vals.push(status); where += ` and i.status = $2`; }
  const client = c.req.query('client');
  if (client && /^[0-9a-f-]{36}$/i.test(client)) { vals.push(client); where += ` and i.client_id = $${vals.length}`; }
  const { rows } = await cc.db.query(`${INVOICE_SELECT} where ${where} order by i.created_at desc limit 300`, vals);
  return c.json({ invoices: rows.map((i) => shapeInvoice(i, today(cc))) });
});

billingRoutes.get('/invoices/:id', async (c) => {
  const cc = c.get('cc');
  needMoney(cc);
  const i = await getInvoice(cc.db, cc, c.req.param('id'));
  const lines = (await cc.db.query<any>(`select id, work_id, description, quantity, unit, rate_e4, amount_minor, taxable from rigo.money_invoice_lines where invoice_id = $1 order by position`, [i.id])).rows
    .map((l) => ({ id: l.id, workId: l.work_id, description: l.description, quantity: l.quantity, unit: l.unit, rateE4: l.rate_e4 === null ? null : Number(l.rate_e4), amountMinor: l.amount_minor === null ? null : Number(l.amount_minor), taxable: l.taxable }));
  const payments = (await cc.db.query<any>(`select p.id, p.amount_minor, p.method, p.reference, p.received_on, p.voided_at, u.name as recorded_by from rigo.money_payments p left join rigo.users u on u.id = p.recorded_by
      where p.invoice_id = $1 and p.company_id = $2 order by p.received_on, p.created_at`, [i.id, cc.company.id])).rows;
  const work = (await cc.db.query<any>(`select w.id, w.number, w.title from rigo.money_invoice_work x join rigo.work_items w on w.id = x.work_id where x.invoice_id = $1 order by w.number`, [i.id])).rows;
  const co = (await cc.db.query<any>(`select name, phone, email, address, invoice_approval from rigo.companies where id = $1`, [cc.company.id])).rows[0];
  const client = i.client_id ? (await cc.db.query<any>(`select c.name, ${can(cc, 'customers.contact') ? 'c.email, c.phone' : 'null as email, null as phone'},
      (select address from rigo.client_places p where p.client_id = c.id order by created_at limit 1) as address from rigo.clients c where c.id = $1`, [i.client_id])).rows[0] : null;
  return c.json({ invoice: shapeInvoice(i, today(cc)), lines, payments, work, from: { name: co.name, phone: co.phone, email: co.email, address: co.address }, billTo: client, approvalRequired: co.invoice_approval });
});

/** Finished work waiting to be billed, by customer. */
billingRoutes.get('/money/ready', async (c) => {
  const cc = c.get('cc');
  needMoney(cc);
  need(cc, 'invoices.manage');
  const { rows } = await cc.db.query<any>(
    `select w.id, w.number, w.title, w.closed_at, w.client_id, c.name as client_name, s.name as stage_name,
            (select count(*)::int from rigo.work_lines l where l.work_id = w.id) as lines,
            (select count(*)::int from rigo.work_lines l where l.work_id = w.id and l.rate_e4 is null) as unpriced
       from rigo.work_items w join rigo.stages s on s.id = w.stage_id left join rigo.clients c on c.id = w.client_id
      where w.company_id = $1 and w.billing = 'ready' order by c.name nulls last, w.closed_at`, [cc.company.id]);
  return c.json({ work: rows });
});

billingRoutes.get('/money/summary', async (c) => {
  const cc = c.get('cc');
  needMoney(cc);
  const t = today(cc);
  const open = (await cc.db.query<any>(`select due_on, total_minor, paid_minor from rigo.money_invoices where company_id = $1 and status = 'issued' and payment_status <> 'paid'`, [cc.company.id])).rows;
  const aging = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0])) as Record<string, number>;
  for (const i of open) aging[agingBucket(i.due_on, t)] += Number(i.total_minor) - Number(i.paid_minor);
  const counts = (await cc.db.query<any>(`select
      (select count(*)::int from rigo.work_items where company_id = $1 and billing = 'ready') as ready,
      (select count(*)::int from rigo.money_invoices where company_id = $1 and status = 'held') as held,
      (select count(*)::int from rigo.money_invoices where company_id = $1 and status = 'draft') as waiting,
      (select count(*)::int from rigo.money_invoices where company_id = $1 and status = 'approved') as approved,
      (select coalesce(sum(amount_minor),0)::bigint from rigo.money_payments where company_id = $1 and voided_at is null and received_on >= date_trunc('month', $2::date)) as paid_this_month`, [cc.company.id, t])).rows[0];
  return c.json({
    owedMinor: Object.values(aging).reduce((a, b) => a + b, 0), aging: AGING_BUCKETS.map((b) => ({ ...b, minor: aging[b.key] })),
    ready: counts.ready, held: counts.held, waiting: counts.waiting, approved: counts.approved, paidThisMonthMinor: Number(counts.paid_this_month), currency: cc.company.currency,
  });
});

// ---------------------------------------------------------------- changing invoices

billingRoutes.post('/invoices', async (c) => {
  const cc = c.get('cc');
  needMoney(cc);
  need(cc, 'invoices.manage');
  const input = await body(c, z.object({ workIds: z.array(uuid).min(1, 'Choose the work to bill').max(50) }));
  const r = await cc.db.tx((q) => prepareInvoice(q, cc, input.workIds));
  return c.json(r);
});

const editableLine = z.object({
  description: z.string().trim().min(1, 'Describe the line').max(200),
  quantity: z.string().trim().regex(/^\d+(\.\d{1,4})?$/, 'Use digits, like 2 or 1.5'),
  unit: z.string().trim().max(20).default(''),
  rate: z.string().max(20).nullable(),
  taxable: z.boolean().default(false),
  workId: uuid.nullable().optional(),
});

billingRoutes.put('/invoices/:id', async (c) => {
  const cc = c.get('cc');
  needMoney(cc);
  need(cc, 'invoices.manage');
  const input = await body(c, z.object({ version: z.number().int(), lines: z.array(editableLine).max(100).optional(), notes: z.string().trim().max(2000).optional(), termsDays: z.number().int().min(0).max(180).optional() }));
  const r = await cc.db.tx(async (q) => {
    const i = await getInvoice(q, cc, c.req.param('id'), true);
    if (i.version !== input.version) throw conflict('Someone else changed this invoice. Reload to see their changes.', { stale: true });
    if (!['held', 'draft', 'approved'].includes(i.status)) throw conflict('An issued invoice can’t be changed. Void it and prepare a new one.');
    if (input.lines) {
      const linked = new Set((await q.query<{ work_id: string }>(`select work_id from rigo.money_invoice_work where invoice_id = $1`, [i.id])).rows.map((r) => r.work_id));
      await q.query(`delete from rigo.money_invoice_lines where invoice_id = $1`, [i.id]);
      let pos = 0;
      for (const l of input.lines) {
        await q.query(`insert into rigo.money_invoice_lines (company_id, invoice_id, work_id, description, quantity, unit, rate_e4, taxable, position) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [cc.company.id, i.id, l.workId && linked.has(l.workId) ? l.workId : null, l.description, l.quantity, l.unit, rateOf(l.rate), l.taxable, pos++]);
      }
    }
    await q.query(`update rigo.money_invoices set notes = coalesce($2, notes), terms_days = coalesce($3, terms_days) where id = $1`, [i.id, input.notes ?? null, input.termsDays ?? null]);
    const res = await writeInvoiceTotals(q, cc, i.id);
    await audit(q, cc, 'invoice.edited', { id: i.id, lines: input.lines?.length });
    return res;
  });
  return c.json(r);
});

/** Fills missing prices from the price list (after the owner sets them) and works the totals out again. */
billingRoutes.post('/invoices/:id/refresh', async (c) => {
  const cc = c.get('cc');
  needMoney(cc);
  need(cc, 'invoices.manage');
  const r = await cc.db.tx(async (q) => {
    const i = await getInvoice(q, cc, c.req.param('id'), true);
    if (!['held', 'draft', 'approved'].includes(i.status)) throw conflict('Only invoices that aren’t issued yet can be updated.');
    await q.query(`update rigo.money_invoice_lines l set rate_e4 = k.rate_e4 from rigo.catalog_items k
                    where l.invoice_id = $1 and l.rate_e4 is null and k.id = l.catalog_id and k.company_id = $2 and k.rate_e4 is not null`, [i.id, cc.company.id]);
    const co = (await q.query<any>(`select tax_rate_bp from rigo.companies where id = $1`, [cc.company.id])).rows[0];
    if (i.tax_rate_bp === null && co.tax_rate_bp !== null) await q.query(`update rigo.money_invoices set tax_rate_bp = $2 where id = $1`, [i.id, co.tax_rate_bp]);
    return writeInvoiceTotals(q, cc, i.id);
  });
  return c.json(r);
});

/** A person approves the amounts. Never automatic: nothing approves itself. */
billingRoutes.post('/invoices/:id/approve', async (c) => {
  const cc = c.get('cc');
  needMoney(cc);
  need(cc, 'invoices.approve');
  const input = await body(c, z.object({ version: z.number().int() }));
  await cc.db.tx(async (q) => {
    const i = await getInvoice(q, cc, c.req.param('id'), true);
    if (i.version !== input.version) throw conflict('This invoice changed since you looked at it. Check the new amounts first.', { stale: true });
    if (i.status === 'held') throw conflict(`This invoice is held: ${i.hold_reasons[0] ?? 'it needs a fix'}`);
    if (i.status !== 'draft') throw conflict('Only an invoice waiting for approval can be approved.');
    await q.query(`update rigo.money_invoices set status = 'approved', approved_by = $2, approved_at = now(), version = version + 1, updated_at = now() where id = $1`, [i.id, cc.user.id]);
    await q.query(`update rigo.auto_actions set status = 'approved', decided_by = $3, decided_at = now() where company_id = $1 and subject_type = 'invoice' and subject_id = $2 and status = 'waiting'`, [cc.company.id, i.id, cc.user.id]);
    await resolveNotices(q, cc.company.id, 'invoice', i.id);
    await audit(q, cc, 'invoice.approved', { id: i.id, totalMinor: i.total_minor });
  });
  return c.json({ ok: true });
});

export async function issueInvoice(q: Q, cc: CompanyCtx, id: string) {
  const i = await getInvoice(q, cc, id, true);
  const co = (await q.query<any>(`select invoice_approval, invoice_prefix from rigo.companies where id = $1 for update`, [cc.company.id])).rows[0];
  if (i.status === 'held') throw conflict(`This invoice is held: ${i.hold_reasons[0] ?? 'it needs a fix'}`);
  if (i.status === 'issued') return { number: i.number, already: true };
  if (co.invoice_approval && i.status !== 'approved') throw conflict('This invoice needs approving before it is issued.');
  if (!['draft', 'approved'].includes(i.status)) throw conflict('This invoice can’t be issued.');
  const seq = (await q.query<{ invoice_seq: number }>(`update rigo.companies set invoice_seq = invoice_seq + 1 where id = $1 returning invoice_seq`, [cc.company.id])).rows[0].invoice_seq;
  const number = formatInvoiceNumber(seq, co.invoice_prefix);
  const t = today(cc);
  await q.query(`update rigo.money_invoices set status = 'issued', number = $2, issued_on = $3, due_on = $4, issued_by = $5, version = version + 1, updated_at = now() where id = $1`,
    [i.id, number, t, dueDateFor(t, i.terms_days), cc.user.id]);
  await audit(q, cc, 'invoice.issued', { id: i.id, number, totalMinor: i.total_minor });
  return { number, already: false };
}

billingRoutes.post('/invoices/:id/issue', async (c) => {
  const cc = c.get('cc');
  needMoney(cc);
  need(cc, 'invoices.manage');
  const r = await cc.db.tx((q) => issueInvoice(q, cc, c.req.param('id')));
  return c.json(r);
});

/** Voids an issued invoice (it keeps its number), or discards one that was never issued. The work can be billed again. */
billingRoutes.post('/invoices/:id/void', async (c) => {
  const cc = c.get('cc');
  needMoney(cc);
  need(cc, 'invoices.manage');
  const input = await body(c, z.object({ reason: z.string().trim().min(1, 'Say why').max(300) }));
  await cc.db.tx(async (q) => {
    const i = await getInvoice(q, cc, c.req.param('id'), true);
    if (i.status === 'void') return;
    const paid = (await q.query<{ n: number }>(`select count(*)::int n from rigo.money_payments where invoice_id = $1 and voided_at is null`, [i.id])).rows[0].n;
    if (paid) throw conflict('This invoice has payments. Undo the payments first, then void it.');
    const work = (await q.query<{ work_id: string }>(`delete from rigo.money_invoice_work where invoice_id = $1 returning work_id`, [i.id])).rows;
    for (const w of work) {
      await q.query(`update rigo.work_items w set billing = case when s.meaning = 'finished' then 'ready' else 'none' end, version = w.version + 1, updated_at = now()
                      from rigo.stages s where s.id = w.stage_id and w.id = $1`, [w.work_id]);
      await q.query(`insert into rigo.work_history (company_id, work_id, type, actor_user_id, data) values ($1,$2,'invoice_voided',$3,$4)`, [cc.company.id, w.work_id, cc.user.id, JSON.stringify({ invoiceId: i.id, reason: input.reason })]);
    }
    if (i.status === 'issued') {
      await q.query(`update rigo.money_invoices set status = 'void', voided_at = now(), void_reason = $2, version = version + 1, updated_at = now() where id = $1`, [i.id, input.reason]);
    } else {
      await q.query(`delete from rigo.money_invoices where id = $1`, [i.id]);
    }
    await q.query(`update rigo.auto_actions set status = 'cancelled', result = $3 where company_id = $1 and subject_type = 'invoice' and subject_id = $2 and status = 'waiting'`, [cc.company.id, i.id, JSON.stringify({ reason: input.reason })]);
    await resolveNotices(q, cc.company.id, 'invoice', i.id);
    await audit(q, cc, i.status === 'issued' ? 'invoice.voided' : 'invoice.discarded', { id: i.id, number: i.number, reason: input.reason });
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- payments

const METHODS = ['cash', 'check', 'card', 'bank_transfer', 'other'] as const;

async function writePaid(q: Q, invoiceId: string) {
  const { rows } = await q.query<{ paid: number; total: number }>(`select coalesce((select sum(amount_minor) from rigo.money_payments where invoice_id = $1 and voided_at is null), 0)::bigint as paid,
      (select total_minor from rigo.money_invoices where id = $1) as total`, [invoiceId]);
  const paid = Number(rows[0].paid), total = Number(rows[0].total);
  const status = paid <= 0 ? 'unpaid' : paid >= total ? 'paid' : 'partially_paid';
  await q.query(`update rigo.money_invoices set paid_minor = $2, payment_status = $3, version = version + 1, updated_at = now() where id = $1`, [invoiceId, paid, status]);
  return { paid, status };
}

billingRoutes.post('/invoices/:id/payments', async (c) => {
  const cc = c.get('cc');
  needMoney(cc);
  need(cc, 'payments.record');
  const input = await body(c, z.object({
    amount: z.string().max(20), method: z.enum(METHODS), reference: z.string().trim().max(80).default(''),
    receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date').optional(),
  }));
  const amount = parseMoney(input.amount);
  if (amount === null || amount <= 0) throw badRequest('Enter the amount received, like 125.50.', { fields: { amount: 'Enter an amount like 125.50' } });
  const t = today(cc);
  if (input.receivedOn && input.receivedOn > t) throw badRequest('A payment can’t be received in the future.', { fields: { receivedOn: 'Choose today or earlier' } });
  const r = await cc.db.tx(async (q) => {
    const i = await getInvoice(q, cc, c.req.param('id'), true);
    if (i.status !== 'issued') throw conflict('Payments are recorded on issued invoices.');
    const balance = Number(i.total_minor) - Number(i.paid_minor);
    if (amount > balance) throw badRequest(`That is more than the ${formatMoney(balance, i.currency)} still owed.`, { fields: { amount: `At most ${formatMoney(balance, i.currency)}` } });
    await q.query(`insert into rigo.money_payments (company_id, invoice_id, client_id, amount_minor, method, reference, received_on, recorded_by) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [cc.company.id, i.id, i.client_id, amount, input.method, input.reference, input.receivedOn ?? t, cc.user.id]);
    const res = await writePaid(q, i.id);
    await audit(q, cc, 'payment.recorded', { invoiceId: i.id, amountMinor: amount, method: input.method });
    return res;
  });
  return c.json(r);
});

billingRoutes.post('/payments/:id/void', async (c) => {
  const cc = c.get('cc');
  needMoney(cc);
  need(cc, 'payments.record');
  const r = await cc.db.tx(async (q) => {
    if (!/^[0-9a-f-]{36}$/i.test(c.req.param('id'))) throw notFound('Payment');
    const { rows } = await q.query<{ invoice_id: string; amount_minor: number }>(`update rigo.money_payments set voided_at = now() where id = $1 and company_id = $2 and voided_at is null returning invoice_id, amount_minor`, [c.req.param('id'), cc.company.id]);
    if (!rows[0]) throw notFound('Payment');
    const res = await writePaid(q, rows[0].invoice_id);
    await audit(q, cc, 'payment.voided', { id: c.req.param('id'), amountMinor: rows[0].amount_minor });
    return res;
  });
  return c.json(r);
});

// ---------------------------------------------------------------- settings

billingRoutes.get('/money/settings', async (c) => {
  const cc = c.get('cc');
  needMoney(cc);
  const co = (await cc.db.query<any>(`select invoice_prefix, invoice_seq, terms_days, invoice_approval, tax_rate_bp from rigo.companies where id = $1`, [cc.company.id])).rows[0];
  return c.json({ invoicePrefix: co.invoice_prefix, nextNumber: co.invoice_seq + 1, termsDays: co.terms_days, approvalRequired: co.invoice_approval, taxRateBp: co.tax_rate_bp });
});

billingRoutes.patch('/money/settings', async (c) => {
  const cc = c.get('cc');
  needMoney(cc);
  need(cc, 'catalog.manage');
  const input = await body(c, z.object({
    invoicePrefix: z.string().trim().max(12).regex(/^[A-Za-z0-9\-_/ #.]*$/, 'Use letters, numbers, dashes or slashes').optional(),
    nextNumber: z.number().int().min(1).max(99_999_999).optional(),
    termsDays: z.number().int().min(0).max(180).optional(),
    /** "Every invoice needs approval before it is issued" (owner only). */
    approvalRequired: z.boolean().optional(),
    taxRate: z.string().max(10).nullable().optional(),
  }));
  if (input.approvalRequired !== undefined && !cc.isOwner) throw forbidden('Only an owner can change whether invoices need approval.');
  await cc.db.tx(async (q) => {
    if (input.invoicePrefix !== undefined) await q.query(`update rigo.companies set invoice_prefix = $2 where id = $1`, [cc.company.id, input.invoicePrefix]);
    if (input.termsDays !== undefined) await q.query(`update rigo.companies set terms_days = $2 where id = $1`, [cc.company.id, input.termsDays]);
    if (input.approvalRequired !== undefined) await q.query(`update rigo.companies set invoice_approval = $2 where id = $1`, [cc.company.id, input.approvalRequired]);
    if (input.taxRate !== undefined) {
      let bp: number | null = null;
      if (input.taxRate !== null && input.taxRate.trim() !== '') {
        const m = /^(\d{1,2})(\.(\d{1,2}))?%?$/.exec(input.taxRate.trim());
        if (!m) throw badRequest('Enter the tax rate as a percentage, like 8.25.', { fields: { taxRate: 'Like 8.25' } });
        bp = Number(m[1]) * 100 + Number((m[3] ?? '').padEnd(2, '0') || 0);
      }
      await q.query(`update rigo.companies set tax_rate_bp = $2 where id = $1`, [cc.company.id, bp]);
    }
    if (input.nextNumber !== undefined) {
      // Numbers only move forward, so an issued number is never handed out twice.
      const cur = (await q.query<{ invoice_seq: number }>(`select invoice_seq from rigo.companies where id = $1 for update`, [cc.company.id])).rows[0].invoice_seq;
      if (input.nextNumber <= cur) throw badRequest(`Invoice numbers only move forward. The next number must be ${cur + 1} or higher.`, { fields: { nextNumber: `Use ${cur + 1} or higher` } });
      await q.query(`update rigo.companies set invoice_seq = $2 where id = $1`, [cc.company.id, input.nextNumber - 1]);
    }
    await audit(q, cc, 'invoice.settings_updated', input);
  });
  return c.json({ ok: true });
});

export { daysBetween, notifyPermission };
