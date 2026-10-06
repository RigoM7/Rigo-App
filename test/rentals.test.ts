import { describe, it, expect, vi } from 'vitest';
import { periodCharges, periodCredit, depositDue, nominalDays, billingRuleSchema } from '../src/shared/rentals.js';
import { billingPeriods, addDays, localDate } from '../src/shared/schedule.js';
import { keepDuration } from '../src/server/modules/jobs.js';
import { generateForCompany } from '../src/server/modules/recurring.js';
import { triCounty, type TriCounty } from './fixtures/tricounty.js';
import { rid, getDb, processAll } from './helpers.js';

const rule = (r: Record<string, unknown>) => billingRuleSchema.parse(r);
const units3 = rule({ frequency: 'every_n_days', everyDays: 28, lines: [
  { id: 'std', label: 'Standard unit', quantity: 2, rateE4: 1_250_000 },
  { id: 'ada', label: 'ADA unit', quantity: 1, rateE4: 1_600_000 },
] });

describe('rent (shared)', () => {
  it('bills each unit line per 28-day period (R8-M1, R2-M4)', () => {
    const p = billingPeriods('every_n_days', '2026-10-01', null, null, '2026-11-15', 28);
    expect(p).toEqual([{ start: '2026-10-01', end: '2026-10-28' }, { start: '2026-10-29', end: '2026-11-25' }]);
    expect(periodCharges(units3, 0, p[0]).map((l) => [l.description, l.quantity, l.amountMinor])).toEqual([
      ['Standard unit, Oct 1 – Oct 28, 2026', '2', 25000], ['ADA unit, Oct 1 – Oct 28, 2026', '1', 16000]]);
  });

  it('prorates by the day for a pause or an early end (D5), and works out credits for issued periods', () => {
    const paused = periodCharges(units3, 0, { start: '2026-10-01', end: '2026-10-28' }, [{ from: '2026-10-10', to: '2026-10-14', reason: 'paused Oct 10 – Oct 14, 2026' }]);
    expect(paused.map((l) => [l.amountMinor, l.note])).toEqual([[20536, '23 of 28 days: paused Oct 10 – Oct 14, 2026'], [13143, '23 of 28 days: paused Oct 10 – Oct 14, 2026']]);
    // A period cut short by the plan's end bills only its days.
    expect(periodCharges(units3, 0, { start: '2026-10-01', end: '2026-10-07' }).map((l) => l.amountMinor)).toEqual([6250, 4000]);
    expect(periodCredit(units3, 0, { start: '2026-10-01', end: '2026-10-28' }, { from: '2026-10-10', to: '2026-10-14', reason: 'x' })).toBe(4464 + 2857);
    expect(nominalDays('monthly', '2026-02-01', '2026-02-28')).toBe(28);
    expect(nominalDays('monthly', '2026-10-01', '2026-10-31')).toBe(31);
  });

  it('works out the deposit (D22) and charges an event once', () => {
    expect(depositDue({ ...units3, deposit: { type: 'percent', percentBp: 2000, amountMinor: null } }, 0)).toBe(8200);
    expect(depositDue({ ...units3, deposit: { type: 'fixed', amountMinor: 15000, percentBp: null } }, 0)).toBe(15000);
    const ev = { ...units3, frequency: 'event' as const };
    expect(billingPeriods('event', '2026-10-10', '2026-10-12', null, '2026-10-10')).toEqual([{ start: '2026-10-10', end: '2026-10-12' }]);
    expect(periodCharges(ev, 0, { start: '2026-10-10', end: '2026-10-12' }).map((l) => l.amountMinor)).toEqual([25000, 16000]);
  });

  it('moving a start keeps the length (R8-M4, R6-m7)', () => {
    const job = { scheduled_start: '2026-10-06T14:00:00.000Z', scheduled_end: '2026-10-06T15:00:00.000Z' };
    expect(keepDuration(job, '2026-10-06T16:00:00.000Z', undefined)).toBe('2026-10-06T17:00:00.000Z');
    expect(keepDuration(job, '2026-10-06T16:00:00.000Z', '2026-10-06T15:00:00.000Z')).toBe('2026-10-06T17:00:00.000Z');
    expect(keepDuration(job, '2026-10-06T16:00:00.000Z', '2026-10-06T18:30:00.000Z')).toBeNull();
  });
});

const chicagoToday = () => localDate(new Date(), 'America/Chicago');

