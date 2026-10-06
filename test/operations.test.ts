import { describe, it, expect } from 'vitest';
import { signup, newCompany, invite, customer, services, activateAll, processAll, rid, getDb } from './helpers.js';
import { starterService } from '../src/shared/services.js';

async function setup(mode: 'manual' | 'assisted' | 'automatic' = 'assisted', rates = true) {
  const owner = await signup('Owner');
  const driver = await signup('Driver');
  const office = await signup('Office');
  const cid = await newCompany(owner);
  await invite(owner, cid, driver, 'driver');
  await invite(owner, cid, office, 'office');
  await owner.patch(`/c/${cid}/automation`, { mode });
  const svcs = await services(owner, cid);
  if (rates) {
    const fuel = svcs.fuel;
    const def = starterService('fuel');
    def.pricing[0].rateE4 = 38900;
    def.pricing = def.pricing.filter((p) => p.id !== 'delivery'); // this company charges no delivery fee
    await owner.put(`/c/${cid}/services/${fuel.id}`, { service: def, version: fuel.version });
  }
  await activateAll(owner, cid);
  const { customerId, locationId } = await customer(owner, cid);
  const driverId = (await driver.get('/auth/me')).body.user.id;
  return { owner, driver, office, cid, svcs: await services(owner, cid), customerId, locationId, driverId };
}

async function openFuelJob(s: Awaited<ReturnType<typeof setup>>, start = '2030-01-01T15:00:00.000Z') {
  const r = await s.owner.post(`/c/${s.cid}/jobs`, { customerId: s.customerId, locationId: s.locationId, serviceId: s.svcs.fuel.id, details: { product: 'Diesel', requested_qty: '100' }, intent: 'open', clientRequestId: rid(), scheduledStart: start });
  expect(r.status).toBe(200);
  const job = (await s.owner.get(`/c/${s.cid}/jobs/${r.body.id}`)).body.job;
  const a = await s.owner.post(`/c/${s.cid}/jobs/${job.id}/assign`, { userId: s.driverId, resourceIds: [], version: job.version });
  expect(a.status).toBe(200);
  return { id: job.id as string, version: a.body.version as number };
}

