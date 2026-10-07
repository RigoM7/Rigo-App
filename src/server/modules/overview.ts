import { Hono } from 'hono';
import { type AppEnv, can } from '../http/context.js';
import { localDate, addDays, zonedToUtc } from '../../shared/schedule.js';
import { DEFAULT_JOB_MINUTES } from '../../shared/jobs.js';
import { visibleApprovals, approvalSummary } from './approvals.js';
import { OOS_SQL, returnToService } from './jobs.js';

const URGENCY = ['emergency', 'urgent', 'unassigned', 'late', 'problems', 'out_of_service', 'driver_records', 'approvals', 'unbilled', 'held', 'collected', 'overdue', 'ready', 'blocked', 'exceptions', 'drafts'];
/** The order "Needs you" lists things in; anything new goes after the known ones. */
export const urgency = (key: string) => { const i = URGENCY.indexOf(key); return i < 0 ? URGENCY.length : i; };

// Owner/dispatcher dashboard: attention first, then today's operations, then a brief business
// overview. Every number comes from real records; empty companies get setup actions instead.

export const overviewRoutes = new Hono<AppEnv>();

overviewRoutes.get('/overview', async (c) => {
  const cc = c.get('cc');
  const db = cc.db;
  const tz = cc.company.timezone;
  const today = localDate(new Date(), tz);
  const dayStart = zonedToUtc(today, '00:00', tz).toISOString();
  const dayEnd = zonedToUtc(addDays(today, 1), '00:00', tz).toISOString();
  const cid = cc.company.id;

  const attention: { key: string; label: string; count: number; link: string; tone: 'action' | 'warning' }[] = [];
  // Same rule as the inbox: approvals this person, in their current role, may decide.
  const toDecide = (await visibleApprovals(cc, 'pending')).filter((a) => a.canDecide);
  if (toDecide.length) attention.push({ key: 'approvals', label: 'Approvals waiting for a decision', count: toDecide.length, link: 'inbox', tone: 'action' });
  // Invoices waiting for approval, with what they would bill (amounts only with finance.view).
  const invoiceApprovals = [];
  for (const a of toDecide.filter((x) => x.subject_type === 'invoice').slice(0, 3)) invoiceApprovals.push({ id: a.id, actionType: a.action_type, summary: await approvalSummary(db, a, cc.perms) });
  if (can(cc, 'workflows.view')) {
    const w = (await db.query<any>(`select count(*) filter (where status in ('suggested','proposed'))::int ready, count(*) filter (where status in ('blocked','failed') and updated_at > now() - interval '7 days')::int problems from rigo.actions where company_id = $1`, [cid])).rows[0];
    if (w.ready) attention.push({ key: 'ready', label: 'Steps prepared for you to run', count: w.ready, link: 'automation', tone: 'action' });
    if (w.problems) attention.push({ key: 'blocked', label: 'Automation steps blocked or failed this week', count: w.problems, link: 'automation?tab=history', tone: 'warning' });
  }
  if (can(cc, 'invoices.view')) {
    const h = (await db.query<any>(`select count(*)::int n from rigo.invoices where company_id = $1 and status = 'held'`, [cid])).rows[0].n;
    if (h) attention.push({ key: 'held', label: 'Invoices on hold (missing rates or review)', count: h, link: 'invoices?status=held', tone: 'warning' });
    // Completed work with no invoice, whatever the workflows are doing (R3-M3): nothing goes unbilled quietly.
    const u = (await db.query<any>(`select count(*)::int n from rigo.jobs j where j.company_id = $1 and j.status in ('completed','partial') and coalesce(j.billing_status, '') <> 'not_billable'
        and not exists (select 1 from rigo.invoices i where i.job_id = j.id and i.status <> 'void')`, [cid])).rows[0].n;
    if (u) attention.push({ key: 'unbilled', label: 'Completed jobs not yet billed', count: u, link: 'jobs?status=unbilled', tone: 'action' });
    const o = (await db.query<any>(`select count(*)::int n from rigo.invoices where company_id = $1 and status = 'issued' and payment_status <> 'paid' and due_date < $2`, [cid, today])).rows[0].n;
    if (o) attention.push({ key: 'overdue', label: 'Overdue invoices', count: o, link: 'invoices?status=overdue', tone: 'warning' });
  }
  if (can(cc, 'payments.record') && can(cc, 'finance.view')) {
    const u = (await db.query<any>(`select count(*)::int n from rigo.payments where company_id = $1 and state = 'unconfirmed'`, [cid])).rows[0].n;
    if (u) attention.push({ key: 'collected', label: 'Payments collected at stops to confirm', count: u, link: 'collections', tone: 'action' });
  }
  if (can(cc, 'jobs.view_all')) {
    const j = (await db.query<any>(`select count(*) filter (where problem_open)::int problems,
        count(*) filter (where status in ('open') and assigned_user_id is null and scheduled_start < $2)::int unassigned_soon,
        count(*) filter (where status in ('partial','unsuccessful') and completed_at > now() - interval '3 days')::int exceptions,
        count(*) filter (where status = 'draft')::int drafts,
        count(*) filter (where status in ('draft','open') and assigned_user_id is null and priority in ('urgent','emergency'))::int urgent_unassigned,
        count(*) filter (where status in ('draft','open','in_progress') and priority = 'emergency')::int emergencies,
        count(*) filter (where status = 'open' and coalesce(scheduled_end, scheduled_start + interval '${DEFAULT_JOB_MINUTES} minutes') < now())::int late
        from rigo.jobs where company_id = $1`, [cid, dayEnd])).rows[0];
    if (j.emergencies) attention.push({ key: 'emergency', label: 'Emergency jobs not finished', count: j.emergencies, link: 'jobs?priority=emergency', tone: 'action' });
    if (j.urgent_unassigned) attention.push({ key: 'urgent', label: 'Urgent or emergency jobs without a driver', count: j.urgent_unassigned, link: 'jobs?assignee=none&priority=high', tone: 'action' });
    if (j.late) attention.push({ key: 'late', label: 'Jobs running late', count: j.late, link: 'jobs?late=1', tone: 'warning' });
    if (j.problems) attention.push({ key: 'problems', label: 'Jobs with a reported problem', count: j.problems, link: 'jobs?problem=1', tone: 'warning' });
    if (j.unassigned_soon) attention.push({ key: 'unassigned', label: 'Jobs today or overdue without a driver', count: j.unassigned_soon, link: 'jobs?assignee=none', tone: 'action' });
    if (j.exceptions) attention.push({ key: 'exceptions', label: 'Partial or unsuccessful visits (last 3 days)', count: j.exceptions, link: 'jobs?status=finished', tone: 'warning' });
    if (j.drafts) attention.push({ key: 'drafts', label: 'Draft jobs missing information', count: j.drafts, link: 'jobs?status=draft', tone: 'action' });
    await returnToService(db, cid, today);
    const oos = (await db.query<{ n: number }>(`select count(*)::int n from rigo.jobs j where j.company_id = $1 and ${OOS_SQL}`, [cid])).rows[0].n;
    if (oos) attention.push({ key: 'out_of_service', label: 'Jobs on an out-of-service truck', count: oos, link: 'jobs?oos=1', tone: 'action' });
  }
  if (can(cc, 'jobs.assign')) {
    // Records drivers sent after their job moved on (reassigned, finished, or they were removed).
    const r = (await db.query<{ n: number }>(`select count(*)::int n from rigo.pending_submissions where company_id = $1 and status = 'pending'`, [cid])).rows[0].n;
    if (r) attention.unshift({ key: 'driver_records', label: 'Driver records to review', count: r, link: 'jobs/records', tone: 'action' });
  }

  let today_ops = null;
  if (can(cc, 'jobs.view_all')) {
    const { rows } = await db.query<any>(`select j.id, j.number, j.status, j.scheduled_start, j.assigned_user_id, j.problem_open, c.name as customer_name, s.name as service_name, l.address, coalesce(m.display_name, u.name) as assignee_name
        from rigo.jobs j left join rigo.customers c on c.id = j.customer_id left join rigo.services s on s.id = j.service_id left join rigo.locations l on l.id = j.location_id
        left join rigo.users u on u.id = j.assigned_user_id left join rigo.memberships m on m.company_id = j.company_id and m.user_id = j.assigned_user_id
        where j.company_id = $1 and j.scheduled_start >= $2 and j.scheduled_start < $3 and j.status <> 'cancelled' order by j.scheduled_start`, [cid, dayStart, dayEnd]);
    const by = (s: string[]) => rows.filter((r) => s.includes(r.status)).length;
    today_ops = { date: today, total: rows.length, waiting: by(['open', 'draft']), inProgress: by(['in_progress']), done: by(['completed']), exceptions: by(['partial', 'unsuccessful']), unassigned: rows.filter((r) => !r.assigned_user_id && ['open', 'draft'].includes(r.status)).length, jobs: rows.slice(0, 12) };
  }

  let rigo = null;
  if (can(cc, 'workflows.view')) {
    const r = (await db.query<any>(`select count(*) filter (where status = 'queued')::int queued, count(*) filter (where status = 'running')::int running,
        count(*) filter (where status = 'waiting_approval')::int waiting_approval, count(*) filter (where status in ('completed','simulated') and updated_at > now() - interval '24 hours')::int done_today
        from rigo.actions where company_id = $1`, [cid])).rows[0];
    const active = (await db.query<any>(`select count(*)::int n from rigo.workflows where company_id = $1 and active_version_id is not null`, [cid])).rows[0].n;
    rigo = { ...r, activeWorkflows: active, mode: cc.company.automation_mode, paused: cc.company.paused };
  }

  let business = null;
  if (can(cc, 'reports.view')) {
    const fin = can(cc, 'finance.view');
    const b = (await db.query<any>(`select
        (select count(*)::int from rigo.jobs where company_id = $1 and status = 'completed' and completed_at > now() - interval '30 days') as completed_30,
        (select count(*)::int from rigo.jobs where company_id = $1 and status in ('partial','unsuccessful') and completed_at > now() - interval '30 days') as exceptions_30,
        (select coalesce(sum(total_minor),0)::bigint from rigo.invoices where company_id = $1 and status = 'issued' and issued_at > now() - interval '30 days') as issued_30,
        (select coalesce(sum(total_minor - paid_minor - credited_minor),0)::bigint from rigo.invoices where company_id = $1 and status = 'issued' and payment_status <> 'paid') as outstanding,
        (select coalesce(sum(total_minor),0)::bigint from rigo.invoices where company_id = $1 and status in ('draft','pending_approval','approved')) as waiting,
        (select count(*)::int from rigo.customers where company_id = $1) as customers`, [cid])).rows[0];
    business = { completed30: b.completed_30, exceptions30: b.exceptions_30, customers: b.customers, issued30Minor: fin ? Number(b.issued_30) : undefined, outstandingMinor: fin ? Number(b.outstanding) : undefined,
      waitingMinor: fin ? Number(b.waiting) : undefined, currency: cc.company.currency };
  }
  const empty = can(cc, 'jobs.view_all') ? (await db.query<any>(`select count(*)::int n from rigo.jobs where company_id = $1`, [cid])).rows[0].n === 0 : false;
  // Most urgent first (R18-m5): people and trucks on the road today, then money waiting, then tidying up.
  attention.sort((a, b) => urgency(a.key) - urgency(b.key));
  return c.json({ attention, invoiceApprovals, today: today_ops, rigo, business, empty });
});
