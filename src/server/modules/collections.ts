import { Hono } from 'hono';
import { z } from 'zod';
import { getDb, type Db, type Q } from '../db/index.js';
import { type AppEnv, type CompanyCtx, need, can, audit } from '../http/context.js';
import { body } from '../lib/util.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { formatMoney } from '../../shared/billing.js';
import { agingBucket, balanceDue, daysBetween, isStatementDay, reminderStage, REMINDER_LABEL, AGING_BUCKETS, PAYMENT_METHODS, type AgingKey, type ReminderStage } from '../../shared/invoices.js';
import { localDate, addDays } from '../../shared/schedule.js';
import { creditBalance, invoiceViewLink, longDate as longDateIn, customerLang } from './invoicing.js';
import { translate, type Lang, type MessageKey, type Vars } from '../../shared/i18n/index.js';
import { notifyPermission } from './inbox.js';

// Collections (R10-M3): who owes what and for how long, statements, reminders the office approves
// before they go out (D19), monthly statements (D20), deposits and customer credit (D6, D22).
// Nothing here sends anything: messages are prepared, and only a person's "Send" uses the adapter.

export const collectionRoutes = new Hono<AppEnv>();

const longDate = (d: string, lang: Lang = 'en') => longDateIn(d, lang) ?? '';
const balanceOf = (i: any) => balanceDue({ totalMinor: Number(i.total_minor), paidMinor: Number(i.paid_minor), creditedMinor: Number(i.credited_minor ?? 0) }) ?? 0;

/** Issued invoices with something still owed, oldest due first. */
async function openInvoices(q: Q, companyId: string, customerId?: string) {
  const { rows } = await q.query<any>(
    `select i.id, i.number, i.customer_id, i.issued_at, i.due_date, i.total_minor, i.paid_minor, i.credited_minor, i.currency, i.period_start, i.period_end, c.name as customer_name, c.language as customer_language, coalesce(nullif(c.billing_contact->>'email', ''), c.email) as customer_email
       from rigo.invoices i left join rigo.customers c on c.id = i.customer_id
      where i.company_id = $1 and i.status = 'issued' and i.payment_status <> 'paid' and ($2::uuid is null or i.customer_id = $2)
      order by i.due_date nulls last, i.issued_at`, [companyId, customerId ?? null]);
  return rows.filter((r) => balanceOf(r) > 0);
}

// ---------------------------------------------------------------- reminders and monthly statements

async function prepareReminder(q: Q, companyId: string, inv: any, stage: ReminderStage, today: string) {
  const done = await q.query(`select 1 from rigo.messages where company_id = $1 and source_key = $2`, [companyId, `reminder:${inv.id}:${stage}`]);
  if (done.rows.length) return false;
  const co = (await q.query<any>(`select name, phone, settings from rigo.companies where id = $1`, [companyId])).rows[0];
  const balance = balanceOf(inv);
  const late = inv.due_date ? daysBetween(inv.due_date, today) : 0;
  const pay = String(co.settings?.paymentInstructions ?? '').trim();
  const link = await invoiceViewLink(q, companyId, inv.id);
  const lang = customerLang(inv.customer_language);
  const t = (k: MessageKey, v?: Vars) => translate(lang, k, v);
  const lead = stage === 'due_soon'
    ? t('cm.reminderSoon', { number: inv.number, date: longDate(inv.due_date, lang) })
    : t('cm.reminderLate', { number: inv.number, date: longDate(inv.due_date, lang), n: late });
  const text = [
    inv.customer_name ? t('customer.hello', { name: inv.customer_name }) : t('customer.helloPlain'), '', lead, '', t('cm.balanceDue', { amount: formatMoney(balance, inv.currency) }),
    ...(pay ? ['', t('cm.howToPay', { text: pay })] : []), '', t('cm.viewInvoiceShort', { url: link }), '',
    co.phone ? t('cm.questionsCall', { phone: co.phone }) : t('cm.questions'), '', co.name,
  ].join('\n');
  const { rows } = await q.query<{ id: string }>(
    `insert into rigo.messages (company_id, customer_id, invoice_id, channel, recipient, subject, body, status, status_detail, source_key)
     values ($1,$2,$3,'email',$4,$5,$6,'prepared',$7,$8) on conflict do nothing returning id`,
    [companyId, inv.customer_id, inv.id, inv.customer_email ?? '', t(stage === 'due_soon' ? 'cm.reminderSubject' : 'cm.overdueSubject', { number: inv.number, company: co.name }), text,
      `Payment reminder (${REMINDER_LABEL[stage].toLowerCase()}). Review and send, or skip.`, `reminder:${inv.id}:${stage}`]);
  return !!rows[0];
}

