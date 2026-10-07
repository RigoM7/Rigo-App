import { describe, it, expect } from 'vitest';
import { triCounty, type TriCounty } from './fixtures/tricounty.js';
import { rid, getDb } from './helpers.js';

// WP6: trucks out of service, drivers told about changes, emergencies.

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

async function fuelJob(t: TriCounty, opts: { start?: string; driver?: string | null; trucks?: string[]; priority?: string } = {}) {
  const c = t.customers.grace;
  const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel', requested_qty: '100' }, intent: 'open', clientRequestId: rid(), scheduledStart: opts.start ?? inHours(2), priority: opts.priority });
  expect(r.status).toBe(200);
  const j = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
  if (opts.driver !== null) {
    const a = await t.dana.post(`/c/${t.cid}/jobs/${j.id}/assign`, { userId: opts.driver ?? t.ids.luis, resourceIds: opts.trucks ?? [], version: j.version });
    expect(a.status).toBe(200);
  }
  return (await t.dana.get(`/c/${t.cid}/jobs/${j.id}`)).body.job;
}
const bell = async (who: any, cid: string) => JSON.stringify((await who.get(`/c/${cid}/notifications`)).body);

describe('trucks out of service (R11-M1)', () => {
  it('asks before taking a truck with open jobs out of service, tells dispatch, and lets them swap it', async () => {
    const t = await triCounty();
    const tw2 = t.trucks['Tank wagon 2'], tw1 = t.trucks['Tank wagon 1'];
    const a = await fuelJob(t, { trucks: [tw2], start: inHours(2) });
    const b = await fuelJob(t, { trucks: [tw2], start: inHours(6), driver: t.ids.sam });
    const ask = await t.dana.patch(`/c/${t.cid}/resources/${tw2}`, { status: 'out_of_service' });
    expect(ask.status).toBe(409);
    expect(ask.body.error.message).toBe('2 open jobs use Tank wagon 2.');
    expect(ask.body.error.details.jobs.map((j: any) => j.number)).toEqual([a.number, b.number]);
    const until = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
    expect((await t.dana.patch(`/c/${t.cid}/resources/${tw2}`, { status: 'out_of_service', outOfServiceUntil: until, confirmJobs: true })).status).toBe(200);
    expect(await bell(t.marcus, t.cid)).toContain('Tank wagon 2 is out of service: 2 open jobs use it');
    expect((await t.marcus.get(`/c/${t.cid}/jobs?oos=1`)).body.jobs.map((j: any) => j.number).sort()).toEqual([a.number, b.number].sort());
    expect((await t.dana.get(`/c/${t.cid}/overview`)).body.attention.some((x: any) => x.key === 'out_of_service' && x.count === 2)).toBe(true);
    // Changing the driver keeps the truck already on the job; adding an out-of-service truck is refused.
    const keep = await t.marcus.post(`/c/${t.cid}/jobs/${a.id}/assign`, { userId: t.ids.jo, resourceIds: [tw2], version: (await t.dana.get(`/c/${t.cid}/jobs/${a.id}`)).body.job.version });
    expect(keep.status).toBe(200);
    const c2 = await fuelJob(t, { driver: null });
    const add = await t.marcus.post(`/c/${t.cid}/jobs/${c2.id}/assign`, { userId: t.ids.jo, resourceIds: [tw2], version: c2.version });
    expect(add.status).toBe(409);
    // Swap the truck on both jobs at once.
    const sw = await t.marcus.post(`/c/${t.cid}/jobs/swap-resource`, { fromId: tw2, toId: tw1, jobIds: [a.id, b.id] });
    expect(sw.body).toMatchObject({ moved: [a.number, b.number].sort((x, y) => x - y), failed: [] });
    expect((await t.marcus.get(`/c/${t.cid}/jobs?oos=1`)).body.jobs).toHaveLength(0);
    // Sam is told his truck changed.
    expect(await bell(t.sam, t.cid)).toContain('Truck changed: Tank wagon 2 → Tank wagon 1');
    // The resource shows its return date, and is available again once it has passed.
    expect((await t.dana.get(`/c/${t.cid}/resources`)).body.resources.find((r: any) => r.id === tw2).out_of_service_until).toBe(until);
    await (await getDb()).query(`update rigo.resources set out_of_service_until = current_date - 1 where id = $1`, [tw2]);
    expect((await t.dana.get(`/c/${t.cid}/resources`)).body.resources.find((r: any) => r.id === tw2).status).toBe('available');
  });

  it('refuses duplicate names; deletes only trucks never used (R11-m5)', async () => {
    const t = await triCounty();
    const dup = await t.dana.post(`/c/${t.cid}/resources`, { kind: 'truck', name: 'tank wagon 1' });
    expect(dup.status).toBe(400);
    expect(dup.body.error.details.fields.name).toBe('Name already used');
    const fresh = await t.dana.post(`/c/${t.cid}/resources`, { kind: 'truck', name: 'Spare pickup' });
    expect((await t.dana.del(`/c/${t.cid}/resources/${fresh.body.id}`)).status).toBe(200);
    await fuelJob(t, { trucks: [t.trucks['Tank wagon 1']] });
    expect((await t.dana.del(`/c/${t.cid}/resources/${t.trucks['Tank wagon 1']}`)).status).toBe(409);
    expect((await t.luis.del(`/c/${t.cid}/resources/${t.trucks['Tank wagon 2']}`)).status).toBe(403);
  });
});

