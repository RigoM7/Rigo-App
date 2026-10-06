import { Hono } from 'hono';
import { z } from 'zod';
import type { Q } from '../db/index.js';
import { getDb } from '../db/index.js';
import { type AppEnv, type CompanyCtx, need, can, requireUser, audit } from '../http/context.js';
import { body } from '../lib/util.js';
import { HttpError, conflict, notFound } from '../http/errors.js';
import { isFinished, outcomeReason } from '../../shared/jobs.js';
import { readStoredFile } from '../adapters/index.js';
import { notifyPermission, notifyUsers, resolveNotices } from './inbox.js';
import { limitCalls, recordCall } from './accounts.js';
import { completionInput, validateCompletion, saveImage, finishJob, recordCollected, wasAssigned, event, type CompletionInput } from './jobs.js';

// Work a driver recorded on their phone is never thrown away because the job moved on (R9-M2, R12-M1,
// R4-m1). When the record can't be applied directly (the job was given to someone else, someone already
// finished it, or the driver was removed from the company) it is kept as a pending review: the office
// sees the values and photos and accepts or dismisses it. A removed driver may send such records for
// 7 days after removal (D12), and only for jobs they were assigned.

export const LATE_RECORD_DAYS = 7;
const MAX_PENDING_PER_PERSON = 20;
export type HoldReason = 'reassigned' | 'finished' | 'removed';

const REASON_TEXT: Record<HoldReason, string> = {
  reassigned: 'the job was given to someone else',
  finished: 'the job was already finished',
  removed: 'they are no longer a member of the company',
};

/** Store a record for the office to review. Photos are saved now so nothing on the phone is needed later. */
export async function holdForReview(q: Q, a: { companyId: string; isDemo: boolean; userId: string; userName: string }, job: any, input: CompletionInput, reason: HoldReason) {
  const dup = (await q.query<any>(`select id from rigo.pending_submissions where company_id = $1 and submission_id = $2`, [a.companyId, input.submissionId])).rows[0];
  if (dup) return { accepted: false, pendingReview: true, duplicate: true, message: 'Already sent to the office for review.' };
  // One record per person and job waits at a time, and at most 20 per person: enough for any real
  // day, and no way to fill the office's inbox or storage.
  const mine = (await q.query<{ same: number; total: number }>(`select count(*) filter (where job_id = $3)::int as same, count(*)::int as total from rigo.pending_submissions where company_id = $1 and user_id = $2 and status = 'pending'`, [a.companyId, a.userId, job.id])).rows[0];
  if (mine.same > 0) return { accepted: false, pendingReview: true, duplicate: true, message: 'You already sent a record for this job. The office is reviewing it.' };
  if (mine.total >= MAX_PENDING_PER_PERSON) throw conflict('The office has not reviewed your earlier records yet. Ask them to review those first.');
  await limitCalls(q, `late-record:${a.userId}`, 60, 60, 'records');
  await recordCall(q, `late-record:${a.userId}`);
  // Check the record the same way a normal submission is checked, but keep it even when something is
  // missing: the driver may no longer be able to fix it, and the office decides.
  let checked: { values: Record<string, unknown>; quantityReview: string | null; lines?: unknown[] } = { values: input.values, quantityReview: null };
  let problems: Record<string, string> = {};
  try {
    checked = await validateCompletion(q, a.companyId, job, input);
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 400) throw e;
    problems = ((e.details as any)?.fields ?? { record: e.message }) as Record<string, string>;
  }
  const id = crypto.randomUUID();
  const ctx = { companyId: a.companyId, isDemo: a.isDemo, userId: a.userId, subjectType: 'pending_submission', subjectId: id };
  const photoIds: string[] = [];
  for (let i = 0; i < input.photos.length; i++) photoIds.push(await saveImage(q, ctx, input.photos[i], `photo-${i + 1}.${input.photos[i].includes('png') ? 'png' : 'jpg'}`));
  const files = { photoIds, signatureId: input.signature ? await saveImage(q, ctx, input.signature, 'signature.png') : null, checkPhotoId: input.collected?.photo ? await saveImage(q, ctx, input.collected.photo, 'check.jpg') : null };
  const { photos: _p, signature: _s, ...rest } = input;
  const payload = { ...rest, values: checked.values, quantityReview: checked.quantityReview, lines: checked.lines ?? input.lines, collected: input.collected ? { ...input.collected, photo: null } : null, files };
  await q.query(`insert into rigo.pending_submissions (id, company_id, job_id, user_id, submission_id, reason, payload, problems) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, a.companyId, job.id, a.userId, input.submissionId, reason, JSON.stringify(payload), JSON.stringify(problems)]);
  await q.query(`insert into rigo.job_events (company_id, job_id, type, actor_user_id, data) values ($1,$2,'record_held',$3,$4)`,
    [a.companyId, job.id, a.userId, JSON.stringify({ reason, outcome: input.outcome, pendingId: id })]);
  const outcome = input.outcome === 'completed' ? 'completed' : input.outcome === 'partial' ? 'partly completed' : 'could not complete';
  await notifyPermission(q, a.companyId, 'jobs.assign', {
    category: 'needs_action', title: `${a.userName} sent a record for job #${job.number}: ${outcome}`,
    body: `It wasn't applied because ${REASON_TEXT[reason]}. Review it and accept or dismiss it.`, link: 'jobs/records', refType: 'pending_submission', refId: id,
  });
  return { accepted: false, pendingReview: true, duplicate: false, message: 'Sent to the office for review. They will decide whether it is used.' };
}

