import { Hono, type Context } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb, type Db, type Q } from '../db/index.js';
import { type AppEnv, type User, requireUser, SESSION_COOKIE, audit } from '../http/context.js';
import { body, normEmail, sha256, token } from '../lib/util.js';
import { HttpError, badRequest, conflict } from '../http/errors.js';
import { config } from '../config.js';
import { sendSystemEmail, systemEmailChannel } from '../adapters/index.js';
import { checkPassword, PASSWORD_MAX, PASSWORD_MIN } from '../../shared/password.js';
import { EMAIL_MAX } from '../../shared/email.js';
import { COMMON_PASSWORDS } from '../lib/common-passwords.js';
import { removeMember, ownerResetBlocked } from './team.js';
import { notifyRoles } from './inbox.js';

export const accounts = new Hono<AppEnv>();

const NAME_MAX = 80;
const email = z.string().trim().max(EMAIL_MAX, `Use ${EMAIL_MAX} characters or fewer.`).email('Enter a valid email address.');
const password = z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`).max(PASSWORD_MAX, `Use ${PASSWORD_MAX} characters or fewer.`);
const name = z.string().trim().min(1, 'Enter your name.').max(NAME_MAX, `Use ${NAME_MAX} characters or fewer.`);

/** Applies the shared password rule with the server's common-password list. */
function requireStrongPassword(pw: string, who: { email?: string; name?: string }, field = 'password') {
  const problem = checkPassword(pw, who, (s) => COMMON_PASSWORDS.has(s));
  if (problem) throw badRequest('Choose a different password.', { fields: { [field]: problem } });
}

// ---------------------------------------------------------------- client address and limits

/** The client's address. X-Forwarded-For is trusted only behind a proxy that overwrites it (Vercel). */
export function clientIp(c: Context<AppEnv>): string {
  if (config.trustProxy) {
    const xff = c.req.header('x-forwarded-for');
    if (xff) return xff.split(',')[0].trim();
  }
  return (c.env as any)?.incoming?.socket?.remoteAddress || 'local';
}

const minutesText = (sec: number) => { const m = Math.max(1, Math.ceil(sec / 60)); return `${m} minute${m === 1 ? '' : 's'}`; };
const tooMany = (message: string, retryAfter: number) => new HttpError(429, 'rate_limited', message, { retryAfter });

/** Attempts recorded under a key in the window, and seconds until the oldest one leaves it. */
async function attempts(q: Q, key: string, minutes: number) {
  const { rows } = await q.query<{ n: number; wait: number | null }>(
    `select count(*)::int as n, ceil(extract(epoch from (min(at) + ($2 || ' minutes')::interval - now())))::int as wait
       from rigo.auth_attempts where key = $1 and at > now() - ($2 || ' minutes')::interval`, [key, String(minutes)]);
  return { n: rows[0].n, wait: Math.max(1, rows[0].wait ?? 1) };
}

/** A limit that counts every call (account creation, recovery emails). */
async function limitCalls(q: Q, key: string, max: number, minutes: number, what: string) {
  const a = await attempts(q, key, minutes);
  if (a.n >= max) throw tooMany(`Too many ${what} from this device. Try again in ${minutesText(a.wait)}.`, a.wait);
}
const recordCall = (q: Q, key: string) => q.query(`insert into rigo.auth_attempts (key) values ($1)`, [key]);

// Sign-in: only failures count, keyed by email + address so nobody can lock an owner out from
// elsewhere, plus a wider per-address limit against trying one password on many accounts.
export const SIGNIN_WINDOW_MIN = 15;
export const SIGNIN_MAX_FAILURES = 10;
export const SIGNIN_MAX_PER_IP = 100;
const failKey = (em: string, ip: string) => `signin:${em}|${ip}`;
const ipKey = (ip: string) => `signin-ip:${ip}`;

const signinLocked = (wait: number, network = false) =>
  tooMany(`Too many sign-in attempts from this ${network ? 'network' : 'device'}. Try again in ${minutesText(wait)}, or reset your password.`, wait);

/** Clears an email's failed sign-ins (after a successful sign-in, a reset or a password change). */
export async function clearSigninFailures(q: Q, em: string) {
  const prefix = `signin:${normEmail(em)}|`;
  await q.query(`delete from rigo.auth_attempts where left(key, length($1)) = $1`, [prefix]);
}

/** Removes attempt records older than a day. Run by the cron tick and the local worker. */
export async function cleanupAuth(q?: Q) {
  const db = q ?? (await getDb());
  await db.query(`delete from rigo.auth_attempts where at < now() - interval '1 day'`);
}

// ---------------------------------------------------------------- sessions

export async function createSession(q: Q, userId: string) {
  const tok = token();
  await q.query(`insert into rigo.sessions (id, user_id, expires_at) values ($1, $2, now() + interval '${config.sessionDays} days')`, [sha256(tok), userId]);
  return tok;
}

function setSessionCookie(c: any, tok: string) {
  setCookie(c, SESSION_COOKIE, tok, { httpOnly: true, sameSite: 'Lax', secure: config.isProd, path: '/', maxAge: config.sessionDays * 86400 });
}

const auditAccount = (q: Q, userId: string, action: string, detail: unknown = {}) =>
  q.query(`insert into rigo.audit_log (company_id, actor_user_id, action, detail) values (null, $1, $2, $3)`, [userId, action, JSON.stringify(detail)]);

/** Everything the web app needs about the signed-in person (same shape as GET /auth/me). */
export async function mePayload(db: Db | Q, user: User | null) {
  if (!user) return { user: null };
  const extra = await db.query<{ email_verified_at: string | null }>(`select email_verified_at from rigo.users where id = $1`, [user.id]);
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
  return {
    user: { ...user, emailVerified: !!extra.rows[0]?.email_verified_at },
    companies: companies.rows, invitations: invitations.rows,
    devMailbox: config.devMailbox, emailChannel: systemEmailChannel(),
  };
}

async function userById(q: Q, id: string) {
  const { rows } = await q.query<User>(`select id, email, name, theme from rigo.users where id = $1 and deleted_at is null`, [id]);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- email links

const EMAIL_TOKEN_HOURS = { verify: 24 * 7, change: 24 } as const;

async function createEmailToken(q: Q, userId: string, purpose: 'verify' | 'change', address: string) {
  const tok = token();
  // A new link replaces older unused links for the same purpose.
  await q.query(`update rigo.email_tokens set expires_at = now() where user_id = $1 and purpose = $2 and used_at is null and expires_at > now()`, [userId, purpose]);
  await q.query(`insert into rigo.email_tokens (token_hash, user_id, purpose, email, expires_at) values ($1,$2,$3,$4, now() + ($5 || ' hours')::interval)`,
    [sha256(tok), userId, purpose, normEmail(address), String(EMAIL_TOKEN_HOURS[purpose])]);
  return `${config.appUrl}/confirm-email/${tok}`;
}

async function sendVerifyEmail(q: Q, user: { id: string; email: string; name: string }) {
  const link = await createEmailToken(q, user.id, 'verify', user.email);
  await sendSystemEmail(q, {
    to: user.email, kind: 'email_verify', link, subject: 'Confirm your email for Rigo',
    body: `Hi ${user.name},\n\nConfirm that this is your email address so you can recover your account if you forget your password:\n${link}\n\nThe link works once and expires in 7 days. If you didn't create a Rigo account, ignore this email.`,
  });
}

