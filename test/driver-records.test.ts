import { describe, it, expect } from 'vitest';
import { signup, newCompany, invite, customer, services, rid, getDb, type Client } from './helpers.js';
import { starterService } from '../src/shared/services.js';

// WP5: work recorded on a phone is never lost when the job moves on (R9-M2, R12-M1, R4-m1), and the
// driver flow records what really happened (implicit starts, quick reasons, typed signatures).

async function setup() {
  const owner = await signup('Owner');
  const driver = await signup('Luis Driver');
  const driver2 = await signup('Sam Driver');
  const cid = await newCompany(owner);
  await invite(owner, cid, driver, 'driver');
  await invite(owner, cid, driver2, 'driver');
  const svcs = await services(owner, cid);
  const { customerId, locationId } = await customer(owner, cid);
  const driverId = (await driver.get('/auth/me')).body.user.id as string;
  const driver2Id = (await driver2.get('/auth/me')).body.user.id as string;
  return { owner, driver, driver2, cid, svcs, customerId, locationId, driverId, driver2Id };
}
type S = Awaited<ReturnType<typeof setup>>;

async function job(s: S, to: string = s.driverId) {
  const r = await s.owner.post(`/c/${s.cid}/jobs`, { customerId: s.customerId, locationId: s.locationId, serviceId: s.svcs.fuel.id, details: { product: 'Diesel', requested_qty: '100' }, intent: 'open', clientRequestId: rid(), scheduledStart: '2030-01-01T15:00:00.000Z' });
  const j = (await s.owner.get(`/c/${s.cid}/jobs/${r.body.id}`)).body.job;
  const a = await s.owner.post(`/c/${s.cid}/jobs/${j.id}/assign`, { userId: to, resourceIds: [], version: j.version });
  expect(a.status).toBe(200);
  return { id: j.id as string, version: a.body.version as number };
}
const version = async (c: Client, cid: string, id: string) => (await c.get(`/c/${cid}/jobs/${id}`)).body.job.version as number;
const record = (sub: string, base: number, extra: Record<string, unknown> = {}) => ({ submissionId: sub, baseVersion: base, outcome: 'completed', values: { delivered_qty: '80' }, ...extra });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('reassigned while working', () => {
  it('asks before taking a started job away, then holds the late record for review and accepts it', async () => {
    const s = await setup();
    const j = await job(s);
    expect((await s.driver.post(`/c/${s.cid}/jobs/${j.id}/start`, { version: j.version })).status).toBe(200);
    const v = await version(s.owner, s.cid, j.id);
    // Dispatch is warned that Luis already started (R9-M2).
    const warn = await s.owner.post(`/c/${s.cid}/jobs/${j.id}/assign`, { userId: s.driver2Id, resourceIds: [], version: v });
    expect(warn.status).toBe(409);
    expect(warn.body.error.details.needsConfirm).toBe('started');
    expect(warn.body.error.message).toContain('Luis Driver has already started');
    expect((await s.owner.post(`/c/${s.cid}/jobs/${j.id}/assign`, { userId: s.driver2Id, resourceIds: [], version: v, confirmStarted: true })).status).toBe(200);

    // Luis's record arrives afterwards: kept for review, not "Job was not found".
    const r = await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, record('sub-late-1', j.version, { photos: [PNG], notes: 'Tank was low' }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ accepted: false, pendingReview: true });
    const again = await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, record('sub-late-1', j.version, { photos: [PNG] }));
    expect(again.body).toMatchObject({ pendingReview: true, duplicate: true });
    // Nothing changed on the job yet.
    expect((await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body.job.status).toBe('in_progress');

    // Dispatch has a needs-action item and the review list; drivers can't see the list.
    const inbox = (await s.owner.get(`/c/${s.cid}/notifications?tab=needs_action`)).body;
    expect(JSON.stringify(inbox)).toContain('Luis Driver sent a record for job');
    expect((await s.driver2.get(`/c/${s.cid}/pending-submissions`)).status).toBe(403);
    const list = (await s.owner.get(`/c/${s.cid}/pending-submissions`)).body.records;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ reason: 'reassigned', outcome: 'completed', driverName: 'Luis Driver', notes: 'Tank was low' });
    expect(list[0].values).toEqual([{ label: 'Delivered quantity', value: '80 gal' }]);
    const photo = await s.owner.get(`/c/${s.cid}/pending-submissions/${list[0].id}/files/${list[0].files.photoIds[0]}`);
    expect(photo.status).toBe(200);
    // The held photo isn't one of the job's files until accepted.
    expect((await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body.files).toHaveLength(0);

    const acc = await s.owner.post(`/c/${s.cid}/pending-submissions/${list[0].id}/accept`);
    expect(acc.status).toBe(200);
    const d = (await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body;
    expect(d.job.status).toBe('completed');
    expect(d.job.completion).toMatchObject({ submittedBy: s.driverId, acceptedFrom: 'reassigned', values: { delivered_qty: '80' } });
    expect(d.files).toHaveLength(1);
    expect((await s.owner.post(`/c/${s.cid}/pending-submissions/${list[0].id}/accept`)).status).toBe(409);
    expect((await s.owner.get(`/c/${s.cid}/pending-submissions`)).body.records).toHaveLength(0);
  });

  it('a record for a job someone already finished joins its history without replacing the outcome', async () => {
    const s = await setup();
    const j = await job(s);
    expect((await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, record('sub-first-1', j.version))).body.accepted).toBe(true);
    const r = await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, record('sub-second-1', j.version, { outcome: 'partial', reason: 'Ran out of hose' }));
    expect(r.body.pendingReview).toBe(true);
    const rec = (await s.owner.get(`/c/${s.cid}/pending-submissions`)).body.records[0];
    expect(rec.reason).toBe('finished');
    await s.owner.post(`/c/${s.cid}/pending-submissions/${rec.id}/accept`);
    const d = (await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body;
    expect(d.job.status).toBe('completed');
    expect(d.events.some((e: any) => e.type === 'late_record' && e.data.outcome === 'partial')).toBe(true);
  });

  it('dismissing keeps the job as it is and tells the driver', async () => {
    const s = await setup();
    const j = await job(s);
    const v = await version(s.owner, s.cid, j.id);
    await s.owner.post(`/c/${s.cid}/jobs/${j.id}/assign`, { userId: s.driver2Id, resourceIds: [], version: v });
    await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, record('sub-dismiss1', j.version));
    const rec = (await s.owner.get(`/c/${s.cid}/pending-submissions`)).body.records[0];
    expect((await s.owner.post(`/c/${s.cid}/pending-submissions/${rec.id}/dismiss`, { note: 'Sam did this one' })).status).toBe(200);
    expect((await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body.job.status).toBe('open');
    const all = (await s.owner.get(`/c/${s.cid}/pending-submissions?status=all`)).body.records;
    expect(all[0]).toMatchObject({ status: 'dismissed', decisionNote: 'Sam did this one' });
    expect(JSON.stringify((await s.driver.get(`/c/${s.cid}/notifications`)).body)).toContain('was not used');
  });

  it('someone never assigned the job learns nothing about it', async () => {
    const s = await setup();
    const j = await job(s, s.driver2Id);
    const r = await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, record('sub-stranger', j.version));
    expect(r.status).toBe(404);
    expect((await s.owner.get(`/c/${s.cid}/pending-submissions`)).body.records).toHaveLength(0);
  });
});