async function rental(t: TriCounty, over: Record<string, unknown> = {}, as = t.dana) {
  const c = t.customers.harbor;
  const r = await as.post(`/c/${t.cid}/recurring`, {
    name: 'Harbor & Vine: summer units', kind: 'rental', customerId: c.id, locationId: c.locationId, serviceId: t.services.portable_toilet.id, units: 3,
    visitRule: { frequency: 'weekly', interval: 1, weekdays: [new Date(`${addDays(chicagoToday(), 2)}T12:00:00Z`).getUTCDay()], time: '07:00', durationMinutes: 60 },
    billingRule: units3, startsOn: chicagoToday(), details: { visit_type: 'Service' },
    defaultUserId: t.ids.jo, defaultResourceIds: [t.trucks['Toilet truck 1']], ...over,
  });
  expect(r.status).toBe(200);
  return r.body;
}

async function complete(t: TriCounty, jobId: string, who = t.jo) {
  const j = (await t.dana.get(`/c/${t.cid}/jobs/${jobId}`)).body.job;
  const r = await who.post(`/c/${t.cid}/jobs/${jobId}/complete`, { submissionId: rid(), baseVersion: j.version, outcome: 'completed', values: { units: '3' }, photos: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAJJRU5ErkJggg=='] });
  expect(r.status).toBe(200);
  await processAll();
}

describe('rental plans with the fixture company', () => {
  it('visits arrive assigned; the delivery and service visits are covered by the rent; an extra visit is billed (R8-C1, R8-m5)', async () => {
    const t = await triCounty();
    const plan = await rental(t, { billingRule: { ...units3, visitPrices: { extra: 650000 } } });
    expect(plan.deliveryJob).toBeTruthy();
    const d = (await t.dana.get(`/c/${t.cid}/recurring/${plan.id}`)).body;
    const visit = d.occurrences.find((o: any) => o.job_id);
    const job = (await t.dana.get(`/c/${t.cid}/jobs/${visit.job_id}`)).body;
    expect(job.job.assigned_user_id).toBe(t.ids.jo);
    expect(job.resources.map((r: any) => r.name)).toEqual(['Toilet truck 1']);
    // The driver's form starts from the booked units, and the visit isn't billed on top of the rent.
    await complete(t, plan.deliveryJob.id);
    await complete(t, visit.job_id);
    for (const id of [plan.deliveryJob.id, visit.job_id]) {
      const after = (await t.dana.get(`/c/${t.cid}/jobs/${id}`)).body;
      expect(after.invoice).toBeNull();
      expect(after.job.billing_status).toBe('not_billable');
    }
    expect((await t.dana.get(`/c/${t.cid}/overview`)).body.attention.find((a: any) => a.key === 'unbilled')).toBeUndefined();
    // An extra service bills at the plan's extra price.
    const extra = await t.dana.post(`/c/${t.cid}/recurring/${plan.id}/extra`, { day: addDays(chicagoToday(), 1) });
    await complete(t, extra.body.id);
    const inv = (await t.dana.get(`/c/${t.cid}/jobs/${extra.body.id}`)).body.invoice;
    const lines = (await t.dana.get(`/c/${t.cid}/invoices/${inv.id}`)).body.lines;
    expect(lines.map((l: any) => [l.description, l.amountMinor])).toEqual([['Extra service: Harbor & Vine: summer units', 6500]]);
    // Rent for the first 28 days was prepared, one line per unit type.
    const rent = d.invoices[0];
    expect((await t.dana.get(`/c/${t.cid}/invoices/${rent.id}`)).body.lines.map((l: any) => l.amountMinor)).toEqual([25000, 16000]);
  });

  it('a dispatcher who can\'t see prices is told billing sets them, and billing is asked (R8-m1)', async () => {
    const t = await triCounty();
    const noRates = { frequency: 'every_n_days', everyDays: 28, lines: [{ id: 'std', label: 'Standard unit', quantity: 3, rateE4: null }] };
    expect((await t.marcus.post(`/c/${t.cid}/recurring`, { name: 'x', kind: 'rental', customerId: t.customers.harbor.id, locationId: t.customers.harbor.locationId, serviceId: t.services.portable_toilet.id, visitRule: { frequency: 'weekly', weekdays: [1] }, billingRule: units3, startsOn: chicagoToday() })).status).toBe(403);
    const plan = await rental(t, { billingRule: noRates }, t.marcus);
    expect(plan.ratesRequested).toBe(true);
    const n = (await t.priya.get(`/c/${t.cid}/notifications`)).body.notifications.find((x: any) => x.title.startsWith('Set the rental rates'));
    expect(n).toBeTruthy();
    expect((await t.marcus.get(`/c/${t.cid}/recurring/${plan.id}`)).body.plan.billing_rule.lines[0].rateE4).toBeUndefined();
    const held = (await t.priya.get(`/c/${t.cid}/recurring/${plan.id}`)).body;
    expect((await t.priya.get(`/c/${t.cid}/invoices/${held.invoices[0].id}`)).body.invoice.status).toBe('held');
    // Billing sets the rate: the held rent invoice is rebuilt.
    const set = await t.priya.put(`/c/${t.cid}/recurring/${plan.id}/billing`, { billingRule: { ...noRates, lines: [{ id: 'std', label: 'Standard unit', quantity: 3, rateE4: 1_250_000 }] }, version: held.plan.version });
    expect(set.body.rebuiltInvoices).toBe(1);
    expect((await t.priya.get(`/c/${t.cid}/invoices/${held.invoices[0].id}`)).body.invoice).toMatchObject({ status: 'draft', totalMinor: 37500 });
  });

  it('a pause after the rent was issued credits the next rent invoice; an early end credits the issued one (R8-M2)', async () => {
    const t = await triCounty();
    const start = addDays(chicagoToday(), -10);
    const plan = await rental(t, { startsOn: start });
    let d = (await t.dana.get(`/c/${t.cid}/recurring/${plan.id}`)).body;
    const first = d.invoices[0];
    let inv = (await t.dana.get(`/c/${t.cid}/invoices/${first.id}`)).body;
    await t.dana.post(`/c/${t.cid}/invoices/${first.id}/approve`, { version: inv.invoice.version });
    await processAll();
    inv = (await t.dana.get(`/c/${t.cid}/invoices/${first.id}`)).body;
    if (inv.invoice.status !== 'issued') await t.dana.post(`/c/${t.cid}/invoices/${first.id}/issue`, { version: inv.invoice.version });
    // Paused for 5 days inside the issued period: $410 × 5/28 = $73.21 credit, kept for the next invoice.
    const p = await t.dana.post(`/c/${t.cid}/recurring/${plan.id}/pause`, { from: addDays(start, 12), until: addDays(start, 16) });
    expect(p.body.creditMinor).toBe(4464 + 2857);
    await t.dana.post(`/c/${t.cid}/recurring/${plan.id}/resume`);
    d = (await t.dana.get(`/c/${t.cid}/recurring/${plan.id}`)).body;
    expect(d.plan.pending_credits).toHaveLength(1);
    // The next period's rent invoice carries the credit.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${addDays(start, 29)}T18:00:00Z`));
    try { await generateForCompany(await getDb(), t.cid); } finally { vi.useRealTimers(); }
    d = (await t.dana.get(`/c/${t.cid}/recurring/${plan.id}`)).body;
    const second = (await t.dana.get(`/c/${t.cid}/invoices/${d.invoices[0].id}`)).body;
    expect(second.lines.at(-1)).toMatchObject({ kind: 'discount', amountMinor: -(4464 + 2857) });
    expect(second.invoice.totalMinor).toBe(41000 - 7321);
    expect(d.plan.pending_credits).toEqual([]);
  });

  it('ending a plan early credits the issued rent and creates the pickup job; an event moves delivery and pickup together (R8-m4, R8-M4)', async () => {
    const t = await triCounty();
    const start = addDays(chicagoToday(), -5);
    const plan = await rental(t, { startsOn: start });
    const d = (await t.dana.get(`/c/${t.cid}/recurring/${plan.id}`)).body;
    let inv = (await t.dana.get(`/c/${t.cid}/invoices/${d.invoices[0].id}`)).body;
    await t.dana.post(`/c/${t.cid}/invoices/${inv.invoice.id}/approve`, { version: inv.invoice.version });
    inv = (await t.dana.get(`/c/${t.cid}/invoices/${inv.invoice.id}`)).body;
    expect((await t.dana.post(`/c/${t.cid}/invoices/${inv.invoice.id}/issue`, { version: inv.invoice.version })).status).toBe(200);
    const end = await t.dana.post(`/c/${t.cid}/recurring/${plan.id}/end`, { endsOn: addDays(start, 6), createPickup: true });
    expect(end.status).toBe(200);
    // 21 of 28 days after the end are credited: $410 × 21/28 = $307.50.
    expect(end.body.creditMinor).toBe(18750 + 12000);
    inv = (await t.dana.get(`/c/${t.cid}/invoices/${inv.invoice.id}`)).body;
    expect(inv.invoice).toMatchObject({ creditedMinor: 30750, balanceMinor: 41000 - 30750 });
    const pickup = (await t.dana.get(`/c/${t.cid}/jobs/${end.body.pickupJob.id}`)).body.job;
    expect(pickup).toMatchObject({ details: expect.objectContaining({ visit_type: 'Pickup' }), assigned_user_id: t.ids.jo, notes: 'Pickup for plan "Harbor & Vine: summer units".' });
    // An event rental moves as a whole.
    const ev = await rental(t, { name: 'Wedding', startsOn: addDays(chicagoToday(), 20), endsOn: addDays(chicagoToday(), 22), billingRule: { ...units3, frequency: 'event' }, visitRule: { frequency: 'daily', interval: 1, weekdays: [], time: '09:00', durationMinutes: 60 } });
    const before = (await t.dana.get(`/c/${t.cid}/jobs/${ev.deliveryJob.id}`)).body.job.scheduled_start;
    const mv = await t.dana.post(`/c/${t.cid}/recurring/${ev.id}/move`, { startsOn: addDays(chicagoToday(), 27) });
    expect(mv.body.movedJobs).toBeGreaterThan(0);
    const after = (await t.dana.get(`/c/${t.cid}/jobs/${ev.deliveryJob.id}`)).body.job.scheduled_start;
    expect(new Date(after).getTime() - new Date(before).getTime()).toBe(7 * 86400_000);
    expect((await t.dana.get(`/c/${t.cid}/recurring/${ev.id}`)).body.plan).toMatchObject({ starts_on: addDays(chicagoToday(), 27), ends_on: addDays(chicagoToday(), 29) });
  });

  it('a deposit taken when booking pays the rent; units are tracked on site (D22)', async () => {
    const t = await triCounty();
    const plan = await rental(t, { startsOn: addDays(chicagoToday(), 3), billingRule: { ...units3, deposit: { type: 'percent', percentBp: 2500 } } });
    let d = (await t.priya.get(`/c/${t.cid}/recurring/${plan.id}`)).body;
    expect(d.plan.depositDueMinor).toBe(10250);
    expect((await t.priya.post(`/c/${t.cid}/recurring/${plan.id}/deposit`, { amountMinor: 10250, method: 'card', idempotencyKey: rid() })).status).toBe(200);
    expect((await t.priya.get(`/c/${t.cid}/customers/${t.customers.harbor.id}/account`)).body.creditMinor).toBe(10250);
    // Units: PT-101 goes on site with the plan; it can't be placed with another plan at the same time.
    const pt = d.yard.find((u: any) => u.name === 'PT-101');
    expect((await t.dana.post(`/c/${t.cid}/recurring/${plan.id}/units`, { resourceId: pt.id, placement: 'on_site' })).status).toBe(200);
    d = (await t.dana.get(`/c/${t.cid}/recurring/${plan.id}`)).body;
    expect(d.units.map((u: any) => [u.name, u.placement])).toEqual([['PT-101', 'on_site']]);
    expect(d.yard.some((u: any) => u.name === 'PT-101')).toBe(false);
    const other = await rental(t, { name: 'Other' });
    expect((await t.dana.post(`/c/${t.cid}/recurring/${other.id}/units`, { resourceId: pt.id, placement: 'on_site' })).status).toBe(409);
  });

  it('moving a job later keeps its length, from the job form or the assignment panel (R8-M4)', async () => {
    const t = await triCounty();
    const c = t.customers.grace;
    const start = new Date(Date.now() + 86400_000); start.setUTCMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 90 * 60000);
    const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, intent: 'open', clientRequestId: rid(), scheduledStart: start.toISOString(), scheduledEnd: end.toISOString() });
    let job = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
    const later = new Date(start.getTime() + 3 * 3600_000);
    // The form sends the new start with the old end: the end moves with it.
    expect((await t.dana.patch(`/c/${t.cid}/jobs/${job.id}`, { scheduledStart: later.toISOString(), scheduledEnd: end.toISOString(), version: job.version })).status).toBe(200);
    job = (await t.dana.get(`/c/${t.cid}/jobs/${job.id}`)).body.job;
    expect(new Date(job.scheduled_end).getTime() - new Date(job.scheduled_start).getTime()).toBe(90 * 60000);
    const evenLater = new Date(later.getTime() + 5 * 3600_000);
    expect((await t.dana.post(`/c/${t.cid}/jobs/${job.id}/assign`, { userId: t.ids.luis, resourceIds: [], scheduledStart: evenLater.toISOString(), scheduledEnd: job.scheduled_end, version: job.version })).status).toBe(200);
    job = (await t.dana.get(`/c/${t.cid}/jobs/${job.id}`)).body.job;
    expect(new Date(job.scheduled_start).getTime()).toBe(evenLater.getTime());
    expect(new Date(job.scheduled_end).getTime() - evenLater.getTime()).toBe(90 * 60000);
  });
});
