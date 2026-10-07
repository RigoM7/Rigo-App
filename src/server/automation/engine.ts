import type { Db, Q } from '../db/index.js';
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import {
  ACTIONS, approvalNeeded, effectiveMode, evaluate, stableHash, stepDisposition, TRIGGERS, canDecideFor,
  type Definition, type Mode, type Step,
} from '../../shared/workflows.js';
import { notifyRoles, notifyUsers, notifyPermission, resolveNotices } from '../modules/inbox.js';
import { conflict, forbidden, notFound } from '../http/errors.js';
import { handlers, type HandlerResult } from './actions.js';

// The automation engine. Durable state lives in events -> automation_runs -> actions -> approvals.
// Every execution re-checks pause state, workflow version, membership/permission and capability.
// Retries are bounded, every action has an idempotency key, and event depth limits loops.

const MAX_DEPTH = 3;
const MAX_RUNS_PER_EVENT = 10;
const HOURLY_ACTION_LIMIT = 300;
const BACKOFF_SECONDS = [60, 300];

export interface EmitOpts { depth?: number; actorUserId?: string | null }

export async function emit(q: Q, companyId: string, type: string, subject: { type: string; id: string }, data: Record<string, unknown> = {}, opts: EmitOpts = {}) {
  await q.query(`insert into rigo.events (company_id, type, subject_type, subject_id, data, depth, actor_user_id) values ($1,$2,$3,$4,$5,$6,$7)`,
    [companyId, type, subject.type, subject.id, JSON.stringify(data), opts.depth ?? 0, opts.actorUserId ?? null]);
  kick();
}

// ---------------------------------------------------------------- facts for conditions
export async function factsFor(q: Q, subjectType: string, subjectId: string, ctx: Record<string, string> = {}) {
  const facts: Record<string, unknown> = {};
  const jobId = subjectType === 'job' ? subjectId : ctx.jobId;
  const invoiceId = subjectType === 'invoice' ? subjectId : ctx.invoiceId;
  if (jobId) {
    const { rows } = await q.query<any>(`select j.*, s.category, s.name as service_name, c.name as customer_name from rigo.jobs j
      left join rigo.services s on s.id = j.service_id left join rigo.customers c on c.id = j.customer_id where j.id = $1`, [jobId]);
    const j = rows[0];
    if (j) Object.assign(facts, { 'job.service_category': j.category, 'job.service_name': j.service_name, 'job.problem_open': j.problem_open, 'job.has_assignee': !!j.assigned_user_id, 'job.priority': j.priority ?? 'normal', 'customer.name': j.customer_name,
      'job.partial': j.status === 'partial', 'job.quantity_over_capacity': !!j.completion?.quantityReview });
    if (j?.customer_id) Object.assign(facts, await customerFacts(q, j.customer_id));
  }
  if (invoiceId) {
    const { rows } = await q.query<any>(`select i.*, c.name as customer_name,
        exists (select 1 from rigo.invoice_lines l where l.invoice_id = i.id and l.booked_rate_e4 is not null) as price_changed
      from rigo.invoices i left join rigo.customers c on c.id = i.customer_id where i.id = $1`, [invoiceId]);
    const i = rows[0];
    if (i) Object.assign(facts, { 'invoice.total_minor': i.total_minor, 'invoice.held': i.status === 'held', 'invoice.price_changed': !!i.price_changed, 'invoice.status': i.status, 'customer.name': i.customer_name });
    if (i?.customer_id) Object.assign(facts, await customerFacts(q, i.customer_id));
  }
  return facts;
}

/** Customer facts for conditions: tax exemption and terms; "type" is the customer's Type custom field when the company has one. */
async function customerFacts(q: Q, customerId: string) {
  const c = (await q.query<any>(`select tax_exempt, custom, payment_terms_days from rigo.customers where id = $1`, [customerId])).rows[0];
  if (!c) return {};
  const custom = c.custom ?? {};
  const type = custom.type ?? custom.customer_type ?? custom.tag ?? '';
  return { 'customer.tax_exempt': !!c.tax_exempt, 'customer.type': String(type) };
}

// ---------------------------------------------------------------- event -> runs
async function processEvent(db: Db, eventId: string) {
  await db.tx(async (q) => {
    const lock = db.kind === 'pg' ? ' for update skip locked' : '';
    const { rows } = await q.query<any>(`select * from rigo.events where id = $1 and processed_at is null${lock}`, [eventId]);
    const ev = rows[0];
    if (!ev) return;
    await q.query(`update rigo.events set processed_at = now() where id = $1`, [ev.id]);
    if (ev.depth > MAX_DEPTH) {
      await q.query(`insert into rigo.audit_log (company_id, action, detail) values ($1,'automation.loop_guard',$2)`, [ev.company_id, JSON.stringify({ event: ev.type, depth: ev.depth })]);
      return;
    }
    const wfs = await q.query<any>(
      `select w.id, w.paused, v.id as version_id, v.definition from rigo.workflows w join rigo.workflow_versions v on v.id = w.active_version_id
        where w.company_id = $1 and v.definition->'trigger'->>'event' = $2 limit $3`, [ev.company_id, ev.type, MAX_RUNS_PER_EVENT]);
    for (const wf of wfs.rows) {
      const def = wf.definition as Definition;
      const facts = await factsFor(q, ev.subject_type, ev.subject_id);
      if (!def.conditions.every((c) => evaluate(c, facts))) continue;
      const ctx: Record<string, string> = {};
      if (ev.subject_type === 'job') ctx.jobId = ev.subject_id;
      if (ev.subject_type === 'invoice') {
        ctx.invoiceId = ev.subject_id;
        const j = await q.query<any>(`select job_id from rigo.invoices where id = $1`, [ev.subject_id]);
        if (j.rows[0]?.job_id) ctx.jobId = j.rows[0].job_id;
      }
      await q.query(
        `insert into rigo.automation_runs (company_id, workflow_id, workflow_version_id, event_id, subject_type, subject_id, depth, idempotency_key, context, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'running') on conflict (company_id, idempotency_key) do nothing`,
        [ev.company_id, wf.id, wf.version_id, ev.id, ev.subject_type, ev.subject_id, ev.depth, `${wf.version_id}:${ev.id}`, JSON.stringify(ctx)]);
    }
  });
}

