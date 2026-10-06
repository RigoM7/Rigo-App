import { Hono } from 'hono';
import { z } from 'zod';
import type { Q } from '../db/index.js';
import { type AppEnv, type CompanyCtx, need, needAny, can, audit } from '../http/context.js';
import { body } from '../lib/util.js';
import { factsFor } from '../automation/engine.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import {
  definitionSchema, validateDefinition, explainDefinition, simulate, stableHash, ACTIONS, TRIGGERS, CONDITION_FIELDS, OPERATORS, MODES, MODE_HELP, type Definition,
  type ApproverCandidate,
} from '../../shared/workflows.js';
import { capabilities } from '../adapters/index.js';
import { insertWorkflow } from './structure.js';
import { readPricing } from '../../shared/services.js';
import { visibleApprovals, approvalSummary } from './approvals.js';
export { approvalSummary };
import { runActionNow, dismissAction, takeOver, decideApproval, isEligibleApprover, processAll, type Actor } from '../automation/engine.js';

export const workflowRoutes = new Hono<AppEnv>();

const actor = (cc: CompanyCtx): Actor => ({ db: cc.db, companyId: cc.company.id, userId: cc.user.id, perms: cc.perms, isOwner: cc.isOwner, isDemo: cc.isDemo });

async function env(q: Q, cc: CompanyCtx) {
  const roles = (await q.query<{ key: string; name: string }>(`select key, name from rigo.roles where company_id = $1`, [cc.company.id])).rows;
  // Members and their permissions, so the validator can tell whether anyone chosen can actually approve.
  const members = (await q.query<any>(`select m.user_id, coalesce(m.display_name, u.name) as name, m.role_key, r.is_owner, r.permissions from rigo.memberships m join rigo.users u on u.id = m.user_id
      join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key where m.company_id = $1 and m.status = 'active' and not m.is_fictional`, [cc.company.id])).rows
    .map((m): ApproverCandidate => ({ userId: m.user_id, name: m.name, roleKey: m.role_key, isOwner: m.is_owner, permissions: m.permissions }));
  return { roles: roles.map((r) => r.key), roleNames: Object.fromEntries(roles.map((r) => [r.key, r.name])), emailAvailable: capabilities(cc.company).email.state === 'available', isDemo: cc.isDemo, members };
}

function versionView(v: any, e: Awaited<ReturnType<typeof env>>) {
  const def = v.definition as Definition;
  const validation = validateDefinition(def, e);
  return {
    id: v.id, version: v.version, status: v.status, source: v.source, definition: def, explanation: explainDefinition(def, e.roleNames), validation,
    testResult: v.test_result, testedCurrent: v.tested_hash === v.definition_hash, createdAt: v.created_at, testedAt: v.tested_at, activatedAt: v.activated_at,
    createdByName: v.created_by_name, activatedByName: v.activated_by_name,
  };
}

workflowRoutes.get('/workflows/catalog', async (c) => {
  const cc = c.get('cc');
  needAny(cc, 'workflows.view', 'workflows.edit');
  return c.json({ triggers: TRIGGERS, actions: ACTIONS, conditionFields: CONDITION_FIELDS, operators: OPERATORS, modes: MODES, modeHelp: MODE_HELP });
});

workflowRoutes.get('/workflows', async (c) => {
  const cc = c.get('cc');
  need(cc, 'workflows.view');
  const { rows } = await cc.db.query<any>(
    `select w.*, av.version as active_version, av.definition as active_definition,
            lv.id as latest_id, lv.version as latest_version, lv.status as latest_status,
            (select count(*)::int from rigo.automation_runs r where r.workflow_id = w.id and r.status in ('running','waiting')) as open_runs
       from rigo.workflows w left join rigo.workflow_versions av on av.id = w.active_version_id
       left join lateral (select id, version, status from rigo.workflow_versions where workflow_id = w.id and status <> 'proposal' order by version desc limit 1) lv on true
      where w.company_id = $1 order by w.created_at`, [cc.company.id]);
  const e = await env(cc.db, cc);
  return c.json({ workflows: rows.map((w) => ({ ...w, active_explanation: w.active_definition ? explainDefinition(w.active_definition, e.roleNames) : null })), mode: cc.company.automation_mode, paused: cc.company.paused });
});

