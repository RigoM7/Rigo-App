import { Hono } from 'hono';
import { z } from 'zod';
import type { Q } from '../db/index.js';
import { type AppEnv, type CompanyCtx, need, needAny, can, audit } from '../http/context.js';
import { body } from '../lib/util.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { canTransition, completionProblems, outcomeReason, REASON_CODE_KEYS, billingAfterOutcome, missingForOpen, isFinished, DEFAULT_JOB_MINUTES, OUTCOMES, type JobStatus } from '../../shared/jobs.js';
import { customFieldsSchema, validateValues, readPricing, fieldApplies, type FieldDef } from '../../shared/services.js';
import { quantityChecks, formatMoney, type JobTruck } from '../../shared/billing.js';
import { paymentState } from '../../shared/invoices.js';
import { localDate } from '../../shared/schedule.js';
import { fold, jobNumberQuery } from '../../shared/customers.js';
import { reportLines, reportText } from '../../shared/report.js';
import { deliveryLineSchema, lineKeys, lineProblems, lineQuantity, takesLines, totalQuantity, type DeliveryLine } from '../../shared/deliveries.js';
import { emit, invalidateApprovalsFor } from '../automation/engine.js';
import { prepareInvoiceForJob, rebuildHeldInvoice } from './invoicing.js';
import { notifyPermission, notifyPermissions, notifyRoles } from './inbox.js';
import { storeFile, sniffImage, readStoredFile } from '../adapters/index.js';

export const jobRoutes = new Hono<AppEnv>();

const MAX_PHOTOS = 4;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// ---------------------------------------------------------------- access helpers
async function loadJob(cc: CompanyCtx, q: Q, id: string, lock = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Job');
  const { rows } = await q.query<any>(`select * from rigo.jobs where id = $1 and company_id = $2${lock ? ' for update' : ''}`, [id, cc.company.id]);
  const job = rows[0];
  if (!job) throw notFound('Job');
  // Drivers only ever learn about jobs assigned to them; others look exactly like "not found".
  if (!can(cc, 'jobs.view_all')) {
    if (!can(cc, 'jobs.view_assigned') || job.assigned_user_id !== cc.actingUserId || job.status === 'draft') throw notFound('Job');
  }
  return job;
}

function isAssignedWorker(cc: CompanyCtx, job: any) {
  return can(cc, 'jobs.work') && job.assigned_user_id === cc.actingUserId;
}

async function service(q: Q, companyId: string, id: string | null) {
  if (!id) return null;
  const { rows } = await q.query<any>(`select * from rigo.services where id = $1 and company_id = $2`, [id, companyId]);
  return rows[0] ?? null;
}

export async function event(q: Q, cc: CompanyCtx, jobId: string, type: string, data: unknown = {}) {
  await q.query(`insert into rigo.job_events (company_id, job_id, type, actor_user_id, actor_label, data) values ($1,$2,$3,$4,$5,$6)`,
    [cc.company.id, jobId, type, cc.user.id, cc.simulatedRole ? `${cc.user.name} (as ${cc.roleName}, simulated)` : '', JSON.stringify(data)]);
}

// ---------------------------------------------------------------- telling the driver (R11-M2, R6-M1)
const whenText = (iso: string | null, tz: string) => iso ? new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso)) : 'no set time';
const timeText = (iso: string, tz: string) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso));

/** Is this job today or tomorrow in the company's time zone (or has no date)? Those changes need action. */
function soon(job: any, tz: string) {
  if (!job.scheduled_start) return true;
  const day = localDate(new Date(job.scheduled_start), tz), today = localDate(new Date(), tz);
  const tomorrow = localDate(new Date(Date.now() + 86_400_000), tz);
  return day <= tomorrow && day >= today;
}

/** What changed on a job, in the driver's words ("Moved from 6:00 AM to 9:00 AM", "New gate instructions"). */
export function changeLines(before: any, after: any, tz: string, addresses: { before: string | null; after: string | null } = { before: null, after: null }) {
  const lines: string[] = [];
  if ((before.scheduled_start ?? null) !== (after.scheduled_start ?? null)) {
    const sameDay = before.scheduled_start && after.scheduled_start && localDate(new Date(before.scheduled_start), tz) === localDate(new Date(after.scheduled_start), tz);
    lines.push(sameDay ? `Moved from ${timeText(before.scheduled_start, tz)} to ${timeText(after.scheduled_start, tz)}` : `Moved from ${whenText(before.scheduled_start, tz)} to ${whenText(after.scheduled_start, tz)}`);
  }
  if (before.location_id !== after.location_id || (addresses.before && addresses.after && addresses.before !== addresses.after)) lines.push(`New address: ${addresses.after ?? 'see the job'}`);
  if ((before.access_instructions ?? '') !== (after.access_instructions ?? '')) lines.push(after.access_instructions ? `New access instructions: ${after.access_instructions}` : 'Access instructions removed');
  if ((before.contact_name ?? '') !== (after.contact_name ?? '') || (before.contact_phone ?? '') !== (after.contact_phone ?? '')) lines.push(`New site contact: ${[after.contact_name, after.contact_phone].filter(Boolean).join(', ') || 'none'}`);
  if ((before.notes ?? '') !== (after.notes ?? '')) lines.push('The office changed the notes');
  if (before.priority !== after.priority && after.priority === 'emergency') lines.push('Now an emergency');
  else if (before.priority !== after.priority && after.priority === 'urgent') lines.push('Now urgent');
  return lines;
}

/**
 * Record changes the assigned driver hasn't seen (the phone shows "Changed" until they tap "Got it")
 * and tell them: today's and tomorrow's changes need action, later ones are updates.
 */
export async function noteDriverChange(q: Q, cc: CompanyCtx, job: any, lines: string[], to: string | null = job.assigned_user_id) {
  if (!to || !lines.length || !['open', 'in_progress'].includes(job.status)) return;
  const prev = (job.driver_changes?.lines ?? []) as string[];
  const all = [...prev.filter((l) => !lines.includes(l)), ...lines].slice(-8);
  await q.query(`update rigo.jobs set driver_changes = $2 where id = $1`, [job.id, JSON.stringify({ at: new Date().toISOString(), lines: all })]);
  const { notifyUsers } = await import('./inbox.js');
  await notifyUsers(q, cc.company.id, [to], {
    category: soon(job, cc.company.timezone) ? 'needs_action' : 'update',
    title: `Job #${job.number} changed: ${lines[0]}${lines.length > 1 ? ` (+${lines.length - 1} more)` : ''}`.slice(0, 200),
    body: lines.join('. '), link: `today/${job.id}`, refType: 'job_change', refId: job.id,
  });
}

/** An emergency reaches its driver at once, and the owner and dispatch get a needs-action alert (D15: in the app only). */
export async function alertEmergency(q: Q, cc: CompanyCtx, job: any) {
  if (job.priority !== 'emergency' || !['draft', 'open', 'in_progress'].includes(job.status)) return;
  const { notifyUsers } = await import('./inbox.js');
  const where = (await q.query<any>(`select coalesce(j.location_snapshot->>'address', l.address) as address, c.name as customer from rigo.jobs j left join rigo.locations l on l.id = j.location_id left join rigo.customers c on c.id = j.customer_id where j.id = $1`, [job.id])).rows[0] ?? {};
  const what = [where.customer, where.address].filter(Boolean).join(', ');
  if (job.assigned_user_id && job.status !== 'draft') {
    await notifyUsers(q, cc.company.id, [job.assigned_user_id], { category: 'needs_action', title: `Emergency: job #${job.number}${what ? `, ${what}` : ''}`.slice(0, 200), body: 'Go as soon as you can. Call the office if you can\'t.', link: `today/${job.id}`, refType: 'job_emergency', refId: job.id, dedupeKey: `emergency-driver:${job.id}:${job.assigned_user_id}` });
  }
  await notifyPermission(q, cc.company.id, 'jobs.assign', { category: 'needs_action', title: `Emergency job #${job.number}${what ? `: ${what}` : ''}`.slice(0, 200), body: job.assigned_user_id ? 'A driver is assigned and was alerted.' : 'No driver yet. Assign one now.', link: `jobs/${job.id}`, refType: 'job_emergency', refId: job.id, dedupeKey: `emergency:${job.id}:${job.assigned_user_id ?? 'none'}` });
}

function nextAction(job: any): string {
  switch (job.status as JobStatus) {
    case 'draft': return 'Complete the job details';
    case 'open': return job.assigned_user_id ? 'Start the job' : 'Assign a driver';
    case 'in_progress': return 'Record the outcome';
    case 'completed': case 'partial': return job.billing_status === 'issued' ? 'Done' : 'Billing';
    case 'unsuccessful': return 'Follow up';
    default: return '';
  }
}

// Jobs keep the address they were booked for (`location_snapshot`, set by a database trigger when
// the job is created or moved to another location), so editing a location changes future jobs only.

const listSelect = `select j.id, j.number, j.status, j.priority, j.billing_status, j.problem_open, j.scheduled_start, j.scheduled_end, j.assigned_user_id, j.version,
    j.updated_at, j.created_at, j.completed_at, c.name as customer_name, coalesce(j.location_snapshot->>'address', l.address) as address, coalesce(j.location_snapshot->>'label', l.label) as location_label, s.name as service_name, s.category,
    coalesce(m.display_name, u.name) as assignee_name,
    (select coalesce(json_agg(json_build_object('id', r.id, 'name', r.name, 'kind', r.kind, 'status', r.status)), '[]'::json) from rigo.job_resources jr join rigo.resources r on r.id = jr.resource_id where jr.job_id = j.id) as resources
  from rigo.jobs j left join rigo.customers c on c.id = j.customer_id left join rigo.locations l on l.id = j.location_id
  left join rigo.services s on s.id = j.service_id left join rigo.users u on u.id = j.assigned_user_id
  left join rigo.memberships m on m.company_id = j.company_id and m.user_id = j.assigned_user_id`;

/** Open jobs that still use a truck or unit that is out of service or retired. */
/**
 * Trucks whose "out of service until" date has come are available again (R11-M1). Run before
 * anything that reads truck status: the trucks page, Home, the jobs list, assigning and swapping.
 */
