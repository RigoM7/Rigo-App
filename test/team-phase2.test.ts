import { describe, it, expect } from 'vitest';
import { triCounty } from './fixtures/tricounty.js';
import { signup } from './helpers.js';

// WP7: invitations, role changes and the activity log.

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

  it('records cancelled jobs and branding changes', async () => {
    const t = await triCounty();
    await t.dana.patch(`/c/${t.cid}/branding`, { accent: '#1D4ED8' });
    const all = (await t.dana.get(`/c/${t.cid}/activity?group=settings`)).body.entries;
    expect(all.some((e: any) => e.action === 'branding.updated')).toBe(true);
  });
});
