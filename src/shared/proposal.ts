import type { Definition, Step, TriggerEvent } from './workflows.js';

// Rule-based (not AI) translation of a plain-language request into a workflow proposal.
// It recognizes a small vocabulary and says exactly what it did not understand.

const noApproval = { required: 'never' as const, conditions: [], approverRoles: [], approverUserIds: [], backupUserIds: [], escalateAfterHours: null };
const exc = { notifyRoles: ['owner'], stop: true };

const ROLE_WORDS: [RegExp, string][] = [
  [/\bowners?\b|\bme\b/, 'owner'], [/\bdispatch(ers?)?\b/, 'dispatcher'], [/\bdrivers?\b/, 'driver'], [/\boffice\b|\bbilling\b|\baccounting\b/, 'office'],
];

export interface ProposalResult { definition: Definition | null; name: string; understood: string[]; notUnderstood: string[] }

/** People who may be named as approvers ("Priya approves"); matched by first name. */
export interface ProposalContext { people?: { id: string; name: string }[] }

const money = (minor: number) => `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function proposeFromText(text: string, ctx: ProposalContext = {}): ProposalResult {
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
  // "Priya approves", "approved by Marcus" (R15-m1): named approvers, by first name.
  const named = (ctx.people ?? []).filter((p) => {
    const first = p.name.trim().split(/\s+/)[0]?.toLowerCase();
    if (!first || first.length < 2) return false;
    const re = new RegExp(`\\b${first.replace(/[^a-z0-9]/g, '')}\\b[^,.;]{0,25}approv|approv[^,.;]{0,25}\\b${first.replace(/[^a-z0-9]/g, '')}\\b`);
    return re.test(t);
  });
  // "over $1,500", "above 1500": approval only for larger invoices.
  const amount = /\b(?:over|above|more than|greater than|exceeds?)\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/.exec(t);
  const overMinor = amount ? Math.round(Number(amount[1].replace(/,/g, '')) * 100) : null;
  const steps: Step[] = [];
  const wantsInvoice = /invoice|bill/.test(t);
  const wantsApproval = /approv|review|check with|ask me/.test(t) || named.length > 0;
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
      const byPeople = named.map((p) => p.id);
      const rolesForApproval = byPeople.length ? approverRoles : approverRoles.length ? approverRoles : ['owner'];
      const approval = !wantsApproval ? noApproval : {
        ...noApproval, required: overMinor !== null ? 'conditional' as const : 'always' as const,
        conditions: overMinor !== null ? [{ field: 'invoice.total_minor' as const, op: 'gt' as const, value: overMinor }] : [],
        approverRoles: rolesForApproval, approverUserIds: byPeople, escalateAfterHours: 24,
      };
      steps.push({ id: 'issue', action: 'invoice.issue', params: {}, mode: null, approval, onException: exc });
      const who = [...named.map((p) => p.name), ...rolesForApproval].join(' or ');
      understood.push(wantsApproval ? `Issue it after approval by ${who}${overMinor !== null ? ` when the total is over ${money(overMinor)}` : ''}` : 'Issue it (no approval requested; consider adding one)');
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
  // Every part of the request that matched nothing is listed, so nothing is dropped silently (R15-m1).
  const KNOWN = /\b(when(ever)?|every time|each time|after|once|job|visit|delivery|service|work|complete|completed|finished|done|fail|unsuccessful|partial|problem|assign|created|invoice|bill|approv|review|ask|issue|finali[sz]e|email|send|tell|notify|alert|let|know|message|follow|reschedul|fuel|septic|toilet|porta|owner|dispatch|office|driver|customer|me|over|above|draft|prepare)\b/;
  const peopleWords = named.map((p) => p.name.trim().split(/\s+/)[0].toLowerCase());
  for (const clause of text.split(/,(?!\d)|;|\.(?!\d)|\bthen\b/i).map((c) => c.trim()).filter(Boolean)) {
    const c = clause.toLowerCase();
    if (!KNOWN.test(c) && !peopleWords.some((w) => c.includes(w))) notUnderstood.push(`"${clause}"`);
  }
  // A plain name a person recognizes: "Septic jobs: invoice, Priya approves over $1,500, email" (R15-m1).
  const scope = conditions[0] ? `${{ fuel: 'Fuel', septic: 'Septic', portable_toilet: 'Portable toilet' }[conditions[0].value as string] ?? 'Other'} jobs` : event?.startsWith('invoice.') ? 'Invoices' : 'Jobs';
  const what = event ? ({ 'job.completed': '', 'job.partial': ' partly done', 'job.unsuccessful': ' not completed', 'job.problem_reported': ' with a problem', 'job.assigned': ' assigned', 'job.created': ' created', 'job.started': ' started', 'job.en_route': ' on the way', 'invoice.issued': ' issued', 'invoice.prepared': ' prepared', 'invoice.approved': ' approved' } as Record<string, string>)[event] ?? '' : '';
  const parts = steps.map((st) => {
    if (st.action === 'invoice.prepare') return 'invoice';
    if (st.action === 'invoice.issue') return st.approval.required === 'never' ? 'issue' : `${[...named.map((p) => p.name.split(/\s+/)[0]), ...st.approval.approverRoles].join(' or ')} approves${overMinor !== null ? ` over ${money(overMinor)}` : ''}`;
    if (st.action === 'message.prepare_invoice') return 'email';
    if (st.action === 'message.prepare_job_update') return 'customer update';
    if (st.action === 'notify') return 'notify';
    if (st.action === 'job.create_followup') return 'follow-up job';
    return null;
  }).filter(Boolean) as string[];
  const name = event ? `${scope}${what}: ${parts.join(', ') || 'workflow'}` : 'New workflow';
  return { definition: event && steps.length ? { trigger: { event }, conditions, steps } : null, name: name.slice(0, 100), understood, notUnderstood };
}