// ---------------------------------------------------------------- run advancement
async function loadRun(q: Q, runId: string) {
  const { rows } = await q.query<any>(
    `select r.*, v.definition, v.status as version_status, w.paused as workflow_paused, w.mode_override, w.active_version_id,
            c.automation_mode, c.paused as company_paused, c.kind as company_kind, v.activated_by,
            coalesce((c.settings->>'invoiceApprovalRequired')::boolean, true) as invoice_approval_required
       from rigo.automation_runs r join rigo.workflow_versions v on v.id = r.workflow_version_id
       join rigo.workflows w on w.id = r.workflow_id join rigo.companies c on c.id = r.company_id
      where r.id = $1`, [runId]);
  return rows[0];
}

/** The step as its approval is requested: one without approvers of its own asks everyone who can approve invoices. */
async function approvalStep(q: Q, run: any, step: Step): Promise<Step> {
  if (step.approval.approverRoles.length || step.approval.approverUserIds.length) return step;
  return { ...step, approval: { ...step.approval, approverRoles: await invoiceApproverRoles(q, run.company_id) } };
}

/** Roles whose members can approve invoices (owner, and any role with "Approve invoices" or "Decide approvals"). */
export async function invoiceApproverRoles(q: Q, companyId: string) {
  return (await q.query<{ key: string }>(`select key from rigo.roles where company_id = $1 and (is_owner or 'invoices.approve' = any(permissions) or 'approvals.decide' = any(permissions))`, [companyId])).rows.map((r) => r.key);
}

function subjectForStep(step: Step, run: any): { type: string; id: string } | null {
  const need = ACTIONS[step.action].needs;
  const ctx = run.context ?? {};
  if (need === 'job') return ctx.jobId ? { type: 'job', id: ctx.jobId } : null;
  if (need === 'invoice') return ctx.invoiceId ? { type: 'invoice', id: ctx.invoiceId } : null;
  if (need === 'message') return ctx.messageId ? { type: 'message', id: ctx.messageId } : null;
  return { type: run.subject_type, id: run.subject_id };
}

export async function subjectVersion(q: Q, type: string, id: string) {
  const table = type === 'job' ? 'jobs' : type === 'invoice' ? 'invoices' : null;
  if (!table) return 1;
  const { rows } = await q.query<{ version: number }>(`select version from rigo.${table} where id = $1`, [id]);
  return rows[0]?.version ?? 0;
}

async function approverIds(q: Q, companyId: string, rule: Pick<Step['approval'], 'approverRoles' | 'approverUserIds'>, subjectType = 'invoice') {
  const { rows } = await q.query<{ user_id: string }>(
    `select m.user_id from rigo.memberships m join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
      where m.company_id = $1 and m.status = 'active' and not m.is_fictional and (m.role_key = any($2) or m.user_id = any($3))
        and (r.is_owner or 'approvals.decide' = any(r.permissions) or ($4 = 'invoice' and 'invoices.approve' = any(r.permissions)))
     union select c.demo_user_id from rigo.companies c where c.id = $1 and c.kind = 'demo'`, [companyId, rule.approverRoles, rule.approverUserIds, subjectType]);
  return rows.map((r) => r.user_id).filter(Boolean);
}

/**
 * Pending approvals that no current member except an owner override could decide (after a role
 * change or a removal). Owners are told at once so nothing waits forever (R14-C1).
 */
export async function warnOrphanedApprovals(q: Q, companyId: string) {
  const pending = (await q.query<any>(`select * from rigo.approvals where company_id = $1 and status = 'pending'`, [companyId])).rows;
  let n = 0;
  for (const ap of pending) {
    const ids = (await approverIds(q, companyId, { approverRoles: ap.approver_roles, approverUserIds: ap.approver_user_ids }, ap.subject_type));
    const named = await q.query(`select 1 from rigo.memberships m join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
        where m.company_id = $1 and m.status = 'active' and m.user_id = any($2) and not r.is_owner`, [companyId, ids]);
    const owners = await q.query(`select 1 from rigo.memberships m where m.company_id = $1 and m.status = 'active' and m.role_key = 'owner' and (m.role_key = any($2) or m.user_id = any($3))`, [companyId, ap.approver_roles, ap.approver_user_ids]);
    if (named.rows.length || owners.rows.length) continue;
    n++;
    await notifyRoles(q, companyId, ['owner'], { category: 'needs_action', title: `Nobody can approve: ${ap.title}`, body: 'The people asked to approve this can no longer approve it. As the owner you can decide it, or change who approves in the workflow.', link: `inbox?approval=${ap.id}`, refType: 'approval', refId: ap.id, dedupeKey: `orphan:${ap.id}` });
  }
  return n;
}

