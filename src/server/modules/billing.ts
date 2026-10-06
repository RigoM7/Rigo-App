import { Hono } from 'hono';
import { z } from 'zod';
import type { Q } from '../db/index.js';
import { type AppEnv, type CompanyCtx, need, can, audit } from '../http/context.js';
import { body } from '../lib/util.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { computeTotals, lineAmount, type DraftLine } from '../../shared/billing.js';
import { emit, invalidateApprovalsFor } from '../automation/engine.js';
import { issueInvoice, invoiceEmail } from './invoicing.js';
import { deliverMessage, capabilities } from '../adapters/index.js';
import { resolveNotices } from './inbox.js';

// Invoices, payments and customer communications.

export const billingRoutes = new Hono<AppEnv>();

const money = (cc: CompanyCtx, v: number | null) => (can(cc, 'finance.view') ? v : undefined);

function serializeInvoice(cc: CompanyCtx, i: any) {
  return {
    id: i.id, number: i.number, status: i.status, deliveryStatus: i.delivery_status, paymentStatus: i.payment_status, currency: i.currency,
    subtotalMinor: money(cc, i.subtotal_minor), discountMinor: money(cc, i.discount_minor), taxMinor: money(cc, i.tax_minor), totalMinor: money(cc, i.total_minor), paidMinor: money(cc, i.paid_minor),
    holdReasons: i.hold_reasons, notes: i.notes, dueDays: i.due_days, issuedAt: i.issued_at, approvedAt: i.approved_at, version: i.version, createdAt: i.created_at,
    customerId: i.customer_id, customerName: i.customer_name, jobId: i.job_id, jobNumber: i.job_number, recurringPlanId: i.recurring_plan_id,
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
  else if (status && status !== 'all') { vals.push(status); where += ` and i.status = $2`; }
  const { rows } = await cc.db.query(`select i.*, c.name as customer_name, j.number as job_number from rigo.invoices i left join rigo.customers c on c.id = i.customer_id left join rigo.jobs j on j.id = i.job_id where ${where} order by i.created_at desc limit 300`, vals);
  return c.json({ invoices: rows.map((i) => serializeInvoice(cc, i)) });
});

async function loadInvoice(cc: CompanyCtx, q: Q, id: string, lock = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Invoice');
  const { rows } = await q.query<any>(`select i.* from rigo.invoices i where i.id = $1 and i.company_id = $2${lock ? ' for update' : ''}`, [id, cc.company.id]);
  if (!rows[0]) throw notFound('Invoice');
  return rows[0];
}

billingRoutes.get('/invoices/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.view');
  const inv = await loadInvoice(cc, cc.db, c.req.param('id'));
  const extra = (await cc.db.query<any>(`select c.name as customer_name, c.email as customer_email, c.billing_address, j.number as job_number, j.completed_at, l.address as location_address, s.name as service_name
      from rigo.invoices i left join rigo.customers c on c.id = i.customer_id left join rigo.jobs j on j.id = i.job_id left join rigo.locations l on l.id = j.location_id left join rigo.services s on s.id = j.service_id where i.id = $1`, [inv.id])).rows[0];
  const fin = can(cc, 'finance.view');
  const lines = (await cc.db.query<any>(`select * from rigo.invoice_lines where invoice_id = $1 order by position`, [inv.id])).rows.map((l) => ({
    id: l.id, description: l.description, quantity: String(l.quantity), unit: l.unit, kind: l.kind, taxable: l.taxable,
    rateMinor: fin ? l.rate_minor : undefined, amountMinor: fin ? l.amount_minor : undefined, rateMissing: l.rate_minor === null,
  }));
  const payments = fin ? (await cc.db.query(`select p.*, u.name as recorded_by_name from rigo.payments p left join rigo.users u on u.id = p.recorded_by where p.invoice_id = $1 order by p.recorded_at`, [inv.id])).rows : [];
  const approvals = (await cc.db.query(`select a.id, a.status, a.title, a.created_at, a.decided_at, a.decision_note, u.name as decided_by_name from rigo.approvals a join rigo.actions x on x.id = a.action_id left join rigo.users u on u.id = a.decided_by where a.subject_type = 'invoice' and a.subject_id = $1 order by a.created_at`, [inv.id])).rows;
  const messages = can(cc, 'messages.view') ? (await cc.db.query(`select id, channel, subject, status, status_detail, recipient, created_at from rigo.messages where invoice_id = $1 order by created_at desc`, [inv.id])).rows : [];
  const co = cc.company;
  return c.json({
    invoice: { ...serializeInvoice(cc, inv), customerName: extra?.customer_name, customerEmail: can(cc, 'customers.contact') ? extra?.customer_email : undefined, billingAddress: can(cc, 'customers.contact') ? extra?.billing_address : undefined,
      jobNumber: extra?.job_number, completedAt: extra?.completed_at, locationAddress: extra?.location_address, serviceName: extra?.service_name },
    lines, payments, approvals, messages,
    company: { name: co.name, phone: co.phone, email: co.email, address: co.address, logo: !!co.branding?.logoFileId, accent: co.branding?.accent ?? null },
    approvalRequired: co.settings?.invoiceApprovalRequired !== false,
    can: { edit: can(cc, 'invoices.edit') && fin && ['held', 'draft', 'pending_approval', 'approved'].includes(inv.status), approve: can(cc, 'invoices.approve') && ['draft', 'pending_approval'].includes(inv.status),
      issue: can(cc, 'invoices.issue') && ['draft', 'approved'].includes(inv.status), void: can(cc, 'invoices.issue') && inv.status === 'issued' && inv.paid_minor === 0,
      pay: can(cc, 'payments.record') && inv.status === 'issued' && inv.payment_status !== 'paid', message: can(cc, 'messages.send') && inv.status === 'issued' },
  });
});