// ---------------------------------------------------------------- removed drivers (no company session)
export const latePublic = new Hono<AppEnv>();

latePublic.post('/late-records/:cid/jobs/:jid', async (c) => {
  const user = requireUser(c);
  const cid = c.req.param('cid'), jid = c.req.param('jid');
  if (!/^[0-9a-f-]{36}$/i.test(cid) || !/^[0-9a-f-]{36}$/i.test(jid)) throw notFound('Job');
  const input = await body(c, completionInput);
  input.reason = outcomeReason(input.reasonCode, input.reason);
  const db = await getDb();
  const out = await db.tx(async (q) => {
    // Only a member removed in the last 7 days, whose role could do field work, and only for a job
    // they were assigned. Anyone else gets the same "not found" as for a record that doesn't exist.
    const m = (await q.query<any>(
      `select m.id, co.kind, coalesce(m.display_name, u.name) as name, (r.is_owner or 'jobs.work' = any(r.permissions)) as can_work
         from rigo.memberships m join rigo.companies co on co.id = m.company_id join rigo.users u on u.id = m.user_id
         left join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
        where m.company_id = $1 and m.user_id = $2 and m.status = 'removed' and m.removed_at > now() - ($3 || ' days')::interval`,
      [cid, user.id, String(LATE_RECORD_DAYS)])).rows[0];
    if (!m || !m.can_work) throw notFound('Job');
    const job = (await q.query<any>(`select * from rigo.jobs where id = $1 and company_id = $2 for update`, [jid, cid])).rows[0];
    if (!job || !(await wasAssigned(q, job, user.id))) throw notFound('Job');
    if (job.completion_submission_id === input.submissionId) return { accepted: true, duplicate: true };
    return holdForReview(q, { companyId: cid, isDemo: m.kind === 'demo', userId: user.id, userName: m.name }, job, input, 'removed');
  });
  return c.json(out);
});

// ---------------------------------------------------------------- office review
export const lateRoutes = new Hono<AppEnv>();

