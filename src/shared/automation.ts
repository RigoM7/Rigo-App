// Automation levels and the automations Rigo has, shared by the server (enforcement) and Settings.
// Manual: people do every step and Rigo points to it. Assisted (the default): Rigo prepares, a person
// approves. Automatic: Rigo does it. Where levels disagree, the safest one (more people) wins.
// Nothing ever approves itself: a timeout never approves (PRODUCT.md, automation).

export const LEVELS = {
  manual: { label: 'Manual', hint: 'You do each step. Rigo shows what is next.' },
  assisted: { label: 'Assisted', hint: 'Rigo prepares it. A person approves before anything happens.' },
  automatic: { label: 'Automatic', hint: 'Rigo does it on its own and records what it did.' },
} as const;
export type Level = keyof typeof LEVELS;
export type RuleLevel = Level | 'off';
const ORDER: Record<Level, number> = { manual: 0, assisted: 1, automatic: 2 };

/** The level that applies: the workspace's and the automation's, whichever needs more people. */
export function effectiveLevel(workspace: Level, rule: RuleLevel): RuleLevel {
  if (rule === 'off') return 'off';
  return ORDER[rule] <= ORDER[workspace] ? rule : workspace;
}

export interface RuleDef {
  key: string;
  name: string;
  when: string;
  assisted: string;
  automatic: string;
  /** Moves money: Automatic needs the owner to confirm a clear warning. */
  money: boolean;
  defaultLevel: RuleLevel;
}

export const RULES: RuleDef[] = [
  {
    key: 'invoice_on_finish', name: 'Invoices from finished work',
    when: 'When {work} moves to a Finished stage',
    assisted: 'Rigo prepares the invoice. A person approves it before it is issued.',
    automatic: 'Rigo prepares the invoice and issues it once it is approved, or straight away if your invoices don’t need approval.',
    money: true, defaultLevel: 'assisted',
  },
  {
    key: 'booking_confirmation', name: 'Booking confirmations',
    when: 'When {work} gets a time',
    assisted: 'Rigo writes a confirmation for the {customer}. A person approves before it is sent.',
    automatic: 'Rigo sends the confirmation.',
    money: false, defaultLevel: 'assisted',
  },
  {
    key: 'payment_reminder', name: 'Overdue reminders',
    when: 'When an invoice is 7 days overdue',
    assisted: 'Rigo writes a friendly reminder. A person approves before it is sent.',
    automatic: 'Rigo sends the reminder.',
    money: false, defaultLevel: 'assisted',
  },
];
export const ruleByKey = (k: string) => RULES.find((r) => r.key === k) ?? null;

/** What a waiting or finished action says about itself, in plain words. */
export const ACTION_STATUS = {
  suggested: 'Suggested',
  waiting: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  done: 'Done',
  failed: 'Didn’t work',
  cancelled: 'Cancelled',
  taken_over: 'Taken over by a person',
  paused: 'Held while Rigo is paused',
} as const;
