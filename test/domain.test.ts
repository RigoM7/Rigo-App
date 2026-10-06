import { describe, it, expect } from 'vitest';
import { buildLines, computeTotals, parseMoney, formatInvoiceNumber } from '../src/shared/billing.js';
import { starterService } from '../src/shared/services.js';
import { canTransition, missingForOpen, completionProblems } from '../src/shared/jobs.js';
import { defaultWorkflows, validateDefinition, simulate, stepDisposition, ACTIONS, approvalNeeded } from '../src/shared/workflows.js';
import { occurrences, billingPeriods, zonedToUtc } from '../src/shared/schedule.js';
import { accentVariants, contrast } from '../src/shared/branding.js';
import { proposeFromText } from '../src/shared/proposal.js';

describe('billing arithmetic', () => {
  it('rounds half up in minor units and never treats a missing rate as zero', () => {
    const svc = starterService('fuel');
    svc.pricing[0].rateMinor = 389;
    const { lines, holdReasons } = buildLines(svc.pricing, { delivered_qty: '0.5' }, {});
    expect(holdReasons).toEqual([]);
    expect(lines[0].amountMinor).toBe(195); // 194.5 -> 195
    const missing = buildLines(starterService('fuel').pricing, { delivered_qty: '10' }, {});
    expect(missing.lines[0].amountMinor).toBeNull();
    expect(computeTotals(missing.lines, null).totalMinor).toBeNull();
    const noQty = buildLines(svc.pricing, {}, { delivered_qty: 'Delivered quantity' });
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
