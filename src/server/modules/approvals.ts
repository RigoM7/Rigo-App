import type { Q } from '../db/index.js';
import type { CompanyCtx } from '../http/context.js';
import { isEligibleApprover, type Actor } from '../automation/engine.js';
import { quantityNote } from '../../shared/billing.js';
import type { FieldDef, PriceLine } from '../../shared/services.js';

// What an approver sees before deciding, and which approvals count as waiting for them. The inbox
// list, its counts and Home's "Needs you" all use visibleApprovals so they can never disagree.

const actorOf = (cc: CompanyCtx): Actor => ({ db: cc.db, companyId: cc.company.id, userId: cc.user.id, perms: cc.perms, isOwner: cc.isOwner, isDemo: cc.isDemo });

/** Approvals this person may see, each marked with whether they may decide it. */
export async function visibleApprovals(cc: CompanyCtx, status: 'pending' | 'decided', limit = 100) {
  const { rows } = await cc.db.query<any>(
    `select a.*, x.type as action_type, x.run_id, w.name as workflow_name, u.name as decided_by_name from rigo.approvals a join rigo.actions x on x.id = a.action_id
       left join rigo.automation_runs r on r.id = x.run_id left join rigo.workflows w on w.id = r.workflow_id left join rigo.users u on u.id = a.decided_by
      where a.company_id = $1 and ${status === 'pending' ? `a.status = 'pending'` : `a.status <> 'pending'`} order by a.created_at desc limit ${Number(limit)}`, [cc.company.id]);
  const out: any[] = [];
  for (const ap of rows) {
    const eligible = await isEligibleApprover(cc.db, ap, actorOf(cc));
    if (!eligible && !cc.perms.has('automation.control') && !cc.isOwner) continue;
    out.push({ ...ap, canDecide: eligible && ap.status === 'pending' });
  }
  return out;
}

/** Pending approvals waiting on this person's decision (what "Needs action" counts). */
export async function approvalsToDecide(cc: CompanyCtx) {
  return (await visibleApprovals(cc, 'pending')).filter((a) => a.canDecide).length;
}

type Perms = Set<string>;
const has = (p: Perms, k: string) => p.has(k);

/**
 * Key facts about what an approval would act on, built from stored records (never recalculated).
 * Amounts are included only with finance.view and contact details only with customers.contact.
 */
export async function approvalSummary(q: Q, ap: { subject_type: string; subject_id: string; company_id: string }, perms: Perms) {
  const fin = has(perms, 'finance.view');
  if (ap.subject_type === 'invoice') {
    const { rows } = await q.query<any>(
      `select i.*, c.name as customer_name, j.number as job_number, j.details, j.completion, s.name as service_name, s.fields, s.pricing
         from rigo.invoices i left join rigo.customers c on c.id = i.customer_id left join rigo.jobs j on j.id = i.job_id left join rigo.services s on s.id = j.service_id
        where i.id = $1 and i.company_id = $2`, [ap.subject_id, ap.company_id]);
    const i = rows[0];
    if (!i) return null;
    const lines = (await q.query<any>(`select description, quantity, unit, rate_minor, amount_minor, kind from rigo.invoice_lines where invoice_id = $1 order by position`, [i.id])).rows;
    const values = { ...(i.details ?? {}), ...(i.completion?.values ?? {}) };
    return {
      kind: 'invoice' as const, invoiceId: i.id, number: i.number, status: i.status, customerName: i.customer_name, jobNumber: i.job_number, serviceName: i.service_name,
      currency: i.currency, dueDays: i.due_days,
      subtotalMinor: fin ? i.subtotal_minor : undefined, discountMinor: fin ? i.discount_minor : undefined, taxMinor: fin ? i.tax_minor : undefined, totalMinor: fin ? i.total_minor : undefined,
      lines: lines.slice(0, 5).map((l) => ({ description: l.description, quantity: String(l.quantity), unit: l.unit, ...(fin ? { rateMinor: l.rate_minor, amountMinor: l.kind === 'discount' ? -Math.abs(l.amount_minor ?? 0) : l.amount_minor } : {}) })),
      moreLines: Math.max(0, lines.length - 5),
      holdReasons: (i.hold_reasons ?? []) as string[],
      quantityNote: quantityNote((i.fields ?? []) as FieldDef[], (i.pricing ?? []) as PriceLine[], values),
    };
  }
  if (ap.subject_type === 'job') {
    const { rows } = await q.query<any>(
      `select j.number, j.status, j.priority, j.scheduled_start, s.name as service_name, c.name as customer_name, coalesce(m.display_name, u.name) as assignee_name
         from rigo.jobs j left join rigo.services s on s.id = j.service_id left join rigo.customers c on c.id = j.customer_id
         left join rigo.users u on u.id = j.assigned_user_id left join rigo.memberships m on m.company_id = j.company_id and m.user_id = j.assigned_user_id
        where j.id = $1 and j.company_id = $2`, [ap.subject_id, ap.company_id]);
    const j = rows[0];
    if (!j) return null;
    return { kind: 'job' as const, jobId: ap.subject_id, jobNumber: j.number, status: j.status, priority: j.priority, scheduledStart: j.scheduled_start, serviceName: j.service_name, customerName: j.customer_name, assigneeName: j.assignee_name };
  }
  if (ap.subject_type === 'message') {
    const { rows } = await q.query<any>(
      `select m.channel, m.subject, m.recipient, m.status, c.name as customer_name, j.number as job_number, i.number as invoice_number
         from rigo.messages m left join rigo.customers c on c.id = m.customer_id left join rigo.jobs j on j.id = m.job_id left join rigo.invoices i on i.id = m.invoice_id
        where m.id = $1 and m.company_id = $2`, [ap.subject_id, ap.company_id]);
    const m = rows[0];
    if (!m) return null;
    return { kind: 'message' as const, channel: m.channel, subject: m.subject, status: m.status, recipient: has(perms, 'customers.contact') ? m.recipient : undefined, customerName: m.customer_name, jobNumber: m.job_number, invoiceNumber: m.invoice_number };
  }
  return null;
}
