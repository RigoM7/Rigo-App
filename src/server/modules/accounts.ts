import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb, type Q } from '../db/index.js';
import { type AppEnv, requireUser, SESSION_COOKIE, audit } from '../http/context.js';
import { body, normEmail, sha256, token } from '../lib/util.js';
import { HttpError, badRequest, conflict } from '../http/errors.js';
import { config } from '../config.js';
import { sendSystemEmail } from '../adapters/index.js';

export const accounts = new Hono<AppEnv>();

const email = z.string().trim().max(254).email('Enter a valid email address');
const password = z.string().min(10, 'Use at least 10 characters').max(200, 'Use at most 200 characters');

async function rateLimit(q: Q, key: string, max: number, minutes = 15) {
  const { rows } = await q.query<{ n: number }>(`select count(*)::int as n from rigo.auth_attempts where key = $1 and at > now() - ($2 || ' minutes')::interval`, [key, String(minutes)]);
  if (rows[0].n >= max) throw new HttpError(429, 'rate_limited', 'Too many attempts. Wait a few minutes and try again.');
  await q.query(`insert into rigo.auth_attempts (key) values ($1)`, [key]);
}

export async function createSession(q: Q, userId: string) {
  const tok = token();
  await q.query(`insert into rigo.sessions (id, user_id, expires_at) values ($1, $2, now() + interval '${config.sessionDays} days')`, [sha256(tok), userId]);
  return tok;
}

function setSessionCookie(c: any, tok: string) {
  setCookie(c, SESSION_COOKIE, tok, { httpOnly: true, sameSite: 'Lax', secure: config.isProd, path: '/', maxAge: config.sessionDays * 86400 });
}

let dummyHash: string | undefined;
const ip = (c: any) => (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || 'local';

accounts.post('/signup', async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1, 'Enter your name').max(80), email, password }));
  const db = await getDb();
  await rateLimit(db, `signup:${ip(c)}`, 20, 60);
  const hash = await bcrypt.hash(input.password, 12);
  const tok = await db.tx(async (q) => {
    const exists = await q.query(`select 1 from rigo.users where lower(email) = $1`, [normEmail(input.email)]);
    if (exists.rows.length) throw conflict('An account with this email already exists. Sign in instead.', { fields: { email: 'An account with this email already exists' } });
    const { rows } = await q.query<{ id: string }>(`insert into rigo.users (email, name, password_hash) values ($1, $2, $3) returning id`, [normEmail(input.email), input.name, hash]);
    await audit(q, null, 'account.created', { userId: rows[0].id });
    return createSession(q, rows[0].id);
  });
  setSessionCookie(c, tok);
  return c.json({ ok: true });
});

accounts.post('/signin', async (c) => {
  const input = await body(c, z.object({ email, password: z.string().min(1, 'Enter your password').max(200) }));
  const db = await getDb();
  await rateLimit(db, `signin:${normEmail(input.email)}`, 10);
  const { rows } = await db.query<{ id: string; password_hash: string }>(`select id, password_hash from rigo.users where lower(email) = $1`, [normEmail(input.email)]);
  // Compare against a dummy hash when the user does not exist so timing does not reveal accounts.
  dummyHash ??= await bcrypt.hash('rigo-timing-equalizer', 12);
  const ok = await bcrypt.compare(input.password, rows[0]?.password_hash ?? dummyHash).catch(() => false);
  if (!rows[0] || !ok) throw new HttpError(401, 'invalid_credentials', 'That email and password do not match an account.');
  const tok = await createSession(db, rows[0].id);
  setSessionCookie(c, tok);
  return c.json({ ok: true });
});

