import { addDays } from './schedule.js';

// Invoice state after issue: due dates, balances, one payment status for every screen, aging
// buckets and collection reminders (owner decisions D18–D20). Dates are company-local YYYY-MM-DD.

/** Default payment terms: net 30 (D18). */
export const DEFAULT_TERMS_DAYS = 30;

/**
 * What a hold reason asks for (R7-m1): "review" holds (a partly completed visit, a quantity or meter
 * reading to check) are released by a person who checked; "fix" holds (a missing rate or quantity)
 * clear once the missing information is added.
 */
export function holdKind(reason: string): 'review' | 'fix' {
  return /^(The visit was only partly completed|Check the quantity before approving)/.test(reason) ? 'review' : 'fix';
}

export function daysBetween(from: string, to: string) {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400_000);
}

/** The due date for an invoice issued on `issuedOn` with these terms (0 = due on receipt). */
export function dueDateFor(issuedOn: string, termsDays: number | null | undefined) {
  return addDays(issuedOn, termsDays ?? DEFAULT_TERMS_DAYS);
}

export function termsLabel(days: number | null | undefined) {
  const d = days ?? DEFAULT_TERMS_DAYS;
  return d === 0 ? 'Due on receipt' : `Net ${d}`;
}

/** What is still owed: total less payments, credit notes and credit applied. Never below zero. */
export function balanceDue(i: { totalMinor: number | null; paidMinor: number; creditedMinor?: number | null }) {
  if (i.totalMinor === null) return null;
  return Math.max(0, i.totalMinor - i.paidMinor - (i.creditedMinor ?? 0));
}

export type PaymentKey = 'not_issued' | 'void' | 'unpaid' | 'partly_paid' | 'paid' | 'overdue';
export interface PaymentState { key: PaymentKey; label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'; daysOverdue: number }

/**
 * The one payment status shown on the invoice, job and customer pages (R6-m1). It works from the
 * stored payment status, so people without finance access see the same word without amounts.
 */
export function paymentState(i: { status: string; paymentStatus: string; dueDate?: string | null }, today: string): PaymentState {
  if (i.status === 'void') return { key: 'void', label: 'Void', tone: 'neutral', daysOverdue: 0 };
  if (i.status !== 'issued') return { key: 'not_issued', label: 'Not issued', tone: 'neutral', daysOverdue: 0 };
  if (i.paymentStatus === 'paid') return { key: 'paid', label: 'Paid', tone: 'success', daysOverdue: 0 };
  const late = i.dueDate ? daysBetween(i.dueDate, today) : 0;
  if (late > 0) return { key: 'overdue', label: `Overdue ${late} day${late === 1 ? '' : 's'}`, tone: 'danger', daysOverdue: late };
  if (i.paymentStatus === 'partially_paid') return { key: 'partly_paid', label: 'Partly paid', tone: 'info', daysOverdue: 0 };
  return { key: 'unpaid', label: 'Unpaid', tone: 'neutral', daysOverdue: 0 };
}

export const AGING_BUCKETS = [
  { key: 'current', label: 'Not yet due' },
  { key: 'd1_30', label: '1–30 days' },
  { key: 'd31_60', label: '31–60 days' },
  { key: 'd60_plus', label: 'Over 60 days' },
] as const;
export type AgingKey = (typeof AGING_BUCKETS)[number]['key'];

export function agingBucket(dueDate: string | null, today: string): AgingKey {
  const late = dueDate ? daysBetween(dueDate, today) : 0;
  return late <= 0 ? 'current' : late <= 30 ? 'd1_30' : late <= 60 ? 'd31_60' : 'd60_plus';
}

export type ReminderStage = 'due_soon' | 'overdue_7' | 'overdue_30';

/**
 * Which reminder an unpaid invoice is ready for today (D19): 3 days before it's due, then 7 and
 * 30 days overdue. Each is prepared once and sent only after the office approves it.
 */
export function reminderStage(dueDate: string, today: string): ReminderStage | null {
  const late = daysBetween(dueDate, today);
  if (late >= 30) return 'overdue_30';
  if (late >= 7) return 'overdue_7';
  if (late >= -3 && late < 0) return 'due_soon';
  return null;
}

export const REMINDER_LABEL: Record<ReminderStage, string> = {
  due_soon: 'Due in 3 days', overdue_7: '7 days overdue', overdue_30: '30 days overdue',
};

/** Statements are prepared on the 1st of each month (D20). */
export function isStatementDay(today: string) {
  return today.slice(8, 10) === '01';
}

/** "INV-01042": the prefix and the next number continue from the company's previous system (D17). */
export function nextNumberPreview(prefix: string, next: number) {
  return `${prefix}${String(next).padStart(5, '0')}`;
}

export const PAYMENT_METHODS = { cash: 'Cash', check: 'Check', card: 'Card', card_terminal: 'Card (separate terminal)', bank_transfer: 'Bank transfer', other: 'Other' } as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;
