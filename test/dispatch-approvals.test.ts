import { describe, it, expect } from 'vitest';
import { signup, newCompany, invite, customer, services, activateAll, processAll, rid } from './helpers.js';
import { starterService } from '../src/shared/services.js';
import { isLate, comparePriority } from '../src/shared/jobs.js';

async function setup() {
  const owner = await signup('Owner');
  const driver = await signup('Driver');
  const dispatcher = await signup('Dispatcher');
  const cid = await newCompany(owner);
  await invite(owner, cid, driver, 'driver');
  await invite(owner, cid, dispatcher, 'dispatcher');
  const svcs = await services(owner, cid);
  const def = starterService('fuel');
  for (const p of def.pricing) if (p.when?.field === 'product') p.rateMinor = p.when.equals === 'Gasoline' ? 389 : 419;
  def.pricing.push({ id: 'delivery', label: 'Delivery fee', basis: 'flat', quantityField: '', unit: '', rateMinor: 4500, taxable: false, when: null });
  await owner.put(`/c/${cid}/services/${svcs.fuel.id}`, { service: def, version: svcs.fuel.version });
  await activateAll(owner, cid);
  const { customerId, locationId } = await customer(owner, cid);
  const driverId = (await driver.get('/auth/me')).body.user.id;
  return { owner, driver, dispatcher, cid, fuel: (await services(owner, cid)).fuel, customerId, locationId, driverId };
}
type S = Awaited<ReturnType<typeof setup>>;

async function job(s: S, o: { start: string; end?: string; priority?: string; product?: string; assign?: boolean; requested?: string }) {
  const r = await s.owner.post(`/c/${s.cid}/jobs`, { customerId: s.customerId, locationId: s.locationId, serviceId: s.fuel.id, details: { product: o.product ?? 'Gasoline', requested_qty: o.requested ?? '200' }, intent: 'open', clientRequestId: rid(), scheduledStart: o.start, scheduledEnd: o.end, priority: o.priority });
  expect(r.status).toBe(200);
  let j = (await s.owner.get(`/c/${s.cid}/jobs/${r.body.id}`)).body.job;
  if (o.assign) {
    const a = await s.owner.post(`/c/${s.cid}/jobs/${j.id}/assign`, { userId: s.driverId, resourceIds: [], version: j.version });
    expect(a.status).toBe(200);
    j = (await s.owner.get(`/c/${s.cid}/jobs/${r.body.id}`)).body.job;
  }
  return j;
}

describe('job priority', () => {
  it('is saved, filtered, sorted first within a day, and shown to the assigned driver', async () => {
    const s = await setup();
    const normal = await job(s, { start: '2030-03-04T14:00:00.000Z', assign: true });
    const urgent = await job(s, { start: '2030-03-04T20:00:00.000Z', priority: 'urgent' });
    const emergency = await job(s, { start: '2030-03-04T22:00:00.000Z', priority: 'emergency', assign: true });
    const nextDay = await job(s, { start: '2030-03-05T14:00:00.000Z', priority: 'emergency' });
    expect([normal.priority, urgent.priority, emergency.priority]).toEqual(['normal', 'urgent', 'emergency']);
    // Within a day (company time zone) emergencies, then urgent jobs, then by time; days stay in order.
    const all = (await s.owner.get(`/c/${s.cid}/jobs?status=all`)).body.jobs.map((j: any) => j.number);
    expect(all).toEqual([emergency.number, urgent.number, normal.number, nextDay.number]);
    const high = (await s.owner.get(`/c/${s.cid}/jobs?status=all&priority=high`)).body.jobs.map((j: any) => j.number);
    expect(high.sort()).toEqual([urgent.number, emergency.number, nextDay.number].sort());
    expect((await s.owner.get(`/c/${s.cid}/jobs?status=all&priority=emergency`)).body.jobs).toHaveLength(2);
    // Other sorts and searches still work (the time zone is only used by the schedule order).
    for (const sort of ['updated', 'number', 'customer']) expect((await s.owner.get(`/c/${s.cid}/jobs?status=all&sort=${sort}&q=${urgent.number}`)).status).toBe(200);
    // Editing keeps or changes it; other edits leave it alone.
    const e1 = await s.owner.patch(`/c/${s.cid}/jobs/${normal.id}`, { notes: 'Gate code changed', version: normal.version });
    expect(e1.status).toBe(200);
    expect((await s.owner.get(`/c/${s.cid}/jobs/${normal.id}`)).body.job.priority).toBe('normal');
    const e2 = await s.owner.patch(`/c/${s.cid}/jobs/${normal.id}`, { priority: 'urgent', version: e1.body.version });
    expect(e2.status).toBe(200);
    expect((await s.owner.get(`/c/${s.cid}/jobs/${normal.id}`)).body.job.priority).toBe('urgent');
    expect((await s.owner.post(`/c/${s.cid}/jobs`, { intent: 'draft', clientRequestId: rid(), priority: 'whenever' })).status).toBe(400);
    // The driver sees the priority on their own jobs, and still cannot change it or see other jobs.
    const mine = (await s.driver.get(`/c/${s.cid}/my/jobs`)).body.jobs;
    expect(mine.map((j: any) => [j.number, j.priority])).toEqual([[emergency.number, 'emergency'], [normal.number, 'urgent']]);
    expect((await s.driver.patch(`/c/${s.cid}/jobs/${emergency.id}`, { priority: 'normal', version: emergency.version })).status).toBe(403);
    expect((await s.driver.get(`/c/${s.cid}/jobs/${urgent.id}`)).status).toBe(404);
  });

  it('counts unassigned urgent or emergency jobs in Needs you, and workflows can test priority', async () => {
    const s = await setup();
    const soon = new Date(Date.now() + 3600_000).toISOString();
    await job(s, { start: soon, priority: 'emergency' });
    await job(s, { start: soon, priority: 'urgent', assign: true });
    await job(s, { start: new Date(Date.now() + 4 * 86400_000).toISOString(), priority: 'urgent' });
    const att = (await s.owner.get(`/c/${s.cid}/overview`)).body.attention;
    expect(att.find((a: any) => a.key === 'urgent')).toMatchObject({ count: 2, link: 'jobs?assignee=none&priority=high' });
    const { CONDITION_FIELDS } = await import('../src/shared/workflows.js');
    expect(CONDITION_FIELDS['job.priority']).toMatchObject({ type: 'select', options: ['normal', 'urgent', 'emergency'] });
  });
});

