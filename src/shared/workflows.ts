import { z } from 'zod';

// Workflow definitions are validated, declarative data. A small set of supported primitives
// (triggers, conditions, actions, approvals) is executed by the server's automation engine.

export const MODES = { manual: 'Manual', assisted: 'Assisted', automatic: 'Automatic' } as const;
export type Mode = keyof typeof MODES;

export const MODE_HELP: Record<Mode, string> = {
  manual: 'People start each business action. Rigo lists the next step but does not prepare or run it.',
  assisted: 'Rigo prepares drafts and suggests next steps, then waits for a person before anything is issued or sent.',
  automatic: 'Rigo runs eligible steps itself, within permissions, approval rules and enabled services.',
};

export const TRIGGERS = {
  'job.created': { label: 'A job is created', subject: 'job' },
  'job.assigned': { label: 'A job is assigned or reassigned', subject: 'job' },
  'job.completed': { label: 'A job is completed successfully', subject: 'job' },
  'job.partial': { label: 'A job is partially completed', subject: 'job' },
  'job.unsuccessful': { label: 'A visit could not be completed', subject: 'job' },
  'job.problem_reported': { label: 'A driver reports a problem', subject: 'job' },
  'invoice.prepared': { label: 'An invoice draft is prepared', subject: 'invoice' },
  'invoice.approved': { label: 'An invoice is approved', subject: 'invoice' },
  'invoice.issued': { label: 'An invoice is issued', subject: 'invoice' },
} as const;
export type TriggerEvent = keyof typeof TRIGGERS;

export interface ActionMeta {
  label: string;
  kind: 'prepare' | 'commit';
  needs: 'job' | 'invoice' | 'message' | 'any';
  provides?: 'invoice' | 'message' | 'job';
  permission: string;
  capability?: 'email';
  description: string;
  consequence: string;
}

export const ACTIONS: Record<string, ActionMeta> = {
  'invoice.prepare': {
    label: 'Prepare invoice draft', kind: 'prepare', needs: 'job', provides: 'invoice', permission: 'invoices.edit',
    description: 'Builds a draft invoice from the confirmed job record and the service pricing. Missing rates or quantities put it on hold.',
    consequence: 'A draft invoice is created. Nothing is sent to the customer.',
  },
  'invoice.issue': {
    label: 'Issue invoice', kind: 'commit', needs: 'invoice', permission: 'invoices.issue',
    description: 'Assigns the next invoice number and marks the invoice issued. Held invoices cannot be issued.',
    consequence: 'The invoice receives its number and becomes the official record. It can be voided but not deleted.',
  },
  'message.prepare_invoice': {
    label: 'Prepare invoice email', kind: 'prepare', needs: 'invoice', provides: 'message', permission: 'messages.send',
    description: 'Prepares a company-branded email to the customer with the invoice summary.',
    consequence: 'An email is prepared for review. It is not sent.',
  },
  'message.prepare_job_update': {
    label: 'Prepare customer update', kind: 'prepare', needs: 'job', provides: 'message', permission: 'messages.send',
    description: 'Prepares a short message to the customer about the visit outcome.',
    consequence: 'A message is prepared for review. It is not sent.',
  },
  'message.send': {
    label: 'Send prepared message', kind: 'commit', needs: 'message', permission: 'messages.send', capability: 'email',
    description: 'Sends the prepared message through the configured email service. Without one it is blocked (real companies) or simulated (demo).',
    consequence: 'The customer receives the message if an email service is configured.',
  },
  notify: {
    label: 'Notify team members', kind: 'prepare', needs: 'any', permission: 'workflows.view',
    description: 'Posts an in-app notification to the chosen roles or the assigned driver.',
    consequence: 'Team members see a notification in Rigo.',
  },
  'job.create_followup': {
    label: 'Create follow-up job draft', kind: 'commit', needs: 'job', provides: 'job', permission: 'jobs.create',
    description: 'Creates a draft job copying the customer, location and service so the visit can be rescheduled.',
    consequence: 'A new draft job appears in the dispatch list.',
  },
};
export type ActionType = keyof typeof ACTIONS;

export const CONDITION_FIELDS = {
  'job.service_category': { label: 'Service category', type: 'select', options: ['fuel', 'portable_toilet', 'septic', 'other'], subject: 'job' },
  'job.service_name': { label: 'Service name', type: 'text', subject: 'job' },
  'job.problem_open': { label: 'Problem reported', type: 'boolean', subject: 'job' },
  'job.has_assignee': { label: 'Job has a driver', type: 'boolean', subject: 'job' },
  'job.priority': { label: 'Job priority', type: 'select', options: ['normal', 'urgent', 'emergency'], subject: 'job' },
  'customer.name': { label: 'Customer name', type: 'text', subject: 'any' },
  'invoice.total_minor': { label: 'Invoice total (cents)', type: 'number', subject: 'invoice' },
  'invoice.held': { label: 'Invoice is on hold', type: 'boolean', subject: 'invoice' },
} as const;
export type ConditionField = keyof typeof CONDITION_FIELDS;

