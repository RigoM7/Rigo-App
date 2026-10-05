const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../lib/domain.cjs');

const act = (state, action, role = 'Owner') => domain.applyAction(state, action, role);
const list = (state, id) => state.lists.find(l => l.id === id);
const field = (state, listId, id) => list(state, listId).fields.find(f => f.id === id);
const record = (state, listId, values) => act(state, { type: 'record', listId, values });
const rowId = (state, listId, code) => list(state, listId).rows.find(r => r.values.code === code).id;
const STATUSES = ['Call Received', 'Dispatched', 'En Route', 'On Site', 'Completed'];
function workspace(rules = {}) {
  let s = domain.createState('370 Enviro LLC');
  s = act(s, { type: 'configure', name: '370 Enviro LLC', modules: ['Clients & sales', 'Services & pricing', 'Orders & jobs', 'Employees & crews', 'Fleet & equipment', 'Locations'], terminology: s.terminology });
  s = act(s, { type: 'workflow', workflow: { statuses: STATUSES, checklist: [], autoInvoice: false, signatureRequired: false, requireApproval: false, retired: false, ...rules } });
  s = record(s, 'clients', { code: 'C-1', name: 'Hartley Construction' });
  s = record(s, 'services', { code: 'S-1', name: 'Porta john delivery', rate: '125', unit: 'each' });
  s = record(s, 'services', { code: 'S-2', name: 'Off-road diesel', rate: '4.25', unit: 'gallon' });
  s = record(s, 'employees', { code: 'T-1', name: 'Maria Salinas', role: 'Dispatcher', phone: '555-0100' });
  s = record(s, 'employees', { code: 'T-3', name: 'Luis Herrera', role: 'Driver/Field' });
  s = record(s, 'employees', { code: 'T-9', name: 'Legacy (no role)' });
  for (const n of [1, 2, 3, 4]) s = record(s, 'equipment', { code: 'PJ-' + n, name: 'Unit ' + n, type: 'Standard', status: 'Available' });
  return s;
}
const newJob = (s, job) => act(s, { type: 'job', job: { title: 'Job', clientId: rowId(s, 'clients', 'C-1'), serviceId: rowId(s, 'services', 'S-1'), quantity: 1, date: '2026-10-06', ...job } });

test('list defaults: team role and phone, vehicle, equipment and service unit fields', () => {
  const s = workspace();
  assert.deepEqual(field(s, 'employees', 'role').options, ['Driver/Field', 'Dispatcher', 'Office']);
  assert.ok(field(s, 'employees', 'phone'));
  assert.deepEqual(['type', 'capacity', 'capacityUnit', 'plate'].map(id => !!field(s, 'vehicles', id)), [true, true, true, true]);
  assert.deepEqual(field(s, 'equipment', 'status').options, ['Available', 'On site', 'In service', 'Retired']);
  assert.ok(field(s, 'equipment', 'currentLocation'));
  const unit = field(s, 'services', 'unit');
  assert.equal(unit.type, 'select');
  assert.equal(unit.required, true);
  assert.deepEqual(unit.options.slice(0, 4), ['each', 'gallon', 'hour', 'visit']);
  assert.throws(() => record(s, 'services', { code: 'S-3', name: 'No unit', rate: '10' }), /Unit of measure is required/);
});

test('existing service units are kept as allowed choices; archived rows do not block list edits', () => {
  const s = domain.createState('x');
  const services = list(s, 'services');
  const unit = services.fields.find(f => f.id === 'unit');
  Object.assign(unit, { type: 'text', required: false });
  delete unit.options;
  delete services.rigoDefaults;
  services.rows.push({ id: 'a', values: { code: 'S-1', name: 'Pump', unit: 'tank' }, revision: 1 }, { id: 'b', values: { code: 'L-1', name: 'Mistake' }, revision: 1, archived: true });
  domain.normalize(s);
  assert.deepEqual(unit.options, ['each', 'gallon', 'hour', 'visit', 'tank']);
  const next = act(s, { type: 'field', listId: 'services', field: { ...field(s, 'services', 'name'), name: 'Service name' } });
  assert.equal(field(next, 'services', 'name').name, 'Service name');
});

test('only field roles can be assigned; dispatchers and office staff are rejected', () => {
  let s = workspace();
  assert.throws(() => newJob(s, { employeeId: rowId(s, 'employees', 'T-1') }), /Maria Salinas has the Dispatcher role/);
  s = newJob(s, { employeeId: rowId(s, 'employees', 'T-9') });
  s = newJob(s, { employeeId: rowId(s, 'employees', 'T-3') });
  const job = s.jobs[1];
  assert.throws(() => act(s, { type: 'assign', id: job.id, jobRevision: job.revision, employeeId: rowId(s, 'employees', 'T-1') }), /Dispatcher role/);
});

