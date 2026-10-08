import { Hono } from 'hono';
import { z } from 'zod';
import type { Q } from '../db/index.js';
import { getDb } from '../db/index.js';
import { type AppEnv, type CompanyCtx, need, needAny, audit, can, loadCompanyCtx } from '../http/context.js';
import { body } from '../lib/util.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { deliverMessage, capabilities } from '../adapters/index.js';
import { RULES, ruleByKey, effectiveLevel, type Level, type RuleLevel } from '../../shared/automation.js';
import { wordsOf, type Meaning } from '../../shared/workspace.js';
import { formatMoney } from '../../shared/money.js';
import { localDate, addDays } from '../../shared/schedule.js';
import { notifyPermission, resolveNotices } from './notify.js';

// Assisted automation: when something happens, Rigo prepares the next step (an invoice, a message)
// and a person approves it in the inbox. Owners choose the level per automation, pause everything
// and take over any item. Every attempt rechecks pause and levels; nothing approves itself.

export const automationRoutes = new Hono<AppEnv>();

export async function ruleLevels(q: Q, companyId: string) {
  const { rows } = await q.query<{ key: string; level: RuleLevel }>(`select key, level from rigo.auto_rules where company_id = $1`, [companyId]);
  return Object.fromEntries(RULES.map((r) => [r.key, rows.find((x) => x.key === r.key)?.level ?? r.defaultLevel])) as Record<string, RuleLevel>;
}

async function companyState(q: Q, companyId: string) {
  return (await q.query<{ automation_mode: Level; paused: boolean; kind: string; id: string; invoice_approval: boolean }>(
    `select id, kind, automation_mode, paused, invoice_approval from rigo.companies where id = $1`, [companyId])).rows[0];
}

async function levelFor(q: Q, companyId: string, key: string) {
  const co = await companyState(q, companyId);
  const levels = await ruleLevels(q, companyId);
  return { co, level: effectiveLevel(co.automation_mode, levels[key]) };
}

