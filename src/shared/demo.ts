// The demo walkthrough's steps: who does each one (the simulated role it needs), where it happens and
// which control it points at. Text lives in the client; the server uses roles to pick the starting view.

export type GuideRole = 'owner' | 'driver';
export interface GuideStepDef {
  key: 'welcome' | 'needs' | 'dispatch' | 'complete' | 'approve' | 'send' | 'convert';
  role: GuideRole;
}

export const GUIDE_STEPS: GuideStepDef[] = [
  { key: 'welcome', role: 'owner' },
  { key: 'needs', role: 'owner' },
  { key: 'dispatch', role: 'owner' },
  { key: 'complete', role: 'driver' },
  { key: 'approve', role: 'owner' },
  { key: 'send', role: 'owner' },
  { key: 'convert', role: 'owner' },
];

/** The demo job the walkthrough follows from dispatch to the customer email. */
export const GUIDE_JOB_NUMBER = 3;

export interface GuideProgress {
  jobId: string | null;
  jobNumber: number;
  assigned: boolean;
  /** Assigned to the fictional driver the Driver view acts as. */
  assignedToDemoDriver: boolean;
  demoDriverName: string | null;
  assigneeName: string | null;
  completed: boolean;
  invoiceId: string | null;
  approved: boolean;
  messageId: string | null;
  sent: boolean;
}

/** Which simulated role a returning visitor starts in: Owner, unless they are mid-step in a step that needs another role. */
export function startingRole(guide: { step: number; dismissed: boolean } | undefined, current: string | undefined): string {
  if (!guide || guide.dismissed) return 'owner';
  const need = GUIDE_STEPS[Math.min(Math.max(guide.step, 0), GUIDE_STEPS.length - 1)]?.role ?? 'owner';
  return need !== 'owner' && current === need ? need : 'owner';
}
