import { describe, it, expect, vi, afterEach } from 'vitest';
import { signup, newCompany, invite, customer, services, processAll, rid, getDb } from './helpers.js';
import { generateForCompany } from '../src/server/modules/recurring.js';

afterEach(() => vi.restoreAllMocks());

describe('demo workspace', () => {
  it('is per visitor, isolated, resettable, and never calls external services', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const a = await signup('Visitor A');
    const b = await signup('Visitor B');
    const da = (await a.post('/demo')).body.id;
    const db_ = (await b.post('/demo')).body.id;
    expect(da).not.toBe(db_);
    expect((await a.post('/demo')).body.id).toBe(da);
    expect((await b.get(`/c/${da}`)).status).toBe(404);
    const boot = (await a.get(`/c/${da}`)).body;
    expect(boot.company.kind).toBe('demo');
    expect(boot.capabilities.email.state).toBe('simulated');
    expect(boot.capabilities.ai.state).toBe('simulated');

    // Approve the seeded invoice and run the send step: it is simulated, not sent.
    await a.patch(`/c/${da}/automation`, { mode: 'automatic' });
    const ap = (await a.get(`/c/${da}/approvals`)).body.approvals[0];
    expect(ap).toBeTruthy();
    await a.post(`/c/${da}/approvals/${ap.id}/decide`, { decision: 'approve' });
    await processAll();
    const msgs = (await a.get(`/c/${da}/messages`)).body.messages;
    expect(msgs.some((m: any) => m.status === 'simulated')).toBe(true);
    expect(msgs.some((m: any) => m.status === 'sent' || m.status === 'delivered')).toBe(false);
    // Assistant uses prepared responses only.
    const reply = await a.post(`/c/${da}/assistant`, { text: 'What needs my attention?' });
    expect(reply.body.message.source).toBe('prepared');
    expect(fetchSpy).not.toHaveBeenCalled();

    // Simulated role switching only changes the view inside the demo.
    await a.post(`/c/${da}/demo/role`, { role: 'driver' });
    const asDriver = (await a.get(`/c/${da}`)).body;
    expect(asDriver.role).toMatchObject({ key: 'driver', simulated: 'driver' });
    expect((await a.get(`/c/${da}/invoices`)).status).toBe(403);
    const myJobs = (await a.get(`/c/${da}/my/jobs`)).body.jobs;
    expect(myJobs.length).toBeGreaterThan(0);
    await a.post(`/c/${da}/demo/role`, { role: 'owner' });

    // Reset gives a fresh copy at the same address, so saved links keep working.
    await a.post(`/c/${da}/customers`, { name: 'Added during demo' });
    const reset = (await a.post(`/c/${da}/demo/reset`)).body.id;
    expect(reset).toBe(da);
    const custs = (await a.get(`/c/${reset}/customers`)).body.customers.map((c: any) => c.name);
    expect(custs).not.toContain('Added during demo');
    // Still isolated: the other visitor cannot open it.
    expect((await b.get(`/c/${da}`)).status).toBe(404);
  });

  it('creating a company from the demo copies structure only', async () => {
    const a = await signup('Converter');
    const demo = (await a.post('/demo')).body.id;
    const r = await a.post(`/c/${demo}/demo/convert`, { name: 'My Real Co', timezone: 'America/Chicago', currency: 'USD', categories: ['fuel'] });
    expect(r.status).toBe(200);
    const real = r.body.id;
    const boot = (await a.get(`/c/${real}`)).body;
    expect(boot.company.kind).toBe('real');
    expect((await a.get(`/c/${real}/customers`)).body.customers).toHaveLength(0);
    expect((await a.get(`/c/${real}/jobs`)).body.jobs).toHaveLength(0);
    expect((await a.get(`/c/${real}/invoices`)).body.invoices).toHaveLength(0);
    expect((await a.get(`/c/${real}/resources`)).body.resources).toHaveLength(0);
    const svcs = (await a.get(`/c/${real}/services`)).body.services;
    expect(svcs.length).toBe(3);
    // Fictional demo rates are not copied.
    expect(svcs.every((s: any) => s.pricing.every((p: any) => p.rateMinor === null))).toBe(true);
    const wfs = (await a.get(`/c/${real}/workflows`)).body.workflows;
    expect(wfs.length).toBeGreaterThan(0);
    expect(wfs.every((w: any) => w.active_version_id === null)).toBe(true);
    const members = (await a.get(`/c/${real}/members`)).body.members;
    expect(members).toHaveLength(1);
  });

  it('a real company with no email service blocks sending instead of pretending', async () => {
    const owner = await signup();
    const cid = await newCompany(owner);
    expect((await owner.get(`/c/${cid}`)).body.capabilities.email.state).toBe('disabled');
    expect((await owner.get(`/c/${cid}`)).body.capabilities.payments.state).toBe('disabled');
  });
});

