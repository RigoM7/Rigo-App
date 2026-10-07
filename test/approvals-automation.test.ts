import { describe, it, expect } from 'vitest';
import { validateDefinition, contradictions, describeCondition, defaultWorkflows, simulate, type Definition, type ApproverCandidate } from '../src/shared/workflows.js';
import { ROLE_PRESETS } from '../src/shared/permissions.js';
import { triCounty, type TriCounty } from './fixtures/tricounty.js';
import { rid, processAll, signup, newCompany } from './helpers.js';

const preset = (key: string) => ROLE_PRESETS.find((r) => r.key === key)!.permissions as string[];
const members: ApproverCandidate[] = [
  { userId: '00000000-0000-4000-8000-000000000001', name: 'Dana', roleKey: 'owner', isOwner: true, permissions: preset('owner') },
  { userId: '00000000-0000-4000-8000-000000000002', name: 'Marcus', roleKey: 'dispatcher', isOwner: false, permissions: preset('dispatcher') },
  { userId: '00000000-0000-4000-8000-000000000003', name: 'Priya', roleKey: 'office', isOwner: false, permissions: preset('office') },
];
const env = { roles: ['owner', 'dispatcher', 'office', 'driver'], emailAvailable: false, isDemo: false, members, roleNames: { owner: 'Owner', dispatcher: 'Dispatcher', office: 'Office / billing' } };
const issueWith = (approverRoles: string[], extra: Partial<Definition['steps'][number]['approval']> = {}): Definition => ({
  trigger: { event: 'job.completed' }, conditions: [],
  steps: [
    { id: 'prepare', action: 'invoice.prepare', params: {}, mode: null, approval: { required: 'never', conditions: [], approverRoles: [], approverUserIds: [], backupUserIds: [], escalateAfterHours: null }, onException: { notifyRoles: ['owner'], stop: true } },
    { id: 'issue', action: 'invoice.issue', params: {}, mode: null, approval: { required: 'always', conditions: [], approverRoles, approverUserIds: [], backupUserIds: [], escalateAfterHours: null, ...extra }, onException: { notifyRoles: ['owner'], stop: true } },
  ],
});

