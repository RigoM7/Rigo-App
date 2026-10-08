import { describe, it, expect, afterEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Client, signup, newCompany, invite, getDb, app } from './helpers';
import { config } from '../src/server/config';
import { checkPassword } from '../src/shared/password';
import { suggestEmail } from '../src/shared/email';
import { sha256 } from '../src/server/lib/util';
import { COMMON_PASSWORDS } from '../src/server/lib/common-passwords';

const STRONG = 'tidy-lantern-orchard-42';
afterEach(() => vi.restoreAllMocks());

/** A second device for the same person: same email, different network address. */
function device(of: Client) { return new Client(of.email); }

async function newAccount(name = 'Alex Field') {
  const email = `acct-${Math.random().toString(36).slice(2)}-${Date.now()}@example.test`;
  const c = new Client(email);
  const r = await c.post('/auth/signup', { name, email, password: STRONG });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  return c;
}

async function lastMail(to: string, kind: string) {
  const db = await getDb();
  const { rows } = await db.query<{ link: string }>(`select link from rigo.dev_mailbox where to_email = $1 and kind = $2 order by created_at desc limit 1`, [to.toLowerCase(), kind]);
  return rows[0]?.link ?? null;
}
const tokenOf = (link: string) => link.split('/').pop()!;

/** Collects every message (top-level and per field) from an API error body. */
function messages(b: any): string[] {
  const out: string[] = [];
  if (b?.error?.message) out.push(b.error.message);
  for (const v of Object.values(b?.error?.details?.fields ?? {})) out.push(String(v));
  return out;
}

describe('C1: sign-in and sign-up return the signed-in person', () => {
  it('sign-up and sign-in respond with the same payload as /auth/me', async () => {
    const c = await newAccount('Sam Returning');
    const me = await c.get('/auth/me');
    const again = device(c);
    const r = await again.post('/auth/signin', { email: c.email, password: STRONG });
    expect(r.status).toBe(200);
    expect(r.body.user.email).toBe(c.email);
    expect(Object.keys(r.body).sort()).toEqual(Object.keys(me.body).sort());
  });
});

