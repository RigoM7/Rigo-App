import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Db, Q } from '../db/index.js';
import { getDb } from '../db/index.js';
import { sha256 } from '../lib/util.js';
import { forbidden, notFound, unauthorized } from './errors.js';
import type { Permission } from '../../shared/permissions.js';
import { ALL_PERMISSIONS } from '../../shared/permissions.js';

export interface User { id: string; email: string; name: string; theme: string }

export interface Company {
  id: string; name: string; kind: 'real' | 'demo'; timezone: string; currency: string;
  automation_mode: 'manual' | 'assisted' | 'automatic'; paused: boolean; settings: any; branding: any;
  demo_user_id: string | null; service_categories: string[]; phone: string | null; email: string | null; address: string | null;
  paused_at: string | null; config_version: number;
}

/** Everything the server knows about who is acting, in which company, with which permissions. */
export interface CompanyCtx {
  db: Db;
  user: User;
  company: Company;
  roleKey: string;
  roleName: string;
  isOwner: boolean;
  isDemo: boolean;
  perms: Set<Permission>;
  /** The user id whose assignments define "my jobs". In the demo's simulated driver view, a fictional driver. */
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
       where s.id = $1 and s.expires_at > now()`, [id]);
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
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) throw notFound('Company');
  const { rows } = await db.query<Company & { role_key: string; role_name: string; is_owner: boolean; permissions: string[] }>(
    `select c.*, m.role_key, r.name as role_name, r.is_owner, r.permissions
       from rigo.companies c
       join rigo.memberships m on m.company_id = c.id and m.user_id = $2 and m.status = 'active'
       join rigo.roles r on r.company_id = c.id and r.key = m.role_key
      where c.id = $1`, [companyId, user.id]);
  const row = rows[0];
  // Non-members get the same answer as for a company that does not exist.
  if (!row) throw notFound('Company');
  const { role_key, role_name, is_owner, permissions, ...company } = row;
  const isDemo = company.kind === 'demo';
  let perms = new Set((is_owner ? ALL_PERMISSIONS : permissions) as Permission[]);
  let roleKey = role_key, roleName = role_name, actingUserId = user.id, simulatedRole: string | null = null;
  if (isDemo && company.settings?.demo?.simRole && company.settings.demo.simRole !== 'owner') {
    // Simulated role switching exists only inside a person's own demo workspace.
    const sim = company.settings.demo.simRole as string;
    const r = await db.query<{ name: string; permissions: string[] }>(`select name, permissions from rigo.roles where company_id = $1 and key = $2`, [company.id, sim]);
    if (r.rows[0]) {
      perms = new Set(r.rows[0].permissions as Permission[]);
      roleKey = sim; roleName = r.rows[0].name; simulatedRole = sim;
      if (sim === 'driver' && company.settings.demo.driverUserId) actingUserId = company.settings.demo.driverUserId;
    }
  }
  return { db, user, company, roleKey, roleName, isOwner: simulatedRole ? false : is_owner, isDemo, perms, actingUserId, simulatedRole };
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