/** The statement for one customer as of a date: open invoices by age, recent payments, credit. */
export async function buildStatement(q: Q, companyId: string, customerId: string, asOf: string) {
  // Dates are the company's calendar days, not UTC ones.
  const tz = (await q.query<{ timezone: string }>(`select timezone from rigo.companies where id = $1`, [companyId])).rows[0]?.timezone ?? 'UTC';
  const invs = (await openInvoices(q, companyId, customerId)).filter((i) => !i.issued_at || localDate(new Date(i.issued_at), tz) <= asOf);
  const aging = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0])) as Record<AgingKey, number>;
  const open = invs.map((i) => {
    const bal = balanceOf(i);
    const bucket = agingBucket(i.due_date, asOf);
    aging[bucket] += bal;
    return { id: i.id, number: i.number, issuedOn: i.issued_at ? localDate(new Date(i.issued_at), tz) : null, dueDate: i.due_date, totalMinor: Number(i.total_minor), paidMinor: Number(i.paid_minor) + Number(i.credited_minor ?? 0), balanceMinor: bal, bucket, periodStart: i.period_start, periodEnd: i.period_end };
  });
  const since = addDays(asOf, -31);
  const payments = (await q.query<any>(
    `select p.paid_on, p.amount_minor, p.kind, p.method, p.reference, i.number from rigo.payments p left join rigo.invoices i on i.id = p.invoice_id
      where p.company_id = $1 and p.customer_id = $2 and p.state = 'confirmed' and p.paid_on > $3 and p.paid_on <= $4 order by p.paid_on`, [companyId, customerId, since, asOf])).rows
    .map((p) => ({ paidOn: p.paid_on, amountMinor: Number(p.amount_minor), kind: p.kind, method: (PAYMENT_METHODS as Record<string, string>)[p.method] ?? p.method, reference: p.reference, invoiceNumber: p.number }));
  const credit = await creditBalance(q, companyId, customerId);
  const totalDue = open.reduce((s, i) => s + i.balanceMinor, 0);
  return { asOf, openInvoices: open, payments, aging, creditMinor: credit, totalDueMinor: totalDue };
}

/** Save a statement and prepare its email (not sent). One per customer per date; re-preparing refreshes it. */
export async function prepareStatement(q: Q, companyId: string, customerId: string, asOf: string, userId: string | null) {
  const data = await buildStatement(q, companyId, customerId, asOf);
  const cust = (await q.query<any>(`select name, language, coalesce(nullif(billing_contact->>'email', ''), email) as email from rigo.customers where id = $1 and company_id = $2`, [customerId, companyId])).rows[0];
  if (!cust) throw notFound('Customer');
  const co = (await q.query<any>(`select name, phone, currency, settings from rigo.companies where id = $1`, [companyId])).rows[0];
  const st = (await q.query<{ id: string; message_id: string | null }>(
    `insert into rigo.statements (company_id, customer_id, statement_date, data, balance_minor, created_by) values ($1,$2,$3,$4,$5,$6)
     on conflict (company_id, customer_id, statement_date) do update set data = excluded.data, balance_minor = excluded.balance_minor returning id, message_id`,
    [companyId, customerId, asOf, JSON.stringify(data), data.totalDueMinor, userId])).rows[0];
  const lang = customerLang(cust.language);
  const t = (k: MessageKey, v?: Vars) => translate(lang, k, v);
  const lines = data.openInvoices.map((i) => t('cm.statementLine', { number: i.number, issued: i.issuedOn ?? '—', due: i.dueDate ?? '—', balance: formatMoney(i.balanceMinor, co.currency) }));
  const pay = String(co.settings?.paymentInstructions ?? '').trim();
  const text = [
    t('customer.hello', { name: cust.name }), '', t('cm.statementLead', { company: co.name, date: longDate(asOf, lang) }), '',
    ...(lines.length ? [t('cm.openInvoices'), ...lines] : [t('cm.noOpen')]), '',
    ...(data.payments.length ? [t('cm.paymentsMonth'), ...data.payments.map((p) => `${p.paidOn}  ${t(p.kind === 'refund' ? 'cm.payKind.refund' : p.kind === 'deposit' ? 'cm.payKind.deposit' : 'cm.payKind.payment')}  ${formatMoney(p.amountMinor, co.currency)}${p.invoiceNumber ? `  (${p.invoiceNumber})` : ''}`), ''] : []),
    t('cm.totalDue', { amount: formatMoney(data.totalDueMinor, co.currency) }), ...(data.creditMinor > 0 ? [t('cm.credit', { amount: formatMoney(data.creditMinor, co.currency) })] : []),
    ...(pay ? ['', t('cm.howToPay', { text: pay })] : []), '', co.phone ? t('cm.questionsCall', { phone: co.phone }) : t('cm.questions'), '', co.name,
  ].join('\n');
  const existing = st.message_id ? (await q.query<any>(`select status from rigo.messages where id = $1`, [st.message_id])).rows[0] : null;
  if (existing?.status === 'prepared') {
    await q.query(`update rigo.messages set body = $2, recipient = $3, updated_at = now() where id = $1`, [st.message_id, text, cust.email ?? '']);
  } else if (!existing) {
    const m = await q.query<{ id: string }>(
      `insert into rigo.messages (company_id, customer_id, channel, recipient, subject, body, status, status_detail, source_key, statement_id, created_by)
       values ($1,$2,'email',$3,$4,$5,'prepared','Statement prepared. Review and send.',$6,$7,$8) returning id`,
      [companyId, customerId, cust.email ?? '', t('cm.statementSubject', { company: co.name, date: longDate(asOf, lang) }), text, `statement:${st.id}`, st.id, userId]);
    await q.query(`update rigo.statements set message_id = $2 where id = $1`, [st.id, m.rows[0].id]);
  }
  return { statementId: st.id, ...data };
}