async function createApproval(q: Q, run: any, action: any, step: Step, subject: { type: string; id: string }) {
  const meta = ACTIONS[step.action];
  const facts = await factsFor(q, subject.type, subject.id, run?.context ?? {});
  const version = await subjectVersion(q, subject.type, subject.id);
  const label = await subjectLabel(q, subject);
  const escalateAt = step.approval.escalateAfterHours ? new Date(Date.now() + step.approval.escalateAfterHours * 3600_000).toISOString() : null;
  const { rows } = await q.query<{ id: string }>(
    `insert into rigo.approvals (company_id, action_id, title, consequence, subject_type, subject_id, subject_version, workflow_version_id, input_hash, approver_user_ids, approver_roles, backup_user_ids, escalate_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
    [action.company_id, action.id, `${meta.label}: ${label}`, meta.consequence, subject.type, subject.id, version, run?.workflow_version_id ?? null,
      stableHash({ action: step.action, subject, version, facts }), step.approval.approverUserIds, step.approval.approverRoles, step.approval.backupUserIds, escalateAt]);
  const ids = await approverIds(q, action.company_id, step.approval, subject.type);
  await notifyUsers(q, action.company_id, ids, { category: 'needs_action', title: `Approval needed: ${meta.label}, ${label}`, body: meta.consequence, link: `inbox?approval=${rows[0].id}`, refType: 'approval', refId: rows[0].id, dedupeKey: `approval:${rows[0].id}` });
  return rows[0].id;
}

/**
 * A person sends a record for approval outside any workflow ("Send for approval" on a draft
 * invoice). Everyone who may approve invoices is asked; the approver's decision runs the action
 * as the approver, bound to the record version that was sent.
 */
export async function requestApproval(q: Q, companyId: string, type: keyof typeof ACTIONS & string, subject: { type: string; id: string }, requestedBy: { userId: string; name: string }) {
  const meta = ACTIONS[type];
  const version = await subjectVersion(q, subject.type, subject.id);
  const facts = await factsFor(q, subject.type, subject.id);
  const label = await subjectLabel(q, subject);
  const act = await q.query<{ id: string }>(
    `insert into rigo.actions (company_id, type, mode, subject_type, subject_id, input, idempotency_key, status, explanation, executed_by)
     values ($1,$2,'approval',$3,$4,'{}'::jsonb,$5,'waiting_approval',$6,'person')
     on conflict (company_id, idempotency_key) do nothing returning id`,
    [companyId, type, subject.type, subject.id, `request:${type}:${subject.id}:${version}`, `Sent for approval by ${requestedBy.name}.`]);
  if (!act.rows[0]) throw conflict('This version was already sent for approval.');
  const roles = (await q.query<{ key: string }>(`select key from rigo.roles where company_id = $1 and (is_owner or 'invoices.approve' = any(permissions) or 'approvals.decide' = any(permissions))`, [companyId])).rows.map((r) => r.key);
  const { rows } = await q.query<{ id: string }>(
    `insert into rigo.approvals (company_id, action_id, title, consequence, subject_type, subject_id, subject_version, input_hash, approver_roles)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [companyId, act.rows[0].id, `${meta.label}: ${label}`, meta.consequence, subject.type, subject.id, version, stableHash({ action: type, subject, version, facts }), roles]);
  const ids = (await approverIds(q, companyId, { approverRoles: roles, approverUserIds: [] }, subject.type)).filter((u) => u !== requestedBy.userId);
  await notifyUsers(q, companyId, ids, { category: 'needs_action', title: `Approval needed: ${meta.label}, ${label}`, body: `Sent by ${requestedBy.name}. ${meta.consequence}`, link: `inbox?approval=${rows[0].id}`, refType: 'approval', refId: rows[0].id, dedupeKey: `approval:${rows[0].id}` });
  return rows[0].id;
}

