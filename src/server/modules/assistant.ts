import { Hono } from 'hono';
import { z } from 'zod';
import { type AppEnv, type CompanyCtx, need, can } from '../http/context.js';
import { body } from '../lib/util.js';
import { HttpError } from '../http/errors.js';
import { aiProviderFor, AI_SYSTEM_PROMPT } from '../adapters/ai.js';
import { config } from '../config.js';
import { proposeFromText } from '../../shared/proposal.js';
import { validateDefinition, explainDefinition } from '../../shared/workflows.js';
import { insertWorkflow } from './structure.js';
import { setupChecklist } from './companies.js';
import { capabilities } from '../adapters/index.js';
import { localDate, addDays, zonedToUtc } from '../../shared/schedule.js';
import { classify, isAutomationRequest } from '../../shared/assistant.js';
import { fold, looselyMatches } from '../../shared/customers.js';
import { MODES, MODE_HELP, ACTIONS, type Mode } from '../../shared/workflows.js';
import { balanceDue, paymentState } from '../../shared/invoices.js';
import { formatMoney, formatRate } from '../../shared/billing.js';
import { readPricing } from '../../shared/services.js';
import { DEFAULT_JOB_MINUTES } from '../../shared/jobs.js';

// The assistant. Without a configured AI provider it answers with clearly labeled prepared
// responses computed from the user's authorized data. Workflow proposals are stored separately
// from active configuration and become drafts only when a person accepts them.

export const assistantRoutes = new Hono<AppEnv>();

type Link = { label: string; to: string };
type Reply = { content: string; proposal?: any; links?: Link[] };

const fmtWhen = (iso: string, tz: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso));
const fmtTimeOnly = (iso: string, tz: string) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso));

async function authorizedSnapshot(cc: CompanyCtx) {
  const lines: string[] = [];
  const db = cc.db;
  const tz = cc.company.timezone;
  const today = localDate(new Date(), tz);
  if (can(cc, 'jobs.view_all')) {
    const r = (await db.query<any>(`select count(*) filter (where status in ('open','in_progress') and assigned_user_id is null)::int as unassigned,
        count(*) filter (where status = 'draft')::int as drafts, count(*) filter (where problem_open)::int as problems,
        count(*) filter (where status in ('open','in_progress') and (scheduled_start at time zone $2)::date = $3::date)::int as today
        from rigo.jobs where company_id = $1`, [cc.company.id, tz, today])).rows[0];
    lines.push(`Jobs today: ${r.today}. Open jobs without a driver: ${r.unassigned}. Drafts still missing details: ${r.drafts}. Jobs with a reported problem: ${r.problems}.`);
  } else if (can(cc, 'jobs.view_assigned')) {
    const r = (await db.query<any>(`select count(*)::int n from rigo.jobs where company_id = $1 and assigned_user_id = $2 and status in ('open','in_progress')`, [cc.company.id, cc.actingUserId])).rows[0];
    lines.push(`Your open jobs: ${r.n}.`);
  }
  if (can(cc, 'invoices.view')) {
    const r = (await db.query<any>(`select count(*) filter (where status = 'held')::int held, count(*) filter (where status in ('draft','pending_approval'))::int drafts, count(*) filter (where status = 'issued' and payment_status <> 'paid')::int unpaid from rigo.invoices where company_id = $1`, [cc.company.id])).rows[0];
    lines.push(`Invoices on hold: ${r.held}. Invoices waiting to be approved: ${r.drafts}. Issued and not yet paid: ${r.unpaid}.`);
  }
  const pending = (await db.query<any>(`select count(*)::int n from rigo.approvals where company_id = $1 and status = 'pending'`, [cc.company.id])).rows[0].n;
  // Plain words, never the setting's key (R15-m2).
  if (can(cc, 'workflows.view')) lines.push(`Approvals waiting: ${pending}. Automation: ${MODES[cc.company.automation_mode as Mode] ?? cc.company.automation_mode}${cc.company.paused ? ', paused' : ''}. ${MODE_HELP[cc.company.automation_mode as Mode] ?? ''}`.trim());
  return lines;
}