/** Prepare due reminders, and on the 1st the monthly statements, for one company. Safe to run often. */
export async function prepareCollections(db: Db, companyId: string) {
  const co = (await db.query<any>(`select timezone from rigo.companies where id = $1`, [companyId])).rows[0];
  if (!co) return { reminders: 0, statements: 0 };
  const today = localDate(new Date(), co.timezone);
  let reminders = 0; let statements = 0;
  await db.tx(async (q) => {
    for (const inv of await openInvoices(q, companyId)) {
      if (!inv.due_date) continue;
      const stage = reminderStage(inv.due_date, today);
      if (stage && await prepareReminder(q, companyId, inv, stage, today)) reminders++;
    }
    if (isStatementDay(today)) {
      const custs = (await q.query<{ id: string }>(`select c.id from rigo.customers c where c.company_id = $1 and c.monthly_statement
          and not exists (select 1 from rigo.statements s where s.customer_id = c.id and s.statement_date = $2)`, [companyId, today])).rows;
      for (const c of custs) { await prepareStatement(q, companyId, c.id, today, null); statements++; }
    }
    if (reminders) await notifyPermission(q, companyId, 'messages.send', { category: 'needs_action', title: `${reminders} payment reminder${reminders === 1 ? '' : 's'} ready to review`, body: 'Nothing is sent until someone approves it.', link: 'collections', dedupeKey: `reminders:${today}` });
    if (statements) await notifyPermission(q, companyId, 'messages.send', { category: 'needs_action', title: `${statements} monthly statement${statements === 1 ? '' : 's'} ready to review`, body: 'Statements are prepared on the 1st. Review and send them from Collections.', link: 'collections', dedupeKey: `statements:${today}` });
  });
  return { reminders, statements };
}

/** Every company with something to collect or a monthly statement customer (run hourly / by cron). */
export async function runCollections() {
  const db = await getDb();
  const { rows } = await db.query<{ company_id: string }>(
    `select company_id from (select distinct company_id from rigo.invoices where status = 'issued' and payment_status <> 'paid' and due_date is not null and due_date <= current_date + 4
     union select distinct company_id from rigo.customers where monthly_statement) x
     -- An archived company is at rest: no reminders or statements (security review).
     where not exists (select 1 from rigo.companies co where co.id = x.company_id and co.archived_at is not null)`);
  let reminders = 0;
  for (const r of rows) {
    try { reminders += (await prepareCollections(db, r.company_id)).reminders; } catch (e) { console.error('[collections]', r.company_id, e); }
  }
  return reminders;
}

// ---------------------------------------------------------------- routes

const today = (cc: CompanyCtx) => localDate(new Date(), cc.company.timezone);