export async function subjectLabel(q: Q, s: { type: string; id: string }) {
  if (s.type === 'job') {
    const { rows } = await q.query<any>(`select j.number, c.name from rigo.jobs j left join rigo.customers c on c.id = j.customer_id where j.id = $1`, [s.id]);
    return rows[0] ? `Job #${rows[0].number}${rows[0].name ? ` for ${rows[0].name}` : ''}` : 'Job';
  }
  if (s.type === 'invoice') {
    const { rows } = await q.query<any>(`select i.number, c.name, j.number as job_number from rigo.invoices i left join rigo.customers c on c.id = i.customer_id left join rigo.jobs j on j.id = i.job_id where i.id = $1`, [s.id]);
    const r = rows[0];
    return r ? `Invoice ${r.number ?? '(draft)'}${r.name ? ` for ${r.name}` : ''}${r.job_number ? ` (job #${r.job_number})` : ''}` : 'Invoice';
  }
  if (s.type === 'message') return 'Prepared message';
  return s.type;
}

/** Walk a run forward until it needs a person, finishes, or is blocked. */
export async function advanceRun(db: Db, runId: string) {
  for (let guard = 0; guard < 12; guard++) {
    const next = await db.tx(async (q) => {
      const lock = db.kind === 'pg' ? ' for update skip locked' : '';
      const locked = await q.query(`select id from rigo.automation_runs where id = $1 and status in ('running','waiting')${lock}`, [runId]);
      if (!locked.rows.length) return null;
      const run = await loadRun(q, runId);
      const def = run.definition as Definition;
      const step = def.steps[run.current_step];
      if (!step) {
        await q.query(`update rigo.automation_runs set status = 'completed', summary = 'All steps finished.', updated_at = now() where id = $1`, [runId]);
        return null;
      }
      const key = `${run.id}:${step.id}`;
      const existing = (await q.query<any>(`select * from rigo.actions where company_id = $1 and idempotency_key = $2`, [run.company_id, key])).rows[0];
      if (existing) {
        if (existing.status === 'completed' || existing.status === 'simulated') {
          if (run.context?.stopRun) {
            await q.query(`update rigo.automation_runs set status = 'completed', summary = $2, updated_at = now() where id = $1`, [runId, existing.explanation]);
            return null;
          }
          await q.query(`update rigo.automation_runs set current_step = current_step + 1, status = 'running', updated_at = now() where id = $1`, [runId]);
          return 'continue';
        }
        if (['failed', 'blocked', 'rejected', 'cancelled'].includes(existing.status)) {
          if (step.onException.stop || existing.status === 'cancelled') {
            const st = existing.status === 'rejected' || existing.status === 'cancelled' ? 'cancelled' : existing.status === 'failed' ? 'failed' : 'blocked';
            await q.query(`update rigo.automation_runs set status = $2, summary = $3, updated_at = now() where id = $1`, [runId, st, `Stopped at step ${run.current_step + 1}: ${existing.explanation}`]);
            return null;
          }
          await q.query(`update rigo.automation_runs set current_step = current_step + 1, updated_at = now() where id = $1`, [runId]);
          return 'continue';
        }
        if (existing.status === 'queued') return { execute: existing.id };
        await q.query(`update rigo.automation_runs set status = 'waiting', updated_at = now() where id = $1`, [runId]);
        return null;
      }
      if (run.company_paused || run.workflow_paused) {
        await q.query(`update rigo.automation_runs set status = 'waiting', summary = $2, updated_at = now() where id = $1`, [runId, run.company_paused ? 'Held: automation is paused for the company.' : 'Held: this workflow is paused.']);
        return null;
      }
      const meta = ACTIONS[step.action];
      const subject = subjectForStep(step, run);
      const mode = effectiveMode(run.automation_mode as Mode, run.mode_override as Mode | null, step.mode as Mode | null);
      const disp = stepDisposition(mode, meta);
      const base = [run.company_id, run.id, step.id, run.current_step, step.action, mode, subject?.type ?? run.subject_type, subject?.id ?? run.subject_id, JSON.stringify({ params: step.params }), key, run.activated_by];
      const insert = async (status: string, explanation: string) => (await q.query<any>(
        `insert into rigo.actions (company_id, run_id, step_id, step_index, type, mode, subject_type, subject_id, input, idempotency_key, run_as_user_id, status, explanation)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`, [...base, status, explanation])).rows[0];
      if (!subject) {
        await insert('blocked', `No ${meta.needs} is available for this step. An earlier step did not produce one.`);
        return 'continue';
      }
      const label = await subjectLabel(q, subject);
      if (disp === 'suggest') {
        const a = await insert('suggested', 'Manual mode: a person starts this step.');
        await notifyPermission(q, run.company_id, meta.permission, { category: 'needs_action', title: `Next step: ${meta.label}, ${label}`, body: 'Rigo is in Manual mode for this step, so it waits for you.', link: `automation?action=${a.id}`, refType: 'action', refId: a.id, dedupeKey: `action:${a.id}` });
        await q.query(`update rigo.automation_runs set status = 'waiting', summary = $2, updated_at = now() where id = $1`, [runId, `Waiting for a person: ${meta.label}`]);
        return null;
      }
      const facts = await factsFor(q, subject.type, subject.id, run.context ?? {});
      // The company rule "every invoice needs approval before issuing" (R14-M1) turns an issue step without
      // its own approval into a normal approval request for everyone who can approve invoices, never a dead end.
      const companyRule = step.action === 'invoice.issue' && run.invoice_approval_required !== false && facts['invoice.status'] !== 'approved' && !approvalNeeded(step.approval, facts);
      if (approvalNeeded(step.approval, facts) || companyRule) {
        const a = await insert('waiting_approval', companyRule ? 'Waiting for approval: company settings require it for every invoice.' : 'Waiting for approval.');
        await createApproval(q, run, a, await approvalStep(q, run, step), subject);
        await q.query(`update rigo.automation_runs set status = 'waiting', summary = $2, updated_at = now() where id = $1`, [runId, `Waiting for approval: ${meta.label}`]);
        return null;
      }
      if (disp === 'propose') {
        const a = await insert('proposed', 'Assisted mode: prepared for a person to run.');
        await notifyPermission(q, run.company_id, meta.permission, { category: 'needs_action', title: `Ready for you: ${meta.label}, ${label}`, body: meta.consequence, link: `automation?action=${a.id}`, refType: 'action', refId: a.id, dedupeKey: `action:${a.id}` });
        await q.query(`update rigo.automation_runs set status = 'waiting', summary = $2, updated_at = now() where id = $1`, [runId, `Proposed: ${meta.label}`]);
        return null;
      }
      const a = await insert('queued', 'Queued to run.');
      return { execute: a.id };
    });
    if (next === null) return;
    if (next !== 'continue') {
      const outcome = await executeAction(db, next.execute);
      if (outcome === 'held' || outcome === 'retry') return;
    }
  }
}

// ---------------------------------------------------------------- execution
async function memberCan(q: Q, companyId: string, userId: string | null, permission: string) {
  if (!userId) return false;
  const { rows } = await q.query(`select 1 from rigo.memberships m join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
      where m.company_id = $1 and m.user_id = $2 and m.status = 'active' and (r.is_owner or $3 = any(r.permissions))`, [companyId, userId, permission]);
  return rows.length > 0;
}

/** Execute one queued action with all safety re-checks. Returns what happened. */
export async function executeAction(db: Db, actionId: string): Promise<'done' | 'held' | 'retry' | 'skipped'> {
  return db.tx(async (q) => {
    const lock = db.kind === 'pg' ? ' for update skip locked' : ' for update';
    const { rows } = await q.query<any>(`select a.*, c.paused as company_paused, c.kind as company_kind from rigo.actions a join rigo.companies c on c.id = a.company_id where a.id = $1 and a.status = 'queued'${lock}`, [actionId]);
    const a = rows[0];
    if (!a) return 'skipped';
    if (a.next_attempt_at && new Date(a.next_attempt_at) > new Date()) return 'held';
    const meta = ACTIONS[a.type];
    const finish = async (status: string, explanation: string, result: unknown = null) => {
      await q.query(`update rigo.actions set status = $2, explanation = $3, result = $4, updated_at = now() where id = $1`, [a.id, status, explanation, JSON.stringify(result)]);
    };
    // Pause holds queued work; it does not undo anything already completed.
    if (a.company_paused) { await q.query(`update rigo.actions set explanation = 'Held: automation is paused for the company.', updated_at = now() where id = $1`, [a.id]); return 'held'; }
    let run: any = null;
    if (a.run_id) {
      run = await loadRun(q, a.run_id);
      if (run.workflow_paused) { await q.query(`update rigo.actions set explanation = 'Held: this workflow is paused.', updated_at = now() where id = $1`, [a.id]); return 'held'; }
      if (run.status === 'taken_over' || run.status === 'cancelled') { await finish('cancelled', 'The run was taken over or cancelled.'); return 'done'; }
      if (run.active_version_id !== run.workflow_version_id) {
        await finish('blocked', 'The workflow changed after this was queued. Nothing ran; start it again from the new version if needed.');
        await notifyRoles(q, a.company_id, ['owner'], { category: 'warning', title: `${meta.label} was not run`, body: 'Its workflow was edited or deactivated after the step was queued.', link: `automation?action=${a.id}`, refType: 'action_warning', refId: a.id });
        return 'done';
      }
    }
    const runAs = a.run_as_user_id;
    if (a.type !== 'notify' && !(await memberCan(q, a.company_id, runAs, meta.permission))) {
      await finish('blocked', `Blocked: the person this runs on behalf of no longer has permission (${meta.permission}) in this company.`);
      await notifyRoles(q, a.company_id, ['owner'], { category: 'warning', title: `${meta.label} was blocked`, body: 'The workflow’s activating member lost the needed permission. Re-activate the workflow as someone who has it.', link: `automation?action=${a.id}`, refType: 'action_warning', refId: a.id });
      return 'done';
    }
    const hourly = await q.query<{ n: number }>(`select count(*)::int n from rigo.actions where company_id = $1 and executed_by = 'rigo' and status in ('completed','simulated','failed') and updated_at > now() - interval '1 hour'`, [a.company_id]);
    if (a.executed_by === 'rigo' && hourly.rows[0].n >= HOURLY_ACTION_LIMIT) {
      await finish('blocked', `Blocked: the automation safety limit of ${HOURLY_ACTION_LIMIT} actions per hour was reached.`);
      return 'done';
    }
    await q.query(`update rigo.actions set status = 'running', attempts = attempts + 1, updated_at = now() where id = $1`, [a.id]);
    let res: HandlerResult;
    try {
      res = await handlers[a.type]({ q, companyId: a.company_id, companyKind: a.company_kind, actorUserId: runAs, actionId: a.id, depth: (run?.depth ?? 0) + 1, subject: { type: a.subject_type, id: a.subject_id }, params: a.input?.params ?? {}, context: run?.context ?? {} });
    } catch (e: any) {
      const attempts = a.attempts + 1;
      if (attempts < a.max_attempts) {
        const delay = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)];
        await q.query(`update rigo.actions set status = 'queued', next_attempt_at = now() + ($2 || ' seconds')::interval, explanation = $3, updated_at = now() where id = $1`, [a.id, String(delay), `Attempt ${attempts} failed (${String(e?.message ?? e).slice(0, 200)}). Retrying.`]);
        return 'retry';
      }
      await finish('failed', `Failed after ${attempts} attempts: ${String(e?.message ?? e).slice(0, 300)}`);
      await notifyRoles(q, a.company_id, ['owner'], { category: 'warning', title: `${meta.label} failed`, body: String(e?.message ?? e).slice(0, 300), link: `automation?action=${a.id}`, refType: 'action_warning', refId: a.id });
      return 'done';
    }
    await finish(res.status, res.explanation, res.result ?? null);
    if (run && res.context) await q.query(`update rigo.automation_runs set context = context || $2::jsonb, updated_at = now() where id = $1`, [run.id, JSON.stringify(res.context)]);
    if (res.status === 'blocked' && run) {
      const step = (run.definition as Definition).steps[a.step_index];
      if (step?.onException.notifyRoles.length) {
        await notifyRoles(q, a.company_id, step.onException.notifyRoles, { category: 'warning', title: `${meta.label} needs attention`, body: res.explanation, link: res.link ?? `automation?action=${a.id}`, refType: 'action_warning', refId: a.id, dedupeKey: `exception:${a.id}` });
      }
    }
    await resolveNotices(q, a.company_id, 'action', a.id);
    return 'done';
  }).then(async (r) => {
    if (r === 'done') {
      const { rows } = await db.query<{ run_id: string | null }>(`select run_id from rigo.actions where id = $1`, [actionId]);
      if (rows[0]?.run_id) await advanceRun(db, rows[0].run_id);
    }
    return r;
  });
}

