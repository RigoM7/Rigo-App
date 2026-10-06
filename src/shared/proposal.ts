import type { Definition, Step, TriggerEvent } from './workflows.js';

// Rule-based (not AI) translation of a plain-language request into a workflow proposal.
// It recognizes a small vocabulary and says exactly what it did not understand.

const noApproval = { required: 'never' as const, conditions: [], approverRoles: [], approverUserIds: [], backupUserIds: [], escalateAfterHours: null };
const exc = { notifyRoles: ['owner'], stop: true };

const ROLE_WORDS: [RegExp, string][] = [
  [/\bowners?\b|\bme\b/, 'owner'], [/\bdispatch(ers?)?\b/, 'dispatcher'], [/\bdrivers?\b/, 'driver'], [/\boffice\b|\bbilling\b|\baccounting\b/, 'office'],
];

export interface ProposalResult { definition: Definition | null; name: string; understood: string[]; notUnderstood: string[] }

export function proposeFromText(text: string): ProposalResult {
  const t = ` ${text.toLowerCase()} `;
  const understood: string[] = [];
  const notUnderstood: string[] = [];
  let event: TriggerEvent | null = null;
  if (/(couldn'?t|could not|unsuccessful|failed visit|no access|not complete)/.test(t)) event = 'job.unsuccessful';
  else if (/partial(ly)?/.test(t)) event = 'job.partial';
  else if (/problem|issue reported|report(s|ed)? a problem/.test(t)) event = 'job.problem_reported';
  else if (/assign(ed|s)?/.test(t) && !/invoice/.test(t.split(/then|,/)[0] ?? '')) event = 'job.assigned';
  else if (/invoice (is )?issued/.test(t)) event = 'invoice.issued';
  else if (/(job|visit|delivery|service|work)[^.]*?(is )?(complete|completed|finished|done)/.test(t) || /when .*complete/.test(t)) event = 'job.completed';
  else if (/new job|job is created|job created/.test(t)) event = 'job.created';
  if (event) understood.push(`Trigger: ${event.replace('.', ' ').replace('_', ' ')}`);
  else notUnderstood.push('When it should start (for example "when a job is completed")');

  const conditions: Definition['conditions'] = [];
  if (/\bfuel\b/.test(t)) conditions.push({ field: 'job.service_category', op: 'eq', value: 'fuel' });
  else if (/septic/.test(t)) conditions.push({ field: 'job.service_category', op: 'eq', value: 'septic' });
  else if (/toilet|porta|restroom/.test(t)) conditions.push({ field: 'job.service_category', op: 'eq', value: 'portable_toilet' });
  if (conditions.length) understood.push(`Only for ${conditions[0].value} services`);

  const roles = ROLE_WORDS.filter(([re]) => re.test(t)).map(([, r]) => r);
  const steps: Step[] = [];
  const wantsInvoice = /invoice|bill/.test(t);
  const wantsApproval = /approv|review|check with|ask me/.test(t);
  const wantsIssue = /issue|finali[sz]e/.test(t) || (wantsInvoice && wantsApproval);
  const wantsEmail = /email|send (it|the invoice)|send to (the )?customer|let the customer know|tell the customer/.test(t);
  const wantsNotify = /notify|tell|alert|let .* know|message (the )?(owner|dispatch|office|driver)/.test(t);
  const wantsFollowup = /follow[- ]?up|reschedul/.test(t);

  if (wantsNotify) {
    const notifyRoles = roles.filter((r) => r !== 'driver');
    const assignee = /\bdriver\b/.test(t) && (event === 'job.assigned' || /assigned driver/.test(t));
    steps.push({ id: 'notify', action: 'notify', params: { roles: notifyRoles.length ? notifyRoles : assignee ? [] : ['owner'], assignee, text: 'Update from Rigo' }, mode: null, approval: noApproval, onException: exc });
    understood.push(`Notify ${[...(assignee ? ['the assigned driver'] : []), ...(notifyRoles.length ? notifyRoles : assignee ? [] : ['owner'])].join(', ')}`);
  }
  if (wantsInvoice && event && event.startsWith('job.') && event !== 'job.unsuccessful') {
    steps.push({ id: 'prepare', action: 'invoice.prepare', params: {}, mode: null, approval: noApproval, onException: exc });
    understood.push('Prepare an invoice draft');
    if (wantsIssue) {
      const approverRoles = roles.filter((r) => r === 'owner' || r === 'office');
      steps.push({ id: 'issue', action: 'invoice.issue', params: {}, mode: null, approval: wantsApproval ? { ...noApproval, required: 'always', approverRoles: approverRoles.length ? approverRoles : ['owner'], escalateAfterHours: 24 } : noApproval, onException: exc });
      understood.push(wantsApproval ? `Issue it after approval by ${(approverRoles.length ? approverRoles : ['owner']).join(' or ')}` : 'Issue it (no approval requested; consider adding one)');
    }
    if (wantsEmail) {
      if (!wantsIssue) {
        steps.push({ id: 'issue', action: 'invoice.issue', params: {}, mode: null, approval: { ...noApproval, required: 'always', approverRoles: ['owner'], escalateAfterHours: 24 }, onException: exc });
        understood.push('Issue it after owner approval (an invoice must be issued before it is emailed)');
      }
      steps.push({ id: 'email', action: 'message.prepare_invoice', params: {}, mode: null, approval: noApproval, onException: exc });
      steps.push({ id: 'send', action: 'message.send', params: {}, mode: null, approval: noApproval, onException: exc });
      understood.push('Prepare and send the invoice email (sending needs an email service; otherwise it stays prepared)');
    }
  } else if (wantsEmail && event?.startsWith('job.')) {
    steps.push({ id: 'update', action: 'message.prepare_job_update', params: {}, mode: null, approval: noApproval, onException: exc });
    steps.push({ id: 'send', action: 'message.send', params: {}, mode: null, approval: wantsApproval ? { ...noApproval, required: 'always', approverRoles: ['owner'] } : noApproval, onException: exc });
    understood.push('Prepare and send a customer update');
  }
  if (wantsFollowup && event?.startsWith('job.')) {
    steps.push({ id: 'followup', action: 'job.create_followup', params: {}, mode: null, approval: noApproval, onException: exc });
    understood.push('Draft a follow-up job');
  }
  if (!steps.length) notUnderstood.push('What Rigo should do (prepare an invoice, notify someone, email the customer, draft a follow-up)');
  if (/\b(pay|charge card|refund|tax rate|price|discount)\b/.test(t)) notUnderstood.push('Payments, prices, taxes and discounts are configured in Services and Invoices, not by workflows');
  const name = event ? `${steps.map((s) => s.action.split('.').pop()).join(' + ') || 'workflow'} on ${event.split('.')[1].replace('_', ' ')}` : 'New workflow';
  return { definition: event && steps.length ? { trigger: { event }, conditions, steps } : null, name: name.charAt(0).toUpperCase() + name.slice(1), understood, notUnderstood };
}
