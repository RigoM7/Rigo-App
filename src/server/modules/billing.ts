import { Hono } from 'hono';
import { z } from 'zod';
import type { Q } from '../db/index.js';
import { type AppEnv, type CompanyCtx, need, can, audit, needConfirmedEmail } from '../http/context.js';
import { body, paging } from '../lib/util.js';
import { fold, jobNumberQuery } from '../../shared/customers.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { computeTotals, lineAmount, resolveDiscounts, formatMoney, type DraftLine } from '../../shared/billing.js';
import { balanceDue, paymentState, termsLabel, holdKind, PAYMENT_METHODS } from '../../shared/invoices.js';
import { localDate } from '../../shared/schedule.js';
import { emit, invalidateApprovalsFor, requestApproval, settleInvoiceSteps, advanceRun } from '../automation/engine.js';
import { issueInvoice, invoiceEmail, persistLines, lineFromRow, applyPayment, applyCredit, refreshPayment, creditBalance, termsFor, prepareInvoiceForJob, invoiceViewLink } from './invoicing.js';
import { deliverMessage, capabilities } from '../adapters/index.js';
import { resolveNotices } from './inbox.js';
import { recordDelivery } from './messaging.js';
import { textNumber } from '../../shared/messages.js';

// Invoices, payments and customer communications.

export const billingRoutes = new Hono<AppEnv>();

const money = (cc: CompanyCtx, v: number | null) => (can(cc, 'finance.view') ? v : undefined);
const today = (cc: CompanyCtx) => localDate(new Date(), cc.company.timezone);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date');

function serializeInvoice(cc: CompanyCtx, i: any) {
  const total = i.total_minor === null ? null : Number(i.total_minor);
  const state = paymentState({ status: i.status, paymentStatus: i.payment_status, dueDate: i.due_date }, today(cc));
  return {
    id: i.id, number: i.number, status: i.status, kind: i.kind ?? 'job', deliveryStatus: i.delivery_status, paymentStatus: i.payment_status, currency: i.currency,
    subtotalMinor: money(cc, i.subtotal_minor), discountMinor: money(cc, i.discount_minor), taxMinor: money(cc, i.tax_minor), totalMinor: money(cc, i.total_minor), paidMinor: money(cc, i.paid_minor),
    creditedMinor: money(cc, i.credited_minor ?? 0), balanceMinor: money(cc, balanceDue({ totalMinor: total, paidMinor: Number(i.paid_minor), creditedMinor: Number(i.credited_minor ?? 0) })),
    payment: state, dueDate: i.due_date ?? null, termsLabel: i.status === 'issued' ? termsLabel(i.due_days) : null,
    periodStart: i.period_start ?? null, periodEnd: i.period_end ?? null, replacesInvoiceId: i.replaces_invoice_id ?? null,
    holdReasons: i.hold_reasons, notes: i.notes, dueDays: i.due_days, issuedAt: i.issued_at, approvedAt: i.approved_at, version: i.version, createdAt: i.created_at,
    voidedAt: i.voided_at ?? null, voidReason: i.void_reason ?? null, freeConfirmed: !!i.free_confirmed, taxRateBp: money(cc, i.tax_rate_bp ?? null),
    customerId: i.customer_id, customerName: i.bill_to?.customerName ?? i.customer_name, jobId: i.job_id, jobNumber: i.job_number, recurringPlanId: i.recurring_plan_id,
  };
}

billingRoutes.get('/invoices', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.view');
  const status = c.req.query('status');
  const vals: unknown[] = [cc.company.id];
  let where = 'i.company_id = $1';
  if (status === 'attention') where += ` and i.status in ('held','draft','pending_approval','approved')`;
  else if (status === 'unpaid') where += ` and i.status = 'issued' and i.payment_status <> 'paid'`;
  else if (status === 'overdue') { vals.push(today(cc)); where += ` and i.status = 'issued' and i.payment_status <> 'paid' and i.due_date < $2`; }
  else if (status && status !== 'all') { vals.push(status); where += ` and i.status = $2`; }
  const customer = c.req.query('customer');
  if (customer && /^[0-9a-f-]{36}$/i.test(customer)) { vals.push(customer); where += ` and i.customer_id = $${vals.length}`; }
  // Searched on the server (R17-m2): invoice number, customer name (accents don't matter) or job number.
  const text = (c.req.query('q') ?? '').trim();
  if (text) {
    vals.push(`%${fold(text)}%`);
    const n = vals.length;
    const num = jobNumberQuery(text);
    vals.push(num ?? -1);
    where += ` and (rigo.fold(coalesce(i.number, '')) like $${n} or rigo.fold(c.name) like $${n} or j.number = $${n + 1})`;
  }
  const { limit } = paging(c.req.query('limit'), undefined, 300);
  const { rows } = await cc.db.query(`select i.*, c.name as customer_name, j.number as job_number from rigo.invoices i left join rigo.customers c on c.id = i.customer_id left join rigo.jobs j on j.id = i.job_id where ${where} order by i.created_at desc limit ${limit}`, vals);
  return c.json({ invoices: rows.map((i) => serializeInvoice(cc, i)) });
});

async function loadInvoice(cc: CompanyCtx, q: Q, id: string, lock = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Invoice');
  const { rows } = await q.query<any>(`select i.* from rigo.invoices i where i.id = $1 and i.company_id = $2${lock ? ' for update' : ''}`, [id, cc.company.id]);
  if (!rows[0]) throw notFound('Invoice');
  return rows[0];
}

/** What the driver recorded on site that the invoice prints: quantities, and notes when the service opts in (R6-m3). */
function serviceRecord(job: any) {
  if (!job?.completion) return [];
  const fields = (job.fields ?? []) as { key: string; label: string; type: string; unit?: string; stage: string }[];
  const values = job.completion.values ?? {};
  const out: { label: string; value: string }[] = [];
  for (const f of fields.filter((x) => x.stage !== 'request')) {
    const v = values[f.key];
    if (v === undefined || v === null || v === '') continue;
    if (f.type === 'number') out.push({ label: f.label, value: `${v}${f.unit ? ` ${f.unit}` : ''}` });
    else if (job.invoice_shows_notes && ['text', 'longtext', 'select'].includes(f.type)) out.push({ label: f.label, value: String(v) });
    else if (job.invoice_shows_notes && f.type === 'boolean') out.push({ label: f.label, value: v === true || v === 'true' ? 'Yes' : 'No' });
  }
  if (job.invoice_shows_notes && job.completion.notes) out.push({ label: 'Notes', value: String(job.completion.notes) });
  return out;
}