// ---------------------------------------------------------------- public endpoints

/** How a forgotten password can be recovered here, so the page can say it before anyone types. */
accounts.get('/recovery', (c) => {
  const channel = systemEmailChannel();
  const methods = [...(channel === 'email' ? ['email'] : channel === 'mailbox' ? ['mailbox'] : []), 'owner_link'];
  return c.json({ methods, supportEmail: config.supportEmail });
});

/** Terms of service and privacy policy, when the owner has published them. */
accounts.get('/legal', (c) => c.json({ termsUrl: config.termsUrl, privacyUrl: config.privacyUrl }));

accounts.post('/signup', async (c) => {
  const input = await body(c, z.object({ name, email, password }));
  const em = normEmail(input.email);
  requireStrongPassword(input.password, { email: em, name: input.name });
  const db = await getDb();
  const ip = clientIp(c);
  // Only accounts actually created count toward the per-device limit.
  // Production allows 20 new accounts per address per hour; local copies (tests, demos) allow more.
  await limitCalls(db, `signup:${ip}`, config.isProd ? 20 : 500, 60, 'new accounts');
  const hash = await bcrypt.hash(input.password, 12);
  const { tok, user } = await db.tx(async (q) => {
    const exists = await q.query(`select 1 from rigo.users where lower(email) = $1`, [em]);
    if (exists.rows.length) throw conflict('An account with this email already exists. Sign in instead.', { fields: { email: 'An account with this email already exists. Sign in instead, or reset your password.' } });
    const { rows } = await q.query<User>(`insert into rigo.users (email, name, password_hash) values ($1, $2, $3) returning id, email, name, theme`, [em, input.name, hash]);
    await recordCall(q, `signup:${ip}`);
    await auditAccount(q, rows[0].id, 'account.created');
    if (systemEmailChannel() !== 'none') await sendVerifyEmail(q, rows[0]);
    return { tok: await createSession(q, rows[0].id), user: rows[0] };
  });
  setSessionCookie(c, tok);
  return c.json(await mePayload(db, user));
});

