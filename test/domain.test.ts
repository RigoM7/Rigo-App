import { describe, it, expect } from 'vitest';
import { buildLines, computeTotals, parseMoney, formatInvoiceNumber } from '../src/shared/billing.js';
import { starterService, serviceInputSchema } from '../src/shared/services.js';
import { canTransition, missingForOpen, completionProblems } from '../src/shared/jobs.js';
import { defaultWorkflows, validateDefinition, simulate, stepDisposition, ACTIONS, approvalNeeded } from '../src/shared/workflows.js';
import { occurrences, billingPeriods, zonedToUtc, BILLING_FREQUENCIES } from '../src/shared/schedule.js';
import { accentVariants, contrast } from '../src/shared/branding.js';
import { proposeFromText } from '../src/shared/proposal.js';

describe('billing arithmetic', () => {
  it('rounds half up in minor units and never treats a missing rate as zero', () => {
    const svc = starterService('fuel');
    svc.pricing[0].rateMinor = 389;
    const { lines, holdReasons } = buildLines(svc.pricing, { product: 'Diesel', delivered_qty: '0.5' }, {});
    expect(holdReasons).toEqual([]);
    expect(lines[0].amountMinor).toBe(195); // 194.5 -> 195
    const missing = buildLines(starterService('fuel').pricing, { product: 'Diesel', delivered_qty: '10' }, {});
    expect(missing.lines[0].amountMinor).toBeNull();
    expect(computeTotals(missing.lines, null).totalMinor).toBeNull();
    const noQty = buildLines(svc.pricing, { product: 'Diesel' }, { delivered_qty: 'Delivered quantity' });
    expect(noQty.holdReasons[0]).toMatch(/Delivered quantity/);
  });
  it('applies discounts and tax deterministically and holds when tax is unconfigured', () => {
    const lines = [
      { description: 'A', quantity: '3', unit: '', rateMinor: 333, amountMinor: 999, taxable: true, kind: 'charge' as const },
      { description: 'B', quantity: '1', unit: '', rateMinor: 1001, amountMinor: 1001, taxable: false, kind: 'charge' as const },
    ];
    const t = computeTotals(lines, 825, [{ label: '10%', type: 'percent', percentBp: 1000 }]);
    expect(t).toMatchObject({ subtotalMinor: 2000, discountMinor: 200, taxMinor: 74, totalMinor: 1874 });
    expect(computeTotals(lines, null).totalMinor).toBeNull();
    expect(parseMoney('12.345')).toBeNull();
    expect(parseMoney('$1,234.50')).toBe(123450);
    expect(formatInvoiceNumber(7)).toBe('INV-00007');
  });
});