/** Records an action once (dedupe key); returns null when it was already recorded. */
async function recordAction(q: Q, companyId: string, a: { rule: string; level: Level; kind: 'invoice' | 'message'; subjectType: string; subjectId: string | null; title: string; summary?: string; status: string; dedupe: string; result?: unknown }) {
  const { rows } = await q.query<{ id: string }>(
    `insert into rigo.auto_actions (company_id, rule_key, level, kind, subject_type, subject_id, title, summary, status, dedupe_key, result)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (company_id, dedupe_key) do nothing returning id`,
    [companyId, a.rule, a.level, a.kind, a.subjectType, a.subjectId, a.title.slice(0, 200), (a.summary ?? '').slice(0, 1000), a.status, a.dedupe, JSON.stringify(a.result ?? {})]);
  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------------- messages

export async function prepareMessage(q: Q, cc: CompanyCtx, m: { clientId: string | null; workId?: string | null; invoiceId?: string | null; channel?: 'email' | 'sms'; subject: string; body: string; byRigo?: boolean }) {
  const client = m.clientId ? (await q.query<any>(`select email, phone from rigo.clients where id = $1 and company_id = $2`, [m.clientId, cc.company.id])).rows[0] : null;
  const channel = m.channel ?? (client?.email ? 'email' : 'sms');
  const recipient = channel === 'email' ? client?.email ?? '' : client?.phone ?? '';
  const { rows } = await q.query<{ id: string }>(
    `insert into rigo.outbox_messages (company_id, client_id, work_id, invoice_id, channel, recipient, subject, body, status, detail, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'prepared',$9,$10) returning id`,
    [cc.company.id, m.clientId, m.workId ?? null, m.invoiceId ?? null, channel, recipient, m.subject, m.body,
      recipient ? 'Prepared, not sent.' : `No ${channel === 'email' ? 'email address' : 'phone number'} on file, so it can’t be sent yet.`, m.byRigo ? null : cc.user.id]);
  return { id: rows[0].id, recipient };
}

/** Sends a prepared message through the provider boundary and records honestly what happened. */
export async function sendMessage(q: Q, cc: CompanyCtx, id: string) {
  const msg = (await q.query<any>(`select * from rigo.outbox_messages where id = $1 and company_id = $2 for update`, [id, cc.company.id])).rows[0];
  if (!msg) throw notFound('Message');
  if (['sent', 'simulated'].includes(msg.status)) return { status: msg.status, detail: msg.detail };
  if (!msg.recipient) {
    await q.query(`update rigo.outbox_messages set status = 'blocked', detail = $2, updated_at = now() where id = $1`, [id, `No ${msg.channel === 'email' ? 'email address' : 'phone number'} on file. Add one, or copy the message and send it yourself.`]);
    return { status: 'blocked', detail: 'No address on file.' };
  }
  const r = await deliverMessage(cc.company, { channel: msg.channel, recipient: msg.recipient, subject: msg.subject, body: msg.body }, { q });
  await q.query(`update rigo.outbox_messages set status = $2, detail = $3, provider = $4, updated_at = now() where id = $1`, [id, r.status, r.detail, r.provider]);
  await audit(q, cc, `message.${r.status}`, { id, channel: msg.channel });
  return { status: r.status, detail: r.detail };
}

// ---------------------------------------------------------------- triggers

/** Called after work changes stage. Finished work may get an invoice prepared. */
export async function afterStageChange(q: Q, cc: CompanyCtx, e: { workId: string; number: number; from: { meaning: Meaning }; to: { meaning: Meaning; name: string } }) {
  if (e.to.meaning === 'finished') await invoiceOnFinish(q, cc, e.workId, e.number);
}

async function invoiceOnFinish(q: Q, cc: CompanyCtx, workId: string, number: number) {
  const { co, level } = await levelFor(q, cc.company.id, 'invoice_on_finish');
  if (level === 'off' || level === 'manual') return; // Manual: Money's "Ready to bill" points to it.
  const work = (await q.query<any>(`select w.client_id, w.billing, w.title, c.name as client_name from rigo.work_items w left join rigo.clients c on c.id = w.client_id where w.id = $1`, [workId])).rows[0];
  if (!work?.client_id || work.billing !== 'ready') return;
  const words = wordsOf(cc.company.vocabulary);
  const title = `Invoice for ${work.client_name}: ${words.work.one.toLowerCase()} #${number}`;
  const dedupe = `invoice_on_finish:${workId}`;
  if (co.paused) {
    await recordAction(q, cc.company.id, { rule: 'invoice_on_finish', level, kind: 'invoice', subjectType: 'work', subjectId: workId, title, status: 'paused', dedupe, summary: 'Rigo is paused, so this waits until it is resumed.' });
    return;
  }
  const actionId = await recordAction(q, cc.company.id, { rule: 'invoice_on_finish', level, kind: 'invoice', subjectType: 'invoice', subjectId: null, title, status: 'waiting', dedupe });
  if (!actionId) return; // already prepared once for this work; never twice
  await prepareInvoiceAction(q, cc, actionId, workId, co.invoice_approval, level);
}

async function prepareInvoiceAction(q: Q, cc: CompanyCtx, actionId: string, workId: string, approvalRequired: boolean, level: Level) {
  const { prepareInvoice, issueInvoice } = await import('./billing.js');
  const inv = await prepareInvoice(q, cc, [workId], { by: 'rigo' });
  const total = (await q.query<{ total_minor: number | null; currency: string }>(`select total_minor, currency from rigo.money_invoices where id = $1`, [inv.id])).rows[0];
  const summary = inv.status === 'held' ? `Held: ${inv.holds[0]}` : `Total ${formatMoney(total.total_minor, total.currency)}. Check it and approve.`;
  await q.query(`update rigo.auto_actions set subject_id = $2, summary = $3 where id = $1`, [actionId, inv.id, summary]);
  if (level === 'automatic' && !approvalRequired && inv.status === 'draft') {
    const r = await issueInvoice(q, { ...cc, perms: new Set([...cc.perms]) }, inv.id);
    await q.query(`update rigo.auto_actions set status = 'done', result = $2 where id = $1`, [actionId, JSON.stringify({ issued: r.number })]);
    return;
  }
  await notifyPermission(q, cc.company.id, 'invoices.approve', {
    category: 'needs_action', title: inv.status === 'held' ? 'An invoice Rigo prepared is held' : 'An invoice is ready for your approval', body: summary, link: `money/invoices/${inv.id}`, refType: 'invoice', refId: inv.id,
  });
}

/** Called when work gets a time (created with one, or rescheduled). */
export async function afterScheduled(q: Q, cc: CompanyCtx, workId: string) {
  const w = (await q.query<any>(`select w.id, w.number, w.starts_at, w.client_id, s.meaning, c.name as client_name from rigo.work_items w join rigo.stages s on s.id = w.stage_id
      left join rigo.clients c on c.id = w.client_id where w.id = $1 and w.company_id = $2`, [workId, cc.company.id])).rows[0];
  if (!w?.client_id || !w.starts_at || (w.meaning !== 'open' && w.meaning !== 'active') || new Date(w.starts_at) < new Date()) return;
  const { co, level } = await levelFor(q, cc.company.id, 'booking_confirmation');
  if (level === 'off' || level === 'manual') return;
  const words = wordsOf(cc.company.vocabulary);
  const when = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: cc.company.timezone }).format(new Date(w.starts_at));
  const dedupe = `booking_confirmation:${workId}:${new Date(w.starts_at).toISOString()}`;
  const title = `Confirm ${words.work.one.toLowerCase()} #${w.number} with ${w.client_name}`;
  if (co.paused) {
    await recordAction(q, cc.company.id, { rule: 'booking_confirmation', level, kind: 'message', subjectType: 'work', subjectId: workId, title, status: 'paused', dedupe, summary: 'Rigo is paused, so this waits until it is resumed.' });
    return;
  }
  const actionId = await recordAction(q, cc.company.id, { rule: 'booking_confirmation', level, kind: 'message', subjectType: 'message', subjectId: null, title, status: 'waiting', dedupe });
  if (!actionId) return;
  const msg = await prepareMessage(q, cc, {
    clientId: w.client_id, workId, byRigo: true, subject: `Your ${words.work.one.toLowerCase()} with ${cc.company.name}`,
    body: `Hi ${w.client_name},\n\nThis confirms your ${words.work.one.toLowerCase()} with ${cc.company.name} on ${when}.\n\nReply to this message if you need to change it.\n\n${cc.company.name}`,
  });
  await q.query(`update rigo.auto_actions set subject_id = $2, summary = $3 where id = $1`, [actionId, msg.id, `To ${w.client_name}, for ${when}.`]);
  if (level === 'automatic') {
    const r = await sendMessage(q, cc, msg.id);
    await q.query(`update rigo.auto_actions set status = $2, result = $3 where id = $1`, [actionId, r.status === 'sent' || r.status === 'simulated' ? 'done' : 'failed', JSON.stringify(r)]);
    return;
  }
  await notifyPermission(q, cc.company.id, 'approvals.decide', { category: 'needs_action', title: 'A confirmation is ready to send', body: `To ${w.client_name}, for ${when}.`, link: 'inbox', refType: 'action', refId: actionId });
}

