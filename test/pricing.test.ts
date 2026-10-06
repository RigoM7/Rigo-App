import { describe, it, expect } from 'vitest';
import { buildLines, computeTotals, pricingWarnings, checkQuantity, parseRate, formatRate, rateToInput, lineAmount, parseCapacity } from '../src/shared/billing.js';
import { serviceInputSchema, readPricing, datePriceChanges, starterService } from '../src/shared/services.js';
import { fixtureServices, triCounty } from './fixtures/tricounty.js';
import { processAll, rid } from './helpers.js';

const meta = (svc: ReturnType<typeof fixtureServices>['fuel']) => ({
  labels: Object.fromEntries(svc.fields.map((f) => [f.key, f.label])),
  types: Object.fromEntries(svc.fields.map((f) => [f.key, f.type])),
});
const bill = (svc: ReturnType<typeof fixtureServices>['fuel'], values: Record<string, unknown>, opts: { taxExempt?: boolean; overrides?: Record<string, number> } = {}) => {
  const m = meta(svc);
  const b = buildLines(svc.pricing, values, m.labels, m.types, { overrides: opts.overrides });
  const t = computeTotals(b.lines, svc.taxRateBp, [], { taxExempt: opts.taxExempt });
  return { ...b, totals: t, summary: b.lines.map((l) => [l.description, l.quantity, l.amountMinor]) };
};

describe('rates to the hundredth of a cent (D3)', () => {
  it('parses, shows and multiplies rates with up to 4 decimals, rounding each line half up', () => {
    expect(parseRate('3.8995')).toBe(38995);
    expect(parseRate('$1,250')).toBe(12_500_000);
    expect(parseRate('3.89951')).toBeNull();
    expect(rateToInput(38990)).toBe('3.899');
    expect(rateToInput(3_750_000)).toBe('375.00');
    expect(formatRate(38995)).toBe('$3.8995');
    expect(formatRate(3500)).toBe('$0.35');
    expect(lineAmount('100', 38995)).toBe(38995); // 100 × $3.8995 = $389.95
    expect(lineAmount('187.4', 38900)).toBe(72899); // $728.986 → $728.99
    expect(lineAmount('0.5', 38900)).toBe(195); // 0.5 × $3.89 = $1.945 → $1.95
  });
  it('reads old whole-cent rates as ten-thousandths', () => {
    const [p] = readPricing([{ id: 'x', label: 'Diesel', basis: 'per_quantity', quantityField: 'q', unit: 'gal', rateMinor: 389, taxable: false }]);
    expect(p.rateE4).toBe(38900);
    expect(p).not.toHaveProperty('rateMinor');
  });
});

