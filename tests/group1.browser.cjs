// Browser checks for the Group 1 fixes, against the real app bundle with a mocked server.
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const domain = require('../lib/domain.cjs');
const shots = process.env.SHOTS || '/tmp';
const jsonb = v => Array.isArray(v) ? v.map(jsonb) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map(k => [k, jsonb(v[k])])) : v;
const act = (s, a) => domain.applyAction(s, a, 'Owner');
function workspace() {
  let s = domain.createState('370 Enviro LLC');
  s.id = '22222222-2222-4222-8222-222222222222';
  s = act(s, { type: 'configure', name: '370 Enviro LLC', modules: ['Clients & sales', 'Services & pricing', 'Orders & jobs', 'Scheduling & dispatch', 'Employees & crews', 'Fleet & equipment', 'Locations'], terminology: s.terminology });
  s = act(s, { type: 'workflow', workflow: { statuses: ['Call Received', 'Dispatched', 'En Route', 'On Site', 'Completed'], checklist: [], autoInvoice: false, signatureRequired: false, requireApproval: false, retired: false } });
  const imp = (listId, rows) => { s = act(s, { type: 'import', input: { listId, headers: ['code', 'name'], rows, mapping: ['code', 'name'], match: 'code', mode: 'add', historical: false } }); };
  imp('clients', [['C-1', 'Hartley Construction']]);
  imp('services', [['S-1', 'Portable toilet delivery']]);
  imp('employees', [['T-3', 'Luis Herrera']]);
  imp('vehicles', [['V-201', 'Vacuum truck']]);
  imp('equipment', [['PJ-1', 'Standard unit'], ['PJ-2', 'ADA unit']]);
  const eq = s.lists.find(l => l.id === 'equipment').rows[0];
  s = act(s, { type: 'record', listId: 'equipment', id: eq.id, values: { ...eq.values, name: 'Standard unit (blue)' } });
  s = act(s, { type: 'record', listId: 'locations', values: { code: 'L-1', name: 'Hartley Jobsite', address: '4410 Industrial Pkwy', city: 'Lubbock', state: 'TX', postalCode: '79404', type: 'Construction site', lat: '33.5779', lng: '-101.8552' } });
  s = act(s, { type: 'record', listId: 'locations', values: { code: 'L-2', name: 'Garza Residence' } });
  const id = l => s.lists.find(x => x.id === l).rows[0].id;
  s = act(s, { type: 'job', job: { title: 'Drop 4 portable toilets', clientId: id('clients'), serviceId: id('services'), employeeId: id('employees'), quantity: 4, date: '2026-10-06', notes: 'Caller: gate code 4471. Units go by the trailer.' } });
  return jsonb(JSON.parse(JSON.stringify(s)));
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const errors = [];
  try {
    const origin = 'https://rigo-test.example';
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.route(origin + '/**', route => {
      const f = new URL(route.request().url()).pathname.slice(1) || 'index.html';
      if (!['index.html', 'rigo-access.js', 'rigo-access.css'].includes(f)) return route.fulfill({ status: 404 });
      return route.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    const state = workspace();
    await page.route('**/api/rigo?*', route => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('route') === 'config') return route.fulfill({ json: { configured: true, url: 'https://test.supabase.co', key: 'k' } });
      if (url.searchParams.get('route') === 'requests') return route.fulfill({ json: { requests: [], signupUrl: origin } });
      if (url.searchParams.get('id')) return route.fulfill({ json: { state, version: 9, role: 'Owner', user: 'owner@example.com', audit: [] } });
      return route.fulfill({ json: { owner: true, workspaces: [{ id: state.id, name: state.name, role: 'Owner' }], user: 'owner@example.com' } });
    });
    await page.route('https://test.supabase.co/auth/v1/**', route => route.fulfill({ json: { id: 'o', email: 'owner@example.com' } }));
    await page.addInitScript(() => localStorage.setItem('rigo-auth-session-v1', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600 })));
    await page.goto(origin);

    // 3. Completion notes start empty, with the dispatcher's notes shown read-only.
    await page.getByText(/^All Jobs/).first().click();
    await page.getByRole('button', { name: 'Details' }).first().click();
    const notes = page.getByLabel('Completion notes / issues');
    await notes.waitFor();
    assert.equal(await notes.inputValue(), '');
    await page.getByText('Team notes from dispatch (read-only)').waitFor();
    await page.getByText('Caller: gate code 4471. Units go by the trailer.').first().waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({ path: shots + '/g1-completion-notes.png' });
    await page.keyboard.press('Escape');

    // 2. Saved location fills the job's location fields; a location without details says so.
    await page.goto(origin);
    await page.getByRole('button', { name: 'New job' }).click();
    await page.getByRole('combobox', { name: 'Select client' }).click();
    await page.getByRole('option', { name: 'Hartley Construction' }).click();
    await page.getByRole('combobox', { name: 'Select service *' }).click();
    await page.getByRole('option', { name: 'Portable toilet delivery' }).click();
    await page.getByRole('combobox', { name: /saved service location/i }).click();
    await page.getByRole('option', { name: 'Hartley Jobsite' }).click();
    const address = page.getByLabel('Service location address');
    assert.equal(await address.inputValue(), '4410 Industrial Pkwy, Lubbock, TX 79404');
    assert.equal(await page.getByLabel('Service location type').inputValue(), 'Construction site');
    await address.fill('');
    await page.getByRole('button', { name: 'Use saved location details' }).click();
    assert.equal(await address.inputValue(), '4410 Industrial Pkwy, Lubbock, TX 79404');
    await page.screenshot({ path: shots + '/g1-location.png' });
    await page.getByRole('combobox', { name: /saved service location/i }).click();
    await page.getByRole('option', { name: 'Garza Residence' }).click();
    assert.equal(await address.inputValue(), '4410 Industrial Pkwy, Lubbock, TX 79404', 'choosing a location without details keeps what was there');
    await page.getByRole('button', { name: 'Use saved location details' }).click();
    await page.getByText('Garza Residence has no address, location type or coordinates saved yet.', { exact: false }).waitFor();

    // 1. Import history: undo enabled where the list is unchanged; otherwise the reason is shown.
    await page.goto(origin);
    await page.getByRole('button', { name: 'Data library' }).click();
    await page.getByRole('button', { name: /^Import/ }).first().click();
    await page.getByRole('tab', { name: /history/i }).click();
    const rows = page.locator('tr', { has: page.getByRole('button', { name: 'Undo import' }) });
    const byList = async name => rows.filter({ hasText: name }).getByRole('button', { name: 'Undo import' });
    assert(await (await byList('Vehicles')).isEnabled(), 'an unchanged, unlinked import can be undone after a Supabase round trip');
    for (const name of ['Team', 'Services', 'Clients']) assert(await (await byList(name)).isDisabled(), name + ' records are used by a job');
    await page.getByText('Imported records are now linked (Job: Drop 4 portable toilets)', { exact: false }).first().waitFor();
    assert(await (await byList('Equipment')).isDisabled());
    await page.getByText('1 record in Equipment changed after this import', { exact: false }).waitFor();
    await page.screenshot({ path: shots + '/g1-undo.png', fullPage: true });
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Group 1 browser checks passed: completion notes, saved location, undo import.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