describe('workflow validation (shared)', () => {
  it('refuses approvers who cannot approve, and warns about backups who cannot (R14-C1)', () => {
    const bad = validateDefinition(issueWith(['dispatcher']), env);
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(' ')).toMatch(/nobody chosen to approve it can approve invoices/);
    expect(validateDefinition(issueWith(['office']), env).ok).toBe(true);
    const mixed = validateDefinition(issueWith(['owner', 'dispatcher'], { backupUserIds: [members[1].userId] }), env);
    expect(mixed.ok).toBe(true);
    expect(mixed.warnings.join(' ')).toMatch(/Dispatcher can't approve invoices/);
    expect(mixed.warnings.join(' ')).toMatch(/backup Marcus can't approve/);
    // The standard workflows pass: Owner and Office approve invoices (D7).
    for (const w of defaultWorkflows()) expect(validateDefinition(w.definition, env).errors).toEqual([]);
  });

  it('finds conditions that can never all be true, and shows amounts in dollars (R14-m1, R14-m3)', () => {
    expect(contradictions([{ field: 'job.priority', op: 'eq', value: 'urgent' }, { field: 'job.priority', op: 'eq', value: 'normal' }])[0]).toMatch(/can't be urgent and normal/);
    expect(contradictions([{ field: 'invoice.total_minor', op: 'gt', value: 50000 }, { field: 'invoice.total_minor', op: 'lt', value: 10000 }])).toHaveLength(1);
    expect(contradictions([{ field: 'invoice.total_minor', op: 'gte', value: 10000 }, { field: 'invoice.total_minor', op: 'lte', value: 50000 }])).toHaveLength(0);
    const d = issueWith(['owner']);
    d.conditions = [{ field: 'job.priority', op: 'eq', value: 'urgent' }, { field: 'job.priority', op: 'neq', value: 'urgent' }];
    expect(validateDefinition(d, env).errors.join(' ')).toMatch(/Conditions never all match/);
    expect(describeCondition({ field: 'invoice.total_minor', op: 'gt', value: 50000 })).toBe('invoice total is more than $500.00');
    // A dry run can honestly say it would not start.
    const r = simulate({ ...issueWith(['owner']), conditions: [{ field: 'job.priority', op: 'eq', value: 'emergency' }] }, { mode: 'automatic', overrideMode: null, facts: { 'job.priority': 'normal' }, emailAvailable: false, isDemo: false, sampleHasRates: true });
    expect(r.summary).toBe('Would not start: in this sample, job priority is emergency is not true.');
  });
});

async function completedFuelJob(t: TriCounty, customer = 'grace') {
  const c = t.customers[customer];
  const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel', requested_qty: '100' }, intent: 'open', clientRequestId: rid(), scheduledStart: new Date(Date.now() + 3600_000).toISOString() });
  const job = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
  const a = await t.dana.post(`/c/${t.cid}/jobs/${job.id}/assign`, { userId: t.ids.luis, resourceIds: [t.trucks['Tank wagon 1']], version: job.version });
  expect((await t.luis.post(`/c/${t.cid}/jobs/${job.id}/complete`, { submissionId: rid(), baseVersion: a.body.version, outcome: 'completed', values: { delivered_qty: '100' } })).status).toBe(200);
  await processAll();
  return job.id as string;
}

describe('approvals and automation with the fixture company', () => {
  it('new companies start with the standard workflows on, so completed work is billed (R3-M3)', async () => {
    const t = await triCounty();
    const wfs = (await t.dana.get(`/c/${t.cid}/workflows`)).body.workflows;
    expect(wfs.length).toBe(4);
    expect(wfs.every((w: any) => w.active_version_id)).toBe(true);
    expect((await t.dana.get(`/c/${t.cid}/automation`)).body.workflows).toEqual({ total: 4, active: 4 });
    const jobId = await completedFuelJob(t);
    const inv = (await t.dana.get(`/c/${t.cid}/jobs/${jobId}`)).body.invoice;
    expect(inv).toMatchObject({ status: 'draft' });
    // The issue step waits for Owner or Office.
    const ap = (await t.priya.get(`/c/${t.cid}/approvals`)).body.approvals;
    expect(ap).toHaveLength(1);
    expect(ap[0].summary.totalMinor).toBe(44498);
  });

  it('Office approves invoices by default (D7, R4-M3), and the run continues to the email', async () => {
    const t = await triCounty();
    await completedFuelJob(t);
    const ap = (await t.priya.get(`/c/${t.cid}/approvals`)).body.approvals[0];
    expect((await t.marcus.post(`/c/${t.cid}/approvals/${ap.id}/decide`, { decision: 'approve' })).status).toBe(403);
    expect((await t.priya.post(`/c/${t.cid}/approvals/${ap.id}/decide`, { decision: 'approve' })).body.status).toBe('approved');
    await processAll();
    const inv = (await t.dana.get(`/c/${t.cid}/invoices/${ap.subject_id}`)).body;
    expect(inv.invoice.status).toBe('issued');
    expect(inv.messages[0].status).toBe('prepared');
  });

  it('an owner can always decide, recorded as an owner override (R14-C1)', async () => {
    const t = await triCounty();
    // A workflow that asks only Office to approve a job follow-up.
    const def = { trigger: { event: 'job.unsuccessful' }, conditions: [], steps: [{ id: 'f', action: 'job.create_followup', params: {}, mode: null, approval: { required: 'always', conditions: [], approverRoles: ['office'], approverUserIds: [], backupUserIds: [], escalateAfterHours: null }, onException: { notifyRoles: ['owner'], stop: true } }] };
    const wf = await t.dana.post(`/c/${t.cid}/workflows`, { name: 'Office decides follow-ups', definition: def });
    expect((await t.dana.post(`/c/${t.cid}/workflows/${wf.body.id}/versions/${wf.body.versionId}/test`, {})).body.ok).toBe(true);
    expect((await t.dana.post(`/c/${t.cid}/workflows/${wf.body.id}/versions/${wf.body.versionId}/activate`)).status).toBe(200);
    const c = t.customers.jose;
    const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Heating oil' }, intent: 'open', clientRequestId: rid(), scheduledStart: new Date(Date.now() + 3600_000).toISOString() });
    const job = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
    const a = await t.dana.post(`/c/${t.cid}/jobs/${job.id}/assign`, { userId: t.ids.sam, resourceIds: [], version: job.version });
    await t.sam.post(`/c/${t.cid}/jobs/${job.id}/complete`, { submissionId: rid(), baseVersion: a.body.version, outcome: 'unsuccessful', reason: 'Gate locked' });
    await processAll();
    const ap = (await t.dana.get(`/c/${t.cid}/approvals`)).body.approvals.find((x: any) => x.subject_id === job.id);
    expect(ap).toBeTruthy();
    expect((await t.dana.post(`/c/${t.cid}/approvals/${ap.id}/decide`, { decision: 'approve', note: 'Priya is out' })).body.status).toBe('approved');
    const decided = (await t.dana.get(`/c/${t.cid}/approvals?status=decided`)).body.approvals.find((x: any) => x.id === ap.id);
    expect(decided.decision_note).toBe('Owner override: Priya is out');
  });

  it('with the company rule on, Automatic mode asks for approval instead of blocking; off, it issues (R14-M1)', async () => {
    const t = await triCounty();
    expect((await t.dana.patch(`/c/${t.cid}/automation`, { mode: 'automatic' })).status).toBe(200);
    // A workflow whose issue step has no approval of its own.
    const wfs = (await t.dana.get(`/c/${t.cid}/workflows`)).body.workflows;
    const billing = wfs.find((w: any) => w.name === 'Completed job to invoice');
    const cur = (await t.dana.get(`/c/${t.cid}/workflows/${billing.id}`)).body.versions.find((v: any) => v.status === 'active');
    const def = structuredClone(cur.definition);
    def.steps[1].approval = { required: 'never', conditions: [], approverRoles: [], approverUserIds: [], backupUserIds: [], escalateAfterHours: null };
    const saved = await t.dana.put(`/c/${t.cid}/workflows/${billing.id}/draft`, { definition: def, baseVersionId: cur.id, source: 'form' });
    await t.dana.post(`/c/${t.cid}/workflows/${billing.id}/versions/${saved.body.versionId}/test`, {});
    expect((await t.dana.post(`/c/${t.cid}/workflows/${billing.id}/versions/${saved.body.versionId}/activate`)).status).toBe(200);
    const j1 = await completedFuelJob(t);
    const inv1 = (await t.dana.get(`/c/${t.cid}/jobs/${j1}`)).body.invoice;
    expect(inv1.status).toBe('draft');
    const ap = (await t.priya.get(`/c/${t.cid}/approvals`)).body.approvals.find((a: any) => a.subject_id === inv1.id);
    expect(ap).toBeTruthy();
    expect((await t.dana.get(`/c/${t.cid}/automation`)).body.history.some((a: any) => a.type === 'invoice.issue' && a.status === 'blocked')).toBe(false);
    // Only an owner changes the rule; turned off, Automatic issues on its own.
    expect((await t.priya.patch(`/c/${t.cid}/settings`, { invoiceApprovalRequired: false })).status).toBe(403);
    expect((await t.dana.patch(`/c/${t.cid}/settings`, { invoiceApprovalRequired: false })).status).toBe(200);
    const j2 = await completedFuelJob(t, 'ridgeline');
    expect((await t.dana.get(`/c/${t.cid}/jobs/${j2}`)).body.invoice.status).toBe('issued');
  });

  it('issuing directly settles the waiting workflow step and the run carries on (linked approvals)', async () => {
    const t = await triCounty();
    expect((await t.dana.patch(`/c/${t.cid}/settings`, { invoiceApprovalRequired: false })).status).toBe(200);
    const jobId = await completedFuelJob(t);
    const inv = (await t.dana.get(`/c/${t.cid}/jobs/${jobId}`)).body.invoice;
    const d = (await t.dana.get(`/c/${t.cid}/invoices/${inv.id}`)).body;
    expect(d.approvals.some((a: any) => a.status === 'pending')).toBe(true);
    expect((await t.priya.post(`/c/${t.cid}/invoices/${inv.id}/issue`, { version: d.invoice.version })).status).toBe(200);
    const after = (await t.dana.get(`/c/${t.cid}/invoices/${inv.id}`)).body;
    expect(after.approvals.every((a: any) => a.status !== 'pending')).toBe(true);
    expect(after.messages[0]?.status).toBe('prepared');
    expect((await t.dana.get(`/c/${t.cid}/approvals`)).body.approvals.filter((a: any) => a.subject_id === inv.id)).toHaveLength(0);
  });

  it('Home counts completed jobs that are not billed, whatever the workflows do (R3-M3)', async () => {
    const t = await triCounty();
    const wf = (await t.dana.get(`/c/${t.cid}/workflows`)).body.workflows.find((w: any) => w.name === 'Completed job to invoice');
    await t.dana.post(`/c/${t.cid}/workflows/${wf.id}/deactivate`);
    await completedFuelJob(t);
    const home = (await t.dana.get(`/c/${t.cid}/overview`)).body;
    expect(home.attention.find((a: any) => a.key === 'unbilled')).toMatchObject({ count: 1, link: 'jobs?status=unbilled' });
    expect((await t.dana.get(`/c/${t.cid}/jobs?status=unbilled`)).body.jobs).toHaveLength(1);
  });

  it('delegation lists only people who can approve, and the delegate is told (R4-M3)', async () => {
    const t = await triCounty();
    const cands = (await t.dana.get(`/c/${t.cid}/delegations/candidates`)).body.candidates.map((m: any) => m.name);
    expect(cands).toEqual(['Priya']);
    expect((await t.dana.post(`/c/${t.cid}/delegations`, { toUserId: t.ids.marcus, endsAt: null })).status).toBe(400);
    const week = new Date(Date.now() + 7 * 86400_000).toISOString();
    expect((await t.dana.post(`/c/${t.cid}/delegations`, { toUserId: t.ids.priya, endsAt: week })).status).toBe(200);
    const notes = (await t.priya.get(`/c/${t.cid}/notifications`)).body.notifications;
    expect(notes[0].title).toMatch(/^Dana asked you to approve for them until /);
  });

  it('owners are warned at once when nobody left can approve a pending request', async () => {
    const t = await triCounty();
    const def = issueWith(['office']);
    const wf = await t.dana.post(`/c/${t.cid}/workflows`, { name: 'Office approves', definition: def });
    await t.dana.post(`/c/${t.cid}/workflows/${wf.body.id}/versions/${wf.body.versionId}/test`, {});
    await t.dana.post(`/c/${t.cid}/workflows/${wf.body.id}/versions/${wf.body.versionId}/activate`);
    await completedFuelJob(t);
    const office = (await t.dana.get(`/c/${t.cid}/roles`)).body.roles.find((r: any) => r.key === 'office');
    expect((await t.dana.patch(`/c/${t.cid}/roles/office`, { permissions: office.permissions.filter((p: string) => p !== 'invoices.approve' && p !== 'approvals.decide') })).status).toBe(200);
    const notes = (await t.dana.get(`/c/${t.cid}/notifications`)).body.notifications;
    expect(notes.some((n: any) => /^Nobody can approve: /.test(n.title))).toBe(true);
  });

  it('notifications name the job and when it is (R14-m5)', async () => {
    const t = await triCounty();
    const c = t.customers.grace;
    const start = new Date(Date.now() + 86400_000);
    const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, intent: 'open', clientRequestId: rid(), scheduledStart: start.toISOString() });
    const job = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
    await t.dana.post(`/c/${t.cid}/jobs/${job.id}/assign`, { userId: t.ids.luis, resourceIds: [], version: job.version });
    await processAll();
    const n = (await t.luis.get(`/c/${t.cid}/notifications`)).body.notifications.find((x: any) => x.title.startsWith('You have a new assignment'));
    expect(n.title).toMatch(new RegExp(`^You have a new assignment: Job #${job.number}.*Grace Okafor.*, \\w{3}, \\w{3} \\d+, \\d+:\\d{2} (AM|PM)$`));
  });
});

describe('a company created from scratch', () => {
  it('owners of a new company see their Office role able to approve', async () => {
    const o = await signup('Olive');
    const cid = await newCompany(o);
    const roles = (await o.get(`/c/${cid}/roles`)).body.roles;
    expect(roles.find((r: any) => r.key === 'office').permissions).toEqual(expect.arrayContaining(['invoices.approve', 'approvals.decide']));
  });
});
