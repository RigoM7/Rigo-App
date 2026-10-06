import Big from 'big.js';
import type { FieldDef, PriceLine } from './services.js';

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

/** The value a price-line condition compares against: yes/no fields become "true"/"false". */
function conditionValue(v: unknown) {
  if (v === true || v === 'true') return 'true';
  if (v === false || v === 'false') return 'false';
  return v === undefined || v === null ? '' : String(v);
}

/** Does this price line apply to the job's values? Lines without a condition always apply. */
export function lineApplies(p: Pick<PriceLine, 'when'>, values: Record<string, unknown>) {
  return !p.when || conditionValue(values[p.when.field]) === p.when.equals;
}

/**
 * Build charge lines from a service's price lines and the job's confirmed values. Conditional lines
 * are charged only when the job's value matches; a choice with no matching line holds the invoice.
 * `fieldTypes` (key -> field type) tells choice lists apart from yes/no fields.
 */
export function buildLines(pricing: PriceLine[], values: Record<string, unknown>, fieldLabels: Record<string, string>, fieldTypes: Record<string, string> = {}) {
  const lines: DraftLine[] = [];
  const holdReasons: string[] = [];
  if (pricing.length === 0) holdReasons.push('This service has no pricing configured.');
  const label = (k: string) => fieldLabels[k] ?? k;
  // Choice fields that decide which line applies: the job must have a value, and a line must match it.
  const isYesNo = (k: string, equals: string[]) => fieldTypes[k] ? fieldTypes[k] === 'boolean' : equals.every((e) => e === 'true' || e === 'false');
  const choiceFields = [...new Set(pricing.filter((p) => p.when).map((p) => p.when!.field))];
  for (const k of choiceFields) {
    if (isYesNo(k, pricing.filter((p) => p.when?.field === k).map((p) => p.when!.equals))) continue;
    const v = conditionValue(values[k]);
    if (!v) holdReasons.push(`Choose ${label(k).toLowerCase()} on the job so Rigo knows which price to use.`);
    else if (!pricing.some((p) => p.when?.field === k && p.when.equals === v)) holdReasons.push(`No price for ${label(k).toLowerCase()} '${v}'. Add a price line for it in Services.`);
  }
  for (const p of pricing) {
    if (!lineApplies(p, values)) continue;
    let quantity = '1';
    let missingQty = false;
    if (p.basis === 'per_quantity') {
      const raw = values[p.quantityField];
      if (raw === undefined || raw === null || raw === '' || !/^\d+(\.\d+)?$/.test(String(raw))) {
        holdReasons.push(`Missing confirmed quantity "${label(p.quantityField)}" for "${p.label}".`);
        quantity = '0';
        missingQty = true;
      } else quantity = String(raw);
    }
    if (p.rateMinor === null) holdReasons.push(`No rate is set for "${p.label}". Add it in Services before this invoice can be approved.`);
    // Name the matched choice on the invoice ("Fuel: Diesel") unless the label already says it.
    const chosen = p.when && !isYesNo(p.when.field, [p.when.equals]) ? p.when.equals : '';
    const description = chosen && !p.label.toLowerCase().includes(chosen.toLowerCase()) ? `${p.label}: ${chosen}` : p.label;
    lines.push({ description, quantity, unit: p.unit || '', rateMinor: p.rateMinor, amountMinor: missingQty ? null : lineAmount(quantity, p.rateMinor), taxable: p.taxable, kind: 'charge' });
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

/**
 * A plain note when the confirmed quantity differs from what was requested, for example
 * "Delivered 187.4 gal of 200 requested". Compares a priced completion quantity with a request
 * field of the same unit; returns null when they match or either is missing.
 */
export function quantityNote(fields: Pick<FieldDef, 'key' | 'label' | 'type' | 'unit' | 'stage'>[], pricing: Pick<PriceLine, 'basis' | 'quantityField' | 'when'>[], values: Record<string, unknown>) {
  const num = (v: unknown) => (v === undefined || v === null || v === '' || !/^\d+(\.\d+)?$/.test(String(v)) ? null : new Big(String(v)));
  for (const p of pricing) {
    if (p.basis !== 'per_quantity' || !lineApplies(p, values)) continue;
    const q = fields.find((f) => f.key === p.quantityField && f.type === 'number');
    if (!q || q.stage === 'request') continue;
    const req = fields.find((f) => f.key !== q.key && f.type === 'number' && f.stage === 'request' && (f.unit ?? '') === (q.unit ?? ''));
    const a = num(values[q.key]), b = req ? num(values[req.key]) : null;
    if (!req || !a || !b || a.eq(b)) continue;
    const verb = q.label.replace(/\s+(quantity|qty|amount)$/i, '');
    const unit = q.unit ? ` ${q.unit}` : '';
    return `${verb} ${a.toString()}${unit} of ${b.toString()} requested`;
  }
  return null;
}
