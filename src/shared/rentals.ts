import Big from 'big.js';
import { z } from 'zod';
import { addDays } from './schedule.js';
import { lineAmount, formatMoney, formatRate, type DraftLine } from './billing.js';
import { daysBetween } from './invoices.js';

// Rental plans (WP4): several unit lines (standard, ADA, hand-wash), billed every 28 days, monthly,
// weekly or once per event; prices for delivery, pickup and extra visits; an optional deposit (D22).
// Pauses and early ends are prorated by the day on the period's length (D5).

Big.RM = Big.roundHalfUp;

const rateE4 = z.number().int().min(0).max(1_000_000_000_000).nullable();
export const rentalLineSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  label: z.string().trim().min(1, 'Name the unit type').max(80),
  quantity: z.number().int().min(0).max(500),
  /** Per unit, per billing period (ten-thousandths of the currency). Empty holds the invoice. */
  rateE4,
});
export type RentalLine = z.infer<typeof rentalLineSchema>;

export const billingRuleSchema = z.object({
  frequency: z.enum(['none', 'per_visit', 'weekly', 'every_n_days', 'monthly', 'event']),
  everyDays: z.number().int().min(1).max(365).default(28),
  /** Older plans: one whole-cent rate per unit. Read as a single unit line. */
  rateMinor: z.number().int().min(0).nullable().default(null),
  description: z.string().max(120).default('Rental'),
  lines: z.array(rentalLineSchema).max(10).default([]),
  /** Prices for visits the rent doesn't cover. Empty: delivery and pickup are free; extra visits use the service's pricing. */
  visitPrices: z.object({ delivery: rateE4.optional(), pickup: rateE4.optional(), extra: rateE4.optional() }).default({}),
  deposit: z.object({ type: z.enum(['fixed', 'percent']), amountMinor: z.number().int().min(0).nullable().default(null), percentBp: z.number().int().min(1).max(10000).nullable().default(null) }).nullable().default(null),
  taxable: z.boolean().default(false),
});
export type BillingRule = z.infer<typeof billingRuleSchema>;

/** A stored billing rule (any age) in the current shape; an unreadable one bills nothing. */
export function readBillingRule(raw: unknown): BillingRule {
  const r = billingRuleSchema.safeParse(raw ?? {});
  return r.success ? r.data : billingRuleSchema.parse({ frequency: 'none' });
}

export const PERIODIC = ['weekly', 'every_n_days', 'monthly', 'event'] as const;
export const isPeriodic = (f: string) => (PERIODIC as readonly string[]).includes(f);

/** The plan's unit lines; an older plan's single rate becomes one line of `units`. */
export function rentalLines(rule: Partial<BillingRule> & { rateMinor?: number | null }, units: number): RentalLine[] {
  if (rule.lines && rule.lines.length) return rule.lines;
  return [{ id: 'unit', label: rule.description || 'Rental', quantity: units, rateE4: rule.rateMinor === null || rule.rateMinor === undefined ? null : rule.rateMinor * 100 }];
}

export const totalUnits = (rule: Partial<BillingRule>, units: number) => rentalLines(rule, units).reduce((s, l) => s + l.quantity, 0);

/** The nominal length of a billing period in days: 28 (or N), 7, the calendar month, or the whole event. */
export function nominalDays(frequency: string, start: string, end: string, everyDays = 28) {
  if (frequency === 'every_n_days') return everyDays;
  if (frequency === 'weekly') return 7;
  if (frequency === 'monthly') {
    const [y, m, d] = start.split('-').map(Number);
    return daysBetween(start, new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10));
  }
  return daysBetween(start, end) + 1;
}

export interface Excluded { from: string; to: string | null; reason: string }

/** Days of [start, end] that fall inside any excluded range (a pause, or after an early end). */
export function excludedDays(start: string, end: string, ranges: Excluded[]) {
  const days = new Set<string>();
  for (const r of ranges) {
    const from = r.from > start ? r.from : start;
    const to = r.to === null || r.to > end ? end : r.to;
    for (let d = from; d <= to; d = addDays(d, 1)) days.add(d);
  }
  return days.size;
}