export const OPERATORS = { eq: 'is', neq: 'is not', gt: 'is more than', gte: 'is at least', lt: 'is less than', lte: 'is at most', contains: 'contains' } as const;

const conditionSchema = z.object({
  field: z.enum(Object.keys(CONDITION_FIELDS) as [ConditionField, ...ConditionField[]]),
  op: z.enum(Object.keys(OPERATORS) as [keyof typeof OPERATORS, ...(keyof typeof OPERATORS)[]]),
  value: z.union([z.string().max(100), z.number(), z.boolean()]),
});
export type Condition = z.infer<typeof conditionSchema>;

const approvalSchema = z.object({
  required: z.enum(['never', 'always', 'conditional']).default('never'),
  conditions: z.array(conditionSchema).max(5).default([]),
  approverRoles: z.array(z.string().max(40)).max(10).default([]),
  approverUserIds: z.array(z.string().uuid()).max(10).default([]),
  backupUserIds: z.array(z.string().uuid()).max(10).default([]),
  escalateAfterHours: z.number().int().min(1).max(720).nullable().default(null),
});
export type ApprovalRule = z.infer<typeof approvalSchema>;

export const stepSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  action: z.enum(Object.keys(ACTIONS) as [string, ...string[]]),
  params: z.object({
    roles: z.array(z.string().max(40)).max(10).optional(),
    assignee: z.boolean().optional(),
    text: z.string().max(300).optional(),
  }).default({}),
  mode: z.enum(['manual', 'assisted', 'automatic']).nullable().default(null),
  approval: approvalSchema.default({ required: 'never', conditions: [], approverRoles: [], approverUserIds: [], backupUserIds: [], escalateAfterHours: null }),
  onException: z.object({
    notifyRoles: z.array(z.string().max(40)).max(10).default(['owner']),
    stop: z.boolean().default(true),
  }).default({ notifyRoles: ['owner'], stop: true }),
});
export type Step = z.infer<typeof stepSchema>;

export const definitionSchema = z.object({
  trigger: z.object({ event: z.enum(Object.keys(TRIGGERS) as [TriggerEvent, ...TriggerEvent[]]) }),
  conditions: z.array(conditionSchema).max(10).default([]),
  steps: z.array(stepSchema).min(1, 'Add at least one step').max(10, 'A workflow can have at most 10 steps'),
});
export type Definition = z.infer<typeof definitionSchema>;

export interface ValidationResult { ok: boolean; errors: string[]; warnings: string[] }