describe('the fixture price list (every combination)', () => {
  const { fuel, septic } = fixtureServices();
  it('charges only the chosen fuel product, plus one delivery fee (R3-C1)', () => {
    const diesel = bill(fuel, { product: 'Diesel', delivered_qty: '100' });
    expect(diesel.holdReasons).toEqual([]);
    expect(diesel.summary).toEqual([['Diesel', '100', 38990], ['Delivery fee', '1', 2500]]);
    // $414.90 subtotal (not $1,596), all taxable at 7.25%: tax $30.08 (30.080…)
    expect(diesel.totals).toMatchObject({ subtotalMinor: 41490, taxMinor: 3008, totalMinor: 44498 });
    expect(bill(fuel, { product: 'Gasoline', delivered_qty: '50.5' }).summary).toEqual([['Gasoline', '50.5', 18175], ['Delivery fee', '1', 2500]]);
    expect(bill(fuel, { product: 'Heating oil', delivered_qty: '200' }).summary).toEqual([['Heating oil', '200', 65980], ['Delivery fee', '1', 2500]]);
  });
  it('dyed diesel for a tax-exempt farm carries no tax, even on taxable lines', () => {
    const dyed = bill(fuel, { product: 'Dyed diesel', delivered_qty: '100' }, { taxExempt: true });
    expect(dyed.summary).toEqual([['Dyed diesel', '100', 34990], ['Delivery fee', '1', 2500]]);
    expect(dyed.totals).toMatchObject({ subtotalMinor: 37490, taxMinor: 0, totalMinor: 37490 });
    // The same delivery for a customer who isn't exempt pays tax on the delivery fee only.
    expect(bill(fuel, { product: 'Dyed diesel', delivered_qty: '100' }).totals.taxMinor).toBe(181); // 7.25% of $25.00
  });
  it('septic pump-outs include 1,000 gal and bill the overage (R6-M2)', () => {
    expect(bill(septic, { service_detail: 'Pump-out', volume_pumped: '900' }).summary).toEqual([['Pump-out (includes 1,000 gal)', '1', 37500]]);
    expect(bill(septic, { service_detail: 'Pump-out', volume_pumped: '1000' }).summary).toEqual([['Pump-out (includes 1,000 gal)', '1', 37500]]);
    const big = bill(septic, { service_detail: 'Pump-out', volume_pumped: '1250' });
    expect(big.summary).toEqual([['Pump-out (includes 1,000 gal)', '1', 37500], ['Pump-out: 250 gal over 1,000 included', '250', 8750]]);
    expect(big.totals.totalMinor).toBe(46250);
    // Without a measured volume Rigo can't tell, so the invoice is held rather than guessed.
    expect(bill(septic, { service_detail: 'Pump-out' }).holdReasons.join(' ')).toMatch(/Volume pumped.*1,000 gal/);
  });
  it('inspections are $295, not the pump-out price (R6-M2)', () => {
    expect(bill(septic, { service_detail: 'Inspection' }).summary).toEqual([['Inspection', '1', 29500]]);
  });
  it('grease traps below the minimum pay the minimum, and say so', () => {
    const small = bill(septic, { service_detail: 'Grease trap', volume_pumped: '150' });
    expect(small.summary).toEqual([['Grease trap', '150', 20000]]);
    expect(small.lines[0].note).toMatch(/Minimum charge \$200\.00 applies \(150 gal × \$0\.95 = \$142\.50\)/);
    expect(bill(septic, { service_detail: 'Grease trap', volume_pumped: '400' }).summary).toEqual([['Grease trap', '400', 38000]]);
  });
  it('adds the after-hours fee only on after-hours jobs', () => {
    expect(bill(septic, { service_detail: 'Inspection', after_hours: true }).summary).toEqual([['Inspection', '1', 29500], ['After-hours visit', '1', 15000]]);
    expect(bill(fuel, { product: 'Diesel', delivered_qty: '10', after_hours: false }).summary.map((x) => x[0])).toEqual(['Diesel', 'Delivery fee']);
  });
  it('uses customer prices in place of the service rate', () => {
    expect(bill(fuel, { product: 'Diesel', delivered_qty: '100' }, { overrides: { fuel_diesel: 37500 } }).summary[0]).toEqual(['Diesel', '100', 37500]);
  });
});