describe('M1: sign-in lockout', () => {
  it('successful sign-ins never lock an account', async () => {
    const c = await newAccount();
    const d = device(c);
    for (let i = 0; i < 12; i++) {
      const r = await d.post('/auth/signin', { email: c.email, password: STRONG });
      expect(r.status, `sign-in ${i + 1}`).toBe(200);
    }
  });

  // Moves this email + address's failures back in time, as if the driver waited (R1-M1 backoff).
  const waitOut = async (c: Client, a: Client, seconds: number) => (await getDb()).query(`update rigo.auth_attempts set at = at - ($2 || ' seconds')::interval where key = $1`, [`signin:${c.email.toLowerCase()}|${a.ip}`, String(seconds)]);

  it('after 5 failures each try waits longer (15 s, 30 s, 1 min…), with the wait in the message', async () => {
    const c = await newAccount();
    const a = device(c);
    for (let i = 1; i <= 5; i++) expect((await a.post('/auth/signin', { email: c.email, password: 'wrong-password-here' })).status).toBe(401);
    const sixth = await a.post('/auth/signin', { email: c.email, password: STRONG });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.message).toBe('Too many sign-in attempts. Try again in 15 seconds, or reset your password.');
    await waitOut(c, a, 16);
    expect((await a.post('/auth/signin', { email: c.email, password: 'wrong-password-here' })).status).toBe(401);
    const seventh = await a.post('/auth/signin', { email: c.email, password: STRONG });
    expect(seventh.body.error.message).toBe('Too many sign-in attempts. Try again in 30 seconds, or reset your password.');
    await waitOut(c, a, 31);
    expect((await a.post('/auth/signin', { email: c.email, password: STRONG })).status).toBe(200);
  });

  it('10 failures lock that email on that address only, with the wait time and a warning first', async () => {
    const c = await newAccount();
    const a = device(c);
    let last: any;
    for (let i = 1; i <= 9; i++) {
      if (i > 5) await waitOut(c, a, 15 * 2 ** (i - 6) + 1);
      last = await a.post('/auth/signin', { email: c.email, password: 'wrong-password-here' });
      expect(last.status).toBe(401);
      if (i < 7) expect(last.body.error.details).toBeNull();
      if (i === 7) expect(last.body.error.details).toMatchObject({ remaining: 3, pauseMinutes: 15 });
    }
    expect(last.body.error.details.remaining).toBe(1);
    await waitOut(c, a, 241);
    const tenth = await a.post('/auth/signin', { email: c.email, password: 'wrong-password-here' });
    expect(tenth.status).toBe(429);
    // Even the right password waits on this device.
    const res = await app.request('/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json', 'x-rigo': '1', 'x-forwarded-for': a.ip }, body: JSON.stringify({ email: c.email, password: STRONG }) });
    expect(res.status).toBe(429);
    const retry = Number(res.headers.get('retry-after'));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(15 * 60);
    const b = await res.json();
    expect(b.error.details.retryAfter).toBe(retry);
    expect(b.error.message).toMatch(/Try again in \d+ minutes?, or reset your password\./);
    // Another device (address) still signs in.
    const other = device(c);
    expect((await other.post('/auth/signin', { email: c.email, password: STRONG })).status).toBe(200);
  });

  it('a successful sign-in clears the failures', async () => {
    const c = await newAccount();
    const a = device(c);
    for (let i = 0; i < 4; i++) await a.post('/auth/signin', { email: c.email, password: 'wrong-password-here' });
    expect((await a.post('/auth/signin', { email: c.email, password: STRONG })).status).toBe(200);
    const after = await a.post('/auth/signin', { email: c.email, password: 'wrong-password-here' });
    expect(after.status).toBe(401);
    expect(after.body.error.details).toBeNull();
  });

  it('a password reset clears the lock', async () => {
    const c = await newAccount();
    const a = device(c);
    for (let i = 0; i < 10; i++) { if (i >= 5) await waitOut(c, a, 15 * 2 ** (i - 5) + 1); await a.post('/auth/signin', { email: c.email, password: 'wrong-password-here' }); }
    expect((await a.post('/auth/signin', { email: c.email, password: STRONG })).status).toBe(429);
    await a.post('/auth/forgot', { email: c.email });
    const link = await lastMail(c.email, 'password_reset');
    expect((await new Client(c.email).post('/auth/reset', { token: tokenOf(link!), password: 'quiet-harbor-maple-91' })).status).toBe(200);
    expect((await a.post('/auth/signin', { email: c.email, password: 'quiet-harbor-maple-91' })).status).toBe(200);
  });

  it('many failures from one address across accounts pause that address', async () => {
    const ipc = new Client('spray@example.test');
    const db = await getDb();
    for (let i = 0; i < 99; i++) await db.query(`insert into rigo.auth_attempts (key) values ($1)`, [`signin-ip:${ipc.ip}`]);
    const r = await ipc.post('/auth/signin', { email: `nobody-${Date.now()}@example.test`, password: 'whatever-password' });
    expect(r.status).toBe(401);
    const blocked = await ipc.post('/auth/signin', { email: `someone-${Date.now()}@example.test`, password: 'whatever-password' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toMatch(/from this network/);
  });

  it('old attempt records are cleaned up', async () => {
    const { cleanupAuth } = await import('../src/server/modules/accounts');
    const db = await getDb();
    await db.query(`insert into rigo.auth_attempts (key, at) values ('old-test-key', now() - interval '2 days')`);
    await cleanupAuth();
    const { rows } = await db.query(`select 1 from rigo.auth_attempts where key = 'old-test-key'`);
    expect(rows.length).toBe(0);
  });
});