accounts.post('/signout', async (c) => {
  const sid = c.get('sessionId');
  if (sid) await (await getDb()).query(`delete from rigo.sessions where id = $1`, [sid]);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

accounts.post('/forgot', async (c) => {
  const input = await body(c, z.object({ email }));
  const db = await getDb();
  await rateLimit(db, `forgot:${ip(c)}`, 10);
  const { rows } = await db.query<{ id: string }>(`select id from rigo.users where lower(email) = $1`, [normEmail(input.email)]);
  let channel: 'mailbox' | 'unavailable' = config.devMailbox ? 'mailbox' : 'unavailable';
  if (rows[0] && config.devMailbox) {
    const tok = token();
    await db.query(`insert into rigo.password_resets (token_hash, user_id, expires_at) values ($1, $2, now() + interval '1 hour')`, [sha256(tok), rows[0].id]);
    const link = `${config.appUrl}/reset/${tok}`;
    await sendSystemEmail(db, { to: normEmail(input.email), subject: 'Reset your Rigo password', body: `Use this link within one hour to choose a new password:\n${link}\n\nIf you did not ask for this, ignore this email.`, link, kind: 'password_reset' });
  }
  // Same answer whether or not the account exists.
  return c.json({ ok: true, channel });
});

accounts.post('/reset', async (c) => {
  const input = await body(c, z.object({ token: z.string().min(10).max(200), password }));
  const db = await getDb();
  const hash = await bcrypt.hash(input.password, 12);
  await db.tx(async (q) => {
    const { rows } = await q.query<{ user_id: string }>(
      `update rigo.password_resets set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning user_id`, [sha256(input.token)]);
    if (!rows[0]) throw badRequest('This reset link is invalid, expired or already used. Request a new one.');
    await q.query(`update rigo.users set password_hash = $1 where id = $2`, [hash, rows[0].user_id]);
    await q.query(`delete from rigo.sessions where user_id = $1`, [rows[0].user_id]);
  });
  return c.json({ ok: true });
});

accounts.get('/me', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ user: null });
  const db = await getDb();
  const companies = await db.query(
    `select c.id, c.name, c.kind, c.branding, m.role_key, r.name as role_name, r.is_owner,
            (c.settings->'setup'->>'completedAt') as setup_completed_at
       from rigo.memberships m join rigo.companies c on c.id = m.company_id
       join rigo.roles r on r.company_id = c.id and r.key = m.role_key
      where m.user_id = $1 and m.status = 'active' order by c.kind desc, c.name`, [user.id]);
  const invitations = await db.query(
    `select i.id, i.role_key, r.name as role_name, c.name as company_name, i.expires_at
       from rigo.invitations i join rigo.companies c on c.id = i.company_id join rigo.roles r on r.company_id = i.company_id and r.key = i.role_key
      where lower(i.email) = $1 and i.status = 'pending' and i.expires_at > now() order by i.created_at desc`, [normEmail(user.email)]);
  return c.json({ user, companies: companies.rows, invitations: invitations.rows, devMailbox: config.devMailbox });
});

accounts.patch('/me', async (c) => {
  const user = requireUser(c);
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(80).optional(), theme: z.enum(['light', 'dark', 'system']).optional() }));
  const db = await getDb();
  if (input.name) await db.query(`update rigo.users set name = $1 where id = $2`, [input.name, user.id]);
  if (input.theme) await db.query(`update rigo.users set theme = $1 where id = $2`, [input.theme, user.id]);
  return c.json({ ok: true });
});

accounts.post('/me/password', async (c) => {
  const user = requireUser(c);
  const input = await body(c, z.object({ current: z.string().min(1).max(200), password }));
  const db = await getDb();
  const { rows } = await db.query<{ password_hash: string }>(`select password_hash from rigo.users where id = $1`, [user.id]);
  if (!(await bcrypt.compare(input.current, rows[0].password_hash))) throw badRequest('Your current password is not correct.', { fields: { current: 'Current password is not correct' } });
  await db.query(`update rigo.users set password_hash = $1 where id = $2`, [await bcrypt.hash(input.password, 12), user.id]);
  await db.query(`delete from rigo.sessions where user_id = $1 and id <> $2`, [user.id, c.get('sessionId')]);
  return c.json({ ok: true });
});

/** Local development only: the simulated mailbox that stands in for real email delivery. */
accounts.get('/dev/mailbox', async (c) => {
  if (!config.devMailbox) return c.json({ enabled: false, messages: [] });
  const { rows } = await (await getDb()).query(`select * from rigo.dev_mailbox order by created_at desc limit 50`);
  return c.json({ enabled: true, messages: rows });
});