let dummyHash: string | undefined;

accounts.post('/signin', async (c) => {
  const input = await body(c, z.object({ email, password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX, `Use ${PASSWORD_MAX} characters or fewer.`) }));
  const em = normEmail(input.email);
  const ip = clientIp(c);
  const db = await getDb();
  const mine = await attempts(db, failKey(em, ip), SIGNIN_WINDOW_MIN);
  if (mine.n >= SIGNIN_MAX_FAILURES) throw signinLocked(mine.wait);
  const net = await attempts(db, ipKey(ip), SIGNIN_WINDOW_MIN);
  if (net.n >= SIGNIN_MAX_PER_IP) throw signinLocked(net.wait, true);

  const { rows } = await db.query<User & { password_hash: string }>(
    `select id, email, name, theme, password_hash from rigo.users where lower(email) = $1 and deleted_at is null`, [em]);
  // Compare against a dummy hash when the user does not exist so timing does not reveal accounts.
  dummyHash ??= await bcrypt.hash('rigo-timing-equalizer', 12);
  const ok = await bcrypt.compare(input.password, rows[0]?.password_hash ?? dummyHash).catch(() => false);
  if (!rows[0] || !ok) {
    await recordCall(db, failKey(em, ip));
    await recordCall(db, ipKey(ip));
    const after = await attempts(db, failKey(em, ip), SIGNIN_WINDOW_MIN);
    if (after.n >= SIGNIN_MAX_FAILURES) throw signinLocked(after.wait);
    const remaining = SIGNIN_MAX_FAILURES - after.n;
    throw new HttpError(401, 'invalid_credentials', 'That email and password do not match an account.',
      remaining <= 3 ? { remaining, pauseMinutes: SIGNIN_WINDOW_MIN } : null);
  }
  const { password_hash, ...user } = rows[0];
  await clearSigninFailures(db, em);
  const tok = await createSession(db, user.id);
  setSessionCookie(c, tok);
  return c.json(await mePayload(db, user));
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
  const ip = clientIp(c);
  await limitCalls(db, `forgot:${ip}`, 10, 15, 'reset requests');
  await recordCall(db, `forgot:${ip}`);
  const channel = systemEmailChannel();
  if (channel === 'none') return c.json({ ok: true, channel: 'unavailable' });
  const { rows } = await db.query<{ id: string }>(`select id from rigo.users where lower(email) = $1 and deleted_at is null`, [normEmail(input.email)]);
  if (rows[0]) {
    const tok = token();
    await db.query(`insert into rigo.password_resets (token_hash, user_id, expires_at) values ($1, $2, now() + interval '1 hour')`, [sha256(tok), rows[0].id]);
    const link = `${config.appUrl}/reset/${tok}`;
    await sendSystemEmail(db, { to: normEmail(input.email), subject: 'Reset your Rigo password', body: `Use this link within one hour to choose a new password:\n${link}\n\nIf you did not ask for this, ignore this email.`, link, kind: 'password_reset' });
  }
  // Same answer whether or not the account exists.
  return c.json({ ok: true, channel });
});

/** A usable reset link. Links an owner created are re-checked now, since roles and memberships may have changed. */
async function findReset(q: Q, tok: string) {
  const { rows } = await q.query<{ user_id: string; company_id: string | null; issued_by: string | null; email: string; name: string }>(
    `select r.user_id, r.company_id, r.issued_by, u.email, u.name from rigo.password_resets r join rigo.users u on u.id = r.user_id
      where r.token_hash = $1 and r.used_at is null and r.expires_at > now() and u.deleted_at is null`, [sha256(tok)]);
  const r = rows[0];
  if (!r) return null;
  if (r.company_id && (!r.issued_by || (await ownerResetBlocked(q, { userId: r.user_id, companyId: r.company_id, issuerId: r.issued_by })))) return null;
  return r;
}