// ---------------------------------------------------------------- people acting on actions
export interface Actor { db: Db; companyId: string; userId: string; perms: Set<string>; isOwner: boolean; isDemo: boolean }

/** A person runs a suggested (manual) or proposed (assisted) step. It executes as that person. */
export async function runActionNow(actor: Actor, actionId: string) {
  const { db } = actor;
  await db.tx(async (q) => {
    const { rows } = await q.query<any>(`select * from rigo.actions where id = $1 and company_id = $2 for update`, [actionId, actor.companyId]);
    const a = rows[0];
    if (!a) throw notFound('Action');
    if (!['suggested', 'proposed'].includes(a.status)) throw conflict('This step is no longer waiting for someone to run it.');
    const meta = ACTIONS[a.type];
    if (!actor.perms.has(meta.permission)) throw forbidden(`Running this needs the ${meta.permission} permission.`);
    await q.query(`update rigo.actions set status = 'queued', run_as_user_id = $2, executed_by = 'person', explanation = 'Started by a person.', updated_at = now() where id = $1`, [a.id, actor.userId]);
    await resolveNotices(q, actor.companyId, 'action', a.id);
  });
  return executeAction(db, actionId);
}

export async function dismissAction(actor: Actor, actionId: string) {
  await actor.db.tx(async (q) => {
    const { rows } = await q.query<any>(`select * from rigo.actions where id = $1 and company_id = $2 for update`, [actionId, actor.companyId]);
    const a = rows[0];
    if (!a) throw notFound('Action');
    if (!['suggested', 'proposed', 'queued'].includes(a.status)) throw conflict('Only waiting steps can be dismissed.');
    if (!actor.perms.has(ACTIONS[a.type].permission) && !actor.perms.has('automation.control')) throw forbidden();
    await q.query(`update rigo.actions set status = 'cancelled', explanation = 'Dismissed by a person.', updated_at = now() where id = $1`, [a.id]);
    if (a.run_id) await q.query(`update rigo.automation_runs set status = 'cancelled', summary = 'A person dismissed a step.', updated_at = now() where id = $1`, [a.run_id]);
    await resolveNotices(q, actor.companyId, 'action', a.id);
  });
}