/** Reminders for invoices 7 days overdue. Run by the daily cron and the local worker. */
export async function runDueReminders() {
  const db = await getDb();
  const { rows } = await db.query<{ id: string; company_id: string; owner: string }>(
    `select i.id, i.company_id, (select m.user_id from rigo.memberships m join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
        where m.company_id = i.company_id and m.status = 'active' and r.is_owner order by m.created_at limit 1) as owner
       from rigo.money_invoices i join rigo.companies c on c.id = i.company_id
      where i.status = 'issued' and i.payment_status <> 'paid' and i.due_on <= (now() at time zone c.timezone)::date - 7 and c.archived_at is null limit 500`);
  let n = 0;
  for (const r of rows) {
    if (!r.owner) continue;
    const user = (await db.query<any>(`select id, email, name, theme from rigo.users where id = $1`, [r.owner])).rows[0];
    const cc = await loadCompanyCtx(db, user, r.company_id);
    await db.tx(async (q) => { if (await reminderFor(q, cc, r.id)) n++; });
  }
  return n;
}

async function reminderFor(q: Q, cc: CompanyCtx, invoiceId: string) {
  const { co, level } = await levelFor(q, cc.company.id, 'payment_reminder');
  if (level === 'off' || level === 'manual') return false;
  const inv = (await q.query<any>(`select i.*, c.name as client_name from rigo.money_invoices i left join rigo.clients c on c.id = i.client_id where i.id = $1`, [invoiceId])).rows[0];
  const owed = formatMoney(Number(inv.total_minor) - Number(inv.paid_minor), inv.currency);
  const title = `Remind ${inv.client_name} about ${inv.number}`;
  const dedupe = `payment_reminder:${invoiceId}`;
  if (co.paused) {
    return !!(await recordAction(q, cc.company.id, { rule: 'payment_reminder', level, kind: 'message', subjectType: 'invoice', subjectId: invoiceId, title, status: 'paused', dedupe }));
  }
  const actionId = await recordAction(q, cc.company.id, { rule: 'payment_reminder', level, kind: 'message', subjectType: 'message', subjectId: null, title, status: 'waiting', dedupe });
  if (!actionId) return false;
  const msg = await prepareMessage(q, cc, {
    clientId: inv.client_id, invoiceId, byRigo: true, subject: `Reminder: invoice ${inv.number} from ${cc.company.name}`,
    body: `Hi ${inv.client_name},\n\nA friendly reminder that invoice ${inv.number} was due on ${inv.due_on} and ${owed} is still open.\n\nIf you've already paid, thank you, and please ignore this message.\n\n${cc.company.name}`,
  });
  await q.query(`update rigo.auto_actions set subject_id = $2, summary = $3 where id = $1`, [actionId, msg.id, `${owed} open on ${inv.number}.`]);
  if (level === 'automatic') {
    const r = await sendMessage(q, cc, msg.id);
    await q.query(`update rigo.auto_actions set status = $2, result = $3 where id = $1`, [actionId, r.status === 'sent' || r.status === 'simulated' ? 'done' : 'failed', JSON.stringify(r)]);
  } else {
    await notifyPermission(q, cc.company.id, 'approvals.decide', { category: 'needs_action', title: 'A payment reminder is ready to send', body: `${owed} open on ${inv.number}.`, link: 'inbox', refType: 'action', refId: actionId });
  }
  return true;
}