async function findResetRow(q: Q, userId: string, companyId: string | null, issuedBy: string | null) {
  if (!companyId) return true;
  return !!issuedBy && !(await ownerResetBlocked(q, { userId, companyId, issuerId: issuedBy }));
}

/** Whether a reset link still works. Never reveals whose it is. */
accounts.get('/reset/:token', async (c) => {
  const tok = c.req.param('token');
  const valid = tok.length >= 10 && tok.length <= 200 && !!(await findReset(await getDb(), tok));
  return c.json({ valid });
});

accounts.post('/reset', async (c) => {
  const input = await body(c, z.object({ token: z.string().min(10).max(200), password }));
  const db = await getDb();
  const found = await findReset(db, input.token);
  if (!found) throw badRequest('This link has expired or was already used. Ask for a new one.', { invalidLink: true });
  requireStrongPassword(input.password, { email: found.email, name: found.name });
  const hash = await bcrypt.hash(input.password, 12);
  const { tok, user } = await db.tx(async (q) => {
    // The conditional update is the single-use guard.
    const { rows } = await q.query<{ user_id: string; company_id: string | null }>(
      `update rigo.password_resets set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning user_id, company_id`, [sha256(input.token)]);
    if (!rows[0]) throw badRequest('This link has expired or was already used. Ask for a new one.', { invalidLink: true });
    // Re-check an owner's link inside the transaction too.
    if (!(await findResetRow(q, rows[0].user_id, rows[0].company_id, found.issued_by))) throw badRequest('This link no longer works. Ask for a new one.', { invalidLink: true });
    const uid = rows[0].user_id;
    await q.query(`update rigo.users set password_hash = $1 where id = $2`, [hash, uid]);
    // A link sent to the account's email also proves that address works.
    if (!rows[0].company_id) await q.query(`update rigo.users set email_verified_at = coalesce(email_verified_at, now()) where id = $1`, [uid]);
    await q.query(`delete from rigo.sessions where user_id = $1`, [uid]);
    await q.query(`update rigo.password_resets set expires_at = now() where user_id = $1 and used_at is null`, [uid]);
    await clearSigninFailures(q, found.email);
    await auditAccount(q, uid, 'password.reset', { via: rows[0].company_id ? 'owner_link' : 'email', companyId: rows[0].company_id });
    // Sign the person in on this device; other devices must sign in again.
    return { tok: await createSession(q, uid), user: await userById(q, uid) };
  });
  setSessionCookie(c, tok);
  return c.json(await mePayload(db, user));
});

/** Whether an email confirmation or email change link still works. Never reveals the address. */
accounts.get('/email-token/:token', async (c) => {
  const tok = c.req.param('token');
  if (tok.length < 10 || tok.length > 200) return c.json({ valid: false });
  const { rows } = await (await getDb()).query<{ purpose: string }>(
    `select t.purpose from rigo.email_tokens t join rigo.users u on u.id = t.user_id
      where t.token_hash = $1 and t.used_at is null and t.expires_at > now() and u.deleted_at is null
        and (t.purpose = 'change' or lower(u.email) = t.email)`, [sha256(tok)]);
  return rows[0] ? c.json({ valid: true, purpose: rows[0].purpose }) : c.json({ valid: false });
});

accounts.post('/email-token/:token', async (c) => {
  const tok = c.req.param('token');
  const db = await getDb();
  const invalid = () => badRequest('This link has expired or was already used. Ask for a new one.', { invalidLink: true });
  if (tok.length < 10 || tok.length > 200) throw invalid();
  const result = await db.tx(async (q) => {
    const { rows } = await q.query<{ user_id: string; purpose: 'verify' | 'change'; email: string }>(
      `update rigo.email_tokens set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning user_id, purpose, email`, [sha256(tok)]);
    const t = rows[0];
    if (!t) throw invalid();
    const user = await userById(q, t.user_id);
    if (!user) throw invalid();
    if (t.purpose === 'verify') {
      // A confirmation link only confirms the address it was sent to.
      if (normEmail(user.email) !== t.email) throw invalid();
      await q.query(`update rigo.users set email_verified_at = now() where id = $1`, [user.id]);
      await auditAccount(q, user.id, 'account.email_verified');
      return { purpose: 'verify' as const, userId: user.id };
    }
    const taken = await q.query(`select 1 from rigo.users where lower(email) = $1 and id <> $2`, [t.email, user.id]);
    if (taken.rows.length) throw conflict('Another account already uses that email address.');
    await applyEmailChange(q, user, t.email, true, c.get('sessionId'));
    return { purpose: 'change' as const, userId: user.id };
  });
  return c.json({ ok: true, purpose: result.purpose });
});