describe('price lines that depend on a field value', () => {
  const fuel = () => {
    const svc = starterService('fuel');
    const rates: Record<string, number> = { Diesel: 419, Gasoline: 389, 'Heating oil': 359 };
    for (const p of svc.pricing) if (p.when?.field === 'product') p.rateMinor = rates[p.when.equals];
    return svc;
  };
  const types = (svc: ReturnType<typeof starterService>) => Object.fromEntries(svc.fields.map((f) => [f.key, f.type]));
  const labels = (svc: ReturnType<typeof starterService>) => Object.fromEntries(svc.fields.map((f) => [f.key, f.label]));

  it('the fuel example has one per-gallon line per product, rates empty', () => {
    const svc = starterService('fuel');
    const perProduct = svc.pricing.filter((p) => p.when?.field === 'product');
    expect(perProduct.map((p) => p.when?.equals)).toEqual(['Diesel', 'Gasoline', 'Heating oil']);
    expect(perProduct.every((p) => p.basis === 'per_quantity' && p.quantityField === 'delivered_qty' && p.rateMinor === null)).toBe(true);
    expect(svc.fields.find((f) => f.key === 'after_hours')?.type).toBe('boolean');
    expect(svc.pricing.find((p) => p.when?.field === 'after_hours')).toMatchObject({ when: { field: 'after_hours', equals: 'true' }, rateMinor: null });
    expect(starterService('septic').pricing.some((p) => p.when?.field === 'after_hours')).toBe(true);
    expect(serviceInputSchema.safeParse(svc).success).toBe(true);
  });

  it('charges only the line for the chosen product, named after it, with exact rounding', () => {
    const svc = fuel();
    const { lines, holdReasons } = buildLines(svc.pricing, { product: 'Gasoline', delivered_qty: '187.4' }, labels(svc), types(svc));
    expect(holdReasons).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ description: 'Gasoline', quantity: '187.4', unit: 'gal', rateMinor: 389, amountMinor: 72899 }); // 187.4 x $3.89 = $728.986
    const diesel = buildLines(svc.pricing, { product: 'Diesel', delivered_qty: '10' }, labels(svc), types(svc));
    expect(diesel.lines.map((l) => [l.description, l.amountMinor])).toEqual([['Diesel', 4190]]);
  });

  it('holds with a clear reason when no line matches the chosen value, or no value is chosen', () => {
    const svc = fuel();
    svc.pricing = svc.pricing.filter((p) => p.when?.equals !== 'Heating oil');
    const r = buildLines(svc.pricing, { product: 'Heating oil', delivered_qty: '50' }, labels(svc), types(svc));
    expect(r.holdReasons.join(' ')).toMatch(/No price for product 'Heating oil'/);
    expect(computeTotals(r.lines, null).holdReasons).toContain('The invoice has no charge lines.');
    const none = buildLines(svc.pricing, { delivered_qty: '50' }, labels(svc), types(svc));
    expect(none.holdReasons.join(' ')).toMatch(/Choose product/i);
    // A matching line with no rate still holds; it is never priced at zero.
    const unpriced = buildLines(starterService('fuel').pricing, { product: 'Diesel', delivered_qty: '50' }, labels(svc), types(svc));
    expect(unpriced.lines[0].amountMinor).toBeNull();
    expect(unpriced.holdReasons.join(' ')).toMatch(/No rate is set for "Diesel"/);
  });

  it('adds a yes/no fee only when it applies, and combines taxable and non-taxable lines', () => {
    const svc = starterService('septic');
    for (const p of svc.pricing) p.rateMinor = p.when?.field === 'after_hours' ? 15000 : p.basis === 'per_quantity' ? 35 : 9500;
    const fee = svc.pricing.find((p) => p.when?.field === 'after_hours')!;
    fee.taxable = true;
    const night = buildLines(svc.pricing, { service_detail: 'Pump-out', volume_pumped: '1200', after_hours: true }, labels(svc), types(svc));
    expect(night.holdReasons).toEqual([]);
    expect(night.lines.map((l) => [l.description, l.quantity, l.amountMinor, l.taxable])).toEqual([['Pump-out', '1200', 42000, false], ['After-hours visit', '1', 15000, true]]);
    expect(computeTotals(night.lines, 825)).toMatchObject({ subtotalMinor: 57000, taxMinor: 1238, totalMinor: 58238 }); // 8.25% of $150.00 = $12.375
    const day = buildLines(svc.pricing, { service_detail: 'Pump-out', volume_pumped: '1200', after_hours: false }, labels(svc), types(svc));
    expect(day.lines.map((l) => l.description)).toEqual(['Pump-out']);
    const unset = buildLines(svc.pricing, { service_detail: 'Inspection' }, labels(svc), types(svc));
    expect(unset.lines.map((l) => l.description)).toEqual(['Inspection']);
  });

  it('validates the condition: the field must exist and be a choice list or yes/no', () => {
    const svc = starterService('fuel');
    svc.pricing[0].when = { field: 'nope', equals: 'Diesel' };
    expect(serviceInputSchema.safeParse(svc).success).toBe(false);
    svc.pricing[0].when = { field: 'delivered_qty', equals: '5' };
    expect(serviceInputSchema.safeParse(svc).success).toBe(false);
    svc.pricing[0].when = { field: 'product', equals: 'Kerosene' };
    expect(serviceInputSchema.safeParse(svc).success).toBe(false);
    svc.pricing[0].when = { field: 'product', equals: 'Diesel' };
    expect(serviceInputSchema.safeParse(svc).success).toBe(true);
  });
});

describe('job rules', () => {
  it('blocks invalid transitions and lists missing information', () => {
    expect(canTransition('completed', 'open')).toBe(false);
    expect(canTransition('draft', 'in_progress')).toBe(false);
    expect(canTransition('open', 'unsuccessful')).toBe(true);
    const svc = starterService('fuel');
    expect(missingForOpen({ customer_id: 'x', location_id: null, service_id: 'y', details: {} }, svc.fields)).toEqual(['Choose a service location', 'Enter product']);
    expect(completionProblems({ outcome: 'partial', values: {}, notes: '', reason: '', photoCount: 0, hasSignature: false, signerName: '' }, { fields: svc.fields, requires_photo: true, requires_signature: false }).reason).toBeTruthy();
  });
});