export async function returnToService(q: Q, companyId: string, today: string) {
  await q.query(`update rigo.resources set status = 'available', out_of_service_until = null where company_id = $1 and status = 'out_of_service' and out_of_service_until is not null and out_of_service_until <= $2`, [companyId, today]);
}
const backInService = (cc: CompanyCtx, q: Q = cc.db) => returnToService(q, cc.company.id, localDate(new Date(), cc.company.timezone));

export const OOS_SQL = `(j.status in ('open','in_progress') and exists (select 1 from rigo.job_resources jr join rigo.resources r on r.id = jr.resource_id where jr.job_id = j.id and r.status in ('out_of_service','retired')))`;

/** Open jobs whose time window has ended without being started (same rule as isLate in shared/jobs). */
const LATE_SQL = `(j.status = 'open' and coalesce(j.scheduled_end, j.scheduled_start + interval '${DEFAULT_JOB_MINUTES} minutes') < now())`;

/** Day by day in the company's time zone; within a day emergencies, then urgent jobs, then by time. */
function scheduleOrder(tzParam: string) {
  return `(j.scheduled_start at time zone ${tzParam})::date asc nulls last, case j.priority when 'emergency' then 0 when 'urgent' then 1 else 2 end, j.scheduled_start asc nulls last, j.number`;
}

jobRoutes.get('/jobs', async (c) => {
  const cc = c.get('cc');
  needAny(cc, 'jobs.view_all', 'jobs.view_assigned');
  await backInService(cc); // the list marks trucks out of service
  const vals: unknown[] = [cc.company.id];
  const where = ['j.company_id = $1'];
  const add = (sql: string, v: unknown) => { vals.push(v); where.push(sql.replace('?', `$${vals.length}`)); };
  if (!can(cc, 'jobs.view_all')) { add('j.assigned_user_id = ?', cc.actingUserId); where.push(`j.status <> 'draft'`); }
  const status = c.req.query('status');
  if (status === 'active') where.push(`j.status in ('draft','open','in_progress')`);
  else if (status === 'finished') where.push(`j.status in ('completed','partial','unsuccessful','cancelled')`);
  else if (status === 'unbilled') where.push(`j.status in ('completed','partial') and coalesce(j.billing_status, '') <> 'not_billable' and not exists (select 1 from rigo.invoices i where i.job_id = j.id and i.status <> 'void')`);
  else if (status && status !== 'all') add('j.status = ?', status);
  const assignee = c.req.query('assignee');
  if (assignee === 'none') where.push('j.assigned_user_id is null');
  else if (assignee) add('j.assigned_user_id = ?', assignee);
  if (c.req.query('problem') === '1') where.push('j.problem_open');
  const priority = c.req.query('priority');
  if (priority === 'high') where.push(`j.priority in ('urgent','emergency')`);
  else if (priority === 'urgent' || priority === 'emergency' || priority === 'normal') add('j.priority = ?', priority);
  if (c.req.query('late') === '1') where.push(LATE_SQL);
  // Jobs using a given truck, or any truck that is out of service (R11-M1).
  const resource = c.req.query('resource');
  if (resource && /^[0-9a-f-]{36}$/i.test(resource)) add('exists (select 1 from rigo.job_resources jr where jr.job_id = j.id and jr.resource_id = ?)', resource);
  if (c.req.query('oos') === '1') where.push(OOS_SQL);
  const from = c.req.query('from'), to = c.req.query('to');
  if (from) add('j.scheduled_start >= ?', from);
  if (to) add('j.scheduled_start < ?', to);
  const qtext = (c.req.query('q') ?? '').trim().toLowerCase();
  // "54", "#54" or "job 54" finds job 54 first; names match without accents ("nunez" finds Núñez) (R5-m1, R17-m1).
  const num = qtext ? jobNumberQuery(qtext) : null;
  let first = '';
  if (qtext) {
    vals.push(`%${fold(qtext)}%`);
    const n = vals.length;
    vals.push(num ?? -1);
    where.push(`(rigo.fold(c.name) like $${n} or rigo.fold(coalesce(j.location_snapshot->>'address', l.address, '')) like $${n} or rigo.fold(s.name) like $${n} or j.number = $${n + 1})`);
    if (num !== null) first = `(j.number = $${n + 1}) desc, `;
  }
  const sorts: Record<string, () => string> = {
    // Only the schedule order uses the company time zone; an unused parameter is an error in PostgreSQL.
    schedule: () => { vals.push(cc.company.timezone); return scheduleOrder(`$${vals.length}`); },
    number: () => 'j.number desc', updated: () => 'j.updated_at desc', customer: () => 'lower(c.name), j.number',
  };
  const order = (sorts[c.req.query('sort') ?? 'schedule'] ?? sorts.schedule)();
  const { rows } = await cc.db.query(`${listSelect} where ${where.join(' and ')} order by ${first}${order} limit 500`, vals);
  return c.json({
    jobs: rows.map((j: any) => ({ ...j, billing_status: can(cc, 'invoices.view') ? j.billing_status : undefined, nextAction: nextAction(j) })),
    serverTime: new Date().toISOString(),
  });
});

/** Driver "My jobs": assignments with everything needed on site, small enough to cache offline. */
jobRoutes.get('/my/jobs', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.work');
  const { rows } = await cc.db.query<any>(
    `select j.id, j.number, j.status, j.priority, j.scheduled_start, j.scheduled_end, j.contact_name, j.contact_phone, j.access_instructions, j.notes, j.details,
            j.version, j.problem_open, j.completion, j.completion_submission_id, j.updated_at, j.driver_changes,
            c.name as customer_name, coalesce(j.location_snapshot->>'address', l.address) as address, coalesce(j.location_snapshot->>'label', l.label) as location_label,
            coalesce(j.location_snapshot->>'access', l.access_instructions) as location_access, coalesce(j.location_snapshot->>'siteContact', l.site_contact) as site_contact, l.custom as location_custom, l.site_contact_phone, l.tanks as location_tanks, s.pricing as service_pricing,
            s.id as service_id, s.name as service_name, s.category, s.fields, s.requires_photo, s.requires_signature,
            (select coalesce(json_agg(json_build_object('id', r.id, 'name', r.name, 'kind', r.kind, 'capacityQuantity', r.capacity_quantity, 'capacityUnit', r.capacity_unit)), '[]'::json) from rigo.job_resources jr join rigo.resources r on r.id = jr.resource_id where jr.job_id = j.id) as resources
       from rigo.jobs j left join rigo.customers c on c.id = j.customer_id left join rigo.locations l on l.id = j.location_id left join rigo.services s on s.id = j.service_id
      where j.company_id = $1 and j.assigned_user_id = $2 and j.status <> 'draft'
        and (j.status in ('open','in_progress') or j.completed_at > now() - interval '2 days' or j.updated_at > now() - interval '2 days')
      order by ${scheduleOrder('$3')}`, [cc.company.id, cc.actingUserId, cc.company.timezone]);
  const driverNext = (j: any) => (j.status === 'open' ? 'Start the job' : j.status === 'in_progress' ? 'Record the outcome' : '');
  // Location custom fields marked for drivers travel with the job (R5-M2).
  const siteDefs = customFieldsSchema.parse(cc.company.settings?.customFields ?? {}).locations.filter((f) => f.driverVisible);
  const siteFields = (j: any) => siteDefs.filter((f) => j.location_custom?.[f.key] !== undefined && j.location_custom[f.key] !== '').map((f) => ({ label: f.label, value: f.type === 'boolean' ? (j.location_custom[f.key] ? 'Yes' : 'No') : String(j.location_custom[f.key]) }));
  // Fuel stops take several delivery lines; drivers get which fields a line fills, never the prices.
  const linesFor = (j: any) => { const pricing = readPricing(j.service_pricing); return takesLines({ category: j.category, pricing }) ? lineKeys(pricing) : null; };
  return c.json({ jobs: rows.map(({ location_custom, service_pricing, ...j }) => ({ ...j, details: publicDetails(j.details), nextAction: driverNext(j), site_fields: siteFields({ location_custom }), delivery_lines: linesFor({ ...j, service_pricing }) })), userId: cc.actingUserId, companyId: cc.company.id, fetchedAt: new Date().toISOString() });
});

function publicDetails(d: Record<string, unknown> | null) {
  return Object.fromEntries(Object.entries(d ?? {}).filter(([k]) => !k.startsWith('_')));
}