/** Customers whose name matches what was typed: exact words first, then a typo away. */
async function findCustomers(cc: CompanyCtx, name: string) {
  const exact = (await cc.db.query<{ id: string; name: string }>(`select id, name from rigo.customers where company_id = $1 and archived_at is null and rigo.fold(name) like $2 order by name limit 5`, [cc.company.id, `%${fold(name)}%`])).rows;
  if (exact.length) return exact;
  const all = (await cc.db.query<{ id: string; name: string }>(`select id, name from rigo.customers where company_id = $1 and archived_at is null limit 5000`, [cc.company.id])).rows;
  return all.filter((c) => looselyMatches(c.name, name)).slice(0, 5);
}

async function customerAnswer(cc: CompanyCtx, name: string, wants: 'next' | 'owes' | 'both'): Promise<Reply> {
  if (!can(cc, 'customers.view')) return { content: "Your role doesn't include customers, so I can't look that up." };
  const found = await findCustomers(cc, name);
  if (!found.length) return { content: `I couldn't find a customer called "${name}". Check the spelling, or search in Customers.`, links: [{ label: 'Customers', to: 'customers' }] };
  if (found.length > 1 && fold(found[0].name) !== fold(name)) return { content: `Several customers match "${name}". Which one?\n${found.map((c) => `• ${c.name}`).join('\n')}`, links: found.slice(0, 3).map((c) => ({ label: c.name, to: `customers/${c.id}` })) };
  const cu = found[0];
  const tz = cc.company.timezone;
  const parts: string[] = [];
  const links: Link[] = [{ label: cu.name, to: `customers/${cu.id}` }];
  if (wants !== 'owes') {
    if (!can(cc, 'jobs.view_all')) parts.push("Your role doesn't include the schedule, so I can't say when the next visit is.");
    else {
      const next = (await cc.db.query<any>(`select j.id, j.number, j.scheduled_start, s.name as service_name, coalesce(j.location_snapshot->>'address', l.address) as address, j.assigned_user_id,
          (select coalesce(m.display_name, u.name) from rigo.users u left join rigo.memberships m on m.user_id = u.id and m.company_id = j.company_id where u.id = j.assigned_user_id) as driver
          from rigo.jobs j left join rigo.services s on s.id = j.service_id left join rigo.locations l on l.id = j.location_id
          where j.company_id = $1 and (j.customer_id = $2 or j.bill_to_customer_id = $2) and j.status in ('open','in_progress') and j.scheduled_start is not null
          order by j.scheduled_start limit 1`, [cc.company.id, cu.id])).rows[0];
      if (next) {
        parts.push(`Next visit for ${cu.name}: ${fmtWhen(next.scheduled_start, tz)}, ${next.service_name ?? 'job'} #${next.number}${next.address ? ` at ${next.address}` : ''}${next.driver ? `, with ${next.driver}` : ', no driver yet'}.`);
        links.push({ label: `Job #${next.number}`, to: `jobs/${next.id}` });
      } else parts.push(`${cu.name} has no visit scheduled. Create one from their page with "New job".`);
    }
  }
  if (wants !== 'next') {
    if (!can(cc, 'finance.view') || !can(cc, 'invoices.view')) parts.push('Balances are shown to people who see billing.');
    else {
      const open = (await cc.db.query<any>(`select total_minor, paid_minor, credited_minor, payment_status, due_date, status, currency from rigo.invoices
          where customer_id = $1 and company_id = $2 and status = 'issued' and payment_status <> 'paid'`, [cu.id, cc.company.id])).rows;
      const today = localDate(new Date(), tz);
      const owed = open.map((i) => ({ bal: balanceDue({ totalMinor: Number(i.total_minor), paidMinor: Number(i.paid_minor), creditedMinor: Number(i.credited_minor ?? 0) }) ?? 0, late: paymentState({ status: i.status, paymentStatus: i.payment_status, dueDate: i.due_date }, today).key === 'overdue' })).filter((i) => i.bal > 0);
      const total = owed.reduce((t, i) => t + i.bal, 0);
      const late = owed.filter((i) => i.late).length;
      parts.push(owed.length ? `${cu.name} owes ${formatMoney(total, cc.company.currency)} on ${owed.length} unpaid invoice${owed.length === 1 ? '' : 's'}${late ? ` (${late} overdue)` : ''}.` : `${cu.name} owes nothing right now.`);
    }
  }
  return { content: parts.join('\n'), links };
}