billingRoutes.get('/invoices/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.view');
  const inv = await loadInvoice(cc, cc.db, c.req.param('id'));
  const extra = (await cc.db.query<any>(`select c.name as customer_name, coalesce(nullif(c.billing_contact->>'email', ''), c.email) as customer_email, c.billing_address, j.number as job_number, j.completed_at, j.completion, s.fields, s.invoice_shows_notes,
        coalesce(j.location_snapshot->>'address', l.address) as location_address, coalesce(j.location_snapshot->>'label', l.label) as location_label, s.name as service_name, s.tax_rate_bp as service_tax_rate_bp
      from rigo.invoices i left join rigo.customers c on c.id = i.customer_id left join rigo.jobs j on j.id = i.job_id left join rigo.locations l on l.id = coalesce(j.location_id, i.location_id)
      left join rigo.services s on s.id = j.service_id where i.id = $1`, [inv.id])).rows[0];
  const fin = can(cc, 'finance.view');
  const contact = can(cc, 'customers.contact');
  const lines = (await cc.db.query<any>(`select * from rigo.invoice_lines where invoice_id = $1 order by position`, [inv.id])).rows.map((row) => {
    const l = lineFromRow(row);
    // Rates, amounts and price-change notes are financial: removed here without finance.view.
    return {
      id: row.id, description: l.description, quantity: l.quantity, unit: l.unit, kind: l.kind, taxable: l.taxable, rateMissing: l.rateE4 === null && !l.percentBp,
      rateE4: fin ? l.rateE4 : undefined, amountMinor: fin ? l.amountMinor : undefined, priceDate: fin ? l.priceDate : undefined, percentBp: fin ? l.percentBp : undefined,
      bookedRateE4: fin ? l.bookedRateE4 : undefined, note: fin ? l.note : (l.note?.startsWith('Price changed') || l.note?.startsWith('Minimum') ? '' : l.note),
    };
  });
  const payments = fin ? (await cc.db.query<any>(`select p.*, u.name as recorded_by_name, cu.name as confirmed_by_name, ru.name as rejected_by_name from rigo.payments p
      left join rigo.users u on u.id = p.recorded_by left join rigo.users cu on cu.id = p.confirmed_by left join rigo.users ru on ru.id = p.rejected_by
      where p.company_id = $1 and (p.invoice_id = $2 or ($3::uuid is not null and p.job_id = $3 and p.invoice_id is null)) order by p.recorded_at`, [cc.company.id, inv.id, inv.job_id])).rows.map(serializePayment) : [];
  const credits = fin ? (await cc.db.query<any>(`select ic.*, u.name as created_by_name from rigo.invoice_credits ic left join rigo.users u on u.id = ic.created_by where ic.invoice_id = $1 order by ic.created_at`, [inv.id])).rows
    .map((r) => ({ id: r.id, amountMinor: Number(r.amount_minor), source: r.source, note: r.note, createdAt: r.created_at, createdByName: r.created_by_name })) : [];
  const approvals = (await cc.db.query(`select a.id, a.status, a.title, a.created_at, a.decided_at, a.decision_note, a.subject_version, x.type as action_type, u.name as decided_by_name from rigo.approvals a join rigo.actions x on x.id = a.action_id left join rigo.users u on u.id = a.decided_by where a.subject_type = 'invoice' and a.subject_id = $1 order by a.created_at`, [inv.id])).rows;
  const messages = can(cc, 'messages.view') ? (await cc.db.query(`select id, channel, subject, status, status_detail, ${can(cc, 'customers.contact') ? 'recipient' : 'null as recipient'}, created_at from rigo.messages where invoice_id = $1 and company_id = $2 order by created_at desc`, [inv.id, cc.company.id])).rows : [];
  const replaces = inv.replaces_invoice_id ? (await cc.db.query<any>(`select id, number, status from rigo.invoices where id = $1 and company_id = $2`, [inv.replaces_invoice_id, cc.company.id])).rows[0] ?? null : null;
  const replacedBy = (await cc.db.query<any>(`select id, number, status from rigo.invoices where replaces_invoice_id = $1 and company_id = $2 order by created_at desc limit 1`, [inv.id, cc.company.id])).rows[0] ?? null;
  const credit = fin && inv.customer_id ? await creditBalance(cc.db, cc.company.id, inv.customer_id) : 0;
  const co = cc.company;
  const s = co.settings ?? {};
  const out = serializeInvoice(cc, { ...inv, customer_name: extra?.customer_name, job_number: extra?.job_number });
  // Issued invoices show the names and addresses as they were when issued (R10-M4).
  const bt = inv.bill_to ?? {};
  const issued = inv.status === 'issued' || inv.status === 'void';
  const balance = Number(inv.total_minor ?? 0) - Number(inv.paid_minor) - Number(inv.credited_minor ?? 0);
  const voidBlocked = inv.status !== 'issued' ? null : Number(inv.paid_minor) > 0 ? 'Payments are recorded on this invoice. Refund them first, then void it.' : null;
  return c.json({
    invoice: { ...out,
      customerName: issued && bt.customerName ? bt.customerName : extra?.customer_name,
      customerEmail: contact ? extra?.customer_email : undefined,
      billingAddress: contact ? (issued && inv.bill_to ? bt.billingAddress : extra?.billing_address) : undefined,
      jobNumber: extra?.job_number, completedAt: extra?.completed_at,
      locationAddress: issued && inv.bill_to ? bt.locationAddress : extra?.location_address, locationLabel: issued && inv.bill_to ? bt.locationLabel : extra?.location_label,
      serviceName: issued && bt.serviceName ? bt.serviceName : extra?.service_name },
    lines, payments, credits, approvals, messages, replaces, replacedBy,
    serviceRecord: serviceRecord(extra),
    customerCreditMinor: fin ? credit : undefined,
    // The service's tax rate, so new lines start taxable when tax applies.
    taxRateBp: fin ? (inv.tax_rate_bp ?? extra?.service_tax_rate_bp ?? null) : undefined,
    company: { name: co.name, phone: co.phone, email: co.email, address: co.address, logo: !!co.branding?.logoFileId, accent: co.branding?.accent ?? null,
      paymentInstructions: s.paymentInstructions ?? '', remitTo: s.remitTo ?? '', taxId: s.taxId ?? '' },
    approvalRequired: s.invoiceApprovalRequired !== false,
    can: {
      edit: can(cc, 'invoices.edit') && fin && ['held', 'draft', 'pending_approval', 'approved'].includes(inv.status),
      approve: can(cc, 'invoices.approve') && ['draft', 'pending_approval'].includes(inv.status),
      submit: can(cc, 'invoices.edit') && inv.status === 'draft' && s.invoiceApprovalRequired !== false && !approvals.some((a: any) => a.status === 'pending'),
      issue: can(cc, 'invoices.issue') && ['draft', 'approved'].includes(inv.status),
      void: can(cc, 'invoices.issue') && inv.status === 'issued' && !voidBlocked, voidBlocked: can(cc, 'invoices.issue') ? voidBlocked : null,
      pay: can(cc, 'payments.record') && fin && inv.status === 'issued' && balance > 0,
      refund: can(cc, 'payments.record') && fin && inv.status === 'issued' && Number(inv.paid_minor) > 0,
      creditNote: can(cc, 'invoices.issue') && fin && inv.status === 'issued' && balance > 0,
      applyCredit: can(cc, 'payments.record') && fin && inv.status === 'issued' && balance > 0 && credit > 0,
      confirmPayments: can(cc, 'payments.record') && fin, rejectPayments: cc.isOwner && fin,
      message: can(cc, 'messages.send') && inv.status === 'issued',
      prepareReplacement: can(cc, 'invoices.edit') && inv.status === 'void' && !!inv.job_id && !replacedBy && !(await activeJobInvoice(cc.db, inv.job_id)),
    },
  });
});

