
import { createApp } from '../src/server/http/app.js';
import { processAll as processOnce } from '../src/server/automation/engine.js';
import { getDb } from '../src/server/db/index.js';

export const app = createApp();
export { getDb };

/**
 * Run automation until nothing is waiting. On a shared PostgreSQL database several test files run
 * at once and drain one queue: a single bounded pass can end on other files' work (or skip rows
 * another worker holds) before this test's events are done.
 */
export async function processAll(budgetMs = 4000) {
  const db = await getDb();
  const until = Date.now() + 30_000;
  for (;;) {
    await processOnce(budgetMs);
    const { rows } = await db.query<{ n: number }>(`select
        (select count(*) from rigo.events where processed_at is null) +
        (select count(*) from rigo.actions a join rigo.companies c on c.id = a.company_id where a.status = 'queued' and not c.paused and (a.next_attempt_at is null or a.next_attempt_at <= now())) +
        (select count(*) from rigo.automation_runs where status = 'running') as n`);
    if (Number(rows[0].n) === 0 || Date.now() > until) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

let n = 0;
export class Client {
  cookie = '';
  ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  constructor(public email: string) {}
  async req(method: string, path: string, body?: unknown) {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-rigo': '1', cookie: this.cookie, 'x-forwarded-for': this.ip },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  }
  get(p: string) { return this.req('GET', p); }
  post(p: string, b: unknown = {}) { return this.req('POST', p, b); }
  patch(p: string, b: unknown = {}) { return this.req('PATCH', p, b); }
  put(p: string, b: unknown = {}) { return this.req('PUT', p, b); }
  del(p: string) { return this.req('DELETE', p); }
}

export async function signup(name = 'Test User') {
  const email = `user${++n}-${Date.now()}@example.test`;
  const c = new Client(email);
  const r = await c.post('/auth/signup', { name, email, password: 'correct-horse-battery' });
  if (r.status !== 200) throw new Error(`signup failed ${JSON.stringify(r.body)}`);
  return c;
}

export async function newCompany(owner: Client, categories = ['fuel', 'portable_toilet', 'septic'], name = 'Test Co') {
  const r = await owner.post('/companies', { name, timezone: 'America/Chicago', currency: 'USD', categories, start: 'starter' });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  return r.body.id as string;
}

export async function invite(owner: Client, cid: string, member: Client, role: string) {
  const r = await owner.post(`/c/${cid}/invitations`, { email: member.email, role });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  const token = r.body.link.split('/invite/')[1];
  const a = await member.post(`/invitations/${token}/accept`);
  if (a.status !== 200) throw new Error(JSON.stringify(a.body));
  return token;
}

export const rid = () => `req-${Math.random().toString(36).slice(2)}-${Date.now()}`;

/** Create a customer + location and return ids. */
export async function customer(c: Client, cid: string, name = 'Customer A', email = 'a@example.test') {
  const r = await c.post(`/c/${cid}/customers`, { name, email, location: { address: '1 Test Rd', accessInstructions: 'Gate 1' } });
  const d = await c.get(`/c/${cid}/customers/${r.body.id}`);
  return { customerId: r.body.id as string, locationId: d.body.locations[0].id as string };
}

export async function services(c: Client, cid: string) {
  const r = await c.get(`/c/${cid}/services`);
  return Object.fromEntries(r.body.services.map((s: any) => [s.category, s]));
}

export async function activateAll(owner: Client, cid: string) {
  const wfs = await owner.get(`/c/${cid}/workflows`);
  for (const w of wfs.body.workflows) {
    const t = await owner.post(`/c/${cid}/workflows/${w.id}/versions/${w.latest_id}/test`, {});
    if (!t.body.ok) throw new Error(JSON.stringify(t.body));
    const a = await owner.post(`/c/${cid}/workflows/${w.id}/versions/${w.latest_id}/activate`);
    if (a.status !== 200) throw new Error(JSON.stringify(a.body));
  }
}