/** Who owes what, by age (R10-M3): per customer, plus money collected at stops waiting for confirmation. */
collectionRoutes.get('/collections', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.view', 'finance.view');
  const t = today(cc);
  const invs = await openInvoices(cc.db, cc.company.id);
  const byCustomer = new Map<string, any>();
  const totals = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0])) as Record<AgingKey, number>;
  for (const i of invs) {
    const key = i.customer_id ?? 'none';
    const row = byCustomer.get(key) ?? { customerId: i.customer_id, customerName: i.customer_name ?? 'No customer', invoices: 0, balanceMinor: 0, oldestDue: i.due_date, ...Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0])) };
    const bal = balanceOf(i);
    const bucket = agingBucket(i.due_date, t);
    row[bucket] += bal; row.balanceMinor += bal; row.invoices += 1; totals[bucket] += bal;
    byCustomer.set(key, row);
  }
  const credits = (await cc.db.query<any>(`select e.customer_id, c.name, sum(e.amount_minor)::bigint as n from rigo.credit_entries e join rigo.customers c on c.id = e.customer_id where e.company_id = $1 group by e.customer_id, c.name having sum(e.amount_minor) <> 0`, [cc.company.id])).rows;
  const unconfirmed = (await cc.db.query<any>(`select p.id, p.amount_minor, p.method, p.reference, p.paid_on, p.recorded_at, p.photo_file_id, u.name as recorded_by_name, j.id as job_id, j.number as job_number, c.name as customer_name, i.number as invoice_number, i.id as invoice_id
      from rigo.payments p left join rigo.users u on u.id = p.recorded_by left join rigo.jobs j on j.id = p.job_id left join rigo.customers c on c.id = p.customer_id left join rigo.invoices i on i.id = p.invoice_id
      where p.company_id = $1 and p.state = 'unconfirmed' order by p.recorded_at`, [cc.company.id])).rows
    .map((p) => ({ id: p.id, amountMinor: Number(p.amount_minor), method: (PAYMENT_METHODS as Record<string, string>)[p.method] ?? p.method, reference: p.reference, paidOn: p.paid_on, recordedAt: p.recorded_at, recordedByName: p.recorded_by_name,
      hasPhoto: !!p.photo_file_id, jobId: p.job_id, jobNumber: p.job_number, customerName: p.customer_name, invoiceId: p.invoice_id, invoiceNumber: p.invoice_number }));
  const reminders = can(cc, 'messages.view') ? (await cc.db.query<any>(`select m.id, m.subject, m.recipient, m.status, m.status_detail, m.source_key, m.created_at, m.invoice_id, i.number as invoice_number, c.name as customer_name
      from rigo.messages m left join rigo.invoices i on i.id = m.invoice_id left join rigo.customers c on c.id = m.customer_id
      where m.company_id = $1 and m.status = 'prepared' and (m.source_key like 'reminder:%' or m.source_key like 'statement:%') order by m.created_at`, [cc.company.id])).rows
    .map((m) => ({ id: m.id, kind: m.source_key.startsWith('statement:') ? 'statement' : 'reminder', stage: m.source_key.startsWith('reminder:') ? REMINDER_LABEL[m.source_key.split(':')[2] as ReminderStage] : null,
      subject: m.subject, recipient: can(cc, 'customers.contact') ? m.recipient : null, createdAt: m.created_at, invoiceId: m.invoice_id, invoiceNumber: m.invoice_number, customerName: m.customer_name })) : [];
  return c.json({
    asOf: t, currency: cc.company.currency, buckets: AGING_BUCKETS, totals, totalMinor: Object.values(totals).reduce((a, b) => a + b, 0),
    customers: [...byCustomer.values()].sort((a, b) => b.balanceMinor - a.balanceMinor),
    credits: credits.map((r) => ({ customerId: r.customer_id, customerName: r.name, creditMinor: Number(r.n) })),
    unconfirmed, reminders,
    can: { send: can(cc, 'messages.send'), confirm: can(cc, 'payments.record'), reject: cc.isOwner, prepare: can(cc, 'invoices.edit') },
  });
});

collectionRoutes.post('/collections/prepare', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.edit');
  return c.json(await prepareCollections(cc.db, cc.company.id));
});

