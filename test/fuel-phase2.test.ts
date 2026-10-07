import { describe, it, expect } from 'vitest';
import { triCounty, fixtureServices, type TriCounty } from './fixtures/tricounty.js';
import { rid } from './helpers.js';
import { computeTotals } from '../src/shared/billing.js';
import { buildDeliveryLines, lineKeys, lineProblems, lineQuantity, meterQuantity, takesLines, totalQuantity, type DeliveryLine } from '../src/shared/deliveries.js';
import { holdKind } from '../src/shared/invoices.js';

// WP9: several products or tanks at one fuel stop, meter readings and tickets, customer tanks, and
// releasing a review hold.

const line = (p: Partial<DeliveryLine>): DeliveryLine => ({ product: 'Diesel', tank: '', quantity: '', meterStart: '', meterEnd: '', ticket: '', ...p });

describe('delivery lines (R7-M1, R7-M4)', () => {
  const { fuel, septic } = fixtureServices();
  const labels = Object.fromEntries(fuel.fields.map((f) => [f.key, f.label]));
  const types = Object.fromEntries(fuel.fields.map((f) => [f.key, f.type]));

  it('reads which fields a line fills, and only fuel services take lines', () => {
    expect(lineKeys(fuel.pricing)).toEqual({ choice: 'product', quantity: 'delivered_qty' });
    expect(takesLines({ category: 'fuel', pricing: fuel.pricing })).toBe(true);
    expect(takesLines({ category: 'septic', pricing: septic.pricing })).toBe(false);
  });

  it('computes meter quantities and flags a reading that does not match', () => {
    expect(meterQuantity('10230', '10680.5')).toBe('450.5');
    expect(meterQuantity('500', '400')).toBeNull();
    expect(lineQuantity(line({ meterStart: '100', meterEnd: '250' }))).toBe('150');
    expect(lineQuantity(line({ quantity: '149', meterStart: '100', meterEnd: '250' }))).toBe('149');
    expect(lineProblems(line({ quantity: '150.4', meterStart: '100', meterEnd: '250' }), 'gal')).toEqual({ errors: {}, warning: null });
    expect(lineProblems(line({ quantity: '200', meterStart: '100', meterEnd: '250' }), 'gal').warning).toBe('The meter shows 150 gal (250 − 100) but 200 gal was entered.');
    expect(lineProblems(line({ meterStart: '300', meterEnd: '250' })).errors).toEqual({ meterEnd: 'The end reading is lower than the start', quantity: 'Enter the quantity, or both meter readings' });
    expect(totalQuantity([line({ quantity: '100' }), line({ meterStart: '0', meterEnd: '50.5' })])).toBe('150.5');
  });

  it('charges each product at its own price and tax, and the delivery fee once', () => {
    const built = buildDeliveryLines(fuel.pricing, { product: 'Diesel', delivered_qty: '150' },
      [line({ product: 'Diesel', quantity: '100', tank: 'Shop tank', ticket: '4471' }), line({ product: 'Dyed diesel', quantity: '50', meterStart: '1000', meterEnd: '1050' })], labels, types);
    expect(built.holdReasons).toEqual([]);
    expect(built.lines.map((l) => [l.description, l.quantity, l.amountMinor, l.taxable])).toEqual([
      ['Diesel (Shop tank, ticket 4471)', '100', 38990, true],
      ['Dyed diesel', '50', 17495, false],
      ['Delivery fee', '1', 2500, true],
    ]);
    expect(built.lines[1].note).toBe('Meter 1000 → 1050');
    // Tax only on the taxable lines (diesel and the fee): 414.90 × 7.25% = 30.08.
    expect(computeTotals(built.lines, fuel.taxRateBp)).toMatchObject({ subtotalMinor: 58985, taxMinor: 3008, totalMinor: 61993 });
    // A tax-exempt customer (the farm's dyed-fuel exemption) pays none.
    expect(computeTotals(built.lines, fuel.taxRateBp, [], { taxExempt: true })).toMatchObject({ taxMinor: 0, totalMinor: 58985 });
  });

  it('holds a product with no price, and prints the price index note', () => {
    const pricing = fuel.pricing.map((p) => (p.id === 'fuel_gasoline' ? { ...p, rateE4: null } : p.id === 'fuel_diesel' ? { ...p, indexNote: 'OPIS rack Chicago + $0.35' } : p));
    const built = buildDeliveryLines(pricing, {}, [line({ product: 'Diesel', quantity: '10' }), line({ product: 'Gasoline', quantity: '5' })], labels, types);
    expect(built.holdReasons).toEqual(['No rate is set for "Gasoline". Add it in Services before this invoice can be approved.']);
    expect(built.lines[0].note).toBe('OPIS rack Chicago + $0.35');
  });

  it('tells review holds from holds that need a fix', () => {
    expect(holdKind('The visit was only partly completed. Review quantities before approving.')).toBe('review');
    expect(holdKind('Check the quantity before approving: Line 1 (Diesel): The meter shows 150 gal')).toBe('review');
    expect(holdKind('No rate is set for "Gasoline". Add it in Services before this invoice can be approved.')).toBe('fix');
  });
});

