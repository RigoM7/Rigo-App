import { describe, it, expect } from 'vitest';
import { signup, newCompany, invite, Client, getDb } from './helpers.js';

describe('accounts, companies and isolation', () => {
  it('public signup does not grant access to any company', async () => {
    const owner = await signup('Owner');
    const cid = await newCompany(owner);
    const stranger = await signup('Stranger');
    const me = await stranger.get('/auth/me');
    expect(me.body.companies).toEqual([]);
    for (const p of [`/c/${cid}`, `/c/${cid}/work`, `/c/${cid}/customers`, `/c/${cid}/invoices`, `/c/${cid}/inbox`, `/c/${cid}/schedule?from=2030-01-01`]) {
      const r = await stranger.get(p);
      expect(r.status, p).toBe(404);
    }
    const anon = new Client('anon');
    expect((await anon.get(`/c/${cid}/work`)).status).toBe(401);
  });

  it('rejects state changes without the CSRF header', async () => {
    const res = await (await import('./helpers.js')).app.request('/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(403);
  });

  it('supports several companies, roles per company, and isolates records', async () => {
    const a = await signup('Alice');
    const b = await signup('Bob');
    const c1 = await newCompany(a, ['fuel'], 'Alpha Fuel');
    const c2 = await newCompany(b, ['septic'], 'Beta Septic');
    await invite(b, c2, a, 'driver');
    const me = await a.get('/auth/me');
    const roles = Object.fromEntries(me.body.companies.map((c: any) => [c.name, c.role_key]));
    expect(roles).toEqual({ 'Alpha Fuel': 'owner', 'Beta Septic': 'driver' });
    await a.post(`/c/${c1}/customers`, { name: 'Alpha only customer' });
    // Owning Alpha grants nothing in Beta: as a driver there, Alice cannot list customers.
    expect((await a.get(`/c/${c2}/customers`)).status).toBe(403);
    const bobView = await b.get(`/c/${c2}/customers`);
    expect(bobView.body.customers.find((x: any) => x.name === 'Alpha only customer')).toBeUndefined();
    // Using an id from another company is rejected.
    const alphaCust = (await a.get(`/c/${c1}/customers`)).body.customers[0].id;
    const r = await b.post(`/c/${c2}/work`, { clientId: alphaCust, title: 'Cross-company' });
    expect(r.status).toBe(400);
  });

  it('allows multiple owners and protects the last owner', async () => {
    const o1 = await signup('Owner One');
    const o2 = await signup('Owner Two');
    const cid = await newCompany(o1);
    const members = async () => (await o1.get(`/c/${cid}/members`)).body.members;
    const self = (await members()).find((m: any) => m.role_key === 'owner');
    const demote = await o1.patch(`/c/${cid}/members/${self.id}`, { role: 'dispatcher' });
    expect(demote.status).toBe(409);
    expect((await o1.del(`/c/${cid}/members/${self.id}`)).status).toBe(409);
    await invite(o1, cid, o2, 'owner');
    const second = (await members()).find((m: any) => m.name === 'Owner Two');
    expect(second.role_key).toBe('owner');
    expect((await o1.del(`/c/${cid}/members/${second.id}`)).status).toBe(200);
    expect((await o1.del(`/c/${cid}/members/${self.id}`)).status).toBe(409);
  });

  it('only owners can grant the owner role', async () => {
    const owner = await signup();
    const disp = await signup();
    const cid = await newCompany(owner);
    await owner.patch(`/c/${cid}/roles/dispatcher`, { permissions: ['members.view', 'members.invite', 'members.manage', 'work.view_all'] });
    await invite(owner, cid, disp, 'dispatcher');
    const r = await disp.post(`/c/${cid}/invitations`, { email: 'someone@example.test', role: 'owner' });
    expect(r.status).toBe(403);
    expect((await disp.post(`/c/${cid}/invitations`, { email: 'someone@example.test', role: 'driver' })).status).toBe(200);
  });
});

describe('invitations', () => {
  it('is single use, email bound, and handles revoke, replace and expiry', async () => {
    const owner = await signup();
    const cid = await newCompany(owner);
    const invitee = await signup();
    const wrong = await signup();
    const r = await owner.post(`/c/${cid}/invitations`, { email: invitee.email, role: 'dispatcher' });
    expect(r.status).toBe(200);
    expect(r.body.preview.subject).toContain('Test Co');
    const token = r.body.link.split('/invite/')[1];

    const peek = await wrong.get(`/invitations/${token}`);
    expect(peek.body).toMatchObject({ state: 'pending', emailMatches: false });
    expect(peek.body.emailHint).not.toContain(invitee.email.split('@')[0]);
    const wrongAccept = await wrong.post(`/invitations/${token}/accept`);
    expect(wrongAccept.status).toBe(403);
    expect(wrongAccept.body.error.message).toMatch(/Sign in with that email/);

    // Concurrent acceptance: exactly one succeeds in creating membership; the other sees it as done.
    const [x, y] = await Promise.all([invitee.post(`/invitations/${token}/accept`), invitee.post(`/invitations/${token}/accept`)]);
    expect([x.status, y.status].every((s) => s === 200)).toBe(true);
    const db = await getDb();
    const m = await db.query(`select count(*)::int n from rigo.memberships where company_id = $1`, [cid]);
    expect(m.rows[0].n).toBe(2);
    expect((await invitee.get(`/invitations/${token}`)).body.state).toBe('accepted');

    // Revoked
    const r2 = await owner.post(`/c/${cid}/invitations`, { email: 'later@example.test', role: 'driver' });
    await owner.post(`/c/${cid}/invitations/${r2.body.id}/revoke`);
    const later = new Client('later@example.test');
    await later.post('/auth/signup', { name: 'Later', email: 'later@example.test', password: 'correct-horse-battery' });
    expect((await later.post(`/invitations/${r2.body.link.split('/invite/')[1]}/accept`)).status).toBe(409);
    // Replaced via resend: old link stops working, new one works
    const r3 = await owner.post(`/c/${cid}/invitations`, { email: 'later@example.test', role: 'driver' });
    const r4 = await owner.post(`/c/${cid}/invitations/${r3.body.id}/resend`);
    expect((await later.post(`/invitations/${r3.body.link.split('/invite/')[1]}/accept`)).status).toBe(409);
    expect((await later.post(`/invitations/${r4.body.link.split('/invite/')[1]}/accept`)).status).toBe(200);
    // Expired
    const r5 = await owner.post(`/c/${cid}/invitations`, { email: 'exp@example.test', role: 'driver' });
    await db.query(`update rigo.invitations set expires_at = now() - interval '1 minute' where id = $1`, [r5.body.id]);
    const exp = new Client('exp@example.test');
    await exp.post('/auth/signup', { name: 'Exp', email: 'exp@example.test', password: 'correct-horse-battery' });
    expect((await exp.get(`/invitations/${r5.body.link.split('/invite/')[1]}`)).body.state).toBe('expired');
    expect((await exp.post(`/invitations/${r5.body.link.split('/invite/')[1]}/accept`)).status).toBe(409);
  });

  it('records a simulated email in the local mailbox, not a real send', async () => {
    const owner = await signup();
    const cid = await newCompany(owner);
    await owner.post(`/c/${cid}/invitations`, { email: 'mailbox@example.test', role: 'driver' });
    const mb = await owner.get('/auth/dev/mailbox');
    expect(mb.body.messages.some((m: any) => m.to_email === 'mailbox@example.test' && m.kind === 'invitation')).toBe(true);
  });
});