/** Owner takeover: stop a run, cancel its waiting steps and approvals. Completed steps stay done. */
export async function takeOver(actor: Actor, runId: string) {
  await actor.db.tx(async (q) => {
    const { rows } = await q.query<any>(`select * from rigo.automation_runs where id = $1 and company_id = $2 for update`, [runId, actor.companyId]);
    if (!rows[0]) throw notFound('Run');
    if (!['running', 'waiting'].includes(rows[0].status)) throw conflict('This run has already finished.');
    const acts = await q.query<{ id: string }>(`update rigo.actions set status = 'cancelled', explanation = 'Cancelled by owner takeover.', updated_at = now() where run_id = $1 and status in ('suggested','proposed','queued','waiting_approval') returning id`, [runId]);
    for (const a of acts.rows) {
      const ap = await q.query<{ id: string }>(`update rigo.approvals set status = 'cancelled' where action_id = $1 and status = 'pending' returning id`, [a.id]);
      for (const x of ap.rows) await resolveNotices(q, actor.companyId, 'approval', x.id);
      await resolveNotices(q, actor.companyId, 'action', a.id);
    }
    await q.query(`update rigo.automation_runs set status = 'taken_over', summary = 'Taken over by a person. Remaining steps will not run automatically.', updated_at = now() where id = $1`, [runId]);
    await q.query(`insert into rigo.audit_log (company_id, actor_user_id, action, detail) values ($1,$2,'automation.takeover',$3)`, [actor.companyId, actor.userId, JSON.stringify({ runId })]);
  });
}

// ---------------------------------------------------------------- approvals
/** Owners can always decide a pending approval (R14-C1); when they aren't a named approver it is recorded as an owner override. */
export async function isEligibleApprover(q: Q, ap: any, actor: Actor) {
  return actor.isOwner || isNamedApprover(q, ap, actor);
}

