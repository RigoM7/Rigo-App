import Big from 'big.js';
import { z } from 'zod';
import { buildLines, type BuildOptions, type DraftLine } from './billing.js';
import type { PriceLine } from './services.js';

// Several products or tanks at one stop (R7-M1) and the delivery record for each (R7-M4): one job,
// one delivery fee, one charge line per product delivered, each priced by the service's matching
// line. Meter readings and a ticket number are kept per line.

const qty = /^\d+(\.\d+)?$/;
const optQty = z.string().trim().max(20).regex(/^(\d+(\.\d+)?)?$/, 'Enter a number like 1520 or 1520.5').default('');

export const deliveryLineSchema = z.object({
  product: z.string().trim().min(1, 'Choose the product').max(60),
  /** A tank on the location's list, or what the driver typed ("Generator day tank"). */
  tank: z.string().trim().max(80).default(''),
  quantity: optQty,
  meterStart: optQty,
  meterEnd: optQty,
  ticket: z.string().trim().max(40).default(''),
});
export type DeliveryLine = z.infer<typeof deliveryLineSchema>;

/** A customer's tank at a location: what it holds, how big it is, how to fill it. */
export const tankSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1, 'Name the tank').max(80),
  product: z.string().trim().max(60).default(''),
  size: z.string().trim().max(40).default(''),
  notes: z.string().trim().max(300).default(''),
});
export type Tank = z.infer<typeof tankSchema>;

/**
 * Which service fields a delivery line fills: the choice that picks the price (Product) and the
 * quantity it is charged on (Delivered quantity). Null when the service doesn't price that way.
 */
export function lineKeys(pricing: Pick<PriceLine, 'basis' | 'quantityField' | 'when'>[]) {
  const p = pricing.find((x) => x.basis === 'per_quantity' && x.quantityField && x.when);
  return p ? { choice: p.when!.field, quantity: p.quantityField } : null;
}

/** Fuel services take several delivery lines per stop. */
export function takesLines(svc: { category?: string | null; pricing: Pick<PriceLine, 'basis' | 'quantityField' | 'when'>[] }) {
  return svc.category === 'fuel' && !!lineKeys(svc.pricing);
}

/** End − start, when both meter readings are numbers and the end is not below the start. */
export function meterQuantity(start: string, end: string): string | null {
  if (!qty.test(start ?? '') || !qty.test(end ?? '')) return null;
  const d = new Big(end).minus(start);
  return d.lt(0) ? null : d.toString();
}

/** The quantity a line delivered: what was typed, or else the meter difference. */
export function lineQuantity(l: Pick<DeliveryLine, 'quantity' | 'meterStart' | 'meterEnd'>) {
  return qty.test(l.quantity ?? '') ? l.quantity : meterQuantity(l.meterStart, l.meterEnd);
}

/** Problems with one line, in plain words; a mismatch is a warning the office reviews, not an error. */
export function lineProblems(l: DeliveryLine, unit = '') {
  const errors: Record<string, string> = {};
  let warning: string | null = null;
  const u = unit ? ` ${unit}` : '';
  if (l.meterStart && l.meterEnd && qty.test(l.meterStart) && qty.test(l.meterEnd) && new Big(l.meterEnd).lt(l.meterStart)) errors.meterEnd = 'The end reading is lower than the start';
  const q = lineQuantity(l);
  if (!q) errors.quantity = 'Enter the quantity, or both meter readings';
  const m = meterQuantity(l.meterStart, l.meterEnd);
  if (m !== null && qty.test(l.quantity ?? '') && new Big(l.quantity).minus(m).abs().gt(new Big(m).times(0.005).plus(0.5))) {
    warning = `The meter shows ${m}${u} (${l.meterEnd} − ${l.meterStart}) but ${l.quantity}${u} was entered.`;
  }
  return { errors, warning };
}

export const totalQuantity = (lines: Pick<DeliveryLine, 'quantity' | 'meterStart' | 'meterEnd'>[]) =>
  lines.reduce((t, l) => { const q = lineQuantity(l); return q ? t.plus(q) : t; }, new Big(0)).toString();

/**
 * Invoice lines for a stop with several deliveries: each delivery is charged with the price line for
 * its product (taxable or not, as that line says), and the flat lines (delivery fee, after-hours)
 * once. A product with no price holds the invoice like any missing rate.
 */
export function buildDeliveryLines(pricing: PriceLine[], values: Record<string, unknown>, deliveries: DeliveryLine[], labels: Record<string, string>, types: Record<string, string> = {}, opts: BuildOptions = {}) {
  const keys = lineKeys(pricing);
  if (!keys || deliveries.length === 0) return buildLines(pricing, values, labels, types, opts);
  const perQty = pricing.filter((p) => p.basis === 'per_quantity' && p.quantityField === keys.quantity);
  const others = pricing.filter((p) => !perQty.includes(p));
  const lines: DraftLine[] = [];
  const holds = new Set<string>();
  for (const d of deliveries) {
    const q = lineQuantity(d);
    const built = buildLines(perQty, { ...values, [keys.choice]: d.product, [keys.quantity]: q ?? '' }, labels, types, opts);
    built.holdReasons.forEach((h) => holds.add(h));
    const where = [d.tank, d.ticket ? `ticket ${d.ticket}` : ''].filter(Boolean).join(', ');
    const meter = d.meterStart && d.meterEnd ? `Meter ${d.meterStart} → ${d.meterEnd}` : '';
    for (const l of built.lines) lines.push({ ...l, description: where ? `${l.description} (${where})` : l.description, note: [meter, l.note].filter(Boolean).join(' · ') });
  }
  if (others.length) {
    const flat = buildLines(others, values, labels, types, opts);
    flat.holdReasons.filter((h) => h !== 'This service has no pricing configured.').forEach((h) => holds.add(h));
    lines.push(...flat.lines);
  }
  return { lines, holdReasons: [...holds] };
}
