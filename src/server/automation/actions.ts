import type { Q } from '../db/index.js';
import { prepareInvoiceForJob, issueInvoice, invoiceEmail, invoiceViewLink } from '../modules/invoicing.js';
import { deliverMessage } from '../adapters/index.js';
import { notifyRoles, notifyUsers } from '../modules/inbox.js';
import { subjectLabel } from './engine.js';

// Workflow action primitives. Each handler is idempotent for its action id / subject so a retry
// never duplicates an invoice, message or job.

export interface HandlerInput {
  q: Q; companyId: string; companyKind: string; actorUserId: string | null; actionId: string; depth: number;
  subject: { type: string; id: string }; params: { roles?: string[]; assignee?: boolean; text?: string }; context: Record<string, string>;
}
export interface HandlerResult { status: 'completed' | 'simulated' | 'blocked'; explanation: string; result?: unknown; context?: Record<string, string>; link?: string }

async function prepareMessage(q: Q, companyId: string, actionId: string, m: { channel: 'email'; recipient: string; subject: string; body: string; customerId: string | null; jobId: string | null; invoiceId: string | null; userId: string | null }) {
  const existing = await q.query<{ id: string }>(`select id from rigo.messages where company_id = $1 and source_key = $2`, [companyId, `action:${actionId}`]);
  if (existing.rows[0]) return existing.rows[0].id;
  const { rows } = await q.query<{ id: string }>(
    `insert into rigo.messages (company_id, customer_id, job_id, invoice_id, channel, recipient, subject, body, status, source_key, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'prepared',$9,$10) returning id`,
    [companyId, m.customerId, m.jobId, m.invoiceId, m.channel, m.recipient, m.subject, m.body, `action:${actionId}`, m.userId]);
  return rows[0].id;
}

