import { describe, it, expect, afterEach, vi } from 'vitest';
import { triCounty, type TriCounty } from './fixtures/tricounty.js';
import { rid, processAll, getDb, signup, newCompany } from './helpers.js';
import { config } from '../src/server/config.js';
import { proposeFromText } from '../src/shared/proposal.js';
import { blankCopy } from '../src/server/modules/structure.js';

// Fixes from the Phase 3 review and security review, each with the case that found it.

const saved = { sms: { ...config.sms }, sending: [...config.sendingCompanies] };
afterEach(() => { Object.assign(config.sms, saved.sms); config.sendingCompanies = [...saved.sending]; vi.restoreAllMocks(); });

async function assigned(t: TriCounty, who: 'luis' | 'sam' = 'luis') {
  const c = t.customers.grace;
  const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, clientRequestId: rid(), scheduledStart: new Date(Date.now() + 3600_000).toISOString() });
  const job = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
  const a = await t.dana.post(`/c/${t.cid}/jobs/${job.id}/assign`, { userId: t.ids[who], version: job.version });
  return { id: job.id as string, number: job.number as number, version: a.body.version as number };
}

describe('imports', () => {
  it('a row with an error is never what a later row attaches to', async () => {
    const t = await triCounty();
    const up = (await t.dana.post(`/c/${t.cid}/imports`, { kind: 'customers', fileName: 'x.csv', text: 'Name,Email,Phone,Address\nAcme Co,bad-email,555-777-0001,1 A St\nAcme Co,acme@x.test,555-777-0001,2 B St\n' })).body;
    const rv = (await t.dana.post(`/c/${t.cid}/imports/${up.id}/review`, { mapping: up.mapping })).body;
    expect(rv.rows[0].action).toBe('skip');
    expect(rv.rows[1].action).toBe('create');
    expect((await t.dana.post(`/c/${t.cid}/imports/${up.id}/commit`, { confirm: true })).body.result).toMatchObject({ customers: 1, locations: 1 });
  });

  it('customer files are for people who see contact details', async () => {
    const t = await triCounty();
    const roles = (await t.dana.get(`/c/${t.cid}/roles`)).body.roles;
    const disp = roles.find((r: any) => r.key === 'dispatcher');
    await t.dana.patch(`/c/${t.cid}/roles/dispatcher`, { permissions: [...disp.permissions.filter((p: string) => p !== 'customers.contact'), 'imports.run'] });
    expect((await t.marcus.post(`/c/${t.cid}/imports`, { kind: 'customers', fileName: 'x.csv', text: 'Name\nA\n' })).status).toBe(403);
    expect((await t.marcus.post(`/c/${t.cid}/imports`, { kind: 'resources', fileName: 'x.csv', text: 'Name,Type\nT1,truck\n' })).status).toBe(200);
  });
});