async function isNamedApprover(q: Q, ap: any, actor: Actor) {
  if (!canDecideFor({ isOwner: actor.isOwner, permissions: [...actor.perms] }, ap.subject_type)) return false;
  // Named people and roles count only while the person is still an active member (a removed
  // approver's delegation ends with them).
  const direct = async (uid: string) => {
    const { rows } = await q.query<{ role_key: string }>(`select role_key from rigo.memberships where company_id = $1 and user_id = $2 and status = 'active'`, [ap.company_id, uid]);
    if (!rows[0]) return false;
    return ap.approver_user_ids.includes(uid) || ap.approver_roles.includes(rows[0].role_key);
  };
  if (actor.isDemo) return true; // the demo visitor plays every approver; still bound by all other checks
  if (await direct(actor.userId)) return true;
  if (ap.escalated_at && ap.backup_user_ids.includes(actor.userId)) return true;
  // Delegated authority: someone who could approve has delegated to this person.
  const { rows } = await q.query<{ from_user_id: string }>(`select from_user_id from rigo.approval_delegations where company_id = $1 and to_user_id = $2 and starts_at <= now() and (ends_at is null or ends_at > now())`, [ap.company_id, actor.userId]);
  for (const d of rows) if (await direct(d.from_user_id)) return true;
  return false;
}

export async function decideApproval(actor: Actor, approvalId: string, decision: 'approve' | 'reject', note: string) {
  const { db } = actor;
  const outcome = await db.tx(async (q) => {
    const { rows } = await q.query<any>(`select * from rigo.approvals where id = $1 and company_id = $2 for update`, [approvalId, actor.companyId]);
    const ap = rows[0];
    if (!ap) throw notFound('Approval');
    if (ap.status !== 'pending') throw conflict(`This approval was already ${ap.status}.`);
    if (!(await isEligibleApprover(q, ap, actor))) throw forbidden('You are not an approver for this item.');
    if (!(await isNamedApprover(q, ap, actor))) note = `Owner override${note ? `: ${note}` : ''}`;
    const action = (await q.query<any>(`select * from rigo.actions where id = $1 for update`, [ap.action_id])).rows[0];
    if (decision === 'reject') {
      await q.query(`update rigo.approvals set status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3 where id = $1`, [ap.id, actor.userId, note]);
      await q.query(`update rigo.actions set status = 'rejected', explanation = $2, updated_at = now() where id = $1`, [action.id, `Rejected${note ? `: ${note}` : '.'}`]);
      await resolveNotices(q, actor.companyId, 'approval', ap.id);
      return { status: 'rejected' as const, runId: action.run_id };
    }
    // Approval is bound to the exact record version and workflow version it was requested for.
    const version = await subjectVersion(q, ap.subject_type, ap.subject_id);
    let staleReason = '';
    if (version !== ap.subject_version) staleReason = 'The record changed after approval was requested.';
    if (!staleReason && action.run_id) {
      const run = await loadRun(q, action.run_id);
      if (run.active_version_id !== ap.workflow_version_id) staleReason = 'The workflow changed after approval was requested.';
    }
    if (staleReason) {
      await q.query(`update rigo.approvals set status = 'stale', decision_note = $2 where id = $1`, [ap.id, staleReason]);
      await resolveNotices(q, actor.companyId, 'approval', ap.id);
      return { status: 'stale' as const, reason: staleReason, actionId: action.id };
    }
    await q.query(`update rigo.approvals set status = 'approved', decided_by = $2, decided_at = now(), decision_note = $3 where id = $1`, [ap.id, actor.userId, note]);
    // A person-requested action (no workflow) runs as the approver who approved it.
    await q.query(`update rigo.actions set status = 'queued', explanation = 'Approved; queued to run.', run_as_user_id = coalesce(run_as_user_id, case when run_id is null then $2::uuid end), updated_at = now() where id = $1`, [action.id, actor.userId]);
    if (ap.subject_type === 'invoice') {
      await q.query(`update rigo.invoices set approved_by = $2, approved_at = now(), status = case when status in ('draft','pending_approval') then 'approved' else status end where id = $1`, [ap.subject_id, actor.userId]);
    }
    await resolveNotices(q, actor.companyId, 'approval', ap.id);
    return { status: 'approved' as const, actionId: action.id, runId: action.run_id };
  });
  if (outcome.status === 'approved') await executeAction(db, outcome.actionId);
  if (outcome.status === 'rejected' && outcome.runId) await advanceRun(db, outcome.runId);
  if (outcome.status === 'stale') await renewApproval(db, outcome.actionId);
  return outcome;
}

/** Re-request approval for an action whose earlier approval went stale. */
export async function renewApproval(db: Db, actionId: string) {
  await db.tx(async (q) => {
    const { rows } = await q.query<any>(`select * from rigo.actions where id = $1 and status = 'waiting_approval' for update`, [actionId]);
    const a = rows[0];
    if (!a) return;
    const pending = await q.query(`select 1 from rigo.approvals where action_id = $1 and status = 'pending'`, [a.id]);
    if (pending.rows.length) return;
    if (!a.run_id) {
      // Sent for approval by a person: an edited record goes back to its author to send again.
      await q.query(`update rigo.actions set status = 'cancelled', explanation = 'The record was edited after it was sent for approval. Send it again.', updated_at = now() where id = $1`, [a.id]);
      return;
    }
    const run = a.run_id ? await loadRun(q, a.run_id) : null;
    const step = run ? (run.definition as Definition).steps[a.step_index] : null;
    if (!run || !step || run.active_version_id !== run.workflow_version_id) {
      await q.query(`update rigo.actions set status = 'blocked', explanation = 'The workflow changed; this step was not run.', updated_at = now() where id = $1`, [a.id]);
      return;
    }
    await createApproval(q, run, a, await approvalStep(q, run, step), { type: a.subject_type, id: a.subject_id });
  });
}

