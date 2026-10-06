// Milestone E: one validated configuration model for visual editing, templates and assistants.
const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../lib/domain.cjs');

const act = (s, action, role = 'Owner') => domain.applyAction(s, action, role);
const base = () => act(domain.createState('Test Co'), { type: 'applyTemplate', template: 'combined' });
const ops = [
  { op: 'addField', list: 'Clients', name: 'Billing email', type: 'text' },
  { op: 'addField', list: 'services', name: 'Hose length', type: 'select', options: ['50 ft', '100 ft'] },
  { op: 'workflow', checklist: ['Photo of tank gauge'] },
  { op: 'modules', add: ['Billing & payments'] },
  { op: 'approvalRule', minTotal: 2000, role: 'Owner' }
];

test('a proposal is validated, previewed in plain words, and changes nothing until applied', () => {
  let s = base();
  const before = JSON.stringify(s.lists);
  s = act(s, { type: 'proposeConfig', ops, summary: 'Fuel setup', source: 'assistant' });
  const p = s.configProposals[0];
  assert.equal(p.status, 'pending');
  assert.equal(p.source, 'assistant');
  assert.deepEqual(p.preview.slice(0, 2), ['Add text field “Billing email” to Clients', 'Add select field “Hose length” to Services (50 ft, 100 ft)']);
  assert.equal(JSON.stringify(s.lists), before, 'nothing applied yet');
  s = act(s, { type: 'decideConfig', id: p.id, decision: 'apply' });
  assert.ok(s.lists.find(l => l.id === 'clients').fields.some(f => f.name === 'Billing email' && !f.required));
  assert.deepEqual(s.workflow.checklist, ['Photo of tank gauge']);
  assert.ok(s.modules.includes('Billing & payments'));
  assert.equal(s.approvalRules[0].minTotal, 2000);
  assert.equal(s.configProposals[0].status, 'applied');
});

test('invalid or unauthorized proposals are refused; applying is all-or-nothing', () => {
  const s = base();
  assert.throws(() => act(s, { type: 'proposeConfig', ops: [{ op: 'runSql', sql: 'drop table' }] }), /Unknown configuration change/);
  assert.throws(() => act(s, { type: 'proposeConfig', ops: [{ op: 'addField', list: 'Nope', name: 'x' }] }), /List not found/);
  assert.throws(() => act(s, { type: 'proposeConfig', ops }, 'Dispatcher'), /Owners and administrators/);
  // An administrator may propose field changes but not owner-only rules.
  assert.throws(() => act(s, { type: 'proposeConfig', ops }, 'Administrator'), /Only owners set approval rules/);
  let ok = act(s, { type: 'proposeConfig', ops: ops.slice(0, 2) }, 'Administrator');
  // The setup changed in the meantime: applying re-checks and changes nothing if any step fails.
  const id = ok.configProposals[0].id;
  ok = act(ok, { type: 'field', listId: 'clients', field: { name: 'Billing email', type: 'number' } });
  const fields = ok.lists.find(l => l.id === 'services').fields.length;
  assert.throws(() => act(ok, { type: 'decideConfig', id, decision: 'apply' }), /different type/);
  assert.equal(ok.lists.find(l => l.id === 'services').fields.length, fields, 'no partial apply');
  // A step that is already in place is skipped rather than failing.
  const same = act(base(), { type: 'field', listId: 'clients', field: { name: 'Billing email', type: 'text' } });
  const partial = act(same, { type: 'proposeConfig', ops: ops.slice(0, 2) });
  assert.equal(partial.configProposals[0].ops.length, 1);
  assert.throws(() => act(partial, { type: 'proposeConfig', ops: ops.slice(0, 1) }), /already in place/);
  const dismissed = act(ok, { type: 'decideConfig', id, decision: 'dismiss' });
  assert.equal(dismissed.configProposals[0].status, 'dismissed');
  assert.throws(() => act(dismissed, { type: 'decideConfig', id, decision: 'apply' }), /no longer waiting/);
});

test('workflow changes from proposals apply to new jobs only', () => {
  let s = base();
  s = act(s, { type: 'record', listId: 'clients', values: { code: 'C-1', name: 'Client' } });
  s = act(s, { type: 'record', listId: 'services', values: { code: 'S-1', name: 'Diesel', rate: '4', unit: 'gallon' } });
  const id = list => s.lists.find(l => l.id === list).rows[0].id;
  s = act(s, { type: 'job', job: { title: 'Old', clientId: id('clients'), serviceId: id('services'), quantity: 1, date: '2026-10-06' } });
  const version = s.jobs[0].workflowVersion;
  s = act(s, { type: 'proposeConfig', ops: [{ op: 'workflow', statuses: ['New', 'Out', 'Done'] }] });
  s = act(s, { type: 'decideConfig', id: s.configProposals[0].id, decision: 'apply' });
  assert.equal(s.jobs[0].workflowVersion, version, 'existing jobs keep their version');
  assert.deepEqual(s.workflow.statuses, ['New', 'Out', 'Done']);
});