function serializePayment(p: any) {
  return {
    id: p.id, kind: p.kind ?? 'payment', amountMinor: Number(p.amount_minor), appliedMinor: p.applied_minor === null ? null : Number(p.applied_minor),
    method: p.method, methodLabel: (PAYMENT_METHODS as Record<string, string>)[p.method] ?? p.method, reference: p.reference ?? '', note: p.note, paidOn: p.paid_on, state: p.state ?? 'confirmed',
    collectedAtStop: !!p.job_id, hasPhoto: !!p.photo_file_id, invoiceId: p.invoice_id,
    recordedAt: p.recorded_at, recordedByName: p.recorded_by_name, confirmedAt: p.confirmed_at ?? null, confirmedByName: p.confirmed_by_name ?? null,
    rejectedReason: p.rejected_reason ?? null, rejectedAt: p.rejected_at ?? null, rejectedByName: p.rejected_by_name ?? null,
  };
}

/** The job's invoice that counts: the newest one that isn't void. */
async function activeJobInvoice(q: Q, jobId: string) {
  return (await q.query<any>(`select id from rigo.invoices where job_id = $1 and status <> 'void' order by created_at desc limit 1`, [jobId])).rows[0]?.id ?? null;
}

const lineSchema = z.object({
  description: z.string().trim().min(1, 'Enter a description').max(200), quantity: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Enter a quantity like 12 or 12.5'),
  unit: z.string().max(20).default(''), rateE4: z.number().int().min(0).max(1_000_000_000_000).nullable(), taxable: z.boolean().default(false), kind: z.enum(['charge', 'discount']).default('charge'),
  note: z.string().max(300).default(''),
  /** Discounts only: a percentage of the charges (10% = 1000) instead of a fixed amount. */
  percentBp: z.number().int().min(1).max(10000).nullable().optional(),
  /** The stored line this edits: unchanged lines keep their amount (a minimum charge) and price history. */
  id: z.string().uuid().optional(),
});

/** Lines from the editor: untouched lines keep what pricing worked out; discounts are resolved and capped (R10-M1). */
async function editedLines(q: Q, invoiceId: string | null, input: z.infer<typeof lineSchema>[], allowFree: boolean, currency: string) {
  const before = invoiceId ? new Map((await q.query<any>(`select * from rigo.invoice_lines where invoice_id = $1`, [invoiceId])).rows.map((r) => [r.id as string, lineFromRow(r)])) : new Map<string, DraftLine>();
  const lines: DraftLine[] = input.map(({ id, ...l }) => {
    const percentBp = l.kind === 'discount' ? l.percentBp ?? null : null;
    const o = id ? before.get(id) : undefined;
    // A line whose quantity and rate weren't touched keeps what pricing worked out (a minimum
    // charge, the price date, a price change since booking); anything edited is recomputed.
    if (o && o.kind === 'charge' && l.kind === 'charge' && o.quantity === l.quantity && o.rateE4 === l.rateE4) return { ...l, percentBp, amountMinor: o.amountMinor, note: o.note ?? '', priceDate: o.priceDate ?? null, bookedRateE4: o.bookedRateE4 ?? null };
    return { ...l, percentBp, note: '', amountMinor: l.kind === 'charge' ? lineAmount(l.quantity, l.rateE4) : null };
  });
  const r = resolveDiscounts(lines, { allowFree });
  if (r.excessMinor > 0) {
    throw badRequest(`The discounts are ${formatMoney(r.excessMinor, currency)} more than the charges. Lower them, or choose "Make this invoice free".`, { freeConfirm: true, excessMinor: r.excessMinor });
  }
  return r.lines;
}

billingRoutes.put('/invoices/:id/lines', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.edit', 'finance.view');
  const input = await body(c, z.object({ lines: z.array(lineSchema).min(1).max(50), notes: z.string().max(2000).optional(), version: z.number().int(), taxRateBp: z.number().int().min(0).max(5000).nullable().optional(), allowFree: z.boolean().default(false) }));
  const out = await cc.db.tx(async (q) => {
    const inv = await loadInvoice(cc, q, c.req.param('id'), true);
    if (inv.version !== input.version) throw conflict('This invoice changed since you opened it. Reload to see the latest version.');
    if (!['held', 'draft', 'pending_approval', 'approved'].includes(inv.status)) throw conflict('Issued or voided invoices cannot be edited.');
    const lines = await editedLines(q, inv.id, input.lines, input.allowFree, inv.currency);
    const svcTax = inv.job_id ? (await q.query<any>(`select s.tax_rate_bp from rigo.jobs j join rigo.services s on s.id = j.service_id where j.id = $1`, [inv.job_id])).rows[0]?.tax_rate_bp ?? null : null;
    const taxRate = input.taxRateBp !== undefined ? input.taxRateBp : inv.tax_rate_bp ?? svcTax;
    const taxExempt = !!(await q.query<any>(`select tax_exempt from rigo.customers where id = $1`, [inv.customer_id])).rows[0]?.tax_exempt;
    const totals = computeTotals(lines, taxRate, [], { taxExempt });
    await persistLines(q, cc.company.id, inv.id, lines);
    const held = totals.totalMinor === null;
    // Editing invalidates any approval given for the previous version.
    await q.query(`update rigo.invoices set subtotal_minor = $2, discount_minor = $3, tax_minor = $4, total_minor = $5, hold_reasons = $6, status = $7, notes = coalesce($8, notes), approved_by = null, approved_at = null,
        free_confirmed = $9, tax_rate_bp = case when $10 then $11 else tax_rate_bp end, version = version + 1, updated_at = now() where id = $1`,
      [inv.id, totals.subtotalMinor, totals.discountMinor, totals.taxMinor, totals.totalMinor, JSON.stringify(totals.holdReasons), held ? 'held' : 'draft', input.notes ?? null, input.allowFree, input.taxRateBp !== undefined, input.taxRateBp ?? null]);
    const stale = await invalidateApprovalsFor(q, cc.company.id, 'invoice', inv.id);
    if (inv.job_id) await q.query(`update rigo.jobs set billing_status = $2 where id = $1`, [inv.job_id, held ? 'held' : 'drafted']);
    await audit(q, cc, 'invoice.edited', { id: inv.id, staleApprovals: stale.length });
    return { version: inv.version + 1, held, staleApprovals: stale };
  });
  if (out.staleApprovals.length) {
    const { renewApproval } = await import('../automation/engine.js');
    for (const a of out.staleApprovals) await renewApproval(cc.db, a);
  }
  return c.json(out);
});

const manualInvoiceInput = z.object({
  customerId: z.string().uuid(), locationId: z.string().uuid().nullable().optional(), lines: z.array(lineSchema).min(1).max(50), notes: z.string().max(2000).default(''),
  taxRateBp: z.number().int().min(0).max(5000).nullable().default(null), allowFree: z.boolean().default(false), clientRequestId: z.string().min(8).max(80),
});

