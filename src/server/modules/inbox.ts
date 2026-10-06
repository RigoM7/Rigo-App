import { Hono } from 'hono';
import { z } from 'zod';
import type { Q } from '../db/index.js';
import { type AppEnv, type CompanyCtx, can } from '../http/context.js';
import { body } from '../lib/util.js';
import { approvalsToDecide } from './approvals.js';

export const inboxRoutes = new Hono<AppEnv>();

export interface NoticeInput { category: 'needs_action' | 'warning' | 'update'; title: string; body?: string; link?: string; refType?: string; refId?: string; dedupeKey?: string }

export async function notifyUsers(q: Q, companyId: string, userIds: string[], n: NoticeInput) {
  const unique = [...new Set(userIds)];
  for (const uid of unique) {
    await q.query(
      `insert into rigo.notifications (company_id, user_id, category, title, body, link, ref_type, ref_id, dedupe_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing`,
      [companyId, uid, n.category, n.title.slice(0, 200), (n.body ?? '').slice(0, 1000), n.link ?? null, n.refType ?? null, n.refId ?? null, n.dedupeKey ?? null]);
  }
}

/** Notify everyone holding any of the roles. In a demo, the visitor (who simulates every role) also sees it. */
export async function notifyRoles(q: Q, companyId: string, roles: string[], n: NoticeInput) {
  const { rows } = await q.query<{ user_id: string }>(
    `select m.user_id from rigo.memberships m where m.company_id = $1 and m.status = 'active' and not m.is_fictional and m.role_key = any($2)
     union select c.demo_user_id from rigo.companies c where c.id = $1 and c.kind = 'demo'`, [companyId, roles]);
  await notifyUsers(q, companyId, rows.map((r) => r.user_id).filter(Boolean), n);
}

export async function notifyPermission(q: Q, companyId: string, perm: string, n: NoticeInput) {
  const { rows } = await q.query<{ user_id: string }>(
    `select m.user_id from rigo.memberships m join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
      where m.company_id = $1 and m.status = 'active' and not m.is_fictional and (r.is_owner or $2 = any(r.permissions))
     union select c.demo_user_id from rigo.companies c where c.id = $1 and c.kind = 'demo'`, [companyId, perm]);
  await notifyUsers(q, companyId, rows.map((r) => r.user_id).filter(Boolean), n);
}

/** Resolve outstanding notices about a record (e.g. once an approval is decided). */
export async function resolveNotices(q: Q, companyId: string, refType: string, refId: string) {
  await q.query(`update rigo.notifications set resolved_at = now() where company_id = $1 and ref_type = $2 and ref_id = $3 and resolved_at is null`, [companyId, refType, refId]);
}

/**
 * Inbox counts. "Needs action" counts the same things the Needs action tab shows: open action notices
 * (other than approval notices) plus the approvals this person, in their current role, may decide.
 */
export async function attentionCounts(cc: CompanyCtx) {
  const { rows } = await cc.db.query<any>(
    `select
       count(*) filter (where category = 'needs_action' and resolved_at is null and ref_type is distinct from 'approval')::int as needs_action,
       count(*) filter (where category = 'warning' and resolved_at is null)::int as warnings,
       count(*) filter (where read_at is null)::int as unread
     from rigo.notifications where company_id = $1 and user_id = $2`, [cc.company.id, cc.user.id]);
  return { ...rows[0], needs_action: rows[0].needs_action + (await approvalsToDecide(cc)) };
}

inboxRoutes.get('/notifications', async (c) => {
  const cc = c.get('cc');
  const category = c.req.query('category');
  const state = c.req.query('state') ?? 'open';
  const vals: unknown[] = [cc.company.id, cc.user.id];
  let where = 'company_id = $1 and user_id = $2';
  if (category && ['needs_action', 'warning', 'update'].includes(category)) { vals.push(category); where += ` and category = $${vals.length}`; }
  if (state === 'open') where += ` and (resolved_at is null and (category <> 'update' or read_at is null))`;
  const { rows } = await cc.db.query(`select * from rigo.notifications where ${where} order by created_at desc limit 100`, vals);
  return c.json({ notifications: rows, counts: await attentionCounts(cc) });
});

inboxRoutes.post('/notifications/read', async (c) => {
  const cc = c.get('cc');
  const input = await body(c, z.object({ ids: z.array(z.string().uuid()).max(200).optional(), all: z.boolean().optional() }));
  if (input.all) await cc.db.query(`update rigo.notifications set read_at = now() where company_id = $1 and user_id = $2 and read_at is null`, [cc.company.id, cc.user.id]);
  else if (input.ids?.length) await cc.db.query(`update rigo.notifications set read_at = now() where company_id = $1 and user_id = $2 and id = any($3)`, [cc.company.id, cc.user.id, input.ids]);
  return c.json({ ok: true, counts: await attentionCounts(cc) });
});

inboxRoutes.post('/notifications/:id/resolve', async (c) => {
  const cc = c.get('cc');
  // Only informational items can be dismissed by hand; approvals resolve when decided.
  await cc.db.query(`update rigo.notifications set resolved_at = now(), read_at = coalesce(read_at, now()) where id = $1 and company_id = $2 and user_id = $3 and (ref_type is null or ref_type not in ('approval','action'))`, [c.req.param('id'), cc.company.id, cc.user.id]);
  return c.json({ ok: true, counts: await attentionCounts(cc) });
});

export { can };