async function fuelStop(t: TriCounty, customer = 'ridgeline') {
  const c = t.customers[customer];
  const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel', requested_qty: '300' }, intent: 'open', clientRequestId: rid(), scheduledStart: new Date(Date.now() + 3600_000).toISOString() });
  const job = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
  const a = await t.dana.post(`/c/${t.cid}/jobs/${job.id}/assign`, { userId: t.ids.luis, resourceIds: [t.trucks['Tank wagon 1']], version: job.version });
  return { id: job.id as string, version: a.body.version as number };
}
const complete = (t: TriCounty, job: { id: string; version: number }, lines: Partial<DeliveryLine>[], extra: Record<string, unknown> = {}) =>
  t.luis.post(`/c/${t.cid}/jobs/${job.id}/complete`, { submissionId: rid(), baseVersion: job.version, outcome: 'completed', values: {}, lines: lines.map(line), ...extra });

describe('fuel stops end to end (R7-M1, R7-M4, R7-m1)', () => {
  it('drivers see the tanks and which fields a line fills, never the prices', async () => {
    const t = await triCounty();
    const tanks = [{ id: 'tank_a', name: 'Shop tank', product: 'Diesel', size: '500 gal', notes: 'Fill pipe on the north side' }, { id: 'tank_b', name: 'Loader', product: 'Dyed diesel', size: '', notes: '' }];
    expect((await t.dana.patch(`/c/${t.cid}/locations/${t.customers.ridgeline.locationId}`, { tanks })).status).toBe(200);
    expect((await t.dana.patch(`/c/${t.cid}/locations/${t.customers.ridgeline.locationId}`, { tanks: [{ id: 'x', name: '' }] })).status).toBe(400);
    const job = await fuelStop(t);
    const mine = (await t.luis.get(`/c/${t.cid}/my/jobs`)).body.jobs.find((j: any) => j.id === job.id);
    expect(mine.location_tanks).toEqual(tanks);
    expect(mine.delivery_lines).toEqual({ choice: 'product', quantity: 'delivered_qty' });
    expect(JSON.stringify(mine)).not.toMatch(/rateE4|pricing/);
  });

  it('one stop, two products in two tanks: one invoice with a line each and one delivery fee', async () => {
    const t = await triCounty();
    const job = await fuelStop(t);
    // A line without a quantity or a listed product is refused, with the line named.
    const bad = await complete(t, job, [{ product: 'Kerosene', quantity: '10' }, { product: 'Diesel' }]);
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields).toEqual({ 'lines.0.product': 'Choose a listed product', 'lines.1.quantity': 'Enter the quantity, or both meter readings' });
    const ok = await complete(t, job, [{ product: 'Diesel', tank: 'Shop tank', quantity: '120', ticket: 'T-881' }, { product: 'Dyed diesel', tank: 'Loader', meterStart: '20410', meterEnd: '20490' }]);
    expect(ok.status).toBe(200);
    const d = (await t.dana.get(`/c/${t.cid}/jobs/${job.id}`)).body.job;
    expect(d.completion.values.delivered_qty).toBe('200');
    expect(d.completion.lines.map((l: any) => [l.product, l.quantity, l.tank, l.ticket])).toEqual([['Diesel', '120', 'Shop tank', 'T-881'], ['Dyed diesel', '80', 'Loader', '']]);
    const inv = await t.dana.post(`/c/${t.cid}/jobs/${job.id}/invoice`);
    const detail = (await t.dana.get(`/c/${t.cid}/invoices/${inv.body.invoiceId}`)).body;
    expect(detail.invoice.status).toBe('draft');
    expect(detail.lines.map((l: any) => [l.description, l.quantity, l.amountMinor])).toEqual([
      ['Diesel (Shop tank, ticket T-881)', '120', 46788], ['Dyed diesel (Loader)', '80', 27992], ['Delivery fee', '1', 2500]]);
    // Tax on diesel and the fee only: (467.88 + 25.00) × 7.25% = 35.73.
    expect(detail.invoice).toMatchObject({ subtotalMinor: 77280, taxMinor: 3573, totalMinor: 80853 });
  });

  it('a meter reading that does not match holds the invoice; the office reviews and releases it', async () => {
    const t = await triCounty();
    const job = await fuelStop(t);
    expect((await complete(t, job, [{ product: 'Diesel', quantity: '180', meterStart: '1000', meterEnd: '1150' }])).status).toBe(200);
    const inv = (await t.dana.post(`/c/${t.cid}/jobs/${job.id}/invoice`)).body;
    let d = (await t.priya.get(`/c/${t.cid}/invoices/${inv.invoiceId}`)).body.invoice;
    expect(d.status).toBe('held');
    expect(d.holdReasons).toEqual(['Check the quantity before approving: Line 1 (Diesel): The meter shows 150 gal (1150 − 1000) but 180 gal was entered.']);
    // Drivers and dispatchers can't release it; office can, once, with the version they reviewed.
    expect((await t.luis.post(`/c/${t.cid}/invoices/${inv.invoiceId}/release-hold`, { version: d.version })).status).toBe(403);
    expect((await t.priya.post(`/c/${t.cid}/invoices/${inv.invoiceId}/release-hold`, { version: d.version - 1 })).status).toBe(409);
    expect((await t.priya.post(`/c/${t.cid}/invoices/${inv.invoiceId}/release-hold`, { version: d.version, note: 'Driver confirmed 180 by phone' })).status).toBe(200);
    d = (await t.priya.get(`/c/${t.cid}/invoices/${inv.invoiceId}`)).body.invoice;
    expect(d.status).toBe('draft');
    expect(d.holdReasons).toEqual([]);
    const events = (await t.dana.get(`/c/${t.cid}/jobs/${job.id}`)).body.events;
    expect(events.some((e: any) => e.type === 'hold_released' && e.data.note === 'Driver confirmed 180 by phone')).toBe(true);
    expect((await t.dana.get(`/c/${t.cid}/activity?group=money`)).body.entries.some((e: any) => e.action === 'invoice.hold_released')).toBe(true);
    expect((await t.priya.post(`/c/${t.cid}/invoices/${inv.invoiceId}/release-hold`, { version: d.version })).status).toBe(409);
  });

  it('a hold for a missing rate is not released by review', async () => {
    const t = await triCounty();
    const svc = (await t.dana.get(`/c/${t.cid}/services`)).body.services.find((s: any) => s.id === t.services.fuel.id);
    const def = fixtureServices().fuel;
    def.pricing = def.pricing.map((p) => (p.id === 'fuel_gasoline' ? { ...p, rateE4: null } : p));
    expect((await t.dana.put(`/c/${t.cid}/services/${svc.id}`, { service: def, version: svc.version })).status).toBe(200);
    const job = await fuelStop(t);
    expect((await complete(t, job, [{ product: 'Diesel', quantity: '50' }, { product: 'Gasoline', quantity: '20' }])).status).toBe(200);
    const inv = (await t.dana.post(`/c/${t.cid}/jobs/${job.id}/invoice`)).body;
    const d = (await t.priya.get(`/c/${t.cid}/invoices/${inv.invoiceId}`)).body.invoice;
    expect(d.status).toBe('held');
    const r = await t.priya.post(`/c/${t.cid}/invoices/${inv.invoiceId}/release-hold`, { version: d.version });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/^Fix these first: No rate is set for "Gasoline"/);
  });

  it('services that are not fuel refuse delivery lines', async () => {
    const t = await triCounty();
    const c = t.customers.grace;
    const r = (await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.septic.id, details: { service_detail: 'Pump-out' }, intent: 'open', clientRequestId: rid() })).body;
    const j = (await t.dana.get(`/c/${t.cid}/jobs/${r.id}`)).body.job;
    const a = await t.dana.post(`/c/${t.cid}/jobs/${r.id}/assign`, { userId: t.ids.luis, resourceIds: [], version: j.version });
    const res = await complete(t, { id: r.id, version: a.body.version }, [{ product: 'Pump-out', quantity: '900' }], { values: { volume_pumped: '900' } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('This service records one quantity per job, not delivery lines.');
  });
});