/**
 * An invoice without a job (R8-M3): custom lines for a customer and, optionally, one of their sites.
 * Imported opening balances use it too, `quiet` so they don't start invoice workflows.
 */
export async function manualInvoice(q: Q, cc: CompanyCtx, input: z.input<typeof manualInvoiceInput>, opts: { quiet?: boolean } = {}) {
  const i = manualInvoiceInput.parse(input);
  const cust = (await q.query<any>(`select id, tax_exempt from rigo.customers where id = $1 and company_id = $2`, [i.customerId, cc.company.id])).rows[0];
  if (!cust) throw badRequest('Choose a customer from this company.', { fields: { customerId: 'Unknown customer' } });
  if (i.locationId) {
    const l = await q.query(`select 1 from rigo.locations where id = $1 and company_id = $2 and customer_id = $3`, [i.locationId, cc.company.id, cust.id]);
    if (!l.rows.length) throw badRequest('Choose one of this customer\'s locations.', { fields: { locationId: 'Belongs to another customer' } });
  }
  const key = `manual:${i.clientRequestId}`;
  const dup = (await q.query<any>(`select id from rigo.invoices where company_id = $1 and billable_key = $2`, [cc.company.id, key])).rows[0];
  if (dup) return { id: dup.id as string, duplicate: true };
  const lines = await editedLines(q, null, i.lines, i.allowFree, cc.company.currency);
  const totals = computeTotals(lines, i.taxRateBp, [], { taxExempt: !!cust.tax_exempt });
  const held = totals.totalMinor === null;
  const { rows } = await q.query<{ id: string }>(
    `insert into rigo.invoices (company_id, billable_key, customer_id, location_id, kind, status, currency, subtotal_minor, discount_minor, tax_minor, total_minor, hold_reasons, notes, due_days, tax_rate_bp, free_confirmed)
     values ($1,$2,$3,$4,'manual',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
    [cc.company.id, key, cust.id, i.locationId ?? null, held ? 'held' : 'draft', cc.company.currency, totals.subtotalMinor, totals.discountMinor, totals.taxMinor, totals.totalMinor,
      JSON.stringify(totals.holdReasons), i.notes, await termsFor(q, cc.company.id, cust.id), i.taxRateBp, i.allowFree]);
  await persistLines(q, cc.company.id, rows[0].id, lines);
  await audit(q, cc, 'invoice.created_manually', { id: rows[0].id });
  if (!opts.quiet) await emit(q, cc.company.id, 'invoice.prepared', { type: 'invoice', id: rows[0].id }, { held, manual: true }, { actorUserId: cc.user.id });
  return { id: rows[0].id, duplicate: false };
}

billingRoutes.post('/invoices', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.edit', 'finance.view');
  const input = await body(c, manualInvoiceInput);
  return c.json(await cc.db.tx((q) => manualInvoice(q, cc, input)));
});

/** Who may decide a waiting approval, in words. */
async function approverNames(q: Q, ap: any) {
  const people = ap.approver_user_ids?.length ? (await q.query<{ name: string }>(`select coalesce(m.display_name, u.name) as name from rigo.users u left join rigo.memberships m on m.user_id = u.id and m.company_id = $2 where u.id = any($1)`, [ap.approver_user_ids, ap.company_id])).rows.map((r) => r.name) : [];
  const roles = ap.approver_roles?.length ? (await q.query<{ name: string }>(`select name from rigo.roles where company_id = $1 and key = any($2)`, [ap.company_id, ap.approver_roles])).rows.map((r) => r.name) : [];
  return [...people, ...roles].join(' or ') || 'an owner';
}

billingRoutes.post('/invoices/:id/approve', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.approve');
  const input = await body(c, z.object({ version: z.number().int() }));
  const out = await cc.db.tx(async (q) => {
    const inv = await loadInvoice(cc, q, c.req.param('id'), true);
    if (inv.version !== input.version) throw conflict('This invoice changed since you reviewed it. Review the latest version before approving.');
    if (inv.status === 'held') throw conflict('Held invoices cannot be approved until the hold reasons are fixed.');
    if (!['draft', 'pending_approval'].includes(inv.status)) throw conflict(`This invoice is ${inv.status} and does not need approval.`);
    // A workflow step that names who approves (say, the owner over $5,000) can't be skipped by approving here.
    const waiting = (await q.query<any>(`select * from rigo.approvals where company_id = $1 and subject_type = 'invoice' and subject_id = $2 and status = 'pending'`, [cc.company.id, inv.id])).rows;
    const { isEligibleApprover } = await import('../automation/engine.js');
    const actor = { db: cc.db, companyId: cc.company.id, userId: cc.user.id, perms: cc.perms, isOwner: cc.isOwner, isDemo: cc.isDemo };
    for (const ap of waiting) {
      if (!(await isEligibleApprover(q, ap, actor))) throw forbidden(`This invoice is waiting for approval from ${await approverNames(q, ap)}. You can't approve it.`);
    }
    await q.query(`update rigo.invoices set status = 'approved', approved_by = $2, approved_at = now(), updated_at = now() where id = $1`, [inv.id, cc.user.id]);
    if (inv.job_id) await q.query(`update rigo.jobs set billing_status = 'approved' where id = $1`, [inv.job_id]);
    // A workflow approval waiting on this same version is satisfied by this decision.
    const pending = await q.query<any>(`select id from rigo.approvals where company_id = $1 and subject_type = 'invoice' and subject_id = $2 and status = 'pending' and subject_version = $3`, [cc.company.id, inv.id, inv.version]);
    await audit(q, cc, 'invoice.approved', { id: inv.id });
    await emit(q, cc.company.id, 'invoice.approved', { type: 'invoice', id: inv.id }, {}, { actorUserId: cc.user.id });
    return { pending: pending.rows.map((r) => r.id) };
  });
  if (out.pending.length) {
    const { decideApproval } = await import('../automation/engine.js');
    for (const id of out.pending) await decideApproval({ db: cc.db, companyId: cc.company.id, userId: cc.user.id, perms: cc.perms, isOwner: cc.isOwner, isDemo: cc.isDemo }, id, 'approve', 'Approved from the invoice').catch(() => {});
  }
  return c.json({ ok: true });
});

/**
 * "Reviewed — release hold" (R7-m1): a person checked the partly completed visit or the flagged
 * quantity. Holds for missing rates or quantities stay until those are added.
 */