describe('recurring service and rentals', () => {
  it('generates visits once, separates billing, and handles pauses', async () => {
    const owner = await signup();
    const cid = await newCompany(owner);
    const { customerId, locationId } = await customer(owner, cid);
    const svcs = await services(owner, cid);
    const today = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
    const r = await owner.post(`/c/${cid}/recurring`, {
      name: 'Site rental', kind: 'rental', customerId, locationId, serviceId: svcs.portable_toilet.id, units: 4,
      visitRule: { frequency: 'weekly', interval: 1, weekdays: [1, 4], time: '07:00', durationMinutes: 60 },
      billingRule: { frequency: 'monthly', rateMinor: 9000, description: 'Unit rental' }, startsOn: start, details: { visit_type: 'Service' },
    });
    expect(r.status).toBe(200);
    const db = await getDb();
    const count = async () => (await db.query(`select count(*)::int n from rigo.plan_occurrences where plan_id = $1`, [r.body.id])).rows[0].n;
    const n1 = await count();
    expect(n1).toBeGreaterThan(0);
    await generateForCompany(db, cid);
    await generateForCompany(db, cid);
    expect(await count()).toBe(n1);
    const inv = (await owner.get(`/c/${cid}/recurring/${r.body.id}`)).body.invoices;
    expect(inv.length).toBeGreaterThanOrEqual(1);
    expect(inv[0].total_minor).toBe(36000);
    const invCount = inv.length;
    await generateForCompany(db, cid);
    expect((await owner.get(`/c/${cid}/recurring/${r.body.id}`)).body.invoices.length).toBe(invCount);
    const p = await owner.post(`/c/${cid}/recurring/${r.body.id}/pause`, { from: today, until: null });
    expect(p.status).toBe(200);
    const open = await db.query(`select count(*)::int n from rigo.jobs where recurring_plan_id = $1 and status = 'open' and scheduled_start::date >= $2::date + 1`, [r.body.id, today]);
    expect(open.rows[0].n).toBe(0);
  });
});

describe('rentals billed every 28 days', () => {
  it('counts periods from the plan start in company time, never doubles invoices, and skips paused periods', async () => {
    const owner = await signup();
    const cid = await newCompany(owner);
    const { customerId, locationId } = await customer(owner, cid);
    const svcs = await services(owner, cid);
    const db = await getDb();
    const r = await owner.post(`/c/${cid}/recurring`, {
      name: 'Event rental', kind: 'rental', customerId, locationId, serviceId: svcs.portable_toilet.id, units: 3,
      visitRule: { frequency: 'weekly', interval: 1, weekdays: [5], time: '07:00', durationMinutes: 60 },
      billingRule: { frequency: 'every_n_days', everyDays: 28, rateMinor: 12500, description: 'Unit rental' }, startsOn: '2030-01-23', details: { visit_type: 'Service' },
    });
    expect(r.status).toBe(200);
    const lines = async () => (await db.query<any>(`select l.description, i.total_minor from rigo.invoice_lines l join rigo.invoices i on i.id = l.invoice_id where i.recurring_plan_id = $1 order by l.description`, [r.body.id])).rows;
    // Generation runs as if it were a later date (the HTTP calls above and below use the real clock).
    const runAt = async (iso: string) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(iso));
      try { await generateForCompany(db, cid); await generateForCompany(db, cid); } finally { vi.useRealTimers(); }
    };
    // 9 PM in Chicago on March 19 is already March 20 in UTC: the company's date decides. Periods cross
    // the February month end and the March 10 daylight-saving change.
    await runAt('2030-03-20T02:00:00.000Z');
    expect(await lines()).toEqual([
      { description: 'Unit rental 2030-01-23 to 2030-02-19', total_minor: 37500 },
      { description: 'Unit rental 2030-02-20 to 2030-03-19', total_minor: 37500 },
    ]);
    await runAt('2030-03-20T04:30:00.000Z'); // 11:30 PM on March 19 in Chicago
    expect(await lines()).toHaveLength(2);
    await runAt('2030-03-20T06:00:00.000Z'); // March 20 in Chicago: the third period starts, exactly once
    expect((await lines()).map((l: any) => l.description)).toEqual(['Unit rental 2030-01-23 to 2030-02-19', 'Unit rental 2030-02-20 to 2030-03-19', 'Unit rental 2030-03-20 to 2030-04-16']);
    // A pause covering a whole period bills nothing for it; billing picks up after the pause.
    expect((await owner.post(`/c/${cid}/recurring/${r.body.id}/pause`, { from: '2030-04-10', until: '2030-05-20' })).status).toBe(200);
    await runAt('2030-04-20T15:00:00.000Z');
    expect(await lines()).toHaveLength(3);
    await runAt('2030-05-16T15:00:00.000Z');
    expect((await lines()).map((l: any) => l.description).at(-1)).toBe('Unit rental 2030-05-15 to 2030-06-11');
    expect(await lines()).toHaveLength(4);
    // The plan form names it plainly.
    const plan = (await owner.get(`/c/${cid}/recurring/${r.body.id}`)).body.plan;
    expect(plan.billing_rule).toMatchObject({ frequency: 'every_n_days', everyDays: 28 });
  });
});

