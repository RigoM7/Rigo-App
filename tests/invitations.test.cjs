const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer, visibleState } = require('../lib/server.cjs');
const domain = require('../lib/domain.cjs');
const ownerId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const employeeId = '33333333-3333-4333-8333-333333333333';
const environment = {
  SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'public-key',
  SUPABASE_SERVICE_ROLE_KEY: 'server-key', RIGO_OWNER_USER_ID: ownerId, RIGO_APP_URL: 'https://rigo.example'
};
const owner = { id: ownerId, email: 'owner@example.com', email_confirmed_at: '2026-10-05' };
const employee = { id: employeeId, email: 'employee@gmail.com', email_confirmed_at: '2026-10-05' };
function harness({ mailFailure = false, existingUser = false, revokeDuringSend = false } = {}) {
  let row = { id: workspaceId, owner_id: ownerId, state: domain.createState(), version: 1, audit: [], receipts: {} };
  row.state.id = workspaceId;
  const mails = [];
  const fetchImpl = async (url, options) => {
    const path = new URL(url);
    const body = options.body ? JSON.parse(options.body) : null;
    if (path.pathname === '/auth/v1/user') return Response.json(options.headers.Authorization === 'Bearer owner' ? owner : options.headers.Authorization === 'Bearer employee' ? employee : { message: 'invalid' }, { status: ['Bearer owner', 'Bearer employee'].includes(options.headers.Authorization) ? 200 : 401 });
    if (path.pathname === '/auth/v1/invite' || path.pathname === '/auth/v1/otp') {
      mails.push({ path: path.pathname, redirect: path.searchParams.get('redirect_to'), body });
      if (mailFailure) return Response.json({ message: 'Mail failed' }, { status: 500 });
      if (existingUser && path.pathname.endsWith('invite')) return Response.json({ error_code: 'email_exists', msg: 'Already exists' }, { status: 422 });
      if (revokeDuringSend) { row.state.members = []; row.version++; }
      return Response.json({ id: employeeId });
    }
    assert.equal(path.pathname, '/rest/v1/rigo_workspaces');
    assert.equal(options.headers.apikey, 'server-key');
    if (options.method === 'GET') return Response.json([row]);
    if (options.method === 'PATCH') {
      if (path.searchParams.get('version') !== 'eq.' + row.version) return Response.json([]);
      row = { ...row, ...body }; return Response.json([row]);
    }
    if (options.method === 'POST') { row = body; return Response.json([row]); }
    throw new Error('Unexpected request');
  };
  const server = createServer({ env: environment, fetchImpl });
  const req = (token = 'owner', method = 'GET', body, query = {}) => ({ method, headers: { authorization: 'Bearer ' + token }, query: { route: 'workspaces', ...query }, body });
  const invite = (email = 'Employee@Gmail.com', role = 'Field employee', requestId = 'invite-1') => server.run(req('owner', 'POST', { id: workspaceId, version: row.version, requestId, action: { type: 'member', email, role } }));
  return { server, req, invite, mails, get row() { return row; } };
}
test('unconfigured app reports disabled without exposing secret configuration', async () => {
  const server = createServer({ env: {} });
  assert.deepEqual(await server.run({ query: { route: 'config' } }), { configured: false });
  await assert.rejects(server.run({ query: { route: 'workspaces' } }), e => e.status === 503);
});
test('owner invites any valid provider, employee accepts, and duplicate request sends once', async () => {
  const h = harness();
  assert.equal((await h.invite()).invitationSent, true);
  assert.equal(h.mails[0].body.email, 'employee@gmail.com');
  assert.equal(h.mails[0].redirect, 'https://rigo.example/?invite=1');
  assert.equal(h.row.state.members[0].invitation.status, 'sent');
  await h.server.run(h.req('owner', 'POST', { id: workspaceId, requestId: 'invite-1', action: { type: 'member', email: 'Employee@Gmail.com', role: 'Field employee' } }));
  assert.equal(h.mails.length, 1);
  const data = await h.server.run(h.req('employee', 'GET', undefined, { id: workspaceId }));
  assert.equal(data.role, 'Field employee');
  assert.equal(h.row.state.members[0].invitation.status, 'active');
  assert.equal(data.state.members.length, 0);
});
test('existing user receives login link', async () => {
  const h = harness({ existingUser: true }); await h.invite();
  assert.equal(h.mails[1].path, '/auth/v1/otp');
  assert.equal(h.mails[1].body.create_user, false);
});
test('email failure never grants access or reports success', async () => {
  const h = harness({ mailFailure: true });
  await assert.rejects(h.invite(), e => e.status === 502);
  assert.equal(h.row.state.members[0].invitation.status, 'failed');
  const listing = await h.server.run(h.req('employee'));
  assert.equal(listing.workspaces.length, 0);
});
test('a removal while sending cannot be overwritten', async () => {
  const h = harness({ revokeDuringSend: true });
  await assert.rejects(h.invite(), e => e.status === 409);
  assert.equal(h.row.state.members.length, 0);
});
test('non-owner cannot invite; client role and actor cannot grant authority', async () => {
  const h = harness(); await h.invite('employee@gmail.com', 'Administrator');
  await assert.rejects(h.server.run(h.req('employee', 'POST', {
    id: workspaceId, version: h.row.version, requestId: 'attack', role: 'Owner',
    action: { type: 'member', email: 'third@example.net', role: 'Administrator', actor: owner.email }
  })), e => e.status === 403);
  assert.equal(h.mails.length, 1);
});
test('owner can revoke; existing session immediately loses workspace access', async () => {
  const h = harness(); await h.invite();
  await h.server.run(h.req('owner', 'POST', { id: workspaceId, version: h.row.version, requestId: 'remove', action: { type: 'member', email: employee.email, role: 'Field employee', remove: true } }));
  await assert.rejects(h.server.run(h.req('employee', 'GET', undefined, { id: workspaceId })), e => e.status === 403);
});
test('invalid email and role are rejected before sending', async () => {
  const h = harness();
  await assert.rejects(h.invite('not-email'), /valid employee email/);
  await assert.rejects(h.invite('employee@example.net', 'Owner'), /valid role/);
  assert.equal(h.mails.length, 0);
});
test('resending has a per-email cooldown', async () => {
  const h = harness(); await h.invite();
  await assert.rejects(h.invite('employee@gmail.com', 'Field employee', 'again'), e => e.status === 429);
  assert.equal(h.mails.length, 1);
});
test('unauthenticated users cannot read data', async () => {
  const h = harness();
  await assert.rejects(h.server.run(h.req('invalid')), e => e.status === 401);
});
test('field employee gets only assigned context and cannot change another job', async () => {
  const h = harness(); await h.invite();
  h.row.state.lists.find(l => l.id === 'employees').rows.push({ id: 'team-1', values: { code: 'T1', name: 'Employee' }, accountEmail: employee.email });
  h.row.state.jobs.push({ id: 'own-job', employeeId: 'team-1', clientId: 'own-client' }, { id: 'other-job', employeeId: 'team-2', clientId: 'other-client' });
  h.row.state.lists.find(l => l.id === 'clients').rows.push({ id: 'own-client' }, { id: 'other-client' });
  h.row.state.invoices.push({ id: 'private-invoice' });
  const out = visibleState(h.row.state, 'Field employee', employee.email);
  assert.deepEqual(out.jobs.map(j => j.id), ['own-job']);
  assert.deepEqual(out.lists.find(l => l.id === 'clients').rows.map(r => r.id), ['own-client']);
  assert.deepEqual(out.invoices, []);
  await assert.rejects(h.server.run(h.req('employee', 'POST', { id: workspaceId, version: h.row.version, requestId: 'other-job-edit', action: { type: 'jobStatus', id: 'other-job', status: 'Done' } })), e => e.status === 403);
});
test('viewer cannot write and stale saves are rejected', async () => {
  const h = harness(); await h.invite('employee@gmail.com', 'Viewer');
  await assert.rejects(h.server.run(h.req('employee', 'POST', { id: workspaceId, version: h.row.version, requestId: 'viewer-edit', action: { type: 'configure', name: 'Changed' } })), /read-only/);
  await assert.rejects(h.server.run(h.req('owner', 'POST', { id: workspaceId, version: 0, requestId: 'old-save', action: { type: 'configure', name: 'Changed' } })), e => e.status === 409);
});