describe('jobs', () => {
  it('saves drafts and explains missing information', async () => {
    const s = await setup();
    const r = await s.owner.post(`/c/${s.cid}/jobs`, { customerId: s.customerId, intent: 'open', clientRequestId: rid() });
    expect(r.status).toBe(400);
    expect(r.body.error.details.missing).toEqual(expect.arrayContaining(['Choose a service location', 'Choose a service']));
    const d = await s.owner.post(`/c/${s.cid}/jobs`, { customerId: s.customerId, intent: 'draft', clientRequestId: 'same-request-1234' });
    const again = await s.owner.post(`/c/${s.cid}/jobs`, { customerId: s.customerId, intent: 'draft', clientRequestId: 'same-request-1234' });
    expect(again.body.id).toBe(d.body.id);
    expect(again.body.duplicate).toBe(true);
  });

  it('drivers only see their assignments and no financial data', async () => {
    const s = await setup();
    const j = await openFuelJob(s);
    const other = await s.owner.post(`/c/${s.cid}/jobs`, { customerId: s.customerId, locationId: s.locationId, serviceId: s.svcs.fuel.id, details: { product: 'Diesel' }, intent: 'open', clientRequestId: rid() });
    const list = await s.driver.get(`/c/${s.cid}/jobs`);
    expect(list.body.jobs.map((x: any) => x.id)).toEqual([j.id]);
    expect(list.body.jobs[0].billing_status).toBeUndefined();
    expect((await s.driver.get(`/c/${s.cid}/jobs/${other.body.id}`)).status).toBe(404);
    const svc = await s.driver.get(`/c/${s.cid}/services`);
    // Record ids are random and can contain any digits; look for the rate everywhere else.
    expect(JSON.stringify(svc.body).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '')).not.toContain('389');
    expect(svc.body.services[0].pricing[0].rateE4).toBeUndefined();
    expect((await s.driver.get(`/c/${s.cid}/invoices`)).status).toBe(403);
    expect((await s.driver.get(`/c/${s.cid}/customers`)).status).toBe(403);
    const detail = await s.driver.get(`/c/${s.cid}/jobs/${j.id}`);
    expect(detail.body.customer.email).toBeNull();
    expect(detail.body.invoice).toBeNull();
  });

  it('prevents conflicting assignments and stale edits', async () => {
    const s = await setup();
    await openFuelJob(s, '2030-01-01T15:00:00.000Z');
    const r = await s.owner.post(`/c/${s.cid}/jobs`, { customerId: s.customerId, locationId: s.locationId, serviceId: s.svcs.fuel.id, details: { product: 'Diesel' }, intent: 'open', clientRequestId: rid(), scheduledStart: '2030-01-01T15:30:00.000Z' });
    const j2 = (await s.owner.get(`/c/${s.cid}/jobs/${r.body.id}`)).body.job;
    const clash = await s.owner.post(`/c/${s.cid}/jobs/${j2.id}/assign`, { userId: s.driverId, resourceIds: [], version: j2.version });
    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toMatch(/is busy then: job #/);
    const stale = await s.owner.patch(`/c/${s.cid}/jobs/${j2.id}`, { notes: 'x', version: j2.version + 5 });
    expect(stale.status).toBe(409);
  });

  it('completion is idempotent and stale submissions become conflicts', async () => {
    const s = await setup();
    const j = await openFuelJob(s);
    const sub = { submissionId: 'sub-abcdef12', baseVersion: j.version, outcome: 'completed', values: { delivered_qty: '98.5' }, notes: 'ok' };
    const stale = await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, { ...sub, baseVersion: j.version - 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.reason).toBe('changed');
    const [a, b] = [await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, sub), await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, sub)];
    expect(a.status).toBe(200);
    expect(b.body.duplicate).toBe(true);
    // A different record for the finished job never replaces the outcome: it goes to the office for review (WP5).
    const other = await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, { ...sub, submissionId: 'sub-different1' });
    expect(other.status).toBe(200);
    expect(other.body).toMatchObject({ accepted: false, pendingReview: true });
  });

  it('requires completion fields and treats unsuccessful visits differently', async () => {
    const s = await setup();
    const j = await openFuelJob(s);
    const missing = await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, { submissionId: 'sub-missing01', baseVersion: j.version, outcome: 'completed', values: {} });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.fields.delivered_qty).toBeTruthy();
    const noReason = await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, { submissionId: 'sub-missing02', baseVersion: j.version, outcome: 'unsuccessful', values: {} });
    expect(noReason.body.error.details.fields.reason).toBeTruthy();
    const ok = await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, { submissionId: 'sub-unsucc01', baseVersion: j.version, outcome: 'unsuccessful', values: {}, reason: 'Gate locked' });
    expect(ok.status).toBe(200);
    await processAll();
    const detail = (await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body;
    expect(detail.job.status).toBe('unsuccessful');
    expect(detail.job.billing_status).toBe('not_billable');
    expect(detail.invoice).toBeNull();
    expect((await s.owner.post(`/c/${s.cid}/jobs/${j.id}/invoice`)).status).toBe(409);
    // The follow-up workflow (assisted) proposes a follow-up job rather than creating it silently.
    const auto = await s.owner.get(`/c/${s.cid}/automation`);
    expect(auto.body.waiting.some((a: any) => a.type === 'job.create_followup' && a.status === 'proposed')).toBe(true);
  });

  it('a reassigned driver cannot complete the job; their record goes to the office for review (R9-M2)', async () => {
    const s = await setup();
    const j = await openFuelJob(s);
    const job = (await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body.job;
    await s.owner.post(`/c/${s.cid}/jobs/${j.id}/assign`, { userId: null, resourceIds: [], version: job.version });
    const r = await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, { submissionId: 'sub-reassign1', baseVersion: j.version, outcome: 'completed', values: { delivered_qty: '1' } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ accepted: false, pendingReview: true });
    expect((await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body.job.status).toBe('open');
  });
});