jobRoutes.get('/jobs/:id', async (c) => {
  const cc = c.get('cc');
  const job = await loadJob(cc, cc.db, c.req.param('id'));
  const svc = await service(cc.db, cc.company.id, job.service_id);
  const customer = job.customer_id ? (await cc.db.query<any>(`select id, name, ${can(cc, 'customers.contact') ? 'email, phone' : 'null as email, null as phone'} from rigo.customers where id = $1`, [job.customer_id])).rows[0] : null;
  const live = job.location_id ? (await cc.db.query<any>(`select * from rigo.locations where id = $1`, [job.location_id])).rows[0] : null;
  // The site contact's phone is for people who see contact details and the driver doing the job.
  if (live && !can(cc, 'customers.contact') && !isAssignedWorker(cc, job)) live.site_contact_phone = undefined;
  // Drivers see only the location fields marked for them (R5-M2), here as on My jobs.
  const allLocationFields = customFieldsSchema.parse(cc.company.settings?.customFields ?? {}).locations;
  const locationFields = can(cc, 'jobs.view_all') ? allLocationFields : allLocationFields.filter((f) => f.driverVisible);
  if (live && !can(cc, 'jobs.view_all')) live.custom = Object.fromEntries(Object.entries(live.custom ?? {}).filter(([k]) => locationFields.some((f) => f.key === k)));
  // The job shows the address it was booked for; if the location was edited since, both are shown.
  const snap = job.location_snapshot;
  const location = live ? { ...live, ...(snap ? { label: snap.label ?? live.label, address: snap.address ?? live.address, access_instructions: snap.access ?? live.access_instructions, site_contact: snap.siteContact ?? live.site_contact } : {}),
    current_address: snap && snap.address !== live.address ? live.address : null } : null;
  const resources = (await cc.db.query(`select r.id, r.name, r.kind, r.identifier from rigo.job_resources jr join rigo.resources r on r.id = jr.resource_id where jr.job_id = $1`, [job.id])).rows;
  const events = (await cc.db.query(`select e.id, e.type, e.data, e.created_at, e.actor_label, u.name as actor_name from rigo.job_events e left join rigo.users u on u.id = e.actor_user_id where e.job_id = $1 order by e.created_at`, [job.id])).rows;
  // A photo of a check shows the amount and bank details: only people who see money get it.
  const files = (await cc.db.query(`select id, name, mime, size, created_at,
        exists (select 1 from rigo.payments p where p.company_id = f.company_id and p.photo_file_id = f.id) as payment_photo from rigo.files f where company_id = $1 and subject_type = 'job' and subject_id = $2
      ${can(cc, 'finance.view') ? '' : 'and not exists (select 1 from rigo.payments p where p.company_id = f.company_id and p.photo_file_id = f.id)'} order by created_at`, [cc.company.id, job.id])).rows;
  // The invoice that bills this job is the newest one that isn't void; voided ones are listed for history.
  const invoices = can(cc, 'invoices.view') ? (await cc.db.query<any>(`select id, number, status, delivery_status, payment_status, due_date, ${can(cc, 'finance.view') ? 'total_minor, paid_minor, credited_minor' : 'null as total_minor'}, currency, hold_reasons, void_reason, replaces_invoice_id
      from rigo.invoices where job_id = $1 and company_id = $2 order by created_at desc`, [job.id, cc.company.id])).rows.map((i) => ({ ...i, payment: paymentState({ status: i.status, paymentStatus: i.payment_status, dueDate: i.due_date }, localDate(new Date(), cc.company.timezone)) })) : [];
  const invoice = invoices.find((i: any) => i.status !== 'void') ?? null;
  const voidedInvoices = invoices.filter((i: any) => i.status === 'void');
  const collected = can(cc, 'finance.view') ? (await cc.db.query<any>(`select id, amount_minor, method, reference, state, paid_on from rigo.payments where job_id = $1 and company_id = $2 order by recorded_at`, [job.id, cc.company.id])).rows : [];
  const messages = can(cc, 'messages.view') ? (await cc.db.query(`select id, channel, subject, status, created_at from rigo.messages where job_id = $1 order by created_at desc`, [job.id])).rows : null;
  const assignee = job.assigned_user_id ? (await cc.db.query<any>(`select coalesce(m.display_name, u.name) as name from rigo.users u left join rigo.memberships m on m.user_id = u.id and m.company_id = $2 where u.id = $1`, [job.assigned_user_id, cc.company.id])).rows[0]?.name : null;
  const customFields = customFieldsSchema.parse(cc.company.settings?.customFields ?? {}).jobs;
  return c.json({
    job: { ...job, details: publicDetails(job.details), billing_status: can(cc, 'invoices.view') ? job.billing_status : undefined, booked_rates: can(cc, 'finance.view') ? job.booked_rates : undefined, assignee_name: assignee, nextAction: nextAction(job),
      missing: job.status === 'draft' ? missingForOpen(job, svc?.fields ?? null) : [] },
    service: svc ? { id: svc.id, name: svc.name, category: svc.category, fields: svc.fields, requiresPhoto: svc.requires_photo, requiresSignature: svc.requires_signature } : null,
    customer, location, resources, events, files, invoice, voidedInvoices, collected, messages, customFields,
    billTo: job.bill_to_customer_id ? (await cc.db.query<any>(`select id, name from rigo.customers where id = $1 and company_id = $2`, [job.bill_to_customer_id, cc.company.id])).rows[0] ?? null : null,
    locationFields,
    can: {
      edit: can(cc, 'jobs.edit') && !isFinished(job.status), assign: can(cc, 'jobs.assign') && !isFinished(job.status),
      work: isAssignedWorker(cc, job) && ['open', 'in_progress'].includes(job.status), correct: can(cc, 'jobs.correct') && isFinished(job.status) && job.status !== 'cancelled',
      prepareInvoice: can(cc, 'invoices.edit') && ['completed', 'partial'].includes(job.status) && !invoice,
      reportProblem: isAssignedWorker(cc, job) || can(cc, 'jobs.edit'),
    },
  });
});

// ---------------------------------------------------------------- pricing at booking and quantity checks
/** The rates this job would be charged today (customer prices included): kept to show later price changes. */
async function bookedRates(q: Q, svc: any, customerId: string | null) {
  if (!svc) return {};
  const cust = customerId ? (await q.query<any>(`select price_overrides from rigo.customers where id = $1`, [customerId])).rows[0] : null;
  const overrides = cust?.price_overrides?.[svc.id] ?? {};
  return Object.fromEntries(readPricing(svc.pricing).map((p) => [p.id, p.id in overrides ? overrides[p.id] : p.rateE4]));
}

/**
 * A confirmed quantity above what the job's truck holds, or more than 3× the request, needs the
 * driver to type it again; once confirmed it is accepted and the invoice is held for review.
 */
async function reviewQuantities(q: Q, job: any, fields: FieldDef[], values: Record<string, unknown>, confirmed: Record<string, string>) {
  const trucks = (await q.query<any>(`select r.name, r.capacity_quantity, r.capacity_unit from rigo.job_resources jr join rigo.resources r on r.id = jr.resource_id where jr.job_id = $1 and r.capacity_quantity is not null`, [job.id])).rows
    .map((t): JobTruck => ({ name: t.name, capacityQuantity: t.capacity_quantity, capacityUnit: t.capacity_unit }));
  const notes: string[] = [];
  for (const check of quantityChecks(fields, values, job.details ?? {}, trucks)) {
    const f = fields.find((x) => x.key === check.field)!;
    if ((confirmed[f.key] ?? '').trim().replace(',', '.') !== String(values[f.key])) {
      throw badRequest(`${check.message} Type the quantity again to confirm it, or correct it.`, { fields: { [f.key]: check.message }, quantityCheck: { field: f.key, message: check.message } });
    }
    notes.push(`${f.label} ${check.message}`);
  }
  return notes.length ? notes.join(' ') : null;
}

/**
 * Moving a job's start keeps its length (R8-M4, R6-m7): when the start changes and the end was left
 * as it was (or not sent), the end moves by the same amount. Returns the new end, or null to use
 * whatever was sent.
 */
export function keepDuration(job: { scheduled_start: string | Date | null; scheduled_end: string | Date | null }, start: string | null | undefined, end: string | null | undefined) {
  if (!start || !job.scheduled_start || !job.scheduled_end) return null;
  const oldStart = new Date(job.scheduled_start).getTime(); const oldEnd = new Date(job.scheduled_end).getTime();
  const newStart = new Date(start).getTime();
  if (newStart === oldStart) return null;
  if (end !== undefined && end !== null && new Date(end).getTime() !== oldEnd) return null;
  return new Date(newStart + (oldEnd - oldStart)).toISOString();
}

// ---------------------------------------------------------------- create & edit
const jobInput = z.object({
  customerId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  serviceId: z.string().uuid().nullable().optional(),
  scheduledStart: z.string().datetime({ offset: true }).nullable().optional(),
  scheduledEnd: z.string().datetime({ offset: true }).nullable().optional(),
  contactName: z.string().max(120).optional(), contactPhone: z.string().max(40).optional(),
  accessInstructions: z.string().max(2000).optional(), notes: z.string().max(4000).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
  priority: z.enum(['normal', 'urgent', 'emergency']).optional(),
  /** Who pays, when not the customer at the service location (R6-M4). */
  billToCustomerId: z.string().uuid().nullable().optional(),
});

async function validateRefs(q: Q, cc: CompanyCtx, input: z.infer<typeof jobInput>) {
  // References must belong to this company; ids from another company are rejected as not found.
  if (input.customerId) {
    const r = await q.query<{ archived: boolean }>(`select archived_at is not null as archived from rigo.customers where id = $1 and company_id = $2`, [input.customerId, cc.company.id]);
    if (!r.rows.length) throw badRequest('Choose a customer from this company.', { fields: { customerId: 'Unknown customer' } });
    if (r.rows[0].archived) throw badRequest('That customer is archived. Restore them first, or choose another.', { fields: { customerId: 'Archived customer' } });
  }
  if (input.locationId) {
    const r = await q.query<any>(`select customer_id from rigo.locations where id = $1 and company_id = $2`, [input.locationId, cc.company.id]);
    if (!r.rows.length) throw badRequest('Choose a location from this company.', { fields: { locationId: 'Unknown location' } });
    if (input.customerId && r.rows[0].customer_id !== input.customerId) throw badRequest('That location belongs to a different customer.', { fields: { locationId: 'Belongs to another customer' } });
  }
  if (input.billToCustomerId) {
    const r = await q.query<{ archived: boolean }>(`select archived_at is not null as archived from rigo.customers where id = $1 and company_id = $2`, [input.billToCustomerId, cc.company.id]);
    if (!r.rows.length) throw badRequest('Choose who pays from this company\'s customers.', { fields: { billToCustomerId: 'Unknown customer' } });
    if (r.rows[0].archived) throw badRequest('That customer is archived. Restore them first, or choose another.', { fields: { billToCustomerId: 'Archived customer' } });
  }
  const svc = input.serviceId ? await service(q, cc.company.id, input.serviceId) : null;
  if (input.serviceId && !svc) throw badRequest('Choose a service from this company.', { fields: { serviceId: 'Unknown service' } });
  if (input.scheduledStart && input.scheduledEnd && input.scheduledEnd <= input.scheduledStart) throw badRequest('The end time must be after the start time.', { fields: { scheduledEnd: 'End must be after start' } });
  return svc;
}

