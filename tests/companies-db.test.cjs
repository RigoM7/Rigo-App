// Milestone A database rules, run against a throwaway local PostgreSQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const localdb = require('./support/localdb.cjs');

const MIGRATION = path.join(__dirname, '../supabase/migrations/20261005120000_companies.sql');
const SCHEMA = path.join(__dirname, '../supabase/schema.sql');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = id(1), ADMIN1 = id(2), ADMIN2 = id(3), STRANGER = id(4), NEWBIE = id(5), OWNER2 = id(6);
const WS = id(100);

test('companies, memberships and invitations', { skip: !localdb.available && 'local PostgreSQL not available' }, async t => {
  const db = localdb.start();
  t.after(() => db.stop());
  const q = s => db.sql(s);
  const fails = (s, code) => assert.throws(() => q(s), e => String(e.stderr || e.message).includes('rigo:' + code), 'expected rigo:' + code);

  // Today's production shape: one workspace, owner_id unique, members kept in JSON.
  db.file(SCHEMA);
  q(`insert into auth.users values ('${OWNER}','rigomoncada714@gmail.com'),('${ADMIN1}','moncadarigo7@gmail.com'),('${ADMIN2}','irene_7o@yahoo.com'),('${STRANGER}','someone@example.com'),('${NEWBIE}','new@example.com'),('${OWNER2}','partner@example.com')`);
  const legacyState = JSON.stringify({ id: WS, name: '370 Enviro LLC', jobs: [{ id: 'j1' }], members: [
    { email: 'moncadarigo7@gmail.com', role: 'Administrator', invitation: { status: 'active', userId: ADMIN1, via: 'request' } },
    { email: 'irene_7o@yahoo.com', role: 'Administrator', invitation: { status: 'active', userId: ADMIN2, via: 'request' } },
    { email: 'pending@example.com', role: 'Dispatcher', invitation: { status: 'sent' } },
    { email: 'someone@example.com', role: 'Viewer', invitation: { status: 'active', userId: ADMIN1 } } // user id does not match the email
  ] }).replace(/'/g, "''");
  q(`insert into public.rigo_workspaces (id, owner_id, state, version) values ('${WS}','${OWNER}','${legacyState}', 60)`);
  const before = q(`select md5(state::text) || ':' || version from public.rigo_workspaces`);

  await t.test('migration is additive and maps only evidenced memberships', () => {
    db.file(MIGRATION);
    db.file(MIGRATION); // safe to re-run
    assert.equal(q(`select md5(state::text) || ':' || version from public.rigo_workspaces`), before, 'workspace data untouched');
    assert.equal(q(`select string_agg(email || '=' || role, ',' order by email) from public.rigo_memberships`),
      'irene_7o@yahoo.com=Administrator,moncadarigo7@gmail.com=Administrator,rigomoncada714@gmail.com=Owner');
    assert.equal(q(`select string_agg(email || '=' || role || '=' || status, ',') from public.rigo_invitations`), 'pending@example.com=Dispatcher=pending');
    assert.equal(q(`select count(*) from public.rigo_memberships where role = 'Owner'`), '1', 'administrators are not promoted');
  });

  let A, A2, B;
  await t.test('company creation is atomic, owner-first, and retry-safe', () => {
    const state = JSON.stringify({ name: 'x', lists: [], jobs: [], members: [] });
    A = q(`select public.rigo_create_company('${NEWBIE}','New@Example.com','req-1','Acme Septic','${state}')`);
    assert.equal(q(`select public.rigo_create_company('${NEWBIE}','new@example.com','req-1','Acme Septic','${state}')`), A, 'retry returns the same company');
    A2 = q(`select public.rigo_create_company('${NEWBIE}','new@example.com','req-2','Acme Septic','${state}')`);
    assert.notEqual(A2, A, 'a second request with the same name is a second company');
    assert.equal(q(`select state->>'id' || '|' || (state->>'name') from public.rigo_workspaces where id='${A}'`), `${A}|Acme Septic`);
    assert.equal(q(`select role || ':' || email from public.rigo_memberships where workspace_id='${A}'`), 'Owner:new@example.com');
    assert.equal(q(`select count(*) from public.rigo_memberships where user_id='${NEWBIE}'`), '2');
    B = q(`select public.rigo_create_company('${OWNER}','rigomoncada714@gmail.com','req-1','Second company','${state}')`);
    assert.equal(q(`select count(*) from public.rigo_workspaces where owner_id='${OWNER}'`), '2', 'one account can own several companies');
    fails(`select public.rigo_create_company('${NEWBIE}','new@example.com','req-3','  ','${state}')`, 'name_required');
    // A failure part-way leaves nothing behind (the whole function is one transaction).
    assert.throws(() => q(`select public.rigo_create_company('${NEWBIE}','new@example.com','req-4','Broken','not json')`));
    assert.equal(q(`select count(*) from public.rigo_company_requests where request_id='req-4'`), '0');
  });

  await t.test('invitations: recipient, expiry, revoke, repeat and authority', () => {
    // Administrators cannot grant ownership or administration; owners can.
    fails(`select public.rigo_invite('${WS}','${ADMIN1}','x@example.com','Owner',7)`, 'not_allowed');
    fails(`select public.rigo_invite('${WS}','${ADMIN1}','x@example.com','Administrator',7)`, 'not_allowed');
    fails(`select public.rigo_invite('${WS}','${STRANGER}','x@example.com','Viewer',7)`, 'not_member');
    fails(`select public.rigo_invite('${WS}','${OWNER}','irene_7o@yahoo.com','Viewer',7)`, 'already_member');
    const inv = q(`select public.rigo_invite('${WS}','${ADMIN1}','New@example.com','Field employee',7)`);
    fails(`select public.rigo_answer_invitation('${inv}','${STRANGER}','someone@example.com',true)`, 'not_found');
    // Resend replaces the old invitation; the old one can no longer be accepted.
    const resent = q(`select public.rigo_invite('${WS}','${OWNER}','new@example.com','Dispatcher',7)`);
    assert.equal(q(`select public.rigo_answer_invitation('${inv}','${NEWBIE}','new@example.com',true)`), 'revoked');
    assert.equal(q(`select public.rigo_answer_invitation('${resent}','${NEWBIE}','new@example.com',true)`), 'accepted');
    assert.equal(q(`select role from public.rigo_memberships where workspace_id='${WS}' and user_id='${NEWBIE}'`), 'Dispatcher');
    assert.equal(q(`select public.rigo_answer_invitation('${resent}','${NEWBIE}','new@example.com',true)`), 'accepted', 'repeat acceptance is a no-op');
    // Different roles in different companies.
    assert.equal(q(`select string_agg(role, ',' order by role) from public.rigo_memberships where user_id='${NEWBIE}' and status='active'`), 'Dispatcher,Owner,Owner');
    // Expired invitations cannot be accepted.
    const old = q(`select public.rigo_invite('${WS}','${OWNER}','partner@example.com','Viewer',7)`);
    q(`update public.rigo_invitations set expires_at = now() - interval '1 minute' where id='${old}'`);
    assert.equal(q(`select public.rigo_answer_invitation('${old}','${OWNER2}','partner@example.com',true)`), 'expired');
    // Revoked invitations cannot be accepted.
    const rv = q(`select public.rigo_invite('${WS}','${OWNER}','partner@example.com','Viewer',7)`);
    fails(`select public.rigo_revoke_invitation('${rv}','${NEWBIE}')`, 'not_allowed');
    assert.equal(q(`select public.rigo_revoke_invitation('${rv}','${OWNER}')`), 'revoked');
    assert.equal(q(`select public.rigo_answer_invitation('${rv}','${OWNER2}','partner@example.com',true)`), 'revoked');
    // Declining.
    const dc = q(`select public.rigo_invite('${WS}','${OWNER}','partner@example.com','Viewer',7)`);
    assert.equal(q(`select public.rigo_answer_invitation('${dc}','${OWNER2}','partner@example.com',false)`), 'declined');
    assert.equal(q(`select count(*) from public.rigo_memberships where user_id='${OWNER2}'`), '0');
  });

  await t.test('existing member keeps their role; inviter who loses authority invalidates the grant', () => {
    // Race: invited, then joined another way, then accepts — role is unchanged.
    const inv = q(`select public.rigo_invite('${WS}','${OWNER}','partner@example.com','Administrator',7)`);
    q(`select public.rigo_add_member('${WS}','${OWNER}','${OWNER2}','partner@example.com','Viewer')`);
    assert.equal(q(`select public.rigo_answer_invitation('${inv}','${OWNER2}','partner@example.com',true)`), 'already_member');
    assert.equal(q(`select role from public.rigo_memberships where workspace_id='${WS}' and user_id='${OWNER2}'`), 'Viewer');
    // An administrator invites, then is demoted: their pending invitation is withdrawn.
    const fromAdmin = q(`select public.rigo_invite('${WS}','${ADMIN2}','someone@example.com','Viewer',7)`);
    q(`select public.rigo_change_member('${WS}','${OWNER}','${ADMIN2}','Viewer',false)`);
    assert.equal(q(`select status from public.rigo_invitations where id='${fromAdmin}'`), 'revoked');
    assert.equal(q(`select public.rigo_answer_invitation('${fromAdmin}','${STRANGER}','someone@example.com',true)`), 'revoked');
  });

  await t.test('role management authority and removal', () => {
    fails(`select public.rigo_change_member('${WS}','${ADMIN1}','${OWNER}','Viewer',false)`, 'not_allowed');
    fails(`select public.rigo_change_member('${WS}','${ADMIN1}','${NEWBIE}','Owner',false)`, 'not_allowed');
    fails(`select public.rigo_change_member('${WS}','${NEWBIE}','${OWNER2}','Viewer',false)`, 'not_allowed');
    // Removal revokes this company only; the account and its other companies stay.
    assert.equal(q(`select public.rigo_change_member('${WS}','${ADMIN1}','${NEWBIE}',null,true)`), 'removed');
    assert.equal(q(`select string_agg(status, ',' order by workspace_id) from public.rigo_memberships where user_id='${NEWBIE}'`).split(',').sort().join(','), 'active,active,removed');
    // An old accepted invitation cannot restore access.
    assert.equal(q(`select count(*) from public.rigo_invitations where email='new@example.com' and status='accepted'`), '1');
    const acceptedId = q(`select id from public.rigo_invitations where email='new@example.com' and status='accepted'`);
    assert.equal(q(`select public.rigo_answer_invitation('${acceptedId}','${NEWBIE}','new@example.com',true)`), 'accepted');
    assert.equal(q(`select status from public.rigo_memberships where workspace_id='${WS}' and user_id='${NEWBIE}'`), 'removed');
    // A new, valid invitation does.
    const again = q(`select public.rigo_invite('${WS}','${OWNER}','new@example.com','Viewer',7)`);
    assert.equal(q(`select public.rigo_answer_invitation('${again}','${NEWBIE}','new@example.com',true)`), 'accepted');
    assert.equal(q(`select role || ':' || status from public.rigo_memberships where workspace_id='${WS}' and user_id='${NEWBIE}'`), 'Viewer:active');
  });

  await t.test('last owner cannot be removed, demoted or leave — even concurrently', async () => {
    fails(`select public.rigo_change_member('${WS}','${OWNER}','${OWNER}',null,true)`, 'last_owner');
    fails(`select public.rigo_change_member('${WS}','${OWNER}','${OWNER}','Administrator',false)`, 'last_owner');
    // Two owners both try to leave at the same moment: exactly one may succeed.
    q(`select public.rigo_change_member('${WS}','${OWNER}','${OWNER2}','Owner',false)`);
    assert.equal(q(`select count(*) from public.rigo_memberships where workspace_id='${WS}' and role='Owner' and status='active'`), '2');
    const slow = l => `begin; select public.rigo_change_member('${WS}','${l}','${l}',null,true); select pg_sleep(0.6); commit;`;
    const results = await Promise.all([db.sqlAsync(slow(OWNER)), db.sqlAsync(slow(OWNER2))]);
    assert.equal(results.filter(r => r.ok).length, 1, results.map(r => r.out).join(' | '));
    assert.match(results.find(r => !r.ok).out, /rigo:last_owner/);
    assert.equal(q(`select count(*) from public.rigo_memberships where workspace_id='${WS}' and role='Owner' and status='active'`), '1');
    // Two owners demoting each other at the same moment: exactly one owner remains.
    const remaining = q(`select user_id from public.rigo_memberships where workspace_id='${WS}' and role='Owner' and status='active'`);
    const other = remaining === OWNER ? OWNER2 : OWNER;
    q(`select public.rigo_add_member('${WS}','${remaining}','${other}','partner@example.com','Viewer')`);
    q(`select public.rigo_change_member('${WS}','${remaining}','${other}','Owner',false)`);
    const demote = (a, b) => `begin; select public.rigo_change_member('${WS}','${a}','${b}','Viewer',false); select pg_sleep(0.6); commit;`;
    const r2 = await Promise.all([db.sqlAsync(demote(OWNER, OWNER2)), db.sqlAsync(demote(OWNER2, OWNER))]);
    assert.equal(q(`select count(*) from public.rigo_memberships where workspace_id='${WS}' and role='Owner' and status='active'`), '1', r2.map(r => r.out).join(' | '));
  });

  await t.test('no direct client access to the new tables', () => {
    for (const table of ['rigo_memberships', 'rigo_invitations', 'rigo_company_requests']) {
      assert.equal(q(`select relrowsecurity from pg_class where relname='${table}'`), 't');
      assert.equal(q(`select has_table_privilege('authenticated','public.${table}','select')::text || has_table_privilege('anon','public.${table}','select')::text`), 'falsefalse');
    }
    assert.equal(q(`select has_function_privilege('authenticated','public.rigo_create_company(uuid,text,text,text,jsonb)','execute')`), 'f');
  });
});
