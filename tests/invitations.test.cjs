// Invitations, roles, access requests and write checks through the real server code and the
// real database rules (local PostgreSQL). Each subtest works in its own fresh company.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const localdb = require('./support/localdb.cjs');
const { createFakeSupabase } = require('./support/fake-supabase.cjs');
const { createServer, visibleState } = require('../lib/server.cjs');
const domain = require('../lib/domain.cjs');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const people = {
  owner: { id: id(11), email: 'owner@example.com' },
  employee: { id: id(12), email: 'employee@gmail.com' },
  third: { id: id(13), email: 'third@example.net' }
};
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', RIGO_APP_URL: 'https://rigo.example' };

test('unconfigured app reports disabled without exposing secret configuration', async () => {
  const server = createServer({ env: {} });
  assert.deepEqual(await server.run({ query: { route: 'config' } }), { configured: false });
  await assert.rejects(server.run({ query: { route: 'workspaces' } }), e => e.status === 503);
});

test('field employees only see their assigned work', () => {
  const state = domain.createState();
  state.lists.find(l => l.id === 'employees').rows.push({ id: 'team-1', values: { code: 'T1', name: 'Employee' }, accountEmail: people.employee.email });
  state.jobs.push({ id: 'own-job', employeeId: 'team-1', clientId: 'own-client' }, { id: 'other-job', employeeId: 'team-2', clientId: 'other-client' });
  state.lists.find(l => l.id === 'clients').rows.push({ id: 'own-client' }, { id: 'other-client' });
  state.invoices.push({ id: 'private-invoice' });
  const out = visibleState(state, 'Field employee', people.employee.email);
  assert.deepEqual(out.jobs.map(j => j.id), ['own-job']);
  assert.deepEqual(out.lists.find(l => l.id === 'clients').rows.map(r => r.id), ['own-client']);
  assert.deepEqual(out.invoices, []);
});