/** The office decides not to send a prepared reminder or statement; it stays on record as skipped. */
collectionRoutes.post('/messages/:id/skip', async (c) => {
  const cc = c.get('cc');
  need(cc, 'messages.send');
  const { rows } = await cc.db.query(`update rigo.messages set status = 'skipped', status_detail = $3, updated_at = now() where id = $1 and company_id = $2 and status = 'prepared' returning id`,
    [c.req.param('id'), cc.company.id, `Not sent; skipped by ${cc.user.name}.`]);
  if (!rows.length) throw conflict('Only prepared messages can be skipped.');
  return c.json({ ok: true });
});

async function loadCustomer(cc: CompanyCtx, q: Q, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Customer');
  const r = (await q.query<any>(`select * from rigo.customers where id = $1 and company_id = $2`, [id, cc.company.id])).rows[0];
  if (!r) throw notFound('Customer');
  return r;
}

/** A customer's account: what they owe, their credit and its history, and their statements. */
collectionRoutes.get('/customers/:id/account', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.view', 'finance.view');
  const cust = await loadCustomer(cc, cc.db, c.req.param('id'));
  const t = today(cc);
  const invs = await openInvoices(cc.db, cc.company.id, cust.id);
  const credit = await creditBalance(cc.db, cc.company.id, cust.id);
  const history = (await cc.db.query<any>(`select e.*, i.number as invoice_number, u.name as created_by_name from rigo.credit_entries e left join rigo.invoices i on i.id = e.invoice_id left join rigo.users u on u.id = e.created_by
      where e.company_id = $1 and e.customer_id = $2 order by e.created_at desc limit 50`, [cc.company.id, cust.id])).rows
    .map((e) => ({ id: e.id, amountMinor: Number(e.amount_minor), kind: e.kind, note: e.note, invoiceId: e.invoice_id, invoiceNumber: e.invoice_number, createdAt: e.created_at, createdByName: e.created_by_name }));
  const statements = (await cc.db.query<any>(`select s.id, s.statement_date, s.balance_minor, m.status as message_status from rigo.statements s left join rigo.messages m on m.id = s.message_id
      where s.company_id = $1 and s.customer_id = $2 order by s.statement_date desc limit 24`, [cc.company.id, cust.id])).rows
    .map((s) => ({ id: s.id, date: s.statement_date, balanceMinor: Number(s.balance_minor), messageStatus: s.message_status }));
  const unconfirmed = Number((await cc.db.query<any>(`select coalesce(sum(amount_minor),0)::bigint n from rigo.payments where company_id = $1 and customer_id = $2 and state = 'unconfirmed'`, [cc.company.id, cust.id])).rows[0].n);
  return c.json({
    balanceMinor: invs.reduce((s, i) => s + balanceOf(i), 0), overdueMinor: invs.filter((i) => i.due_date && i.due_date < t).reduce((s, i) => s + balanceOf(i), 0), openInvoices: invs.length,
    creditMinor: credit, unconfirmedMinor: unconfirmed, history, statements,
    can: { deposit: can(cc, 'payments.record'), refundCredit: can(cc, 'payments.record') && credit > 0, statement: can(cc, 'invoices.edit') },
  });
});

const moneyInput = z.object({
  amountMinor: z.number().int().positive('Enter an amount'), method: z.enum(['cash', 'check', 'card', 'card_terminal', 'bank_transfer', 'other']),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), reference: z.string().trim().max(80).default(''), note: z.string().max(500).default(''), idempotencyKey: z.string().min(8).max(80),
});

/** A deposit or prepayment (R8-M3, D22): customer credit that pays their next invoices when issued. */
collectionRoutes.post('/customers/:id/deposits', async (c) => {
  const cc = c.get('cc');
  need(cc, 'payments.record', 'finance.view');
  const input = await body(c, moneyInput);
  const out = await cc.db.tx(async (q) => {
    const cust = await loadCustomer(cc, q, c.req.param('id'));
    const dup = await q.query(`select 1 from rigo.payments where company_id = $1 and idempotency_key = $2`, [cc.company.id, input.idempotencyKey]);
    if (dup.rows.length) return { duplicate: true };
    const t = today(cc);
    if (input.paidOn && input.paidOn > t) throw badRequest('The date can\'t be in the future.', { fields: { paidOn: 'Choose today or an earlier date' } });
    const p = await q.query<{ id: string }>(`insert into rigo.payments (company_id, customer_id, amount_minor, method, note, reference, paid_on, recorded_by, idempotency_key, kind, state, applied_minor, applied_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'deposit','confirmed',0,now()) returning id`,
      [cc.company.id, cust.id, input.amountMinor, input.method, input.note, input.reference, input.paidOn ?? t, cc.user.id, input.idempotencyKey]);
    await q.query(`insert into rigo.credit_entries (company_id, customer_id, amount_minor, kind, payment_id, note, created_by) values ($1,$2,$3,'deposit',$4,$5,$6)`,
      [cc.company.id, cust.id, input.amountMinor, p.rows[0].id, input.note || 'Deposit', cc.user.id]);
    // It pays anything already issued and owed now, oldest first.
    const { applyCredit } = await import('./invoicing.js');
    for (const i of await openInvoices(q, cc.company.id, cust.id)) await applyCredit(q, cc.company.id, i.id, cc.user.id);
    await audit(q, cc, 'payment.deposit', { customerId: cust.id, amountMinor: input.amountMinor });
    return { duplicate: false };
  });
  return c.json(out);
});