// ---------------------------------------------------------------- settings

automationRoutes.get('/automation', async (c) => {
  const cc = c.get('cc');
  needAny(cc, 'automation.manage', 'automation.control', 'approvals.decide');
  const levels = await ruleLevels(cc.db, cc.company.id);
  const activity = (await cc.db.query(`select a.id, a.rule_key, a.level, a.kind, a.title, a.summary, a.status, a.created_at, a.decided_at, u.name as decided_by
      from rigo.auto_actions a left join rigo.users u on u.id = a.decided_by where a.company_id = $1 order by a.created_at desc limit 50`, [cc.company.id])).rows;
  const counts = (await cc.db.query<any>(`select count(*) filter (where status = 'waiting')::int as waiting, count(*) filter (where status = 'paused')::int as paused from rigo.auto_actions where company_id = $1`, [cc.company.id])).rows[0];
  return c.json({
    mode: cc.company.automation_mode, paused: cc.company.paused, pausedAt: cc.company.paused_at,
    rules: RULES.map((r) => ({ ...r, level: levels[r.key], effective: effectiveLevel(cc.company.automation_mode, levels[r.key]) })),
    activity, waiting: counts.waiting, held: counts.paused, capabilities: capabilities(cc.company),
  });
});

automationRoutes.patch('/automation', async (c) => {
  const cc = c.get('cc');
  const input = await body(c, z.object({ mode: z.enum(['manual', 'assisted', 'automatic']).optional(), paused: z.boolean().optional(), held: z.enum(['run', 'cancel']).optional() }));
  if (input.mode) need(cc, 'automation.manage');
  if (input.paused !== undefined) need(cc, 'automation.control');
  const r = await cc.db.tx(async (q) => {
    let ran = 0, cancelled = 0;
    if (input.mode) {
      await q.query(`update rigo.companies set automation_mode = $2, settings = jsonb_set(settings, '{setup}', coalesce(settings->'setup','{}'::jsonb) || '{"automationChosen": true}'::jsonb) where id = $1`, [cc.company.id, input.mode]);
      await audit(q, cc, 'automation.mode_changed', { mode: input.mode });
    }
    if (input.paused === true) {
      await q.query(`update rigo.companies set paused = true, paused_at = now(), paused_by = $2 where id = $1`, [cc.company.id, cc.user.id]);
      await audit(q, cc, 'automation.paused', {});
    }
    if (input.paused === false) {
      await q.query(`update rigo.companies set paused = false, paused_at = null, paused_by = null where id = $1`, [cc.company.id]);
      const held = (await q.query<any>(`select * from rigo.auto_actions where company_id = $1 and status = 'paused' order by created_at`, [cc.company.id])).rows;
      const fresh: CompanyCtx = { ...cc, company: { ...cc.company, paused: false } };
      for (const a of held) {
        if (input.held === 'cancel') {
          await q.query(`update rigo.auto_actions set status = 'cancelled', decided_by = $2, decided_at = now(), result = '{"reason":"Cancelled when Rigo was resumed"}' where id = $1`, [a.id, cc.user.id]);
          cancelled++;
          continue;
        }
        // Run it now, at today's levels: the held record is replaced by the real one.
        await q.query(`delete from rigo.auto_actions where id = $1`, [a.id]);
        if (a.rule_key === 'invoice_on_finish') {
          const w = (await q.query<{ number: number }>(`select number from rigo.work_items where id = $1`, [a.subject_id])).rows[0];
          if (w) await invoiceOnFinish(q, fresh, a.subject_id, w.number);
        } else if (a.rule_key === 'booking_confirmation') await afterScheduled(q, fresh, a.subject_id);
        else if (a.rule_key === 'payment_reminder') await reminderFor(q, fresh, a.subject_id);
        ran++;
      }
      await audit(q, cc, 'automation.resumed', { ran, cancelled });
    }
    return { ran, cancelled };
  });
  return c.json({ ok: true, ...r });
});