async function applyEmailChange(q: Q, user: User, next: string, verified: boolean, keepSession: string | null) {
  await q.query(`update rigo.users set email = $1, email_verified_at = ${verified ? 'now()' : 'null'} where id = $2`, [next, user.id]);
  // Links sent to the old address stop working, and other devices sign in again.
  await q.query(`update rigo.email_tokens set expires_at = now() where user_id = $1 and used_at is null`, [user.id]);
  await q.query(`update rigo.password_resets set expires_at = now() where user_id = $1 and used_at is null and company_id is null`, [user.id]);
  await q.query(`delete from rigo.sessions where user_id = $1 and id is distinct from $2`, [user.id, keepSession]);
  await clearSigninFailures(q, user.email);
  await auditAccount(q, user.id, 'account.email_changed', { from: user.email, to: next });
  if (systemEmailChannel() !== 'none') {
    await sendSystemEmail(q, {
      to: user.email, kind: 'email_changed_notice', subject: 'Your Rigo email address was changed',
      body: `The email address for your Rigo account was changed to ${next}.\n\nIf you didn't do this, reset your password right away or ask an owner of your company for help.`,
    });
  }
}

// ---------------------------------------------------------------- the signed-in person

accounts.get('/me', async (c) => c.json(await mePayload(await getDb(), c.get('user'))));

accounts.patch('/me', async (c) => {
  const user = requireUser(c);
  const input = await body(c, z.object({ name: name.optional(), theme: z.enum(['light', 'dark', 'system']).optional() }));
  const db = await getDb();
  if (input.name) await db.query(`update rigo.users set name = $1 where id = $2`, [input.name, user.id]);
  if (input.theme) await db.query(`update rigo.users set theme = $1 where id = $2`, [input.theme, user.id]);
  return c.json({ ok: true });
});

/** Checks the current password for a sensitive change; repeated wrong guesses pause these checks. */
async function confirmPassword(q: Q, userId: string, given: string, field = 'current') {
  const key = `pwcheck:${userId}`;
  const a = await attempts(q, key, SIGNIN_WINDOW_MIN);
  if (a.n >= SIGNIN_MAX_FAILURES) throw tooMany(`Too many wrong passwords. Try again in ${minutesText(a.wait)}.`, a.wait);
  const { rows } = await q.query<{ password_hash: string }>(`select password_hash from rigo.users where id = $1`, [userId]);
  if (!(await bcrypt.compare(given, rows[0]?.password_hash ?? '').catch(() => false))) {
    await recordCall(q, key);
    throw badRequest('Your current password is not correct.', { fields: { [field]: 'Your current password is not correct.' } });
  }
  await q.query(`delete from rigo.auth_attempts where key = $1`, [key]);
}

accounts.post('/me/password', async (c) => {
  const user = requireUser(c);
  const input = await body(c, z.object({ current: z.string().min(1, 'Enter your current password.').max(PASSWORD_MAX), password }));
  const db = await getDb();
  await confirmPassword(db, user.id, input.current);
  requireStrongPassword(input.password, user);
  await db.query(`update rigo.users set password_hash = $1 where id = $2`, [await bcrypt.hash(input.password, 12), user.id]);
  await db.query(`delete from rigo.sessions where user_id = $1 and id <> $2`, [user.id, c.get('sessionId')]);
  await clearSigninFailures(db, user.email);
  await auditAccount(db, user.id, 'password.changed');
  return c.json({ ok: true });
});

accounts.post('/me/email', async (c) => {
  const user = requireUser(c);
  const input = await body(c, z.object({ email, password: z.string().min(1, 'Enter your current password.').max(PASSWORD_MAX) }));
  const next = normEmail(input.email);
  const db = await getDb();
  await confirmPassword(db, user.id, input.password, 'password');
  if (next === normEmail(user.email)) throw badRequest('That is already your email address.', { fields: { email: 'That is already your email address.' } });
  const taken = await db.query(`select 1 from rigo.users where lower(email) = $1`, [next]);
  if (taken.rows.length) throw conflict('Another account already uses that email address.', { fields: { email: 'Another account already uses that email address.' } });
  if (systemEmailChannel() !== 'none') {
    // Switch only once the new address proves it can receive email.
    await db.tx(async (q) => {
      const link = await createEmailToken(q, user.id, 'change', next);
      await sendSystemEmail(q, {
        to: next, kind: 'email_change', link, subject: 'Confirm your new email for Rigo',
        body: `Hi ${user.name},\n\nOpen this link to use ${next} for your Rigo account:\n${link}\n\nIt works once and expires in 24 hours. Until then, keep signing in with your current email.`,
      });
    });
    return c.json({ status: 'pending', email: next });
  }
  // With no email service, the address changes now: the old one was never confirmed either.
  await db.tx((q) => applyEmailChange(q, user, next, false, c.get('sessionId')));
  return c.json({ status: 'changed', email: next });
});

