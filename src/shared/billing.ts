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

const isQty = (raw: unknown) => raw !== undefined && raw !== null && raw !== '' && /^\d+(\.\d+)?$/.test(String(raw));
const fmtQty = (q: string) => { const [i, d] = q.split('.'); return `${Number(i).toLocaleString('en-US')}${d ? `.${d}` : ''}`; };

export interface BuildOptions {
  /** Customer-specific rates by price-line id (ten-thousandths), which replace the service rate. */
  overrides?: Record<string, number>;
  /** Rates when the job was booked, by price-line id; a different rate today is flagged on the line. */
  bookedRates?: Record<string, number | null>;
  currency?: string;
}

/**
 * Build charge lines from a service's price lines and the job's confirmed values. Conditional lines
 * are charged only when the job's value matches; a choice with no matching line holds the invoice.
 * Flat lines can include a quantity with an overage rate beyond it; per-unit lines can have a
 * minimum charge. `fieldTypes` (key -> field type) tells choice lists apart from yes/no fields.
 */
export function buildLines(pricing: PriceLine[], values: Record<string, unknown>, fieldLabels: Record<string, string>, fieldTypes: Record<string, string> = {}, opts: BuildOptions = {}) {
  const lines: DraftLine[] = [];
  const holdReasons: string[] = [];
  const currency = opts.currency ?? 'USD';
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
    const rate = opts.overrides && p.id in opts.overrides ? opts.overrides[p.id] : p.rateE4;
    const booked = opts.bookedRates?.[p.id];
    const changed = booked !== undefined && booked !== null && rate !== null && booked !== rate;
    const priceNote = changed ? `Price changed since booking: ${formatRate(booked, currency)} → ${formatRate(rate, currency)}` : '';
    // Name the matched choice on the invoice ("Fuel: Diesel") unless the label already says it.
    const chosen = p.when && !isYesNo(p.when.field, [p.when.equals]) ? p.when.equals : '';
    const description = chosen && !p.label.toLowerCase().includes(chosen.toLowerCase()) ? `${p.label}: ${chosen}` : p.label;
    if (rate === null) holdReasons.push(`No rate is set for "${p.label}". Add it in Services before this invoice can be approved.`);
    const base = { unit: p.unit || '', taxable: p.taxable, kind: 'charge' as const, priceDate: p.rateSince ?? null, bookedRateE4: changed ? booked : null };
    if (p.basis === 'per_quantity') {
      const raw = values[p.quantityField];
      if (!isQty(raw)) {
        holdReasons.push(`Missing confirmed quantity "${label(p.quantityField)}" for "${p.label}".`);
        lines.push({ ...base, description, quantity: '0', rateE4: rate, amountMinor: null, note: priceNote });
        continue;
      }
      const quantity = String(raw);
      let amount = lineAmount(quantity, rate);
      const notes = [priceNote];
      if (amount !== null && p.minimumMinor !== null && p.minimumMinor !== undefined && amount < p.minimumMinor) {
        notes.unshift(`Minimum charge ${formatMoney(p.minimumMinor, currency)} applies (${fmtQty(quantity)} ${p.unit} × ${formatRate(rate, currency)} = ${formatMoney(amount, currency)})`);
        amount = p.minimumMinor;
      }
      lines.push({ ...base, description, quantity, rateE4: rate, amountMinor: amount, note: notes.filter(Boolean).join(' · ') });
      continue;
    }
    // Flat: once per job. With an included quantity, a second line bills the overage beyond it.
    const included = p.includedQuantity && isQty(p.includedQuantity) && p.quantityField ? p.includedQuantity : null;
    const incText = included ? ` (includes ${fmtQty(included)} ${p.unit})` : '';
    lines.push({ ...base, unit: '', description: `${description}${incText}`, quantity: '1', rateE4: rate, amountMinor: lineAmount('1', rate), note: priceNote });
    if (included) {
      const raw = values[p.quantityField];
      if (!isQty(raw)) {
        holdReasons.push(`Missing confirmed quantity "${label(p.quantityField)}" for "${p.label}", so Rigo can't tell if more than ${fmtQty(included)} ${p.unit} was used.`);
        continue;
      }
      const over = new Big(String(raw)).minus(included);
      if (over.gt(0)) {
        const overRate = p.overageRateE4 ?? null;
        if (overRate === null) holdReasons.push(`No rate is set for "${p.label}" beyond the included ${fmtQty(included)} ${p.unit}.`);
        const q = over.toString();
        lines.push({ ...base, description: `${description}: ${fmtQty(q)} ${p.unit} over ${fmtQty(included)} included`, quantity: q, unit: p.unit || '', rateE4: overRate, amountMinor: lineAmount(q, overRate), note: '', bookedRateE4: null });
      }
    }
  }
  return { lines, holdReasons };
}