jobRoutes.post('/jobs', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.create');
  const input = await body(c, jobInput.extend({ intent: z.enum(['draft', 'open']).default('draft'), clientRequestId: z.string().min(8).max(80) }));
  const result = await cc.db.tx(async (q) => {
    // A double-click or retry with the same request id returns the job already created.
    const dup = await q.query<any>(`select id, number from rigo.jobs where company_id = $1 and details->>'_clientRequestId' = $2`, [cc.company.id, input.clientRequestId]);
    if (dup.rows[0]) return { id: dup.rows[0].id, number: dup.rows[0].number, duplicate: true, missing: [] as string[] };
    const svc = await validateRefs(q, cc, input);
    const fields = (svc?.fields ?? []) as FieldDef[];
    const req = validateValues(fields.filter((f) => f.stage !== 'completion' && fieldApplies(f, input.details)), input.details ?? {}, { enforceRequired: false });
    const custom = validateValues(customFieldsSchema.parse(cc.company.settings?.customFields ?? {}).jobs, input.custom ?? {}, { enforceRequired: input.intent === 'open' });
    const fieldErrors = { ...Object.fromEntries(Object.entries(req.errors).map(([k, v]) => [`details.${k}`, v])), ...Object.fromEntries(Object.entries(custom.errors).map(([k, v]) => [`custom.${k}`, v])) };
    if (Object.keys(fieldErrors).length) throw badRequest('Some information needs attention.', { fields: fieldErrors });
    const draftLike = { customer_id: input.customerId ?? null, location_id: input.locationId ?? null, service_id: input.serviceId ?? null, details: req.clean };
    const missing = missingForOpen(draftLike, fields);
    if (input.intent === 'open' && missing.length) throw badRequest('This job is missing required information. Save it as a draft or complete it.', { missing });
    const seq = await q.query<{ job_seq: number }>(`update rigo.companies set job_seq = job_seq + 1 where id = $1 returning job_seq`, [cc.company.id]);
    const end = input.scheduledEnd ?? (input.scheduledStart ? new Date(new Date(input.scheduledStart).getTime() + DEFAULT_JOB_MINUTES * 60000).toISOString() : null);
    const { rows } = await q.query<{ id: string }>(
      `insert into rigo.jobs (company_id, number, customer_id, location_id, service_id, status, scheduled_start, scheduled_end, contact_name, contact_phone, access_instructions, notes, details, created_by, priority, booked_rates, bill_to_customer_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
      [cc.company.id, seq.rows[0].job_seq, draftLike.customer_id, draftLike.location_id, draftLike.service_id, input.intent, input.scheduledStart ?? null, end,
        input.contactName ?? '', input.contactPhone ?? '', input.accessInstructions ?? '', input.notes ?? '',
        JSON.stringify({ ...req.clean, ...Object.fromEntries(Object.entries(custom.clean).map(([k, v]) => [`custom_${k}`, v])), _clientRequestId: input.clientRequestId }), cc.user.id, input.priority ?? 'normal',
        JSON.stringify(await bookedRates(q, svc, input.billToCustomerId ?? draftLike.customer_id)), input.billToCustomerId ?? null]);
    await event(q, cc, rows[0].id, 'created', { status: input.intent });
    await emit(q, cc.company.id, 'job.created', { type: 'job', id: rows[0].id }, {}, { actorUserId: cc.user.id });
    if (input.priority === 'emergency') await alertEmergency(q, cc, { id: rows[0].id, number: seq.rows[0].job_seq, priority: 'emergency', status: input.intent, assigned_user_id: null });
    return { id: rows[0].id, number: seq.rows[0].job_seq, duplicate: false, missing };
  });
  return c.json(result);
});

jobRoutes.patch('/jobs/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.edit');
  const input = await body(c, jobInput.extend({ version: z.number().int() }));
  const out = await cc.db.tx(async (q) => {
    const job = await loadJob(cc, q, c.req.param('id'), true);
    if (job.version !== input.version) throw conflict('This job was changed by someone else while you were editing. Reload to see the latest version.', { serverVersion: job.version });
    if (isFinished(job.status)) throw conflict('Finished jobs cannot be edited. Use "Correct record" to change completed information with history.');
    input.scheduledEnd = keepDuration(job, input.scheduledStart, input.scheduledEnd) ?? input.scheduledEnd;
    const merged = { customerId: input.customerId !== undefined ? input.customerId : job.customer_id, locationId: input.locationId !== undefined ? input.locationId : job.location_id, serviceId: input.serviceId !== undefined ? input.serviceId : job.service_id };
    const svc = await validateRefs(q, cc, { ...input, ...merged });
    const fields = (svc?.fields ?? []) as FieldDef[];
    const det = input.details ? validateValues(fields.filter((f) => f.stage !== 'completion' && fieldApplies(f, input.details)), input.details, { enforceRequired: false }) : null;
    if (det && Object.keys(det.errors).length) throw badRequest('Some information needs attention.', { fields: Object.fromEntries(Object.entries(det.errors).map(([k, v]) => [`details.${k}`, v])) });
    const hidden = Object.fromEntries(Object.entries(job.details ?? {}).filter(([k]) => k.startsWith('_') || k.startsWith('custom_')));
    const details = det ? { ...det.clean, ...hidden } : job.details;
    if (job.status !== 'draft') {
      const missing = missingForOpen({ customer_id: merged.customerId, location_id: merged.locationId, service_id: merged.serviceId, details }, fields);
      if (missing.length) throw badRequest('An open job must keep its required information.', { missing });
    }
    const before = { customer_id: job.customer_id, location_id: job.location_id, service_id: job.service_id, scheduled_start: job.scheduled_start, details: publicDetails(job.details), notes: job.notes, priority: job.priority };
    // A different service or customer means different prices: the booking price snapshot is taken again.
    const billTo = input.billToCustomerId !== undefined ? input.billToCustomerId : job.bill_to_customer_id;
    const rebook = merged.serviceId !== job.service_id || merged.customerId !== job.customer_id || billTo !== job.bill_to_customer_id || !job.booked_rates;
    const movedEnd = keepDuration(job, input.scheduledStart, input.scheduledEnd);
    const newStart = input.scheduledStart ?? job.scheduled_start; const newEnd = movedEnd ?? input.scheduledEnd ?? job.scheduled_end;
    if (newStart && newEnd && new Date(newEnd) <= new Date(newStart)) throw badRequest('The end time must be after the start time.', { fields: { scheduledEnd: 'End must be after start' } });
    await q.query(`update rigo.jobs set customer_id = $3, location_id = $4, service_id = $5, scheduled_start = coalesce($6, scheduled_start), scheduled_end = coalesce($7, scheduled_end),
        contact_name = coalesce($8, contact_name), contact_phone = coalesce($9, contact_phone), access_instructions = coalesce($10, access_instructions), notes = coalesce($11, notes),
        details = $12, priority = coalesce($13, priority), booked_rates = case when $14 then $15::jsonb else booked_rates end,
        bill_to_customer_id = case when $16 then $17::uuid else bill_to_customer_id end,
        version = version + 1, updated_at = now() where id = $1 and company_id = $2`,
      [job.id, cc.company.id, merged.customerId, merged.locationId, merged.serviceId, input.scheduledStart ?? null, movedEnd ?? input.scheduledEnd ?? null,
        input.contactName ?? null, input.contactPhone ?? null, input.accessInstructions ?? null, input.notes ?? null, JSON.stringify(details), input.priority ?? null,
        rebook, rebook ? JSON.stringify(await bookedRates(q, svc, billTo ?? merged.customerId)) : null, input.billToCustomerId !== undefined, input.billToCustomerId ?? null]);
    await event(q, cc, job.id, 'edited', { before });
    // The assigned driver hears about what changed for them, in plain words (R11-M2).
    const after = (await q.query<any>(`select j.*, coalesce(j.location_snapshot->>'address', l.address) as address from rigo.jobs j left join rigo.locations l on l.id = j.location_id where j.id = $1`, [job.id])).rows[0];
    const oldAddress = job.location_snapshot?.address ?? (job.location_id ? (await q.query<any>(`select address from rigo.locations where id = $1`, [job.location_id])).rows[0]?.address : null) ?? null;
    if (job.assigned_user_id) await noteDriverChange(q, cc, after, changeLines(job, after, cc.company.timezone, { before: oldAddress, after: after.address }));
    if (after.priority === 'emergency' && job.priority !== 'emergency') await alertEmergency(q, cc, after);
    return { version: job.version + 1 };
  });
  return c.json(out);
});

jobRoutes.post('/jobs/:id/status', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.edit');
  const input = await body(c, z.object({ to: z.enum(['draft', 'open', 'cancelled']), version: z.number().int(), reason: z.string().max(500).optional() }));
  const out = await cc.db.tx(async (q) => {
    const job = await loadJob(cc, q, c.req.param('id'), true);
    if (job.version !== input.version) throw conflict('This job changed since you loaded it. Reload and try again.');
    if (!canTransition(job.status, input.to)) throw conflict(`A job that is ${job.status.replace('_', ' ')} cannot move to ${input.to}.`);
    if (input.to === 'open') {
      const svc = await service(q, cc.company.id, job.service_id);
      const missing = missingForOpen(job, svc?.fields ?? null);
      if (missing.length) throw badRequest('This job is missing required information.', { missing });
    }
    if (input.to === 'cancelled' && !input.reason?.trim()) throw badRequest('Give a reason for cancelling.', { fields: { reason: 'Enter a reason' } });
    await q.query(`update rigo.jobs set status = $2, billing_status = case when $2 = 'cancelled' then 'not_billable' else billing_status end, version = version + 1, updated_at = now() where id = $1`, [job.id, input.to]);
    await event(q, cc, job.id, 'status', { from: job.status, to: input.to, reason: input.reason ?? '' });
    if (input.to === 'cancelled') await audit(q, cc, 'job.cancelled', { id: job.id, number: job.number, wasStatus: job.status, reason: input.reason ?? '' });
    if (input.to === 'cancelled' && job.assigned_user_id) {
      const { notifyUsers } = await import('./inbox.js');
      await notifyUsers(q, cc.company.id, [job.assigned_user_id], { category: soon(job, cc.company.timezone) ? 'needs_action' : 'update', title: `Job #${job.number} was cancelled: don't go`, body: input.reason ?? '', link: `today`, refType: 'job_change', refId: job.id });
    }
    return { version: job.version + 1 };
  });
  return c.json(out);
});