describe('late jobs', () => {
  it('flags open jobs whose window ended without a start, and counts them in Needs you', async () => {
    const now = Date.parse('2030-03-04T16:17:00.000Z');
    expect(isLate({ status: 'open', scheduled_start: '2030-03-04T14:00:00.000Z', scheduled_end: '2030-03-04T15:00:00.000Z' }, now)).toBe(true);
    expect(isLate({ status: 'in_progress', scheduled_start: '2030-03-04T14:00:00.000Z', scheduled_end: '2030-03-04T15:00:00.000Z' }, now)).toBe(false);
    expect(isLate({ status: 'open', scheduled_start: '2030-03-04T15:30:00.000Z', scheduled_end: null }, now)).toBe(false); // one-hour default window
    expect(isLate({ status: 'open', scheduled_start: '2030-03-04T15:00:00.000Z', scheduled_end: null }, now)).toBe(true);
    expect(isLate({ status: 'open', scheduled_start: null, scheduled_end: null }, now)).toBe(false);
    expect(comparePriority('emergency', 'urgent')).toBeLessThan(0);

    const s = await setup();
    const past = await job(s, { start: new Date(Date.now() - 3 * 3600_000).toISOString(), end: new Date(Date.now() - 2 * 3600_000).toISOString(), assign: true });
    await job(s, { start: new Date(Date.now() + 3600_000).toISOString(), assign: true });
    const late = (await s.owner.get(`/c/${s.cid}/jobs?late=1`)).body.jobs;
    expect(late.map((j: any) => j.id)).toEqual([past.id]);
    expect((await s.owner.get(`/c/${s.cid}/overview`)).body.attention.find((a: any) => a.key === 'late')).toMatchObject({ count: 1, label: 'Jobs running late' });
    // Once the driver starts it, it is no longer late.
    const st = await s.driver.post(`/c/${s.cid}/jobs/${past.id}/start`, { version: past.version });
    expect(st.status).toBe(200);
    expect((await s.owner.get(`/c/${s.cid}/jobs?late=1`)).body.jobs).toHaveLength(0);
  });
});