describe('the service editor catches price-list mistakes', () => {
  it('validates included quantities and minimums', () => {
    const svc = starterService('septic');
    svc.pricing[0].includedQuantity = 'lots';
    expect(serviceInputSchema.safeParse(svc).success).toBe(false);
    const s2 = starterService('septic');
    s2.pricing.find((p) => p.id === 'inspection')!.minimumMinor = 100;
    expect(serviceInputSchema.safeParse(s2).success).toBe(false);
    expect(serviceInputSchema.safeParse(fixtureServices().septic).success).toBe(true);
  });
  it('warns on lines that would all charge, $0 and implausible rates, and untaxed services (R3-C1, R3-m3, R3-M2)', () => {
    const svc = starterService('fuel');
    for (const p of svc.pricing) p.when = null;
    svc.pricing[0].rateE4 = 0;
    svc.pricing[1].rateE4 = 10_000_000_000; // $1,000,000/gal
    svc.taxRateBp = 725;
    const w = pricingWarnings(svc).join('\n');
    expect(w).toMatch(/"Diesel" and "Dyed diesel" and "Gasoline" and "Heating oil" both charge per delivered quantity on every job/);
    expect(w).toMatch(/"Diesel" is priced at \$0\.00/);
    expect(w).toMatch(/"Dyed diesel" at \$1,000,000\.00 per gal looks too high/);
    expect(w).toMatch(/A tax rate is set, but no line is taxable/);
    expect(pricingWarnings(fixtureServices().fuel)).toEqual([]);
  });
  it('dates rate changes so invoices can show the price date (R7-M3)', () => {
    const before = fixtureServices().fuel.pricing.map((p) => ({ ...p, rateSince: '2030-01-01' }));
    const after = before.map((p) => (p.id === 'fuel_diesel' ? { ...p, rateE4: 40900 } : p));
    const dated = datePriceChanges(before, after, '2030-03-04');
    expect(dated.find((p) => p.id === 'fuel_diesel')!.rateSince).toBe('2030-03-04');
    expect(dated.find((p) => p.id === 'fuel_gasoline')!.rateSince).toBe('2030-01-01');
  });
});

describe('quantity sanity (R7-M2)', () => {
  it('flags more than the truck holds or 3× the request', () => {
    expect(checkQuantity({ label: 'Delivered quantity', unit: 'gal', value: '99999', requested: '500', capacity: { name: 'Tank wagon 1', quantity: '3000' } }))
      .toMatchObject({ overCapacity: true, message: '99,999 gal is more than Tank wagon 1 holds (3,000 gal).' });
    expect(checkQuantity({ label: 'Delivered quantity', unit: 'gal', value: '1600', requested: '500', capacity: null }))
      .toMatchObject({ overRequested: true, message: '1,600 gal is more than 3 times the 500 gal requested.' });
    expect(checkQuantity({ label: 'Delivered quantity', unit: 'gal', value: '480', requested: '500', capacity: { name: 'Tank wagon 1', quantity: '3000' } }).message).toBeNull();
    expect(parseCapacity('3,000 gal')).toEqual({ quantity: 3000, unit: 'gal' });
    expect(parseCapacity('big')).toEqual({ quantity: null, unit: '' });
  });
});