jobRoutes.post('/jobs/:id/assign', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.assign');
  await backInService(cc);
  const input = await body(c, z.object({
    userId: z.string().uuid().nullable(), resourceIds: z.array(z.string().uuid()).max(10).default([]),
    scheduledStart: z.string().datetime({ offset: true }).nullable().optional(), scheduledEnd: z.string().datetime({ offset: true }).nullable().optional(), version: z.number().int(),
    /** The person confirmed taking a started job away from its driver. */
    confirmStarted: z.boolean().default(false),
    /** Assign anyway although it overlaps (deliberate double-booking); recorded in history (R11-m4). */
    allowOverlap: z.boolean().default(false),
  }));
  const out = await cc.db.tx(async (q) => {
    const job = await loadJob(cc, q, c.req.param('id'), true);
    if (job.version !== input.version) throw conflict('This job changed since you loaded it (it may already have been assigned). Reload and try again.');
    if (isFinished(job.status)) throw conflict('Finished jobs cannot be reassigned.');
    if (job.status === 'in_progress' && job.assigned_user_id && input.userId !== job.assigned_user_id && !input.confirmStarted) {
      // Taking a started job away needs a deliberate yes: the driver may be on site with work recorded (R9-M2).
      const name = (await q.query<any>(`select coalesce(m.display_name, u.name) as name from rigo.users u left join rigo.memberships m on m.user_id = u.id and m.company_id = $2 where u.id = $1`, [job.assigned_user_id, cc.company.id])).rows[0]?.name ?? 'The driver';
      throw conflict(`${name} has already started job #${job.number}.`, { needsConfirm: 'started', driverName: name });
    }
    // Reassigning work already underway is allowed; it is recorded and the previous driver is told.
    if (input.userId) {
      const m = await q.query(`select 1 from rigo.memberships m join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
          where m.company_id = $1 and m.user_id = $2 and m.status = 'active' and (r.is_owner or 'jobs.work' = any(r.permissions))`, [cc.company.id, input.userId]);
      if (!m.rows.length) throw badRequest('That person cannot be assigned work in this company (their role cannot complete jobs).', { fields: { userId: 'Not an eligible driver' } });
    }
    const resources = input.resourceIds.length ? (await q.query<any>(`select id, name, status from rigo.resources where company_id = $1 and id = any($2)`, [cc.company.id, input.resourceIds])).rows : [];
    if (resources.length !== input.resourceIds.length) throw badRequest('Choose trucks or equipment from this company.', { fields: { resourceIds: 'Unknown resource' } });
    // Only a truck being added must be in service: one already on the job can stay while dispatch
    // reassigns the driver, or be removed (R11-M1).
    const current = new Set((await q.query<{ resource_id: string }>(`select resource_id from rigo.job_resources where job_id = $1`, [job.id])).rows.map((r) => r.resource_id));
    const unavailable = resources.filter((r) => (r.status === 'out_of_service' || r.status === 'retired') && !current.has(r.id));
    if (unavailable.length) throw conflict(`${unavailable.map((r) => r.name).join(', ')} is out of service.`, { fields: { resourceIds: 'Out of service' } });
    const start = input.scheduledStart !== undefined ? input.scheduledStart : job.scheduled_start;
    let end = keepDuration(job, input.scheduledStart, input.scheduledEnd) ?? (input.scheduledEnd !== undefined ? input.scheduledEnd : job.scheduled_end);
    if (start && !end) end = new Date(new Date(start).getTime() + DEFAULT_JOB_MINUTES * 60000).toISOString();
    if (start && end && new Date(end) <= new Date(start)) throw badRequest('The end time must be after the start time.', { fields: { scheduledEnd: 'End must be after start' } });
    let overlap: string[] | null = null;
    if (start && end) {
      const clashes = [];
      if (input.userId) {
        const r = await q.query<any>(`select number from rigo.jobs where company_id = $1 and id <> $2 and assigned_user_id = $3 and status in ('open','in_progress') and scheduled_start < $5 and coalesce(scheduled_end, scheduled_start + interval '1 hour') > $4`, [cc.company.id, job.id, input.userId, start, end]);
        if (r.rows.length) {
          const who = (await q.query<any>(`select coalesce(m.display_name, u.name) as name from rigo.users u left join rigo.memberships m on m.user_id = u.id and m.company_id = $2 where u.id = $1`, [input.userId, cc.company.id])).rows[0]?.name ?? 'The driver';
          clashes.push(`${who} is busy then: job #${r.rows.map((x) => x.number).join(', #')}.`);
        }
      }
      if (input.resourceIds.length) {
        const r = await q.query<any>(`select distinct j.number, res.name from rigo.job_resources jr join rigo.jobs j on j.id = jr.job_id join rigo.resources res on res.id = jr.resource_id
            where jr.company_id = $1 and j.id <> $2 and jr.resource_id = any($3) and j.status in ('open','in_progress') and j.scheduled_start < $5 and coalesce(j.scheduled_end, j.scheduled_start + interval '1 hour') > $4`, [cc.company.id, job.id, input.resourceIds, start, end]);
        if (r.rows.length) clashes.push(...r.rows.map((x) => `${x.name} is already on job #${x.number} at that time.`));
      }
      if (clashes.length && !input.allowOverlap) throw conflict(clashes.length === 1 ? clashes[0] : `${clashes.length} overlaps at that time.`, { clashes, canOverride: true });
      if (clashes.length) overlap = clashes;
    }
    await q.query(`update rigo.jobs set assigned_user_id = $2, scheduled_start = $3, scheduled_end = $4, version = version + 1, updated_at = now() where id = $1`, [job.id, input.userId, start, end]);
    await q.query(`delete from rigo.job_resources where job_id = $1`, [job.id]);
    for (const rid of input.resourceIds) await q.query(`insert into rigo.job_resources (job_id, resource_id, company_id) values ($1,$2,$3)`, [job.id, rid, cc.company.id]);
    const changedDriver = job.assigned_user_id !== input.userId;
    await event(q, cc, job.id, changedDriver ? (job.assigned_user_id ? (input.userId ? 'reassigned' : 'unassigned') : 'assigned') : 'rescheduled',
      { from: job.assigned_user_id, to: input.userId, resources: resources.map((r) => r.name), start, end, ...(overlap ? { overlapAccepted: overlap } : {}) });
    if (changedDriver && job.assigned_user_id) {
      const { notifyUsers } = await import('./inbox.js');
      await notifyUsers(q, cc.company.id, [job.assigned_user_id], { category: soon(job, cc.company.timezone) ? 'needs_action' : 'update', title: `Job #${job.number} was given to someone else`, body: 'It is no longer on your list. Don\'t go.', link: 'today', refType: 'job_change', refId: job.id });
    }
    const updated = { ...job, assigned_user_id: input.userId, scheduled_start: start, scheduled_end: end, driver_changes: changedDriver ? null : job.driver_changes };
    if (changedDriver && !input.userId) await q.query(`update rigo.jobs set driver_changes = null where id = $1`, [job.id]);
    if (changedDriver && input.userId) {
      // The new driver sees it marked "New" on their list until they open it.
      await q.query(`update rigo.jobs set driver_changes = $2 where id = $1`, [job.id, JSON.stringify({ at: new Date().toISOString(), lines: ['New job for you'], isNew: true })]);
      if (job.priority === 'emergency') await alertEmergency(q, cc, updated);
    } else if (!changedDriver && input.userId) {
      const moved = changeLines(job, updated, cc.company.timezone);
      const trucks = resources.map((r) => r.name).sort().join(', ');
      const hadTrucks = (await q.query<any>(`select string_agg(r.name, ', ' order by r.name) as names from rigo.resources r where r.id = any($1)`, [[...current]])).rows[0]?.names ?? '';
      if (trucks !== hadTrucks) moved.push(`Truck: ${trucks || 'none'}`);
      await noteDriverChange(q, cc, updated, moved);
    }
    if (changedDriver && input.userId) await emit(q, cc.company.id, 'job.assigned', { type: 'job', id: job.id }, {}, { actorUserId: cc.user.id });
    return { version: job.version + 1 };
  });
  return c.json(out);
});

/**
 * Swap one truck for another on several jobs at once (R11-M1): each job is checked on its own, so a
 * clash on one doesn't stop the others; the summary says which moved and why the rest didn't.
 */
jobRoutes.post('/jobs/swap-resource', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.assign');
  await backInService(cc);
  const input = await body(c, z.object({ fromId: z.string().uuid(), toId: z.string().uuid(), jobIds: z.array(z.string().uuid()).min(1).max(200) }));
  if (input.fromId === input.toId) throw badRequest('Choose a different truck.', { fields: { toId: 'Same truck' } });
  const out = await cc.db.tx(async (q) => {
    const res = (await q.query<any>(`select id, name, status from rigo.resources where company_id = $1 and id = any($2)`, [cc.company.id, [input.fromId, input.toId]])).rows;
    const from = res.find((r) => r.id === input.fromId), to = res.find((r) => r.id === input.toId);
    if (!from || !to) throw badRequest('Choose trucks from this company.', { fields: { toId: 'Unknown truck' } });
    if (to.status === 'out_of_service' || to.status === 'retired') throw conflict(`${to.name} is out of service.`, { fields: { toId: 'Out of service' } });
    const moved: number[] = []; const failed: { number: number; reason: string }[] = [];
    const jobs = (await q.query<any>(`select j.* from rigo.jobs j where j.company_id = $1 and j.id = any($2) and exists (select 1 from rigo.job_resources jr where jr.job_id = j.id and jr.resource_id = $3) order by j.number for update`, [cc.company.id, input.jobIds, from.id])).rows;
    for (const job of jobs) {
      if (!['draft', 'open', 'in_progress'].includes(job.status)) { failed.push({ number: job.number, reason: 'it is finished' }); continue; }
      const start = job.scheduled_start, end = job.scheduled_end ?? (start ? new Date(new Date(start).getTime() + DEFAULT_JOB_MINUTES * 60000).toISOString() : null);
      if (start && end) {
        const clash = (await q.query<any>(`select j.number from rigo.job_resources jr join rigo.jobs j on j.id = jr.job_id where jr.company_id = $1 and j.id <> $2 and jr.resource_id = $3 and j.status in ('open','in_progress') and j.scheduled_start < $5 and coalesce(j.scheduled_end, j.scheduled_start + interval '1 hour') > $4 limit 1`, [cc.company.id, job.id, to.id, start, end])).rows[0];
        if (clash) { failed.push({ number: job.number, reason: `${to.name} is on job #${clash.number} at that time` }); continue; }
      }
      await q.query(`delete from rigo.job_resources where job_id = $1 and resource_id = $2`, [job.id, from.id]);
      await q.query(`insert into rigo.job_resources (job_id, resource_id, company_id) values ($1,$2,$3) on conflict do nothing`, [job.id, to.id, cc.company.id]);
      await q.query(`update rigo.jobs set version = version + 1, updated_at = now() where id = $1`, [job.id]);
      await event(q, cc, job.id, 'resources_changed', { from: from.name, to: to.name });
      if (job.assigned_user_id && job.status !== 'draft') await noteDriverChange(q, cc, job, [`Truck changed: ${from.name} → ${to.name}`]);
      moved.push(job.number);
    }
    await audit(q, cc, 'jobs.truck_swapped', { from: from.name, to: to.name, moved, failed });
    return { moved, failed, from: from.name, to: to.name };
  });
  return c.json(out);
});

