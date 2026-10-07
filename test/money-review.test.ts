import { describe, it, expect } from 'vitest';
import { billingRuleSchema, newDaysCredit, creditForDays, applyCredits } from '../src/shared/rentals.js';
import { addDays, localDate } from '../src/shared/schedule.js';
import { buildStatement } from '../src/server/modules/collections.js';
import { triCounty, type TriCounty } from './fixtures/tricounty.js';
import { rid, getDb } from './helpers.js';

// Phase 1 money review: rental credits never exceed what was billed or get lost, a rejected payment
// takes back the credit it created, money taken at an unbilled visit counts, statements use local dates.

const units3 = billingRuleSchema.parse({ frequency: 'every_n_days', everyDays: 28, lines: [
  { id: 'std', label: 'Standard unit', quantity: 2, rateE4: 1_250_000 },
  { id: 'ada', label: 'ADA unit', quantity: 1, rateE4: 1_600_000 },
] });
const chicagoToday = () => localDate(new Date(), 'America/Chicago');
const period = { start: '2026-10-01', end: '2026-10-28' };

describe('rent credits (shared)', () => {
  it('never credits a day twice, and crediting in steps adds up to crediting once', () => {
    const pause = newDaysCredit(units3, 0, period, { from: '2026-10-10', to: null, reason: 'paused' }, []);
    expect(pause.days).toHaveLength(19);
    const end = newDaysCredit(units3, 0, period, { from: '2026-10-16', to: null, reason: 'ended' }, pause.days);
    expect(end).toEqual({ days: [], amountMinor: 0 });
    const a = newDaysCredit(units3, 0, period, { from: '2026-10-10', to: '2026-10-12', reason: 'x' }, []);
    const b = newDaysCredit(units3, 0, period, { from: '2026-10-13', to: '2026-10-28', reason: 'y' }, a.days);
    expect(a.amountMinor + b.amountMinor).toBe(creditForDays(units3, 0, period, 19));
    expect(creditForDays(units3, 0, period, 28)).toBe(41000);
  });

  it('takes credit off a rent invoice only up to its charges; the rest waits', () => {
    const r = applyCredits(3000, [{ description: 'Credit A', amountMinor: 19000 }, { description: 'Credit B', amountMinor: 500 }]);
    expect(r.lines.map((l) => l.amountMinor)).toEqual([-3000]);
    expect(r.left.map((l) => l.amountMinor)).toEqual([16000, 500]);
  });
});

async function rental(t: TriCounty, startsOn: string) {
  const c = t.customers.harbor;
  const r = await t.dana.post(`/c/${t.cid}/recurring`, {
    name: 'Harbor units', kind: 'rental', customerId: c.id, locationId: c.locationId, serviceId: t.services.portable_toilet.id, units: 3,
    visitRule: { frequency: 'weekly', interval: 1, weekdays: [3], time: '07:00', durationMinutes: 60 }, billingRule: units3, startsOn, details: { visit_type: 'Service' },
  });
  expect(r.status).toBe(200);
  const d = (await t.dana.get(`/c/${t.cid}/recurring/${r.body.id}`)).body;
  await issue(t, d.invoices[0].id);
  return r.body.id as string;
}
async function issue(t: TriCounty, id: string) {
  let inv = (await t.dana.get(`/c/${t.cid}/invoices/${id}`)).body.invoice;
  if (inv.status !== 'approved') await t.dana.post(`/c/${t.cid}/invoices/${id}/approve`, { version: inv.version });
  inv = (await t.dana.get(`/c/${t.cid}/invoices/${id}`)).body.invoice;
  const r = await t.dana.post(`/c/${t.cid}/invoices/${id}/issue`, { version: inv.version });
  expect(r.status).toBe(200);
}
const credit = async (t: TriCounty, customerId: string) => (await t.dana.get(`/c/${t.cid}/customers/${customerId}/account`)).body.creditMinor as number;

