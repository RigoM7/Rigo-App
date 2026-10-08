import Big from 'big.js';

// Deterministic money arithmetic for invoices. Amounts are integer minor units (e.g. cents); quantities are
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

/**
 * Rates are stored in ten-thousandths of the currency unit (owner decision D3): $3.8995/gal is
 * 38995. Line amounts and totals are minor units (cents), rounded half up once per line.
 */
export const RATE_SCALE = 10_000;

/** "3.8995" or "$1,250" into ten-thousandths (up to 4 decimals); null for invalid input. */
export function parseRate(input: string): number | null {
  const s = input.trim().replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;
  return Number(new Big(s).times(RATE_SCALE).round(0).toString());
}

/** Input text for a rate: at least 2 decimals, up to 4 ("3.8995", "375.00"). */
export function rateToInput(rateE4: number | null | undefined) {
  if (rateE4 === null || rateE4 === undefined) return '';
  const fixed = new Big(rateE4).div(RATE_SCALE).toFixed(4);
  return fixed.replace(/(\.\d{2}\d*?)0+$/, '$1');
}

/** "$3.8995", "$3.899", "$375.00": shows the cents and any extra precision the rate has. */
export function formatRate(rateE4: number | null | undefined, currency = 'USD', locale = 'en-US') {
  if (rateE4 === null || rateE4 === undefined) return '—';
  const digits = rateToInput(rateE4).split('.')[1]?.length ?? 2;
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(rateE4 / RATE_SCALE);
}

/** A rate in ten-thousandths rounded to whole minor units (for older readers that expect cents). */
export function rateToMinor(rateE4: number | null) {
  return rateE4 === null ? null : Number(new Big(rateE4).div(100).round(0).toString());
}

export interface DraftLine {
  description: string;
  quantity: string;
  unit: string;
  /** Rate in ten-thousandths of the currency (D3). */
  rateE4: number | null;
  amountMinor: number | null;
  taxable: boolean;
  kind: 'charge' | 'discount';
  /** Shown under the line: "Minimum charge applies", "Price changed since booking: $3.89 → $4.09". */
  note?: string;
  /** The date the rate took effect, for "price on Oct 6". */
  priceDate?: string | null;
  /** The rate when the job was booked, when it differs from the rate charged. */
  bookedRateE4?: number | null;
  /** Discount lines only: a percentage of the charges (10% = 1000) instead of a fixed amount. */
  percentBp?: number | null;
}

export interface DiscountInput { label: string; type: 'percent' | 'fixed'; percentBp?: number; amountMinor?: number }

export interface Totals {
  subtotalMinor: number | null;
  discountMinor: number | null;
  taxMinor: number | null;
  totalMinor: number | null;
  holdReasons: string[];
}

/** quantity × rate, in cents, rounded half up (the one rounding rule, D3). */
export function lineAmount(quantity: string, rateE4: number | null): number | null {
  if (rateE4 === null) return null;
  return Number(new Big(quantity).times(rateE4).div(100).round(0).toString());
}

/**
 * Work out discount lines: a percent line takes that share of the charges, a fixed line its rate.
 * More discount than charges is refused (`excessMinor` > 0) unless `allowFree`, which trims the
 * discounts so the printed lines always add up to the total ($0).
 */
export function resolveDiscounts(lines: DraftLine[], opts: { allowFree?: boolean } = {}): { lines: DraftLine[]; excessMinor: number } {
  const charges = lines.filter((l) => l.kind === 'charge');
  const subtotal = charges.some((l) => l.amountMinor === null) ? null : charges.reduce((s, l) => s + (l.amountMinor as number), 0);
  let out = lines.map((l): DraftLine => {
    if (l.kind !== 'discount') return l;
    if (l.percentBp !== null && l.percentBp !== undefined) {
      return { ...l, quantity: '1', unit: '', rateE4: null, amountMinor: subtotal === null ? null : -Number(new Big(subtotal).times(l.percentBp).div(10000).round(0).toString()) };
    }
    return { ...l, amountMinor: l.rateE4 === null ? null : -Math.abs(lineAmount(l.quantity, l.rateE4) as number) };
  });
  if (subtotal === null) return { lines: out, excessMinor: 0 };
  const discount = out.filter((l) => l.kind === 'discount').reduce((s, l) => s + Math.abs(l.amountMinor ?? 0), 0);
  const excess = discount - subtotal;
  if (excess <= 0) return { lines: out, excessMinor: 0 };
  if (!opts.allowFree) return { lines: out, excessMinor: excess };
  // Free invoice: take the excess off the last discounts so the lines add up to exactly $0.
  let left = excess;
  out = [...out].reverse().map((l) => {
    if (l.kind !== 'discount' || left === 0) return l;
    const cut = Math.min(left, Math.abs(l.amountMinor ?? 0));
    left -= cut;
    return { ...l, amountMinor: -(Math.abs(l.amountMinor ?? 0) - cut), note: [l.note, 'Reduced so the invoice is free, not negative'].filter(Boolean).join(' · ') };
  }).reverse();
  return { lines: out, excessMinor: 0 };
}

export function computeTotals(lines: DraftLine[], taxRateBp: number | null, discounts: DiscountInput[] = [], opts: { taxExempt?: boolean } = {}): Totals {
  const holdReasons: string[] = [];
  const charges = lines.filter((l) => l.kind === 'charge');
  if (charges.length === 0) holdReasons.push('The invoice has no charge lines.');
  if (charges.some((l) => l.rateE4 === null || l.amountMinor === null)) {
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
  // A tax-exempt customer pays no tax, whatever the service's rate (exemption beats service tax).
  if (taxableSubtotal > 0 && !opts.taxExempt) {
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

/** One line of work as it will be billed: what, how many, at what rate (null: no price set). */
export interface LineInput { description: string; quantity: string; unit?: string; rateE4: number | null; taxable: boolean }

const isQuantity = (q: string) => /^\d+(\.\d+)?$/.test(q.trim());

/**
 * Prices lines exactly. A missing rate or quantity is never treated as zero: the line has no
 * amount and the invoice is held with a reason a person can act on.
 */
export function priceLines(inputs: LineInput[]): { lines: DraftLine[]; holdReasons: string[] } {
  const holdReasons: string[] = [];
  const lines = inputs.map((l): DraftLine => {
    const okQty = isQuantity(l.quantity);
    if (l.rateE4 === null) holdReasons.push(`No price is set for "${l.description}". Add it before this invoice can be approved.`);
    if (!okQty) holdReasons.push(`"${l.description}" needs a quantity.`);
    return { description: l.description, quantity: okQty ? l.quantity.trim() : '0', unit: l.unit ?? '', rateE4: l.rateE4, taxable: l.taxable, kind: 'charge',
      amountMinor: okQty ? lineAmount(l.quantity.trim(), l.rateE4) : null };
  });
  return { lines, holdReasons };
}

export function formatInvoiceNumber(seq: number, prefix = 'INV-') {
  return `${prefix}${String(seq).padStart(5, '0')}`;
}
