import { createApp } from '../src/server/http/app.js';
import { getDb } from '../src/server/db/index.js';

export const app = createApp();
export { getDb };

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

/**
 * A workspace owned by `owner`, from a built-in template (field service by default, whose roles are
 * dispatcher, driver and office).
 */
export async function newCompany(owner: Client, template: string | string[] = 'field_service', name = 'Test Co') {
  const templateKey = Array.isArray(template) ? 'field_service' : template;
  const r = await owner.post('/companies', { name, templateKey, timezone: 'America/Chicago', currency: 'USD' });
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
