// Milestone A through the real server code and real database rules (local PostgreSQL).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const localdb = require('./support/localdb.cjs');
const { createFakeSupabase } = require('./support/fake-supabase.cjs');
const { createServer } = require('../lib/server.cjs');
const domain = require('../lib/domain.cjs');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const people = {
  owner: { id: id(1), email: 'rigomoncada714@gmail.com' },
  admin: { id: id(2), email: 'moncadarigo7@gmail.com' },
  driver: { id: id(3), email: 'luis@example.com' },
  newbie: { id: id(4), email: 'new@example.com' },
  outsider: { id: id(5), email: 'outsider@example.com' },
  unverified: { id: id(6), email: 'pending@example.com', unverified: true }
};
const LIVE = id(100);
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', RIGO_APP_URL: 'https://rigo.example', MAPBOX_TOKEN: 'pk.test' };

test('milestone A: accounts, companies, invitations and isolation', { skip: !localdb.available && 'local PostgreSQL not available' }, async t => {
  const db = localdb.start();
  t.after(() => db.stop());
  db.file(path.join(__dirname, '../supabase/schema.sql'));
  const users = Object.fromEntries(Object.entries(people).map(([k, p]) => [k, { id: p.id, email: p.email, email_confirmed_at: p.unverified ? null : '2026-10-05' }]));
  db.sql(`insert into auth.users values ${Object.values(people).map(p => `('${p.id}','${p.email}')`).join(',')}`);
  // The live company as it exists today, before the migration.
  let live = domain.createState('370 Enviro LLC');
  live = domain.applyAction(live, { type: 'record', listId: 'clients', values: { code: 'C-1', name: 'Hartley Construction' } }, 'Owner');
  live.id = LIVE;
  live.members = [{ email: people.admin.email, role: 'Administrator', invitation: { status: 'active', userId: people.admin.id, via: 'request' } }];
  const liveJson = JSON.stringify(live).replace(/'/g, "''");
  db.sql(`insert into public.rigo_workspaces (id, owner_id, state, version) values ('${LIVE}', '${people.owner.id}', '${liveJson}', 60)`);
  const fingerprint = () => db.sql(`select md5(state::text) || ':' || version || ':' || md5(audit::text) from public.rigo_workspaces where id = '${LIVE}'`);
  const before = fingerprint();
  db.file(path.join(__dirname, '../supabase/migrations/20261005120000_companies.sql'));
  assert.equal(fingerprint(), before, 'migration leaves the live company unchanged');

  const fake = createFakeSupabase(db, users);
  let nowMs = Date.now(); // the database stamps rows with its own clock, so start from real time
  const server = createServer({ env, fetchImpl: fake.fetchImpl, now: () => nowMs });
  const call = (who, route, { method = 'GET', body, query = {} } = {}) =>
    server.run({ method, headers: { authorization: 'Bearer ' + who }, query: { route, ...query }, body });
  const post = (who, route, body) => call(who, route, { method: 'POST', body });
  const list = who => call(who, 'workspaces');
  const open = (who, ws) => call(who, 'workspaces', { query: { id: ws } });
  let seq = 0;
  const act = async (who, ws, action) => {
    const data = await open(who, ws);
    return post(who, 'workspaces', { id: ws, version: data.version, requestId: 'r' + (++seq), action });
  };
  const denied = (promise, status = 403) => assert.rejects(promise, e => e.status === status);

  await t.test('existing company keeps its owner, administrator, data and settings', async () => {
    const own = await list('owner');
    assert.deepEqual(own.workspaces, [{ id: LIVE, name: '370 Enviro LLC', role: 'Owner' }]);
    assert.deepEqual((await list('admin')).workspaces.map(w => w.role), ['Administrator']);
    const data = await open('owner', LIVE);
    assert.equal(data.version, 60);
    assert.equal(data.state.lists.find(l => l.id === 'clients').rows[0].values.name, 'Hartley Construction');
    assert.equal(fingerprint(), before, 'reading does not modify the company');
  });

  await t.test('a new account has no access to any existing company', async () => {
    const mine = await list('newbie');
    assert.deepEqual(mine.workspaces, []);
    assert.deepEqual(mine.invitations, []);
    await denied(open('newbie', LIVE));
    await denied(post('newbie', 'workspaces', { id: LIVE, version: 60, requestId: 'x', action: { type: 'record', listId: 'clients', values: { code: 'X', name: 'X' } } }));
    await denied(post('newbie', 'photos', { workspace: LIVE, job: 'j', data: 'data:image/png;base64,AA==' }));
    await denied(post('newbie', 'leave', { workspace: LIVE }));
    await denied(call('newbie', 'workspaces', { query: { id: id(999) } }), 403); // unknown id: same answer
    await denied(call('newbie', 'workspaces', { query: { id: 'not-an-id' } }), 400);
    await denied(call('unverified', 'workspaces'), 403);
    await denied(post('unverified', 'companies', { name: 'Sneaky', requestId: 'create-unverified' }));
  });

  let acme, acme2;
  await t.test('creating a company makes the creator its owner; retries do not duplicate', async () => {
    acme = (await post('newbie', 'companies', { name: 'Acme Septic', requestId: 'create-0001' })).id;
    assert.equal((await post('newbie', 'companies', { name: 'Acme Septic', requestId: 'create-0001' })).id, acme);
    acme2 = (await post('newbie', 'companies', { name: 'Acme Septic', requestId: 'create-0002' })).id;
    assert.notEqual(acme2, acme, 'similar names are allowed');
    const mine = await list('newbie');
    assert.deepEqual(mine.workspaces.map(w => [w.name, w.role]), [['Acme Septic', 'Owner'], ['Acme Septic', 'Owner']]);
    const data = await open('newbie', acme);
    assert.equal(data.state.name, 'Acme Septic');
    assert.equal(data.state.id, acme);
    assert.equal(data.state.jobs.length, 0);
    assert.ok(data.state.lists.every(l => l.rows.length === 0), 'no fictional or copied records');
    assert.equal(data.state.demo, false);
    assert.deepEqual(data.state.integrations, { geocoding: false }, 'paid services start off');
    assert.deepEqual(data.state.members.map(m => [m.email, m.role]), [['new@example.com', 'Owner']]);
    assert.equal(fingerprint(), before, 'other companies are untouched');
    await denied(post('newbie', 'companies', { name: '   ', requestId: 'create-0003' }), 400);
  });

  await t.test('invitations: email, acceptance, distinct roles, repeat and wrong recipient', async () => {
    await act('owner', LIVE, { type: 'member', email: 'Luis@Example.com', role: 'Field employee' });
    assert.equal(fake.mails.at(-1).email, 'luis@example.com');
    assert.equal(fake.mails.at(-1).redirect, 'https://rigo.example/?invite=1');
    const shown = (await open('owner', LIVE)).state.members.find(m => m.email === 'luis@example.com');
    assert.equal(shown.invitation.status, 'sent');
    // Only the invited, verified email sees and can accept it.
    assert.deepEqual((await list('outsider')).invitations, []);
    const [invite] = (await list('driver')).invitations;
    assert.deepEqual([invite.company, invite.role], ['370 Enviro LLC', 'Field employee']);
    await assert.rejects(post('outsider', 'invitations', { id: invite.id, op: 'accept' }), e => e.status === 404);
    assert.deepEqual(await post('driver', 'invitations', { id: invite.id, op: 'accept' }), { status: 'accepted', workspace: LIVE });
    assert.equal((await post('driver', 'invitations', { id: invite.id, op: 'accept' })).status, 'accepted', 'repeat acceptance changes nothing');
    assert.equal((await open('driver', LIVE)).role, 'Field employee');
    // The same person can have a different role in another company.
    await act('newbie', acme, { type: 'member', email: 'luis@example.com', role: 'Dispatcher' });
    const [second] = (await list('driver')).invitations;
    await post('driver', 'invitations', { id: second.id, op: 'accept' });
    assert.deepEqual((await list('driver')).workspaces.map(w => [w.name, w.role]), [['370 Enviro LLC', 'Field employee'], ['Acme Septic', 'Dispatcher']]);
    // Resending is rate limited.
    await act('owner', LIVE, { type: 'member', email: 'outsider@example.com', role: 'Viewer' });
    await assert.rejects(act('owner', LIVE, { type: 'member', email: 'outsider@example.com', role: 'Viewer' }), e => e.status === 429);
  });

  await t.test('revoked and expired invitations cannot be accepted; failed email grants nothing', async () => {
    const [pending] = (await list('outsider')).invitations;
    await act('owner', LIVE, { type: 'member', email: 'outsider@example.com', role: 'Viewer', remove: true });
    assert.equal((await post('outsider', 'invitations', { id: pending.id, op: 'accept' })).status, 'revoked');
    nowMs += 120000;
    await act('owner', LIVE, { type: 'member', email: 'outsider@example.com', role: 'Viewer' });
    const [fresh] = (await list('outsider')).invitations;
    db.sql(`update public.rigo_invitations set expires_at = now() - interval '1 minute' where id = '${fresh.id}'`);
    assert.deepEqual((await list('outsider')).invitations, [], 'expired invitations are not offered');
    assert.equal((await post('outsider', 'invitations', { id: fresh.id, op: 'accept' })).status, 'expired');
    assert.deepEqual((await list('outsider')).workspaces, []);
    nowMs += 120000;
    users.__mailFails = true;
    await assert.rejects(act('owner', LIVE, { type: 'member', email: 'outsider@example.com', role: 'Viewer' }), e => e.status === 502);
    users.__mailFails = false;
    assert.equal(db.sql(`select count(*) from public.rigo_invitations where email = 'outsider@example.com' and status = 'pending'`), '0');
  });

  await t.test('administrators cannot grant ownership; multiple owners; last owner protected', async () => {
    await assert.rejects(act('admin', LIVE, { type: 'member', email: 'outsider@example.com', role: 'Owner' }), e => e.status === 403);
    await assert.rejects(act('admin', LIVE, { type: 'member', email: people.owner.email, role: 'Viewer' }), e => e.status === 403);
    await assert.rejects(post('owner', 'leave', { workspace: LIVE }), e => e.status === 409 && /at least one owner/.test(e.message));
    await assert.rejects(act('owner', LIVE, { type: 'member', email: people.owner.email, role: 'Administrator' }), e => e.status === 409);
    // Promote the administrator to a second owner; now either may leave, not both.
    await act('owner', LIVE, { type: 'member', email: people.admin.email, role: 'Owner' });
    assert.equal((await open('admin', LIVE)).role, 'Owner');
    const owners = (await open('owner', LIVE)).state.members.filter(m => m.role === 'Owner').map(m => m.email).sort();
    assert.deepEqual(owners, [people.owner.email, people.admin.email].sort());
    await act('owner', LIVE, { type: 'member', email: people.admin.email, role: 'Administrator' });
  });

  await t.test('removal revokes that company only and keeps history', async () => {
    const auditBefore = JSON.parse(db.sql(`select audit::text from public.rigo_workspaces where id = '${LIVE}'`)).length;
    await act('owner', LIVE, { type: 'member', email: people.driver.email, role: 'Field employee', remove: true });
    await denied(open('driver', LIVE));
    await denied(act('driver', LIVE, { type: 'jobStatus', id: 'x', status: 'Done' }));
    assert.deepEqual((await list('driver')).workspaces.map(w => w.name), ['Acme Septic'], 'other companies remain');
    const audit = JSON.parse(db.sql(`select audit::text from public.rigo_workspaces where id = '${LIVE}'`));
    assert.ok(audit.length > auditBefore && audit.some(a => a.action === 'memberRemoved'), 'removal is attributed in the audit log');
  });

  await t.test('cross-company requests and references fail', async () => {
    // newbie owns Acme but is not in the live company.
    await denied(post('newbie', 'workspaces', { id: LIVE, version: 1, requestId: 'cross-1', action: { type: 'configure', name: 'Hijack' } }));
    await denied(post('newbie', 'geocode', { workspace: LIVE, address: '1 Main St' }));
    // Outsiders only learn the status of their own access request, never the company's list.
    assert.deepEqual(await call('newbie', 'requests', { query: { workspace: LIVE } }), { status: 'none' });
    await denied(post('newbie', 'requests', { op: 'approve', workspace: LIVE, requestId: 'x' }));
    // A job in Acme cannot reference the live company's client by id.
    const liveClient = (await open('owner', LIVE)).state.lists.find(l => l.id === 'clients').rows[0].id;
    await act('newbie', acme, { type: 'applyTemplate', template: 'combined' });
    await act('newbie', acme, { type: 'record', listId: 'services', values: { code: 'S-1', name: 'Pump-out', unit: 'visit', rate: '300' } });
    const service = (await open('newbie', acme)).state.lists.find(l => l.id === 'services').rows[0].id;
    await assert.rejects(act('newbie', acme, { type: 'job', job: { title: 'X', clientId: liveClient, serviceId: service, quantity: 1, date: '2026-10-06' } }), e => e.status === 400 && /record unavailable/.test(e.message));
    // A write carries its own company id; there is no fallback to another company.
    await denied(post('newbie', 'workspaces', { version: 1, requestId: 'no-id', action: { type: 'configure', name: 'X' } }), 400);
  });

  await t.test('team linking stays inside its company', async () => {
    // Link a Team record to the administrator's login inside the live company.
    await act('owner', LIVE, { type: 'record', listId: 'employees', values: { code: 'T-1', name: 'Maria', role: 'Dispatcher' } });
    const team = (await open('owner', LIVE)).state.lists.find(l => l.id === 'employees').rows[0];
    await act('owner', LIVE, { type: 'linkAccount', id: team.id, email: people.admin.email });
    // The same email is not a member of Acme, so it cannot be linked there.
    await act('newbie', acme, { type: 'record', listId: 'employees', values: { code: 'T-1', name: 'Someone', role: 'Driver/Field' } });
    const acmeTeam = (await open('newbie', acme)).state.lists.find(l => l.id === 'employees').rows[0];
    await assert.rejects(act('newbie', acme, { type: 'linkAccount', id: acmeTeam.id, email: people.admin.email }), e => /existing authorized member/.test(e.message));
  });

  await t.test('a new company does not activate paid services', async () => {
    const before = fake.calls.length;
    await assert.rejects(post('newbie', 'geocode', { workspace: acme, address: '4410 Industrial Pkwy' }), e => e.status === 503);
    assert.ok(fake.calls.slice(before).every(c => c.host !== 'api.mapbox.com'), 'no call to the paid provider');
    // The existing company keeps the lookup it already had; it is not switched off silently.
    assert.equal((await post('owner', 'geocode', { workspace: LIVE, address: '1 Main St' })).label, 'Simulated place');
  });

  await t.test('a company can start from a reviewed structure; nothing else is copied', async () => {
    await denied(post('newbie', 'companies', { name: 'Bad', requestId: 'create-tpl-0', template: 'everything' }), 400);
    const { id: ws } = await post('newbie', 'companies', { name: 'Structured Co', requestId: 'create-tpl-1', template: 'combined', state: { jobs: [{ id: 'smuggled' }] } });
    const { state } = await open('newbie', ws);
    assert.equal(state.workflow.retired, false, 'the reviewed workflow is ready');
    assert.equal(state.workflow.autoInvoice, false, 'automatic actions stay off');
    assert.ok(state.lists.find(l => l.id === 'services').fields.some(f => f.id === 'fuelType'));
    assert.ok(state.lists.every(l => l.rows.length === 0), 'no records, rates or people');
    assert.deepEqual([state.jobs.length, state.invoices.length], [0, 0], 'client-sent data is ignored');
    assert.deepEqual(state.integrations, { geocoding: false });
  });

  await t.test('demo identifiers are not companies on the server', async () => {
    const paidBefore = fake.calls.filter(c => c.host === 'api.mapbox.com').length;
    for (const ws of ['demo-workspace', 'standalone-app']) {
      const refused = e => [400, 403].includes(e.status);
      await assert.rejects(post('newbie', 'workspaces', { id: ws, version: 1, requestId: 'demo-' + ws, action: { type: 'configure', name: 'x' } }), refused);
      await assert.rejects(post('newbie', 'geocode', { workspace: ws, address: '1 Main St' }), refused);
      await assert.rejects(open('newbie', ws), refused);
    }
    assert.equal(fake.calls.filter(c => c.host === 'api.mapbox.com').length, paidBefore, 'no paid lookup for a demo id');
  });

  await t.test('access requests are scoped to the company in the sign-up link', async () => {
    await denied(call('outsider', 'requests', { method: 'POST', body: { op: 'request' } }), 400);
    assert.equal((await post('outsider', 'requests', { op: 'request', workspace: acme, name: 'Out Sider' })).status, 'pending');
    assert.deepEqual((await list('outsider')).workspaces, [], 'a request grants nothing');
    const { requests, signupUrl } = await call('newbie', 'requests', { query: { workspace: acme } });
    assert.equal(signupUrl, `https://rigo.example/?signup=1&join=${acme}`);
    await post('newbie', 'requests', { op: 'approve', workspace: acme, requestId: requests[0].id, role: 'Viewer' });
    assert.deepEqual((await list('outsider')).workspaces.map(w => [w.name, w.role]), [['Acme Septic', 'Viewer']]);
  });

  await t.test('the live company is still intact at the end', async () => {
    const data = await open('owner', LIVE);
    assert.equal(data.state.name, '370 Enviro LLC');
    assert.equal(data.state.lists.find(l => l.id === 'clients').rows.length, 1);
    assert.equal(db.sql(`select count(*) from public.rigo_workspaces`), '4');
  });
});
