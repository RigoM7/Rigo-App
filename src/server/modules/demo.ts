import { Hono } from 'hono';
import { z } from 'zod';
import type { Q } from '../db/index.js';
import { getDb } from '../db/index.js';
import { type AppEnv, requireUser, audit } from '../http/context.js';
import { body } from '../lib/util.js';
import { badRequest, forbidden } from '../http/errors.js';
import { templateByKey, GENERAL } from '../../shared/templates.js';
import { createWorkspace } from './workspaces.js';
import { fillSampleData } from './samples.js';

// Demos: anyone signed in can open any template as a demo. A demo is the person's own isolated
// workspace (kind 'demo'); it starts empty and "Show sample data" fills it. The provider boundary
// treats demo workspaces as simulation only: they never send, charge, connect or call a paid service.

export const demoPublic = new Hono<AppEnv>();
export const demoRoutes = new Hono<AppEnv>();

/** Fictional people can never sign in: a reserved .invalid domain and an unusable password hash. */
async function fictionalUser(q: Q, name: string) {
  const email = `demo-${crypto.randomUUID()}@demo.rigo.invalid`;
  const { rows } = await q.query<{ id: string }>(`insert into rigo.users (email, name, password_hash) values ($1,$2,'!') returning id`, [email, name]);
  return rows[0].id;
}

const FIRST_NAMES = ['Alex Rivera', 'Sam Okafor', 'Jordan Lee', 'Riley Chen', 'Casey Novak', 'Morgan Diaz', 'Taylor Brooks', 'Jamie Park'];

/** One person's demo of a template. Opening another template replaces it. */
export async function createDemo(q: Q, userId: string, templateKey: string) {
  const t = templateByKey(templateKey) ?? GENERAL;
  const old = await q.query<{ id: string }>(`select id from rigo.companies where kind = 'demo' and demo_user_id = $1`, [userId]);
  for (const o of old.rows) await q.query(`delete from rigo.companies where id = $1`, [o.id]);
  const cid = await createWorkspace(q, userId, {
    name: `${t.name} demo`, description: `A demo of the ${t.name.toLowerCase()} template.`, templateKey: t.key,
    timezone: 'America/Chicago', currency: 'USD', allowDuplicateName: true,
  }, { kind: 'demo' });
  // A fictional person in each role, so assigning work and switching views have someone to show.
  const roles = (await q.query<{ key: string; name: string; app: string }>(`select key, name, app from rigo.roles where company_id = $1 and not is_owner order by position`, [cid])).rows;
  let workerUserId: string | null = null;
  let i = 0;
  for (const r of roles) {
    for (let n = 0; n < (r.app === 'worker' ? 2 : 1); n++) {
      const name = `${FIRST_NAMES[i++ % FIRST_NAMES.length]} (fictional)`;
      const uid = await fictionalUser(q, name);
      await q.query(`insert into rigo.memberships (company_id, user_id, role_key, display_name, is_fictional) values ($1,$2,$3,$4,true)`, [cid, uid, r.key, name]);
      if (r.app === 'worker' && !workerUserId) workerUserId = uid;
    }
  }
  await q.query(`update rigo.companies set settings = settings || $2::jsonb where id = $1`, [cid, JSON.stringify({ demo: { simRole: 'owner', workerUserId, sample: false } })]);
  return cid;
}

demoPublic.post('/demo', async (c) => {
  const user = requireUser(c);
  const input = await body(c, z.object({ templateKey: z.string().max(40).default('field_service') }));
  const db = await getDb();
  const id = await db.tx((q) => createDemo(q, user.id, input.templateKey));
  return c.json({ id });
});

demoRoutes.post('/demo/sample', async (c) => {
  const cc = c.get('cc');
  if (!cc.isDemo) throw forbidden('Sample data is only for demos. A real workspace starts empty and stays yours.');
  if (cc.simulatedRole) throw badRequest('Switch back to the Owner view to add sample data.');
  if (cc.company.settings?.demo?.sample) return c.json({ ok: true, already: true });
  await cc.db.tx(async (q) => {
    await fillSampleData(q, cc);
    await q.query(`update rigo.companies set settings = jsonb_set(settings, '{demo,sample}', 'true'::jsonb) where id = $1`, [cc.company.id]);
    await audit(q, cc, 'demo.sample_data', {});
  });
  return c.json({ ok: true });
});

/** See the demo as another role (only inside a person's own demo). */
demoRoutes.post('/demo/view', async (c) => {
  const cc = c.get('cc');
  if (!cc.isDemo) throw forbidden('Switching views is only for demos.');
  const input = await body(c, z.object({ role: z.string().max(40) }));
  const ok = input.role === 'owner' || (await cc.db.query(`select 1 from rigo.roles where company_id = $1 and key = $2 and not is_owner`, [cc.company.id, input.role])).rows.length > 0;
  if (!ok) throw badRequest('Choose a role from this demo.');
  await cc.db.query(`update rigo.companies set settings = jsonb_set(settings, '{demo,simRole}', to_jsonb($2::text)) where id = $1`, [cc.company.id, input.role]);
  return c.json({ ok: true });
});
