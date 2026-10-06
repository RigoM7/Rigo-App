import type { FieldDef } from './services.js';

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
    if ((f.stage === 'request' || f.stage === 'both') && f.required) {
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
  photoCount: number;
  hasSignature: boolean;
  signerName: string;
}

export function completionProblems(c: CompletionInput, svc: { fields: FieldDef[]; requires_photo: boolean; requires_signature: boolean }) {
  const problems: Record<string, string> = {};
  if (c.outcome !== 'completed' && !c.reason.trim()) problems.reason = 'Explain what happened so the office can follow up';
  if (c.outcome === 'completed') {
    for (const f of svc.fields) {
      if ((f.stage === 'completion' || f.stage === 'both') && f.required) {
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
