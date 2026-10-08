import { Hono } from 'hono';
import { z } from 'zod';
import type { Q } from '../db/index.js';
import type { AppEnv } from '../http/context.js';
import { body } from '../lib/util.js';

// Notifications: what each person is told inside Rigo (the inbox's updates). Never an email or text.

export const notifyRoutes = new Hono<AppEnv>();

export interface NoticeInput { category: 'needs_action' | 'warning' | 'update'; title: string; body?: string; link?: string; refType?: string; refId?: string; dedupeKey?: string }

export async function notifyUsers(q: Q, companyId: string, userIds: string[], n: NoticeInput) {
  for (const uid of [...new Set(userIds)]) {
    await q.query(
      `insert into rigo.notifications (company_id, user_id, category, title, body, link, ref_type, ref_id, dedupe_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing`,
      [companyId, uid, n.category, n.title.slice(0, 200), (n.body ?? '').slice(0, 1000), n.link ?? null, n.refType ?? null, n.refId ?? null, n.dedupeKey ?? null]);
  }
}

/** Everyone whose role has this permission (owners always). In a demo, the visitor too. */
export async function notifyPermission(q: Q, companyId: string, perm: string, n: NoticeInput) {
  const { rows } = await q.query<{ user_id: string }>(
    `select m.user_id from rigo.memberships m join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
      where m.company_id = $1 and m.status = 'active' and not m.is_fictional and (r.is_owner or $2 = any(r.permissions))
     union select c.demo_user_id from rigo.companies c where c.id = $1 and c.kind = 'demo'`, [companyId, perm]);
  await notifyUsers(q, companyId, rows.map((r) => r.user_id).filter(Boolean), n);
}

/** Every owner of the workspace. */
export async function notifyOwners(q: Q, companyId: string, n: NoticeInput, except: string[] = []) {
  const { rows } = await q.query<{ user_id: string }>(
    `select m.user_id from rigo.memberships m join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
      where m.company_id = $1 and m.status = 'active' and not m.is_fictional and r.is_owner
     union select c.demo_user_id from rigo.companies c where c.id = $1 and c.kind = 'demo'`, [companyId]);
  await notifyUsers(q, companyId, rows.map((r) => r.user_id).filter((u) => u && !except.includes(u)), n);
}

/** Marks notices about a record as dealt with (for example once an approval is decided). */
export async function resolveNotices(q: Q, companyId: string, refType: string, refId: string) {
  await q.query(`update rigo.notifications set resolved_at = now() where company_id = $1 and ref_type = $2 and ref_id = $3 and resolved_at is null`, [companyId, refType, refId]);
}

export async function unreadCount(q: Q, companyId: string, userId: string) {
  const { rows } = await q.query<{ n: number }>(`select count(*)::int as n from rigo.notifications where company_id = $1 and user_id = $2 and read_at is null`, [companyId, userId]);
  return rows[0].n;
}

notifyRoutes.get('/notifications', async (c) => {
  const cc = c.get('cc');
  const { rows } = await cc.db.query(
    `select id, category, title, body, link, ref_type, ref_id, read_at, resolved_at, created_at from rigo.notifications
      where company_id = $1 and user_id = $2 order by created_at desc limit 100`, [cc.company.id, cc.user.id]);
  return c.json({ notifications: rows, unread: rows.filter((r: any) => !r.read_at).length });
});

notifyRoutes.post('/notifications/read', async (c) => {
  const cc = c.get('cc');
  const input = await body(c, z.object({ ids: z.array(z.string().uuid()).max(200).optional(), all: z.boolean().optional() }));
  if (input.all) await cc.db.query(`update rigo.notifications set read_at = now() where company_id = $1 and user_id = $2 and read_at is null`, [cc.company.id, cc.user.id]);
  else if (input.ids?.length) await cc.db.query(`update rigo.notifications set read_at = now() where company_id = $1 and user_id = $2 and id = any($3) and read_at is null`, [cc.company.id, cc.user.id, input.ids]);
  return c.json({ ok: true });
});