describe('approval summaries', () => {
  async function completed(s: S) {
    const j = await job(s, { start: new Date(Date.now() + 3600_000).toISOString(), assign: true, product: 'Gasoline', requested: '200' });
    const r = await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, { submissionId: rid(), baseVersion: j.version, outcome: 'completed', values: { delivered_qty: '187.4' } });
    expect(r.status).toBe(200);
    await processAll();
    return j;
  }

  it('shows approvers with finance access the invoice they are approving, from the stored totals', async () => {
    const s = await setup();
    const j = await completed(s);
    const ap = (await s.owner.get(`/c/${s.cid}/approvals`)).body.approvals.find((a: any) => a.subject_type === 'invoice');
    expect(ap).toBeTruthy();
    const inv = (await s.owner.get(`/c/${s.cid}/invoices/${ap.subject_id}`)).body.invoice;
    expect(ap.summary).toMatchObject({
      kind: 'invoice', customerName: 'Customer A', jobNumber: j.number, serviceName: 'Fuel delivery', currency: 'USD',
      totalMinor: inv.totalMinor, taxMinor: 0, holdReasons: [], quantityNote: 'Delivered 187.4 gal of 200 requested',
    });
    expect(ap.summary.totalMinor).toBe(77399); // 187.4 gal x $3.89 = $728.99, plus the $45.00 delivery fee
    expect(ap.summary.lines).toEqual([
      { description: 'Gasoline', quantity: '187.4', unit: 'gal', rateMinor: 389, amountMinor: 72899 },
      { description: 'Delivery fee', quantity: '1', unit: '', rateMinor: 4500, amountMinor: 4500 },
    ]);
    expect(ap.actionType).toBe('invoice.issue');
    // The decided list keeps what was approved and for how much.
    expect((await s.owner.post(`/c/${s.cid}/approvals/${ap.id}/decide`, { decision: 'approve' })).body.status).toBe('approved');
    const decided = (await s.owner.get(`/c/${s.cid}/approvals?status=decided`)).body.approvals.find((a: any) => a.id === ap.id);
    expect(decided.summary.totalMinor).toBe(77399);
  });

  it('removes amounts on the server for roles without finance access', async () => {
    const s = await setup();
    await completed(s);
    // A dispatcher who may watch automation and approve, but not see money.
    const roles = (await s.owner.get(`/c/${s.cid}/roles`)).body.roles;
    const disp = roles.find((r: any) => r.key === 'dispatcher');
    expect((await s.owner.patch(`/c/${s.cid}/roles/dispatcher`, { permissions: [...disp.permissions, 'automation.control', 'approvals.decide'] })).status).toBe(200);
    const res = await s.dispatcher.get(`/c/${s.cid}/approvals`);
    const ap = res.body.approvals.find((a: any) => a.subject_type === 'invoice');
    expect(ap.summary.kind).toBe('invoice');
    expect(ap.summary.jobNumber).toBeTypeOf('number');
    for (const k of ['totalMinor', 'taxMinor', 'subtotalMinor']) expect(ap.summary[k]).toBeUndefined();
    expect(ap.summary.lines.every((l: any) => l.rateMinor === undefined && l.amountMinor === undefined)).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/77399|72899|4500/);
  });

  it('gives key facts for job and message approvals', async () => {
    const s = await setup();
    const j = await job(s, { start: '2030-03-04T14:00:00.000Z', priority: 'urgent' });
    const { approvalSummary } = await import('../src/server/modules/workflows.js');
    const { getDb } = await import('./helpers.js');
    const db = await getDb();
    const perms = new Set<string>(['finance.view', 'customers.contact']);
    const js = await approvalSummary(db, { subject_type: 'job', subject_id: j.id, company_id: s.cid }, perms);
    expect(js).toMatchObject({ kind: 'job', jobNumber: j.number, serviceName: 'Fuel delivery', customerName: 'Customer A', priority: 'urgent', status: 'open' });
  });
});

describe('inbox counts', () => {
  it('match what each simulated role is shown', async () => {
    const v = await signup('Visitor');
    const cid = (await v.post('/demo')).body.id;
    await processAll();
    for (const role of ['owner', 'dispatcher', 'office', 'driver']) {
      await v.post(`/c/${cid}/demo/role`, { role });
      const boot = (await v.get(`/c/${cid}`)).body;
      const approvals = (await v.get(`/c/${cid}/approvals`)).body.approvals.filter((a: any) => a.canDecide);
      const notes = (await v.get(`/c/${cid}/notifications?category=needs_action&state=open`)).body.notifications.filter((n: any) => n.ref_type !== 'approval');
      expect({ role, n: boot.attention.needs_action }).toEqual({ role, n: approvals.length + notes.length });
      if (role === 'owner') expect(approvals.length).toBeGreaterThan(0);
      if (role === 'driver') expect(boot.attention.needs_action).toBe(0);
    }
  });
});