async function driversFree(cc: CompanyCtx, day: 'today' | 'tomorrow', hour: number, minute: number): Promise<Reply> {
  if (!can(cc, 'jobs.view_all')) return { content: "Your role doesn't include the whole schedule, so I can't say who is free." };
  const tz = cc.company.timezone;
  const date = day === 'today' ? localDate(new Date(), tz) : addDays(localDate(new Date(), tz), 1);
  const start = zonedToUtc(date, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, tz);
  const end = new Date(start.getTime() + 60 * 60000);
  const people = (await cc.db.query<{ id: string; name: string }>(`select m.user_id as id, coalesce(m.display_name, u.name) as name from rigo.memberships m join rigo.users u on u.id = m.user_id
      join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key where m.company_id = $1 and m.status = 'active' and 'jobs.work' = any(r.permissions) order by name`, [cc.company.id])).rows;
  if (!people.length) return { content: 'Nobody in the company has a role that does jobs yet. Invite drivers from Team.', links: [{ label: 'Team', to: 'team' }] };
  const busy = (await cc.db.query<any>(`select j.assigned_user_id, j.number, j.scheduled_start, coalesce(j.scheduled_end, j.scheduled_start + interval '${DEFAULT_JOB_MINUTES} minutes') as ends
      from rigo.jobs j where j.company_id = $1 and j.status in ('open','in_progress') and j.assigned_user_id is not null
        and j.scheduled_start < $3 and coalesce(j.scheduled_end, j.scheduled_start + interval '${DEFAULT_JOB_MINUTES} minutes') > $2`, [cc.company.id, start.toISOString(), end.toISOString()])).rows;
  const free = people.filter((p) => !busy.some((b) => b.assigned_user_id === p.id));
  const when = `${fmtTimeOnly(start.toISOString(), tz)} ${day} (${new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }).format(start)})`;
  const busyLines = people.filter((p) => !free.includes(p)).map((p) => {
    const jobs = busy.filter((b) => b.assigned_user_id === p.id).map((b) => `job #${b.number}, ${fmtTimeOnly(b.scheduled_start, tz)}–${fmtTimeOnly(b.ends, tz)}`);
    return `• ${p.name}: ${jobs.join('; ')}`;
  });
  return {
    content: `${free.length ? `Free for an hour from ${when}: ${free.map((p) => p.name).join(', ')}.` : `Nobody is free for an hour from ${when}.`}${busyLines.length ? `\n\nBusy then:\n${busyLines.join('\n')}` : ''}`,
    links: [{ label: 'Open the timeline', to: 'jobs?view=schedule' }],
  };
}

async function priceAnswer(cc: CompanyCtx, item: string): Promise<Reply> {
  if (!can(cc, 'finance.view')) return { content: 'Prices are shown to people who see billing. Ask an owner or the office.' };
  const want = fold(item).replace(/s$/, '');
  const svcs = (await cc.db.query<any>(`select id, name, pricing from rigo.services where company_id = $1 and active order by name`, [cc.company.id])).rows;
  const hits: { svc: any; line: any }[] = [];
  for (const sv of svcs) for (const line of readPricing(sv.pricing)) {
    const hay = fold(`${line.label} ${line.when?.equals ?? ''} ${sv.name}`);
    if (want.split(/\s+/).every((w) => hay.includes(w))) hits.push({ svc: sv, line });
  }
  if (!hits.length) return { content: `I couldn't find a price for "${item}". Prices are listed per service in Services & pricing.`, links: [{ label: 'Services & pricing', to: 'services' }] };
  const cur = cc.company.currency;
  return {
    content: `${hits.slice(0, 6).map(({ svc, line }) => `• ${line.label} (${svc.name}): ${line.rateE4 === null ? 'no rate set yet, so invoices with it are held' : `${formatRate(line.rateE4, cur)}${line.basis === 'per_quantity' && line.unit ? ` per ${line.unit}` : ''}`}${line.minimumMinor ? `, at least ${formatMoney(line.minimumMinor, cur)}` : ''}`).join('\n')}\n\nCustomers with their own prices pay those instead; see the customer's page.`,
    links: [...new Map(hits.map((h) => [h.svc.id, { label: h.svc.name, to: `services/${h.svc.id}` }])).values()].slice(0, 3),
  };
}