describe('removed from the company', () => {
  it('can send records for jobs they were assigned for 7 days (D12), nothing else', async () => {
    const s = await setup();
    const j = await job(s);
    const other = await job(s, s.driver2Id);
    await s.driver.post(`/c/${s.cid}/jobs/${j.id}/start`, { version: j.version });
    const members = (await s.owner.get(`/c/${s.cid}/members`)).body.members;
    const luis = members.find((m: any) => m.user_id === s.driverId);
    expect(luis.started_jobs).toBe(1);
    expect((await s.owner.del(`/c/${s.cid}/members/${luis.id}`)).status).toBe(200);

    // The phone learns it was removed (only this person can see that), so it can send and then wipe.
    const boot = await s.driver.get(`/c/${s.cid}`);
    expect(boot.status).toBe(403);
    expect(boot.body.error.code).toBe('not_member');
    expect(boot.body.error.details.lateRecordsUntil).toBeTruthy();
    const stranger = await signup('Stranger');
    expect((await stranger.get(`/c/${s.cid}`)).status).toBe(404);

    const r = await s.driver.post(`/late-records/${s.cid}/jobs/${j.id}`, record('sub-removed-1', j.version, { outcome: 'unsuccessful', reasonCode: 'locked_gate' }));
    expect(r.status).toBe(200);
    expect(r.body.pendingReview).toBe(true);
    const rec = (await s.owner.get(`/c/${s.cid}/pending-submissions`)).body.records[0];
    expect(rec).toMatchObject({ reason: 'removed', outcome: 'unsuccessful', reasonText: 'Locked gate' });
    // Only jobs they were assigned; strangers and other jobs look like nothing.
    expect((await s.driver.post(`/late-records/${s.cid}/jobs/${other.id}`, record('sub-removed-2', other.version))).status).toBe(404);
    expect((await stranger.post(`/late-records/${s.cid}/jobs/${j.id}`, record('sub-removed-3', j.version))).status).toBe(404);
    // After 7 days the window closes.
    const db = await getDb();
    await db.query(`update rigo.memberships set removed_at = now() - interval '8 days' where id = $1`, [luis.id]);
    expect((await s.driver.post(`/late-records/${s.cid}/jobs/${j.id}`, record('sub-removed-4', j.version))).status).toBe(404);
  });
});