workflowRoutes.get('/workflows/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'workflows.view');
  const { rows } = await cc.db.query<any>(`select * from rigo.workflows where id = $1 and company_id = $2`, [c.req.param('id'), cc.company.id]);
  if (!rows[0]) throw notFound('Workflow');
  const versions = await cc.db.query<any>(`select v.*, u.name as created_by_name, a.name as activated_by_name from rigo.workflow_versions v left join rigo.users u on u.id = v.created_by left join rigo.users a on a.id = v.activated_by where v.workflow_id = $1 order by v.version desc`, [rows[0].id]);
  const e = await env(cc.db, cc);
  const runs = await cc.db.query(`select r.id, r.status, r.summary, r.created_at, r.updated_at, r.subject_type, r.subject_id, v.version from rigo.automation_runs r join rigo.workflow_versions v on v.id = r.workflow_version_id where r.workflow_id = $1 order by r.created_at desc limit 30`, [rows[0].id]);
  return c.json({ workflow: rows[0], versions: versions.rows.map((v) => versionView(v, e)), runs: runs.rows, roleNames: e.roleNames, capabilities: capabilities(cc.company) });
});

workflowRoutes.post('/workflows', async (c) => {
  const cc = c.get('cc');
  need(cc, 'workflows.edit');
  const input = await body(c, z.object({ name: z.string().trim().min(1, 'Name the workflow').max(80), description: z.string().max(300).default(''), definition: definitionSchema.optional(), source: z.enum(['form', 'visual', 'assistant']).default('form') }));
  const def: Definition = input.definition ?? { trigger: { event: 'job.completed' }, conditions: [], steps: [{ id: 'notify', action: 'notify', params: { roles: ['owner'], text: 'A job was completed.' }, mode: null, approval: { required: 'never', conditions: [], approverRoles: [], approverUserIds: [], backupUserIds: [], escalateAfterHours: null }, onException: { notifyRoles: ['owner'], stop: true } }] };
  const r = await insertWorkflow(cc.db, cc.company.id, cc.user.id, { name: input.name, description: input.description, definition: def }, input.source);
  await audit(cc.db, cc, 'workflow.created', { id: r.workflowId });
  return c.json({ id: r.workflowId, versionId: r.versionId });
});

workflowRoutes.patch('/workflows/:id', async (c) => {
  const cc = c.get('cc');
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(80).optional(), description: z.string().max(300).optional(), paused: z.boolean().optional(), modeOverride: z.enum(['manual', 'assisted', 'automatic']).nullable().optional() }));
  if (input.name !== undefined || input.description !== undefined) need(cc, 'workflows.edit');
  if (input.paused !== undefined) need(cc, 'automation.control');
  if (input.modeOverride !== undefined) need(cc, 'workflows.activate');
  const { rows } = await cc.db.query(`update rigo.workflows set name = coalesce($3, name), description = coalesce($4, description), paused = coalesce($5, paused), mode_override = case when $6 then $7 else mode_override end where id = $1 and company_id = $2 returning id`,
    [c.req.param('id'), cc.company.id, input.name ?? null, input.description ?? null, input.paused ?? null, input.modeOverride !== undefined, input.modeOverride ?? null]);
  if (!rows.length) throw notFound('Workflow');
  await audit(cc.db, cc, 'workflow.updated', { id: c.req.param('id'), ...input });
  if (input.paused === false) await processAll(2000);
  return c.json({ ok: true });
});

