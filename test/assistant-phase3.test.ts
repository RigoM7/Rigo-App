import { describe, it, expect } from 'vitest';
import { classify, isAutomationRequest, parseTime } from '../src/shared/assistant.js';
import { triCounty, type TriCounty } from './fixtures/tricounty.js';
import { rid, processAll, getDb } from './helpers.js';
import { textNumber, jobUpdateText } from '../src/shared/messages.js';
import { proposeFromText } from '../src/shared/proposal.js';

describe('what the assistant is asked (R15-M1)', () => {
  it('only a trigger plus an action becomes a proposal; questions never do', () => {
    for (const t of ['When a job is completed, prepare an invoice and ask me to approve it', 'Whenever a septic job is done, invoice it, Priya approves over $1,500, then email the customer', 'After a visit fails, notify dispatch', 'Create a workflow that emails the customer']) expect(isAutomationRequest(t), t).toBe(true);
    for (const t of ['When is Grace Okafor\'s next visit?', 'When is the next delivery for Hollis', 'Which workflows are active?', 'What needs my attention?', 'when will job 54 be done', 'Is automation on?']) expect(isAutomationRequest(t), t).toBe(false);
  });

  it('reads the everyday questions', () => {
    expect(classify("When is Grace Okafor's next visit?")).toEqual({ kind: 'customer', name: 'grace okafor', wants: 'next' });
    expect(classify('What does Hollis Family Farm owe?')).toEqual({ kind: 'customer', name: 'hollis family farm', wants: 'owes' });
    expect(classify('Who is free at 2pm tomorrow?')).toEqual({ kind: 'driversFree', day: 'tomorrow', hour: 14, minute: 0 });
    expect(classify('Which drivers are available at 9:30?')).toEqual({ kind: 'driversFree', day: 'today', hour: 9, minute: 30 });
    expect(classify('How much do we charge for dyed diesel?')).toEqual({ kind: 'price', item: 'dyed diesel' });
    expect(classify('What is the price of a pump-out?')).toEqual({ kind: 'price', item: 'pump-out' });
    expect(classify("Why can't I approve this invoice?")).toEqual({ kind: 'whyCantApprove' });
    expect(classify('Text the customer that we are late')).toEqual({ kind: 'cantYet', what: 'text' });
    expect(classify('Send Ridgeline their statement')).toEqual({ kind: 'cantYet', what: 'statement' });
    expect(classify('What needs my attention?').kind).toBe('attention');
    expect(classify('hello').kind).toBe('help');
  });

  it('reads times the way a dispatcher says them', () => {
    expect(parseTime('2pm')).toEqual({ hour: 14, minute: 0 });
    expect(parseTime('2:30 p.m.')).toEqual({ hour: 14, minute: 30 });
    expect(parseTime('at 9')).toEqual({ hour: 9, minute: 0 });
    expect(parseTime('at 3')).toEqual({ hour: 15, minute: 0 });
    expect(parseTime('noon')).toEqual({ hour: 12, minute: 0 });
    expect(parseTime('12am')).toEqual({ hour: 0, minute: 0 });
  });
});