billingRoutes.post('/invoices/:id/release-hold', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.edit');
  const input = await body(c, z.object({ version: z.number().int(), note: z.string().trim().max(500).default('') }));
  const out = await cc.db.tx(async (q) => {
    const inv = await loadInvoice(cc, q, c.req.param('id'), true);
    if (inv.version !== input.version) throw conflict('This invoice changed since you opened it. Review the latest version first.');
    if (inv.status !== 'held') throw conflict('This invoice is not on hold.');
    const reasons = (inv.hold_reasons ?? []) as string[];
    const toFix = reasons.filter((r) => holdKind(r) === 'fix');
    if (toFix.length) throw conflict(`Fix these first: ${toFix.join(' ')}`, { reasons: toFix });
    const { recalcInvoice } = await import('./invoicing.js');
    const r = await recalcInvoice(q, inv.id);
    if (r.held) throw conflict(`Fix these first: ${r.reasons.join(' ')}`, { reasons: r.reasons });
    if (inv.job_id) {
      // Reviewed once: rebuilding the invoice later doesn't hold it again for the same quantity.
      await q.query(`update rigo.jobs set completion = completion || '{"quantityReviewed": true}'::jsonb where id = $1 and completion is not null`, [inv.job_id]);
      await q.query(`insert into rigo.job_events (company_id, job_id, type, actor_user_id, data) values ($1,$2,'hold_released',$3,$4)`, [cc.company.id, inv.job_id, cc.user.id, JSON.stringify({ invoiceId: inv.id, reviewed: reasons, note: input.note })]);
    }
    await audit(q, cc, 'invoice.hold_released', { id: inv.id, reviewed: reasons, note: input.note });
    return { ok: true };
  });
  return c.json(out);
});

/** A draft someone prepared by hand goes to the people who may approve invoices (R6-M3). */
billingRoutes.post('/invoices/:id/submit', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.edit');
  const input = await body(c, z.object({ version: z.number().int() }));
  const out = await cc.db.tx(async (q) => {
    const inv = await loadInvoice(cc, q, c.req.param('id'), true);
    if (inv.version !== input.version) throw conflict('This invoice changed since you opened it. Reload, check it, then send it again.');
    if (inv.status === 'held') throw conflict('Fix the hold reasons before sending this invoice for approval.');
    if (inv.status !== 'draft') throw conflict(`This invoice is ${inv.status.replace('_', ' ')} and can't be sent for approval.`);
    const approvalId = await requestApproval(q, cc.company.id, 'invoice.issue', { type: 'invoice', id: inv.id }, { userId: cc.user.id, name: cc.user.name });
    await q.query(`update rigo.invoices set status = 'pending_approval', submitted_by = $2, updated_at = now() where id = $1`, [inv.id, cc.user.id]);
    await audit(q, cc, 'invoice.sent_for_approval', { id: inv.id, approvalId });
    return { approvalId };
  });
  return c.json(out);
});

billingRoutes.post('/invoices/:id/issue', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.issue');
  const input = await body(c, z.object({ version: z.number().int() }));
  const out = await cc.db.tx(async (q) => {
    const inv = await loadInvoice(cc, q, c.req.param('id'), true);
    if (inv.version !== input.version) throw conflict('This invoice changed since you reviewed it. Reload before issuing.');
    if (cc.company.settings?.invoiceApprovalRequired !== false && inv.status !== 'approved' && inv.status !== 'issued') {
      throw conflict('This invoice needs approval before it is issued.');
    }
    const r = await issueInvoice(q, cc.company.id, inv.id, { userId: cc.user.id });
    await audit(q, cc, 'invoice.issued', { id: inv.id, number: r.number });
    const runs = await settleInvoiceSteps(q, cc.company.id, inv.id, 'issued', cc.user.name);
    return { ...r, runs };
  });
  // A workflow that was waiting to issue it carries on with its next step (the customer email).
  for (const run of out.runs) await advanceRun(cc.db, run);
  return c.json({ number: out.number, already: out.already });
});

/**
 * Void an issued invoice (R10-C1). It stops billing the job, so a new invoice can be prepared
 * ("Replaces INV-00003"). Customer credit used on it goes back to the customer.
 */
billingRoutes.post('/invoices/:id/void', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.issue');
  const input = await body(c, z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) }));
  await cc.db.tx(async (q) => {
    const inv = await loadInvoice(cc, q, c.req.param('id'), true);
    if (inv.status !== 'issued') throw conflict('Only issued invoices can be voided. Edit drafts instead.');
    if (Number(inv.paid_minor) > 0) throw conflict('Payments are recorded on this invoice. Refund them first, then void it.');
    // Credit applied from the customer's balance is returned to it.
    const used = (await q.query<any>(`select coalesce(sum(amount_minor),0)::bigint n from rigo.invoice_credits where invoice_id = $1 and source = 'customer_credit'`, [inv.id])).rows[0].n;
    if (Number(used) > 0 && inv.customer_id) {
      await q.query(`insert into rigo.credit_entries (company_id, customer_id, amount_minor, kind, invoice_id, note, created_by) values ($1,$2,$3,'reversal',$4,$5,$6)`,
        [cc.company.id, inv.customer_id, Number(used), inv.id, `Invoice ${inv.number} voided; credit returned`, cc.user.id]);
    }
    // Money collected at the stop moves to the replacement invoice.
    await q.query(`update rigo.payments set invoice_id = null, applied_minor = 0, applied_at = null where invoice_id = $1 and kind = 'payment' and state = 'unconfirmed'`, [inv.id]);
    await q.query(`update rigo.invoices set status = 'void', billable_key = billable_key || ':void:' || id::text, voided_at = now(), void_reason = $2, notes = notes || $3, version = version + 1, updated_at = now() where id = $1`,
      [inv.id, input.reason, `\nVoided: ${input.reason}`]);
    await q.query(`update rigo.invoice_links set revoked_at = now() where invoice_id = $1 and revoked_at is null`, [inv.id]);
    if (inv.job_id) await q.query(`update rigo.jobs set billing_status = 'ready' where id = $1`, [inv.job_id]);
    await audit(q, cc, 'invoice.voided', { id: inv.id, reason: input.reason });
    await settleInvoiceSteps(q, cc.company.id, inv.id, 'voided', cc.user.name);
    await emit(q, cc.company.id, 'invoice.voided', { type: 'invoice', id: inv.id }, {}, { actorUserId: cc.user.id });
  });
  return c.json({ ok: true });
});

/** Prepare the invoice that replaces a voided one, from the job's record and today's prices. */
billingRoutes.post('/invoices/:id/replacement', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.edit');
  const out = await cc.db.tx(async (q) => {
    const inv = await loadInvoice(cc, q, c.req.param('id'), true);
    if (inv.status !== 'void' || !inv.job_id) throw conflict('Only a voided job invoice can be replaced.');
    return prepareInvoiceForJob(q, cc.company.id, inv.job_id, { userId: cc.user.id });
  });
  return c.json(out);
});

const paymentInput = z.object({
  amountMinor: z.number().int().positive('Enter an amount'), method: z.enum(['cash', 'check', 'card', 'card_terminal', 'bank_transfer', 'other']),
  paidOn: isoDate.optional(), reference: z.string().trim().max(80).default(''), note: z.string().max(500).default(''), idempotencyKey: z.string().min(8).max(80),
});
const checkDate = (cc: CompanyCtx, d: string | undefined) => {
  const t = today(cc);
  if (d && (d > t || d < '2000-01-01')) throw badRequest('The payment date can\'t be in the future.', { fields: { paidOn: 'Choose today or an earlier date' } });
  return d ?? t;
};