describe('rent credits on plans', () => {
  it('a pause and then an early end credit each unserved day once', async () => {
    const t = await triCounty();
    const start = addDays(chicagoToday(), -10);
    const id = await rental(t, start);
    // Paused from day 12 with no end: days 12–27 (16 days) wait as credit for the next rent.
    const p = await t.dana.post(`/c/${t.cid}/recurring/${id}/pause`, { from: addDays(start, 12), until: null });
    expect(p.body.creditMinor).toBe(creditForDays(units3, 0, { start, end: addDays(start, 27) }, 16));
    // Ending on day 14 adds nothing for days 15–27: they were already credited.
    const e = await t.dana.post(`/c/${t.cid}/recurring/${id}/end`, { endsOn: addDays(start, 14), createPickup: false });
    expect(e.body.creditMinor).toBe(p.body.creditMinor);
    expect(await credit(t, t.customers.harbor.id)).toBe(p.body.creditMinor);
    const inv = (await t.dana.get(`/c/${t.cid}/recurring/${id}`)).body.invoices.at(-1);
    expect((await t.dana.get(`/c/${t.cid}/invoices/${inv.id}`)).body.invoice.creditedMinor).toBe(0);
  });

  it('resuming takes back the credit for days from today on', async () => {
    const t = await triCounty();
    const start = addDays(chicagoToday(), -10);
    const id = await rental(t, start);
    await t.dana.post(`/c/${t.cid}/recurring/${id}/pause`, { from: addDays(start, 5), until: null });
    expect((await t.dana.post(`/c/${t.cid}/recurring/${id}/resume`)).status).toBe(200);
    const plan = (await t.dana.get(`/c/${t.cid}/recurring/${id}`)).body.plan;
    // Only days 5–9 (before today) stay credited.
    expect(plan.pending_credits.reduce((s: number, c: any) => s + c.amountMinor, 0)).toBe(creditForDays(units3, 0, { start, end: addDays(start, 27) }, 5));
    expect(plan.status).toBe('active');
  });
});

describe('payments', () => {
  async function manual(t: TriCounty, cents: number) {
    const c = t.customers.brigid;
    const r = await t.priya.post(`/c/${t.cid}/invoices`, { customerId: c.id, locationId: c.locationId, clientRequestId: rid(), lines: [{ description: 'Service', quantity: '1', rateE4: cents * 100, taxable: false, kind: 'charge' }] });
    await issue(t, r.body.id);
    return r.body.id as string;
  }
  const bal = async (t: TriCounty, id: string) => (await t.dana.get(`/c/${t.cid}/invoices/${id}`)).body.invoice.balanceMinor;

  it('rejecting a payment takes back credit it created that already paid another invoice (D6)', async () => {
    const t = await triCounty();
    const a = await manual(t, 10000);
    await t.priya.post(`/c/${t.cid}/invoices/${a}/payments`, { amountMinor: 15000, method: 'check', reference: '501', idempotencyKey: rid() });
    expect(await credit(t, t.customers.brigid.id)).toBe(5000);
    const b = await manual(t, 5000);
    expect(await bal(t, b)).toBe(0);
    const pay = (await t.dana.get(`/c/${t.cid}/invoices/${a}`)).body.payments[0];
    expect((await t.dana.post(`/c/${t.cid}/payments/${pay.id}/reject`, { reason: 'Check bounced' })).status).toBe(200);
    expect(await bal(t, a)).toBe(10000);
    expect(await bal(t, b)).toBe(5000);
    expect(await credit(t, t.customers.brigid.id)).toBe(0);
  });

  it('money taken at a visit that is not billed pays the customer\'s open invoices', async () => {
    const t = await triCounty();
    const open = await manual(t, 10000);
    const c = t.customers.brigid;
    const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel', requested_qty: '50' }, intent: 'open', clientRequestId: rid() });
    const j = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
    const a = await t.dana.post(`/c/${t.cid}/jobs/${j.id}/assign`, { userId: t.ids.luis, resourceIds: [], version: j.version });
    await t.luis.post(`/c/${t.cid}/jobs/${j.id}/complete`, { submissionId: rid(), baseVersion: a.body.version, outcome: 'unsuccessful', reasonCode: 'locked_gate', collected: { method: 'cash', amountMinor: 4000 } });
    const pay = (await t.dana.get(`/c/${t.cid}/collections`)).body.unconfirmed[0];
    const conf = await t.priya.post(`/c/${t.cid}/payments/${pay.id}/confirm`);
    expect(conf.body).toMatchObject({ toCredit: true, waitingForInvoice: false });
    expect(await bal(t, open)).toBe(6000);
  });
});

describe('statements', () => {
  it('use the company\'s calendar day for when an invoice was issued', async () => {
    const t = await triCounty();
    const c = t.customers.brigid;
    const r = await t.priya.post(`/c/${t.cid}/invoices`, { customerId: c.id, locationId: c.locationId, clientRequestId: rid(), lines: [{ description: 'Service', quantity: '1', rateE4: 1_000_000, taxable: false, kind: 'charge' }] });
    await issue(t, r.body.id);
    const db = await getDb();
    // 9 pm on Sept 30 in Chicago is already Oct 1 in UTC.
    await db.query(`update rigo.invoices set issued_at = '2026-10-01T02:00:00Z' where id = $1`, [r.body.id]);
    const s = await buildStatement(db, t.cid, c.id, '2026-09-30');
    expect(s.openInvoices.map((i: any) => i.issuedOn)).toEqual(['2026-09-30']);
  });
});