describe('On my way and customer updates', () => {
  it('a new driver or a new time clears "on my way", so the next trip is told again', async () => {
    const t = await triCounty();
    const j = await assigned(t);
    await t.luis.post(`/c/${t.cid}/jobs/${j.id}/en-route`, { etaMinutes: 15 });
    let job = (await t.dana.get(`/c/${t.cid}/jobs/${j.id}`)).body.job;
    expect(job.en_route_at).toBeTruthy();
    await t.dana.post(`/c/${t.cid}/jobs/${j.id}/assign`, { userId: t.ids.sam, version: job.version });
    job = (await t.dana.get(`/c/${t.cid}/jobs/${j.id}`)).body.job;
    expect(job).toMatchObject({ en_route_at: null, en_route_eta_minutes: null });
  });

  it('nothing is prepared for a job that is not on the way, started or finished; texts only when texting works', async () => {
    const t = await triCounty();
    const def = { trigger: { event: 'job.assigned' }, conditions: [], steps: [{ id: 'u', action: 'message.prepare_job_update', params: {}, mode: 'automatic', approval: { required: 'never', conditions: [], approverRoles: [], approverUserIds: [], backupUserIds: [], escalateAfterHours: null }, onException: { notifyRoles: ['owner'], stop: true } }] };
    const wf = (await t.dana.post(`/c/${t.cid}/workflows`, { name: 'Tell on assign', definition: def })).body;
    await t.dana.post(`/c/${t.cid}/workflows/${wf.id}/versions/${wf.versionId}/test`, {});
    await t.dana.post(`/c/${t.cid}/workflows/${wf.id}/versions/${wf.versionId}/activate`);
    const j = await assigned(t);
    await processAll();
    expect((await (await getDb()).query(`select 1 from rigo.messages where job_id = $1`, [j.id])).rows).toHaveLength(0);
    // With texting set up, the on-the-way update is a text.
    config.sendingCompanies = ['*'];
    Object.assign(config.sms, { provider: 'twilio', accountSid: 'AC1', authToken: 't', from: '+15550001111' });
    const def2 = { ...def, trigger: { event: 'job.en_route' } };
    const wf2 = (await t.dana.post(`/c/${t.cid}/workflows`, { name: 'Tell on the way', definition: def2 })).body;
    await t.dana.post(`/c/${t.cid}/workflows/${wf2.id}/versions/${wf2.versionId}/test`, {});
    await t.dana.post(`/c/${t.cid}/workflows/${wf2.id}/versions/${wf2.versionId}/activate`);
    await t.luis.post(`/c/${t.cid}/jobs/${j.id}/en-route`, {});
    await processAll();
    const ms = (await (await getDb()).query<any>(`select channel, recipient, status from rigo.messages where job_id = $1`, [j.id])).rows;
    expect(ms).toEqual([{ channel: 'sms', recipient: '+15552010003', status: 'prepared' }]);
  });

  it('a follow-up keeps who pays', async () => {
    const t = await triCounty();
    const c = t.customers.grace;
    const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, billToCustomerId: t.customers.ridgeline.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, clientRequestId: rid() });
    const job = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
    const a = await t.dana.post(`/c/${t.cid}/jobs/${job.id}/assign`, { userId: t.ids.luis, version: job.version });
    await t.luis.post(`/c/${t.cid}/jobs/${job.id}/complete`, { submissionId: rid(), baseVersion: a.body.version, outcome: 'unsuccessful', reasonCode: 'dog', reason: '' });
    const f = (await t.dana.post(`/c/${t.cid}/jobs/${job.id}/follow-up`)).body;
    const nj = (await t.dana.get(`/c/${t.cid}/jobs/${f.id}`)).body.job;
    expect(nj.bill_to_customer_id).toBe(job.bill_to_customer_id);
  });
});

describe('proposals and templates', () => {
  it('a name in another alphabet matches only that person', () => {
    const people = [{ id: '00000000-0000-4000-8000-000000000001', name: '张伟' }, { id: '00000000-0000-4000-8000-000000000002', name: 'Ñandú Pérez' }];
    const p = proposeFromText('When a job is completed, invoice it, the owner approves', { people });
    expect(p.definition!.steps.find((s) => s.action === 'invoice.issue')!.approval.approverUserIds).toEqual([]);
    const q = proposeFromText('When a job is completed, invoice it, ñandú approves', { people });
    expect(q.definition!.steps.find((s) => s.action === 'invoice.issue')!.approval.approverUserIds).toEqual(['00000000-0000-4000-8000-000000000002']);
  });

  it('a published copy keeps only workflows recorded as switched on', () => {
    const content = { services: [], roles: [], workflows: [{ name: 'Legacy, unknown state', definition: {} }, { name: 'Tested draft', definition: {}, draft: true }, { name: 'On', definition: { steps: [] }, active: true }] };
    expect(blankCopy(content).workflows.map((w) => w.name)).toEqual(['On']);
  });
});

describe('archived companies rest', () => {
  it('sends nothing while archived', async () => {
    const owner = await signup('Arch Ive');
    const cid = await newCompany(owner, ['fuel'], 'Resting Co');
    config.sendingCompanies = ['*'];
    Object.assign(config.sms, { provider: 'twilio', accountSid: 'AC1', authToken: 't', from: '+15550001111' });
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const cu = (await owner.post(`/c/${cid}/customers`, { name: 'Rita', phone: '555-201-0099' })).body;
    await owner.post(`/c/${cid}/archive`, { confirmName: 'Resting Co' });
    const r = await owner.post(`/c/${cid}/messages`, { customerId: cu.id, channel: 'sms', body: 'Hi', send: true });
    expect(r.body.detail).toMatch(/archived/);
    expect(f).not.toHaveBeenCalled();
  });
});