async function whyCantApprove(cc: CompanyCtx): Promise<Reply> {
  if (!can(cc, 'invoices.approve') && !can(cc, 'approvals.decide')) {
    return { content: `Your role, ${cc.roleName}, doesn't include "Approve invoices" or "Decide approvals". An owner can add it in Team → Roles, or hand you approvals for a while with "Delegate approvals".`, links: [{ label: 'Team', to: 'team' }] };
  }
  const waiting = (await cc.db.query<any>(`select a.id, a.title, a.approver_user_ids, a.approver_roles from rigo.approvals a where a.company_id = $1 and a.status = 'pending' order by a.created_at desc limit 20`, [cc.company.id])).rows;
  const notMine = waiting.filter((a) => (a.approver_user_ids?.length && !a.approver_user_ids.includes(cc.user.id)) || (a.approver_roles?.length && !a.approver_roles.includes(cc.roleKey) && !a.approver_user_ids?.includes(cc.user.id)));
  if (!notMine.length) return { content: 'You can approve invoices. If one is on hold, fix the hold first: its page lists what is missing. A draft someone is still editing can be approved once it is saved.', links: [{ label: 'Invoices on hold', to: 'invoices?status=held' }] };
  return { content: `You can approve invoices, but ${notMine.length === 1 ? 'this approval names' : 'these approvals name'} someone else:\n${notMine.slice(0, 5).map((a) => `• ${a.title}`).join('\n')}\n\nA workflow step can say who approves (for example the owner over $5,000). Owners can always decide.`, links: [{ label: 'Approvals', to: 'inbox' }] };
}

function cantYet(cc: CompanyCtx, what: 'text' | 'statement' | 'route' | 'payment'): Reply {
  const caps = capabilities(cc.company);
  if (what === 'text') return caps.sms.state === 'disabled'
    ? { content: `Rigo can't send texts yet: ${caps.sms.reason} Meanwhile, write the message from the customer's or job's page ("Message customer"), then copy it and send it from your phone.`, links: [{ label: 'Messages', to: 'messages' }] }
    : { content: 'Write the text from the customer\'s or job\'s page with "Message customer" and choose Text. It is prepared first; you send it from Messages.', links: [{ label: 'Messages', to: 'messages' }] };
  if (what === 'statement') return { content: `Statements are prepared on the 1st for customers marked "monthly statement", and on demand from a customer's page (Account → Prepare statement). ${caps.email.state === 'available' ? 'Then send it from Messages.' : 'Without an email service it stays prepared: print it or copy the email from Messages.'}`, links: [{ label: 'Collections', to: 'collections' }] };
  if (what === 'route') return { content: "Rigo doesn't plan routes. Each driver's list is in time order with \"Today's stops in order\", and every stop has Open in Maps." };
  return { content: "Rigo doesn't take card payments. Record a payment you received on the invoice, or let drivers record one at the stop." };
}

