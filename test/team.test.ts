import { describe, it, expect } from 'vitest';
import { team as triCounty, type Team as TriCounty } from './fixtures/team.js';
import { signup, getDb } from './helpers.js';

// People and roles: invitations, role changes, owner-built roles and the activity log. Kept from the
// earlier app (WP7 and the Phase 2 security review) and extended for owner-built roles.

const inviterRole = (t: TriCounty) => t.dana.patch(`/c/${t.cid}/roles/dispatcher`, { permissions: ['members.view', 'members.invite', 'work.view_all', 'customers.view'] });

describe('invitations (R4-M1, R4-m2, R4-m7)', () => {
  it('asks before replacing a pending invitation, says it was not emailed, and keeps the link copyable until used', async () => {
    const t = await triCounty();
    const first = await t.dana.post(`/c/${t.cid}/invitations`, { email: 'newhire@example.test', role: 'dispatcher' });
    expect(first.status).toBe(200);
    // No email service here: the answer and the list say so.
    expect(first.body.delivery.how).toMatch(/^(mailbox|not_sent)$/);
    const again = await t.dana.post(`/c/${t.cid}/invitations`, { email: 'NewHire@example.test', role: 'driver' });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe('newhire@example.test already has a pending invitation as Dispatcher. Replace it with Driver?');
    let list = (await t.dana.get(`/c/${t.cid}/members`)).body.invitations;
    const pending = list.find((i: any) => i.email === 'newhire@example.test' && i.status === 'pending');
    expect(pending.role_name).toBe('Dispatcher');
    // "Copy link" gives the same link that was created; it still works.
    expect(pending.link).toBe(first.body.link);
    const replaced = await t.dana.post(`/c/${t.cid}/invitations`, { email: 'newhire@example.test', role: 'driver', replace: true });
    expect(replaced.status).toBe(200);
    list = (await t.dana.get(`/c/${t.cid}/members`)).body.invitations;
    expect(list.filter((i: any) => i.email === 'newhire@example.test' && i.status === 'pending').map((i: any) => i.role_name)).toEqual(['Driver']);
    // The old link no longer works; the person signing up with it gets their address prefilled from the new one.
    const oldTok = first.body.link.split('/invite/')[1];
    expect((await (await signup('X')).get(`/invitations/${oldTok}`)).body.state).toBe('replaced');
    const anon = await (await import('./helpers.js')).app.request(`/api/invitations/${replaced.body.link.split('/invite/')[1]}`);
    expect((await anon.json()).email).toBe('newhire@example.test');
    // A driver can't see invitation links.
    expect((await t.luis.get(`/c/${t.cid}/members`)).status).toBe(403);
  });

  it('invites several people at once and reports each', async () => {
    const t = await triCounty();
    const r = await t.dana.post(`/c/${t.cid}/invitations/bulk`, { emails: 'a1@example.test, a2@example.test\nnot-an-email\na1@example.test', role: 'driver' });
    expect(r.status).toBe(200);
    expect(r.body.results.map((x: any) => [x.email, x.ok])).toEqual([['a1@example.test', true], ['a2@example.test', true], ['not-an-email', false]]);
    expect(r.body.results[0].link).toContain('/invite/');
    expect((await t.marcus.post(`/c/${t.cid}/invitations/bulk`, { emails: 'b@example.test', role: 'driver' })).status).toBe(403);
  });
});

describe('roles and the activity log (R4-M2, R12-m2)', () => {
  it('making someone an owner needs a deliberate confirmation, and is in the activity log', async () => {
    const t = await triCounty();
    const priya = (await t.dana.get(`/c/${t.cid}/members`)).body.members.find((m: any) => m.user_id === t.ids.priya);
    const ask = await t.dana.patch(`/c/${t.cid}/members/${priya.id}`, { role: 'owner' });
    expect(ask.status).toBe(409);
    expect(ask.body.error.details.needsConfirm).toBe('owner');
    expect((await t.dana.patch(`/c/${t.cid}/members/${priya.id}`, { role: 'owner', confirmOwner: true })).status).toBe(200);
    // Ordinary role changes need no typed confirmation.
    const luis = (await t.dana.get(`/c/${t.cid}/members`)).body.members.find((m: any) => m.user_id === t.ids.luis);
    expect((await t.dana.patch(`/c/${t.cid}/members/${luis.id}`, { role: 'dispatcher' })).status).toBe(200);
    const log = (await t.dana.get(`/c/${t.cid}/activity?group=people`)).body.entries;
    expect(log.some((e: any) => e.action === 'member.role_changed' && e.detail.to === 'owner' && e.actor === 'Dana')).toBe(true);
    expect(log.every((e: any) => /^(member|invitation|role|approval)/.test(e.action))).toBe(true);
    // Only owners see it: Marcus (dispatcher) doesn't, Priya (now an owner) does.
    expect((await t.marcus.get(`/c/${t.cid}/activity`)).status).toBe(403);
    expect((await t.priya.get(`/c/${t.cid}/activity`)).status).toBe(200);
  });

  it('records changes to the words in the activity log', async () => {
    const t = await triCounty();
    const words = (await t.dana.get(`/c/${t.cid}`)).body.words;
    expect((await t.dana.put(`/c/${t.cid}/words`, { words: { ...words, work: { one: 'Delivery', many: 'Deliveries' } } })).status).toBe(200);
    const all = (await t.dana.get(`/c/${t.cid}/activity?group=settings`)).body.entries;
    expect(all.some((e: any) => e.action === 'words.updated')).toBe(true);
  });
});

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
});