describe('invoicing with the fixture company', () => {
  async function fuelJob(t: Awaited<ReturnType<typeof triCounty>>, customer: string, details: Record<string, unknown>) {
    const c = t.customers[customer];
    const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details, intent: 'open', clientRequestId: rid(), scheduledStart: new Date(Date.now() + 3600_000).toISOString() });
    expect(r.status).toBe(200);
    const job = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
    const a = await t.dana.post(`/c/${t.cid}/jobs/${job.id}/assign`, { userId: t.ids.luis, resourceIds: [t.trucks['Tank wagon 1']], version: job.version });
    expect(a.status).toBe(200);
    return { id: job.id as string, version: a.body.version as number };
  }
  const complete = (t: Awaited<ReturnType<typeof triCounty>>, job: { id: string; version: number }, values: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    t.luis.post(`/c/${t.cid}/jobs/${job.id}/complete`, { submissionId: rid(), baseVersion: job.version, outcome: 'completed', values, ...extra });

  it('bills the delivered product with tax, and no tax for an exempt customer', async () => {
    const t = await triCounty();
    const j = await fuelJob(t, 'grace', { product: 'Diesel', requested_qty: '120' });
    expect((await complete(t, j, { delivered_qty: '100' })).status).toBe(200);
    const inv = (await t.dana.post(`/c/${t.cid}/jobs/${j.id}/invoice`)).body;
    const d = (await t.dana.get(`/c/${t.cid}/invoices/${inv.invoiceId}`)).body;
    expect(d.lines.map((l: any) => [l.description, l.rateE4, l.amountMinor])).toEqual([['Diesel', 38990, 38990], ['Delivery fee', 250000, 2500]]);
    expect(d.invoice).toMatchObject({ subtotalMinor: 41490, taxMinor: 3008, totalMinor: 44498 });
    const farm = await fuelJob(t, 'hollis', { product: 'Dyed diesel', requested_qty: '100' });
    await complete(t, farm, { delivered_qty: '100' });
    const fi = (await t.dana.post(`/c/${t.cid}/jobs/${farm.id}/invoice`)).body;
    expect((await t.dana.get(`/c/${t.cid}/invoices/${fi.invoiceId}`)).body.invoice).toMatchObject({ taxMinor: 0, totalMinor: 37490 });
    // Rates never reach a dispatcher without finance access.
    const asMarcus = await t.marcus.get(`/c/${t.cid}/services`);
    expect(JSON.stringify(asMarcus.body)).not.toMatch(/38990|250000/);
  });

  it('asks the driver to confirm an impossible quantity, then holds the invoice for review (R7-M2, R7-m3)', async () => {
    const t = await triCounty();
    const j = await fuelJob(t, 'grace', { product: 'Diesel', requested_qty: '500' });
    const bad = await complete(t, j, { delivered_qty: 'abc' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields.delivered_qty).toBe('Delivered quantity must be a number of zero or more');
    const big = await complete(t, j, { delivered_qty: '99999' });
    expect(big.status).toBe(400);
    expect(big.body.error.message).toMatch(/99,999 gal is more than Tank wagon 1 holds \(3,000 gal\)/);
    const ok = await complete(t, j, { delivered_qty: '99999' }, { confirmQuantities: { delivered_qty: '99999' } });
    expect(ok.status).toBe(200);
    const inv = (await t.dana.post(`/c/${t.cid}/jobs/${j.id}/invoice`)).body;
    expect(inv.held).toBe(true);
    const d = (await t.dana.get(`/c/${t.cid}/invoices/${inv.invoiceId}`)).body.invoice;
    expect(d.holdReasons[0]).toMatch(/Check the quantity before approving: Delivered quantity 99,999 gal is more than Tank wagon 1 holds/);
  });

  it('bills the price at delivery and shows a change since booking (D4, R7-M3)', async () => {
    const t = await triCounty();
    const j = await fuelJob(t, 'grace', { product: 'Diesel', requested_qty: '100' });
    const svc = (await t.dana.get(`/c/${t.cid}/services`)).body.services.find((s: any) => s.id === t.services.fuel.id);
    const pricing = svc.pricing.map((p: any) => (p.id === 'fuel_diesel' ? { ...p, rateE4: 40900 } : p));
    expect((await t.dana.put(`/c/${t.cid}/services/${svc.id}`, { service: { ...svc, pricing }, version: svc.version })).status).toBe(200);
    await complete(t, j, { delivered_qty: '100' });
    const inv = (await t.dana.post(`/c/${t.cid}/jobs/${j.id}/invoice`)).body;
    const d = (await t.dana.get(`/c/${t.cid}/invoices/${inv.invoiceId}`)).body;
    const diesel = d.lines.find((l: any) => l.description === 'Diesel');
    expect(diesel).toMatchObject({ rateE4: 40900, amountMinor: 40900, bookedRateE4: 38990, note: 'Price changed since booking: $3.899 → $4.09' });
    expect(diesel.priceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Without finance access the price note and amounts are removed.
    const marcusView = await t.marcus.get(`/c/${t.cid}/jobs/${j.id}`);
    expect(JSON.stringify(marcusView.body)).not.toMatch(/40900|3\.899/);
  });

  it('keeps a minimum charge when the office edits other lines, and recomputes a line it changes', async () => {
    const t = await triCounty();
    const c = t.customers.dragon;
    const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.septic.id, details: { service_detail: 'Grease trap' }, intent: 'open', clientRequestId: rid(), scheduledStart: new Date(Date.now() + 3600_000).toISOString() });
    const job = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
    const a = await t.dana.post(`/c/${t.cid}/jobs/${job.id}/assign`, { userId: t.ids.sam, resourceIds: [t.trucks['Vac truck 2']], version: job.version });
    const done = await t.sam.post(`/c/${t.cid}/jobs/${job.id}/complete`, { submissionId: rid(), baseVersion: a.body.version, outcome: 'completed', values: { volume_pumped: '150' }, photos: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='] }); expect(done.status).toBe(200);
    const inv = (await t.dana.post(`/c/${t.cid}/jobs/${job.id}/invoice`)).body;
    const d = (await t.dana.get(`/c/${t.cid}/invoices/${inv.invoiceId}`)).body;
    expect(d.lines[0]).toMatchObject({ description: 'Grease trap', amountMinor: 20000 });
    const send = (lines: any[], version: number) => t.dana.put(`/c/${t.cid}/invoices/${inv.invoiceId}/lines`, { version, lines: lines.map(({ id, description, quantity, unit, rateE4, taxable, kind }) => ({ id, description, quantity, unit, rateE4, taxable, kind })) });
    // Adding a line leaves the grease trap line at its $200 minimum.
    const added = await send([...d.lines, { description: 'Disposal fee', quantity: '1', unit: '', rateE4: 250000, taxable: false, kind: 'charge' }], d.invoice.version);
    expect(added.status).toBe(200);
    const d2 = (await t.dana.get(`/c/${t.cid}/invoices/${inv.invoiceId}`)).body;
    expect(d2.lines.map((l: any) => [l.description, l.amountMinor])).toEqual([['Grease trap', 20000], ['Disposal fee', 2500]]);
    expect(d2.lines[0].note).toMatch(/Minimum charge/);
    expect(d2.invoice.totalMinor).toBe(22500);
    // Changing its quantity makes it an ordinary line again: quantity × rate.
    expect((await send([{ ...d2.lines[0], quantity: '300' }, d2.lines[1]], d2.invoice.version)).status).toBe(200);
    const d3 = (await t.dana.get(`/c/${t.cid}/invoices/${inv.invoiceId}`)).body;
    expect(d3.lines[0]).toMatchObject({ amountMinor: 28500, note: '' });
  });

  it('uses customer prices and lets only billing set exemptions and prices', async () => {
    const t = await triCounty();
    const cust = t.customers.ridgeline;
    const got = (await t.dana.get(`/c/${t.cid}/customers/${cust.id}`)).body.customer;
    expect((await t.marcus.patch(`/c/${t.cid}/customers/${cust.id}`, { priceOverrides: { [t.services.fuel.id]: { fuel_diesel: 37000 } }, version: got.version })).status).toBe(403);
    expect((await t.dana.patch(`/c/${t.cid}/customers/${cust.id}`, { priceOverrides: { [t.services.fuel.id]: { fuel_diesel: 37000, nope: 1 } }, version: got.version })).status).toBe(200);
    expect((await t.dana.get(`/c/${t.cid}/customers/${cust.id}`)).body.customer.priceOverrides).toEqual({ [t.services.fuel.id]: { fuel_diesel: 37000 } });
    expect((await t.marcus.get(`/c/${t.cid}/customers/${cust.id}`)).body.customer.priceOverrides).toBeUndefined();
    const j = await fuelJob(t, 'ridgeline', { product: 'Diesel', requested_qty: '100' });
    await complete(t, j, { delivered_qty: '100' });
    await processAll();
    const inv = (await t.dana.post(`/c/${t.cid}/jobs/${j.id}/invoice`)).body;
    const d = (await t.dana.get(`/c/${t.cid}/invoices/${inv.invoiceId}`)).body;
    expect(d.lines[0]).toMatchObject({ description: 'Diesel', rateE4: 37000, amountMinor: 37000 });
  });
});
