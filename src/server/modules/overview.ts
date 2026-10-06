import { Hono } from 'hono';
import { type AppEnv, can } from '../http/context.js';
import { localDate, addDays, zonedToUtc } from '../../shared/schedule.js';

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
  const pendingApprovals = (await db.query<any>(`select count(*)::int n from rigo.approvals where company_id = $1 and status = 'pending'`, [cid])).rows[0].n;
  if (pendingApprovals && (can(cc, 'approvals.decide') || can(cc, 'invoices.approve'))) attention.push({ key: 'approvals', label: 'Approvals waiting for a decision', count: pendingApprovals, link: 'inbox', tone: 'action' });
  if (can(cc, 'workflows.view')) {
    const w = (await db.query<any>(`select count(*) filter (where status in ('suggested','proposed'))::int ready, count(*) filter (where status in ('blocked','failed') and updated_at > now() - interval '7 days')::int problems from rigo.actions where company_id = $1`, [cid])).rows[0];
    if (w.ready) attention.push({ key: 'ready', label: 'Steps prepared for you to run', count: w.ready, link: 'automation', tone: 'action' });
    if (w.problems) attention.push({ key: 'blocked', label: 'Automation steps blocked or failed this week', count: w.problems, link: 'automation?tab=history', tone: 'warning' });
  }
  if (can(cc, 'invoices.view')) {
    const h = (await db.query<any>(`select count(*)::int n from rigo.invoices where company_id = $1 and status = 'held'`, [cid])).rows[0].n;
    if (h) attention.push({ key: 'held', label: 'Invoices on hold (missing rates or review)', count: h, link: 'invoices?status=held', tone: 'warning' });
  }
  if (can(cc, 'jobs.view_all')) {
    const j = (await db.query<any>(`select count(*) filter (where problem_open)::int problems,
        count(*) filter (where status in ('open') and assigned_user_id is null and scheduled_start < $2)::int unassigned_soon,
        count(*) filter (where status in ('partial','unsuccessful') and completed_at > now() - interval '3 days')::int exceptions,
        count(*) filter (where status = 'draft')::int drafts
        from rigo.jobs where company_id = $1`, [cid, dayEnd])).rows[0];
    if (j.problems) attention.push({ key: 'problems', label: 'Jobs with a reported problem', count: j.problems, link: 'jobs?problem=1', tone: 'warning' });
    if (j.unassigned_soon) attention.push({ key: 'unassigned', label: 'Jobs today or overdue without a driver', count: j.unassigned_soon, link: 'jobs?assignee=none', tone: 'action' });
    if (j.exceptions) attention.push({ key: 'exceptions', label: 'Partial or unsuccessful visits (last 3 days)', count: j.exceptions, link: 'jobs?status=finished', tone: 'warning' });
    if (j.drafts) attention.push({ key: 'drafts', label: 'Draft jobs missing information', count: j.drafts, link: 'jobs?status=draft', tone: 'action' });
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
        (select coalesce(sum(total_minor - paid_minor),0)::bigint from rigo.invoices where company_id = $1 and status = 'issued' and payment_status <> 'paid') as outstanding,
        (select count(*)::int from rigo.customers where company_id = $1) as customers`, [cid])).rows[0];
    business = { completed30: b.completed_30, exceptions30: b.exceptions_30, customers: b.customers, issued30Minor: fin ? Number(b.issued_30) : undefined, outstandingMinor: fin ? Number(b.outstanding) : undefined, currency: cc.company.currency };
  }
  const empty = can(cc, 'jobs.view_all') ? (await db.query<any>(`select count(*)::int n from rigo.jobs where company_id = $1`, [cid])).rows[0].n === 0 : false;
  return c.json({ attention, today: today_ops, rigo, business, empty });
});