const short = (d: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
const long = (d: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
export const periodLabel = (start: string, end: string) => (start === end ? long(start) : `${short(start)} – ${long(end)}`);

/**
 * One period's rent: each unit line is quantity × rate; when part of the period is paused or after
 * the plan ended, it is prorated by the day (D5) and the line says why ("23 of 28 days, paused
 * Oct 10 – Oct 14, 2026"). The event frequency charges once for the whole event.
 */
export function periodCharges(rule: BillingRule, units: number, period: { start: string; end: string }, excluded: Excluded[] = []): DraftLine[] {
  const full = nominalDays(rule.frequency, period.start, period.end, rule.everyDays);
  const covered = Math.max(0, daysBetween(period.start, period.end) + 1);
  const off = rule.frequency === 'event' ? 0 : excludedDays(period.start, period.end, excluded);
  // A period cut short by the plan's end counts only the days it covers.
  const billable = rule.frequency === 'event' ? full : Math.max(0, Math.min(full, covered) - off);
  return rentalLines(rule, units).filter((l) => l.quantity > 0).map((l) => {
    const whole = lineAmount(String(l.quantity), l.rateE4);
    const amount = whole === null ? null : billable === full ? whole : Number(new Big(whole).times(billable).div(full).round(0).toString());
    const reasons = excluded.filter((r) => excludedDays(period.start, period.end, [r]) > 0).map((r) => r.reason);
    return {
      description: `${l.label}, ${periodLabel(period.start, period.end)}`, quantity: String(l.quantity), unit: 'units', rateE4: l.rateE4, amountMinor: amount, taxable: rule.taxable, kind: 'charge' as const,
      note: billable < full ? `${billable} of ${full} days${reasons.length ? `: ${reasons.join(', ')}` : ''}` : '',
    };
  });
}

/** The days of [start, end] inside the given ranges, as dates in order. */
export function excludedDayList(start: string, end: string, ranges: Excluded[]) {
  const days = new Set<string>();
  for (const r of ranges) {
    const from = r.from > start ? r.from : start;
    const to = r.to === null || r.to > end ? end : r.to;
    for (let d = from; d <= to; d = addDays(d, 1)) days.add(d);
  }
  return [...days].sort();
}

/** The rent for `days` days of an issued period (each line prorated by the day, rounded half up). */
export function creditForDays(rule: BillingRule, units: number, period: { start: string; end: string }, days: number) {
  const full = nominalDays(rule.frequency, period.start, period.end, rule.everyDays);
  if (days <= 0 || rule.frequency === 'event') return 0;
  return rentalLines(rule, units).reduce((s, l) => {
    const whole = lineAmount(String(l.quantity), l.rateE4);
    return s + (whole === null ? 0 : Number(new Big(whole).times(Math.min(days, full)).div(full).round(0).toString()));
  }, 0);
}

/**
 * Credit for days newly left out of an issued period, given the days already credited on it. Worked
 * out as (rent for all credited days) − (rent for those credited before), so crediting in several
 * steps adds up to exactly the same as crediting once, and no day is ever credited twice.
 */
export function newDaysCredit(rule: BillingRule, units: number, period: { start: string; end: string }, range: Excluded, alreadyCredited: string[]) {
  const before = new Set(alreadyCredited);
  const fresh = excludedDayList(period.start, period.end, [range]).filter((d) => !before.has(d));
  const amountMinor = fresh.length ? creditForDays(rule, units, period, before.size + fresh.length) - creditForDays(rule, units, period, before.size) : 0;
  return { days: fresh, amountMinor };
}

/** A rent credit waiting for the next rent invoice; `days` say which days of which issued invoice it covers. */
export interface PendingCredit { description: string; amountMinor: number; invoiceId?: string; days?: string[] }

/**
 * Take credits off a rent invoice, never more than its charges: the rest waits for the next one.
 * Returns the discount lines to add and what is left.
 */
export function applyCredits(chargesMinor: number, credits: PendingCredit[]): { lines: DraftLine[]; left: PendingCredit[] } {
  let room = Math.max(0, chargesMinor);
  const lines: DraftLine[] = []; const left: PendingCredit[] = [];
  for (const cr of credits) {
    const use = Math.min(room, cr.amountMinor);
    if (use > 0) {
      lines.push({ description: cr.description, quantity: '1', unit: '', rateE4: use * 100, amountMinor: -use, taxable: false, kind: 'discount' });
      room -= use;
    }
    if (cr.amountMinor - use > 0) left.push({ ...cr, amountMinor: cr.amountMinor - use, description: use > 0 ? `${cr.description} (rest)` : cr.description });
  }
  return { lines, left };
}

/** The rent for the days of an already-issued period that are now excluded, as a credit amount. */
export function periodCredit(rule: BillingRule, units: number, period: { start: string; end: string }, range: Excluded) {
  const full = nominalDays(rule.frequency, period.start, period.end, rule.everyDays);
  const off = excludedDays(period.start, period.end, [range]);
  if (!off || rule.frequency === 'event') return 0;
  return rentalLines(rule, units).reduce((s, l) => {
    const whole = lineAmount(String(l.quantity), l.rateE4);
    return s + (whole === null ? 0 : Number(new Big(whole).times(off).div(full).round(0).toString()));
  }, 0);
}

/** The deposit asked for when booking (D22): fixed, or a percent of one full period's rent. */
export function depositDue(rule: BillingRule, units: number) {
  if (!rule.deposit) return 0;
  if (rule.deposit.type === 'fixed') return rule.deposit.amountMinor ?? 0;
  const period = rentalLines(rule, units).reduce((s, l) => s + (lineAmount(String(l.quantity), l.rateE4) ?? 0), 0);
  return Number(new Big(period).times(rule.deposit.percentBp ?? 0).div(10000).round(0).toString());
}

/** "2 × Standard unit, 1 × ADA unit: $350.00 every 4 weeks" for lists and headers. */
export function describeRental(rule: BillingRule, units: number, currency: string, showRates: boolean) {
  const lines = rentalLines(rule, units).filter((l) => l.quantity > 0);
  const what = lines.map((l) => `${l.quantity} × ${l.label}${showRates ? ` at ${l.rateE4 === null ? 'rate not set' : formatRate(l.rateE4, currency)}` : ''}`).join(', ');
  const per = rule.frequency === 'event' ? 'for the event' : rule.frequency === 'every_n_days' ? (rule.everyDays === 28 ? 'every 4 weeks' : `every ${rule.everyDays} days`) : rule.frequency === 'weekly' ? 'per week' : 'per month';
  const total = lines.reduce((s, l) => s + (lineAmount(String(l.quantity), l.rateE4) ?? 0), 0);
  return `${what}${showRates && lines.every((l) => l.rateE4 !== null) ? ` = ${formatMoney(total, currency)} ${per}` : ` ${per}`}`;
}

/** Plan visits are routine service covered by the rent unless marked otherwise (R8-C1). */
export type PlanVisit = 'delivery' | 'service' | 'extra' | 'pickup';
export const PLAN_VISIT_LABEL: Record<PlanVisit, string> = { delivery: 'Delivery', service: 'Service', extra: 'Extra service', pickup: 'Pickup' };