describe('imports', () => {
  it('maps, reviews duplicates and ambiguity, and commits only on confirmation', async () => {
    const owner = await signup();
    const cid = await newCompany(owner);
    await owner.post(`/c/${cid}/customers`, { name: 'Existing Co', email: 'existing@example.test' });
    await owner.post(`/c/${cid}/customers`, { name: 'Twin' });
    await owner.post(`/c/${cid}/customers`, { name: 'Twin' });
    const csv = 'Customer Name,Email,Phone,Service Address\nNew One,new@example.test,555,1 A St\nExisting Co,existing@example.test,,2 B St\nTwin,,,3 C St\nNew One,new@example.test,555,9 Second Site\n,bad,,\n';
    const up = await owner.post(`/c/${cid}/imports`, { kind: 'customers', fileName: 'c.csv', text: csv });
    expect(up.status).toBe(200);
    expect(up.body.mapping).toMatchObject({ name: 'Customer Name', email: 'Email', phone: 'Phone', address: 'Service Address' });
    expect((await owner.post(`/c/${cid}/imports/${up.body.id}/commit`, { confirm: true })).status).toBe(409);
    const rv = await owner.post(`/c/${cid}/imports/${up.body.id}/review`, { mapping: up.body.mapping });
    expect(rv.body.summary).toMatchObject({ total: 5, create: 2, addLocation: 1, errors: 1 });
    expect(rv.body.rows[2].warnings.join(' ')).toMatch(/Ambiguous/);
    const commit = await owner.post(`/c/${cid}/imports/${up.body.id}/commit`, { confirm: true });
    expect(commit.body.result).toMatchObject({ customers: 2, locations: 3 });
    expect((await owner.post(`/c/${cid}/imports/${up.body.id}/commit`, { confirm: true })).body.already).toBe(true);
    const wfs = (await owner.get(`/c/${cid}/workflows`)).body.workflows;
    expect(wfs.every((w: any) => w.active_version_id === null)).toBe(true);
    const xl = await owner.post(`/c/${cid}/imports`, { kind: 'customers', fileName: 'c.xlsx', text: 'x' });
    expect(xl.status).toBe(400);
  });
});

describe('templates', () => {
  it('shares structure only and applies as drafts that do not follow upstream edits', async () => {
    const a = await signup('Author');
    const b = await signup('Receiver');
    const ca = await newCompany(a, ['fuel'], 'Author Co');
    const cb = await newCompany(b, [], 'Receiver Co');
    await a.post(`/c/${ca}/customers`, { name: 'Private customer' });
    const t = await a.post(`/c/${ca}/templates`, { name: 'Author fuel', visibility: 'shared', shareWith: [b.email] });
    expect(t.status).toBe(200);
    const visible = (await b.get(`/c/${cb}/templates`)).body.templates;
    expect(visible.map((x: any) => x.name)).toContain('Author fuel');
    const detail = (await b.get(`/c/${cb}/templates/${t.body.id}`)).body.template;
    expect(JSON.stringify(detail.content)).not.toContain('Private customer');
    const applied = await b.post(`/c/${cb}/templates/${t.body.id}/apply`, { confirm: true });
    expect(applied.body.summary.services).toBe(1);
    const wfs = (await b.get(`/c/${cb}/workflows`)).body.workflows;
    expect(wfs.every((w: any) => w.active_version_id === null)).toBe(true);
    await a.patch(`/c/${ca}/templates/${t.body.id}`, { name: 'Renamed', refreshFromCompany: true });
    expect((await b.get(`/c/${cb}/services`)).body.services).toHaveLength(1);
    const stranger = await signup();
    const cs = await newCompany(stranger);
    expect((await stranger.get(`/c/${cs}/templates/${t.body.id}`)).status).toBe(404);
  });
});

describe('assistant', () => {
  it('labels prepared answers and keeps workflow proposals out of active config', async () => {
    const owner = await signup();
    const cid = await newCompany(owner);
    const r = await owner.post(`/c/${cid}/assistant`, { text: 'When a fuel job is completed, prepare an invoice, ask me to approve it, then email the customer' });
    expect(r.body.message.source).toBe('prepared');
    const p = r.body.message.proposal;
    expect(p.state).toBe('proposed');
    expect(p.validation.ok).toBe(true);
    const wfs = (await owner.get(`/c/${cid}/workflows`)).body.workflows;
    const created = wfs.find((w: any) => w.id === p.workflowId);
    expect(created.active_version_id).toBeNull();
    expect(created.latest_id).toBeNull(); // only a proposal exists until accepted
    const acc = await owner.post(`/c/${cid}/workflows/proposals/${p.versionId}/accept`);
    expect(acc.status).toBe(200);
  });

  it('drivers get answers only from their own data', async () => {
    const owner = await signup();
    const driver = await signup();
    const cid = await newCompany(owner);
    await invite(owner, cid, driver, 'driver');
    const r = await driver.post(`/c/${cid}/assistant`, { text: 'What needs my attention?' });
    expect(r.body.message.content).not.toMatch(/Invoices on hold/);
    const wf = await driver.post(`/c/${cid}/assistant`, { text: 'When a job is completed prepare an invoice' });
    expect(wf.body.message.content).toMatch(/permission/);
    void rid;
  });
});