export const handlers: Record<string, (i: HandlerInput) => Promise<HandlerResult>> = {
  async 'invoice.prepare'(i) {
    const r = await prepareInvoiceForJob(i.q, i.companyId, i.subject.id, { userId: i.actorUserId, depth: i.depth });
    if (r.held) {
      return { status: 'blocked', explanation: `Invoice prepared but on hold: ${r.reasons.join(' ') || 'it needs review.'}`, result: r, context: { invoiceId: r.invoiceId }, link: `invoices/${r.invoiceId}` };
    }
    return { status: 'completed', explanation: r.created ? 'Invoice draft prepared.' : 'An invoice already existed for this job; reused it.', result: r, context: { invoiceId: r.invoiceId } };
  },

  async 'invoice.issue'(i) {
    const { rows } = await i.q.query<any>(`select i.status, i.hold_reasons, c.settings from rigo.invoices i join rigo.companies c on c.id = i.company_id where i.id = $1`, [i.subject.id]);
    if (rows[0]?.status === 'draft' && rows[0].settings?.invoiceApprovalRequired !== false) {
      // The company-wide approval rule applies even when a workflow step has no approval of its own.
      return { status: 'blocked', explanation: 'Not issued: company settings require invoice approval before issuing. Add an approval to this step or approve the invoice.', link: `invoices/${i.subject.id}` };
    }
    if (rows[0]?.status === 'held') return { status: 'blocked', explanation: `Not issued: the invoice is on hold. ${(rows[0].hold_reasons ?? []).join(' ')}`, link: `invoices/${i.subject.id}` };
    const r = await issueInvoice(i.q, i.companyId, i.subject.id, { userId: i.actorUserId, depth: i.depth });
    return { status: 'completed', explanation: r.already ? `Already issued as ${r.number}.` : `Issued as ${r.number}.`, result: r };
  },

  async 'message.prepare_invoice'(i) {
    const mail = await invoiceEmail(i.q, i.subject.id, await invoiceViewLink(i.q, i.companyId, i.subject.id));
    const id = await prepareMessage(i.q, i.companyId, i.actionId, { channel: 'email', recipient: mail.recipient, subject: mail.subject, body: mail.body, customerId: mail.customerId, jobId: mail.jobId, invoiceId: i.subject.id, userId: i.actorUserId });
    await i.q.query(`update rigo.invoices set delivery_status = 'prepared' where id = $1 and delivery_status = 'not_prepared'`, [i.subject.id]);
    return { status: 'completed', explanation: mail.recipient ? 'Invoice email prepared.' : 'Invoice email prepared, but the customer has no email address on file.', context: { messageId: id } };
  },

  async 'message.prepare_job_update'(i) {
    const { rows } = await i.q.query<any>(`select j.*, c.name as customer_name, c.email, co.name as company_name from rigo.jobs j left join rigo.customers c on c.id = j.customer_id join rigo.companies co on co.id = j.company_id where j.id = $1`, [i.subject.id]);
    const j = rows[0];
    const outcome = j.status === 'unsuccessful' ? 'we were not able to complete the visit' : j.status === 'partial' ? 'we completed part of the visit' : 'the visit is complete';
    const body = `Hello ${j.customer_name ?? ''},\n\nAn update on job #${j.number}: ${outcome}. ${i.params.text ?? ''}\n\nWe will follow up with next steps.\n\n${j.company_name}`.replace(/ +\n/g, '\n');
    const id = await prepareMessage(i.q, i.companyId, i.actionId, { channel: 'email', recipient: j.email ?? '', subject: `${j.company_name}: update on your service`, body, customerId: j.customer_id, jobId: j.id, invoiceId: null, userId: i.actorUserId });
    return { status: 'completed', explanation: 'Customer update prepared.', context: { messageId: id } };
  },

  async 'message.send'(i) {
    const { rows } = await i.q.query<any>(`select * from rigo.messages where id = $1 and company_id = $2 for update`, [i.subject.id, i.companyId]);
    const m = rows[0];
    if (!m) return { status: 'blocked', explanation: 'The prepared message no longer exists.' };
    if (['sent', 'delivered', 'simulated'].includes(m.status)) return { status: m.status === 'simulated' ? 'simulated' : 'completed', explanation: `Already ${m.status}.` };
    if (!m.recipient) return { status: 'blocked', explanation: 'The customer has no email address. Add one, then send the prepared message from Messages.', link: 'messages' };
    const r = await deliverMessage({ kind: i.companyKind }, m);
    if (r.status === 'simulated') {
      await i.q.query(`update rigo.messages set status = 'simulated', status_detail = $2, provider = $3, updated_at = now() where id = $1`, [m.id, r.detail, r.provider]);
      if (m.invoice_id) await i.q.query(`update rigo.invoices set delivery_status = 'simulated' where id = $1`, [m.invoice_id]);
      return { status: 'simulated', explanation: r.detail };
    }
    // Blocked: the message stays "prepared" so a person can copy and send it themselves.
    return { status: 'blocked', explanation: `Not sent. ${r.detail}`, link: 'messages' };
  },

  async notify(i) {
    const label = await subjectLabel(i.q, i.subject);
    const n = { category: 'update' as const, title: i.params.text || 'Update from Rigo', body: label, link: i.subject.type === 'job' ? `jobs/${i.subject.id}` : i.subject.type === 'invoice' ? `invoices/${i.subject.id}` : undefined, dedupeKey: `notify:${i.actionId}` };
    if (i.params.roles?.length) await notifyRoles(i.q, i.companyId, i.params.roles, n);
    if (i.params.assignee && i.subject.type === 'job') {
      const { rows } = await i.q.query<{ assigned_user_id: string | null }>(`select assigned_user_id from rigo.jobs where id = $1`, [i.subject.id]);
      if (rows[0]?.assigned_user_id) await notifyUsers(i.q, i.companyId, [rows[0].assigned_user_id], { ...n, link: `today/${i.subject.id}` });
      else return { status: 'completed', explanation: 'No driver is assigned, so there was nobody to notify.' };
    }
    return { status: 'completed', explanation: 'Team notified in Rigo.' };
  },

  async 'job.create_followup'(i) {
    const existing = await i.q.query<{ id: string; number: number }>(`select id, number from rigo.jobs where company_id = $1 and details->>'_followupAction' = $2`, [i.companyId, i.actionId]);
    if (existing.rows[0]) return { status: 'completed', explanation: `Follow-up job #${existing.rows[0].number} already exists.`, context: { followupJobId: existing.rows[0].id } };
    const { rows } = await i.q.query<any>(`select * from rigo.jobs where id = $1`, [i.subject.id]);
    const j = rows[0];
    const seq = await i.q.query<{ job_seq: number }>(`update rigo.companies set job_seq = job_seq + 1 where id = $1 returning job_seq`, [i.companyId]);
    const ins = await i.q.query<{ id: string }>(
      `insert into rigo.jobs (company_id, number, customer_id, location_id, service_id, status, contact_name, contact_phone, access_instructions, notes, details, created_by)
       values ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10,$11) returning id`,
      [i.companyId, seq.rows[0].job_seq, j.customer_id, j.location_id, j.service_id, j.contact_name, j.contact_phone, j.access_instructions,
        `Follow-up to job #${j.number}. ${j.completion?.reason ?? ''}`.trim(), JSON.stringify({ ...(j.details ?? {}), _followupAction: i.actionId, _followupOf: j.id }), i.actorUserId]);
    await i.q.query(`insert into rigo.job_events (company_id, job_id, type, actor_label, data) values ($1,$2,'created',$3,$4)`, [i.companyId, ins.rows[0].id, 'Rigo automation', JSON.stringify({ followupOf: j.number })]);
    return { status: 'completed', explanation: `Follow-up job #${seq.rows[0].job_seq} drafted for scheduling.`, context: { followupJobId: ins.rows[0].id } };
  },
};