/**
 * An invoice was issued or voided directly by a person (R14 linked approvals): a workflow step still
 * waiting to issue it is settled instead of left behind. Issued: the step counts as done and its run
 * continues (the email step). Voided: the step and its run stop. Returns runs to continue.
 */
export async function settleInvoiceSteps(q: Q, companyId: string, invoiceId: string, outcome: 'issued' | 'voided', actorName: string) {
  const what = outcome === 'issued' ? `Issued directly by ${actorName}.` : `Invoice voided by ${actorName}.`;
  const aps = await q.query<{ id: string }>(`update rigo.approvals set status = 'cancelled', decision_note = $3 where company_id = $1 and subject_type = 'invoice' and subject_id = $2 and status = 'pending' returning id`, [companyId, invoiceId, what]);
  for (const a of aps.rows) await resolveNotices(q, companyId, 'approval', a.id);
  const acts = await q.query<{ id: string; run_id: string | null }>(
    `update rigo.actions set status = $3, explanation = $4, updated_at = now()
      where company_id = $1 and subject_type = 'invoice' and subject_id = $2 and type = 'invoice.issue' and status in ('waiting_approval','proposed','suggested','queued') returning id, run_id`,
    [companyId, invoiceId, outcome === 'issued' ? 'completed' : 'cancelled', what]);
  for (const a of acts.rows) await resolveNotices(q, companyId, 'action', a.id);
  const runs = [...new Set(acts.rows.map((a) => a.run_id).filter(Boolean))] as string[];
  if (outcome === 'voided') {
    // Later steps (the invoice email) must not run for a voided invoice.
    await q.query(`update rigo.automation_runs set status = 'cancelled', summary = $3, updated_at = now() where company_id = $1 and status in ('running','waiting')
        and (context->>'invoiceId' = $2 or id = any($4))`, [companyId, invoiceId, what, runs]);
    return [];
  }
  return runs;
}

/** Called when a record is edited: any pending approval bound to an older version becomes stale and is re-requested. */
export async function invalidateApprovalsFor(q: Q, companyId: string, subjectType: string, subjectId: string) {
  const { rows } = await q.query<{ id: string; action_id: string }>(
    `update rigo.approvals set status = 'stale', decision_note = 'The record was edited after approval was requested.'
      where company_id = $1 and subject_type = $2 and subject_id = $3 and status = 'pending' returning id, action_id`, [companyId, subjectType, subjectId]);
  for (const r of rows) await resolveNotices(q, companyId, 'approval', r.id);
  return rows.map((r) => r.action_id);
}

// ---------------------------------------------------------------- worker
let running = false;
let again = false;

export async function processAll(budgetMs = 4000) {
  if (running) { again = true; return; }
  running = true;
  const started = Date.now();
  try {
    const db = await getDb();
    do {
      again = false;
      const evs = await db.query<{ id: string }>(`select id from rigo.events where processed_at is null order by created_at limit 50`);
      for (const e of evs.rows) await processEvent(db, e.id);
      const runs = await db.query<{ id: string }>(
        `select r.id from rigo.automation_runs r join rigo.companies c on c.id = r.company_id join rigo.workflows w on w.id = r.workflow_id
          where (r.status = 'running' or (r.status = 'waiting' and not c.paused and not w.paused and not exists (
                  select 1 from rigo.actions a where a.run_id = r.id and a.status in ('suggested','proposed','waiting_approval'))))
          order by r.updated_at limit 50`);
      for (const r of runs.rows) { await advanceRun(db, r.id); if (Date.now() - started > budgetMs) return; }
      const due = await db.query<{ id: string }>(
        `select a.id from rigo.actions a join rigo.companies c on c.id = a.company_id
          where a.status = 'queued' and not c.paused and (a.next_attempt_at is null or a.next_attempt_at <= now()) order by a.updated_at limit 50`);
      for (const a of due.rows) { await executeAction(db, a.id); if (Date.now() - started > budgetMs) return; }
    } while (again && Date.now() - started < budgetMs);
  } finally { running = false; }
}

export async function escalateApprovals() {
  const db = await getDb();
  const { rows } = await db.query<any>(`update rigo.approvals set escalated_at = now() where status = 'pending' and escalate_at is not null and escalate_at <= now() and escalated_at is null returning *`);
  for (const ap of rows) {
    // Escalation widens who is told; it never approves anything.
    const users = [...ap.backup_user_ids];
    const owners = await db.query<{ user_id: string }>(`select user_id from rigo.memberships where company_id = $1 and role_key = 'owner' and status = 'active' and not is_fictional`, [ap.company_id]);
    await notifyUsers(db, ap.company_id, [...users, ...owners.rows.map((r) => r.user_id)], { category: 'needs_action', title: `Still waiting for approval: ${ap.title}`, body: 'This approval passed its waiting time. It stays pending until someone decides; it is never approved automatically.', link: `inbox?approval=${ap.id}`, refType: 'approval', refId: ap.id, dedupeKey: `escalation:${ap.id}` });
  }
  return rows.length;
}

let timer: NodeJS.Timeout | null = null;
/** Ask the worker to look for work soon. In serverless mode the request handler drains synchronously instead. */
export function kick() {
  if (config.isServerless || process.env.RIGO_NO_WORKER === '1') return;
  if (timer) return;
  timer = setTimeout(() => { timer = null; processAll().catch((e) => console.error('[automation]', e)); }, 25);
}

export { TRIGGERS };