describe('workflow proposals (R15-m1)', () => {
  it('reads a named approver and an amount, names it plainly, and lists what it left out', async () => {
    const { proposeFromText } = await import('../src/shared/proposal.js');
    const p = proposeFromText('When a septic job is completed, invoice it, Priya approves over $1,500, then email the customer, and water the plants', { people: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Priya Shah' }, { id: '00000000-0000-4000-8000-000000000002', name: 'Marcus Lee' }] });
    expect(p.name).toBe('Septic jobs: invoice, Priya approves over $1,500, email');
    const issue = p.definition!.steps.find((s) => s.action === 'invoice.issue')!;
    expect(issue.approval).toMatchObject({ required: 'conditional', approverUserIds: ['00000000-0000-4000-8000-000000000001'], conditions: [{ field: 'invoice.total_minor', op: 'gt', value: 150000 }] });
    expect(p.understood).toContain('Issue it after approval by Priya Shah when the total is over $1,500');
    expect(p.notUnderstood).toEqual(['"and water the plants"']);
  });
});

// "On my way" and messages to customers (R15-M2, D10).
const noApproval = { required: 'never', conditions: [], approverRoles: [], approverUserIds: [], backupUserIds: [], escalateAfterHours: null };
const exc = { notifyRoles: ['owner'], stop: true };
async function activate(t: TriCounty, event: string) {
  const def = { trigger: { event }, conditions: [], steps: [{ id: 'u', action: 'message.prepare_job_update', params: {}, mode: 'automatic', approval: noApproval, onException: exc }, { id: 's', action: 'message.send', params: {}, mode: 'automatic', approval: noApproval, onException: exc }] };
  const wf = await t.dana.post(`/c/${t.cid}/workflows`, { name: `Tell the customer: ${event}`, definition: def });
  expect(wf.status).toBe(200);
  expect((await t.dana.post(`/c/${t.cid}/workflows/${wf.body.id}/versions/${wf.body.versionId}/test`, {})).body.ok).toBe(true);
  expect((await t.dana.post(`/c/${t.cid}/workflows/${wf.body.id}/versions/${wf.body.versionId}/activate`)).status).toBe(200);
}
async function assigned(t: TriCounty, who: 'luis' | 'sam' = 'luis') {
  const c = t.customers.grace;
  const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, clientRequestId: rid(), scheduledStart: new Date(Date.now() + 3600_000).toISOString() });
  const job = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
  const a = await t.dana.post(`/c/${t.cid}/jobs/${job.id}/assign`, { userId: t.ids[who], version: job.version });
  return { id: job.id as string, number: job.number as number, version: a.body.version as number };
}
const messagesFor = async (jobId: string) => (await (await getDb()).query<any>(`select channel, recipient, subject, body, status, status_detail from rigo.messages where job_id = $1 order by created_at`, [jobId])).rows;

describe('On my way (R15-M2)', () => {
  it('the assigned driver says they are on the way; a workflow prepares a text, kept unsent without a text service', async () => {
    const t = await triCounty();
    await activate(t, 'job.en_route');
    const j = await assigned(t);
    expect((await t.sam.post(`/c/${t.cid}/jobs/${j.id}/en-route`, { etaMinutes: 20 })).status).toBe(404); // not their job
    expect((await t.marcus.post(`/c/${t.cid}/jobs/${j.id}/en-route`, { etaMinutes: 20 })).status).toBe(403);
    expect((await t.luis.post(`/c/${t.cid}/jobs/${j.id}/en-route`, { etaMinutes: 0 })).status).toBe(400);
    const r = await t.luis.post(`/c/${t.cid}/jobs/${j.id}/en-route`, { etaMinutes: 20 });
    expect(r.status).toBe(200);
    expect(r.body.etaMinutes).toBe(20);
    await processAll();
    const ms = await messagesFor(j.id);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ channel: 'sms', recipient: '+15552010003', status: 'prepared' });
    expect(ms[0].body).toBe('Tri-County Field Services: Luis is on the way for your fuel delivery at 812 Willow Ln, Fairview, arriving in about 20 minutes.');
    // A new estimate is recorded on the job, without a second message.
    await t.luis.post(`/c/${t.cid}/jobs/${j.id}/en-route`, { etaMinutes: 10 });
    await processAll();
    expect(await messagesFor(j.id)).toHaveLength(1);
    const job = (await t.dana.get(`/c/${t.cid}/jobs/${j.id}`)).body;
    expect(job.job).toMatchObject({ en_route_eta_minutes: 10 });
    expect(job.job.en_route_at).toBeTruthy();
    expect((await t.luis.get(`/c/${t.cid}/my/jobs`)).body.jobs.find((x: any) => x.id === j.id)).toMatchObject({ en_route_eta_minutes: 10 });
    // Once started, "on my way" no longer applies.
    await t.luis.post(`/c/${t.cid}/jobs/${j.id}/start`, { version: job.job.version });
    expect((await t.luis.post(`/c/${t.cid}/jobs/${j.id}/en-route`, {})).body.error.message).toBe('This job is already started.');
  });

  it('starting a job is a trigger too; the update says it has started', async () => {
    const t = await triCounty();
    await activate(t, 'job.started');
    const j = await assigned(t);
    expect((await t.luis.post(`/c/${t.cid}/jobs/${j.id}/start`, { version: j.version })).status).toBe(200);
    await processAll();
    const ms = await messagesFor(j.id);
    expect(ms).toHaveLength(1);
    expect(ms[0].body).toBe('Tri-County Field Services: Luis has started your fuel delivery at 812 Willow Ln, Fairview.');
  });

  it('the proposal reads "on the way" and "text the customer"', () => {
    const p = proposeFromText('When a driver is on the way, text the customer');
    expect(p.definition?.trigger.event).toBe('job.en_route');
    expect(p.definition?.steps.map((s) => s.action)).toEqual(['message.prepare_job_update', 'message.send']);
    expect(p.understood[0]).toBe('Starts when: a driver is on the way');
    expect(proposeFromText('When the driver starts a job, tell the customer').definition?.trigger.event).toBe('job.started');
  });

  it('writes phone numbers the way a text service needs them', () => {
    expect(textNumber('(555) 201-0003')).toBe('+15552010003');
    expect(textNumber('1-555-201-0003')).toBe('+15552010003');
    expect(textNumber('+44 20 7946 0958')).toBe('+442079460958');
    expect(textNumber('')).toBe('');
    const base = { number: 7, customer_name: 'Grace', company_name: 'Acme', service_name: 'Pump-out', address: null, driver_name: 'Sam Ortiz', en_route_at: null, en_route_eta_minutes: null };
    expect(jobUpdateText({ ...base, status: 'open', en_route_at: '2026-10-07T14:00:00Z' }).short).toBe('Acme: Sam is on the way for your pump-out.');
    expect(jobUpdateText({ ...base, status: 'completed' }).live).toBe(false);
  });
});