test('several equipment units on one job; quantity follows the unit count for "each" services', () => {
  let s = workspace();
  const units = ['PJ-1', 'PJ-2', 'PJ-3', 'PJ-4'].map(c => rowId(s, 'equipment', c));
  s = newJob(s, { equipmentIds: units, quantity: 1 });
  let job = s.jobs[0];
  assert.deepEqual(job.equipmentIds, units);
  assert.equal(job.equipmentId, units[0]);
  assert.equal(job.quantity, 4);
  s = act(s, { type: 'assign', id: job.id, jobRevision: job.revision, equipmentIds: units.slice(0, 2) });
  job = s.jobs[0];
  assert.deepEqual(job.equipmentIds, units.slice(0, 2));
  assert.equal(job.quantity, 2);
  assert.throws(() => act(s, { type: 'assign', id: job.id, jobRevision: job.revision, equipmentIds: ['missing'] }), /selected unit is unavailable/);
  // Fuel: quantity stays editable even with a unit attached.
  s = newJob(s, { serviceId: rowId(s, 'services', 'S-2'), equipmentIds: [units[3]], quantity: 500 });
  assert.equal(s.jobs[1].quantity, 500);
  assert.equal(s.jobs[1].unit, 'gallon');
});

test('extra units are protected like the first: deletion is blocked while a job uses them', () => {
  let s = workspace();
  const units = ['PJ-1', 'PJ-2'].map(c => rowId(s, 'equipment', c));
  s = newJob(s, { equipmentIds: units });
  assert.throws(() => act(s, { type: 'delete', listId: 'equipment', ids: [units[1]] }));
});

test('equipment tracking follows every unit on assignment, completion and reopening', () => {
  let s = workspace();
  s = act(s, { type: 'dispatchRules', rules: { schedule: 'off', suitability: 'off', allowOverrides: false, equipmentTracking: true, states: ['Available', 'Assigned', 'Deployed', 'Servicing', 'Returned'], initialState: 'Available', assignedState: 'Assigned', unavailableStates: ['Deployed', 'Servicing'], defaultDuration: 60, defaultBuffer: 0 } });
  const service = list(s, 'services').rows.find(r => r.values.code === 'S-1');
  s = act(s, { type: 'record', listId: 'services', id: service.id, values: service.values, jobForm: { template: 'General', vehicle: false, dropoff: false, fields: [], equipmentEffect: { state: 'Deployed', location: 'job' } } });
  const units = ['PJ-1', 'PJ-2', 'PJ-3'].map(c => rowId(s, 'equipment', c));
  s = newJob(s, { equipmentIds: units, address: '4410 Industrial Pkwy' });
  const state = id => list(s, 'equipment').rows.find(r => r.id === id).equipmentState;
  assert.deepEqual(units.map(state), ['Assigned', 'Assigned', 'Assigned']);
  let job = s.jobs[0];
  s = act(s, { type: 'complete', id: job.id, jobRevision: job.revision, checks: {}, quantity: 3, notes: '' });
  assert.deepEqual(units.map(state), ['Deployed', 'Deployed', 'Deployed']);
  job = s.jobs[0];
  s = act(s, { type: 'reopenJob', id: job.id, jobRevision: job.revision, reason: 'Wrong site' });
  assert.deepEqual(units.map(state), ['Assigned', 'Assigned', 'Assigned']);
});

test('status history records the first step even when the job starts at step 2', () => {
  let s = workspace();
  s = newJob(s, { employeeId: rowId(s, 'employees', 'T-3') });
  const job = s.jobs[0];
  assert.equal(job.status, 'Dispatched');
  assert.deepEqual(job.statusHistory.map(h => h.status), ['Call Received', 'Dispatched']);
  assert.ok(job.statusHistory.every(h => h.at && h.actor));
  s = act(s, { type: 'jobStatus', id: job.id, jobRevision: job.revision, status: 'En Route' });
  assert.deepEqual(s.jobs[0].statusHistory.map(h => h.status), ['Call Received', 'Dispatched', 'En Route']);
});

test('moving a job back needs a reason, which is recorded', () => {
  let s = workspace();
  s = newJob(s, { employeeId: rowId(s, 'employees', 'T-3') });
  let job = s.jobs[0];
  s = act(s, { type: 'jobStatus', id: job.id, jobRevision: job.revision, status: 'En Route' });
  job = s.jobs[0];
  assert.throws(() => act(s, { type: 'jobStatus', id: job.id, jobRevision: job.revision, status: 'Dispatched' }), /Give a reason for moving this job back/);
  s = act(s, { type: 'jobStatus', id: job.id, jobRevision: job.revision, status: 'Dispatched', statusReason: 'Truck broke down' });
  assert.equal(s.jobs[0].statusHistory.at(-1).reason, 'Truck broke down');
});