describe('demo visits', () => {
  it('reopening the demo starts as Owner, and reset keeps the same address', async () => {
    const v = await signup('Visitor');
    const cid = (await v.post('/demo')).body.id;
    await v.post(`/c/${cid}/demo/role`, { role: 'driver' });
    expect((await v.post('/demo')).body.id).toBe(cid);
    expect((await v.get(`/c/${cid}`)).body.role.key).toBe('owner');
    await v.post(`/c/${cid}/customers`, { name: 'Added during demo' });
    await v.post(`/c/${cid}/demo/role`, { role: 'driver' });
    const reset = await v.post(`/c/${cid}/demo/reset`);
    expect(reset.body.id).toBe(cid);
    const boot = (await v.get(`/c/${cid}`)).body;
    expect(boot.role.key).toBe('owner');
    expect(boot.demo.guide).toMatchObject({ step: 0, dismissed: false });
    expect((await v.get(`/c/${cid}/customers`)).body.customers.map((c: any) => c.name)).not.toContain('Added during demo');
  });

  it('shows a real fuel, toilet and septic business with fictional prices', async () => {
    const v = await signup('Visitor');
    const cid = (await v.post('/demo')).body.id;
    await processAll();
    const svcs = (await v.get(`/c/${cid}/services`)).body.services;
    const fuel = svcs.find((x: any) => x.category === 'fuel');
    expect(fuel.pricing.filter((p: any) => p.when?.field === 'product').map((p: any) => [p.label, p.rateMinor !== null])).toEqual([['Diesel', true], ['Gasoline', true], ['Heating oil', true]]);
    const invoices = (await v.get(`/c/${cid}/invoices?status=all`)).body.invoices;
    // The rental bills every 28 days and its first invoice is visible.
    const plan = (await v.get(`/c/${cid}/recurring`)).body.plans[0];
    expect(plan.billing_rule).toMatchObject({ frequency: 'every_n_days', everyDays: 28 });
    expect(invoices.some((i: any) => i.recurringPlanId === plan.id || i.recurring_plan_id === plan.id)).toBe(true);
    // A priced emergency, after-hours septic pump-out, and one deliberately held invoice.
    const jobs = (await v.get(`/c/${cid}/jobs?status=all`)).body.jobs;
    const em = jobs.find((j: any) => j.priority === 'emergency' && j.category === 'septic');
    expect(em.status).toBe('completed');
    const emInv = (await v.get(`/c/${cid}/jobs/${em.id}`)).body.invoice;
    const emDetail = (await v.get(`/c/${cid}/invoices/${emInv.id}`)).body;
    expect(emDetail.invoice.totalMinor).toBeGreaterThan(0);
    expect(emDetail.lines.map((l: any) => l.description)).toEqual(['Pump-out', 'After-hours visit']);
    expect(invoices.filter((i: any) => i.status === 'held')).toHaveLength(1);
    expect(invoices.some((i: any) => i.status === 'issued' && i.paymentStatus === 'paid')).toBe(true);
    // Seeded notes describe the site, not a status that goes out of date.
    const j3 = jobs.find((j: any) => j.number === 3);
    expect((await v.get(`/c/${cid}/jobs/${j3.id}`)).body.job.notes).not.toMatch(/unassigned|needs a driver/i);
    expect(j3.priority).toBe('urgent');
  });
});

describe('invoice email', () => {
  it('lists the lines, the due date and how to pay', async () => {
    const s = await setup();
    await s.owner.patch(`/c/${s.cid}/settings`, { paymentInstructions: 'Pay by check to Test Co, PO Box 1.' });
    const j = await job(s, { start: new Date(Date.now() + 3600_000).toISOString(), assign: true });
    await s.driver.post(`/c/${s.cid}/jobs/${j.id}/complete`, { submissionId: rid(), baseVersion: j.version, outcome: 'completed', values: { delivered_qty: '187.4' } });
    await processAll();
    const inv = (await s.owner.get(`/c/${s.cid}/jobs/${j.id}`)).body.invoice;
    const v1 = (await s.owner.get(`/c/${s.cid}/invoices/${inv.id}`)).body.invoice.version;
    expect((await s.owner.post(`/c/${s.cid}/invoices/${inv.id}/approve`, { version: v1 })).status).toBe(200);
    await processAll();
    const cur = (await s.owner.get(`/c/${s.cid}/invoices/${inv.id}`)).body.invoice;
    if (cur.status !== 'issued') expect((await s.owner.post(`/c/${s.cid}/invoices/${inv.id}/issue`, { version: cur.version })).status).toBe(200);
    const prep = await s.owner.post(`/c/${s.cid}/invoices/${inv.id}/email`);
    expect(prep.status).toBe(200);
    const full = (await s.owner.get(`/c/${s.cid}/messages`)).body.messages.find((x: any) => x.id === prep.body.messageId);
    expect(full).toBeTruthy();
    expect(full.body).toMatch(/Gasoline: 187\.4 gal × \$3\.89 = \$728\.99/);
    expect(full.body).toMatch(/Delivery fee: \$45\.00/);
    expect(full.body).toMatch(/Total: \$773\.99/);
    expect(full.body).toMatch(/Due: [A-Z][a-z]+ \d{1,2}, \d{4}/);
    expect(full.body).toContain('How to pay: Pay by check to Test Co, PO Box 1.');
    expect(['prepared', 'simulated', 'failed']).toContain(full.status);
  });
});
