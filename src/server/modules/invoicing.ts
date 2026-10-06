import type { Q } from '../db/index.js';
import { buildLines, computeTotals, formatInvoiceNumber, formatMoney, type DraftLine } from '../../shared/billing.js';
import type { FieldDef, PriceLine } from '../../shared/services.js';
import { conflict, notFound } from '../http/errors.js';
import { emit } from '../automation/engine.js';

// Invoice preparation and issuing. One invoice per billable event (billable_key), deterministic
// totals, explicit holds for missing configuration, and separate draft/approval/delivery/payment states.

export interface PrepareResult { invoiceId: string; created: boolean; held: boolean; reasons: string[] }

async function persistLines(q: Q, companyId: string, invoiceId: string, lines: DraftLine[]) {
  await q.query(`delete from rigo.invoice_lines where invoice_id = $1`, [invoiceId]);
  let pos = 0;
  for (const l of lines) {
    await q.query(`insert into rigo.invoice_lines (invoice_id, company_id, position, description, quantity, unit, rate_minor, amount_minor, taxable, kind) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [invoiceId, companyId, pos++, l.description, l.quantity, l.unit, l.rateMinor, l.amountMinor, l.taxable, l.kind]);
  }
}

export async function prepareInvoiceForJob(q: Q, companyId: string, jobId: string, actor: { userId: string | null; depth?: number }): Promise<PrepareResult> {
  const { rows } = await q.query<any>(
    `select j.*, s.pricing, s.fields, s.tax_rate_bp, s.name as service_name, c.currency
       from rigo.jobs j left join rigo.services s on s.id = j.service_id join rigo.companies c on c.id = j.company_id
      where j.id = $1 and j.company_id = $2 for update of j`, [jobId, companyId]);
  const job = rows[0];
  if (!job) throw notFound('Job');
  const key = `job:${job.id}`;
  const existing = await q.query<any>(`select id, status from rigo.invoices where company_id = $1 and billable_key = $2`, [companyId, key]);
  if (existing.rows[0]) {
    // Duplicate submissions and retries return the same invoice instead of creating another.
    return { invoiceId: existing.rows[0].id, created: false, held: existing.rows[0].status === 'held', reasons: [] };
  }
  if (!['completed', 'partial'].includes(job.status)) {
    throw conflict(job.status === 'unsuccessful' ? 'Unsuccessful visits are not billed automatically. Create an invoice manually if a charge applies.' : 'Only completed or partially completed jobs can be invoiced.');
  }
  if (!job.service_id) throw conflict('The job has no service, so there is no pricing to use.');
  const fields = (job.fields ?? []) as FieldDef[];
  const labels = Object.fromEntries(fields.map((f) => [f.key, f.label]));
  const types = Object.fromEntries(fields.map((f) => [f.key, f.type]));
  const values = { ...(job.details ?? {}), ...(job.completion?.values ?? {}) };
  const built = buildLines((job.pricing ?? []) as PriceLine[], values, labels, types);
  const totals = computeTotals(built.lines, job.tax_rate_bp);
  const reasons = [...built.holdReasons, ...totals.holdReasons.filter((r) => !r.startsWith('One or more lines'))];
  if (job.status === 'partial') reasons.unshift('The visit was only partly completed. Review quantities before approving.');
  const held = built.holdReasons.length > 0 || totals.totalMinor === null || job.status === 'partial';
  const ins = await q.query<{ id: string }>(
    `insert into rigo.invoices (company_id, billable_key, customer_id, job_id, status, currency, subtotal_minor, discount_minor, tax_minor, total_minor, hold_reasons, due_days)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, coalesce((select (settings->>'invoiceDueDays')::int from rigo.companies where id = $1), 30)) returning id`,
    [companyId, key, job.customer_id, job.id, held ? 'held' : 'draft', job.currency, totals.subtotalMinor, totals.discountMinor, totals.taxMinor, totals.totalMinor, JSON.stringify(reasons)]);
  await persistLines(q, companyId, ins.rows[0].id, built.lines);
  await q.query(`update rigo.jobs set billing_status = $2, updated_at = now() where id = $1`, [job.id, held ? 'held' : 'drafted']);
  await q.query(`insert into rigo.job_events (company_id, job_id, type, actor_user_id, actor_label, data) values ($1,$2,'invoice_prepared',$3,$4,$5)`,
    [companyId, job.id, actor.userId, actor.depth ? 'Rigo automation' : '', JSON.stringify({ invoiceId: ins.rows[0].id, held, reasons })]);
  await emit(q, companyId, 'invoice.prepared', { type: 'invoice', id: ins.rows[0].id }, { held }, { depth: actor.depth ?? 0, actorUserId: actor.userId });
  return { invoiceId: ins.rows[0].id, created: true, held, reasons };
}

/**
 * Recalculate a draft/held invoice after a person edits it. A person editing or reviewing the lines
 * also clears the "partial visit" review hold; missing rates or quantities still hold it.
 */
export async function recalcInvoice(q: Q, invoiceId: string, opts: { taxRateBp?: number | null; bumpVersion?: boolean } = {}) {
  const { rows } = await q.query<any>(`select i.*, s.tax_rate_bp from rigo.invoices i left join rigo.jobs j on j.id = i.job_id left join rigo.services s on s.id = j.service_id where i.id = $1`, [invoiceId]);
  const inv = rows[0];
  const lines = (await q.query<any>(`select * from rigo.invoice_lines where invoice_id = $1 order by position`, [invoiceId])).rows.map((l) => ({
    description: l.description, quantity: String(l.quantity), unit: l.unit, rateMinor: l.rate_minor, amountMinor: l.amount_minor, taxable: l.taxable, kind: l.kind,
  })) as DraftLine[];
  const tax = opts.taxRateBp !== undefined ? opts.taxRateBp : inv.tax_rate_bp ?? null;
  const totals = computeTotals(lines, tax);
  const reasons = [...totals.holdReasons];
  const held = totals.totalMinor === null;
  await q.query(`update rigo.invoices set subtotal_minor = $2, discount_minor = $3, tax_minor = $4, total_minor = $5, hold_reasons = $6,
                  status = case when status in ('held','draft','pending_approval','approved') then $7 else status end,
                  approved_by = null, approved_at = null,
                  version = version + $8, updated_at = now() where id = $1`,
    [invoiceId, totals.subtotalMinor, totals.discountMinor, totals.taxMinor, totals.totalMinor, JSON.stringify(reasons), held ? 'held' : 'draft', opts.bumpVersion === false ? 0 : 1]);
  if (inv.job_id) await q.query(`update rigo.jobs set billing_status = $2 where id = $1 and billing_status in ('held','drafted','approved')`, [inv.job_id, held ? 'held' : 'drafted']);
  return { held, reasons };
}

/** Rebuild a held invoice's charge lines from its job and the service's current pricing. Manual discount lines are kept. */
export async function rebuildHeldInvoice(q: Q, invoiceId: string) {
  const { rows } = await q.query<any>(`select i.id, i.company_id, i.status, j.details, j.completion, j.status as job_status, s.pricing, s.fields, s.tax_rate_bp
      from rigo.invoices i join rigo.jobs j on j.id = i.job_id join rigo.services s on s.id = j.service_id where i.id = $1 for update of i`, [invoiceId]);
  const inv = rows[0];
  if (!inv || inv.status !== 'held') return;
  const fields = (inv.fields ?? []) as FieldDef[];
  const labels = Object.fromEntries(fields.map((f) => [f.key, f.label]));
  const types = Object.fromEntries(fields.map((f) => [f.key, f.type]));
  const built = buildLines(inv.pricing ?? [], { ...(inv.details ?? {}), ...(inv.completion?.values ?? {}) }, labels, types);
  const discounts = (await q.query<any>(`select * from rigo.invoice_lines where invoice_id = $1 and kind = 'discount' order by position`, [invoiceId])).rows
    .map((l) => ({ description: l.description, quantity: String(l.quantity), unit: l.unit, rateMinor: l.rate_minor, amountMinor: l.amount_minor, taxable: false, kind: 'discount' as const }));
  await persistLines(q, inv.company_id, invoiceId, [...built.lines, ...discounts]);
  const totals = computeTotals([...built.lines, ...discounts], inv.tax_rate_bp);
  const reasons = [...built.holdReasons, ...totals.holdReasons.filter((r) => !r.startsWith('One or more lines'))];
  if (inv.job_status === 'partial') reasons.unshift('The visit was only partly completed. Review quantities before approving.');
  const held = reasons.length > 0 || totals.totalMinor === null;
  await q.query(`update rigo.invoices set subtotal_minor = $2, discount_minor = $3, tax_minor = $4, total_minor = $5, hold_reasons = $6, status = $7, version = version + 1, updated_at = now() where id = $1`,
    [invoiceId, totals.subtotalMinor, totals.discountMinor, totals.taxMinor, totals.totalMinor, JSON.stringify(reasons), held ? 'held' : 'draft']);
}

export async function issueInvoice(q: Q, companyId: string, invoiceId: string, actor: { userId: string | null; depth?: number }) {
  const { rows } = await q.query<any>(`select * from rigo.invoices where id = $1 and company_id = $2 for update`, [invoiceId, companyId]);
  const inv = rows[0];
  if (!inv) throw notFound('Invoice');
  if (inv.status === 'issued') return { number: inv.number, already: true };
  if (inv.status === 'void') throw conflict('This invoice was voided.');
  if (inv.status === 'held' || inv.total_minor === null) throw conflict(`This invoice is on hold: ${(inv.hold_reasons as string[]).join(' ') || 'it is incomplete.'}`);
  const seq = await q.query<{ invoice_seq: number }>(`update rigo.companies set invoice_seq = invoice_seq + 1 where id = $1 returning invoice_seq`, [companyId]);
  const number = formatInvoiceNumber(seq.rows[0].invoice_seq);
  await q.query(`update rigo.invoices set status = 'issued', number = $2, issued_at = now(), version = version + 1, updated_at = now() where id = $1`, [invoiceId, number]);
  if (inv.job_id) await q.query(`update rigo.jobs set billing_status = 'issued' where id = $1`, [inv.job_id]);
  await emit(q, companyId, 'invoice.issued', { type: 'invoice', id: invoiceId }, {}, { depth: actor.depth ?? 0, actorUserId: actor.userId });
  return { number, already: false };
}

/** Plain-text line for the customer email: "Gasoline: 187.4 gal × $3.89 = $728.99" or "Delivery fee: $45.00". */
function emailLine(l: { description: string; quantity: string; unit: string; rate_minor: number | null; amount_minor: number | null; kind: string }, currency: string) {
  if (l.kind === 'discount') return `${l.description}: -${formatMoney(Math.abs(l.amount_minor ?? 0), currency)}`;
  const qty = String(l.quantity);
  if (qty === '1' && !l.unit) return `${l.description}: ${formatMoney(l.amount_minor, currency)}`;
  return `${l.description}: ${qty}${l.unit ? ` ${l.unit}` : ''} × ${formatMoney(l.rate_minor, currency)} = ${formatMoney(l.amount_minor, currency)}`;
}

/** Due date in the company's time zone, e.g. "November 5, 2026". */
function dueDate(issuedAt: string | Date | null, dueDays: number | null, timeZone: string) {
  if (!issuedAt || dueDays === null || dueDays === undefined) return null;
  const d = new Date(new Date(issuedAt).getTime() + dueDays * 86400_000);
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone }).format(d);
}

const EMAIL_LINE_LIMIT = 10;

/** The customer email for an invoice: its lines, total, due date and how to pay. Text only, prepared for review. */
export async function invoiceEmail(q: Q, invoiceId: string) {
  const { rows } = await q.query<any>(
    `select i.*, c.name as customer_name, c.email as customer_email, co.name as company_name, co.phone as company_phone, co.email as company_email, co.timezone, co.settings as company_settings, j.number as job_number
       from rigo.invoices i left join rigo.customers c on c.id = i.customer_id join rigo.companies co on co.id = i.company_id left join rigo.jobs j on j.id = i.job_id
      where i.id = $1`, [invoiceId]);
  const i = rows[0];
  const lines = (await q.query<any>(`select description, quantity, unit, rate_minor, amount_minor, kind from rigo.invoice_lines where invoice_id = $1 order by position`, [invoiceId])).rows;
  const due = dueDate(i.issued_at, i.due_days, i.timezone);
  const pay = String(i.company_settings?.paymentInstructions ?? '').trim();
  const subject = `${i.company_name} invoice ${i.number ?? '(draft)'}`;
  const body = [
    `Hello ${i.customer_name ?? ''},`.trim(),
    '',
    `Thank you for your business. Here is invoice ${i.number ?? '(draft)'}${i.job_number ? ` for job #${i.job_number}` : ''}.`,
    '',
    ...lines.slice(0, EMAIL_LINE_LIMIT).map((l) => emailLine(l, i.currency)),
    ...(lines.length > EMAIL_LINE_LIMIT ? [`(and ${lines.length - EMAIL_LINE_LIMIT} more line${lines.length - EMAIL_LINE_LIMIT === 1 ? '' : 's'})`] : []),
    ...(i.discount_minor ? [`Discount: -${formatMoney(i.discount_minor, i.currency)}`] : []),
    ...(i.tax_minor ? [`Tax: ${formatMoney(i.tax_minor, i.currency)}`] : []),
    `Total: ${formatMoney(i.total_minor, i.currency)}`,
    due ? `Due: ${due}${i.due_days ? ` (within ${i.due_days} days)` : ''}` : i.due_days ? `Due within ${i.due_days} days of the invoice date.` : 'Due on receipt.',
    ...(pay ? ['', `How to pay: ${pay}`] : []),
    '',
    `Questions? Reply to this message${i.company_phone ? ` or call ${i.company_phone}` : ''}.`,
    '',
    i.company_name,
  ].join('\n');
  return { subject, body, recipient: i.customer_email ?? '', customerId: i.customer_id, jobId: i.job_id };
}