test('acknowledgment rule (off by default) blocks field progress until the driver accepts', () => {
  let off = newJob(workspace(), {});
  off = newJob(off, { employeeId: rowId(off, 'employees', 'T-3') });
  const j = off.jobs[1];
  assert.equal(act(off, { type: 'jobStatus', id: j.id, jobRevision: j.revision, status: 'En Route' }).jobs[1].status, 'En Route');

  let s = workspace({ requireAcknowledgment: true });
  s = newJob(s, { employeeId: rowId(s, 'employees', 'T-3') });
  let job = s.jobs[0];
  assert.throws(() => act(s, { type: 'jobStatus', id: job.id, jobRevision: job.revision, status: 'En Route' }), /must accept this assignment before it moves to En Route/);
  assert.throws(() => act(s, { type: 'complete', id: job.id, jobRevision: job.revision, checks: {}, quantity: 1 }), /must accept this assignment before it is completed/);
  s = act(s, { type: 'acknowledge', id: job.id, jobRevision: job.revision, status: 'Accepted' });
  job = s.jobs[0];
  assert.equal(act(s, { type: 'jobStatus', id: job.id, jobRevision: job.revision, status: 'En Route' }).jobs[0].status, 'En Route');
});

test('jobs get readable sequential numbers; older jobs are numbered by creation order', () => {
  let s = workspace();
  s = newJob(s, { title: 'First' });
  s = newJob(s, { title: 'Second' });
  assert.deepEqual(s.jobs.map(j => domain.jobNumber(j)), ['J-1001', 'J-1002']);
  const legacy = structuredClone(s);
  legacy.jobs.forEach((j, i) => { delete j.number; j.createdAt = `2026-10-0${i + 1}T12:00:00.000Z`; });
  delete legacy.jobSeq;
  legacy.jobs.reverse();
  domain.normalize(legacy);
  assert.deepEqual(legacy.jobs.map(j => [j.title, j.number]), [['Second', 1002], ['First', 1001]]);
  assert.equal(newJob(legacy, { title: 'Third' }).jobs.at(-1).number, 1003);
});

test('starter template sets modules, publishes the workflow and adds trade fields', () => {
  let s = domain.createState('370 Enviro LLC');
  assert.equal(s.workflow.retired, true);
  s = act(s, { type: 'applyTemplate', template: 'combined' });
  assert.equal(s.workflow.retired, false);
  assert.deepEqual(s.workflow.statuses, STATUSES);
  assert.ok(s.modules.includes('Fleet & equipment') && s.modules.includes('Locations'));
  assert.ok(field(s, 'equipment', 'unitType') && field(s, 'services', 'fuelType') && field(s, 'locations', 'tankSize'));
  const again = act(s, { type: 'applyTemplate', template: 'combined' });
  assert.equal(list(again, 'locations').fields.filter(f => f.id === 'tankSize').length, 1);
  assert.throws(() => act(s, { type: 'applyTemplate', template: 'sanitation' }, 'Dispatcher'), /Administrator permission required/);
});

test('demo data is labelled, owner-only, and removed in one action without touching real records', () => {
  let s = workspace();
  s = newJob(s, { title: 'Real job' });
  assert.throws(() => act(s, { type: 'loadDemo' }, 'Administrator'), /Only the owner can load demo data/);
  s = act(s, { type: 'loadDemo' });
  assert.equal(domain.hasDemo(s), true);
  const demoJobs = s.jobs.filter(j => j.demo);
  assert.equal(demoJobs.length, 3);
  assert.ok(demoJobs.every(j => j.title.startsWith('Demo · ')));
  assert.equal(demoJobs[0].equipmentIds.length, 4);
  assert.throws(() => act(s, { type: 'loadDemo' }), /already loaded/);
  s = act(s, { type: 'removeDemo' });
  assert.equal(domain.hasDemo(s), false);
  assert.deepEqual(s.jobs.map(j => j.title), ['Real job']);
  assert.ok(s.lists.every(l => l.rows.every(r => !String(r.values.name || '').startsWith('Demo · '))));
});

test('removing demo data is refused while real records use demo records', () => {
  let s = act(workspace(), { type: 'loadDemo' });
  const demoClient = list(s, 'clients').rows.find(r => r.demo).id;
  s = newJob(s, { title: 'Real job for a demo client', clientId: demoClient });
  assert.throws(() => act(s, { type: 'removeDemo' }), /Some of your records still use demo records \(Job: Real job for a demo client\)/);
});

test('import warnings flag headers and IDs that do not fit the destination list', () => {
  const s = workspace();
  const w = domain.importWarnings(s, 'services', ['Record ID', 'Name', 'Address', 'City', 'Gate code'], [['T-004', 'Dwayne'], ['T-005', 'Tommy']], ['code', 'name', '', '', '']);
  assert.match(w[0], /column headings match fields in Services/);
  assert.match(w[1], /2 of 2 record IDs \(like T-…\) don't follow the IDs already in Services \(S-…\)\. They look like Team records\./);
  assert.deepEqual(domain.importWarnings(s, 'services', ['code', 'name', 'unit'], [['S-9', 'Grease trap', 'visit']], ['code', 'name', 'unit']), []);
});