/** Record a payment (R6-m2): dated (backdating allowed); anything over the balance becomes customer credit (D6). */
billingRoutes.post('/invoices/:id/payments', async (c) => {
  const cc = c.get('cc');
  need(cc, 'payments.record', 'finance.view');
  const input = await body(c, paymentInput);
  const out = await cc.db.tx(async (q) => {
    const inv = await loadInvoice(cc, q, c.req.param('id'), true);
    if (inv.status !== 'issued') throw conflict('Payments are recorded on issued invoices. Record a deposit on the customer instead.');
    const dup = await q.query(`select 1 from rigo.payments where company_id = $1 and idempotency_key = $2`, [cc.company.id, input.idempotencyKey]);
    if (dup.rows.length) return { duplicate: true, appliedMinor: 0, creditMinor: 0 };
    const paidOn = checkDate(cc, input.paidOn);
    const { rows } = await q.query<{ id: string }>(`insert into rigo.payments (company_id, invoice_id, customer_id, amount_minor, method, note, reference, paid_on, recorded_by, idempotency_key, applied_minor, kind, state)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,'payment','confirmed') returning id`,
      [cc.company.id, inv.id, inv.customer_id, input.amountMinor, input.method, input.note, input.reference, paidOn, cc.user.id, input.idempotencyKey]);
    const applied = await applyPayment(q, cc.company.id, rows[0].id, cc.user.id);
    await audit(q, cc, 'payment.recorded', { invoiceId: inv.id, amountMinor: input.amountMinor, creditMinor: input.amountMinor - applied });
    return { duplicate: false, appliedMinor: applied, creditMinor: input.amountMinor - applied };
  });
  return c.json(out);
});

async function loadPayment(cc: CompanyCtx, q: Q, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Payment');
  const p = (await q.query<any>(`select * from rigo.payments where id = $1 and company_id = $2 for update`, [id, cc.company.id])).rows[0];
  if (!p) throw notFound('Payment');
  return p;
}

/** The office confirms money a driver collected at the stop; it pays the job's invoice once issued. */
billingRoutes.post('/payments/:pid/confirm', async (c) => {
  const cc = c.get('cc');
  need(cc, 'payments.record', 'finance.view');
  const out = await cc.db.tx(async (q) => {
    const p = await loadPayment(cc, q, c.req.param('pid'));
    if (p.state !== 'unconfirmed') throw conflict(`This payment is already ${p.state}.`);
    await q.query(`update rigo.payments set state = 'confirmed', confirmed_by = $2, confirmed_at = now() where id = $1`, [p.id, cc.user.id]);
    let applied = await applyPayment(q, cc.company.id, p.id, cc.user.id);
    // Money taken at a visit that is never billed on its own (covered by a rental plan, or not completed)
    // goes to the customer's credit and pays their open invoices, oldest first.
    let toCredit = false;
    if (!p.invoice_id && p.job_id && p.customer_id) {
      const job = (await q.query<any>(`select billing_status from rigo.jobs where id = $1 and company_id = $2`, [p.job_id, cc.company.id])).rows[0];
      if (job?.billing_status === 'not_billable') {
        toCredit = true;
        await q.query(`update rigo.payments set applied_minor = 0, applied_at = now() where id = $1`, [p.id]);
        await q.query(`insert into rigo.credit_entries (company_id, customer_id, amount_minor, kind, payment_id, note, created_by) values ($1,$2,$3,'overpayment',$4,$5,$6)`,
          [cc.company.id, p.customer_id, Number(p.amount_minor), p.id, 'Paid at a visit that is not billed separately', cc.user.id]);
        const open = (await q.query<any>(`select id from rigo.invoices where company_id = $1 and customer_id = $2 and status = 'issued' and payment_status <> 'paid' order by due_date nulls last, issued_at`, [cc.company.id, p.customer_id])).rows;
        for (const inv of open) applied += await applyCredit(q, cc.company.id, inv.id, cc.user.id);
      }
    }
    await resolveNotices(q, cc.company.id, 'payment', p.id);
    await audit(q, cc, 'payment.confirmed', { id: p.id, amountMinor: Number(p.amount_minor), toCredit });
    return { appliedMinor: applied, waitingForInvoice: !p.invoice_id && !toCredit, toCredit };
  });
  return c.json(out);
});

/**
 * An owner rejects a payment entry (D6): it no longer counts, any credit it created is reversed,
 * and it stays in the history with the reason and who rejected it.
 */
billingRoutes.post('/payments/:pid/reject', async (c) => {
  const cc = c.get('cc');
  need(cc, 'finance.view');
  if (!cc.isOwner) throw forbidden('Only an owner can reject a payment.');
  const input = await body(c, z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) }));
  await cc.db.tx(async (q) => {
    const p = await loadPayment(cc, q, c.req.param('pid'));
    if (p.state === 'rejected') throw conflict('This payment was already rejected.');
    const credit = Number((await q.query<any>(`select coalesce(sum(amount_minor),0)::bigint n from rigo.credit_entries where payment_id = $1`, [p.id])).rows[0].n);
    if (credit !== 0 && p.customer_id) {
      await q.query(`insert into rigo.credit_entries (company_id, customer_id, amount_minor, kind, payment_id, invoice_id, note, created_by) values ($1,$2,$3,'reversal',$4,$5,$6,$7)`,
        [cc.company.id, p.customer_id, -credit, p.id, p.invoice_id, `Payment rejected: ${input.reason}`, cc.user.id]);
      // Credit from this payment that already paid other invoices is taken back from them (newest first),
      // so those invoices are owed again and the customer's credit never goes below zero.
      let short = -(await creditBalance(q, cc.company.id, p.customer_id));
      const used = short > 0 ? (await q.query<any>(`select ic.*, i.number from rigo.invoice_credits ic join rigo.invoices i on i.id = ic.invoice_id
          where ic.company_id = $1 and i.customer_id = $2 and ic.source = 'customer_credit' order by ic.created_at desc for update of ic`, [cc.company.id, p.customer_id])).rows : [];
      for (const u of used) {
        if (short <= 0) break;
        const take = Math.min(short, Number(u.amount_minor));
        if (take === Number(u.amount_minor)) await q.query(`delete from rigo.invoice_credits where id = $1`, [u.id]);
        else await q.query(`update rigo.invoice_credits set amount_minor = amount_minor - $2, note = note || $3 where id = $1`, [u.id, take, ` (less ${formatMoney(take, cc.company.currency)}: payment rejected)`]);
        await q.query(`insert into rigo.credit_entries (company_id, customer_id, amount_minor, kind, payment_id, invoice_id, note, created_by) values ($1,$2,$3,'reversal',$4,$5,$6,$7)`,
          [cc.company.id, p.customer_id, take, p.id, u.invoice_id, `Credit taken back from invoice ${u.number ?? ''}: payment rejected`, cc.user.id]);
        await refreshPayment(q, u.invoice_id);
        short -= take;
      }
    }
    await q.query(`update rigo.payments set state = 'rejected', rejected_reason = $2, rejected_by = $3, rejected_at = now() where id = $1`, [p.id, input.reason, cc.user.id]);
    if (p.kind === 'deposit' && p.plan_id) await q.query(`update rigo.recurring_plans set deposit_received_minor = greatest(0, deposit_received_minor - $2) where id = $1 and company_id = $3`, [p.plan_id, Number(p.amount_minor), cc.company.id]);
    if (p.invoice_id) await refreshPayment(q, p.invoice_id);
    await resolveNotices(q, cc.company.id, 'payment', p.id);
    await audit(q, cc, 'payment.rejected', { id: p.id, amountMinor: Number(p.amount_minor), reason: input.reason });
  });
  return c.json({ ok: true });
});