describe('workflow rules', () => {
  const env = { roles: ['owner', 'dispatcher', 'driver', 'office'], emailAvailable: false, isDemo: false };
  it('default workflows validate; missing subjects and approvers are errors', () => {
    for (const w of defaultWorkflows()) expect(validateDefinition(w.definition, env).ok).toBe(true);
    const bad = structuredClone(defaultWorkflows()[0].definition);
    bad.steps = [bad.steps[1]];
    expect(validateDefinition(bad, env).errors.join(' ')).toMatch(/needs an invoice/);
    const noApprover = structuredClone(defaultWorkflows()[0].definition);
    noApprover.steps[1].approval.approverRoles = [];
    expect(validateDefinition(noApprover, env).ok).toBe(false);
  });
  it('modes decide disposition; approvals are never skipped by mode', () => {
    expect(stepDisposition('manual', ACTIONS['invoice.prepare'])).toBe('suggest');
    expect(stepDisposition('assisted', ACTIONS['invoice.issue'])).toBe('propose');
    expect(stepDisposition('automatic', ACTIONS['invoice.issue'])).toBe('run');
    const def = defaultWorkflows()[0].definition;
    const sim = simulate(def, { mode: 'automatic', overrideMode: null, facts: {}, emailAvailable: false, isDemo: false, sampleHasRates: true });
    expect(sim.steps[1].outcome).toMatch(/approval/);
    expect(approvalNeeded({ required: 'conditional', conditions: [{ field: 'invoice.total_minor', op: 'gt', value: 50000 }], approverRoles: ['owner'], approverUserIds: [], backupUserIds: [], escalateAfterHours: null }, { 'invoice.total_minor': 1000 })).toBe(false);
  });
  it('the guided builder proposes validated definitions and says what it did not understand', () => {
    const p = proposeFromText('When a septic job is completed, prepare an invoice and ask the owner to approve it');
    expect(p.definition?.trigger.event).toBe('job.completed');
    expect(p.definition?.conditions[0]).toMatchObject({ value: 'septic' });
    expect(validateDefinition(p.definition!, env).ok).toBe(true);
    expect(proposeFromText('make it nice').definition).toBeNull();
  });
});

describe('schedules and time zones', () => {
  it('computes weekly/monthly occurrences and billing periods independently', () => {
    expect(occurrences({ frequency: 'weekly', interval: 1, weekdays: [1], time: '08:00', durationMinutes: 60 }, '2030-01-01', null, '2030-01-01', '2030-01-31')).toEqual(['2030-01-07', '2030-01-14', '2030-01-21', '2030-01-28']);
    expect(occurrences({ frequency: 'monthly', interval: 1, weekdays: [], dayOfMonth: 31, time: '08:00', durationMinutes: 60 }, '2030-01-31', null, '2030-01-01', '2030-03-31')).toEqual(['2030-01-31', '2030-02-28', '2030-03-31']);
    expect(billingPeriods('monthly', '2030-01-15', null, null, '2030-03-01').map((p) => p.start)).toEqual(['2030-01-15', '2030-02-15']);
    expect(billingPeriods('monthly', '2030-01-15', null, '2030-01-15', '2030-03-01').map((p) => p.start)).toEqual(['2030-02-15']);
  });
  it('bills every 28 days from the plan start, across month ends and daylight-saving changes', () => {
    const p = billingPeriods('every_n_days', '2030-01-20', null, null, '2030-04-30', 28);
    expect(p).toEqual([
      { start: '2030-01-20', end: '2030-02-16' }, { start: '2030-02-17', end: '2030-03-16' },
      { start: '2030-03-17', end: '2030-04-13' }, { start: '2030-04-14', end: '2030-05-11' },
    ]);
    // US daylight saving starts 2030-03-10: periods stay 28 calendar days in the company's zone.
    expect(p.every((x) => (Date.parse(x.end) - Date.parse(x.start)) / 86400000 === 27)).toBe(true);
    expect(billingPeriods('every_n_days', '2030-01-20', null, '2030-02-17', '2030-04-30', 28).map((x) => x.start)).toEqual(['2030-03-17', '2030-04-14']);
    expect(billingPeriods('every_n_days', '2030-01-20', '2030-03-01', null, '2030-04-30', 28).at(-1)).toEqual({ start: '2030-02-17', end: '2030-03-01' });
    expect(BILLING_FREQUENCIES.every_n_days(28)).toBe('Every 4 weeks (28 days)');
    expect(BILLING_FREQUENCIES.every_n_days(10)).toBe('Every 10 days');
  });
  it('converts wall-clock times across DST', () => {
    expect(zonedToUtc('2030-07-01', '08:00', 'America/Chicago').toISOString()).toBe('2030-07-01T13:00:00.000Z');
    expect(zonedToUtc('2030-01-01', '08:00', 'America/Chicago').toISOString()).toBe('2030-01-01T14:00:00.000Z');
  });
});

describe('branding contrast', () => {
  it('produces accessible accent variants', () => {
    const v = accentVariants('#F59E0B');
    expect(contrast(v.light, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(v.dark, '#161618')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#B91C1C', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#DC2626', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });
});
