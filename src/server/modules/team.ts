import { Hono } from 'hono';
import { z } from 'zod';
import { getDb, type Q } from '../db/index.js';
import { type AppEnv, type CompanyCtx, need, audit, requireUser, can } from '../http/context.js';
import { body, normEmail, sha256, token } from '../lib/util.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { config } from '../config.js';
import { sendSystemEmail } from '../adapters/index.js';
import { ALL_PERMISSIONS } from '../../shared/permissions.js';
import { notifyRoles, notifyUsers } from './inbox.js';

export const teamRoutes = new Hono<AppEnv>();
export const invitationPublic = new Hono<AppEnv>();

const INVITE_DAYS = 7;

async function roleIsOwner(q: Q, companyId: string, key: string) {
  const { rows } = await q.query<{ is_owner: boolean }>(`select is_owner from rigo.roles where company_id = $1 and key = $2`, [companyId, key]);
  if (!rows[0]) throw badRequest('That role does not exist.', { fields: { role: 'Choose a role' } });
  return rows[0].is_owner;
}

async function activeOwnerCount(q: Q, companyId: string) {
  const { rows } = await q.query<{ n: number }>(
    `select count(*)::int n from rigo.memberships m join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
      where m.company_id = $1 and m.status = 'active' and r.is_owner and not m.is_fictional`, [companyId]);
  return rows[0].n;
}

/** Ends a membership. Open work assigned to the person returns to the unassigned queue, with history. */
export async function removeMember(q: Q, companyId: string, m: { id: string; user_id: string }, actorId: string, reason = 'Assignee was removed from the company') {
  await q.query(`update rigo.memberships set status = 'removed', updated_at = now() where id = $1`, [m.id]);
  const jobs = await q.query<{ id: string }>(`update rigo.jobs set assigned_user_id = null, version = version + 1, updated_at = now() where company_id = $1 and assigned_user_id = $2 and status in ('draft','open','in_progress') returning id`, [companyId, m.user_id]);
  for (const j of jobs.rows) {
    await q.query(`insert into rigo.job_events (company_id, job_id, type, actor_user_id, data) values ($1,$2,'unassigned',$3,$4)`, [companyId, j.id, actorId, JSON.stringify({ reason })]);
  }
  if (jobs.rows.length) await notifyRoles(q, companyId, ['dispatcher', 'owner'], { category: 'warning', title: `${jobs.rows.length} job(s) need a new driver`, body: 'A member was removed and their open jobs were unassigned.', link: 'jobs?assignee=none' });
  return jobs.rows.length;
}

teamRoutes.get('/members', async (c) => {
  const cc = c.get('cc');
  need(cc, 'members.view');
  const members = await cc.db.query(
    `select m.id, m.user_id, coalesce(m.display_name, u.name) as name, ${can(cc, 'customers.contact') || can(cc, 'members.manage') ? 'u.email' : 'null as email'},
            m.role_key, r.name as role_name, r.is_owner, m.is_fictional, m.created_at,
            (select count(*)::int from rigo.jobs j where j.company_id = m.company_id and j.assigned_user_id = m.user_id and j.status in ('open','in_progress')) as open_jobs
       from rigo.memberships m join rigo.users u on u.id = m.user_id join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
      where m.company_id = $1 and m.status = 'active' order by r.is_owner desc, name`, [cc.company.id]);
  const invitations = can(cc, 'members.invite')
    ? (await cc.db.query(
      `select i.id, i.email, i.role_key, r.name as role_name, i.created_at, i.expires_at, i.accepted_at,
              case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end as status
         from rigo.invitations i join rigo.roles r on r.company_id = i.company_id and r.key = i.role_key
        where i.company_id = $1 and i.status in ('pending','accepted','revoked') order by i.created_at desc limit 100`, [cc.company.id])).rows
    : [];
  return c.json({ members: members.rows, invitations });
});