/** Warnings shown in the service editor before saving (they never block the save). */
export function pricingWarnings(service: { pricing: PriceLine[]; fields: Pick<FieldDef, 'key' | 'label'>[]; taxRateBp: number | null }, currency = 'USD') {
  const w: string[] = [];
  const label = (k: string) => service.fields.find((f) => f.key === k)?.label ?? k;
  const unconditional = service.pricing.filter((p) => p.basis === 'per_quantity' && !p.when);
  const byField = new Map<string, PriceLine[]>();
  for (const p of unconditional) byField.set(p.quantityField, [...(byField.get(p.quantityField) ?? []), p]);
  for (const [k, ps] of byField) if (ps.length > 1) w.push(`${ps.map((p) => `"${p.label}"`).join(' and ')} both charge per ${label(k).toLowerCase()} on every job. Add "Charge only when…" so each job pays one of them.`);
  for (const p of service.pricing) {
    if (p.rateE4 === 0) w.push(`"${p.label}" is priced at ${formatRate(0, currency)}. Leave the rate empty if it isn't decided yet.`);
    const perUnit = p.basis === 'per_quantity';
    if (p.rateE4 !== null && ((perUnit && p.rateE4 > 1_000 * RATE_SCALE) || (!perUnit && p.rateE4 > 100_000 * RATE_SCALE))) {
      w.push(`"${p.label}" at ${formatRate(p.rateE4, currency)}${perUnit ? ` per ${p.unit || 'unit'}` : ''} looks too high. Check the decimal point.`);
    }
    if (p.includedQuantity && p.overageRateE4 === null) w.push(`"${p.label}" includes ${p.includedQuantity} ${p.unit} but has no rate for more than that, so larger jobs will be held.`);
  }
  if (service.taxRateBp !== null && service.taxRateBp > 0 && service.pricing.length > 0 && !service.pricing.some((p) => p.taxable)) {
    w.push('A tax rate is set, but no line is taxable, so no tax will be charged.');
  }
  return w;
}

/** "3,000 gal" → { quantity: 3000, unit: 'gal' }; no leading number → nulls. */
export function parseCapacity(text: string): { quantity: number | null; unit: string } {
  const m = /^\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*([A-Za-z]+)?/.exec(text ?? '');
  if (!m) return { quantity: null, unit: '' };
  return { quantity: Number(m[1].replace(/,/g, '')), unit: m[2] ?? '' };
}

export interface QuantityCheck { overCapacity: boolean; overRequested: boolean; message: string | null }

/**
 * Plausibility of a confirmed quantity: above the truck's capacity, or more than 3× what was
 * requested, needs a typed confirmation and holds the invoice for review.
 */
export function checkQuantity(q: { label: string; unit: string; value: string; requested?: string | null; capacity?: { name: string; quantity: string } | null }): QuantityCheck {
  if (!isQty(q.value)) return { overCapacity: false, overRequested: false, message: null };
  const v = new Big(q.value);
  const unit = q.unit ? ` ${q.unit}` : '';
  const overCapacity = !!q.capacity && isQty(q.capacity.quantity) && v.gt(q.capacity.quantity);
  const overRequested = !!q.requested && isQty(q.requested) && new Big(q.requested).gt(0) && v.gt(new Big(q.requested).times(3));
  const message = overCapacity
    ? `${fmtQty(q.value)}${unit} is more than ${q.capacity!.name} holds (${fmtQty(q.capacity!.quantity)}${unit}).`
    : overRequested ? `${fmtQty(q.value)}${unit} is more than 3 times the ${fmtQty(q.requested!)}${unit} requested.` : null;
  return { overCapacity, overRequested, message };
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

/** A truck on the job, with the capacity parsed from its description ("3,000 gal"). */
export interface JobTruck { name: string; capacityQuantity: string | number | null; capacityUnit: string | null }

/**
 * Every confirmed quantity on a job that needs a second look: more than the largest assigned truck
 * (in the same unit) holds, or more than 3× the matching requested quantity. Used by the driver's
 * form before submitting and by the server, which holds the invoice until the office checks it.
 */
export function quantityChecks(fields: Pick<FieldDef, 'key' | 'label' | 'type' | 'unit' | 'stage'>[], values: Record<string, unknown>, details: Record<string, unknown>, trucks: JobTruck[]) {
  const out: { field: string; message: string }[] = [];
  for (const f of fields.filter((x) => x.type === 'number' && x.stage !== 'request' && values[x.key] !== undefined && values[x.key] !== '')) {
    const unit = (f.unit ?? '').toLowerCase();
    const truck = trucks.filter((t) => t.capacityQuantity !== null && t.capacityQuantity !== undefined && (!t.capacityUnit || !unit || t.capacityUnit.toLowerCase() === unit))
      .sort((a, b) => Number(b.capacityQuantity) - Number(a.capacityQuantity))[0];
    const req = fields.find((x) => x.key !== f.key && x.type === 'number' && x.stage === 'request' && (x.unit ?? '') === (f.unit ?? ''));
    const requested = req ? details[req.key] : null;
    const check = checkQuantity({ label: f.label, unit: f.unit ?? '', value: String(values[f.key]), requested: requested === null || requested === undefined ? null : String(requested),
      capacity: truck ? { name: truck.name, quantity: String(Number(truck.capacityQuantity)) } : null });
    if (check.message) out.push({ field: f.key, message: check.message });
  }
  return out;
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