/** Save edits. Editing a tested or active version always creates a new draft that must be tested again. */
workflowRoutes.put('/workflows/:id/draft', async (c) => {
  const cc = c.get('cc');
  need(cc, 'workflows.edit');
  const input = await body(c, z.object({ definition: definitionSchema, baseVersionId: z.string().uuid(), source: z.enum(['form', 'visual', 'assistant']).default('form') }));
  const out = await cc.db.tx(async (q) => {
    const wf = (await q.query<any>(`select * from rigo.workflows where id = $1 and company_id = $2 for update`, [c.req.param('id'), cc.company.id])).rows[0];
    if (!wf) throw notFound('Workflow');
    const latest = (await q.query<any>(`select * from rigo.workflow_versions where workflow_id = $1 and status <> 'proposal' order by version desc limit 1`, [wf.id])).rows[0];
    if (latest.id !== input.baseVersionId) throw conflict('Someone saved a newer version of this workflow. Reload to continue from it.');
    const hash = stableHash(input.definition);
    if (latest.status === 'draft') {
      await q.query(`update rigo.workflow_versions set definition = $2, definition_hash = $3, source = $4, test_result = null, tested_hash = null, tested_at = null where id = $1`, [latest.id, JSON.stringify(input.definition), hash, input.source]);
      return { versionId: latest.id, version: latest.version, newVersion: false };
    }
    if (hash === latest.definition_hash) return { versionId: latest.id, version: latest.version, newVersion: false };
    if (latest.status === 'tested') await q.query(`update rigo.workflow_versions set status = 'retired' where id = $1`, [latest.id]);
    const v = await q.query<{ id: string }>(`insert into rigo.workflow_versions (workflow_id, company_id, version, status, source, definition, definition_hash, created_by) values ($1,$2,$3,'draft',$4,$5,$6,$7) returning id`,
      [wf.id, cc.company.id, latest.version + 1, input.source, JSON.stringify(input.definition), hash, cc.user.id]);
    return { versionId: v.rows[0].id, version: latest.version + 1, newVersion: true };
  });
  return c.json(out);
});

/**
 * Sample data for the dry run (R14-m3): the company's most recent real job or invoice for this
 * trigger when there is one, otherwise neutral sample values. Conditions are not bent to match, so a
 * test can honestly say a workflow "would not start".
 */
async function sampleFacts(q: Q, cc: CompanyCtx, def: Definition) {
  const subject = TRIGGERS[def.trigger.event].subject;
  const recent = subject === 'invoice'
    ? (await q.query<any>(`select id, job_id from rigo.invoices where company_id = $1 and status <> 'void' order by created_at desc limit 1`, [cc.company.id])).rows[0]
    : (await q.query<any>(`select id from rigo.jobs where company_id = $1 and status <> 'draft' order by coalesce(completed_at, created_at) desc limit 1`, [cc.company.id])).rows[0];
  const real = recent ? await factsFor(q, subject === 'invoice' ? 'invoice' : 'job', recent.id, recent.job_id ? { jobId: recent.job_id } : {}) : {};
  const svcName = real['job.service_name'] as string | undefined;
  const { rows } = await q.query<any>(`select * from rigo.services where company_id = $1 and active ${svcName ? 'and name = $2' : ''} order by created_at limit 1`, svcName ? [cc.company.id, svcName] : [cc.company.id]);
  const svc = rows[0];
  const hasRates = !!svc && (svc.pricing as any[]).length > 0 && readPricing(svc.pricing).every((p) => p.rateE4 !== null);
  const facts: Record<string, unknown> = {
    'job.service_category': svc?.category ?? 'other', 'job.service_name': svc?.name ?? 'Sample service', 'job.problem_open': false, 'job.has_assignee': true, 'job.priority': 'normal',
    'job.partial': false, 'job.quantity_over_capacity': false, 'customer.name': 'Sample Customer (test data)', 'customer.tax_exempt': false, 'customer.type': '',
    'invoice.total_minor': 25000, 'invoice.held': !hasRates, 'invoice.price_changed': false,
    ...real,
  };
  return { facts, hasRates, serviceName: svc?.name ?? null, source: recent ? `your most recent ${subject === 'invoice' ? 'invoice' : 'job'}` : 'sample values' };
}