describe('messages to one customer (R15-M2)', () => {
  it('a dispatcher writes to a customer; the number comes from the customer record', async () => {
    const t = await triCounty();
    const j = await assigned(t);
    const r = await t.marcus.post(`/c/${t.cid}/messages`, { customerId: t.customers.grace.id, jobId: j.id, channel: 'sms', body: 'Running about 15 minutes late.', send: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'not_sent' });
    expect(r.body.detail).toMatch(/^Prepared, not sent\. Text messaging is not set up/);
    expect(await messagesFor(j.id)).toMatchObject([{ channel: 'sms', recipient: '+15552010003', subject: `Tri-County Field Services: about job #${j.number}`, status: 'prepared' }]);
    const list = (await t.marcus.get(`/c/${t.cid}/messages`)).body;
    expect(list.capabilities.sms.state).toBe('disabled');
    // It shows in the customer's conversation.
    const cu = (await t.dana.get(`/c/${t.cid}/customers/${t.customers.grace.id}`)).body;
    expect(cu.messages.find((m: any) => m.id === r.body.id)).toMatchObject({ channel: 'sms', status: 'prepared' });
  });

  it('drivers cannot write to customers, and a job must belong to the customer', async () => {
    const t = await triCounty();
    const j = await assigned(t);
    expect((await t.luis.post(`/c/${t.cid}/messages`, { customerId: t.customers.grace.id, channel: 'email', body: 'Hi' })).status).toBe(403);
    expect((await t.dana.post(`/c/${t.cid}/messages`, { customerId: t.customers.hollis.id, jobId: j.id, channel: 'email', body: 'Hi' })).status).toBe(404);
    expect((await t.dana.post(`/c/${t.cid}/messages`, { customerId: t.customers.grace.id, channel: 'sms', body: 'x'.repeat(641) })).status).toBe(400);
    // No email address on file: prepared, and it says so.
    const r = await t.dana.post(`/c/${t.cid}/messages`, { customerId: t.customers.jose.id, channel: 'email', body: 'Hello' });
    expect(r.body).toMatchObject({ status: 'prepared', detail: 'Prepared, not sent: the customer has no email address on file.' });
  });
});
