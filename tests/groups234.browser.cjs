// Browser walkthrough of groups 2-4 against the real bundle. The mock server applies
// every action with the real business rules, so the screens and rules are exercised together.
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const domain = require('../lib/domain.cjs');
const shots = process.env.SHOTS || '/tmp';
const jsonb = v => Array.isArray(v) ? v.map(jsonb) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map(k => [k, jsonb(v[k])])) : v;
const act = (s, a) => domain.applyAction(s, a, 'Owner');
const ORIGIN = 'https://rigo-test.example';

function populated() {
  let s = domain.createState('370 Enviro LLC');
  s.id = '22222222-2222-4222-8222-222222222222';
  s = act(s, { type: 'applyTemplate', template: 'combined' });
  const rec = (listId, values) => { s = act(s, { type: 'record', listId, values }); };
  rec('clients', { code: 'C-1', name: 'Hartley Construction' });
  rec('services', { code: 'S-1', name: 'Porta john delivery', rate: '125', unit: 'each' });
  rec('services', { code: 'S-2', name: 'Septic inspection', unit: 'visit' });
  rec('employees', { code: 'T-1', name: 'Maria Salinas', role: 'Dispatcher', phone: '555-0100' });
  rec('employees', { code: 'T-3', name: 'Luis Herrera', role: 'Driver/Field', phone: '555-0103' });
  rec('vehicles', { code: 'V-201', name: 'Truck 201', type: 'Vacuum truck', capacity: '3000', capacityUnit: 'gallon' });
  for (const n of [1, 2, 3, 4, 5]) rec('equipment', { code: 'PJ-' + n, name: 'Unit ' + n, type: 'Standard', status: 'Available' });
  const maria = s.lists.find(l => l.id === 'employees').rows.find(r => r.values.code === 'T-1');
  maria.accountEmail = 'owner@example.com';
  return s;
}

