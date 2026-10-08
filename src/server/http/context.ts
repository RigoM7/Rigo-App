import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Db, Q } from '../db/index.js';
import { getDb } from '../db/index.js';
import { sha256 } from '../lib/util.js';
import { HttpError, forbidden, notFound, unauthorized } from './errors.js';
import type { Permission, RoleApp } from '../../shared/permissions.js';
import { ALL_PERMISSIONS } from '../../shared/permissions.js';
import { effectivePermissions } from '../../shared/workspace.js';

export interface User { id: string; email: string; name: string; theme: string }

export interface Company {
  id: string; name: string; kind: 'real' | 'demo'; timezone: string; currency: string;
  automation_mode: 'manual' | 'assisted' | 'automatic'; paused: boolean; settings: any;
  demo_user_id: string | null; phone: string | null; email: string | null; address: string | null;
  paused_at: string | null; config_version: number; vocabulary: unknown; template_key: string | null; description: string;
  archived_at: string | null;
}

/** Everything the server knows about who is acting, in which company, with which permissions. */
export interface CompanyCtx {
  db: Db;
  user: User;
  company: Company;
  roleKey: string;
  roleName: string;
  /** Which screens the role opens: the office places or the worker's phone screens. */
  roleApp: RoleApp;
  isOwner: boolean;
  isDemo: boolean;
  perms: Set<Permission>;
  /** The user id whose assignments define "my work". In a demo's simulated worker view, a fictional worker. */
  actingUserId: string;
  simulatedRole: string | null;
}

export type AppEnv = { Variables: { user: User | null; sessionId: string | null; cc: CompanyCtx } };

export const SESSION_COOKIE = 'rigo_session';

export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const tok = getCookie(c, SESSION_COOKIE);
  c.set('user', null);
  c.set('sessionId', null);
  if (tok) {
    const db = await getDb();
    const id = sha256(tok);
    const { rows } = await db.query<User & { last_seen_at: string }>(
      `select u.id, u.email, u.name, u.theme, s.last_seen_at from rigo.sessions s join rigo.users u on u.id = s.user_id
       where s.id = $1 and s.expires_at > now() and u.deleted_at is null`, [id]);
    if (rows[0]) {
      const { last_seen_at, ...user } = rows[0];
      c.set('user', user);
      c.set('sessionId', id);
      if (Date.now() - new Date(last_seen_at).getTime() > 3600_000) {
        await db.query(`update rigo.sessions set last_seen_at = now(), expires_at = now() + interval '30 days' where id = $1`, [id]);
      }
    }
  }
  await next();
};

export function requireUser(c: Context<AppEnv>): User {
  const u = c.get('user');
  if (!u) throw unauthorized();
  return u;
}

export async function loadCompanyCtx(db: Db, user: User, companyId: string): Promise<CompanyCtx> {
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) throw notFound('Workspace');
  const { rows } = await db.query<Company & { role_key: string; role_name: string; role_app: RoleApp; is_owner: boolean; permissions: string[] }>(
    `select c.*, m.role_key, r.name as role_name, r.app as role_app, r.is_owner, r.permissions
       from rigo.companies c
       join rigo.memberships m on m.company_id = c.id and m.user_id = $2 and m.status = 'active'
       join rigo.roles r on r.company_id = c.id and r.key = m.role_key
      where c.id = $1`, [companyId, user.id]);
  const row = rows[0];
  if (!row) {
    // Someone removed from this workspace is told so (only they can see it), so their phone can clear
    // the workspace's data (R12-M1). Everyone else gets the
    // same answer as for a company that does not exist.
    const gone = (await db.query<{ until: string }>(`select (removed_at + interval '7 days') as until from rigo.memberships where company_id = $1 and user_id = $2 and status = 'removed' and removed_at > now() - interval '7 days'`, [companyId, user.id])).rows[0];
    if (gone) throw new HttpError(403, 'not_member', 'You are no longer a member of this workspace.', { lateRecordsUntil: gone.until });
    throw notFound('Workspace');
  }
  const { role_key, role_name, role_app, is_owner, permissions, ...company } = row;
  const isDemo = company.kind === 'demo';
  let perms = new Set(is_owner ? ALL_PERMISSIONS : effectivePermissions(role_app, permissions as Permission[]));
  let roleKey = role_key, roleName = role_name, roleApp: RoleApp = is_owner ? 'office' : role_app, actingUserId = user.id, simulatedRole: string | null = null;
  if (isDemo && company.settings?.demo?.simRole && company.settings.demo.simRole !== 'owner') {
    // Simulated role switching exists only inside a person's own demo workspace.
    const sim = company.settings.demo.simRole as string;
    const r = await db.query<{ name: string; app: RoleApp; permissions: string[] }>(`select name, app, permissions from rigo.roles where company_id = $1 and key = $2 and not is_owner`, [company.id, sim]);
    if (r.rows[0]) {
      perms = new Set(effectivePermissions(r.rows[0].app, r.rows[0].permissions as Permission[]));
      roleKey = sim; roleName = r.rows[0].name; roleApp = r.rows[0].app; simulatedRole = sim;
      if (r.rows[0].app === 'worker' && company.settings.demo.workerUserId) actingUserId = company.settings.demo.workerUserId;
    }
  }
  return { db, user, company, roleKey, roleName, roleApp, isOwner: simulatedRole ? false : is_owner, isDemo, perms, actingUserId, simulatedRole };
}

export const companyScope: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = requireUser(c);
  const db = await getDb();
  c.set('cc', await loadCompanyCtx(db, user, c.req.param('cid') as string));
  await next();
};

export function can(cc: CompanyCtx, p: Permission) { return cc.perms.has(p); }
export function need(cc: CompanyCtx, ...ps: Permission[]) {
  for (const p of ps) if (!cc.perms.has(p)) throw forbidden(`Your role (${cc.roleName}) does not allow this: ${p}.`);
}
export function needAny(cc: CompanyCtx, ...ps: Permission[]) {
  if (!ps.some((p) => cc.perms.has(p))) throw forbidden(`Your role (${cc.roleName}) does not allow this.`);
}

export async function audit(q: Q, cc: { company: { id: string }; user: { id: string } } | null, action: string, detail: unknown = {}) {
  await q.query(`insert into rigo.audit_log (company_id, actor_user_id, action, detail) values ($1, $2, $3, $4)`,
    [cc?.company.id ?? null, cc?.user.id ?? null, action, JSON.stringify(detail)]);
}

/**
 * Inviting staff and emailing customers need a confirmed email address once email can actually be
 * sent (D2). Until then nobody could confirm one, so nothing is blocked. Demo companies never send.
 */
export async function needConfirmedEmail(cc: CompanyCtx, what: string) {
  if (cc.isDemo) return;
  const { systemEmailChannel } = await import('../adapters/index.js');
  if (systemEmailChannel() !== 'email') return;
  const { rows } = await cc.db.query<{ v: boolean }>(`select email_verified_at is not null as v from rigo.users where id = $1`, [cc.user.id]);
  if (!rows[0]?.v) throw new HttpError(403, 'email_unconfirmed', `Confirm your email address before ${what}. Use the link we sent you, or send a new one from Account.`, { needsConfirmedEmail: true });
}