workflowRoutes.post('/workflows/:id/versions/:vid/test', async (c) => {
  const cc = c.get('cc');
  need(cc, 'workflows.edit');
  const input = await body(c, z.object({ facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional() }));
  const out = await cc.db.tx(async (q) => {
    const v = (await q.query<any>(`select v.*, w.mode_override from rigo.workflow_versions v join rigo.workflows w on w.id = v.workflow_id where v.id = $1 and v.workflow_id = $2 and v.company_id = $3 for update of v`, [c.req.param('vid'), c.req.param('id'), cc.company.id])).rows[0];
    if (!v) throw notFound('Workflow version');
    const e = await env(q, cc);
    const def = definitionSchema.parse(v.definition);
    const validation = validateDefinition(def, e);
    if (!validation.ok) {
      await q.query(`update rigo.workflow_versions set validation = $2 where id = $1`, [v.id, JSON.stringify(validation)]);
      return { ok: false, validation };
    }
    const sample = await sampleFacts(q, cc, def);
    const facts = { ...sample.facts, ...(input.facts ?? {}) };
    const modes = (['manual', 'assisted', 'automatic'] as const).map((m) => ({ mode: m, ...simulate(def, { mode: m, overrideMode: v.mode_override, facts, emailAvailable: e.emailAvailable, isDemo: cc.isDemo, sampleHasRates: sample.hasRates }) }));
    const result = { ranAt: new Date().toISOString(), sample: { ...facts, serviceName: sample.serviceName }, sampleSource: sample.source, currentMode: v.mode_override ?? cc.company.automation_mode, modes, note: `A dry run using ${sample.source}. Nothing was created, sent or changed.` };
    const newStatus = v.status === 'draft' ? 'tested' : v.status;
    await q.query(`update rigo.workflow_versions set test_result = $2, validation = $3, tested_hash = definition_hash, tested_at = now(), status = $4 where id = $1`, [v.id, JSON.stringify(result), JSON.stringify(validation), newStatus]);
    return { ok: true, validation, result };
  });
  return c.json(out);
});

workflowRoutes.post('/workflows/:id/versions/:vid/activate', async (c) => {
  const cc = c.get('cc');
  need(cc, 'workflows.activate');
  const out = await cc.db.tx(async (q) => {
    const wf = (await q.query<any>(`select * from rigo.workflows where id = $1 and company_id = $2 for update`, [c.req.param('id'), cc.company.id])).rows[0];
    if (!wf) throw notFound('Workflow');
    const v = (await q.query<any>(`select * from rigo.workflow_versions where id = $1 and workflow_id = $2`, [c.req.param('vid'), wf.id])).rows[0];
    if (!v) throw notFound('Workflow version');
    if (v.status === 'active') return { already: true, waitingRunsAffected: 0 };
    if (v.status !== 'tested' || v.tested_hash !== v.definition_hash) throw conflict('Test this version with sample data before activating it.');
    const validation = validateDefinition(definitionSchema.parse(v.definition), await env(q, cc));
    if (!validation.ok) throw badRequest('This version has validation errors.', { validation });
    const waiting = await q.query<{ n: number }>(`select count(*)::int n from rigo.automation_runs where workflow_id = $1 and status in ('running','waiting')`, [wf.id]);
    await q.query(`update rigo.workflow_versions set status = 'retired' where workflow_id = $1 and status = 'active'`, [wf.id]);
    // The activating owner/manager is who Rigo acts on behalf of; permissions are rechecked on every execution.
    await q.query(`update rigo.workflow_versions set status = 'active', activated_by = $2, activated_at = now() where id = $1`, [v.id, cc.user.id]);
    await q.query(`update rigo.workflows set active_version_id = $2 where id = $1`, [wf.id, v.id]);
    await audit(q, cc, 'workflow.activated', { workflowId: wf.id, version: v.version });
    return { already: false, waitingRunsAffected: waiting.rows[0].n };
  });
  return c.json(out);
});

workflowRoutes.post('/workflows/:id/deactivate', async (c) => {
  const cc = c.get('cc');
  need(cc, 'workflows.activate');
  await cc.db.tx(async (q) => {
    const wf = (await q.query<any>(`select * from rigo.workflows where id = $1 and company_id = $2 for update`, [c.req.param('id'), cc.company.id])).rows[0];
    if (!wf) throw notFound('Workflow');
    await q.query(`update rigo.workflow_versions set status = 'tested' where id = $1`, [wf.active_version_id]);
    await q.query(`update rigo.workflows set active_version_id = null where id = $1`, [wf.id]);
    await audit(q, cc, 'workflow.deactivated', { workflowId: wf.id });
  });
  return c.json({ ok: true });
});

/** Accept an assistant/template proposal: it becomes a new draft. Nothing activates. */
workflowRoutes.post('/workflows/proposals/:vid/accept', async (c) => {
  const cc = c.get('cc');
  need(cc, 'workflows.edit');
  const { rows } = await cc.db.query(`update rigo.workflow_versions set status = 'draft' where id = $1 and company_id = $2 and status = 'proposal' returning workflow_id`, [c.req.param('vid'), cc.company.id]);
  if (!rows.length) throw notFound('Proposal');
  return c.json({ workflowId: (rows[0] as any).workflow_id });
});

