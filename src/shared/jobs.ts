import { fieldApplies, type FieldDef } from './services.js';

// Job status, assignment, billing status and message delivery are tracked separately.
export const JOB_STATUSES = {
  draft: 'Draft',
  open: 'Open',
  in_progress: 'In progress',
  completed: 'Completed',
  partial: 'Partially completed',
  unsuccessful: 'Unsuccessful visit',
  cancelled: 'Cancelled',
} as const;
export type JobStatus = keyof typeof JOB_STATUSES;

/** Job priority: how soon the job must be done. Urgent and emergency jobs sort first within a day. */
export const PRIORITIES = {
  normal: 'Normal',
  urgent: 'Urgent',
  emergency: 'Emergency',
} as const;
export type Priority = keyof typeof PRIORITIES;
const PRIORITY_RANK: Record<string, number> = { emergency: 0, urgent: 1, normal: 2 };
/** Sort helper: emergency before urgent before normal. */
export function comparePriority(a: string | null | undefined, b: string | null | undefined) {
  return (PRIORITY_RANK[a ?? 'normal'] ?? 2) - (PRIORITY_RANK[b ?? 'normal'] ?? 2);
}

export const BILLING_STATUSES = {
  not_ready: 'Not ready',
  not_billable: 'Not billable',
  ready: 'Ready to bill',
  held: 'Invoice held',
  drafted: 'Invoice drafted',
  approved: 'Invoice approved',
  issued: 'Invoiced',
} as const;

export const OUTCOMES = {
  completed: 'Completed successfully',
  partial: 'Partially completed',
  unsuccessful: 'Could not complete',
} as const;
export type Outcome = keyof typeof OUTCOMES;

/** Quick reasons a visit couldn't be completed (R6-m5); "Other" needs a few words. */
export const REASON_CODES = {
  locked_gate: 'Locked gate',
  dog: 'Dog on the property',
  no_access: 'No access',
  customer_cancelled: 'Customer cancelled on site',
  tank_full: 'Tank full',
  other: 'Other',
} as const;
export type ReasonCode = keyof typeof REASON_CODES;
export const REASON_CODE_KEYS = Object.keys(REASON_CODES) as [ReasonCode, ...ReasonCode[]];

/** The reason the office reads: the quick reason, then anything the driver added. */
export function outcomeReason(code: ReasonCode | null | undefined, text: string) {
  const t = text.trim();
  if (!code || code === 'other') return t;
  const label = REASON_CODES[code];
  return t && !t.startsWith(label) ? `${label}: ${t}` : t || label;
}

const transitions: Record<JobStatus, JobStatus[]> = {
  draft: ['open', 'cancelled'],
  open: ['draft', 'in_progress', 'completed', 'partial', 'unsuccessful', 'cancelled'],
  in_progress: ['open', 'completed', 'partial', 'unsuccessful', 'cancelled'],
  completed: [],
  partial: [],
  unsuccessful: [],
  cancelled: [],
};

export function canTransition(from: JobStatus, to: JobStatus) {
  return transitions[from]?.includes(to) ?? false;
}

export const isFinished = (s: JobStatus) => s === 'completed' || s === 'partial' || s === 'unsuccessful' || s === 'cancelled';

export interface JobLike {
  customer_id: string | null;
  location_id: string | null;
  service_id: string | null;
  scheduled_start?: string | null;
  details: Record<string, unknown>;
}

/** Plain-language list of what a draft still needs before it can be opened for scheduling. */
export function missingForOpen(job: JobLike, serviceFields: FieldDef[] | null) {
  const missing: string[] = [];
  if (!job.customer_id) missing.push('Choose a customer');
  if (!job.location_id) missing.push('Choose a service location');
  if (!job.service_id) missing.push('Choose a service');
  for (const f of serviceFields ?? []) {
    if ((f.stage === 'request' || f.stage === 'both') && f.required && fieldApplies(f, job.details ?? {})) {
      const v = job.details?.[f.key];
      if (v === undefined || v === null || v === '') missing.push(`Enter ${f.label.toLowerCase()}`);
    }
  }
  return missing;
}

export interface CompletionInput {
  outcome: Outcome;
  values: Record<string, unknown>;
  notes: string;
  reason: string;
  reasonCode?: ReasonCode | null;
  photoCount: number;
  hasSignature: boolean;
  signerName: string;
}

export function completionProblems(c: CompletionInput, svc: { fields: FieldDef[]; requires_photo: boolean; requires_signature: boolean }, details: Record<string, unknown> = {}) {
  const problems: Record<string, string> = {};
  if (c.outcome !== 'completed' && !outcomeReason(c.reasonCode, c.reason)) problems.reason = c.reasonCode === 'other' ? 'Say what happened so the office can follow up' : 'Choose what happened, or describe it, so the office can follow up';
  if (c.outcome === 'completed') {
    for (const f of svc.fields) {
      if ((f.stage === 'completion' || f.stage === 'both') && f.required && fieldApplies(f, { ...details, ...c.values })) {
        const v = c.values?.[f.key];
        if (v === undefined || v === null || v === '') problems[f.key] = `${f.label} is required`;
      }
    }
    if (svc.requires_photo && c.photoCount < 1) problems.photos = 'Add at least one photo';
    if (svc.requires_signature && !c.hasSignature) problems.signature = 'Collect a signature';
    if (svc.requires_signature && c.hasSignature && !c.signerName.trim()) problems.signerName = 'Enter the name of the person who signed';
  }
  return problems;
}

/** Billing consequence of an accepted completion. Unsuccessful visits are never billed automatically. */
export function billingAfterOutcome(outcome: Outcome) {
  return outcome === 'unsuccessful' ? 'not_billable' : 'ready';
}

/** Detect overlapping assignments for the same driver or resource. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

export const DEFAULT_JOB_MINUTES = 60;

/** When a job's window ends: its scheduled end, or the default length after its start. */
export function windowEnd(job: { scheduled_start?: string | null; scheduled_end?: string | null }) {
  if (job.scheduled_end) return Date.parse(job.scheduled_end);
  if (job.scheduled_start) return Date.parse(job.scheduled_start) + DEFAULT_JOB_MINUTES * 60_000;
  return null;
}

/** Late: still open (not started) after its time window has ended. */
export function isLate(job: { status: string; scheduled_start?: string | null; scheduled_end?: string | null }, now = Date.now()) {
  if (job.status !== 'open') return false;
  const end = windowEnd(job);
  return end !== null && end < now;
}