automationRoutes.put('/automation/rules/:key', async (c) => {
  const cc = c.get('cc');
  need(cc, 'automation.manage');
  const rule = ruleByKey(c.req.param('key'));
  if (!rule) throw notFound('Automation');
  const input = await body(c, z.object({ level: z.enum(['off', 'manual', 'assisted', 'automatic']), confirmMoney: z.boolean().default(false) }));
  if (rule.money && input.level === 'automatic') {
    if (!cc.isOwner) throw forbidden('Only an owner can let Rigo act on money by itself.');
    if (!input.confirmMoney) throw conflict('This lets Rigo issue invoices without a person. Confirm that you want this.', { needsConfirm: 'money' });
  }
  await cc.db.tx(async (q) => {
    await q.query(`insert into rigo.auto_rules (company_id, key, level, updated_by) values ($1,$2,$3,$4)
                   on conflict (company_id, key) do update set level = excluded.level, updated_by = excluded.updated_by, updated_at = now()`, [cc.company.id, rule.key, input.level, cc.user.id]);
    await audit(q, cc, 'automation.rule_changed', { key: rule.key, level: input.level });
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- the approvals inbox

/** Who may decide an action: invoices by invoice approvers, messages by approvers. */
function mayDecide(cc: CompanyCtx, kind: string) {
  return kind === 'invoice' ? can(cc, 'invoices.approve') && can(cc, 'money.view') : can(cc, 'approvals.decide');
}

automationRoutes.get('/inbox', async (c) => {
  const cc = c.get('cc');
  const kinds = ['invoice', 'message'].filter((k) => mayDecide(cc, k));
  const approvals = kinds.length ? (await cc.db.query<any>(
    `select a.id, a.rule_key, a.level, a.kind, a.subject_type, a.subject_id, a.title, a.summary, a.status, a.created_at,
            m.body as message_body, m.recipient as message_recipient, m.channel as message_channel, i.status as invoice_status, i.total_minor, i.currency, i.version as invoice_version, i.hold_reasons
       from rigo.auto_actions a left join rigo.outbox_messages m on a.kind = 'message' and m.id = a.subject_id left join rigo.money_invoices i on a.kind = 'invoice' and i.id = a.subject_id
      where a.company_id = $1 and a.status = 'waiting' and a.kind = any($2) order by a.created_at`, [cc.company.id, kinds])).rows
    .map((a) => ({ ...a, message_recipient: can(cc, 'customers.contact') ? a.message_recipient : undefined })) : [];
  const requests = can(cc, 'requests.manage')
    ? (await cc.db.query(`select id, name, ${can(cc, 'customers.contact') ? 'email, phone,' : ''} address, message, wanted, preferred_at, created_at from rigo.requests where company_id = $1 and status = 'new' order by created_at`, [cc.company.id])).rows
    : [];
  const held = can(cc, 'invoices.manage') && can(cc, 'money.view')
    ? (await cc.db.query(`select i.id, i.hold_reasons, i.created_at, c.name as client_name from rigo.money_invoices i left join rigo.clients c on c.id = i.client_id where i.company_id = $1 and i.status = 'held' order by i.created_at`, [cc.company.id])).rows
    : [];
  const notifications = (await cc.db.query(`select id, category, title, body, link, read_at, created_at from rigo.notifications where company_id = $1 and user_id = $2 and resolved_at is null order by created_at desc limit 50`, [cc.company.id, cc.user.id])).rows;
  return c.json({ approvals, requests, held, notifications, paused: cc.company.paused });
});

async function getAction(q: Q, cc: CompanyCtx, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Item');
  const a = (await q.query<any>(`select * from rigo.auto_actions where id = $1 and company_id = $2 for update`, [id, cc.company.id])).rows[0];
  if (!a) throw notFound('Item');
  if (!mayDecide(cc, a.kind)) throw forbidden(`Your role (${cc.roleName}) can't decide this.`);
  if (a.status !== 'waiting') throw conflict('Someone already dealt with this.');
  return a;
}

automationRoutes.post('/inbox/:id/approve', async (c) => {
  const cc = c.get('cc');
  const input = await body(c, z.object({ invoiceVersion: z.number().int().optional() }));
  const r = await cc.db.tx(async (q) => {
    const a = await getAction(q, cc, c.req.param('id'));
    if (cc.company.paused) throw conflict('Rigo is paused. Resume it first, or take this over and do it yourself.');
    if (a.kind === 'invoice') {
      const inv = (await q.query<any>(`select status, version from rigo.money_invoices where id = $1 and company_id = $2 for update`, [a.subject_id, cc.company.id])).rows[0];
      if (!inv) throw conflict('That invoice no longer exists.');
      if (inv.status === 'held') throw conflict('This invoice is held. Fix it in Money first.');
      if (input.invoiceVersion !== undefined && inv.version !== input.invoiceVersion) throw conflict('This invoice changed since you looked at it. Check the new amounts first.', { stale: true });
      if (inv.status === 'draft') {
        await q.query(`update rigo.money_invoices set status = 'approved', approved_by = $2, approved_at = now(), version = version + 1 where id = $1`, [a.subject_id, cc.user.id]);
        await audit(q, cc, 'invoice.approved', { id: a.subject_id, via: 'inbox' });
      }
      let result: any = { approved: true };
      if (a.level === 'automatic') {
        const { issueInvoice } = await import('./billing.js');
        result = { ...result, issued: (await issueInvoice(q, cc, a.subject_id)).number };
      }
      await q.query(`update rigo.auto_actions set status = $2, decided_by = $3, decided_at = now(), result = $4 where id = $1`, [a.id, a.level === 'automatic' ? 'done' : 'approved', cc.user.id, JSON.stringify(result)]);
      await resolveNotices(q, cc.company.id, 'invoice', a.subject_id);
      return result;
    }
    const sent = await sendMessage(q, cc, a.subject_id);
    await q.query(`update rigo.auto_actions set status = $2, decided_by = $3, decided_at = now(), result = $4 where id = $1`,
      [a.id, sent.status === 'sent' || sent.status === 'simulated' ? 'done' : 'failed', cc.user.id, JSON.stringify(sent)]);
    await resolveNotices(q, cc.company.id, 'action', a.id);
    await audit(q, cc, 'approval.approved', { id: a.id, rule: a.rule_key });
    return sent;
  });
  return c.json(r);
});

automationRoutes.post('/inbox/:id/reject', async (c) => {
  const cc = c.get('cc');
  const input = await body(c, z.object({ reason: z.string().trim().max(300).default('') }));
  await cc.db.tx(async (q) => {
    const a = await getAction(q, cc, c.req.param('id'));
    if (a.kind === 'invoice' && a.subject_id) {
      // The prepared invoice goes away and the work is ready to bill again, by a person.
      const inv = (await q.query<any>(`select status from rigo.money_invoices where id = $1`, [a.subject_id])).rows[0];
      if (inv && inv.status !== 'issued') {
        const work = (await q.query<{ work_id: string }>(`delete from rigo.money_invoice_work where invoice_id = $1 returning work_id`, [a.subject_id])).rows;
        for (const w of work) await q.query(`update rigo.work_items set billing = 'ready', version = version + 1 where id = $1`, [w.work_id]);
        await q.query(`delete from rigo.money_invoices where id = $1`, [a.subject_id]);
      }
      await resolveNotices(q, cc.company.id, 'invoice', a.subject_id);
    } else if (a.subject_id) {
      await q.query(`update rigo.outbox_messages set status = 'cancelled', detail = 'Rejected in the inbox; not sent.' where id = $1 and company_id = $2 and status = 'prepared'`, [a.subject_id, cc.company.id]);
    }
    await q.query(`update rigo.auto_actions set status = 'rejected', decided_by = $2, decided_at = now(), result = $3 where id = $1`, [a.id, cc.user.id, JSON.stringify({ reason: input.reason })]);
    await resolveNotices(q, cc.company.id, 'action', a.id);
    await audit(q, cc, 'approval.rejected', { id: a.id, rule: a.rule_key, reason: input.reason });
  });
  return c.json({ ok: true });
});

/** A person takes the item over: Rigo stops on it, and what it prepared stays for the person to finish. */
automationRoutes.post('/inbox/:id/take-over', async (c) => {
  const cc = c.get('cc');
  needAny(cc, 'automation.control', 'approvals.decide', 'invoices.approve');
  await cc.db.tx(async (q) => {
    const a = await getAction(q, cc, c.req.param('id'));
    await q.query(`update rigo.auto_actions set status = 'taken_over', decided_by = $2, decided_at = now() where id = $1`, [a.id, cc.user.id]);
    await resolveNotices(q, cc.company.id, 'action', a.id);
    await audit(q, cc, 'approval.taken_over', { id: a.id, rule: a.rule_key });
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- messages by hand

automationRoutes.get('/messages', async (c) => {
  const cc = c.get('cc');
  needAny(cc, 'approvals.decide', 'customers.contact');
  const contact = can(cc, 'customers.contact');
  const { rows } = await cc.db.query<any>(`select m.id, m.channel, m.recipient, m.subject, m.body, m.status, m.detail, m.created_at, m.updated_at, m.work_id, m.invoice_id, c.name as client_name, m.client_id
      from rigo.outbox_messages m left join rigo.clients c on c.id = m.client_id where m.company_id = $1 order by m.created_at desc limit 100`, [cc.company.id]);
  // Messages about money stay with people who see money.
  return c.json({ messages: rows.filter((m) => !m.invoice_id || can(cc, 'money.view')).map((m) => ({ ...m, recipient: contact ? m.recipient : undefined })) });
});

automationRoutes.post('/messages', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.contact');
  const input = await body(c, z.object({
    clientId: z.string().uuid('Choose a customer'), channel: z.enum(['email', 'sms']), subject: z.string().trim().max(200).default(''),
    body: z.string().trim().min(1, 'Write the message').max(4000), workId: z.string().uuid().nullable().optional(), send: z.boolean().default(false),
  }));
  const r = await cc.db.tx(async (q) => {
    const client = (await q.query(`select 1 from rigo.clients where id = $1 and company_id = $2`, [input.clientId, cc.company.id])).rows[0];
    if (!client) throw badRequest('Choose a customer from this workspace.');
    if (input.workId && !(await q.query(`select 1 from rigo.work_items where id = $1 and company_id = $2`, [input.workId, cc.company.id])).rows[0]) throw badRequest('Choose work from this workspace.');
    const m = await prepareMessage(q, cc, { clientId: input.clientId, workId: input.workId ?? null, channel: input.channel, subject: input.subject, body: input.body });
    if (!input.send) return { id: m.id, status: 'prepared' };
    return { id: m.id, ...(await sendMessage(q, cc, m.id)) };
  });
  return c.json(r);
});

automationRoutes.post('/messages/:id/send', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.contact');
  need(cc, 'approvals.decide');
  if (!/^[0-9a-f-]{36}$/i.test(c.req.param('id'))) throw notFound('Message');
  const r = await cc.db.tx((q) => sendMessage(q, cc, c.req.param('id')));
  return c.json(r);
});

export { addDays, localDate };