/** Pay unused credit back to the customer. */
collectionRoutes.post('/customers/:id/credit-refunds', async (c) => {
  const cc = c.get('cc');
  need(cc, 'payments.record', 'finance.view');
  const input = await body(c, moneyInput.extend({ note: z.string().trim().min(3, 'Say why it was refunded').max(500) }));
  await cc.db.tx(async (q) => {
    const cust = await loadCustomer(cc, q, c.req.param('id'));
    await q.query(`select id from rigo.customers where id = $1 for update`, [cust.id]);
    const dup = await q.query(`select 1 from rigo.payments where company_id = $1 and idempotency_key = $2`, [cc.company.id, input.idempotencyKey]);
    if (dup.rows.length) return;
    const credit = await creditBalance(q, cc.company.id, cust.id);
    if (input.amountMinor > credit) throw badRequest(`That is more than the customer's credit (${formatMoney(credit, cc.company.currency)}).`, { fields: { amountMinor: 'More than the credit' } });
    const p = await q.query<{ id: string }>(`insert into rigo.payments (company_id, customer_id, amount_minor, method, note, reference, paid_on, recorded_by, idempotency_key, kind, state, applied_minor, applied_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'refund','confirmed',0,now()) returning id`,
      [cc.company.id, cust.id, input.amountMinor, input.method, input.note, input.reference, input.paidOn ?? today(cc), cc.user.id, input.idempotencyKey]);
    await q.query(`insert into rigo.credit_entries (company_id, customer_id, amount_minor, kind, payment_id, note, created_by) values ($1,$2,$3,'refund',$4,$5,$6)`,
      [cc.company.id, cust.id, -input.amountMinor, p.rows[0].id, input.note, cc.user.id]);
    await audit(q, cc, 'payment.credit_refunded', { customerId: cust.id, amountMinor: input.amountMinor });
  });
  return c.json({ ok: true });
});

collectionRoutes.post('/customers/:id/statements', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.edit', 'finance.view');
  const out = await cc.db.tx(async (q) => {
    const cust = await loadCustomer(cc, q, c.req.param('id'));
    const r = await prepareStatement(q, cc.company.id, cust.id, today(cc), cc.user.id);
    await audit(q, cc, 'statement.prepared', { customerId: cust.id, statementId: r.statementId });
    return r;
  });
  return c.json(out);
});

collectionRoutes.get('/statements/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.view', 'finance.view');
  const id = c.req.param('id');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Statement');
  const s = (await cc.db.query<any>(`select s.*, c.name as customer_name, c.billing_address, m.status as message_status from rigo.statements s join rigo.customers c on c.id = s.customer_id left join rigo.messages m on m.id = s.message_id
      where s.id = $1 and s.company_id = $2`, [id, cc.company.id])).rows[0];
  if (!s) throw notFound('Statement');
  const co = cc.company;
  return c.json({
    statement: { id: s.id, date: s.statement_date, customerId: s.customer_id, customerName: s.customer_name, billingAddress: can(cc, 'customers.contact') ? s.billing_address : undefined, messageId: s.message_id, messageStatus: s.message_status, ...s.data },
    company: { name: co.name, phone: co.phone, email: co.email, address: co.address, logo: !!co.branding?.logoFileId, paymentInstructions: co.settings?.paymentInstructions ?? '', remitTo: co.settings?.remitTo ?? '' },
    currency: co.currency, buckets: AGING_BUCKETS,
  });
});
