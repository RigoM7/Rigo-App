import { describe, it, expect, vi, afterEach } from 'vitest';
import { signup, newCompany } from './helpers.js';

// Step 9: demos. Any template opens as a demo; it starts empty and "Show sample data" fills it.
// Demos never send, charge, connect or call a paid service.

afterEach(() => vi.restoreAllMocks());

describe('demos', () => {
  it('opens any template empty, fills it on request, and never reaches a provider', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const v = await signup('Visitor');
    const d = await v.post('/demo', { templateKey: 'cleaning' });
    expect(d.status).toBe(200);
    const boot = (await v.get(`/c/${d.body.id}`)).body;
    expect(boot.workspace).toMatchObject({ kind: 'demo', name: 'Cleaning and home services demo' });
    expect(boot.words.work.one).toBe('Visit');
    expect((await v.get(`/c/${d.body.id}/work`)).body.items).toEqual([]);
    expect((await v.get(`/c/${d.body.id}/customers`)).body.customers).toEqual([]);
    expect((await v.post(`/c/${d.body.id}/demo/sample`)).status).toBe(200);
    const work = (await v.get(`/c/${d.body.id}/work`)).body.items;
    expect(work.length).toBe(7);
    const inbox = (await v.get(`/c/${d.body.id}/inbox`)).body;
    expect(inbox.approvals.some((a: any) => a.kind === 'invoice')).toBe(true);
    expect(inbox.approvals.some((a: any) => a.kind === 'message')).toBe(true);
    const msg = inbox.approvals.find((a: any) => a.kind === 'message');
    const sent = await v.post(`/c/${d.body.id}/inbox/${msg.id}/approve`, {});
    expect(sent.body.status).toBe('simulated');
    const money = (await v.get(`/c/${d.body.id}/money/summary`)).body;
    expect(money.owedMinor).toBeGreaterThan(0);
    // Sample data is once only, and only in demos.
    expect((await v.post(`/c/${d.body.id}/demo/sample`)).body.already).toBe(true);
    const real = await newCompany(v, 'cleaning', 'Real Co');
    expect((await v.post(`/c/${real}/demo/sample`)).status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a new demo replaces the old one; switching view shows the worker phone', async () => {
    const v = await signup('Visitor');
    const a = (await v.post('/demo', { templateKey: 'orders' })).body.id;
    const b = (await v.post('/demo', { templateKey: 'appointments' })).body.id;
    expect((await v.get(`/c/${a}`)).status).toBe(404);
    expect((await v.get('/auth/me')).body.companies.filter((c: any) => c.kind === 'demo').map((c: any) => c.id)).toEqual([b]);
    await v.post(`/c/${b}/demo/sample`);
    expect((await v.post(`/c/${b}/demo/view`, { role: 'specialist' })).status).toBe(200);
    const boot = (await v.get(`/c/${b}`)).body;
    expect(boot.role).toMatchObject({ app: 'worker', simulated: 'specialist' });
    const mine = (await v.get(`/c/${b}/my/work`)).body;
    expect(mine.today.length + mine.upcoming.length + mine.done.length).toBeGreaterThan(0);
    expect((await v.get(`/c/${b}/invoices`)).status).toBe(403);
    expect((await v.post(`/c/${b}/demo/view`, { role: 'owner' })).status).toBe(200);
    expect((await v.get(`/c/${b}`)).body.role.isOwner).toBe(true);
    // Someone else can't see or switch another person's demo.
    const other = await signup();
    expect((await other.get(`/c/${b}`)).status).toBe(404);
    expect((await other.post(`/c/${b}/demo/view`, { role: 'owner' })).status).toBe(404);
  });
});

describe('demos stay private (security review)', () => {
  it('an invitation from a demo can not be accepted, so nobody else joins or switches its view', async () => {
    const v = await signup('Visitor');
    const d = (await v.post('/demo', { templateKey: 'field_service' })).body.id;
    const other = await signup('Other');
    const inv = await v.post(`/c/${d}/invitations`, { email: other.email, role: 'dispatcher' });
    expect(inv.status).toBe(200);
    const tok = inv.body.link.split('/invite/')[1];
    expect((await other.post(`/invitations/${tok}/accept`)).status).toBe(409);
    expect((await other.get(`/c/${d}`)).status).toBe(404);
    expect((await other.post(`/c/${d}/demo/view`, { role: 'owner' })).status).toBe(404);
  });
});