/** Money given back to the customer for this invoice (it reopens the balance). */
billingRoutes.post('/invoices/:id/refunds', async (c) => {
  const cc = c.get('cc');
  need(cc, 'payments.record', 'finance.view');
  const input = await body(c, paymentInput.extend({ note: z.string().trim().min(3, 'Say why it was refunded').max(500) }));
  await cc.db.tx(async (q) => {
    const inv = await loadInvoice(cc, q, c.req.param('id'), true);
    if (inv.status !== 'issued') throw conflict('Refunds are recorded on issued invoices.');
    const dup = await q.query(`select 1 from rigo.payments where company_id = $1 and idempotency_key = $2`, [cc.company.id, input.idempotencyKey]);
    if (dup.rows.length) return;
    if (input.amountMinor > Number(inv.paid_minor)) throw badRequest(`That is more than was paid (${formatMoney(Number(inv.paid_minor), inv.currency)}).`, { fields: { amountMinor: 'More than was paid' } });
    await q.query(`insert into rigo.payments (company_id, invoice_id, customer_id, amount_minor, method, note, reference, paid_on, recorded_by, idempotency_key, kind, state, applied_minor, applied_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'refund','confirmed',$4,now())`,
      [cc.company.id, inv.id, inv.customer_id, input.amountMinor, input.method, input.note, input.reference, checkDate(cc, input.paidOn), cc.user.id, input.idempotencyKey]);
    await refreshPayment(q, inv.id);
    await audit(q, cc, 'payment.refunded', { invoiceId: inv.id, amountMinor: input.amountMinor });
  });
  return c.json({ ok: true });
});

/** A credit note takes an amount off an issued invoice's balance, with the reason on record. */
billingRoutes.post('/invoices/:id/credit-notes', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.issue', 'finance.view');
  const input = await body(c, z.object({ amountMinor: z.number().int().positive('Enter an amount'), note: z.string().trim().min(3, 'Say why the customer is credited').max(500) }));
  await cc.db.tx(async (q) => {
    const inv = await loadInvoice(cc, q, c.req.param('id'), true);
    if (inv.status !== 'issued') throw conflict('Credit notes are for issued invoices. Edit a draft instead.');
    const balance = balanceDue({ totalMinor: Number(inv.total_minor), paidMinor: Number(inv.paid_minor), creditedMinor: Number(inv.credited_minor) }) ?? 0;
    if (input.amountMinor > balance) throw badRequest(`That is more than the balance due (${formatMoney(balance, inv.currency)}). Refund a payment instead.`, { fields: { amountMinor: 'More than the balance' } });
    await q.query(`insert into rigo.invoice_credits (company_id, invoice_id, amount_minor, source, note, created_by) values ($1,$2,$3,'credit_note',$4,$5)`, [cc.company.id, inv.id, input.amountMinor, input.note, cc.user.id]);
    await refreshPayment(q, inv.id);
    await audit(q, cc, 'invoice.credited', { id: inv.id, amountMinor: input.amountMinor });
  });
  return c.json({ ok: true });
});

billingRoutes.post('/invoices/:id/apply-credit', async (c) => {
  const cc = c.get('cc');
  need(cc, 'payments.record', 'finance.view');
  const applied = await cc.db.tx(async (q) => {
    const inv = await loadInvoice(cc, q, c.req.param('id'), true);
    const n = await applyCredit(q, cc.company.id, inv.id, cc.user.id);
    if (!n) throw conflict('There is no customer credit to apply, or nothing is owed.');
    await audit(q, cc, 'invoice.credit_applied', { id: inv.id, amountMinor: n });
    return n;
  });
  return c.json({ appliedMinor: applied });
});

billingRoutes.post('/invoices/:id/email', async (c) => {
  const cc = c.get('cc');
  need(cc, 'messages.send');
  const out = await cc.db.tx(async (q) => {
    const inv = await loadInvoice(cc, q, c.req.param('id'), true);
    if (inv.status !== 'issued') throw conflict('Issue the invoice before preparing the customer email.');
    const existing = await q.query<any>(`select id from rigo.messages where invoice_id = $1 and status = 'prepared' and coalesce(source_key, '') not like 'reminder:%'`, [inv.id]);
    if (existing.rows[0]) return { messageId: existing.rows[0].id };
    const mail = await invoiceEmail(q, inv.id, await invoiceViewLink(q, cc.company.id, inv.id));
    const { rows } = await q.query<{ id: string }>(`insert into rigo.messages (company_id, customer_id, job_id, invoice_id, channel, recipient, subject, body, created_by) values ($1,$2,$3,$4,'email',$5,$6,$7,$8) returning id`,
      [cc.company.id, mail.customerId, mail.jobId, inv.id, mail.recipient, mail.subject, mail.body, cc.user.id]);
    await q.query(`update rigo.invoices set delivery_status = 'prepared' where id = $1 and delivery_status = 'not_prepared'`, [inv.id]);
    return { messageId: rows[0].id };
  });
  return c.json(out);
});

// ---------------------------------------------------------------- messages
billingRoutes.get('/messages', async (c) => {
  const cc = c.get('cc');
  need(cc, 'messages.view');
  const { rows } = await cc.db.query(`select m.*, c.name as customer_name, j.number as job_number, i.number as invoice_number from rigo.messages m left join rigo.customers c on c.id = m.customer_id left join rigo.jobs j on j.id = m.job_id left join rigo.invoices i on i.id = m.invoice_id where m.company_id = $1 order by m.created_at desc limit 300`, [cc.company.id]);
  // Invoice emails, reminders and statements state amounts and carry a link to the priced invoice:
  // their text goes only to people who see money. Addresses only to people who see contact details.
  const fin = can(cc, 'finance.view'), contact = can(cc, 'customers.contact');
  const messages = rows.map((m: any) => {
    const hidden = !fin && (!!m.invoice_id || !!m.statement_id);
    return { ...m, body: hidden ? null : m.body, bodyHidden: hidden, recipient: contact ? m.recipient : null };
  });
  const caps = capabilities(cc.company);
  return c.json({ messages, capability: caps.email, capabilities: { email: caps.email, sms: caps.sms } });
});