export function validateDefinition(def: Definition, env: { roles: string[]; emailAvailable: boolean; isDemo: boolean }): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const subject = TRIGGERS[def.trigger.event].subject;
  const available = new Set<string>([subject, 'any']);
  const ids = new Set<string>();
  def.steps.forEach((s, i) => {
    const n = i + 1;
    const meta = ACTIONS[s.action];
    if (ids.has(s.id)) errors.push(`Step ${n}: duplicate step id "${s.id}".`);
    ids.add(s.id);
    if (!available.has(meta.needs)) {
      errors.push(`Step ${n} (${meta.label}) needs ${meta.needs === 'invoice' ? 'an invoice' : meta.needs === 'message' ? 'a prepared message' : 'a job'}, but no earlier step or the trigger provides one.`);
    }
    if (meta.provides) available.add(meta.provides);
    if (s.action === 'notify' && !(s.params.roles?.length) && !s.params.assignee) errors.push(`Step ${n}: choose who to notify.`);
    for (const r of [...(s.params.roles ?? []), ...s.approval.approverRoles, ...s.onException.notifyRoles]) {
      if (!env.roles.includes(r)) errors.push(`Step ${n}: role "${r}" does not exist in this company.`);
    }
    if (s.approval.required !== 'never' && s.approval.approverRoles.length === 0 && s.approval.approverUserIds.length === 0) {
      errors.push(`Step ${n}: approval is required but no approver is assigned.`);
    }
    if (s.approval.required === 'conditional' && s.approval.conditions.length === 0) errors.push(`Step ${n}: add a condition for when approval is needed.`);
    if (meta.kind === 'commit' && s.approval.required === 'never' && (s.mode === 'automatic' || s.mode === null)) {
      warnings.push(`Step ${n} (${meta.label}) has no approval. In Automatic mode it will run without a person reviewing it.`);
    }
    if (meta.capability === 'email' && !env.emailAvailable) {
      warnings.push(env.isDemo
        ? `Step ${n}: this is a demo workspace, so sending is simulated. Nothing leaves Rigo.`
        : `Step ${n}: no email service is configured. Sending will be blocked and the message stays prepared for you to send yourself.`);
    }
  });
  for (const c of def.conditions) {
    const f = CONDITION_FIELDS[c.field];
    if (f.subject !== 'any' && f.subject !== subject) errors.push(`Condition "${f.label}" does not apply to this trigger.`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function describeCondition(c: Condition) {
  const f = CONDITION_FIELDS[c.field];
  const v = c.field === 'invoice.total_minor' && typeof c.value === 'number' ? `$${(c.value / 100).toFixed(2)}` : String(c.value);
  return `${f.label.toLowerCase()} ${OPERATORS[c.op]} ${v}`;
}

export function explainDefinition(def: Definition, roleNames: Record<string, string> = {}): string[] {
  const rn = (r: string) => roleNames[r] ?? r;
  const lines: string[] = [];
  lines.push(`When ${TRIGGERS[def.trigger.event].label.toLowerCase()}${def.conditions.length ? ` and ${def.conditions.map(describeCondition).join(' and ')}` : ''}:`);
  def.steps.forEach((s, i) => {
    const meta = ACTIONS[s.action];
    let line = `${i + 1}. ${meta.label}`;
    if (s.action === 'notify') line += ` (${[...(s.params.assignee ? ['assigned driver'] : []), ...(s.params.roles ?? []).map(rn)].join(', ')})`;
    if (s.approval.required === 'always') line += `, after approval by ${[...s.approval.approverRoles.map(rn), ...(s.approval.approverUserIds.length ? ['named approvers'] : [])].join(' or ')}`;
    if (s.approval.required === 'conditional') line += `, needing approval when ${s.approval.conditions.map(describeCondition).join(' and ')}`;
    if (s.mode) line += ` [always ${s.mode}]`;
    lines.push(line + '.');
    if (s.onException.notifyRoles.length) lines.push(`   If it cannot finish: notify ${s.onException.notifyRoles.map(rn).join(', ')}${s.onException.stop ? ' and stop' : ' and continue'}.`);
  });
  return lines;
}

export function evaluate(c: Condition, facts: Record<string, unknown>): boolean {
  const actual = facts[c.field];
  const v = c.value;
  switch (c.op) {
    case 'eq': return String(actual) === String(v);
    case 'neq': return String(actual) !== String(v);
    case 'gt': return Number(actual) > Number(v);
    case 'gte': return Number(actual) >= Number(v);
    case 'lt': return Number(actual) < Number(v);
    case 'lte': return Number(actual) <= Number(v);
    case 'contains': return String(actual ?? '').toLowerCase().includes(String(v).toLowerCase());
  }
}

export function effectiveMode(company: Mode, workflowOverride: Mode | null, step: Mode | null): Mode {
  return step ?? workflowOverride ?? company;
}

/**
 * What the engine will do with a step in a given mode, before approvals.
 * manual    -> 'suggest'  (a to-do for a person; nothing is prepared). In-app notices always run.
 * assisted  -> prepare steps run; commit steps become proposals awaiting a person
 * automatic -> run
 */
export function stepDisposition(mode: Mode, meta: ActionMeta): 'suggest' | 'propose' | 'run' {
  if (meta === ACTIONS.notify) return 'run'; // in-app notices are housekeeping in every mode
  if (mode === 'manual') return 'suggest';
  if (mode === 'assisted') return meta.kind === 'prepare' ? 'run' : 'propose';
  return 'run';
}

export function approvalNeeded(rule: ApprovalRule, facts: Record<string, unknown>) {
  if (rule.required === 'never') return false;
  if (rule.required === 'always') return true;
  return rule.conditions.every((c) => evaluate(c, facts));
}

/** Pure dry run against sample facts. Used by "Test with sample data"; it has no side effects. */
export function simulate(def: Definition, opts: { mode: Mode; overrideMode: Mode | null; facts: Record<string, unknown>; emailAvailable: boolean; isDemo: boolean; sampleHasRates: boolean }) {
  const out: { step: number; label: string; outcome: string }[] = [];
  const matched = def.conditions.every((c) => evaluate(c, opts.facts));
  if (!matched) return { matched, steps: out, summary: 'The sample does not meet the workflow conditions, so nothing would run.' };
  let stopped = false;
  def.steps.forEach((s, i) => {
    const meta = ACTIONS[s.action];
    if (stopped) { out.push({ step: i + 1, label: meta.label, outcome: 'Not reached' }); return; }
    const mode = effectiveMode(opts.mode, opts.overrideMode, s.mode);
    const disp = stepDisposition(mode, meta);
    if (disp === 'suggest') { out.push({ step: i + 1, label: meta.label, outcome: 'Manual: listed as a next step for a person; the run stops here' }); stopped = true; return; }
    if (approvalNeeded(s.approval, opts.facts)) { out.push({ step: i + 1, label: meta.label, outcome: 'Waits for approval; later steps continue only after a decision' }); stopped = true; return; }
    if (disp === 'propose') { out.push({ step: i + 1, label: meta.label, outcome: 'Assisted: proposed; waits for a person to run it' }); stopped = true; return; }
    if (s.action === 'invoice.prepare' && !opts.sampleHasRates) {
      out.push({ step: i + 1, label: meta.label, outcome: 'Prepared on hold: the sample service has a missing rate' });
      if (s.onException.stop) stopped = true;
      return;
    }
    if (meta.capability === 'email' && !opts.emailAvailable) {
      out.push({ step: i + 1, label: meta.label, outcome: opts.isDemo ? 'Simulated: demo workspaces never send' : 'Blocked: no email service configured' });
      if (!opts.isDemo && s.onException.stop) stopped = true;
      return;
    }
    out.push({ step: i + 1, label: meta.label, outcome: 'Would run' });
  });
  return { matched, steps: out, summary: stopped ? 'The run pauses or stops partway; see each step.' : 'Every step would run.' };
}

export function stableHash(value: unknown): string {
  const json = JSON.stringify(sortKeys(value));
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < json.length; i++) {
    const ch = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
function sortKeys(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

/** Built-in starting workflows. They are copied into a company as drafts or, at setup, activated by the owner. */
export function defaultWorkflows(): { name: string; description: string; definition: Definition }[] {
  const noApproval = { required: 'never' as const, conditions: [], approverRoles: [], approverUserIds: [], backupUserIds: [], escalateAfterHours: null };
  const exc = { notifyRoles: ['owner'], stop: true };
  return [
    {
      name: 'Completed job to invoice',
      description: 'Prepare an invoice when a job is completed, get approval, issue it and prepare the customer email.',
      definition: {
        trigger: { event: 'job.completed' }, conditions: [],
        steps: [
          { id: 'prepare', action: 'invoice.prepare', params: {}, mode: null, approval: noApproval, onException: exc },
          { id: 'issue', action: 'invoice.issue', params: {}, mode: null, approval: { ...noApproval, required: 'always', approverRoles: ['owner'], escalateAfterHours: 24 }, onException: exc },
          { id: 'email', action: 'message.prepare_invoice', params: {}, mode: null, approval: noApproval, onException: exc },
          { id: 'send', action: 'message.send', params: {}, mode: null, approval: noApproval, onException: exc },
        ],
      },
    },
    {
      name: 'Partial visit review',
      description: 'Prepare a held invoice for review and tell the office when a visit is only partly completed.',
      definition: {
        trigger: { event: 'job.partial' }, conditions: [],
        steps: [
          { id: 'notify', action: 'notify', params: { roles: ['owner', 'office'], text: 'A visit was only partly completed. Review it before billing.' }, mode: null, approval: noApproval, onException: exc },
          { id: 'prepare', action: 'invoice.prepare', params: {}, mode: null, approval: noApproval, onException: exc },
        ],
      },
    },
    {
      name: 'Unsuccessful visit follow-up',
      description: 'Tell dispatch and draft a follow-up job when a visit could not be completed.',
      definition: {
        trigger: { event: 'job.unsuccessful' }, conditions: [],
        steps: [
          { id: 'notify', action: 'notify', params: { roles: ['owner', 'dispatcher'], text: 'A visit could not be completed.' }, mode: null, approval: noApproval, onException: exc },
          { id: 'followup', action: 'job.create_followup', params: {}, mode: null, approval: noApproval, onException: exc },
        ],
      },
    },
    {
      name: 'New assignment notice',
      description: 'Notify the driver in Rigo when a job is assigned to them.',
      definition: {
        trigger: { event: 'job.assigned' }, conditions: [],
        steps: [{ id: 'notify', action: 'notify', params: { assignee: true, text: 'You have a new assignment.' }, mode: 'automatic', approval: noApproval, onException: { notifyRoles: ['dispatcher'], stop: true } }],
      },
    },
  ];
}