// ---------------------------------------------------------------- job report (R6-M4)
/**
 * Prepare (never send) an email with the job report for whoever pays: the bill-to customer when set
 * (the realtor who ordered the inspection), otherwise the customer. The office reviews it in Messages.
 */
jobRoutes.post('/jobs/:id/report-message', async (c) => {
  const cc = c.get('cc');
  need(cc, 'messages.send');
  const out = await cc.db.tx(async (q) => {
    const job = await loadJob(cc, q, c.req.param('id'), true);
    if (!['completed', 'partial', 'unsuccessful'].includes(job.status) || !job.completion) throw conflict('The report is ready once the driver has recorded the visit.');
    const key = `report:${job.id}`;
    const existing = (await q.query<{ id: string }>(`select id from rigo.messages where company_id = $1 and source_key = $2 and status = 'prepared'`, [cc.company.id, key])).rows[0];
    if (existing) return { messageId: existing.id, already: true };
    const to = (await q.query<any>(`select id, name, coalesce(nullif(billing_contact->>'email', ''), email) as email from rigo.customers where id = $1 and company_id = $2`, [job.bill_to_customer_id ?? job.customer_id, cc.company.id])).rows[0];
    if (!to) throw conflict('Choose the customer for this job before preparing its report.');
    const svc = await service(q, cc.company.id, job.service_id);
    const addr = job.location_snapshot?.address ?? (job.location_id ? (await q.query<any>(`select address from rigo.locations where id = $1`, [job.location_id])).rows[0]?.address : null) ?? null;
    const photos = (await q.query<{ n: number }>(`select count(*)::int n from rigo.files where company_id = $1 and subject_type = 'job' and subject_id = $2 and name not like 'signature%'
        and not exists (select 1 from rigo.payments p where p.company_id = rigo.files.company_id and p.photo_file_id = rigo.files.id)`, [cc.company.id, job.id])).rows[0].n;
    const lines = reportLines((svc?.fields ?? []) as FieldDef[], job.details, job.completion.values);
    const inspection = job.details?.service_detail === 'Inspection';
    const text = reportText({ company: cc.company.name, companyPhone: cc.company.phone, customer: to.name, jobNumber: job.number, serviceName: svc?.name ?? 'Service', address: addr,
      date: new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: cc.company.timezone }).format(new Date(job.completed_at ?? job.updated_at)),
      outcome: OUTCOMES[job.status as keyof typeof OUTCOMES] ?? job.status, ...lines, notes: job.completion.notes ?? '', photoCount: photos, signer: job.completion.signerName || null,
      deliveries: job.completion.lines ?? [], unit: ((svc?.fields ?? []) as FieldDef[]).find((f) => f.type === 'number' && f.stage !== 'request')?.unit ?? '' });
    const subject = `${inspection ? 'Inspection report' : 'Job report'}: ${addr ?? `job #${job.number}`}`;
    const { rows } = await q.query<{ id: string }>(`insert into rigo.messages (company_id, customer_id, job_id, channel, recipient, subject, body, source_key, created_by) values ($1,$2,$3,'email',$4,$5,$6,$7,$8) returning id`,
      [cc.company.id, to.id, job.id, to.email ?? '', subject, text, key, cc.user.id]);
    await event(q, cc, job.id, 'report_prepared', { messageId: rows[0].id });
    return { messageId: rows[0].id, already: false };
  });
  return c.json(out);
});

// ---------------------------------------------------------------- driver flow
/** The driver read what changed ("Got it"): the "Changed" mark goes away. */
jobRoutes.post('/jobs/:id/seen-changes', async (c) => {
  const cc = c.get('cc');
  await cc.db.tx(async (q) => {
    const job = await loadJob(cc, q, c.req.param('id'), true);
    if (!isAssignedWorker(cc, job)) throw forbidden();
    await q.query(`update rigo.jobs set driver_changes = null where id = $1`, [job.id]);
    const { resolveNotices } = await import('./inbox.js');
    await resolveNotices(q, cc.company.id, 'job_change', job.id);
  });
  return c.json({ ok: true });
});

jobRoutes.post('/jobs/:id/start', async (c) => {
  const cc = c.get('cc');
  const input = await body(c, z.object({ version: z.number().int() }));
  const out = await cc.db.tx(async (q) => {
    const job = await loadJob(cc, q, c.req.param('id'), true);
    if (!isAssignedWorker(cc, job)) throw forbidden('Only the assigned driver can start this job.');
    if (job.status === 'in_progress') return { version: job.version, already: true };
    if (job.version !== input.version) throw conflict('This job changed. Refresh your list.');
    if (!canTransition(job.status, 'in_progress')) throw conflict(`This job is ${job.status.replace('_', ' ')} and cannot be started.`);
    await q.query(`update rigo.jobs set status = 'in_progress', version = version + 1, updated_at = now() where id = $1`, [job.id]);
    await event(q, cc, job.id, 'started');
    return { version: job.version + 1 };
  });
  return c.json(out);
});

// Hand-over on a shared phone or a shift change (R4-M4): the assigned driver gives the job to another
// driver; status and anything already done stay, and history records who handed it to whom.
async function workers(q: Q, companyId: string, exceptUserId: string) {
  return (await q.query<{ id: string; name: string }>(`select m.user_id as id, coalesce(m.display_name, u.name) as name from rigo.memberships m join rigo.users u on u.id = m.user_id join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
      where m.company_id = $1 and m.status = 'active' and m.user_id <> $2 and (r.is_owner or 'jobs.work' = any(r.permissions)) order by name`, [companyId, exceptUserId])).rows;
}

jobRoutes.get('/jobs/:id/handover', async (c) => {
  const cc = c.get('cc');
  const job = await loadJob(cc, cc.db, c.req.param('id'));
  if (!isAssignedWorker(cc, job)) throw forbidden('Only the assigned driver can hand this job over.');
  return c.json({ drivers: await workers(cc.db, cc.company.id, cc.actingUserId) });
});

jobRoutes.post('/jobs/:id/handover', async (c) => {
  const cc = c.get('cc');
  const input = await body(c, z.object({ toUserId: z.string().uuid(), version: z.number().int(), note: z.string().trim().max(500).default('') }));
  const out = await cc.db.tx(async (q) => {
    const job = await loadJob(cc, q, c.req.param('id'), true);
    if (!isAssignedWorker(cc, job)) throw forbidden('Only the assigned driver can hand this job over.');
    if (isFinished(job.status) || job.status === 'cancelled') throw conflict('This job is finished and cannot be handed over.');
    if (job.version !== input.version) throw conflict('This job changed. Refresh your list.');
    const to = (await workers(q, cc.company.id, cc.actingUserId)).find((w) => w.id === input.toUserId);
    if (!to) throw badRequest('Choose a driver from this company.', { fields: { toUserId: 'Not an eligible driver' } });
    await q.query(`update rigo.jobs set assigned_user_id = $2, version = version + 1, updated_at = now() where id = $1`, [job.id, to.id]);
    await event(q, cc, job.id, 'handed_over', { from: cc.actingUserId, to: to.id, toName: to.name, note: input.note });
    const { notifyUsers } = await import('./inbox.js');
    await notifyUsers(q, cc.company.id, [to.id], { category: 'update', title: `${cc.user.name} handed you job #${job.number}`, body: input.note || (job.status === 'in_progress' ? 'It is already started.' : 'It is now on your list.'), link: `today/${job.id}` });
    await notifyPermission(q, cc.company.id, 'jobs.assign', { category: 'update', title: `Job #${job.number} handed over to ${to.name}`, body: `By ${cc.user.name}.`, link: `jobs/${job.id}` });
    return { version: job.version + 1, to: to.name };
  });
  return c.json(out);
});

const dataUrl = z.string().max(4_000_000).regex(/^data:image\/(png|jpeg|webp);base64,/, 'Images must be PNG, JPEG or WebP');