test('invitations and access requests', { skip: !localdb.available && 'local PostgreSQL not available' }, async t => {
  const db = localdb.start();
  t.after(() => db.stop());
  db.file(path.join(__dirname, '../supabase/schema.sql'));
  db.file(path.join(__dirname, '../supabase/migrations/20261005120000_companies.sql'));
  db.sql(`insert into auth.users values ${Object.values(people).map(p => `('${p.id}','${p.email}')`).join(',')}`);
  const users = Object.fromEntries(Object.entries(people).map(([k, p]) => [k, { id: p.id, email: p.email, email_confirmed_at: '2026-10-05' }]));
  const fake = createFakeSupabase(db, users);
  const server = createServer({ env, fetchImpl: fake.fetchImpl });
  const call = (who, route, { method = 'GET', body, query = {} } = {}) =>
    server.run({ method, headers: { authorization: 'Bearer ' + who }, query: { route, ...query }, body });
  const post = (who, route, body) => call(who, route, { method: 'POST', body });
  const open = (who, ws) => call(who, 'workspaces', { query: { id: ws } });
  let seq = 0;
  const act = async (who, ws, action, extra = {}) => {
    const data = await open(who, ws);
    return post(who, 'workspaces', { id: ws, version: data.version, requestId: 'r' + (++seq), action, ...extra });
  };
  // A fresh company owned by "owner", with no other members.
  const company = async () => {
    return (await post('owner', 'companies', { name: 'Company ' + (++seq), requestId: 'company-' + seq })).id;
  };
  const accept = async (who, ws) => {
    const name = (await open('owner', ws)).state.name;
    const invite = (await call(who, 'workspaces')).invitations.find(i => i.company === name);
    return post(who, 'invitations', { id: invite.id, op: 'accept' });
  };
  const ask = (who, method, body, query = {}) => call(who, 'requests', { method, body, query });

  await t.test('owner invites, employee accepts, and a repeated request sends once', async () => {
    const ws = await company();
    const body = { id: ws, version: (await open('owner', ws)).version, requestId: 'invite-once', action: { type: 'member', email: 'Employee@Gmail.com', role: 'Field employee' } };
    await post('owner', 'workspaces', body);
    const mails = fake.mails.length;
    await post('owner', 'workspaces', body);
    assert.equal(fake.mails.length, mails, 'a retried request does not send again');
    assert.equal(fake.mails.at(-1).email, 'employee@gmail.com');
    assert.equal(fake.mails.at(-1).redirect, 'https://rigo.example/?invite=1');
    assert.equal((await accept('employee', ws)).status, 'accepted');
    const data = await open('employee', ws);
    assert.equal(data.role, 'Field employee');
    assert.equal(data.state.members.length, 0, 'field employees do not see the member list');
  });

  await t.test('existing user receives a login link instead of a sign-up invite', async () => {
    const ws = await company();
    await act('owner', ws, { type: 'member', email: people.third.email, role: 'Viewer' });
    assert.deepEqual(fake.mails.slice(-2).map(m => m.path), ['/auth/v1/invite', '/auth/v1/otp']);
  });

  await t.test('non-managers cannot invite; client-sent role and actor grant nothing', async () => {
    const ws = await company();
    await act('owner', ws, { type: 'member', email: people.employee.email, role: 'Dispatcher' });
    await accept('employee', ws);
    const mails = fake.mails.length;
    await assert.rejects(act('employee', ws, { type: 'member', email: people.third.email, role: 'Administrator', actor: people.owner.email }, { role: 'Owner' }), e => e.status === 403);
    assert.equal(fake.mails.length, mails);
    assert.equal(db.sql(`select count(*) from public.rigo_invitations where workspace_id = '${ws}' and email = '${people.third.email}'`), '0');
  });

  await t.test('owner removal takes effect immediately for an open session', async () => {
    const ws = await company();
    await act('owner', ws, { type: 'member', email: people.employee.email, role: 'Field employee' });
    await accept('employee', ws);
    await open('employee', ws);
    await act('owner', ws, { type: 'member', email: people.employee.email, role: 'Field employee', remove: true });
    await assert.rejects(open('employee', ws), e => e.status === 403);
  });

  await t.test('invalid email and role are rejected before sending', async () => {
    const ws = await company();
    const mails = fake.mails.length;
    await assert.rejects(act('owner', ws, { type: 'member', email: 'not-email', role: 'Viewer' }), /valid email/);
    await assert.rejects(act('owner', ws, { type: 'member', email: 'employee@example.net', role: 'Superuser' }), /valid role/);
    assert.equal(fake.mails.length, mails);
  });

  await t.test('resending has a per-email cooldown', async () => {
    const ws = await company();
    await act('owner', ws, { type: 'member', email: people.employee.email, role: 'Viewer' });
    const mails = fake.mails.length;
    await assert.rejects(act('owner', ws, { type: 'member', email: people.employee.email, role: 'Viewer' }), e => e.status === 429);
    assert.equal(fake.mails.length, mails);
  });

  await t.test('unauthenticated users cannot read data', async () => {
    await assert.rejects(call('invalid', 'workspaces'), e => e.status === 401);
  });

  await t.test('field employees cannot change another job; viewers cannot write; stale saves fail', async () => {
    const ws = await company();
    await act('owner', ws, { type: 'member', email: people.employee.email, role: 'Field employee' });
    await accept('employee', ws);
    await assert.rejects(act('employee', ws, { type: 'jobStatus', id: 'other-job', status: 'Done' }), e => e.status === 403);
    await act('owner', ws, { type: 'member', email: people.employee.email, role: 'Viewer' });
    await assert.rejects(act('employee', ws, { type: 'configure', name: 'Changed' }), /read-only/);
    await assert.rejects(post('owner', 'workspaces', { id: ws, version: 0, requestId: 'old-save', action: { type: 'configure', name: 'Changed' } }), e => e.status === 409);
  });

  await t.test('employee signs up, requests access, and an owner approves with a role', async () => {
    const ws = await company();
    assert.equal((await ask('employee', 'GET', undefined, { workspace: ws })).status, 'none');
    assert.equal((await ask('employee', 'POST', { op: 'request', workspace: ws, name: 'Sam Field' })).status, 'pending');
    assert.equal((await ask('employee', 'POST', { op: 'request', workspace: ws, name: 'Sam Field' })).status, 'pending');
    const { requests, signupUrl } = await ask('owner', 'GET', undefined, { workspace: ws });
    assert.equal(signupUrl, `https://rigo.example/?signup=1&join=${ws}`);
    assert.deepEqual(requests.map(r => r.name), ['Sam Field']);
    await assert.rejects(ask('employee', 'POST', { op: 'approve', workspace: ws, requestId: requests[0].id, role: 'Administrator' }), e => e.status === 403);
    await assert.rejects(ask('owner', 'POST', { op: 'approve', workspace: ws, requestId: requests[0].id, role: 'Superuser' }), /valid role/);
    const mails = fake.mails.length;
    await ask('owner', 'POST', { op: 'approve', workspace: ws, requestId: requests[0].id, role: 'Dispatcher' });
    assert.equal(fake.mails.length, mails);
    assert.equal((await ask('owner', 'GET', undefined, { workspace: ws })).requests.length, 0);
    const data = await open('employee', ws);
    assert.equal(data.role, 'Dispatcher');
    assert.deepEqual(data.state.accessRequests, []);
    const audit = JSON.parse(db.sql(`select audit::text from public.rigo_workspaces where id = '${ws}'`));
    assert.ok(audit.some(a => a.action === 'accessApproved'));
  });

  await t.test('declined or removed employees cannot re-request themselves into access', async () => {
    const ws = await company();
    await ask('third', 'POST', { op: 'request', workspace: ws });
    const [declined] = (await ask('owner', 'GET', undefined, { workspace: ws })).requests;
    await ask('owner', 'POST', { op: 'decline', workspace: ws, requestId: declined.id });
    assert.equal((await ask('third', 'POST', { op: 'request', workspace: ws })).status, 'declined');
    await assert.rejects(ask('owner', 'POST', { op: 'approve', workspace: ws, requestId: declined.id, role: 'Viewer' }), e => e.status === 404);
    await assert.rejects(open('third', ws), e => e.status === 403);

    const other = await company();
    await ask('employee', 'POST', { op: 'request', workspace: other });
    const [request] = (await ask('owner', 'GET', undefined, { workspace: other })).requests;
    await ask('owner', 'POST', { op: 'approve', workspace: other, requestId: request.id, role: 'Viewer' });
    await act('owner', other, { type: 'member', email: people.employee.email, role: 'Viewer', remove: true });
    assert.equal((await ask('employee', 'POST', { op: 'request', workspace: other })).status, 'removed');
    await assert.rejects(open('employee', other), e => e.status === 403);
  });
});