// A message written by a person to one customer (R15-M2), optionally about one of their jobs. The
// address or number comes from the customer record on the server, so people who can't see contact
// details can still write to a customer. It is prepared first; "send" tries the configured service.
billingRoutes.post('/messages', async (c) => {
  const cc = c.get('cc');
  need(cc, 'messages.send');
  const input = await body(c, z.object({
    customerId: z.string().uuid(), jobId: z.string().uuid().nullable().optional(), channel: z.enum(['email', 'sms']),
    subject: z.string().trim().max(200).optional(), body: z.string().trim().min(1, 'Write the message').max(10000), send: z.boolean().optional(),
  }));
  if (input.channel === 'sms' && input.body.length > 640) throw badRequest('A text can be at most 640 characters.', { fields: { body: 'Shorten the text to 640 characters or fewer' } });
  const out = await cc.db.tx(async (q) => {
    const cu = (await q.query<any>(`select id, name, email, phone from rigo.customers where id = $1 and company_id = $2 and merged_into is null`, [input.customerId, cc.company.id])).rows[0];
    if (!cu) throw notFound('Customer');
    let job: any = null;
    if (input.jobId) {
      job = (await q.query<any>(`select id, number, nullif(contact_phone, '') as contact_phone from rigo.jobs where id = $1 and company_id = $2 and customer_id = $3`, [input.jobId, cc.company.id, cu.id])).rows[0];
      if (!job) throw notFound('Job');
    }
    const recipient: string = (input.channel === 'sms' ? textNumber(job?.contact_phone ?? cu.phone) : cu.email) ?? '';
    const subject = input.subject || (job ? `${cc.company.name}: about job #${job.number}` : `${cc.company.name}: a message for you`);
    const { rows } = await q.query<any>(`insert into rigo.messages (company_id, customer_id, job_id, channel, recipient, subject, body, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [cc.company.id, cu.id, job?.id ?? null, input.channel, recipient, subject, input.body, cc.user.id]);
    const m = rows[0];
    if (!input.send) return { id: m.id, status: 'prepared', detail: recipient ? 'Prepared, not sent.' : noRecipient(input.channel) };
    await needConfirmedEmail(cc, 'sending messages to customers');
    if (!recipient) return { id: m.id, status: 'not_sent', detail: noRecipient(input.channel) };
    const r = await deliverMessage(cc.company, m);
    await recordDelivery(q, m, r);
    return { id: m.id, status: r.status === 'blocked' ? 'not_sent' : r.status, detail: r.status === 'blocked' ? `Prepared, not sent. ${r.detail}` : r.detail };
  });
  return c.json(out);
});
const noRecipient = (channel: string) => channel === 'sms' ? 'Prepared, not sent: the customer has no phone number on file.' : 'Prepared, not sent: the customer has no email address on file.';

billingRoutes.patch('/messages/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'messages.send');
  const input = await body(c, z.object({ subject: z.string().max(200).optional(), body: z.string().min(1).max(10000).optional(), recipient: z.string().max(254).optional() }));
  // Messages about money are edited only by people who can read them.
  const money = can(cc, 'finance.view') ? '' : ' and invoice_id is null and statement_id is null';
  const { rows } = await cc.db.query(`update rigo.messages set subject = coalesce($3, subject), body = coalesce($4, body), recipient = coalesce($5, recipient), updated_at = now() where id = $1 and company_id = $2 and status = 'prepared'${money} returning id`,
    [c.req.param('id'), cc.company.id, input.subject ?? null, input.body ?? null, input.recipient ?? null]);
  if (!rows.length) throw conflict('Only prepared messages can be edited.');
  return c.json({ ok: true });
});

billingRoutes.post('/messages/:id/send', async (c) => {
  const cc = c.get('cc');
  need(cc, 'messages.send');
  const out = await cc.db.tx(async (q) => {
    const { rows } = await q.query<any>(`select * from rigo.messages where id = $1 and company_id = $2 for update`, [c.req.param('id'), cc.company.id]);
    const m = rows[0];
    if (!m) throw notFound('Message');
    moneyMessageAllowed(cc, m);
    if (m.status !== 'prepared') throw conflict(`This message is already ${m.status}.`);
    await needConfirmedEmail(cc, 'sending messages to customers');
    if (!m.recipient) throw m.channel === 'sms' ? badRequest('Add a phone number to text first.', { fields: { recipient: 'Enter a phone number' } }) : badRequest('Add a recipient email address first.', { fields: { recipient: 'Enter an email address' } });
    const r = await deliverMessage(cc.company, m);
    await recordDelivery(q, m, r);
    return { status: r.status === 'blocked' ? 'not_sent' : r.status, detail: r.detail };
  });
  return c.json(out);
});

/** Invoice emails, reminders and statements state amounts: only people who see money send them (R17-M1). */
function moneyMessageAllowed(cc: CompanyCtx, m: { invoice_id: string | null; statement_id: string | null }) {
  if ((m.invoice_id || m.statement_id) && !can(cc, 'finance.view')) throw forbidden('Messages about invoices and statements are sent by people who see billing.');
}

/** A person sent the prepared message themselves (outside Rigo). Recorded honestly as such. */
billingRoutes.post('/messages/:id/mark-sent', async (c) => {
  const cc = c.get('cc');
  need(cc, 'messages.send');
  if (cc.isDemo) throw badRequest('Demo messages are simulated only.');
  const found = (await cc.db.query<any>(`select invoice_id, statement_id from rigo.messages where id = $1 and company_id = $2`, [c.req.param('id'), cc.company.id])).rows[0];
  if (!found) throw notFound('Message');
  moneyMessageAllowed(cc, found);
  const { rows } = await cc.db.query<any>(`update rigo.messages set status = 'sent', status_detail = $3, updated_at = now() where id = $1 and company_id = $2 and status = 'prepared' returning invoice_id`,
    [c.req.param('id'), cc.company.id, `Sent outside Rigo; recorded by ${cc.user.name}.`]);
  if (!rows.length) throw conflict('Only prepared messages can be marked as sent.');
  if (rows[0].invoice_id) await cc.db.query(`update rigo.invoices set delivery_status = 'sent' where id = $1`, [rows[0].invoice_id]);
  return c.json({ ok: true });
});

billingRoutes.post('/messages/:id/reply', async (c) => {
  const cc = c.get('cc');
  need(cc, 'messages.send');
  const input = await body(c, z.object({ body: z.string().trim().min(1).max(10000) }));
  await cc.db.tx(async (q) => {
    const { rows } = await q.query<any>(`select * from rigo.messages where id = $1 and company_id = $2`, [c.req.param('id'), cc.company.id]);
    const m = rows[0];
    if (!m) throw notFound('Message');
    // Untrusted customer text is stored as data only.
    await q.query(`insert into rigo.messages (company_id, customer_id, job_id, invoice_id, channel, direction, recipient, subject, body, status, status_detail, created_by) values ($1,$2,$3,$4,$5,'inbound','',$6,$7,'replied','Logged by a team member',$8)`,
      [cc.company.id, m.customer_id, m.job_id, m.invoice_id, m.channel, `Re: ${m.subject}`, input.body, cc.user.id]);
    await q.query(`update rigo.messages set status = 'replied', updated_at = now() where id = $1 and status in ('sent','delivered','simulated')`, [m.id]);
  });
  return c.json({ ok: true });
});

export { resolveNotices };