describe('driver flow', () => {
  it('hand-over moves the job, keeps its state, and records who handed it to whom', async () => {
    const s = await setup();
    const j = await job(s);
    await s.driver.post(`/c/${s.cid}/jobs/${j.id}/start`, { version: j.version });
    const cands = (await s.driver.get(`/c/${s.cid}/jobs/${j.id}/handover`)).body.drivers;
    expect(cands.map((x: any) => x.name)).toContain('Sam Driver');
    expect(cands.some((x: any) => x.id === s.driverId)).toBe(false);
    // Only the assigned driver can hand over.
    expect((await s.driver2.post(`/c/${s.cid}/jobs/${j.id}/handover`, { toUserId: s.driver2Id, version: 0 })).status).toBe(404);
    const v = await version(s.owner, s.cid, j.id);
    const h = await s.driver.post(`/c/${s.cid}/jobs/${j.id}/handover`, { toUserId: s.driver2Id, version: v, note: 'Shift change' });
    expect(h.status).toBe(200);
    const d = (await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body;
    expect(d.job).toMatchObject({ status: 'in_progress', assigned_user_id: s.driver2Id });
    expect(d.events.find((e: any) => e.type === 'handed_over').data).toMatchObject({ from: s.driverId, to: s.driver2Id, note: 'Shift change' });
    expect((await s.driver2.get(`/c/${s.cid}/my/jobs`)).body.jobs.some((x: any) => x.id === j.id)).toBe(true);
  });

  it('a record sent without starting first is accepted, and history says the start was implicit', async () => {
    const s = await setup();
    const j = await job(s);
    const r = await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, record('sub-implicit', j.version));
    expect(r.body.accepted).toBe(true);
    const ev = (await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body.events;
    expect(ev.find((e: any) => e.type === 'started').data.implicit).toBe(true);
  });

  it('a quick reason is enough for a visit that could not be completed (R6-m5)', async () => {
    const s = await setup();
    const j = await job(s);
    const none = await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, record('sub-reason-0', j.version, { outcome: 'unsuccessful' }));
    expect(none.status).toBe(400);
    const r = await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, record('sub-reason-1', j.version, { outcome: 'unsuccessful', reasonCode: 'dog', reason: 'Owner not home' }));
    expect(r.body.accepted).toBe(true);
    const job2 = (await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body.job;
    expect(job2.completion.reason).toBe('Dog on the property: Owner not home');
    expect(job2.completion.reasonCode).toBe('dog');
  });

  it('a typed signature counts when the customer agreed, and is recorded as typed (R9-m4)', async () => {
    const s = await setup();
    const fuel = s.svcs.fuel;
    const def = starterService('fuel');
    def.requiresSignature = true;
    await s.owner.put(`/c/${s.cid}/services/${fuel.id}`, { service: def, version: fuel.version });
    const j = await job(s);
    const missing = await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, record('sub-sign-0', j.version, { signerName: 'Pat Customer' }));
    expect(missing.status).toBe(400);
    const r = await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, record('sub-sign-1', j.version, { signerName: 'Pat Customer', signatureTyped: true }));
    expect(r.body.accepted).toBe(true);
    const d = (await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body;
    expect(d.job.completion).toMatchObject({ signerName: 'Pat Customer', signatureTyped: true, signatureId: null });
    expect(d.events.find((e: any) => e.type === 'completion').data.typedSignature).toBe(true);
  });

  it('an unreadable photo is refused with a clear message (R9-m1)', async () => {
    const s = await setup();
    const j = await job(s);
    const bad = 'data:image/jpeg;base64,' + Buffer.from('not really an image').toString('base64');
    const r = await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, record('sub-badphoto', j.version, { photos: [bad] }));
    expect(r.status).toBe(400);
    expect(r.body.error.details.fields.photos).toBe("That photo couldn't be read");
  });
});