describe('drivers are told what changed (R11-M2, R6-M1)', () => {
  it('a time, access or site change on an assigned job reaches the driver in plain words until they acknowledge it', async () => {
    const t = await triCounty();
    const j = await fuelJob(t, { start: inHours(3) });
    const later = new Date(new Date(j.scheduled_start).getTime() + 3600_000).toISOString();
    const r = await t.marcus.patch(`/c/${t.cid}/jobs/${j.id}`, { version: j.version, scheduledStart: later, accessInstructions: 'Use the north gate, code 2211' });
    expect(r.status).toBe(200);
    const text = await bell(t.luis, t.cid);
    // Same day: "Moved from 9:00 AM to 10:00 AM"; across midnight the day is named too.
    const at = '(?:\\w{3}, \\w{3} \\d+, )?\\d+:\\d\\d [AP]M';
    expect(text).toMatch(new RegExp(`Job #\\d+ changed: Moved from ${at} to ${at}`));
    expect(text).toContain('New access instructions: Use the north gate, code 2211');
    const mine = (await t.luis.get(`/c/${t.cid}/my/jobs`)).body.jobs.find((x: any) => x.id === j.id);
    // Still marked new (not opened yet), plus the two changes.
    expect(mine.driver_changes.lines).toEqual(['New job for you', expect.stringMatching(/^Moved from/), 'New access instructions: Use the north gate, code 2211']);
    expect((await t.luis.post(`/c/${t.cid}/jobs/${j.id}/seen-changes`)).status).toBe(200);
    expect((await t.luis.get(`/c/${t.cid}/my/jobs`)).body.jobs.find((x: any) => x.id === j.id).driver_changes).toBeNull();
    // Another driver can't clear it.
    expect((await t.sam.post(`/c/${t.cid}/jobs/${j.id}/seen-changes`)).status).toBe(404);
  });

  it('a new assignment is marked new; a cancellation tells the driver not to go', async () => {
    const t = await triCounty();
    const j = await fuelJob(t);
    expect(j.driver_changes).toMatchObject({ isNew: true, lines: ['New job for you'] });
    const r = await t.marcus.post(`/c/${t.cid}/jobs/${j.id}/status`, { to: 'cancelled', version: j.version, reason: 'Customer called' });
    expect(r.status).toBe(200);
    const n = (await t.luis.get(`/c/${t.cid}/notifications`)).body;
    expect(JSON.stringify(n)).toContain(`Job #${j.number} was cancelled: don't go`);
  });

  it('an emergency alerts dispatch at once, then the driver when assigned (D15)', async () => {
    const t = await triCounty();
    const j = await fuelJob(t, { priority: 'emergency', driver: null });
    expect(await bell(t.marcus, t.cid)).toContain(`Emergency job #${j.number}`);
    expect(await bell(t.dana, t.cid)).toContain('No driver yet. Assign one now.');
    await t.marcus.post(`/c/${t.cid}/jobs/${j.id}/assign`, { userId: t.ids.luis, resourceIds: [], version: j.version });
    expect(await bell(t.luis, t.cid)).toContain(`Emergency: job #${j.number}, Grace Okafor, 812 Willow Ln, Fairview`);
    expect((await t.dana.get(`/c/${t.cid}/overview`)).body.attention.some((x: any) => x.key === 'emergency')).toBe(true);
  });
});
