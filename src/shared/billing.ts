import Big from 'big.js';
import type { PriceLine } from './services.js';

// Deterministic invoice arithmetic. Amounts are integer minor units (e.g. cents); quantities are
// exact decimals. Rounding is half-up at the line, discount and tax level. AI never computes these.

Big.RM = Big.roundHalfUp;

export const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'MXN'] as const;

export function formatMoney(minor: number | null | undefined, currency = 'USD', locale = 'en-US') {
  if (minor === null || minor === undefined) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100);
}

/** Parse "12.34" into 1234 minor units; returns null for invalid input. */
export function parseMoney(input: string): number | null {
  const s = input.trim().replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Number(new Big(s).times(100).round(0).toString());
}

export function minorToInput(minor: number | null | undefined) {
  if (minor === null || minor === undefined) return '';
  return new Big(minor).div(100).toFixed(2);
}

export interface DraftLine {
  description: string;
  quantity: string;
  unit: string;
  rateMinor: number | null;
  amountMinor: number | null;
  taxable: boolean;
  kind: 'charge' | 'discount';
}

export interface DiscountInput { label: string; type: 'percent' | 'fixed'; percentBp?: number; amountMinor?: number }

export interface Totals {
  subtotalMinor: number | null;
  discountMinor: number | null;
  taxMinor: number | null;
  totalMinor: number | null;
  holdReasons: string[];
}

export function lineAmount(quantity: string, rateMinor: number | null): number | null {
  if (rateMinor === null) return null;
  return Number(new Big(quantity).times(rateMinor).round(0).toString());
}

/** Build charge lines from a service's price lines and the job's confirmed completion values. */
export function buildLines(pricing: PriceLine[], values: Record<string, unknown>, fieldLabels: Record<string, string>) {
  const lines: DraftLine[] = [];
  const holdReasons: string[] = [];
  if (pricing.length === 0) holdReasons.push('This service has no pricing configured.');
  for (const p of pricing) {
    let quantity = '1';
    let missingQty = false;
    if (p.basis === 'per_quantity') {
      const raw = values[p.quantityField];
      if (raw === undefined || raw === null || raw === '' || !/^\d+(\.\d+)?$/.test(String(raw))) {
        holdReasons.push(`Missing confirmed quantity "${fieldLabels[p.quantityField] ?? p.quantityField}" for "${p.label}".`);
        quantity = '0';
        missingQty = true;
      } else quantity = String(raw);
    }
    if (p.rateMinor === null) holdReasons.push(`No rate is set for "${p.label}". Add it in Services before this invoice can be approved.`);
    lines.push({ description: p.label, quantity, unit: p.unit || '', rateMinor: p.rateMinor, amountMinor: missingQty ? null : lineAmount(quantity, p.rateMinor), taxable: p.taxable, kind: 'charge' });
  }
  return { lines, holdReasons };
}

export function computeTotals(lines: DraftLine[], taxRateBp: number | null, discounts: DiscountInput[] = []): Totals {
  const holdReasons: string[] = [];
  const charges = lines.filter((l) => l.kind === 'charge');
  if (charges.length === 0) holdReasons.push('The invoice has no charge lines.');
  if (charges.some((l) => l.rateMinor === null || l.amountMinor === null)) {
    holdReasons.push('One or more lines are missing a rate or quantity.');
    return { subtotalMinor: null, discountMinor: null, taxMinor: null, totalMinor: null, holdReasons };
  }
  const subtotal = charges.reduce((s, l) => s + (l.amountMinor as number), 0);
  const taxableSubtotal = charges.filter((l) => l.taxable).reduce((s, l) => s + (l.amountMinor as number), 0);
  let discount = 0;
  for (const d of discounts) {
    if (d.type === 'percent') discount += Number(new Big(subtotal).times(d.percentBp ?? 0).div(10000).round(0).toString());
    else discount += d.amountMinor ?? 0;
  }
  for (const l of lines.filter((x) => x.kind === 'discount')) discount += Math.abs(l.amountMinor ?? 0);
  if (discount > subtotal) { holdReasons.push('Discounts exceed the subtotal.'); discount = subtotal; }
  let tax = 0;
  if (taxableSubtotal > 0) {
    if (taxRateBp === null) {
      holdReasons.push('Some lines are taxable but no tax rate is configured for this service.');
      return { subtotalMinor: subtotal, discountMinor: discount, taxMinor: null, totalMinor: null, holdReasons };
    }
    // Discounts reduce the taxable base in proportion to the taxable share of the subtotal.
    const taxableDiscount = subtotal === 0 ? 0 : Number(new Big(discount).times(taxableSubtotal).div(subtotal).round(0).toString());
    tax = Number(new Big(taxableSubtotal - taxableDiscount).times(taxRateBp).div(10000).round(0).toString());
  }
  return { subtotalMinor: subtotal, discountMinor: discount, taxMinor: tax, totalMinor: subtotal - discount + tax, holdReasons };
}

export function formatInvoiceNumber(seq: number, prefix = 'INV-') {
  return `${prefix}${String(seq).padStart(5, '0')}`;
}