export const completionInput = z.object({
  submissionId: z.string().min(8).max(80), baseVersion: z.number().int(),
  outcome: z.enum(['completed', 'partial', 'unsuccessful']), values: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().max(4000).default(''), reason: z.string().max(2000).default(''),
  /** Could-not-complete quick reason (R6-m5). */
  reasonCode: z.enum(REASON_CODE_KEYS).nullable().default(null),
  photos: z.array(dataUrl).max(MAX_PHOTOS).default([]), signature: dataUrl.nullable().default(null), signerName: z.string().max(120).default(''),
  /** The customer's name typed instead of drawn, with their agreement (R9-m4); recorded as typed. */
  signatureTyped: z.boolean().default(false),
  problem: z.string().max(2000).default(''),
  /** Fuel stops: one line per product or tank delivered, with meter readings and a ticket (R7-M1, R7-M4). */
  lines: z.array(deliveryLineSchema).max(12).default([]),
  /** The driver retyped these quantities to confirm them after a "more than the truck holds" warning. */
  confirmQuantities: z.record(z.string(), z.string()).default({}),
  /** Payment taken at the stop (D21): check, cash or a card on a separate terminal. The office confirms it. */
  collected: z.object({
    method: z.enum(['check', 'cash', 'card_terminal']), amountMinor: z.number().int().positive('Enter the amount collected').max(100_000_000),
    reference: z.string().trim().max(80).default(''), photo: dataUrl.nullable().default(null),
  }).nullable().default(null),
});
export type CompletionInput = z.infer<typeof completionInput>;

/** Check a completion against the service (values, required fields, photos, signature, quantities). Throws 400 with field errors. */
export async function validateCompletion(q: Q, companyId: string, job: any, input: CompletionInput) {
  if (input.collected?.method === 'check' && !input.collected.reference) throw badRequest('Enter the check number.', { fields: { 'collected.reference': 'Enter the check number' } });
  const svc = await service(q, companyId, job.service_id);
  // Delivery lines (fuel): each is checked; their total is the job's delivered quantity, and a meter
  // reading that doesn't match the quantity holds the invoice for the office to check.
  let lines: DeliveryLine[] | undefined;
  const lineWarnings: string[] = [];
  if (input.lines.length && input.outcome !== 'unsuccessful') {
    const pricing = readPricing(svc?.pricing);
    const keys = lineKeys(pricing);
    if (!svc || !keys || !takesLines({ category: svc.category, pricing })) throw badRequest('This service records one quantity per job, not delivery lines.');
    const choice = ((svc.fields ?? []) as FieldDef[]).find((f) => f.key === keys.choice);
    const unit = ((svc.fields ?? []) as FieldDef[]).find((f) => f.key === keys.quantity)?.unit ?? '';
    const errs: Record<string, string> = {};
    input.lines.forEach((l, i) => {
      if (choice?.type === 'select' && !choice.options?.includes(l.product)) errs[`lines.${i}.product`] = `Choose a listed ${choice.label.toLowerCase()}`;
      const p = lineProblems(l, unit);
      for (const [k, v] of Object.entries(p.errors)) errs[`lines.${i}.${k}`] = v;
      if (p.warning) lineWarnings.push(`Line ${i + 1} (${l.product}${l.tank ? `, ${l.tank}` : ''}): ${p.warning}`);
    });
    if (Object.keys(errs).length) throw badRequest('Check the delivery lines.', { fields: errs });
    lines = input.lines.map((l) => ({ ...l, quantity: lineQuantity(l)! }));
    input = { ...input, values: { ...input.values, [keys.quantity]: totalQuantity(lines) } };
  }
  // Fields that don't apply to this visit (inspection findings on a pump-out) are neither asked nor kept.
  const fields = ((svc?.fields ?? []) as FieldDef[]).filter((f) => f.stage !== 'request' && fieldApplies(f, { ...job.details, ...input.values }));
  const vals = validateValues(fields, input.values, { enforceRequired: false });
  const hasSignature = !!input.signature || (input.signatureTyped && !!input.signerName.trim());
  // A value that isn't valid ("abc", -50) keeps its own message; it must not read as "is required" (R7-m3).
  const problems = { ...completionProblems({ ...input, values: vals.clean, photoCount: input.photos.length, hasSignature }, { fields: svc?.fields ?? [], requires_photo: !!svc?.requires_photo, requires_signature: !!svc?.requires_signature }, job.details ?? {}), ...vals.errors };
  if (Object.keys(problems).length) throw badRequest(Object.keys(vals.errors).length ? 'Some values need attention.' : 'Some required information is missing.', { fields: problems });
  const reviewed = await reviewQuantities(q, job, (svc?.fields ?? []) as FieldDef[], vals.clean, input.confirmQuantities);
  const quantityReview = [reviewed, ...lineWarnings].filter(Boolean).join(' ') || null;
  return { values: vals.clean, quantityReview, ...(lines ? { lines } : {}) };
}

/** Store an image from the driver's phone (checked to be a real image, at most 2 MB). */
export async function saveImage(q: Q, a: { companyId: string; isDemo: boolean; userId: string; subjectType: string; subjectId: string }, url: string, name: string) {
  const buf = Buffer.from(url.split(',')[1], 'base64');
  if (buf.length > MAX_IMAGE_BYTES) throw badRequest('Each photo must be 2 MB or smaller.');
  const mime = sniffImage(buf);
  if (!mime) throw badRequest('A photo is not a valid image. Take it again or choose another.', { fields: { photos: 'That photo couldn\'t be read' } });
  const id = crypto.randomUUID();
  const st = a.isDemo ? { storage: 'database' as const, storage_key: null, data: buf } : storeFile(id, buf);
  await q.query(`insert into rigo.files (id, company_id, subject_type, subject_id, name, mime, size, storage, storage_key, data, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, a.companyId, a.subjectType, a.subjectId, name, mime, buf.length, st.storage, st.storage_key, st.data, a.userId]);
  return id;
}

/** Payment taken at the stop: recorded once per submission, waiting for the office to confirm it. It pays the job's invoice, never a second bill. */
export async function recordCollected(q: Q, cc: CompanyCtx, job: any, input: CompletionInput, checkPhotoId: string | null, recordedBy: string) {
  if (!input.collected) return;
  const c2 = input.collected;
  const inv = (await q.query<any>(`select id from rigo.invoices where job_id = $1 and status <> 'void' order by created_at desc limit 1`, [job.id])).rows[0];
  const pay = await q.query<{ id: string }>(`insert into rigo.payments (company_id, invoice_id, customer_id, job_id, amount_minor, method, reference, photo_file_id, paid_on, recorded_by, idempotency_key, kind, state, applied_minor)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'payment','unconfirmed',0) on conflict (company_id, idempotency_key) do nothing returning id`,
    [cc.company.id, inv?.id ?? null, job.customer_id, job.id, c2.amountMinor, c2.method, c2.reference, checkPhotoId, localDate(new Date(), cc.company.timezone), recordedBy, `stop:${input.submissionId}`]);
  if (!pay.rows[0]) return;
  await event(q, cc, job.id, 'payment_collected', { method: c2.method });
  const what = c2.method === 'check' ? `check #${c2.reference}` : c2.method === 'cash' ? 'cash' : `card on the terminal${c2.reference ? ` (${c2.reference})` : ''}`;
  await notifyPermissions(q, cc.company.id, ['payments.record', 'finance.view'], { category: 'needs_action', title: `Payment collected at job #${job.number}: ${formatMoney(c2.amountMinor, cc.company.currency)}`, body: `Paid by ${what}. Confirm it so it counts toward the invoice.`, link: 'collections', refType: 'payment', refId: pay.rows[0].id });
}

/**
 * Record an outcome on a job and start what follows (billing, follow-ups). Used for the driver's own
 * submission and for a held record the office accepts later (`files` already stored, `submittedBy`
 * the driver). `implicitStart` is set when the job was never started: history says so.
 */
export async function finishJob(q: Q, cc: CompanyCtx, job: any, input: CompletionInput, checked: { values: Record<string, unknown>; quantityReview: string | null; lines?: DeliveryLine[] },
  opts: { files?: { photoIds: string[]; signatureId: string | null; checkPhotoId: string | null }; submittedBy?: string; acceptedFrom?: string } = {}) {
  const ctx = { companyId: cc.company.id, isDemo: cc.isDemo, userId: cc.user.id, subjectType: 'job', subjectId: job.id };
  let files = opts.files;
  if (!files) {
    const photoIds: string[] = [];
    for (let i = 0; i < input.photos.length; i++) photoIds.push(await saveImage(q, ctx, input.photos[i], `photo-${i + 1}.${input.photos[i].includes('png') ? 'png' : 'jpg'}`));
    files = { photoIds, signatureId: input.signature ? await saveImage(q, ctx, input.signature, 'signature.png') : null, checkPhotoId: input.collected?.photo ? await saveImage(q, ctx, input.collected.photo, 'check.jpg') : null };
  }
  if (job.status === 'open') await event(q, cc, job.id, 'started', { implicit: true, note: 'Recorded with the outcome; the job was not started first.' });
  const completion = { outcome: input.outcome, values: checked.values, notes: input.notes, reason: input.reason, reasonCode: input.reasonCode, photoIds: files.photoIds, signatureId: files.signatureId,
    signerName: input.signerName, signatureTyped: input.signatureTyped && !input.signature, submittedAt: new Date().toISOString(), submittedBy: opts.submittedBy ?? cc.user.id,
    ...(opts.acceptedFrom ? { acceptedBy: cc.user.id, acceptedFrom: opts.acceptedFrom } : {}), ...(checked.quantityReview ? { quantityReview: checked.quantityReview } : {}), ...(checked.lines?.length ? { lines: checked.lines } : {}) };
  const billing = billingAfterOutcome(input.outcome);
  await q.query(`update rigo.jobs set status = $2, completion = $3, completion_submission_id = $4, billing_status = $5, completed_at = now(), problem_open = problem_open or $6, version = version + 1, updated_at = now() where id = $1`,
    [job.id, input.outcome, JSON.stringify(completion), input.submissionId, billing, !!input.problem.trim()]);
  await event(q, cc, job.id, 'completion', { outcome: input.outcome, values: checked.values, notes: input.notes, reason: input.reason, photos: files.photoIds.length, signed: !!files.signatureId || completion.signatureTyped, typedSignature: completion.signatureTyped, ...(opts.acceptedFrom ? { acceptedFrom: opts.acceptedFrom } : {}) });
  if (input.problem.trim()) {
    await event(q, cc, job.id, 'problem', { text: input.problem });
    await emit(q, cc.company.id, 'job.problem_reported', { type: 'job', id: job.id }, {}, { actorUserId: cc.user.id });
  }
  await recordCollected(q, cc, job, input, files.checkPhotoId, opts.submittedBy ?? cc.user.id);
  // Downstream work (invoices, follow-ups) starts only now that the server has accepted the record.
  await emit(q, cc.company.id, `job.${input.outcome}`, { type: 'job', id: job.id }, {}, { actorUserId: cc.user.id });
  if (input.outcome !== 'completed') {
    await notifyPermission(q, cc.company.id, 'jobs.assign', { category: 'warning', title: `Job #${job.number}: ${input.outcome === 'partial' ? 'partly completed' : 'could not be completed'}`, body: input.reason, link: `jobs/${job.id}`, refType: 'job', refId: job.id, dedupeKey: `outcome:${job.id}` });
  }
  return { accepted: true, duplicate: false, version: job.version + 1, status: input.outcome };
}