function shape(cc: CompanyCtx, r: any) {
  const p = r.payload ?? {};
  // Payment amounts are financial: only people who see money see what was collected.
  const collected = p.collected ? (can(cc, 'finance.view') ? p.collected : { method: p.collected.method, reference: p.collected.reference }) : null;
  // Values are listed with the service's labels, in its order.
  const fields = ((r.service_fields ?? []) as { key: string; label: string; unit?: string }[]);
  const vals = (p.values ?? {}) as Record<string, unknown>;
  const values = [...fields.filter((f) => vals[f.key] !== undefined && vals[f.key] !== '').map((f) => ({ label: f.label, value: `${vals[f.key]}${f.unit ? ` ${f.unit}` : ''}` })),
    ...Object.keys(vals).filter((k) => !fields.some((f) => f.key === k) && vals[k] !== '').map((k) => ({ label: k, value: String(vals[k]) }))];
  return {
    id: r.id, jobId: r.job_id, values, jobNumber: r.job_number, jobStatus: r.job_status, customerName: r.customer_name, driverName: r.driver_name, reason: r.reason, status: r.status,
    createdAt: r.created_at, decidedAt: r.decided_at, decidedBy: r.decided_by_name, decisionNote: r.decision_note, problems: r.problems ?? {},
    outcome: p.outcome, notes: p.notes ?? '', reasonText: p.reason ?? '', reasonCode: p.reasonCode ?? null, problem: p.problem ?? '',
    signerName: p.signerName ?? '', signatureTyped: !!p.signatureTyped, collected,
    files: { photoIds: p.files?.photoIds ?? [], signatureId: p.files?.signatureId ?? null, checkPhotoId: can(cc, 'finance.view') ? p.files?.checkPhotoId ?? null : null },
  };
}

const listSql = `select s.*, j.number as job_number, j.status as job_status, c.name as customer_name, coalesce(m.display_name, u.name) as driver_name, d.name as decided_by_name, sv.fields as service_fields
  from rigo.pending_submissions s join rigo.jobs j on j.id = s.job_id left join rigo.customers c on c.id = j.customer_id left join rigo.services sv on sv.id = j.service_id
  join rigo.users u on u.id = s.user_id left join rigo.memberships m on m.company_id = s.company_id and m.user_id = s.user_id left join rigo.users d on d.id = s.decided_by`;

lateRoutes.get('/pending-submissions', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.assign');
  const all = c.req.query('status') === 'all';
  const { rows } = await cc.db.query<any>(`${listSql} where s.company_id = $1 ${all ? '' : `and s.status = 'pending'`} order by s.created_at desc limit 100`, [cc.company.id]);
  return c.json({ records: rows.map((r) => shape(cc, r)) });
});

lateRoutes.get('/pending-submissions/:id/files/:fid', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.assign');
  // Once a record is accepted its files belong to the job and are served from there.
  const { rows } = await cc.db.query<any>(`select f.* from rigo.files f join rigo.pending_submissions s on s.id = f.subject_id and s.company_id = f.company_id
      where f.id = $1 and f.company_id = $2 and f.subject_type = 'pending_submission' and s.id = $3
        ${can(cc, 'finance.view') ? '' : `and f.id::text is distinct from s.payload->'files'->>'checkPhotoId'`}`, [c.req.param('fid'), cc.company.id, c.req.param('id')]);
  const f = rows[0];
  const data = f && readStoredFile(f);
  if (!data) throw notFound('File');
  return c.body(new Uint8Array(data), 200, { 'content-type': f.mime, 'cache-control': 'private, max-age=600', 'x-content-type-options': 'nosniff' });
});

async function loadPending(q: Q, cc: CompanyCtx, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Record');
  const s = (await q.query<any>(`select * from rigo.pending_submissions where id = $1 and company_id = $2 for update`, [id, cc.company.id])).rows[0];
  if (!s) throw notFound('Record');
  if (s.status !== 'pending') throw conflict(`This record was already ${s.status}.`);
  return s;
}

