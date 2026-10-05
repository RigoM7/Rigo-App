const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../lib/domain.cjs');
const { createServer } = require('../lib/server.cjs');

// Postgres jsonb does not keep object key order: shorter keys first, then bytewise.
const jsonb = value => Array.isArray(value) ? value.map(jsonb)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map(k => [k, jsonb(value[k])]))
    : value;
const roundTrip = state => jsonb(JSON.parse(JSON.stringify(state)));
const act = (state, action, role = 'Owner') => domain.applyAction(state, action, role);
const importRows = (state, listId, rows, headers = ['code', 'name']) => act(state, {
  type: 'import', input: { listId, headers, rows, mapping: headers, match: 'code', mode: 'add', historical: false }
});
const list = (state, id) => state.lists.find(l => l.id === id);
const latestImport = (state, listId) => state.imports.find(i => i.listId === listId);
function activeWorkspace() {
  let state = domain.createState('370 Enviro LLC');
  state = act(state, { type: 'workflow', workflow: { statuses: ['Call Received', 'Dispatched', 'En Route', 'On Site', 'Completed'], checklist: [], autoInvoice: false, signatureRequired: false, requireApproval: false, retired: false } });
  state = importRows(state, 'clients', [['C-1', 'Hartley Construction']]);
  state = importRows(state, 'services', [['S-1', 'Portable toilet delivery']]);
  return state;
}

test('undo import is allowed after the workspace round-trips through Supabase jsonb', () => {
  let state = importRows(domain.createState('370 Enviro LLC'), 'vehicles', [['V-101', 'Fuel tanker'], ['V-201', 'Vacuum truck']]);
  state = roundTrip(state);
  const imp = latestImport(state, 'vehicles');
  assert.notEqual(JSON.stringify(list(state, 'vehicles').rows), imp.after, 'stored text snapshot no longer matches byte-for-byte');
  assert.equal(domain.undoBlocker(state, imp.id), '');
  const undone = act(state, { type: 'undoImport', id: imp.id });
  assert.equal(list(undone, 'vehicles').rows.length, 0);
  assert.equal(latestImport(undone, 'vehicles').undone, true);
});

test('undo import is blocked with a reason once the list is edited', () => {
  let state = roundTrip(importRows(domain.createState('370 Enviro LLC'), 'equipment', [['PJ-1', 'Standard unit'], ['PJ-2', 'ADA unit']]));
  const row = list(state, 'equipment').rows[0];
  state = roundTrip(act(state, { type: 'record', listId: 'equipment', id: row.id, values: { ...row.values, name: 'Standard unit (blue)' } }));
  const imp = latestImport(state, 'equipment');
  assert.match(domain.undoBlocker(state, imp.id), /^1 record in Equipment changed after this import/);
  assert.throws(() => act(state, { type: 'undoImport', id: imp.id }), /1 record in Equipment changed after this import/);
});

test('an older import is blocked until the newer import into the same list is undone', () => {
  let state = importRows(domain.createState('370 Enviro LLC'), 'employees', [['T-1', 'Luis Herrera']]);
  state = roundTrip(importRows(state, 'employees', [['T-2', 'Rosa Delgado']]));
  const [newer, older] = state.imports;
  assert.equal(domain.undoBlocker(state, older.id), 'A newer import into Team must be undone first.');
  assert.equal(domain.undoBlocker(state, newer.id), '');
  state = roundTrip(act(state, { type: 'undoImport', id: newer.id }));
  assert.equal(domain.undoBlocker(state, older.id), '');
  assert.equal(list(act(state, { type: 'undoImport', id: older.id }), 'employees').rows.length, 0);
});

test('undo import is blocked while imported records are linked elsewhere', () => {
  let state = importRows(domain.createState('370 Enviro LLC'), 'clients', [['C-1', 'Hartley Construction']]);
  const client = list(state, 'clients').rows[0];
  state = act(state, { type: 'record', listId: 'locations', values: { code: 'L-1', name: 'Hartley Jobsite', client: client.id } });
  state = roundTrip(state);
  assert.match(domain.undoBlocker(state, latestImport(state, 'clients').id), /^Imported records are now linked \(Service locations: Hartley Jobsite\)/);
});

test('existing service location lists gain the default fields once, without duplicates', () => {
  const state = domain.createState('370 Enviro LLC');
  const locations = list(state, 'locations');
  // Simulate a workspace saved before this change, with its own "Address" field.
  locations.fields = locations.fields.filter(f => ['code', 'name'].includes(f.id));
  delete locations.rigoDefaults;
  locations.fields.push({ id: 'custom123', name: 'Address', type: 'text' });
  domain.normalize(state);
  domain.normalize(state);
  const ids = locations.fields.map(f => f.id);
  assert.deepEqual(ids, ['code', 'name', 'custom123', 'city', 'state', 'postalCode', 'type', 'lat', 'lng', 'client', 'contactName', 'contactPhone', 'accessNotes']);
  assert.equal(locations.fields.find(f => f.id === 'client').listId, 'clients');
});