accounts.post('/me/verify/resend', async (c) => {
  const user = requireUser(c);
  const db = await getDb();
  const { rows } = await db.query<{ email_verified_at: string | null }>(`select email_verified_at from rigo.users where id = $1`, [user.id]);
  if (rows[0]?.email_verified_at) return c.json({ ok: true, already: true });
  if (systemEmailChannel() === 'none') throw badRequest("Email isn't set up yet, so a confirmation can't be sent.");
  await limitCalls(db, `verify:${user.id}`, 5, 60, 'confirmation emails');
  await recordCall(db, `verify:${user.id}`);
  await db.tx((q) => sendVerifyEmail(q, user));
  return c.json({ ok: true, sentTo: user.email });
});

/**
 * Deletes the account. Past records keep pointing at the row, so it is anonymized rather than
 * removed: the email, name and password are wiped, memberships end and sessions are revoked.
 */
accounts.post('/me/delete', async (c) => {
  const user = requireUser(c);
  const input = await body(c, z.object({ password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX) }));
  const db = await getDb();
  await confirmPassword(db, user.id, input.password, 'password');
  await db.tx(async (q) => {
    const { rows: ms } = await q.query<{ id: string; user_id: string; company_id: string; company_name: string; is_owner: boolean; owners: number }>(
      `select m.id, m.user_id, m.company_id, c.name as company_name, r.is_owner,
              (select count(*)::int from rigo.memberships m2 join rigo.roles r2 on r2.company_id = m2.company_id and r2.key = m2.role_key
                where m2.company_id = m.company_id and m2.status = 'active' and r2.is_owner and not m2.is_fictional) as owners
         from rigo.memberships m join rigo.companies c on c.id = m.company_id join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
        where m.user_id = $1 and m.status = 'active' and c.kind = 'real' for update of m`, [user.id]);
    const sole = ms.filter((m) => m.is_owner && m.owners <= 1).map((m) => m.company_name);
    if (sole.length) {
      throw conflict(`You're the only owner of ${sole.join(', ')}. In Team, make someone else an owner first, then delete your account.`, { soleOwnerOf: sole });
    }
    for (const m of ms) {
      await removeMember(q, m.company_id, m, user.id, 'Assignee deleted their Rigo account');
      await audit(q, { company: { id: m.company_id }, user }, 'member.account_deleted', { memberId: m.id });
      await notifyRoles(q, m.company_id, ['owner'], { category: 'update', title: `${user.name} deleted their Rigo account`, body: 'They no longer have access to this company. Their past work stays in history.', link: 'team' });
    }
    await q.query(`delete from rigo.companies where kind = 'demo' and demo_user_id = $1`, [user.id]);
    await q.query(`update rigo.approval_delegations set ends_at = now() where (from_user_id = $1 or to_user_id = $1) and (ends_at is null or ends_at > now())`, [user.id]);
    await q.query(`delete from rigo.sessions where user_id = $1`, [user.id]);
    await q.query(`delete from rigo.password_resets where user_id = $1`, [user.id]);
    await q.query(`delete from rigo.email_tokens where user_id = $1`, [user.id]);
    await clearSigninFailures(q, user.email);
    await q.query(`update rigo.users set email = $2, name = 'Deleted user', password_hash = '!', email_verified_at = null, deleted_at = now() where id = $1`,
      [user.id, `deleted-${user.id}@deleted.invalid`]);
    await auditAccount(q, user.id, 'account.deleted');
  });
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

/** Local development only: the simulated mailbox that stands in for real email delivery. */
accounts.get('/dev/mailbox', async (c) => {
  if (!config.devMailbox) return c.json({ enabled: false, messages: [] });
  const { rows } = await (await getDb()).query(`select * from rigo.dev_mailbox order by created_at desc limit 50`);
  return c.json({ enabled: true, messages: rows });
});
