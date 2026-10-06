import { createHash, randomBytes } from 'node:crypto';
import type { Q } from '../db/index.js';
import { config } from '../config.js';
import { buildDeliveryLines, type DeliveryLine } from '../../shared/deliveries.js';
import { computeTotals, formatInvoiceNumber, formatMoney, formatRate, rateToMinor, resolveDiscounts, lineAmount, type DraftLine } from '../../shared/billing.js';
import { readBillingRule, isPeriodic, PLAN_VISIT_LABEL, type PlanVisit } from '../../shared/rentals.js';
import { balanceDue, dueDateFor, termsLabel } from '../../shared/invoices.js';
import { localDate } from '../../shared/schedule.js';
import { readPricing, type FieldDef } from '../../shared/services.js';
import { conflict, notFound } from '../http/errors.js';
import { emit } from '../automation/engine.js';

// Invoice preparation and issuing. One invoice per billable event (billable_key), deterministic
// totals, explicit holds for missing configuration, and separate draft/approval/delivery/payment states.

export interface PrepareResult { invoiceId: string | null; created: boolean; held: boolean; reasons: string[]; covered?: string }

export async function persistLines(q: Q, companyId: string, invoiceId: string, lines: DraftLine[]) {
  await q.query(`delete from rigo.invoice_lines where invoice_id = $1`, [invoiceId]);
  let pos = 0;
  for (const l of lines) {
    // rate_minor (whole cents) is still written for older readers; rate_e4 is the rate that's charged.
    await q.query(`insert into rigo.invoice_lines (invoice_id, company_id, position, description, quantity, unit, rate_minor, rate_e4, amount_minor, taxable, kind, price_date, booked_rate_e4, note, percent_bp)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [invoiceId, companyId, pos++, l.description, l.quantity, l.unit, rateToMinor(l.rateE4), l.rateE4, l.amountMinor, l.taxable, l.kind, l.priceDate ?? null, l.bookedRateE4 ?? null, l.note ?? '', l.percentBp ?? null]);
  }
}

/** A stored invoice line as a draft line (older lines only have whole-cent rates). */
export function lineFromRow(l: any): DraftLine {
  const rateE4 = l.rate_e4 !== null && l.rate_e4 !== undefined ? Number(l.rate_e4) : l.rate_minor !== null && l.rate_minor !== undefined ? Number(l.rate_minor) * 100 : null;
  return {
    description: l.description, quantity: String(l.quantity), unit: l.unit, rateE4, amountMinor: l.amount_minor === null ? null : Number(l.amount_minor),
    taxable: l.taxable, kind: l.kind, note: l.note ?? '', priceDate: l.price_date ? String(l.price_date instanceof Date ? l.price_date.toISOString().slice(0, 10) : l.price_date).slice(0, 10) : null,
    bookedRateE4: l.booked_rate_e4 === null || l.booked_rate_e4 === undefined ? null : Number(l.booked_rate_e4),
    percentBp: l.percent_bp === null || l.percent_bp === undefined ? null : Number(l.percent_bp),
  };
}

/** Everything about a job that decides its invoice lines: service pricing, customer prices and tax exemption. */
async function pricingContext(q: Q, job: any) {
  const cust = job.customer_id ? (await q.query<any>(`select tax_exempt, price_overrides from rigo.customers where id = $1`, [job.customer_id])).rows[0] : null;
  const fields = (job.fields ?? []) as FieldDef[];
  return {
    pricing: readPricing(job.pricing),
    labels: Object.fromEntries(fields.map((f) => [f.key, f.label])),
    types: Object.fromEntries(fields.map((f) => [f.key, f.type])),
    values: { ...(job.details ?? {}), ...(job.completion?.values ?? {}) },
    // Several products or tanks at one stop (R7-M1): one charge line each, the delivery fee once.
    deliveries: (job.completion?.lines ?? []) as DeliveryLine[],
    overrides: (job.service_id && cust?.price_overrides?.[job.service_id]) || {},
    taxExempt: !!cust?.tax_exempt,
    // A confirmed quantity the driver flagged as over the truck's capacity or far over the request.
    quantityHold: job.completion?.quantityReview && !job.completion?.quantityReviewed ? `Check the quantity before approving: ${job.completion.quantityReview}` : null,
  };
}

export async function prepareInvoiceForJob(q: Q, companyId: string, jobId: string, actor: { userId: string | null; depth?: number }): Promise<PrepareResult> {
  const { rows } = await q.query<any>(
    `select j.*, s.pricing, s.fields, s.tax_rate_bp, s.name as service_name, c.currency
       from rigo.jobs j left join rigo.services s on s.id = j.service_id join rigo.companies c on c.id = j.company_id
      where j.id = $1 and j.company_id = $2 for update of j`, [jobId, companyId]);
  const job = rows[0];
  if (!job) throw notFound('Job');
  // The invoice goes to whoever pays: a bill-to customer when the job has one (a realtor paying for an
  // inspection), with their prices, tax exemption and terms; the service address stays the job's (R6-M4).
  if (job.bill_to_customer_id) job.customer_id = job.bill_to_customer_id;
  const key = `job:${job.id}`;
  const existing = await q.query<any>(`select id, status from rigo.invoices where company_id = $1 and billable_key = $2`, [companyId, key]);
  if (existing.rows[0]) {
    // Duplicate submissions and retries return the same invoice instead of creating another.
    return { invoiceId: existing.rows[0].id, created: false, held: existing.rows[0].status === 'held', reasons: [] };
  }
  if (!['completed', 'partial'].includes(job.status)) {
    throw conflict(job.status === 'unsuccessful' ? 'Unsuccessful visits are not billed automatically. Create an invoice manually if a charge applies.' : 'Only completed or partially completed jobs can be invoiced.');
  }
  // A visit from a rental plan is paid for by the rent (R8-C1): routine service isn't billed again.
  // Delivery, pickup and extra visits bill at the plan's price when it has one.
  let planLines: DraftLine[] | null = null;
  if (job.recurring_plan_id) {
    const plan = (await q.query<any>(`select name, billing_rule from rigo.recurring_plans where id = $1`, [job.recurring_plan_id])).rows[0];
    const rule = plan ? readBillingRule(plan.billing_rule) : null;
    if (plan && rule && isPeriodic(rule.frequency)) {
      const visit = (job.details?._visit ?? 'service') as PlanVisit;
      const price = visit === 'service' ? undefined : rule.visitPrices[visit];
      if (visit === 'service' || ((price === null || price === undefined) && visit !== 'extra')) {
        const why = `Covered by the plan "${plan.name}"; not billed separately.`;
        await q.query(`update rigo.jobs set billing_status = 'not_billable', updated_at = now() where id = $1`, [job.id]);
        await q.query(`insert into rigo.job_events (company_id, job_id, type, actor_user_id, actor_label, data) values ($1,$2,'not_billed',$3,$4,$5)`,
          [companyId, job.id, actor.userId, actor.depth ? 'Rigo automation' : '', JSON.stringify({ reason: why })]);
        return { invoiceId: null, created: false, held: false, reasons: [], covered: why };
      }
      if (price !== null && price !== undefined) planLines = [{ description: `${PLAN_VISIT_LABEL[visit]}: ${plan.name}`, quantity: '1', unit: '', rateE4: price, amountMinor: lineAmount('1', price), taxable: rule.taxable, kind: 'charge' }];
    }
  }
  if (!job.service_id && !planLines) throw conflict('The job has no service, so there is no pricing to use.');
  const ctx = await pricingContext(q, job);
  const built = planLines ? { lines: planLines, holdReasons: [] as string[] } : buildDeliveryLines(ctx.pricing, ctx.values, ctx.deliveries, ctx.labels, ctx.types, { overrides: ctx.overrides, bookedRates: job.booked_rates ?? undefined, currency: job.currency });
  const totals = computeTotals(built.lines, job.tax_rate_bp, [], { taxExempt: ctx.taxExempt });
  const reasons = [...built.holdReasons, ...totals.holdReasons.filter((r) => !r.startsWith('One or more lines'))];
  if (ctx.quantityHold) reasons.unshift(ctx.quantityHold);
  if (job.status === 'partial') reasons.unshift('The visit was only partly completed. Review quantities before approving.');
  const held = built.holdReasons.length > 0 || totals.totalMinor === null || job.status === 'partial' || !!ctx.quantityHold;
  // A voided invoice no longer bills the job; the new one says which invoice it replaces.
  const replaces = (await q.query<any>(`select id from rigo.invoices where company_id = $1 and job_id = $2 and status = 'void' order by voided_at desc nulls last, created_at desc limit 1`, [companyId, job.id])).rows[0]?.id ?? null;
  const ins = await q.query<{ id: string }>(
    `insert into rigo.invoices (company_id, billable_key, customer_id, job_id, status, currency, subtotal_minor, discount_minor, tax_minor, total_minor, hold_reasons, due_days, kind, location_id, replaces_invoice_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, $12, 'job', $13, $14) returning id`,
    [companyId, key, job.customer_id, job.id, held ? 'held' : 'draft', job.currency, totals.subtotalMinor, totals.discountMinor, totals.taxMinor, totals.totalMinor, JSON.stringify(reasons),
      await termsFor(q, companyId, job.customer_id), job.location_id, replaces]);
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
  const { rows } = await q.query<any>(`select i.*, s.tax_rate_bp, coalesce(c.tax_exempt, false) as tax_exempt from rigo.invoices i left join rigo.jobs j on j.id = i.job_id left join rigo.services s on s.id = j.service_id
      left join rigo.customers c on c.id = i.customer_id where i.id = $1`, [invoiceId]);
  const inv = rows[0];
  const lines = resolveDiscounts((await q.query<any>(`select * from rigo.invoice_lines where invoice_id = $1 order by position`, [invoiceId])).rows.map(lineFromRow), { allowFree: inv.free_confirmed }).lines;
  const tax = opts.taxRateBp !== undefined ? opts.taxRateBp : inv.tax_rate_bp ?? null;
  const totals = computeTotals(lines, tax, [], { taxExempt: inv.tax_exempt });
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
  const { rows } = await q.query<any>(`select i.id, i.company_id, i.status, i.currency, i.free_confirmed, j.details, j.completion, j.status as job_status, coalesce(j.bill_to_customer_id, j.customer_id) as customer_id, j.service_id, j.booked_rates, s.pricing, s.fields, s.tax_rate_bp
      from rigo.invoices i join rigo.jobs j on j.id = i.job_id join rigo.services s on s.id = j.service_id where i.id = $1 for update of i`, [invoiceId]);
  const inv = rows[0];
  if (!inv || inv.status !== 'held') return;
  const ctx = await pricingContext(q, inv);
  const built = buildDeliveryLines(ctx.pricing, ctx.values, ctx.deliveries, ctx.labels, ctx.types, { overrides: ctx.overrides, bookedRates: inv.booked_rates ?? undefined, currency: inv.currency });
  const discounts = (await q.query<any>(`select * from rigo.invoice_lines where invoice_id = $1 and kind = 'discount' order by position`, [invoiceId])).rows
    .map((l) => ({ ...lineFromRow(l), taxable: false, kind: 'discount' as const }));
  const all = resolveDiscounts([...built.lines, ...discounts], { allowFree: inv.free_confirmed }).lines;
  await persistLines(q, inv.company_id, invoiceId, all);
  const totals = computeTotals(all, inv.tax_rate_bp, [], { taxExempt: ctx.taxExempt });
  const reasons = [...built.holdReasons, ...totals.holdReasons.filter((r) => !r.startsWith('One or more lines'))];
  if (ctx.quantityHold) reasons.unshift(ctx.quantityHold);
  if (inv.job_status === 'partial') reasons.unshift('The visit was only partly completed. Review quantities before approving.');
  const held = reasons.length > 0 || totals.totalMinor === null;
  await q.query(`update rigo.invoices set subtotal_minor = $2, discount_minor = $3, tax_minor = $4, total_minor = $5, hold_reasons = $6, status = $7, version = version + 1, updated_at = now() where id = $1`,
    [invoiceId, totals.subtotalMinor, totals.discountMinor, totals.taxMinor, totals.totalMinor, JSON.stringify(reasons), held ? 'held' : 'draft']);
}

/** Payment terms for a customer: their own terms, else the company's (net 30 by default, D18). */
export async function termsFor(q: Q, companyId: string, customerId: string | null) {
  const { rows } = await q.query<any>(`select (select payment_terms_days from rigo.customers where id = $2) as cust, (select settings->>'invoiceDueDays' from rigo.companies where id = $1) as co`, [companyId, customerId]);
  const cust = rows[0]?.cust; const co = rows[0]?.co;
  return cust !== null && cust !== undefined ? Number(cust) : co !== null && co !== undefined ? Number(co) : 30;
}

/**
 * Recalculate what an invoice has been paid and credited, and its payment status. Payments count
 * once confirmed (a driver's collection waits for the office); refunds take money back off.
 */
export async function refreshPayment(q: Q, invoiceId: string) {
  const { rows } = await q.query<any>(`select i.total_minor,
      coalesce((select sum(case when p.kind = 'refund' then -p.amount_minor else coalesce(p.applied_minor, p.amount_minor) end) from rigo.payments p where p.invoice_id = i.id and p.state = 'confirmed' and p.kind in ('payment','refund')
        -- A payment counts once applied; rows recorded before payments were applied (no date, no amount) count in full.
        and (p.applied_at is not null or p.applied_minor is null or p.kind = 'refund')), 0)::bigint as paid,
      coalesce((select sum(amount_minor) from rigo.invoice_credits c where c.invoice_id = i.id), 0)::bigint as credited
    from rigo.invoices i where i.id = $1`, [invoiceId]);
  const r = rows[0];
  if (!r) return;
  const total = r.total_minor === null ? null : Number(r.total_minor);
  const paid = Number(r.paid); const credited = Number(r.credited);
  const balance = balanceDue({ totalMinor: total, paidMinor: paid, creditedMinor: credited });
  const status = total !== null && balance === 0 ? 'paid' : paid + credited > 0 ? 'partially_paid' : 'unpaid';
  await q.query(`update rigo.invoices set paid_minor = $2, credited_minor = $3, payment_status = $4, updated_at = now() where id = $1`, [invoiceId, paid, credited, status]);
}

/** The customer's unused credit (overpayments and deposits, less what was applied or refunded). */
export async function creditBalance(q: Q, companyId: string, customerId: string) {
  const { rows } = await q.query<{ n: string }>(`select coalesce(sum(amount_minor), 0)::bigint as n from rigo.credit_entries where company_id = $1 and customer_id = $2`, [companyId, customerId]);
  return Number(rows[0].n);
}

/**
 * Apply a confirmed payment to an issued invoice: up to the balance due, and any amount over it
 * becomes customer credit (D6). Returns how much was applied.
 */
export async function applyPayment(q: Q, companyId: string, paymentId: string, userId: string | null) {
  const { rows } = await q.query<any>(`select p.*, i.status as invoice_status from rigo.payments p left join rigo.invoices i on i.id = p.invoice_id where p.id = $1 and p.company_id = $2 for update of p`, [paymentId, companyId]);
  const p = rows[0];
  if (!p || p.state !== 'confirmed' || p.kind !== 'payment' || !p.invoice_id || p.invoice_status !== 'issued' || p.applied_at !== null) return 0;
  await refreshPayment(q, p.invoice_id);
  const inv = (await q.query<any>(`select total_minor, paid_minor, credited_minor from rigo.invoices where id = $1`, [p.invoice_id])).rows[0];
  const balance = balanceDue({ totalMinor: Number(inv.total_minor), paidMinor: Number(inv.paid_minor), creditedMinor: Number(inv.credited_minor) }) ?? 0;
  const applied = Math.min(Number(p.amount_minor), balance);
  const extra = Number(p.amount_minor) - applied;
  await q.query(`update rigo.payments set applied_minor = $2, applied_at = now() where id = $1`, [p.id, applied]);
  if (extra > 0 && p.customer_id) {
    await q.query(`insert into rigo.credit_entries (company_id, customer_id, amount_minor, kind, payment_id, invoice_id, note, created_by) values ($1,$2,$3,'overpayment',$4,$5,$6,$7)`,
      [companyId, p.customer_id, extra, p.id, p.invoice_id, 'Paid more than the balance due', userId]);
  }
  await refreshPayment(q, p.invoice_id);
  return applied;
}

/** Use the customer's credit (deposits, overpayments) on an issued invoice, up to its balance. */
export async function applyCredit(q: Q, companyId: string, invoiceId: string, userId: string | null, max?: number) {
  const inv = (await q.query<any>(`select * from rigo.invoices where id = $1 and company_id = $2 for update`, [invoiceId, companyId])).rows[0];
  if (!inv || inv.status !== 'issued' || !inv.customer_id) return 0;
  await q.query(`select id from rigo.customers where id = $1 for update`, [inv.customer_id]);
  const credit = await creditBalance(q, companyId, inv.customer_id);
  const balance = balanceDue({ totalMinor: inv.total_minor === null ? null : Number(inv.total_minor), paidMinor: Number(inv.paid_minor), creditedMinor: Number(inv.credited_minor) }) ?? 0;
  const amount = Math.min(credit, balance, max ?? Infinity);
  if (amount <= 0) return 0;
  await q.query(`insert into rigo.invoice_credits (company_id, invoice_id, amount_minor, source, note, created_by) values ($1,$2,$3,'customer_credit','Customer credit applied',$4)`, [companyId, invoiceId, amount, userId]);
  await q.query(`insert into rigo.credit_entries (company_id, customer_id, amount_minor, kind, invoice_id, note, created_by) values ($1,$2,$3,'applied',$4,$5,$6)`,
    [companyId, inv.customer_id, -amount, invoiceId, `Applied to invoice ${inv.number ?? ''}`.trim(), userId]);
  await refreshPayment(q, invoiceId);
  return amount;
}

/** The next invoice number: the company's prefix and sequence, skipping any number already used. */
async function nextNumber(q: Q, companyId: string) {
  for (;;) {
    const seq = await q.query<any>(`update rigo.companies set invoice_seq = invoice_seq + 1 where id = $1 returning invoice_seq, coalesce(settings->>'invoicePrefix', 'INV-') as prefix`, [companyId]);
    const number = formatInvoiceNumber(seq.rows[0].invoice_seq, seq.rows[0].prefix);
    const taken = await q.query(`select 1 from rigo.invoices where company_id = $1 and number = $2`, [companyId, number]);
    if (!taken.rows.length) return number;
  }
}

/**
 * Issue: number it, set the due date from the customer's terms, and keep the names and addresses
 * as they are today so later edits never change an issued invoice (R10-M4). Payments the office
 * already confirmed for the job and the customer's credit are applied.
 */
export async function issueInvoice(q: Q, companyId: string, invoiceId: string, actor: { userId: string | null; depth?: number }) {
  const { rows } = await q.query<any>(`select i.*, co.timezone from rigo.invoices i join rigo.companies co on co.id = i.company_id where i.id = $1 and i.company_id = $2 for update of i`, [invoiceId, companyId]);
  const inv = rows[0];
  if (!inv) throw notFound('Invoice');
  if (inv.status === 'issued') return { number: inv.number, already: true };
  if (inv.status === 'void') throw conflict('This invoice was voided.');
  if (inv.status === 'held' || inv.total_minor === null) throw conflict(`This invoice is on hold: ${(inv.hold_reasons as string[]).join(' ') || 'it is incomplete.'}`);
  const number = await nextNumber(q, companyId);
  const today = localDate(new Date(), inv.timezone);
  const terms = await termsFor(q, companyId, inv.customer_id);
  const billTo = (await q.query<any>(`select c.name as customer_name, c.billing_address, coalesce(nullif(c.billing_contact->>'email', ''), c.email) as email,
        coalesce(j.location_snapshot->>'label', l.label) as location_label, coalesce(j.location_snapshot->>'address', l.address) as location_address,
        s.name as service_name, j.number as job_number, j.completed_at
      from rigo.invoices i left join rigo.customers c on c.id = i.customer_id left join rigo.jobs j on j.id = i.job_id
      left join rigo.locations l on l.id = coalesce(j.location_id, i.location_id) left join rigo.services s on s.id = j.service_id where i.id = $1`, [invoiceId])).rows[0];
  await q.query(`update rigo.invoices set status = 'issued', number = $2, issued_at = now(), due_days = $3, due_date = $4, bill_to = $5, version = version + 1, updated_at = now() where id = $1`,
    [invoiceId, number, terms, dueDateFor(today, terms), JSON.stringify({ customerName: billTo?.customer_name ?? null, billingAddress: billTo?.billing_address ?? null, email: billTo?.email ?? null,
      locationLabel: billTo?.location_label ?? null, locationAddress: billTo?.location_address ?? null, serviceName: billTo?.service_name ?? null, jobNumber: billTo?.job_number ?? null, completedAt: billTo?.completed_at ?? null })]);
  if (inv.job_id) {
    await q.query(`update rigo.jobs set billing_status = 'issued' where id = $1`, [inv.job_id]);
    // Money the driver collected at the stop, once the office confirmed it, pays this invoice.
    const collected = await q.query<{ id: string }>(`update rigo.payments set invoice_id = $2 where company_id = $1 and job_id = $3 and (invoice_id is null or invoice_id = $2) and kind = 'payment' and state <> 'rejected' and applied_at is null returning id`, [companyId, invoiceId, inv.job_id]);
    for (const p of collected.rows) await applyPayment(q, companyId, p.id, actor.userId);
  }
  await applyCredit(q, companyId, invoiceId, actor.userId);
  await refreshPayment(q, invoiceId);
  await emit(q, companyId, 'invoice.issued', { type: 'invoice', id: invoiceId }, {}, { depth: actor.depth ?? 0, actorUserId: actor.userId });
  return { number, already: false };
}

/** Plain-text line for the customer email: "Gasoline: 187.4 gal × $3.89 = $728.99" or "Delivery fee: $45.00". */
function emailLine(row: any, currency: string) {
  const l = lineFromRow(row);
  if (l.kind === 'discount') return `${l.description}: -${formatMoney(Math.abs(l.amountMinor ?? 0), currency)}`;
  if (l.quantity === '1' && !l.unit) return `${l.description}: ${formatMoney(l.amountMinor, currency)}`;
  return `${l.description}: ${l.quantity}${l.unit ? ` ${l.unit}` : ''} × ${formatRate(l.rateE4, currency)} = ${formatMoney(l.amountMinor, currency)}${l.note?.startsWith('Minimum') ? ' (minimum charge)' : ''}`;
}

/** "November 5, 2026" from a company-local date. */
function longDate(d: string | null) {
  if (!d) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
}

const EMAIL_LINE_LIMIT = 10;

/**
 * The customer email for an invoice: its lines, total, what's been paid, the balance and due date,
 * how to pay, and a link to view or print it. Text only, prepared for review (R2-m9, R15-m4).
 */
export async function invoiceEmail(q: Q, invoiceId: string, viewUrl?: string) {
  const { rows } = await q.query<any>(
    `select i.*, c.name as customer_name, coalesce(nullif(c.billing_contact->>'email', ''), c.email) as customer_email, co.name as company_name, co.phone as company_phone, co.email as company_email, co.timezone, co.settings as company_settings, j.number as job_number
       from rigo.invoices i left join rigo.customers c on c.id = i.customer_id join rigo.companies co on co.id = i.company_id left join rigo.jobs j on j.id = i.job_id
      where i.id = $1`, [invoiceId]);
  const i = rows[0];
  const lines = (await q.query<any>(`select * from rigo.invoice_lines where invoice_id = $1 order by position`, [invoiceId])).rows;
  const due = longDate(i.due_date);
  const s = i.company_settings ?? {};
  const pay = String(s.paymentInstructions ?? '').trim();
  const remit = String(s.remitTo ?? '').trim();
  const paid = Number(i.paid_minor) + Number(i.credited_minor ?? 0);
  const balance = balanceDue({ totalMinor: i.total_minor === null ? null : Number(i.total_minor), paidMinor: Number(i.paid_minor), creditedMinor: Number(i.credited_minor ?? 0) });
  const subject = `${i.company_name} invoice ${i.number ?? '(draft)'}`;
  const body = [
    `Hello ${i.bill_to?.customerName ?? i.customer_name ?? ''},`.trim(),
    '',
    `Thank you for your business. Here is invoice ${i.number ?? '(draft)'}${i.job_number ? ` for job #${i.job_number}` : ''}${i.period_start ? ` for ${longDate(i.period_start)} to ${longDate(i.period_end)}` : ''}.`,
    '',
    ...lines.slice(0, EMAIL_LINE_LIMIT).map((l) => emailLine(l, i.currency)),
    ...(lines.length > EMAIL_LINE_LIMIT ? [`(and ${lines.length - EMAIL_LINE_LIMIT} more line${lines.length - EMAIL_LINE_LIMIT === 1 ? '' : 's'})`] : []),
    ...(i.tax_minor ? [`Tax: ${formatMoney(i.tax_minor, i.currency)}`] : []),
    `Total: ${formatMoney(i.total_minor, i.currency)}`,
    ...(paid > 0 ? [`Paid and credited: ${formatMoney(paid, i.currency)}`, `Balance due: ${formatMoney(balance, i.currency)}`] : []),
    i.due_days === 0 ? 'Due on receipt.' : due ? `Due: ${due} (${termsLabel(i.due_days)})` : `Due within ${i.due_days ?? 30} days of the invoice date.`,
    ...(pay ? ['', `How to pay: ${pay}`] : []),
    ...(remit ? [`Send payments to: ${remit}`] : []),
    ...(viewUrl ? ['', `View or print this invoice: ${viewUrl}`, '(This link works for 60 days.)'] : []),
    '',
    `Questions? Reply to this message${i.company_phone ? ` or call ${i.company_phone}` : ''}.`,
    '',
    i.company_name,
  ].join('\n');
  return { subject, body, recipient: i.customer_email ?? '', customerId: i.customer_id, jobId: i.job_id };
}

/**
 * A view link for the customer: random, stored only as a hash, expiring after 60 days, revoked
 * when the invoice is voided. It shows this one invoice and nothing else.
 */
export async function invoiceViewLink(q: Q, companyId: string, invoiceId: string) {
  const token = randomBytes(32).toString('base64url');
  await q.query(`insert into rigo.invoice_links (token_hash, company_id, invoice_id, expires_at) values ($1,$2,$3, now() + interval '60 days')`,
    [createHash('sha256').update(token).digest('hex'), companyId, invoiceId]);
  return `${config.appUrl}/i/${token}`;
}