describe('invoices and automation', () => {
  it('assisted: prepares the invoice, waits for approval, never issues on its own', async () => {
    const s = await setup('assisted');
    const j = await openFuelJob(s);
    await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, { submissionId: 'sub-assist01', baseVersion: j.version, outcome: 'completed', values: { delivered_qty: '100.5' } });
    await processAll();
    const inv = (await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body.invoice;
    expect(inv.status).toBe('draft');
    expect(inv.total_minor).toBe(39095); // 100.5 * 389 = 39094.5 -> half-up
    const approvals = (await s.owner.get(`/c/${s.cid}/approvals`)).body.approvals;
    expect(approvals).toHaveLength(1);
    expect(approvals[0].canDecide).toBe(true);
    // A driver has no approval authority; Office does (owner decision D7), tested separately.
    expect((await s.driver.post(`/c/${s.cid}/approvals/${approvals[0].id}/decide`, { decision: 'approve' })).status).toBe(403);
    const d = await s.owner.post(`/c/${s.cid}/approvals/${approvals[0].id}/decide`, { decision: 'approve', note: '' });
    expect(d.body.status).toBe('approved');
    await processAll();
    const after = (await s.owner.get(`/c/${s.cid}/invoices/${inv.id}`)).body;
    expect(after.invoice.status).toBe('issued');
    expect(after.invoice.number).toBe('INV-00001');
    // Email step: prepared. Assisted mode proposes the send; running it is blocked (no email service)
    // and the message stays prepared for a person to send.
    expect(after.messages[0].status).toBe('prepared');
    const send = (await s.owner.get(`/c/${s.cid}/automation`)).body.waiting.find((a: any) => a.type === 'message.send');
    expect(send.status).toBe('proposed');
    await s.owner.post(`/c/${s.cid}/automation/actions/${send.id}/run`);
    const hist = (await s.owner.get(`/c/${s.cid}/automation`)).body.history;
    expect(hist.find((a: any) => a.type === 'message.send').status).toBe('blocked');
    expect((await s.owner.get(`/c/${s.cid}/messages`)).body.messages[0].status).toBe('prepared');
  });

  it('automatic mode still waits for approval and missing prices hold the invoice', async () => {
    const s = await setup('automatic', false);
    const j = await openFuelJob(s);
    await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, { submissionId: 'sub-auto0001', baseVersion: j.version, outcome: 'completed', values: { delivered_qty: '10' } });
    await processAll();
    const detail = (await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body;
    expect(detail.invoice.status).toBe('held');
    expect(detail.invoice.total_minor).toBeNull();
    expect(detail.invoice.hold_reasons.join(' ')).toMatch(/No rate/);
    // Held invoices cannot be issued even by an owner.
    const inv = (await s.owner.get(`/c/${s.cid}/invoices/${detail.invoice.id}`)).body.invoice;
    expect((await s.owner.post(`/c/${s.cid}/invoices/${inv.id}/approve`, { version: inv.version })).status).toBe(409);
    // Setting the rate rebuilds the held draft; it then needs approval (automatic did not bypass it).
    const fuel = (await services(s.owner, s.cid)).fuel;
    const def = starterService('fuel'); def.pricing[0].rateE4 = 40000; def.pricing = def.pricing.filter((p) => p.id !== 'delivery');
    await s.owner.put(`/c/${s.cid}/services/${fuel.id}`, { service: def, version: fuel.version });
    const fixed = (await s.owner.get(`/c/${s.cid}/invoices/${inv.id}`)).body.invoice;
    expect(fixed.status).toBe('draft');
    expect(fixed.totalMinor).toBe(4000);
    expect((await s.owner.post(`/c/${s.cid}/invoices/${inv.id}/issue`, { version: fixed.version })).status).toBe(409);
  });

  it('duplicate preparation returns the same invoice', async () => {
    const s = await setup('manual');
    const j = await openFuelJob(s);
    await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, { submissionId: 'sub-dupl0001', baseVersion: j.version, outcome: 'completed', values: { delivered_qty: '5' } });
    const [a, b] = [await s.owner.post(`/c/${s.cid}/jobs/${j.id}/invoice`), await s.owner.post(`/c/${s.cid}/jobs/${j.id}/invoice`)];
    expect(a.body.invoiceId).toBe(b.body.invoiceId);
    expect(b.body.created).toBe(false);
    const db = await getDb();
    expect((await db.query(`select count(*)::int n from rigo.invoices where job_id = $1`, [j.id])).rows[0].n).toBe(1);
  });

  it('manual mode lists next steps without preparing anything', async () => {
    const s = await setup('manual');
    const j = await openFuelJob(s);
    await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, { submissionId: 'sub-manual01', baseVersion: j.version, outcome: 'completed', values: { delivered_qty: '5' } });
    await processAll();
    expect((await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body.invoice).toBeNull();
    const waiting = (await s.owner.get(`/c/${s.cid}/automation`)).body.waiting;
    const step = waiting.find((a: any) => a.type === 'invoice.prepare');
    expect(step.status).toBe('suggested');
    await s.owner.post(`/c/${s.cid}/automation/actions/${step.id}/run`);
    expect((await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body.invoice.status).toBe('draft');
  });

  it('editing an invoice makes a pending approval stale and re-requests it', async () => {
    const s = await setup('assisted');
    const j = await openFuelJob(s);
    await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, { submissionId: 'sub-stale001', baseVersion: j.version, outcome: 'completed', values: { delivered_qty: '10' } });
    await processAll();
    const invId = (await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body.invoice.id;
    const before = (await s.owner.get(`/c/${s.cid}/approvals`)).body.approvals[0];
    const inv = (await s.owner.get(`/c/${s.cid}/invoices/${invId}`)).body;
    await s.owner.put(`/c/${s.cid}/invoices/${invId}/lines`, { version: inv.invoice.version, lines: inv.lines.map((l: any) => ({ ...l, quantity: '12' })) });
    const old = await s.owner.post(`/c/${s.cid}/approvals/${before.id}/decide`, { decision: 'approve' });
    expect(old.status).toBe(409);
    const fresh = (await s.owner.get(`/c/${s.cid}/approvals`)).body.approvals;
    expect(fresh).toHaveLength(1);
    expect(fresh[0].id).not.toBe(before.id);
  });

  it('pause holds queued work; takeover cancels a waiting run', async () => {
    const s = await setup('automatic');
    await s.owner.patch(`/c/${s.cid}/automation`, { paused: true, queued: 'hold' });
    const j = await openFuelJob(s);
    await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, { submissionId: 'sub-pause001', baseVersion: j.version, outcome: 'completed', values: { delivered_qty: '10' } });
    await processAll();
    expect((await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body.invoice).toBeNull();
    await s.owner.patch(`/c/${s.cid}/automation`, { paused: false });
    await processAll();
    expect((await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body.invoice.status).toBe('draft');
    const runs = (await s.owner.get(`/c/${s.cid}/automation`)).body.runs;
    const run = runs.find((r: any) => r.workflow_name === 'Completed job to invoice');
    expect((await s.owner.post(`/c/${s.cid}/automation/runs/${run.id}/takeover`)).status).toBe(200);
    expect((await s.owner.get(`/c/${s.cid}/approvals`)).body.approvals).toHaveLength(0);
  });

  it('a workflow edited after approval was requested blocks the stale step', async () => {
    const s = await setup('assisted');
    const j = await openFuelJob(s);
    await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, { submissionId: 'sub-wfchg001', baseVersion: j.version, outcome: 'completed', values: { delivered_qty: '10' } });
    await processAll();
    const wf = (await s.owner.get(`/c/${s.cid}/workflows`)).body.workflows.find((w: any) => w.name === 'Completed job to invoice');
    const full = (await s.owner.get(`/c/${s.cid}/workflows/${wf.id}`)).body;
    const def = full.versions[0].definition;
    def.steps = def.steps.slice(0, 2);
    const saved = await s.owner.put(`/c/${s.cid}/workflows/${wf.id}/draft`, { definition: def, baseVersionId: full.versions[0].id });
    expect(saved.body.newVersion).toBe(true);
    // A new draft cannot be activated untested.
    expect((await s.owner.post(`/c/${s.cid}/workflows/${wf.id}/versions/${saved.body.versionId}/activate`)).status).toBe(409);
    await s.owner.post(`/c/${s.cid}/workflows/${wf.id}/versions/${saved.body.versionId}/test`, {});
    expect((await s.owner.post(`/c/${s.cid}/workflows/${wf.id}/versions/${saved.body.versionId}/activate`)).status).toBe(200);
    const ap = (await s.owner.get(`/c/${s.cid}/approvals`)).body.approvals[0];
    const r = await s.owner.post(`/c/${s.cid}/approvals/${ap.id}/decide`, { decision: 'approve' });
    expect(r.body.status).toBe('stale');
  });
});