/** Was this person ever assigned this job? (The assignment history says so.) */
export async function wasAssigned(q: Q, job: any, userId: string) {
  if (job.assigned_user_id === userId) return true;
  const r = await q.query(`select 1 from rigo.job_events where job_id = $1 and type in ('assigned','reassigned','unassigned','handed_over') and (data->>'to' = $2 or data->>'from' = $2) limit 1`, [job.id, userId]);
  return r.rows.length > 0;
}

jobRoutes.post('/jobs/:id/complete', async (c) => {
  const cc = c.get('cc');
  const input = await body(c, completionInput);
  input.reason = outcomeReason(input.reasonCode, input.reason);
  const out = await cc.db.tx(async (q) => {
    const id = c.req.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Job');
    const job = (await q.query<any>(`select * from rigo.jobs where id = $1 and company_id = $2 for update`, [id, cc.company.id])).rows[0];
    if (!job) throw notFound('Job');
    // Idempotent: the same submission arriving twice (retry, reconnect) returns the accepted result.
    if (job.completion_submission_id === input.submissionId) return { accepted: true, duplicate: true, version: job.version, status: job.status };
    const held = (await q.query<any>(`select id from rigo.pending_submissions where company_id = $1 and submission_id = $2`, [cc.company.id, input.submissionId])).rows[0];
    if (held) return { accepted: false, pendingReview: true, duplicate: true, message: 'Already sent to the office for review.' };
    const mine = job.assigned_user_id === cc.actingUserId && can(cc, 'jobs.work');
    if (!mine) {
      // Someone who was assigned this job and recorded work on it isn't turned away: the record goes
      // to the office for review instead of being lost (R9-M2). Anyone else learns nothing.
      if (!can(cc, 'jobs.work') || !(await wasAssigned(q, job, cc.actingUserId))) throw notFound('Job');
      const { holdForReview } = await import('./late-records.js');
      return holdForReview(q, { companyId: cc.company.id, isDemo: cc.isDemo, userId: cc.actingUserId, userName: cc.user.name }, job, input, 'reassigned');
    }
    if (isFinished(job.status)) {
      const { holdForReview } = await import('./late-records.js');
      return holdForReview(q, { companyId: cc.company.id, isDemo: cc.isDemo, userId: cc.actingUserId, userName: cc.user.name }, job, input, 'finished');
    }
    if (job.version !== input.baseVersion) {
      // The office is told, so they know the driver has a record waiting on their edit (R13-m2).
      await notifyPermission(q, cc.company.id, 'jobs.assign', { category: 'needs_action', title: `${cc.user.name} has a record for job #${job.number} that conflicts with an edit`, body: 'They were asked to review the latest details and submit again.', link: `jobs/${job.id}`, refType: 'job_conflict', refId: job.id, dedupeKey: `conflict:${job.id}:${input.submissionId}` });
      throw conflict('The office changed this job after you opened it. Review what changed, then submit again.', { reason: 'changed', serverVersion: job.version });
    }
    const checked = await validateCompletion(q, cc.company.id, job, input);
    return finishJob(q, cc, job, input, checked);
  });
  return c.json(out);
});

jobRoutes.post('/jobs/:id/problem', async (c) => {
  const cc = c.get('cc');
  const input = await body(c, z.object({ text: z.string().trim().min(3, 'Describe the problem').max(2000) }));
  await cc.db.tx(async (q) => {
    const job = await loadJob(cc, q, c.req.param('id'), true);
    if (!isAssignedWorker(cc, job) && !can(cc, 'jobs.edit')) throw forbidden();
    await q.query(`update rigo.jobs set problem_open = true, updated_at = now() where id = $1`, [job.id]);
    await event(q, cc, job.id, 'problem', { text: input.text });
    await notifyRoles(q, cc.company.id, ['owner', 'dispatcher'], { category: 'warning', title: `Problem reported on job #${job.number}`, body: input.text, link: `jobs/${job.id}`, refType: 'job_problem', refId: job.id });
    await emit(q, cc.company.id, 'job.problem_reported', { type: 'job', id: job.id }, {}, { actorUserId: cc.user.id });
  });
  return c.json({ ok: true });
});

jobRoutes.post('/jobs/:id/problem/resolve', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.edit');
  const input = await body(c, z.object({ note: z.string().max(1000).default('') }));
  await cc.db.tx(async (q) => {
    const job = await loadJob(cc, q, c.req.param('id'), true);
    await q.query(`update rigo.jobs set problem_open = false, updated_at = now() where id = $1`, [job.id]);
    await event(q, cc, job.id, 'problem_resolved', { note: input.note });
    const { resolveNotices } = await import('./inbox.js');
    await resolveNotices(q, cc.company.id, 'job_problem', job.id);
  });
  return c.json({ ok: true });
});

jobRoutes.post('/jobs/:id/notes', async (c) => {
  const cc = c.get('cc');
  const input = await body(c, z.object({ text: z.string().trim().min(1).max(2000) }));
  await cc.db.tx(async (q) => {
    const job = await loadJob(cc, q, c.req.param('id'));
    if (!isAssignedWorker(cc, job) && !can(cc, 'jobs.edit')) throw forbidden();
    await event(q, cc, job.id, 'note', { text: input.text });
  });
  return c.json({ ok: true });
});

/** Corrections to finished records keep the original in history and re-validate billing. */
jobRoutes.post('/jobs/:id/correct', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.correct');
  const input = await body(c, z.object({ values: z.record(z.string(), z.unknown()), notes: z.string().max(4000).optional(), reason: z.string().trim().min(3, 'Explain the correction').max(1000), version: z.number().int() }));
  const out = await cc.db.tx(async (q) => {
    const job = await loadJob(cc, q, c.req.param('id'), true);
    if (job.version !== input.version) throw conflict('This job changed since you loaded it. Reload and try again.');
    if (!['completed', 'partial', 'unsuccessful'].includes(job.status)) throw conflict('Only finished jobs are corrected; edit open jobs directly.');
    const svc = await service(q, cc.company.id, job.service_id);
    const fields = ((svc?.fields ?? []) as FieldDef[]).filter((f) => f.stage !== 'request' && fieldApplies(f, { ...job.details, ...input.values }));
    const vals = validateValues(fields, input.values, { enforceRequired: job.status === 'completed' });
    if (Object.keys(vals.errors).length) throw badRequest('Some information needs attention.', { fields: vals.errors });
    const before = job.completion;
    const completion = { ...job.completion, values: vals.clean, notes: input.notes ?? job.completion?.notes ?? '' };
    await q.query(`update rigo.jobs set completion = $2, version = version + 1, updated_at = now() where id = $1`, [job.id, JSON.stringify(completion)]);
    await event(q, cc, job.id, 'correction', { reason: input.reason, before: { values: before?.values, notes: before?.notes }, after: { values: completion.values, notes: completion.notes } });
    const inv = (await q.query<any>(`select id, status from rigo.invoices where job_id = $1 and status <> 'void' order by created_at desc limit 1`, [job.id])).rows[0];
    let invoiceNote = '';
    if (inv) {
      if (['held', 'draft', 'pending_approval', 'approved'].includes(inv.status)) {
        await invalidateApprovalsFor(q, cc.company.id, 'invoice', inv.id);
        await q.query(`update rigo.invoices set status = 'held', version = version + 1 where id = $1`, [inv.id]);
        await rebuildHeldInvoice(q, inv.id);
        invoiceNote = 'The draft invoice was rebuilt from the corrected record; any earlier approval no longer applies.';
      } else if (inv.status === 'issued') {
        invoiceNote = 'The invoice was already issued and was not changed. Void and re-issue it if the amount must change.';
        await notifyPermission(q, cc.company.id, 'invoices.edit', { category: 'warning', title: `Job #${job.number} corrected after invoicing`, body: invoiceNote, link: `invoices/${inv.id}`, refType: 'invoice', refId: inv.id });
      }
    }
    return { version: job.version + 1, invoiceNote };
  });
  return c.json(out);
});

jobRoutes.post('/jobs/:id/invoice', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.edit');
  const r = await cc.db.tx(async (q) => {
    await loadJob(cc, q, c.req.param('id'));
    const res = await prepareInvoiceForJob(q, cc.company.id, c.req.param('id'), { userId: cc.user.id });
    await audit(q, cc, 'invoice.prepared_manually', res);
    return res;
  });
  return c.json(r);
});

jobRoutes.get('/jobs/:id/files/:fid', async (c) => {
  const cc = c.get('cc');
  const job = await loadJob(cc, cc.db, c.req.param('id'));
  const { rows } = await cc.db.query<any>(`select * from rigo.files f where id = $1 and company_id = $2 and subject_type = 'job' and subject_id = $3
      ${can(cc, 'finance.view') ? '' : 'and not exists (select 1 from rigo.payments p where p.company_id = f.company_id and p.photo_file_id = f.id)'}`, [c.req.param('fid'), cc.company.id, job.id]);
  const data = rows[0] && readStoredFile(rows[0]);
  if (!data) throw notFound('File');
  return c.body(new Uint8Array(data), 200, { 'content-type': rows[0].mime, 'cache-control': 'private, max-age=600', 'x-content-type-options': 'nosniff', 'content-disposition': `inline; filename="${rows[0].name.replace(/[^\w.-]/g, '_')}"` });
});
