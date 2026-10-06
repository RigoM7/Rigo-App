import { describe, it, expect } from 'vitest';
import { triCounty, type TriCounty } from './fixtures/tricounty.js';
import { rid, signup, getDb } from './helpers.js';

// Findings from the Phase 2 security review, each fixed with a test.

const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const inviterRole = (t: TriCounty) => t.dana.patch(`/c/${t.cid}/roles/dispatcher`, { permissions: ['members.view', 'members.invite', 'jobs.view_all', 'customers.view'] });

describe('invitations', () => {
  it('accepting from the invitations list needs a confirmed email; the link still works', async () => {
    const t = await triCounty();
    const squatter = await signup('Squatter');
    // The owner invites this address as an owner; someone registers it first without the link.
    const inv = await t.dana.post(`/c/${t.cid}/invitations`, { email: squatter.email, role: 'owner' });
    expect(inv.status).toBe(200);
    const me = (await squatter.get('/auth/me')).body;
    expect(me.invitations[0]).toMatchObject({ company_name: 'Tri-County Field Services', needsLink: true });
    const r = await squatter.post(`/me/invitations/${me.invitations[0].id}/accept`);
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/Open the invitation link you were sent/);
    // Once the address is confirmed, the list works; the link always does.
    await (await getDb()).query(`update rigo.users set email_verified_at = now() where lower(email) = lower($1)`, [squatter.email]);
    expect((await squatter.get('/auth/me')).body.invitations[0].needsLink).toBe(false);
    expect((await squatter.post(`/me/invitations/${me.invitations[0].id}/accept`)).status).toBe(200);
  });

  it('invitation links are shown only to owners and to whoever sent them; owner invitations are managed by owners', async () => {
    const t = await triCounty();
    await inviterRole(t);
    const owners = await t.dana.post(`/c/${t.cid}/invitations`, { email: 'partner@example.test', role: 'owner' });
    const danas = await t.dana.post(`/c/${t.cid}/invitations`, { email: 'driver1@example.test', role: 'driver' });
    const marcuss = await t.marcus.post(`/c/${t.cid}/invitations`, { email: 'driver2@example.test', role: 'driver' });
    expect([owners.status, danas.status, marcuss.status]).toEqual([200, 200, 200]);
    const seen = (await t.marcus.get(`/c/${t.cid}/members`)).body.invitations;
    const link = (e: string) => seen.find((i: any) => i.email === e && i.status === 'pending')?.link ?? null;
    expect([link('partner@example.test'), link('driver1@example.test'), link('driver2@example.test')]).toEqual([null, null, marcuss.body.link]);
    expect((await t.dana.get(`/c/${t.cid}/members`)).body.invitations.find((i: any) => i.email === 'partner@example.test').link).toBe(owners.body.link);
    // A non-owner can't replace or revoke an owner invitation.
    expect((await t.marcus.post(`/c/${t.cid}/invitations`, { email: 'partner@example.test', role: 'driver', replace: true })).status).toBe(403);
    expect((await t.marcus.post(`/c/${t.cid}/invitations/${owners.body.id}/revoke`)).status).toBe(403);
    expect((await t.dana.post(`/c/${t.cid}/invitations/${owners.body.id}/revoke`)).status).toBe(200);
  });

  it('delegations are listed only to people who can see the team', async () => {
    const t = await triCounty();
    expect((await t.luis.get(`/c/${t.cid}/delegations`)).status).toBe(403);
    expect((await t.dana.get(`/c/${t.cid}/delegations`)).status).toBe(200);
  });
});

describe('drivers and customer details', () => {
  it("a driver opening their job gets only the location fields marked for drivers", async () => {
    const t = await triCounty();
    await t.dana.patch(`/c/${t.cid}/settings`, { customFields: { customers: [], jobs: [], locations: [
      { key: 'gate_code', label: 'Gate code', type: 'text', driverVisible: true }, { key: 'account_no', label: 'Utility account', type: 'text' }] } });
    const c = t.customers.grace;
    await t.dana.patch(`/c/${t.cid}/locations/${c.locationId}`, { custom: { gate_code: '#4412', account_no: 'U-77' } });
    const job = (await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, intent: 'open', clientRequestId: rid() })).body;
    const j = (await t.dana.get(`/c/${t.cid}/jobs/${job.id}`)).body.job;
    await t.dana.post(`/c/${t.cid}/jobs/${job.id}/assign`, { userId: t.ids.luis, resourceIds: [], version: j.version });
    const mine = (await t.luis.get(`/c/${t.cid}/jobs/${job.id}`)).body;
    expect(mine.location.custom).toEqual({ gate_code: '#4412' });
    expect(mine.locationFields.map((f: any) => f.key)).toEqual(['gate_code']);
  });

  it('the duplicate check does not match on contact details for roles that cannot see them', async () => {
    const t = await triCounty();
    await t.dana.patch(`/c/${t.cid}/roles/driver`, { permissions: ['jobs.view_assigned', 'jobs.work', 'resources.view', 'customers.view'] });
    const probe = await t.luis.post(`/c/${t.cid}/customers/duplicates`, { name: 'Zed', phone: '(555) 201-0003', email: 'grace@example.test' });
    expect(probe.body.candidates).toEqual([]);
    // With contact access the same probe finds Grace.
    expect((await t.marcus.post(`/c/${t.cid}/customers/duplicates`, { name: 'Zed', phone: '(555) 201-0003' })).body.candidates.map((x: any) => x.name)).toEqual(['Grace Okafor']);
  });

  it("the job report never includes the photo of a customer's check", async () => {
    const t = await triCounty();
    const c = t.customers.grace;
    const job = (await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, intent: 'open', clientRequestId: rid() })).body;
    const j = (await t.dana.get(`/c/${t.cid}/jobs/${job.id}`)).body.job;
    const a = await t.dana.post(`/c/${t.cid}/jobs/${job.id}/assign`, { userId: t.ids.luis, resourceIds: [], version: j.version });
    const done = await t.luis.post(`/c/${t.cid}/jobs/${job.id}/complete`, { submissionId: rid(), baseVersion: a.body.version, outcome: 'completed', values: { delivered_qty: '50' }, photos: [photo],
      collected: { method: 'check', amountMinor: 20000, reference: '5521', photo } });
    expect(done.status).toBe(200);
    const files = (await t.dana.get(`/c/${t.cid}/jobs/${job.id}`)).body.files;
    expect(files.map((f: any) => [f.name.split('.')[0], f.payment_photo])).toEqual(expect.arrayContaining([['photo-1', false], ['check', true]]));
    const m = await t.priya.post(`/c/${t.cid}/jobs/${job.id}/report-message`, {});
    const body = (await t.priya.get(`/c/${t.cid}/messages`)).body.messages.find((x: any) => x.id === m.body.messageId).body;
    expect(body).toContain('1 photo was taken on site.');
  });
});