teamRoutes.patch('/members/:mid', async (c) => {
  const cc = c.get('cc');
  need(cc, 'members.manage');
  const input = await body(c, z.object({ role: z.string().max(40) }));
  await cc.db.tx(async (q) => {
    const { rows } = await q.query<any>(`select m.*, r.is_owner from rigo.memberships m join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key where m.id = $1 and m.company_id = $2 and m.status = 'active' for update of m`, [c.req.param('mid'), cc.company.id]);
    const m = rows[0];
    if (!m) throw notFound('Member');
    const toOwner = await roleIsOwner(q, cc.company.id, input.role);
    if ((m.is_owner || toOwner) && !cc.isOwner) throw forbidden('Only owners can grant or change the Owner role.');
    if (m.is_owner && !toOwner && (await activeOwnerCount(q, cc.company.id)) <= 1) {
      throw conflict('A company must keep at least one active owner. Add another owner first.');
    }
    await q.query(`update rigo.memberships set role_key = $2, updated_at = now() where id = $1`, [m.id, input.role]);
    await audit(q, cc, 'member.role_changed', { memberId: m.id, from: m.role_key, to: input.role });
  });
  return c.json({ ok: true });
});

teamRoutes.delete('/members/:mid', async (c) => {
  const cc = c.get('cc');
  need(cc, 'members.manage');
  await cc.db.tx(async (q) => {
    const { rows } = await q.query<any>(`select m.*, r.is_owner from rigo.memberships m join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key where m.id = $1 and m.company_id = $2 and m.status = 'active' for update of m`, [c.req.param('mid'), cc.company.id]);
    const m = rows[0];
    if (!m) throw notFound('Member');
    if (m.is_owner && !cc.isOwner) throw forbidden('Only owners can remove an owner.');
    if (m.is_owner && (await activeOwnerCount(q, cc.company.id)) <= 1) throw conflict('You cannot remove the last active owner. Add another owner first.');
    const unassigned = await removeMember(q, cc.company.id, m, cc.user.id);
    await audit(q, cc, 'member.removed', { memberId: m.id, unassignedJobs: unassigned });
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- owner-created password reset links
// Recovery without email: an owner (or anyone allowed to manage members) creates a single-use link
// and gives it to the person, for example by text message.
const RESET_LINK_HOURS = 24;

teamRoutes.post('/members/:mid/reset-link', async (c) => {
  const cc = c.get('cc');
  need(cc, 'members.manage');
  const result = await cc.db.tx(async (q) => {
    const { rows } = await q.query<{ id: string; user_id: string; name: string; is_owner: boolean; is_fictional: boolean }>(
      `select m.id, m.user_id, coalesce(m.display_name, u.name) as name, r.is_owner, m.is_fictional
         from rigo.memberships m join rigo.users u on u.id = m.user_id join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
        where m.id = $1 and m.company_id = $2 and m.status = 'active' and u.deleted_at is null`, [c.req.param('mid'), cc.company.id]);
    const m = rows[0];
    if (!m) throw notFound('Member');
    if (m.user_id === cc.user.id) throw badRequest('To change your own password, use Account.');
    if (m.is_owner && !cc.isOwner) throw forbidden('Only owners can create a reset link for another owner.');
    const first = m.name.split(' ')[0];
    if (cc.isDemo || m.is_fictional) {
      // The demo stays fictional: no real link is created and nothing leaves Rigo.
      return { simulated: true, name: m.name, link: `${config.appUrl}/reset/demo-example-link-not-real`, expiresInHours: RESET_LINK_HOURS };
    }
    // Someone who also works for another company could lose access to it if this company's owners
    // could set their password, so only they (or email recovery) can reset it.
    const elsewhere = await q.query(
      `select 1 from rigo.memberships m join rigo.companies co on co.id = m.company_id
        where m.user_id = $1 and m.company_id <> $2 and m.status = 'active' and co.kind = 'real' limit 1`, [m.user_id, cc.company.id]);
    if (elsewhere.rows.length) {
      throw conflict(`${first} also belongs to another company in Rigo, so for their security only they can reset their password. They can use "Forgot your password?" on the sign-in page.`);
    }
    const tok = token();
    // A new link replaces any earlier unused link from an owner.
    await q.query(`update rigo.password_resets set expires_at = now() where user_id = $1 and used_at is null and company_id is not null and expires_at > now()`, [m.user_id]);
    await q.query(`insert into rigo.password_resets (token_hash, user_id, expires_at, issued_by, company_id) values ($1, $2, now() + interval '${RESET_LINK_HOURS} hours', $3, $4)`,
      [sha256(tok), m.user_id, cc.user.id, cc.company.id]);
    await audit(q, cc, 'member.reset_link_created', { memberId: m.id, userId: m.user_id });
    const owners = await q.query<{ user_id: string }>(
      `select m.user_id from rigo.memberships m join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
        where m.company_id = $1 and m.status = 'active' and r.is_owner and not m.is_fictional and m.user_id <> $2 and m.user_id <> $3`, [cc.company.id, cc.user.id, m.user_id]);
    await notifyUsers(q, cc.company.id, owners.rows.map((o) => o.user_id), {
      category: 'update', title: `${cc.user.name} created a password reset link for ${m.name}`,
      body: `The link works once and expires in ${RESET_LINK_HOURS} hours. Using it signs ${first} out everywhere else.`, link: 'team',
    });
    return { simulated: false, name: m.name, link: `${config.appUrl}/reset/${tok}`, expiresInHours: RESET_LINK_HOURS };
  });
  return c.json(result);
});

// ---------------------------------------------------------------- roles
teamRoutes.get('/roles', async (c) => {
  const cc = c.get('cc');
  need(cc, 'members.view');
  const { rows } = await cc.db.query(`select key, name, description, permissions, is_owner,
      (select count(*)::int from rigo.memberships m where m.company_id = r.company_id and m.role_key = r.key and m.status = 'active') as members
      from rigo.roles r where company_id = $1 order by is_owner desc, name`, [cc.company.id]);
  return c.json({ roles: rows.map((r: any) => (r.is_owner ? { ...r, permissions: ALL_PERMISSIONS } : r)) });
});

teamRoutes.patch('/roles/:key', async (c) => {
  const cc = c.get('cc');
  need(cc, 'roles.manage');
  if (!cc.isOwner) throw forbidden('Only owners can change role permissions.');
  const input = await body(c, z.object({ permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).max(60), description: z.string().max(300).optional() }));
  const { rows } = await cc.db.query<{ is_owner: boolean }>(`select is_owner from rigo.roles where company_id = $1 and key = $2`, [cc.company.id, c.req.param('key')]);
  if (!rows[0]) throw notFound('Role');
  if (rows[0].is_owner) throw badRequest('The Owner role always has every permission.');
  await cc.db.query(`update rigo.roles set permissions = $3, description = coalesce($4, description) where company_id = $1 and key = $2`, [cc.company.id, c.req.param('key'), input.permissions, input.description ?? null]);
  await audit(cc.db, cc, 'role.updated', { key: c.req.param('key'), permissions: input.permissions });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- invitations
function inviteMail(companyName: string, roleName: string, link: string) {
  return {
    subject: `You're invited to join ${companyName} on Rigo`,
    body: `${companyName} invited you to join their Rigo workspace as ${roleName}.\n\nOpen this link to accept. It expires in ${INVITE_DAYS} days and works once:\n${link}\n\nSign in or create an account with this email address.`,
  };
}

async function createInvitation(q: Q, cc: CompanyCtx, email: string, role: string) {
  const tok = token();
  const { rows } = await q.query<{ id: string }>(
    `insert into rigo.invitations (company_id, email, role_key, token_hash, expires_at, invited_by) values ($1,$2,$3,$4, now() + interval '${INVITE_DAYS} days', $5) returning id`,
    [cc.company.id, email, role, sha256(tok), cc.user.id]);
  const link = `${config.appUrl}/invite/${tok}`;
  const roleName = (await q.query<{ name: string }>(`select name from rigo.roles where company_id = $1 and key = $2`, [cc.company.id, role])).rows[0].name;
  const mail = inviteMail(cc.company.name, roleName, link);
  // Demo invitations never reach a mailbox; they are previewed only.
  const delivery = cc.isDemo ? { simulated: true, detail: 'Demo workspace: invitation email is previewed only.' } : await sendSystemEmail(q, { to: email, ...mail, link, kind: 'invitation' });
  return { id: rows[0].id, link, preview: { to: email, ...mail }, delivery };
}

teamRoutes.post('/invitations', async (c) => {
  const cc = c.get('cc');
  need(cc, 'members.invite');
  const input = await body(c, z.object({ email: z.string().trim().max(254).email('Enter a valid email address'), role: z.string().max(40) }));
  const email = normEmail(input.email);
  const result = await cc.db.tx(async (q) => {
    if ((await roleIsOwner(q, cc.company.id, input.role)) && !cc.isOwner) throw forbidden('Only owners can invite another owner.');
    const member = await q.query(`select 1 from rigo.memberships m join rigo.users u on u.id = m.user_id where m.company_id = $1 and lower(u.email) = $2 and m.status = 'active'`, [cc.company.id, email]);
    if (member.rows.length) throw conflict('This person is already a member of this company.', { fields: { email: 'Already a member' } });
    const recent = await q.query<{ n: number }>(`select count(*)::int n from rigo.invitations where company_id = $1 and created_at > now() - interval '1 hour'`, [cc.company.id]);
    if (recent.rows[0].n >= 30) throw badRequest('Too many invitations in the last hour. Try again later.');
    // A newer invitation replaces any pending one for the same email.
    await q.query(`update rigo.invitations set status = 'replaced' where company_id = $1 and lower(email) = $2 and status = 'pending'`, [cc.company.id, email]);
    const inv = await createInvitation(q, cc, email, input.role);
    await audit(q, cc, 'invitation.created', { email, role: input.role });
    return inv;
  });
  return c.json(result);
});

teamRoutes.post('/invitations/:id/resend', async (c) => {
  const cc = c.get('cc');
  need(cc, 'members.invite');
  const result = await cc.db.tx(async (q) => {
    const { rows } = await q.query<any>(`select * from rigo.invitations where id = $1 and company_id = $2 for update`, [c.req.param('id'), cc.company.id]);
    const inv = rows[0];
    if (!inv) throw notFound('Invitation');
    if (inv.status === 'accepted') throw conflict('This invitation was already accepted.');
    if ((await roleIsOwner(q, cc.company.id, inv.role_key)) && !cc.isOwner) throw forbidden('Only owners can invite another owner.');
    await q.query(`update rigo.invitations set status = 'replaced' where id = $1 and status = 'pending'`, [inv.id]);
    const fresh = await createInvitation(q, cc, inv.email, inv.role_key);
    await audit(q, cc, 'invitation.replaced', { old: inv.id, new: fresh.id });
    return fresh;
  });
  return c.json(result);
});

teamRoutes.post('/invitations/:id/revoke', async (c) => {
  const cc = c.get('cc');
  need(cc, 'members.invite');
  const { rows } = await cc.db.query(`update rigo.invitations set status = 'revoked' where id = $1 and company_id = $2 and status = 'pending' returning id`, [c.req.param('id'), cc.company.id]);
  if (!rows.length) throw conflict('Only pending invitations can be revoked.');
  await audit(cc.db, cc, 'invitation.revoked', { id: c.req.param('id') });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- approval delegation
teamRoutes.get('/delegations', async (c) => {
  const cc = c.get('cc');
  const { rows } = await cc.db.query(
    `select d.id, d.from_user_id, fu.name as from_name, d.to_user_id, tu.name as to_name, d.starts_at, d.ends_at
       from rigo.approval_delegations d join rigo.users fu on fu.id = d.from_user_id join rigo.users tu on tu.id = d.to_user_id
      where d.company_id = $1 and (d.ends_at is null or d.ends_at > now()) order by d.created_at desc`, [cc.company.id]);
  return c.json({ delegations: rows });
});

teamRoutes.post('/delegations', async (c) => {
  const cc = c.get('cc');
  need(cc, 'approvals.decide');
  const input = await body(c, z.object({ toUserId: z.string().uuid(), endsAt: z.string().datetime().nullable() }));
  if (input.toUserId === cc.user.id) throw badRequest('Choose someone else.');
  const m = await cc.db.query(`select 1 from rigo.memberships m join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
      where m.company_id = $1 and m.user_id = $2 and m.status = 'active' and (r.is_owner or 'approvals.decide' = any(r.permissions))`, [cc.company.id, input.toUserId]);
  if (!m.rows.length) throw badRequest('That person cannot act as an approver in this company.', { fields: { toUserId: 'Not an eligible approver' } });
  await cc.db.query(`insert into rigo.approval_delegations (company_id, from_user_id, to_user_id, ends_at) values ($1,$2,$3,$4)`, [cc.company.id, cc.user.id, input.toUserId, input.endsAt]);
  await audit(cc.db, cc, 'approval.delegated', input);
  return c.json({ ok: true });
});

teamRoutes.delete('/delegations/:id', async (c) => {
  const cc = c.get('cc');
  const { rows } = await cc.db.query(`update rigo.approval_delegations set ends_at = now() where id = $1 and company_id = $2 and (from_user_id = $3 or $4) returning id`, [c.req.param('id'), cc.company.id, cc.user.id, cc.isOwner]);
  if (!rows.length) throw notFound('Delegation');
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- accepting (no company context yet)
function maskEmail(e: string) {
  const [u, d] = e.split('@');
  return `${u.slice(0, 1)}${'•'.repeat(Math.max(1, Math.min(6, u.length - 1)))}@${d}`;
}

invitationPublic.get('/invitations/:token', async (c) => {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `select i.*, c.name as company_name, r.name as role_name from rigo.invitations i join rigo.companies c on c.id = i.company_id
       join rigo.roles r on r.company_id = i.company_id and r.key = i.role_key where i.token_hash = $1`, [sha256(c.req.param('token'))]);
  const inv = rows[0];
  if (!inv) return c.json({ state: 'invalid' });
  const user = c.get('user');
  const state = inv.status === 'pending' && new Date(inv.expires_at) <= new Date() ? 'expired' : inv.status;
  return c.json({
    state, companyName: inv.company_name, roleName: inv.role_name, emailHint: maskEmail(inv.email), expiresAt: inv.expires_at,
    signedIn: !!user, emailMatches: user ? normEmail(user.email) === normEmail(inv.email) : null, companyId: state === 'accepted' && user && inv.accepted_by === user.id ? inv.company_id : null,
  });
});

export async function acceptInvitation(q: Q, user: { id: string; email: string }, where: { tokenHash?: string; id?: string }) {
  const { rows } = await q.query<any>(`select * from rigo.invitations where ${where.tokenHash ? 'token_hash = $1' : 'id = $1'} for update`, [where.tokenHash ?? where.id]);
  const inv = rows[0];
  if (!inv) throw notFound('Invitation');
  if (normEmail(inv.email) !== normEmail(user.email)) {
    throw forbidden(`This invitation is for ${maskEmail(inv.email)}. Sign in with that email address to accept it.`);
  }
  if (inv.status === 'accepted') {
    if (inv.accepted_by === user.id) return { companyId: inv.company_id, already: true };
    throw conflict('This invitation has already been used.');
  }
  if (inv.status !== 'pending') throw conflict(inv.status === 'revoked' ? 'This invitation was revoked. Ask the company for a new one.' : 'This invitation was replaced by a newer one. Use the latest link you received.');
  if (new Date(inv.expires_at) <= new Date()) throw conflict('This invitation has expired. Ask the company to send a new one.');
  // Single use: the conditional update is the guard against concurrent acceptance.
  const upd = await q.query(`update rigo.invitations set status = 'accepted', accepted_by = $2, accepted_at = now() where id = $1 and status = 'pending' returning id`, [inv.id, user.id]);
  if (!upd.rows.length) throw conflict('This invitation has already been used.');
  const existing = await q.query<any>(`select id, status from rigo.memberships where company_id = $1 and user_id = $2`, [inv.company_id, user.id]);
  if (existing.rows[0]?.status === 'active') return { companyId: inv.company_id, already: true };
  if (existing.rows[0]) await q.query(`update rigo.memberships set status = 'active', role_key = $2, updated_at = now() where id = $1`, [existing.rows[0].id, inv.role_key]);
  else await q.query(`insert into rigo.memberships (company_id, user_id, role_key) values ($1,$2,$3)`, [inv.company_id, user.id, inv.role_key]);
  await audit(q, { company: { id: inv.company_id }, user }, 'invitation.accepted', { invitationId: inv.id, role: inv.role_key });
  await notifyRoles(q, inv.company_id, ['owner'], { category: 'update', title: `${user.email} joined the company`, body: `They accepted an invitation as ${inv.role_key}.`, link: 'team' });
  return { companyId: inv.company_id, already: false };
}

invitationPublic.post('/invitations/:token/accept', async (c) => {
  const user = requireUser(c);
  const db = await getDb();
  const r = await db.tx((q) => acceptInvitation(q, user, { tokenHash: sha256(c.req.param('token')) }));
  return c.json(r);
});

invitationPublic.post('/me/invitations/:id/accept', async (c) => {
  const user = requireUser(c);
  const db = await getDb();
  const r = await db.tx((q) => acceptInvitation(q, user, { id: c.req.param('id') }));
  return c.json(r);
});
