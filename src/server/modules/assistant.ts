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
import { localDate } from '../../shared/schedule.js';

// The assistant. Without a configured AI provider it answers with clearly labeled prepared
// responses computed from the user's authorized data. Workflow proposals are stored separately
// from active configuration and become drafts only when a person accepts them.

export const assistantRoutes = new Hono<AppEnv>();

const isProposalRequest = (t: string) => /workflow|automat|whenever|every time|propose|^\s*when\b/.test(t);

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
    lines.push(`Jobs today: ${r.today}. Unassigned open jobs: ${r.unassigned}. Draft jobs: ${r.drafts}. Jobs with open problems: ${r.problems}.`);
  } else if (can(cc, 'jobs.view_assigned')) {
    const r = (await db.query<any>(`select count(*)::int n from rigo.jobs where company_id = $1 and assigned_user_id = $2 and status in ('open','in_progress')`, [cc.company.id, cc.actingUserId])).rows[0];
    lines.push(`Your open assignments: ${r.n}.`);
  }
  if (can(cc, 'invoices.view')) {
    const r = (await db.query<any>(`select count(*) filter (where status = 'held')::int held, count(*) filter (where status in ('draft','pending_approval'))::int drafts, count(*) filter (where status = 'issued' and payment_status <> 'paid')::int unpaid from rigo.invoices where company_id = $1`, [cc.company.id])).rows[0];
    lines.push(`Invoices on hold: ${r.held}. Drafts awaiting approval: ${r.drafts}. Issued and unpaid: ${r.unpaid}.`);
  }
  const pending = (await db.query<any>(`select count(*)::int n from rigo.approvals where company_id = $1 and status = 'pending'`, [cc.company.id])).rows[0].n;
  if (can(cc, 'workflows.view')) lines.push(`Pending approvals: ${pending}. Automation mode: ${cc.company.automation_mode}${cc.company.paused ? ' (paused)' : ''}.`);
  return lines;
}

async function prepared(cc: CompanyCtx, text: string): Promise<{ content: string; proposal?: any }> {
  const t = text.toLowerCase();
  if (isProposalRequest(t)) {
    if (!can(cc, 'workflows.edit')) return { content: 'Workflow proposals need the "Edit workflows" permission. Ask an owner to set this up.' };
    const p = proposeFromText(text);
    if (!p.definition) {
      return { content: `I could not build a workflow from that yet. Missing: ${p.notUnderstood.join('; ')}.\n\nTry: "When a fuel job is completed, prepare an invoice, ask me to approve it, then email the customer."` };
    }
    const roles = (await cc.db.query<{ key: string; name: string }>(`select key, name from rigo.roles where company_id = $1`, [cc.company.id])).rows;
    const validation = validateDefinition(p.definition, { roles: roles.map((r) => r.key), emailAvailable: capabilities(cc.company).email.state === 'available', isDemo: cc.isDemo });
    const { workflowId, versionId } = await insertWorkflow(cc.db, cc.company.id, cc.user.id, { name: p.name, description: `Proposed from: "${text.slice(0, 200)}"`, definition: p.definition }, 'assistant', 'proposal');
    const explanation = explainDefinition(p.definition, Object.fromEntries(roles.map((r) => [r.key, r.name])));
    return {
      content: `Here is a proposed workflow. It is not active: accept it to make a draft, then test and activate it yourself.\n\n${explanation.join('\n')}${p.notUnderstood.length ? `\n\nNot included: ${p.notUnderstood.join('; ')}.` : ''}`,
      proposal: { workflowId, versionId, name: p.name, explanation, validation, understood: p.understood, state: 'proposed' },
    };
  }
  if (/attention|need(s)? me|to ?do|waiting|approv/.test(t)) {
    const s = await authorizedSnapshot(cc);
    const items = (await cc.db.query<any>(`select title from rigo.notifications where company_id = $1 and user_id = $2 and category = 'needs_action' and resolved_at is null order by created_at desc limit 5`, [cc.company.id, cc.user.id])).rows;
    return { content: `Here is what needs attention, from your current records:\n${s.map((l) => `• ${l}`).join('\n')}${items.length ? `\n\nIn your inbox:\n${items.map((i) => `• ${i.title}`).join('\n')}` : '\n\nYour action inbox is clear.'}` };
  }
  if (/why|held|hold|blocked|stuck|fail/.test(t)) {
    const parts: string[] = [];
    if (can(cc, 'invoices.view')) {
      const held = (await cc.db.query<any>(`select i.id, j.number, i.hold_reasons from rigo.invoices i left join rigo.jobs j on j.id = i.job_id where i.company_id = $1 and i.status = 'held' order by i.created_at desc limit 3`, [cc.company.id])).rows;
      for (const h of held) parts.push(`Invoice for job #${h.number ?? '?'} is on hold: ${(h.hold_reasons as string[]).join(' ')}`);
    }
    if (can(cc, 'workflows.view')) {
      const blocked = (await cc.db.query<any>(`select type, explanation from rigo.actions where company_id = $1 and status in ('blocked','failed') order by updated_at desc limit 3`, [cc.company.id])).rows;
      for (const b of blocked) parts.push(`${b.type}: ${b.explanation}`);
    }
    return { content: parts.length ? `Recent exceptions:\n${parts.map((p) => `• ${p}`).join('\n')}` : 'Nothing is held, blocked or failed right now.' };
  }
  if (/today|schedule|my jobs|route/.test(t)) {
    const s = await authorizedSnapshot(cc);
    return { content: `${s[0] ?? 'No schedule information is available to your role.'}\n\nRoute optimization and maps are not connected; jobs are listed by scheduled time.` };
  }
  if (/set ?up|start|configure|onboard|ready/.test(t) && can(cc, 'company.settings')) {
    const cl = await setupChecklist(cc.db, cc.company.id);
    const todo = cl.items.filter((i) => !i.done);
    return { content: todo.length ? `Setup is ${cl.done} of ${cl.total} done. Next:\n${todo.slice(0, 5).map((i) => `• ${i.label}${(i as any).note ? ` (${(i as any).note})` : ''}`).join('\n')}` : 'Setup is complete. You can refine services, workflows and branding any time.' };
  }
  return { content: 'I can help with:\n• "What needs my attention?"\n• "Why is an invoice on hold?"\n• "What is on today?"\n• "When a job is completed, prepare an invoice and ask me to approve it" (creates a workflow proposal)\n• "What is left to set up?"' };
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
  let reply: { content: string; proposal?: any; source: 'prepared' | 'ai' };
  const wantsProposal = isProposalRequest(input.text.toLowerCase());
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
  const { rows } = await cc.db.query(`insert into rigo.assistant_messages (company_id, user_id, role, content, source, proposal) values ($1,$2,'assistant',$3,$4,$5) returning *`,
    [cc.company.id, cc.user.id, reply.content, reply.source, reply.proposal ? JSON.stringify(reply.proposal) : null]);
  return c.json({ message: rows[0] });
});

assistantRoutes.post('/assistant/clear', async (c) => {
  const cc = c.get('cc');
  await cc.db.query(`delete from rigo.assistant_messages where company_id = $1 and user_id = $2`, [cc.company.id, cc.user.id]);
  return c.json({ ok: true });
});
