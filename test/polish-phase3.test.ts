import { describe, it, expect } from 'vitest';
import { triCounty } from './fixtures/tricounty.js';
import { rid, processAll } from './helpers.js';
import { urgency } from '../src/server/modules/overview.js';

// WP17: "Needs you" by urgency (R18-m5) and Reschedule on unfinished visits (R6-m6).

describe('Reschedule (R6-m6)', () => {
  it('makes one follow-up job for the same customer, place and service, with the reason', async () => {
    const t = await triCounty();
    const c = t.customers.grace;
    const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, clientRequestId: rid() });
    const job = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
    expect((await t.dana.post(`/c/${t.cid}/jobs/${job.id}/follow-up`)).status).toBe(409);
    const a = await t.dana.post(`/c/${t.cid}/jobs/${job.id}/assign`, { userId: t.ids.luis, version: job.version });
    await t.luis.post(`/c/${t.cid}/jobs/${job.id}/complete`, { submissionId: rid(), baseVersion: a.body.version, outcome: 'unsuccessful', reasonCode: 'locked_gate', reason: '' });
    expect((await t.luis.post(`/c/${t.cid}/jobs/${job.id}/follow-up`)).status).toBe(403);
    const f = await t.marcus.post(`/c/${t.cid}/jobs/${job.id}/follow-up`);
    expect(f.status).toBe(200);
    expect(f.body.already).toBe(false);
    const nj = (await t.dana.get(`/c/${t.cid}/jobs/${f.body.id}`)).body.job;
    expect(nj).toMatchObject({ status: 'draft', customer_id: c.id, location_id: c.locationId, service_id: t.services.fuel.id });
    expect(nj.notes).toMatch(new RegExp(`^Follow-up to job #${job.number}\\. Last visit: Locked gate\\.`));
    expect((await t.marcus.post(`/c/${t.cid}/jobs/${job.id}/follow-up`)).body).toMatchObject({ id: f.body.id, already: true });
    // A workflow that drafts follow-ups doesn't make a second one.
    await processAll();
    const all = (await t.dana.get(`/c/${t.cid}/jobs?status=all`)).body.jobs.filter((x: any) => x.customer_name === 'Grace Okafor' && x.id !== job.id && x.status === 'draft');
    expect(all).toHaveLength(1);
  });
});

describe('Needs you (R18-m5)', () => {
  it('lists the most urgent first', async () => {
    expect(urgency('emergency')).toBeLessThan(urgency('approvals'));
    expect(urgency('approvals')).toBeLessThan(urgency('drafts'));
    expect(urgency('something-new')).toBeGreaterThan(urgency('drafts'));
    const t = await triCounty();
    const att = (await t.dana.get(`/c/${t.cid}/overview`)).body.attention.map((a: any) => a.key);
    expect([...att].sort((a, b) => urgency(a) - urgency(b))).toEqual(att);
  });
});