async function open(browser, initial) {
  let state = initial;
  let version = 1;
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.route(ORIGIN + '/**', route => {
    const f = new URL(route.request().url()).pathname.slice(1) || 'index.html';
    if (!['index.html', 'rigo-access.js', 'rigo-access.css'].includes(f)) return route.fulfill({ status: 404 });
    return route.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  await page.route('**/api/rigo?*', route => {
    const url = new URL(route.request().url());
    const name = url.searchParams.get('route');
    if (name === 'config') return route.fulfill({ json: { configured: true, url: 'https://test.supabase.co', key: 'k', geocoding: false } });
    if (name === 'requests') return route.fulfill({ json: { requests: [], signupUrl: ORIGIN } });
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      try { state = jsonb(domain.applyAction(state, { ...body.action, actor: 'owner@example.com' }, 'Owner')); version++; return route.fulfill({ json: { ok: true } }); }
      catch (e) { return route.fulfill({ status: 400, json: { error: e.message } }); }
    }
    if (url.searchParams.get('id')) {
      const out = structuredClone(state); domain.normalize(out);
      return route.fulfill({ json: { state: out, version, role: 'Owner', user: 'owner@example.com', audit: [] } });
    }
    return route.fulfill({ json: { owner: true, workspaces: [{ id: state.id, name: state.name, role: 'Owner' }], user: 'owner@example.com' } });
  });
  await page.route('https://test.supabase.co/auth/v1/**', route => route.fulfill({ json: { id: 'o', email: 'owner@example.com' } }));
  await page.addInitScript(() => localStorage.setItem('rigo-auth-session-v1', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600 })));
  await page.goto(ORIGIN);
  return { page, errors, get state() { return state; } };
}
const pick = async (page, comboName, option) => { await page.getByRole('combobox', { name: comboName }).click(); await page.getByRole('option', { name: option, exact: true }).click(); };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    // 13, 14, 15, 17: first run on a brand-new workspace.
    {
      const fresh = domain.createState('370 Enviro LLC'); fresh.id = '33333333-3333-4333-8333-333333333333';
      const { page, errors, state } = await open(browser, jsonb(fresh));
      await page.getByRole('heading', { name: 'Get set up' }).waitFor();
      assert.equal(await page.locator('h1').first().innerText(), 'Jobs');
      const newJob = page.getByRole('button', { name: 'New job' });
      assert(await newJob.isDisabled());
      assert.match(await newJob.getAttribute('title'), /Publish your workflow first/);
      await page.screenshot({ path: shots + '/g4-setup.png', fullPage: true });
      await page.getByRole('button', { name: 'Apply template' }).click();
      await page.waitForFunction(() => !document.querySelector('button.primary[title^="Publish your workflow first"]'));
      assert(await page.getByRole('button', { name: 'New job' }).isEnabled());
      await page.getByRole('button', { name: 'Load demo data' }).click();
      await page.getByText('Demo data is loaded.', { exact: false }).waitFor();
      await page.getByText(/^All Jobs/).first().click();
      await page.getByText('DEMO').first().waitFor();
      await page.screenshot({ path: shots + '/g4-demo.png', fullPage: true });
      await page.getByRole('button', { name: 'Remove demo data' }).click();
      await page.getByRole('button', { name: 'Load demo data' }).waitFor();
      assert.equal(errors.length, 0, errors.join('\n'));
      await page.close();
    }

    const ws = await open(browser, jsonb(populated()));
    const { page, errors } = ws;
    // 5, 4, 7, 8: create a job.
    await page.getByRole('button', { name: 'New job' }).click();
    await pick(page, 'Select client', 'Hartley Construction');
    await pick(page, 'Select service *', 'Septic inspection');
    await page.getByText('Septic inspection has no price, so this job will be booked at $0.00', { exact: false }).waitFor();
    await pick(page, 'Select service *', 'Porta john delivery');
    assert.equal(await page.getByText('has no price', { exact: false }).count(), 0);
    await page.getByRole('combobox', { name: /team assigned/i }).click();
    const teamOptions = await page.getByRole('option').allInnerTexts();
    assert(teamOptions.includes('Luis Herrera') && !teamOptions.includes('Maria Salinas'), 'only field roles are offered: ' + teamOptions);
    await page.getByRole('option', { name: 'Luis Herrera' }).click();
    assert.match(await page.getByRole('combobox', { name: /coordinator/i }).innerText(), /Maria Salinas/);
    for (const unit of ['Unit 1 (PJ-1)', 'Unit 2 (PJ-2)', 'Unit 3 (PJ-3)', 'Unit 4 (PJ-4)']) await pick(page, 'Add a unit', unit);
    await page.getByText('Equipment units · 4 attached').waitFor();
    assert.equal(await page.getByLabel(/Quantity \(each\)/).inputValue(), '4');
    await page.getByLabel('Job title').fill('Deliver 4 porta johns').catch(() => {});
    await page.screenshot({ path: shots + '/g2-create.png', fullPage: true });
    await page.getByRole('button', { name: 'Create job' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    const job = ws.state.jobs[0];
    assert.equal(job.number, 1001);
    assert.equal(job.equipmentIds.length, 4);
    assert.equal(job.dispatcher, 'Maria Salinas');

    // 11, 12, 15, 10: list row and detail panel.
    await page.getByText(/^All Jobs/).first().click();
    await page.getByText('J-1001').first().waitFor();
    await page.getByText('4 each · 4 units: PJ-1, PJ-2, PJ-3, PJ-4').waitFor();
    await page.getByText(/pending · not notified/i).first().waitFor();
    await page.screenshot({ path: shots + '/g4-list.png' });
    await page.getByRole('button', { name: 'Details' }).first().click();
    await page.getByText('No notification was sent.').waitFor();
    await page.getByRole('link', { name: '555-0103' }).waitFor();
    await page.getByRole('button', { name: 'Mark En Route' }).click();
    await page.getByRole('button', { name: 'Mark On Site' }).waitFor();
    const history = await page.locator('.rigo-history li strong').allInnerTexts();
    assert.deepEqual(history, ['Call Received', 'Dispatched', 'En Route']);
    await page.getByText('Move back to an earlier step…').click();
    await pick(page, 'Choose an earlier step', 'Dispatched');
    await page.getByLabel('Reason (saved in the status history)').fill('Truck 201 flat tire');
    await page.getByRole('button', { name: 'Move back' }).click();
    await page.getByText(' — Truck 201 flat tire').waitFor();
    await page.screenshot({ path: shots + '/g4-detail.png', fullPage: true });
    await page.keyboard.press('Escape');

    // 8: services without a price are flagged in the Services list.
    await page.getByRole('button', { name: 'Data library' }).click();
    await page.getByRole('button', { name: /^Services/ }).first().click();
    await page.getByText('⚠ No price').first().waitFor();
    await page.getByText('1 without a price', { exact: false }).waitFor();
    await page.screenshot({ path: shots + '/g3-services.png' });
    // 10, 16: process builder rule and step buttons.
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Process builder' }).click();
    await page.getByText('Require assignment acknowledgment before field progress').waitFor();
    await page.getByRole('button', { name: 'Move step 2 earlier' }).waitFor();
    await page.screenshot({ path: shots + '/g4-process.png', fullPage: true });
    // 9: import guard.
    await page.getByRole('button', { name: 'Data library' }).click();
    await page.getByRole('button', { name: /^Import/ }).first().click();
    await pick(page, /destination|list/i, 'Services').catch(() => {});
    await page.locator('textarea').first().fill('Record ID\tName\tCity\nT-004\tDwayne Carter\tLubbock\nT-005\tTommy Nguyen\tLubbock');
    await page.getByRole('button', { name: 'Continue with pasted data' }).click();
    await page.getByRole('button', { name: 'Preview changes' }).click();
    await page.getByText('Importing into:', { exact: false }).waitFor();
    await page.screenshot({ path: shots + '/g3-import.png', fullPage: true });
    const confirmText = await page.getByRole('button', { name: /^Import \d+ rows into / }).innerText();
    console.log('Import confirm button:', confirmText);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Groups 2-4 browser checks passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