const lineSchema = z.object({
  description: z.string().trim().min(1, 'Enter a description').max(200), quantity: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Enter a quantity like 12 or 12.5'),
  unit: z.string().max(20).default(''), rateMinor: z.number().int().min(0).max(1_000_000_000).nullable(), taxable: z.boolean().default(false), kind: z.enum(['charge', 'discount']).default('charge'),
});

billingRoutes.put('/invoices/:id/lines', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.edit', 'finance.view');
  const input = await body(c, z.object({ lines: z.array(lineSchema).min(1).max(50), notes: z.string().max(2000).optional(), version: z.number().int(), taxRateBp: z.number().int().min(0).max(5000).nullable().optional() }));
  const out = await cc.db.tx(async (q) => {
    const inv = await loadInvoice(cc, q, c.req.param('id'), true);
    if (inv.version !== input.version) throw conflict('This invoice changed since you opened it. Reload to see the latest version.');
    if (!['held', 'draft', 'pending_approval', 'approved'].includes(inv.status)) throw conflict('Issued or voided invoices cannot be edited.');
    const lines: DraftLine[] = input.lines.map((l) => ({ ...l, amountMinor: l.kind === 'discount' ? (l.rateMinor === null ? null : -Math.abs(lineAmount(l.quantity, l.rateMinor) as number)) : lineAmount(l.quantity, l.rateMinor) }));
    const svcTax = (await q.query<any>(`select s.tax_rate_bp from rigo.jobs j join rigo.services s on s.id = j.service_id where j.id = $1`, [inv.job_id])).rows[0]?.tax_rate_bp ?? null;
    const totals = computeTotals(lines, input.taxRateBp !== undefined ? input.taxRateBp : svcTax);
    await q.query(`delete from rigo.invoice_lines where invoice_id = $1`, [inv.id]);
    let pos = 0;
    for (const l of lines) await q.query(`insert into rigo.invoice_lines (invoice_id, company_id, position, description, quantity, unit, rate_minor, amount_minor, taxable, kind) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [inv.id, cc.company.id, pos++, l.description, l.quantity, l.unit, l.rateMinor, l.amountMinor, l.taxable, l.kind]);
    const held = totals.totalMinor === null;
    // Editing invalidates any approval given for the previous version.
    await q.query(`update rigo.invoices set subtotal_minor = $2, discount_minor = $3, tax_minor = $4, total_minor = $5, hold_reasons = $6, status = $7, notes = coalesce($8, notes), approved_by = null, approved_at = null, version = version + 1, updated_at = now() where id = $1`,
      [inv.id, totals.subtotalMinor, totals.discountMinor, totals.taxMinor, totals.totalMinor, JSON.stringify(totals.holdReasons), held ? 'held' : 'draft', input.notes ?? null]);
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

billingRoutes.post('/invoices/:id/approve', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.approve');
  const input = await body(c, z.object({ version: z.number().int() }));
  const out = await cc.db.tx(async (q) => {
    const inv = await loadInvoice(cc, q, c.req.param('id'), true);
    if (inv.version !== input.version) throw conflict('This invoice changed since you reviewed it. Review the latest version before approving.');
    if (inv.status === 'held') throw conflict('Held invoices cannot be approved until the hold reasons are fixed.');
    if (!['draft', 'pending_approval'].includes(inv.status)) throw conflict(`This invoice is ${inv.status} and does not need approval.`);
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
    return r;
  });
  return c.json(out);
});

billingRoutes.post('/invoices/:id/void', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.issue');
  const input = await body(c, z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) }));
  await cc.db.tx(async (q) => {
    const inv = await loadInvoice(cc, q, c.req.param('id'), true);
    if (inv.status !== 'issued') throw conflict('Only issued invoices can be voided. Edit drafts instead.');
    if (inv.paid_minor > 0) throw conflict('This invoice has payments recorded and cannot be voided.');
    await q.query(`update rigo.invoices set status = 'void', notes = notes || $2, version = version + 1, updated_at = now() where id = $1`, [inv.id, `\nVoided: ${input.reason}`]);
    if (inv.job_id) await q.query(`update rigo.jobs set billing_status = 'ready' where id = $1`, [inv.job_id]);
    await audit(q, cc, 'invoice.voided', { id: inv.id, reason: input.reason });
  });
  return c.json({ ok: true });
});

billingRoutes.post('/invoices/:id/payments', async (c) => {
  const cc = c.get('cc');
  need(cc, 'payments.record', 'finance.view');
  const input = await body(c, z.object({ amountMinor: z.number().int().positive('Enter an amount'), method: z.enum(['cash', 'check', 'card', 'bank_transfer', 'other']), note: z.string().max(500).default(''), idempotencyKey: z.string().min(8).max(80) }));
  const out = await cc.db.tx(async (q) => {
    const inv = await loadInvoice(cc, q, c.req.param('id'), true);
    if (inv.status !== 'issued') throw conflict('Payments are recorded on issued invoices.');
    const dup = await q.query(`select 1 from rigo.payments where company_id = $1 and idempotency_key = $2`, [cc.company.id, input.idempotencyKey]);
    if (dup.rows.length) return { duplicate: true };
    if (inv.paid_minor + input.amountMinor > inv.total_minor) throw badRequest('That amount is more than the balance due.', { fields: { amountMinor: 'More than the balance' } });
    await q.query(`insert into rigo.payments (company_id, invoice_id, amount_minor, method, note, recorded_by, idempotency_key) values ($1,$2,$3,$4,$5,$6,$7)`, [cc.company.id, inv.id, input.amountMinor, input.method, input.note, cc.user.id, input.idempotencyKey]);
    const paid = inv.paid_minor + input.amountMinor;
    await q.query(`update rigo.invoices set paid_minor = $2, payment_status = $3, updated_at = now() where id = $1`, [inv.id, paid, paid >= inv.total_minor ? 'paid' : 'partially_paid']);
    await audit(q, cc, 'payment.recorded', { invoiceId: inv.id, amountMinor: input.amountMinor });
    return { duplicate: false };
  });
  return c.json(out);
});

billingRoutes.post('/invoices/:id/email', async (c) => {
  const cc = c.get('cc');
  need(cc, 'messages.send');
  const out = await cc.db.tx(async (q) => {
    const inv = await loadInvoice(cc, q, c.req.param('id'), true);
    if (inv.status !== 'issued') throw conflict('Issue the invoice before preparing the customer email.');
    const existing = await q.query<any>(`select id from rigo.messages where invoice_id = $1 and status = 'prepared'`, [inv.id]);
    if (existing.rows[0]) return { messageId: existing.rows[0].id };
    const mail = await invoiceEmail(q, inv.id);
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
  return c.json({ messages: rows, capability: capabilities(cc.company).email });
});

billingRoutes.patch('/messages/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'messages.send');
  const input = await body(c, z.object({ subject: z.string().max(200).optional(), body: z.string().min(1).max(10000).optional(), recipient: z.string().max(254).optional() }));
  const { rows } = await cc.db.query(`update rigo.messages set subject = coalesce($3, subject), body = coalesce($4, body), recipient = coalesce($5, recipient), updated_at = now() where id = $1 and company_id = $2 and status = 'prepared' returning id`,
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
    if (m.status !== 'prepared') throw conflict(`This message is already ${m.status}.`);
    if (!m.recipient) throw badRequest('Add a recipient email address first.', { fields: { recipient: 'Enter an email address' } });
    const r = await deliverMessage(cc.company, m);
    if (r.status === 'simulated') {
      await q.query(`update rigo.messages set status = 'simulated', status_detail = $2, provider = $3, updated_at = now() where id = $1`, [m.id, r.detail, r.provider]);
      if (m.invoice_id) await q.query(`update rigo.invoices set delivery_status = 'simulated' where id = $1`, [m.invoice_id]);
    }
    return { status: r.status === 'simulated' ? 'simulated' : 'not_sent', detail: r.detail };
  });
  return c.json(out);
});

/** A person sent the prepared message themselves (outside Rigo). Recorded honestly as such. */
billingRoutes.post('/messages/:id/mark-sent', async (c) => {
  const cc = c.get('cc');
  need(cc, 'messages.send');
  if (cc.isDemo) throw badRequest('Demo messages are simulated only.');
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