test('saved location details resolve fields by id or by name and validate coordinates', () => {
  const state = domain.createState('370 Enviro LLC');
  domain.normalize(state);
  const values = { code: 'L-1', name: 'Hartley Jobsite', address: '4410 Industrial Pkwy', city: 'Lubbock', state: 'TX', postalCode: '79404', type: 'Construction site', lat: '33.5779', lng: '-101.8552' };
  assert.deepEqual(domain.locationDetails(state, { values }), {
    address: '4410 Industrial Pkwy, Lubbock, TX 79404', type: 'Construction site', coordinates: { lat: 33.5779, lng: -101.8552 },
    contactName: '', contactPhone: '', accessNotes: ''
  });
  assert.equal(domain.locationDetails(state, { values: { ...values, lat: '200' } }).coordinates, undefined);
});

test('a new job takes address, type and coordinates from its saved location', () => {
  let state = activeWorkspace();
  state = act(state, { type: 'record', listId: 'locations', values: { code: 'L-1', name: 'Hartley Jobsite', address: '4410 Industrial Pkwy', city: 'Lubbock', state: 'TX', type: 'Construction site', lat: '33.5779', lng: '-101.8552' } });
  const job = { title: 'Drop 4 portable toilets', clientId: list(state, 'clients').rows[0].id, serviceId: list(state, 'services').rows[0].id, locationId: list(state, 'locations').rows[0].id, quantity: 4, date: '2026-10-06' };
  state = act(state, { type: 'job', job });
  const created = state.jobs[0];
  assert.equal(created.address, '4410 Industrial Pkwy, Lubbock, TX');
  assert.equal(created.pickupLocationType, 'Construction site');
  assert.deepEqual(created.pickupCoordinates, { lat: 33.5779, lng: -101.8552 });
});

test('completion notes are stored separately and never overwrite the team notes', () => {
  let state = activeWorkspace();
  const base = { clientId: list(state, 'clients').rows[0].id, serviceId: list(state, 'services').rows[0].id, quantity: 4, date: '2026-10-06', notes: 'Caller: gate code 4471, units go by the trailer.' };
  state = act(state, { type: 'job', job: { ...base, title: 'Empty report' } });
  state = act(state, { type: 'job', job: { ...base, title: 'With report' } });
  const [first, second] = state.jobs;
  state = act(state, { type: 'complete', id: first.id, jobRevision: first.revision, checks: {}, quantity: 4, notes: '' });
  state = act(state, { type: 'complete', id: second.id, jobRevision: second.revision, checks: {}, quantity: 4, notes: 'Delivered 4 units; one door latch sticks.' });
  const [a, b] = state.jobs;
  assert.equal(a.notes, base.notes);
  assert.equal(a.completionNotes, '');
  assert.equal(b.notes, base.notes);
  assert.equal(b.completionNotes, 'Delivered 4 units; one door latch sticks.');
});

test('jobs completed before this change keep their recorded notes untouched', () => {
  let state = activeWorkspace();
  state = act(state, { type: 'job', job: { title: 'Old job', clientId: list(state, 'clients').rows[0].id, serviceId: list(state, 'services').rows[0].id, quantity: 1, date: '2026-10-01', notes: 'Recorded at completion' } });
  const legacy = state.jobs[0];
  legacy.completedAt = '2026-10-01T12:00:00.000Z';
  legacy.status = 'Completed';
  domain.normalize(state);
  assert.equal(state.jobs[0].notes, 'Recorded at completion');
  assert.equal(state.jobs[0].completionNotes, undefined);
});

test('server reads older workspaces with the new location fields', async () => {
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const workspaceId = '22222222-2222-4222-8222-222222222222';
  const stored = domain.createState('370 Enviro LLC');
  stored.id = workspaceId;
  const locations = list(stored, 'locations');
  locations.fields = locations.fields.filter(f => ['code', 'name'].includes(f.id));
  delete locations.rigoDefaults;
  const row = jsonb({ id: workspaceId, owner_id: ownerId, state: stored, version: 3, audit: [], receipts: {} });
  const fetchImpl = async url => {
    const path = new URL(url).pathname;
    if (path === '/auth/v1/user') return Response.json({ id: ownerId, email: 'owner@example.com', email_confirmed_at: '2026-10-05' });
    return Response.json([row]);
  };
  const server = createServer({ fetchImpl, env: { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's', RIGO_OWNER_USER_ID: ownerId, RIGO_APP_URL: 'https://rigo.example' } });
  const data = await server.run({ method: 'GET', headers: { authorization: 'Bearer t' }, query: { route: 'workspaces', id: workspaceId } });
  assert.ok(list(data.state, 'locations').fields.some(f => f.id === 'address'));
  assert.equal(list(row.state, 'locations').fields.length, 2, 'stored data is not modified by a read');
});