describe('M2: password rule', () => {
  it('rejects easy passwords at sign-up and accepts a phrase', async () => {
    for (const pw of ['aaaaaaaaaa', 'password123', '1234567890', 'qwertyuiop', 'abcdefghij', '0987654321', 'abcabcabca', 'Password123!']) {
      const email = `weak-${Math.random().toString(36).slice(2)}@example.test`;
      const r = await new Client(email).post('/auth/signup', { name: 'Weak Pw', email, password: pw });
      expect(r.status, pw).toBe(400);
      expect(r.body.error.details.fields.password, pw).toMatch(/too easy to guess/);
    }
    const named = await new Client('dana.reyes@example.test').post('/auth/signup', { name: 'Dana Reyes', email: `dana.reyes${Date.now()}@example.test`, password: 'reyes-family-2024' });
    expect(named.status).toBe(400);
    expect(named.body.error.details.fields.password).toMatch(/name or email/);
    const ok = await new Client('x@example.test').post('/auth/signup', { name: 'Strong Pw', email: `strong-${Date.now()}@example.test`, password: 'violet-tractor-sunrise' });
    expect(ok.status).toBe(200);
  });

  it('applies the same rule on reset and on change', async () => {
    const c = await newAccount();
    const ch = await c.post('/auth/me/password', { current: STRONG, password: 'password123' });
    expect(ch.status).toBe(400);
    expect(ch.body.error.details.fields.password).toMatch(/too easy/);
    await c.post('/auth/forgot', { email: c.email });
    const tok = tokenOf((await lastMail(c.email, 'password_reset'))!);
    const weak = await new Client('r@example.test').post('/auth/reset', { token: tok, password: 'qwertyuiop' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.details.fields.password).toMatch(/too easy/);
    // A rejected password does not use up the link.
    expect((await c.get(`/auth/reset/${tok}`)).body.valid).toBe(true);
  });

  it('existing accounts with weak passwords still sign in', async () => {
    const c = await newAccount();
    const db = await getDb();
    await db.query(`update rigo.users set password_hash = $1 where lower(email) = $2`, [await bcrypt.hash('password123', 4), c.email]);
    expect((await device(c).post('/auth/signin', { email: c.email, password: 'password123' })).status).toBe(200);
  });

  it('shared rule and common list', () => {
    const common = (s: string) => COMMON_PASSWORDS.has(s);
    expect(COMMON_PASSWORDS.size).toBeGreaterThan(9000);
    expect(checkPassword('zzzzzzzzzzzz', {}, common)).toMatch(/too easy/);
    expect(checkPassword('asdfghjkl;', {}, common)).toMatch(/too easy/);
    expect(checkPassword('iloveyou2024', {}, common)).toMatch(/too easy/);
    expect(checkPassword('juniper-copper-falcon', { email: 'luis@example.com', name: 'Luis Ortega' }, common)).toBeNull();
    expect(checkPassword('luis-copper-falcon', { email: 'luis@example.com', name: 'Luis Ortega' }, common)).toMatch(/name or email/);
  });
});

describe('C2: recovery without email', () => {
  it('says how recovery works before anyone types', async () => {
    const r = await new Client('x').get('/auth/recovery');
    expect(r.body).toEqual({ methods: ['mailbox', 'owner_link'], supportEmail: null });
    const prev = config.devMailbox;
    config.devMailbox = false;
    try {
      expect((await new Client('x').get('/auth/recovery')).body.methods).toEqual(['owner_link']);
      const f = await new Client('x').post('/auth/forgot', { email: 'someone@example.test' });
      expect(f.body.channel).toBe('unavailable');
    } finally { config.devMailbox = prev; }
  });

  it('owners create single-use reset links; other roles cannot', async () => {
    const owner = await signup('Olivia Owner');
    const cid = await newCompany(owner);
    const driver = await signup('Luis Driver');
    const dispatcher = await signup('Dee Dispatcher');
    const office = await signup('Ollie Office');
    await invite(owner, cid, driver, 'driver');
    await invite(owner, cid, dispatcher, 'dispatcher');
    await invite(owner, cid, office, 'office');
    const members = (await owner.get(`/c/${cid}/members`)).body.members;
    const mid = (name: string) => members.find((m: any) => m.name === name).id;

    for (const who of [dispatcher, driver, office]) {
      expect((await who.post(`/c/${cid}/members/${mid('Luis Driver')}/reset-link`)).status).toBe(403);
    }
    expect((await owner.post(`/c/${cid}/members/${mid('Olivia Owner')}/reset-link`)).status).toBe(400);

    const before = device(driver);
    await before.post('/auth/signin', { email: driver.email, password: 'correct-horse-battery' });
    expect((await before.get('/auth/me')).body.user).not.toBeNull();

    const r = await owner.post(`/c/${cid}/members/${mid('Luis Driver')}/reset-link`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ simulated: false, name: 'Luis Driver', expiresInHours: 24 });
    const tok = tokenOf(r.body.link);
    expect((await new Client('x').get(`/auth/reset/${tok}`)).body).toEqual({ valid: true });

    const phone = new Client(driver.email);
    const used = await phone.post('/auth/reset', { token: tok, password: 'river-stone-lamp-77' });
    expect(used.status).toBe(200);
    // Signed in on this device straight away (m2).
    expect(used.body.user.email).toBe(driver.email);
    expect((await phone.get('/auth/me')).body.user.email).toBe(driver.email);
    // Existing sessions were signed out.
    expect((await before.get('/auth/me')).body.user).toBeNull();
    expect((await driver.get('/auth/me')).body.user).toBeNull();
    // Works once.
    const again = await new Client('x').post('/auth/reset', { token: tok, password: 'another-good-phrase-1' });
    expect(again.status).toBe(400);
    expect(again.body.error.details.invalidLink).toBe(true);
    // The page says why (R1-m3): this one was used.
    expect((await new Client('x').get(`/auth/reset/${tok}`)).body).toEqual({ valid: false, reason: 'used' });
    expect((await new Client('x').get(`/auth/reset/not-a-real-token-123456`)).body).toEqual({ valid: false, reason: 'invalid' });

    const db = await getDb();
    const a = await db.query(`select 1 from rigo.audit_log where company_id = $1 and action = 'member.reset_link_created'`, [cid]);
    expect(a.rows.length).toBe(1);
  });

  it('only owners can target an owner, other companies get 404, and links expire', async () => {
    const owner = await signup('Olivia Owner');
    const cid = await newCompany(owner);
    const coOwner = await signup('Carla Coowner');
    const dispatcher = await signup('Dee Dispatcher');
    const driver = await signup('Luis Driver');
    await invite(owner, cid, coOwner, 'owner');
    await invite(owner, cid, dispatcher, 'dispatcher');
    await invite(owner, cid, driver, 'driver');
    const roles = (await owner.get(`/c/${cid}/roles`)).body.roles;
    const disp = roles.find((r: any) => r.key === 'dispatcher');
    await owner.patch(`/c/${cid}/roles/dispatcher`, { permissions: [...disp.permissions, 'members.manage'] });
    const members = (await owner.get(`/c/${cid}/members`)).body.members;
    const mid = (name: string) => members.find((m: any) => m.name === name).id;

    expect((await dispatcher.post(`/c/${cid}/members/${mid('Olivia Owner')}/reset-link`)).status).toBe(403);
    expect((await dispatcher.post(`/c/${cid}/members/${mid('Luis Driver')}/reset-link`)).status).toBe(200);
    const forOwner = await owner.post(`/c/${cid}/members/${mid('Carla Coowner')}/reset-link`);
    expect(forOwner.status).toBe(200);
    // The other owners hear about it.
    const notes = (await coOwner.get(`/c/${cid}/notifications`)).body;
    const ownerNotes = await (await getDb()).query(`select title from rigo.notifications n join rigo.users u on u.id = n.user_id where n.company_id = $1 and lower(u.email) = $2`, [cid, coOwner.email]);
    expect(notes).toBeDefined();
    expect(ownerNotes.rows.some((n: any) => /reset link for Luis Driver/.test(n.title))).toBe(true);

    const other = await signup('Other Owner');
    const otherCid = await newCompany(other);
    expect((await other.post(`/c/${otherCid}/members/${mid('Luis Driver')}/reset-link`)).status).toBe(404);
    expect((await other.post(`/c/${cid}/members/${mid('Luis Driver')}/reset-link`)).status).toBe(404);

    const tok = tokenOf(forOwner.body.link);
    await (await getDb()).query(`update rigo.password_resets set expires_at = now() - interval '1 minute' where company_id = $1 and used_at is null`, [cid]);
    expect((await new Client('x').get(`/auth/reset/${tok}`)).body).toEqual({ valid: false, reason: 'expired' });
    expect((await new Client('x').post('/auth/reset', { token: tok, password: 'river-stone-lamp-77' })).status).toBe(400);
  });

  it('refuses a link for someone who also belongs to another company', async () => {
    const owner = await signup('Olivia Owner');
    const cid = await newCompany(owner);
    const driver = await signup('Luis Driver');
    await invite(owner, cid, driver, 'driver');
    await newCompany(driver, ['fuel'], "Luis's Own Co");
    const members = (await owner.get(`/c/${cid}/members`)).body.members;
    const r = await owner.post(`/c/${cid}/members/${members.find((m: any) => m.name === 'Luis Driver').id}/reset-link`);
    expect(r.status).toBe(409);
  });

  it('re-checks an owner-created link when it is used, and counts invitations to other companies', async () => {
    const owner = await signup('Olivia Owner');
    const cid = await newCompany(owner);
    const dispatcher = await signup('Dee Dispatcher');
    const driver = await signup('Luis Driver');
    const helper = await signup('Hal Helper');
    await invite(owner, cid, dispatcher, 'dispatcher');
    await invite(owner, cid, driver, 'driver');
    await invite(owner, cid, helper, 'driver');
    const roles = (await owner.get(`/c/${cid}/roles`)).body.roles;
    const disp = roles.find((r: any) => r.key === 'dispatcher');
    await owner.patch(`/c/${cid}/roles/dispatcher`, { permissions: [...disp.permissions, 'members.manage'] });
    const members = (await owner.get(`/c/${cid}/members`)).body.members;
    const mid = (name: string) => members.find((m: any) => m.name === name).id;
    const reuse = async (link: string) => new Client('x').post('/auth/reset', { token: tokenOf(link), password: 'river-stone-lamp-77' });

    // (a) A non-owner's link stops working once its target becomes an owner.
    const forDriver = (await dispatcher.post(`/c/${cid}/members/${mid('Luis Driver')}/reset-link`)).body.link;
    await owner.patch(`/c/${cid}/members/${mid('Luis Driver')}`, { role: 'owner', confirmOwner: true });
    expect((await new Client('x').get(`/auth/reset/${tokenOf(forDriver)}`)).body.valid).toBe(false);
    expect((await reuse(forDriver)).status).toBe(400);

    // (b) A pending invitation to another company blocks creating a link, and joining one later voids it.
    const other = await signup('Other Owner');
    const otherCid = await newCompany(other, ['fuel'], 'Other Co');
    const forHelper = (await owner.post(`/c/${cid}/members/${mid('Hal Helper')}/reset-link`)).body.link;
    expect((await new Client('x').get(`/auth/reset/${tokenOf(forHelper)}`)).body.valid).toBe(true);
    await other.post(`/c/${otherCid}/invitations`, { email: helper.email, role: 'dispatcher' });
    expect((await owner.post(`/c/${cid}/members/${mid('Hal Helper')}/reset-link`)).status).toBe(409);
    expect((await new Client('x').get(`/auth/reset/${tokenOf(forHelper)}`)).body.valid).toBe(false);
    expect((await reuse(forHelper)).status).toBe(400);

    // (c) A link stops working when the person who created it is removed.
    const dispLink = (await dispatcher.post(`/c/${cid}/members/${mid('Luis Driver')}/reset-link`));
    expect(dispLink.status).toBe(403); // Luis is an owner now
    const fresh = await signup('Fay Fresh');
    await invite(owner, cid, fresh, 'driver');
    const freshMid = (await owner.get(`/c/${cid}/members`)).body.members.find((m: any) => m.name === 'Fay Fresh').id;
    const byDispatcher = (await dispatcher.post(`/c/${cid}/members/${freshMid}/reset-link`)).body.link;
    await owner.del(`/c/${cid}/members/${mid('Dee Dispatcher')}`);
    expect((await new Client('x').get(`/auth/reset/${tokenOf(byDispatcher)}`)).body.valid).toBe(false);
    expect((await reuse(byDispatcher)).status).toBe(400);
  });

  it('demo reset links are simulated and make no external call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const visitor = await signup('Demo Visitor');
    const demo = await visitor.post('/demo');
    const cid = demo.body.id;
    const members = (await visitor.get(`/c/${cid}/members`)).body.members;
    const fictional = members.find((m: any) => m.is_fictional);
    const r = await visitor.post(`/c/${cid}/members/${fictional.id}/reset-link`);
    expect(r.status).toBe(200);
    expect(r.body.simulated).toBe(true);
    expect((await visitor.get(`/auth/reset/${tokenOf(r.body.link)}`)).body.valid).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('M3: email typos, confirmation, change and deletion', () => {
  it('suggests corrections for common domain typos', () => {
    expect(suggestEmail('dana.reyes@gmial.com')).toBe('dana.reyes@gmail.com');
    expect(suggestEmail('a@hotmal.com')).toBe('a@hotmail.com');
    expect(suggestEmail('a@yaho.com')).toBe('a@yahoo.com');
    expect(suggestEmail('a@outlok.com')).toBe('a@outlook.com');
    expect(suggestEmail('a@company.con')).toBe('a@company.com');
    expect(suggestEmail('a@gmail.com')).toBeNull();
  });

  it('confirmation links work once and expire', async () => {
    const c = await newAccount();
    expect((await c.get('/auth/me')).body.user.emailVerified).toBe(false);
    const tok = tokenOf((await lastMail(c.email, 'email_verify'))!);
    expect((await new Client('x').get(`/auth/email-token/${tok}`)).body).toEqual({ valid: true, purpose: 'verify' });
    expect((await new Client('x').post(`/auth/email-token/${tok}`)).status).toBe(200);
    expect((await c.get('/auth/me')).body.user.emailVerified).toBe(true);
    const twice = await new Client('x').post(`/auth/email-token/${tok}`);
    expect(twice.status).toBe(400);
    expect((await new Client('x').get(`/auth/email-token/${tok}`)).body).toEqual({ valid: false });

    const d = await newAccount();
    await d.post('/auth/me/verify/resend');
    const t2 = tokenOf((await lastMail(d.email, 'email_verify'))!);
    await (await getDb()).query(`update rigo.email_tokens set expires_at = now() - interval '1 minute' where token_hash = $1`, [sha256(t2)]);
    expect((await new Client('x').get(`/auth/email-token/${t2}`)).body.valid).toBe(false);
    expect((await new Client('x').post(`/auth/email-token/${t2}`)).status).toBe(400);
  });

  it('changes email with the password, revokes other sessions, and matches invitations', async () => {
    const owner = await signup('Olivia Owner');
    const cid = await newCompany(owner);
    const c = await newAccount('Dana Reyes');
    const other = device(c);
    await other.post('/auth/signin', { email: c.email, password: STRONG });
    const fixed = `dana-${Date.now()}@gmail.example.test`;
    await owner.post(`/c/${cid}/invitations`, { email: fixed, role: 'driver' });

    expect((await c.post('/auth/me/email', { email: fixed, password: 'not-my-password' })).body.error.details.fields.password).toMatch(/not correct/);
    expect((await c.post('/auth/me/email', { email: owner.email, password: STRONG })).status).toBe(409);
    expect((await c.post('/auth/me/email', { email: c.email, password: STRONG })).status).toBe(400);

    const r = await c.post('/auth/me/email', { email: fixed, password: STRONG });
    expect(r.body).toEqual({ status: 'pending', email: fixed });
    const tok = tokenOf((await lastMail(fixed, 'email_change'))!);
    expect((await c.post(`/auth/email-token/${tok}`)).body).toEqual({ ok: true, purpose: 'change' });
    const me = (await c.get('/auth/me')).body;
    expect(me.user.email).toBe(fixed);
    expect(me.user.emailVerified).toBe(true);
    expect(me.invitations.some((i: any) => i.company_name === 'Test Co')).toBe(true);
    expect((await other.get('/auth/me')).body.user).toBeNull();
    // The old address heard about it.
    expect(await (await getDb()).query(`select 1 from rigo.dev_mailbox where to_email = $1 and kind = 'email_changed_notice'`, [c.email])).toHaveProperty('rows.length', 1);
  });

  it('changes email immediately when no email service is set up', async () => {
    const prev = config.devMailbox;
    config.devMailbox = false;
    try {
      const c = await newAccount('Dana Reyes');
      const other = device(c);
      await other.post('/auth/signin', { email: c.email, password: STRONG });
      const fixed = `dana-now-${Date.now()}@example.test`;
      const r = await c.post('/auth/me/email', { email: fixed, password: STRONG });
      expect(r.body).toEqual({ status: 'changed', email: fixed });
      expect((await c.get('/auth/me')).body.user.email).toBe(fixed);
      expect((await other.get('/auth/me')).body.user).toBeNull();
      expect((await new Client(fixed).post('/auth/signin', { email: fixed, password: STRONG })).status).toBe(200);
      const a = await (await getDb()).query(`select 1 from rigo.audit_log where action = 'account.email_changed' and detail->>'to' = $1`, [fixed]);
      expect(a.rows.length).toBe(1);
    } finally { config.devMailbox = prev; }
  });

  it('deletes an account, but not while it is the only owner of a company', async () => {
    const owner = await signup('Olivia Owner');
    const cid = await newCompany(owner);
    const co = await signup('Carla Coowner');
    await invite(owner, cid, co, 'owner');
    const solo = await newAccount('Solo Owner');
    await newCompany(solo, ['fuel'], 'Solo Fuel');
    const blocked = await solo.post('/auth/me/delete', { password: STRONG });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/only owner of Solo Fuel/);
    expect((await co.post('/auth/me/delete', { password: 'wrong-password' })).status).toBe(400);
    const r = await co.post('/auth/me/delete', { password: 'correct-horse-battery' });
    expect(r.status).toBe(200);
    expect((await co.get('/auth/me')).body.user).toBeNull();
    expect((await new Client(co.email).post('/auth/signin', { email: co.email, password: 'correct-horse-battery' })).status).toBe(401);
    const members = (await owner.get(`/c/${cid}/members`)).body.members;
    expect(members.some((m: any) => m.name === 'Carla Coowner')).toBe(false);
    // The email can be used for a new account.
    expect((await new Client(co.email).post('/auth/signup', { name: 'Carla Again', email: co.email, password: STRONG })).status).toBe(200);
  });
});

describe('m1 and m3: plain messages and link checks', () => {
  it('no API error message uses developer wording', async () => {
    const owner = await signup('Olivia Owner');
    const cid = await newCompany(owner);
    const bodies = [
      (await new Client('x').post('/auth/signup', { name: 'x'.repeat(81), email: 'not-an-email', password: 'short' })).body,
      (await new Client('x').post('/auth/signup', { name: 123, email: 7, password: null })).body,
      (await owner.post('/companies', { name: 'y'.repeat(200), timezone: 5, currency: 'EURO', categories: 'fuel', start: 'maybe' })).body,
      (await owner.post(`/c/${cid}/customers`, { name: 'z'.repeat(500), email: 'bad', location: { address: 'q'.repeat(2000) } })).body,
      (await owner.patch('/auth/me', { name: 'n'.repeat(81), theme: 'pink' })).body,
      (await owner.post(`/c/${cid}/invitations`, { email: 'nope', role: 'x'.repeat(100) })).body,
      (await owner.post(`/c/${cid}/roles`, { name: 'r'.repeat(100), app: 'robot', permissions: ['nope'] })).body,
      (await owner.post(`/c/${cid}/work`, { clientId: 'not-a-uuid', startsAt: 'tomorrow', lines: [{ description: '', quantity: 'lots' }] })).body,
    ];
    const all = bodies.flatMap(messages);
    expect(all.length).toBeGreaterThan(10);
    for (const m of all) expect(m, m).not.toMatch(/expected|received|string|number|<=|>=|Invalid input|too big|too small/i);
    expect(all).toContain('Use 80 characters or fewer.');
  });

  it('the global error map covers common schema types', () => {
    const cases: [z.ZodType, unknown][] = [
      [z.string().max(5), 'toolong'], [z.string().min(3), 'a'], [z.string().min(1), ''], [z.number().int(), 1.5], [z.number(), 'x'],
      [z.number().max(10), 11], [z.number().min(0), -1], [z.boolean(), 'yes'], [z.string(), undefined], [z.string().email(), 'x'],
      [z.string().uuid(), 'x'], [z.string().datetime(), 'x'], [z.enum(['a', 'b']), 'c'], [z.array(z.string()).max(1), ['a', 'b']],
      [z.array(z.string()).min(1), []], [z.string().url(), 'nope'], [z.literal('a'), 'b'],
    ];
    for (const [schema, input] of cases) {
      const r = schema.safeParse(input);
      expect(r.success).toBe(false);
      const msg = r.error!.issues[0].message;
      expect(msg, msg).not.toMatch(/expected|received|string|<=|>=|Invalid/i);
      expect(msg.length).toBeGreaterThan(5);
    }
  });

  it('reset and email links can be checked without revealing the account', async () => {
    const r = await new Client('x').get('/auth/reset/not-a-real-token-123456');
    expect(r.body).toEqual({ valid: false, reason: 'invalid' });
    expect((await new Client('x').get('/auth/email-token/not-a-real-token-123456')).body).toEqual({ valid: false });
  });

  it('legal links are only shown when configured', async () => {
    expect((await new Client('x').get('/auth/legal')).body).toEqual({ termsUrl: null, privacyUrl: null });
  });
});

describe('sign-up attempts (security review)', () => {
  it('every attempt counts toward the per-address limit, including addresses that already have an account', async () => {
    const taken = await signup('Taken');
    const probe = new Client('probe@example.test');
    const r = await probe.post('/auth/signup', { name: 'Probe', email: taken.email, password: 'violet-tractor-sunrise' });
    expect(r.status).toBe(409);
    const { rows } = await (await getDb()).query(`select count(*)::int n from rigo.auth_attempts where key = $1`, [`signup-try:${probe.ip}`]);
    expect(rows[0].n).toBe(1);
  });

  it('the local test mailbox is never served in production', async () => {
    const { config } = await import('../src/server/config.js');
    const was = config.isProd;
    (config as any).isProd = true;
    try {
      expect((await new Client('x@example.test').get('/auth/dev/mailbox')).body).toEqual({ enabled: false, messages: [] });
    } finally { (config as any).isProd = was; }
  });
});