async function prepared(cc: CompanyCtx, text: string): Promise<Reply> {
  const intent = classify(text);
  if (intent.kind === 'proposal') {
    if (!can(cc, 'workflows.edit')) return { content: 'Workflow proposals need the "Edit workflows" permission. Ask an owner to set this up.' };
    const people = (await cc.db.query<{ id: string; name: string }>(`select m.user_id as id, coalesce(m.display_name, u.name) as name from rigo.memberships m join rigo.users u on u.id = m.user_id where m.company_id = $1 and m.status = 'active' and not m.is_fictional`, [cc.company.id])).rows;
    const p = proposeFromText(text, { people });
    if (!p.definition) {
      return { content: `I could not build a workflow from that yet. Missing: ${p.notUnderstood.join('; ')}.\n\nTry: "When a fuel job is completed, prepare an invoice, ask me to approve it, then email the customer."` };
    }
    const roles = (await cc.db.query<{ key: string; name: string }>(`select key, name from rigo.roles where company_id = $1`, [cc.company.id])).rows;
    const validation = validateDefinition(p.definition, { roles: roles.map((r) => r.key), emailAvailable: capabilities(cc.company).email.state === 'available', isDemo: cc.isDemo });
    const { workflowId, versionId } = await insertWorkflow(cc.db, cc.company.id, cc.user.id, { name: p.name, description: `Proposed from: "${text.slice(0, 200)}"`, definition: p.definition }, 'assistant', 'proposal');
    const explanation = explainDefinition(p.definition, { ...Object.fromEntries(roles.map((r) => [r.key, r.name])), ...Object.fromEntries(people.map((x) => [x.id, x.name])) });
    return {
      content: `Here is a proposed workflow, "${p.name}". It is not active: accept it to make a draft, then test and activate it yourself.\n\n${explanation.join('\n')}${p.notUnderstood.length ? `\n\nNot included: ${p.notUnderstood.join('; ')}.` : ''}`,
      proposal: { workflowId, versionId, name: p.name, explanation, validation, understood: p.understood, notIncluded: p.notUnderstood, state: 'proposed' },
    };
  }
  if (intent.kind === 'customer') return customerAnswer(cc, intent.name, intent.wants);
  if (intent.kind === 'driversFree') return driversFree(cc, intent.day, intent.hour, intent.minute);
  if (intent.kind === 'price') return priceAnswer(cc, intent.item);
  if (intent.kind === 'whyCantApprove') return whyCantApprove(cc);
  if (intent.kind === 'cantYet') return cantYet(cc, intent.what);
  if (intent.kind === 'attention') {
    const s = await authorizedSnapshot(cc);
    const items = (await cc.db.query<any>(`select title, link from rigo.notifications where company_id = $1 and user_id = $2 and category = 'needs_action' and resolved_at is null order by created_at desc limit 5`, [cc.company.id, cc.user.id])).rows;
    return {
      content: `Here is what needs attention, from your current records:\n${s.map((l) => `• ${l}`).join('\n')}${items.length ? `\n\nIn your inbox:\n${items.map((i) => `• ${i.title}`).join('\n')}` : '\n\nNothing in your inbox needs action.'}`,
      links: [{ label: 'Open your inbox', to: 'inbox' }, ...items.filter((i) => i.link).slice(0, 2).map((i) => ({ label: i.title.length > 40 ? `${i.title.slice(0, 39)}…` : i.title, to: i.link }))],
    };
  }
  if (intent.kind === 'held') {
    const parts: string[] = [];
    const links: Link[] = [];
    if (can(cc, 'invoices.view')) {
      const held = (await cc.db.query<any>(`select i.id, j.number, i.hold_reasons from rigo.invoices i left join rigo.jobs j on j.id = i.job_id where i.company_id = $1 and i.status = 'held' order by i.created_at desc limit 3`, [cc.company.id])).rows;
      for (const h of held) { parts.push(`Invoice for job #${h.number ?? '?'} is on hold: ${(h.hold_reasons as string[]).join(' ')}`); links.push({ label: `Invoice for job #${h.number ?? '?'}`, to: `invoices/${h.id}` }); }
    }
    if (can(cc, 'workflows.view')) {
      const blocked = (await cc.db.query<any>(`select type, explanation from rigo.actions where company_id = $1 and status in ('blocked','failed') order by updated_at desc limit 3`, [cc.company.id])).rows;
      for (const b of blocked) parts.push(`${ACTIONS[b.type]?.label ?? 'A workflow step'}: ${b.explanation}`);
      if (blocked.length) links.push({ label: 'Automation', to: 'automation' });
    }
    return { content: parts.length ? `What is held or stopped, newest first:\n${parts.map((p) => `• ${p}`).join('\n')}\n\nFix what each one names; held invoices are rebuilt when a rate is added.` : 'Nothing is held, blocked or failed right now.', links };
  }
  if (intent.kind === 'today') {
    const s = await authorizedSnapshot(cc);
    return { content: `${s[0] ?? 'No schedule information is available to your role.'}\n\nJobs are listed by their scheduled time; each stop has Open in Maps.`, links: can(cc, 'jobs.view_all') ? [{ label: "Today's timeline", to: '' }] : [{ label: 'My jobs', to: 'today' }] };
  }
  if (intent.kind === 'setup' && can(cc, 'company.settings')) {
    const cl = await setupChecklist(cc.db, cc.company.id);
    const todo = cl.items.filter((i) => !i.done);
    return { content: todo.length ? `Setup is ${cl.done} of ${cl.total} done. Next:\n${todo.slice(0, 5).map((i) => `• ${i.label}${(i as any).note ? ` (${(i as any).note})` : ''}`).join('\n')}` : 'Setup is complete. You can refine services, workflows and branding any time.', links: todo.length ? [{ label: 'Continue setup', to: 'setup' }] : [] };
  }
  return { content: 'I can answer:\n• "What needs my attention?"\n• "When is Grace Okafor\'s next visit?" or "What does Hollis owe?"\n• "Who is free at 2pm tomorrow?"\n• "How much do we charge for dyed diesel?"\n• "Why is an invoice on hold?" or "Why can\'t I approve this?"\n• "When a job is completed, prepare an invoice and ask me to approve it" (a workflow proposal)' };
}

