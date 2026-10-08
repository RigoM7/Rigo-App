import { describe, it, expect } from 'vitest';
import { priceLines, computeTotals, parseMoney, formatInvoiceNumber, parseRate, formatRate, rateToInput, lineAmount } from '../src/shared/money.js';
import { balanceDue, paymentState, agingBucket, dueDateFor } from '../src/shared/invoices.js';
import { occurrences, zonedToUtc } from '../src/shared/schedule.js';

// Exact money, kept from the earlier app: minor units, half-up rounding per line, a missing price
// holds the invoice and is never treated as zero (CLAUDE.md, rules that never bend).

describe('billing arithmetic', () => {
  it('rounds half up in minor units and never treats a missing rate as zero', () => {
    const { lines, holdReasons } = priceLines([{ description: 'Diesel', quantity: '0.5', unit: 'gal', rateE4: 38900, taxable: false }]);
    expect(holdReasons).toEqual([]);
    expect(lines[0].amountMinor).toBe(195); // 194.5 -> 195
    const missing = priceLines([{ description: 'Diesel', quantity: '10', rateE4: null, taxable: false }]);
    expect(missing.lines[0].amountMinor).toBeNull();
    expect(missing.holdReasons[0]).toMatch(/No price is set for "Diesel"/);
    expect(computeTotals(missing.lines, null).totalMinor).toBeNull();
    const noQty = priceLines([{ description: 'Delivered quantity', quantity: '', rateE4: 38900, taxable: false }]);
    expect(noQty.holdReasons[0]).toMatch(/Delivered quantity/);
    expect(noQty.lines[0].amountMinor).toBeNull();
  });

  it('applies discounts and tax deterministically and holds when tax is unconfigured', () => {
    const lines = [
      { description: 'A', quantity: '3', unit: '', rateE4: 33300, amountMinor: 999, taxable: true, kind: 'charge' as const },
      { description: 'B', quantity: '1', unit: '', rateE4: 100100, amountMinor: 1001, taxable: false, kind: 'charge' as const },
    ];
    const t = computeTotals(lines, 825, [{ label: '10%', type: 'percent', percentBp: 1000 }]);
    expect(t).toMatchObject({ subtotalMinor: 2000, discountMinor: 200, taxMinor: 74, totalMinor: 1874 });
    expect(computeTotals(lines, null).totalMinor).toBeNull();
    expect(parseMoney('12.345')).toBeNull();
    expect(parseMoney('$1,234.50')).toBe(123450);
    expect(formatInvoiceNumber(7)).toBe('INV-00007');
  });

  it('a tax-exempt customer pays no tax, and an invoice with no lines is held', () => {
    const lines = priceLines([{ description: 'Cake', quantity: '2', rateE4: 250000, taxable: true }]).lines;
    expect(computeTotals(lines, 800, [], { taxExempt: true })).toMatchObject({ taxMinor: 0, totalMinor: 5000 });
    expect(computeTotals(lines, 800)).toMatchObject({ taxMinor: 400, totalMinor: 5400 });
    expect(computeTotals([], 800).holdReasons).toContain('The invoice has no charge lines.');
  });
});

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
});

describe('what is owed, and how late', () => {
  it('balances never go below zero and ages by due date', () => {
    expect(balanceDue({ totalMinor: 1000, paidMinor: 1200 })).toBe(0);
    expect(balanceDue({ totalMinor: null, paidMinor: 0 })).toBeNull();
    expect(dueDateFor('2030-01-01', 30)).toBe('2030-01-31');
    expect(agingBucket('2030-01-31', '2030-01-31')).toBe('current');
    expect(agingBucket('2030-01-31', '2030-02-15')).toBe('d1_30');
    expect(agingBucket('2030-01-31', '2030-03-15')).toBe('d31_60');
    expect(agingBucket('2030-01-31', '2030-05-15')).toBe('d60_plus');
    expect(paymentState({ status: 'issued', paymentStatus: 'unpaid', dueDate: '2030-01-31' }, '2030-02-02')).toMatchObject({ key: 'overdue', label: 'Overdue 2 days' });
  });
});

describe('schedules and time zones', () => {
  it('computes weekly and monthly occurrences', () => {
    expect(occurrences({ frequency: 'weekly', interval: 1, weekdays: [1], time: '08:00', durationMinutes: 60 }, '2030-01-01', null, '2030-01-01', '2030-01-31')).toEqual(['2030-01-07', '2030-01-14', '2030-01-21', '2030-01-28']);
    expect(occurrences({ frequency: 'monthly', interval: 1, weekdays: [], dayOfMonth: 31, time: '08:00', durationMinutes: 60 }, '2030-01-31', null, '2030-01-01', '2030-03-31')).toEqual(['2030-01-31', '2030-02-28', '2030-03-31']);
  });
  it('converts wall-clock times across DST', () => {
    expect(zonedToUtc('2030-07-01', '08:00', 'America/Chicago').toISOString()).toBe('2030-07-01T13:00:00.000Z');
    expect(zonedToUtc('2030-01-01', '08:00', 'America/Chicago').toISOString()).toBe('2030-01-01T14:00:00.000Z');
  });
});