lateRoutes.post('/pending-submissions/:id/accept', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.assign');
  const out = await cc.db.tx(async (q) => {
    const s = await loadPending(q, cc, c.req.param('id'));
    const job = (await q.query<any>(`select * from rigo.jobs where id = $1 and company_id = $2 for update`, [s.job_id, cc.company.id])).rows[0];
    if (!job) throw notFound('Job');
    const p = s.payload;
    const files = p.files ?? { photoIds: [], signatureId: null, checkPhotoId: null };
    const ids = [...files.photoIds, files.signatureId, files.checkPhotoId].filter(Boolean);
    // The photos become the job's files.
    if (ids.length) await q.query(`update rigo.files set subject_type = 'job', subject_id = $3 where company_id = $1 and id = any($2) and subject_type = 'pending_submission'`, [cc.company.id, ids, job.id]);
    const input = completionInput.parse({ ...p, photos: [], signature: null, collected: p.collected ? { ...p.collected, photo: null } : null });
    let result: string;
    if (isFinished(job.status) || ['cancelled', 'draft'].includes(job.status)) {
      // The job already has an outcome: the record joins its history (and any payment collected is
      // recorded for confirmation) without replacing what was accepted first.
      await event(q, cc, job.id, 'late_record', { from: s.user_id, outcome: p.outcome, values: p.values, notes: p.notes, reason: p.reason, photos: files.photoIds.length, fileIds: ids, heldBecause: s.reason });
      await recordCollected(q, cc, job, input, files.checkPhotoId, s.user_id);
      result = 'Added to the job history. The job keeps its earlier outcome.';
    } else {
      await finishJob(q, cc, job, input, { values: p.values ?? {}, quantityReview: p.quantityReview ?? null, lines: p.lines?.length ? p.lines : undefined }, { files, submittedBy: s.user_id, acceptedFrom: s.reason });
      result = `Job #${job.number} recorded as ${p.outcome === 'partial' ? 'partly completed' : p.outcome === 'unsuccessful' ? 'could not complete' : 'completed'}.`;
    }
    await q.query(`update rigo.pending_submissions set status = 'accepted', decided_by = $2, decided_at = now() where id = $1`, [s.id, cc.user.id]);
    await resolveNotices(q, cc.company.id, 'pending_submission', s.id);
    await audit(q, cc, 'late_record.accepted', { id: s.id, jobId: job.id, reason: s.reason });
    return { ok: true, message: result, jobId: job.id };
  });
  return c.json(out);
});

lateRoutes.post('/pending-submissions/:id/dismiss', async (c) => {
  const cc = c.get('cc');
  need(cc, 'jobs.assign');
  const input = await body(c, z.object({ note: z.string().trim().max(500).default('') }));
  await cc.db.tx(async (q) => {
    const s = await loadPending(q, cc, c.req.param('id'));
    await q.query(`update rigo.pending_submissions set status = 'dismissed', decided_by = $2, decided_at = now(), decision_note = $3 where id = $1`, [s.id, cc.user.id, input.note]);
    await q.query(`insert into rigo.job_events (company_id, job_id, type, actor_user_id, data) values ($1,$2,'record_dismissed',$3,$4)`, [cc.company.id, s.job_id, cc.user.id, JSON.stringify({ from: s.user_id, note: input.note })]);
    await resolveNotices(q, cc.company.id, 'pending_submission', s.id);
    await audit(q, cc, 'late_record.dismissed', { id: s.id, jobId: s.job_id, note: input.note });
    // The driver hears back if they are still on the team.
    const active = (await q.query(`select 1 from rigo.memberships where company_id = $1 and user_id = $2 and status = 'active'`, [cc.company.id, s.user_id])).rows.length > 0;
    const num = (await q.query<any>(`select number from rigo.jobs where id = $1`, [s.job_id])).rows[0]?.number;
    if (active) await notifyUsers(q, cc.company.id, [s.user_id], { category: 'update', title: `Your record for job #${num} was not used`, body: input.note || 'The office reviewed it and kept the job as it was.', link: 'today' });
  });
  return c.json({ ok: true });
});