assistantRoutes.get('/assistant', async (c) => {
  const cc = c.get('cc');
  need(cc, 'assistant.use');
  const { rows } = await cc.db.query(`select * from rigo.assistant_messages where company_id = $1 and user_id = $2 order by created_at desc limit 40`, [cc.company.id, cc.user.id]);
  const ai = capabilities(cc.company).ai;
  return c.json({ messages: rows.reverse(), ai });
});

assistantRoutes.post('/assistant', async (c) => {
  const cc = c.get('cc');
  need(cc, 'assistant.use');
  const input = await body(c, z.object({ text: z.string().trim().min(1).max(2000) }));
  await cc.db.query(`insert into rigo.assistant_messages (company_id, user_id, role, content, source) values ($1,$2,'user',$3,'user')`, [cc.company.id, cc.user.id, input.text]);
  const provider = aiProviderFor(cc.company);
  let reply: Reply & { source: 'prepared' | 'ai' };
  const wantsProposal = isAutomationRequest(input.text);
  if (provider && !wantsProposal) {
    const day = new Date().toISOString().slice(0, 10);
    const used = (await cc.db.query<{ count: number }>(`insert into rigo.usage_counters (company_id, kind, day, count) values ($1,'ai',$2,1) on conflict (company_id, kind, day) do update set count = rigo.usage_counters.count + 1 returning count`, [cc.company.id, day])).rows[0].count;
    if (used > config.ai.dailyLimit) throw new HttpError(429, 'ai_limit', `The daily assistant limit (${config.ai.dailyLimit}) was reached. Prepared responses are still available tomorrow or ask an owner to raise the limit.`);
    try {
      const snapshot = await authorizedSnapshot(cc);
      const r = await provider.complete({ system: AI_SYSTEM_PROMPT, context: snapshot.join('\n'), question: input.text });
      reply = { content: r.text, source: 'ai' };
    } catch (e: any) {
      const fallback = await prepared(cc, input.text);
      reply = { ...fallback, content: `The AI service is unavailable (${String(e?.message ?? e).slice(0, 80)}). Prepared response instead:\n\n${fallback.content}`, source: 'prepared' };
    }
  } else {
    // Workflow proposals always go through the deterministic builder so they are validated data.
    reply = { ...(await prepared(cc, input.text)), source: 'prepared' };
  }
  const { rows } = await cc.db.query(`insert into rigo.assistant_messages (company_id, user_id, role, content, source, proposal, links) values ($1,$2,'assistant',$3,$4,$5,$6) returning *`,
    [cc.company.id, cc.user.id, reply.content, reply.source, reply.proposal ? JSON.stringify(reply.proposal) : null, JSON.stringify(reply.links ?? [])]);
  return c.json({ message: rows[0] });
});

assistantRoutes.post('/assistant/clear', async (c) => {
  const cc = c.get('cc');
  await cc.db.query(`delete from rigo.assistant_messages where company_id = $1 and user_id = $2`, [cc.company.id, cc.user.id]);
  return c.json({ ok: true });
});