describe('removed members (kept from the field-filtering review)', () => {
  it('only members removed in the last 7 days are told they were removed; earlier ones get "not found"', async () => {
    const t = await triCounty();
    const tyler = (await t.dana.get(`/c/${t.cid}/members`)).body.members.find((m: any) => m.user_id === t.ids.tyler);
    await t.dana.del(`/c/${t.cid}/members/${tyler.id}`);
    expect((await t.tyler.get(`/c/${t.cid}`)).body.error.code).toBe('not_member');
    await (await getDb()).query(`update rigo.memberships set removed_at = now() - interval '8 days' where id = $1`, [tyler.id]);
    expect((await t.tyler.get(`/c/${t.cid}`)).status).toBe(404);
  });
});

describe('owner-built roles', () => {
  it('owners add, rename, change and remove roles; the Owner role always exists', async () => {
    const t = await triCounty();
    const add = await t.dana.post(`/c/${t.cid}/roles`, { name: 'Yard crew', app: 'worker', permissions: ['work.view_assigned', 'work.do'] });
    expect(add.status).toBe(200);
    expect(add.body.key).toBe('yard_crew');
    // Same name twice is refused.
    expect((await t.dana.post(`/c/${t.cid}/roles`, { name: 'yard crew', app: 'worker', permissions: [] })).status).toBe(409);
    expect((await t.dana.patch(`/c/${t.cid}/roles/yard_crew`, { name: 'Yard team' })).status).toBe(200);
    let roles = (await t.dana.get(`/c/${t.cid}/roles`)).body.roles;
    expect(roles.find((r: any) => r.key === 'yard_crew').name).toBe('Yard team');
    // The Owner role can't lose permissions, be removed, or be added again.
    expect((await t.dana.patch(`/c/${t.cid}/roles/owner`, { permissions: [] })).status).toBe(400);
    expect((await t.dana.del(`/c/${t.cid}/roles/owner`)).status).toBe(400);
    expect(roles.find((r: any) => r.key === 'owner').permissions.length).toBeGreaterThan(20);
    // A role with people in it can't be removed; an empty one can.
    expect((await t.dana.del(`/c/${t.cid}/roles/driver`)).status).toBe(409);
    expect((await t.dana.del(`/c/${t.cid}/roles/yard_crew`)).status).toBe(200);
    roles = (await t.dana.get(`/c/${t.cid}/roles`)).body.roles;
    expect(roles.some((r: any) => r.key === 'yard_crew')).toBe(false);
    const log = (await t.dana.get(`/c/${t.cid}/activity?group=people`)).body.entries.map((e: any) => e.action);
    expect(log).toEqual(expect.arrayContaining(['role.created', 'role.updated', 'role.removed']));
  });

  it('only owners change roles, even with the roles permission', async () => {
    const t = await triCounty();
    await t.dana.patch(`/c/${t.cid}/roles/dispatcher`, { permissions: ['members.view', 'roles.manage', 'work.view_all'] });
    expect((await t.marcus.post(`/c/${t.cid}/roles`, { name: 'Helper', app: 'office', permissions: [] })).status).toBe(403);
    expect((await t.marcus.patch(`/c/${t.cid}/roles/driver`, { permissions: ['work.view_all'] })).status).toBe(403);
    expect((await t.luis.get(`/c/${t.cid}/roles`)).status).toBe(403);
    const other = await signup('Other');
    expect((await other.get(`/c/${t.cid}/roles`)).status).toBe(404);
    expect((await other.post(`/c/${t.cid}/roles`, { name: 'Sneaky', app: 'office', permissions: [] })).status).toBe(404);
  });

  it('worker-app roles get only what the worker screens use, whatever else is ticked', async () => {
    const t = await triCounty();
    expect((await t.dana.patch(`/c/${t.cid}/roles/driver`, { permissions: ['work.view_assigned', 'work.do', 'money.view', 'members.manage', 'invoices.approve'] })).status).toBe(200);
    const driver = (await t.dana.get(`/c/${t.cid}/roles`)).body.roles.find((r: any) => r.key === 'driver');
    expect(driver.permissions.sort()).toEqual(['money.view', 'work.do', 'work.view_assigned']);
    const boot = (await t.luis.get(`/c/${t.cid}`)).body;
    expect(boot.role.app).toBe('worker');
    expect(boot.permissions).not.toContain('members.manage');
    expect((await t.luis.get(`/c/${t.cid}/members`)).status).toBe(403);
  });
});