// ---------------------------------------------------------------- automation activity
workflowRoutes.get('/automation', async (c) => {
  const cc = c.get('cc');
  needAny(cc, 'workflows.view', 'automation.control', 'approvals.decide', 'invoices.approve');
  const sel = `select a.id, a.type, a.status, a.mode, a.explanation, a.subject_type, a.subject_id, a.attempts, a.max_attempts, a.next_attempt_at, a.executed_by, a.created_at, a.updated_at,
      a.run_id, w.name as workflow_name, w.paused as workflow_paused from rigo.actions a left join rigo.automation_runs r on r.id = a.run_id left join rigo.workflows w on w.id = r.workflow_id where a.company_id = $1`;
  const waiting = await cc.db.query(`${sel} and a.status in ('suggested','proposed','waiting_approval','queued','running') order by a.created_at`, [cc.company.id]);
  const history = await cc.db.query(`${sel} and a.status not in ('suggested','proposed','waiting_approval','queued','running') order by a.updated_at desc limit 100`, [cc.company.id]);
  const runs = await cc.db.query(`select r.id, r.status, r.summary, r.current_step, r.created_at, r.updated_at, r.subject_type, r.subject_id, w.name as workflow_name from rigo.automation_runs r join rigo.workflows w on w.id = r.workflow_id where r.company_id = $1 and r.status in ('running','waiting') order by r.created_at desc limit 100`, [cc.company.id]);
  const withLabels = async (rows: any[]) => {
    const { subjectLabel } = await import('../automation/engine.js');
    return Promise.all(rows.map(async (r) => ({ ...r, label: ACTIONS[r.type]?.label ?? r.type, subject_label: await subjectLabel(cc.db, { type: r.subject_type, id: r.subject_id }) })));
  };
  const wfCount = (await cc.db.query<any>(`select count(*)::int total, count(active_version_id)::int active from rigo.workflows where company_id = $1`, [cc.company.id])).rows[0];
  return c.json({ mode: cc.company.automation_mode, paused: cc.company.paused, pausedAt: cc.company.paused_at, workflows: wfCount, waiting: await withLabels(waiting.rows), history: await withLabels(history.rows), runs: await withLabels(runs.rows), capabilities: capabilities(cc.company) });
});

workflowRoutes.post('/automation/actions/:id/run', async (c) => {
  const cc = c.get('cc');
  const r = await runActionNow(actor(cc), c.req.param('id'));
  return c.json({ outcome: r });
});

workflowRoutes.post('/automation/actions/:id/dismiss', async (c) => {
  const cc = c.get('cc');
  await dismissAction(actor(cc), c.req.param('id'));
  return c.json({ ok: true });
});

workflowRoutes.post('/automation/runs/:id/takeover', async (c) => {
  const cc = c.get('cc');
  need(cc, 'automation.control');
  await takeOver(actor(cc), c.req.param('id'));
  return c.json({ ok: true });
});

workflowRoutes.get('/approvals', async (c) => {
  const cc = c.get('cc');
  const status = c.req.query('status') === 'decided' ? 'decided' : 'pending';
  const out = [];
  for (const ap of await visibleApprovals(cc, status)) {
    // The approver sees what they are approving; amounts only with finance.view (removed here, not in the UI).
    out.push({ ...ap, actionType: ap.action_type, actionLabel: ACTIONS[ap.action_type]?.label, summary: await approvalSummary(cc.db, ap, cc.perms) });
  }
  return c.json({ approvals: out });
});

workflowRoutes.post('/approvals/:id/decide', async (c) => {
  const cc = c.get('cc');
  const input = await body(c, z.object({ decision: z.enum(['approve', 'reject']), note: z.string().max(500).default('') }));
  if (input.decision === 'reject' && !input.note.trim()) throw badRequest('Say why you are rejecting so the team knows what to change.', { fields: { note: 'Enter a reason' } });
  const r = await decideApproval(actor(cc), c.req.param('id'), input.decision, input.note);
  return c.json(r);
});
