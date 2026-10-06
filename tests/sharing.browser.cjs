// Milestone F browser checks (mocked server): sharing agreements, shared records, all-companies view.
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const origin = 'https://rigo-test.example';
const shots = process.env.RIGO_SHOTS || '/tmp';
const REAL = '0a000000-0000-4000-8000-000000000001';
const files = { 'index.html': 'index.html', 'rigo-access.js': 'rigo-access.js', 'rigo-access.css': 'rigo-access.css', 'rigo-ops.js': 'rigo-ops.js', 'rigo-demo-seed.js': 'lib/demo-seed.js' };

async function setup(browser, { width = 1280, height = 900, account = { id: 'user-1', email: 'one@example.com' }, companies = [], blockStorage = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const log = { requests: [], api: [], creates: [] };
  context.on('request', r => log.requests.push(r.method() + ' ' + r.url()));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname.startsWith('/api/rigo')) {
      const name = url.searchParams.get('route');
      log.api.push(route.request().method() + ' ' + name);
      if (name === 'config') return route.fulfill({ json: { configured: true, url: 'https://test.supabase.co', key: 'public-key' } });
      if (name === 'companies') { log.creates.push(route.request().postDataJSON()); return route.fulfill({ json: { id: REAL } }); }
      if (name === 'requests') return route.fulfill({ json: { requests: [] } });
      if (name === 'workspaces' && url.searchParams.get('id')) return route.fulfill({ json: { error: 'You do not have access to this company.' }, status: 403 });
      return route.fulfill({ json: { user: account.email, userId: account.id, workspaces: companies, invitations: [] } });
    }
    if (url.origin === origin) {
      const file = files[url.pathname.slice(1) || 'index.html'];
      if (!file) return route.fulfill({ status: 404 });
      return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    }
    if (url.origin === 'https://test.supabase.co') return route.fulfill({ json: { id: account.id, email: account.email } });
    // Anything else would be a third-party request; record it and refuse.
    return route.abort();
  });
  await context.addInitScript(([block]) => {
    if (location.origin !== 'https://rigo-test.example') return;
    if (!localStorage.getItem('rigo-auth-session-v1')) localStorage.setItem('rigo-auth-session-v1', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600 }));
    if (block) Storage.prototype.setItem = () => { throw new DOMException('blocked', 'SecurityError'); };
  }, [blockStorage]);
  const errors = [];
  context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
  return { context, log, errors };
}
const SEED = (() => { const d = require('../lib/domain.cjs'); const st = require('../lib/demo-seed.js').build(d); return { all: String(st.jobs.filter(j => !j.archived).length), received: String(st.jobs.filter(j => !j.archived && j.status === st.workflow.statuses[0]).length) }; })();
const thirdParty = log => log.requests.filter(r => !r.includes(origin) && !r.includes('https://test.supabase.co/auth/v1/user'));
const count = (page, label) => page.locator('button', { hasText: label }).locator('span').last().innerText().then(t => t.replace(/[()]/g, '')).catch(() => '');
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox'] });
    const domain = require('../lib/domain.cjs');
    const A = REAL, B = '0b000000-0000-4000-8000-000000000002';
    const state = domain.applyAction(domain.createState('370 Enviro LLC'), { type: 'applyTemplate', template: 'combined' }, 'Owner'); state.id = A;
    const posts = [];
    let shareStatus = 'pending';
    const context = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin && url.pathname.startsWith('/api/rigo')) {
        const name = url.searchParams.get('route'); const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
        const json = data => route.fulfill({ json: data });
        if (name === 'config') return json({ configured: true, url: 'https://test.supabase.co', key: 'k' });
        if (name === 'shares') {
          if (body) { posts.push(body); if (body.op === 'accept') shareStatus = 'active'; return json(body.op === 'copy' ? { added: 1, skipped: 0 } : { status: body.op === 'accept' ? 'active' : 'pending' }); }
          if (url.searchParams.get('records')) return json({ shared: shareStatus === 'active' ? [{ shareId: 's1', from: 'Acme Septic', lists: [{ id: 'clients', name: 'Clients', fields: [{ id: 'code', name: 'Record number' }, { id: 'name', name: 'Name' }], rows: [{ id: 'r1', values: { code: 'C-9', name: 'Lakeside RV Park' } }] }] }] : [] });
          return json({ shares: [{ id: 's1', direction: 'in', other: 'Acme Septic', lists: ['clients'], status: shareStatus }], targets: [{ id: B, name: 'Acme Septic' }] });
        }
        if (name === 'overview') return json({ companies: [
          { id: A, name: '370 Enviro LLC', role: 'Owner', today: 3, attention: 2, unpriced: 1, money: { invoiced: 1000, collected: 400, outstanding: 600 } },
          { id: B, name: 'Acme Septic', role: 'Owner', today: 1, attention: 0, unpriced: 0, money: { invoiced: 250, collected: 250, outstanding: 0 } }] });
        if (name === 'templates') return json({ templates: [] });
        if (name === 'requests') return json({ requests: [] });
        if (name === 'integrations') return json({ geocoding: { available: false, enabled: false } });
        if (name === 'workspaces' && url.searchParams.get('id')) return json({ state, version: 1, role: 'Owner', user: 'owner@example.com', audit: [] });
        return json({ user: 'owner@example.com', userId: 'u1', workspaces: [{ id: A, name: '370 Enviro LLC', role: 'Owner' }, { id: B, name: 'Acme Septic', role: 'Owner' }], invitations: [] });
      }
      if (url.origin === origin) { const file = files[url.pathname.slice(1) || 'index.html']; return file ? route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }) : route.fulfill({ status: 404 }); }
      if (url.origin === 'https://test.supabase.co') return route.fulfill({ json: { id: 'u1', email: 'owner@example.com' } });
      return route.abort();
    });
    await context.addInitScript(() => { if (location.origin === 'https://rigo-test.example') localStorage.setItem('rigo-auth-session-v1', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600 })); });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/?company=' + A);
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Process builder' }).click();
    const box = page.locator('#rigo-config [data-sharing]');
    await box.getByText('Shared by Acme Septic').waitFor();
    // Propose sharing (needs a list), then accept the incoming share and copy a record.
    await box.getByRole('button', { name: 'Propose sharing' }).click();
    await box.getByText('Choose at least one list.').waitFor();
    await box.getByLabel('Clients').check();
    await box.getByLabel('Locations').check();
    await box.getByRole('button', { name: 'Propose sharing' }).click();
    await box.getByText(/Proposed\. An owner of that company must accept it\./).waitFor();
    assert.deepEqual(posts.at(-1), { op: 'propose', from: A, to: B, lists: ['clients', 'locations'] });
    page.once('dialog', d => d.accept());
    await box.getByRole('button', { name: 'Accept' }).click();
    await box.getByText('From Acme Septic').waitFor();
    await box.getByText('Clients (1)').click();
    await box.getByRole('button', { name: 'Copy selected into this company' }).click();
    await box.getByText('Select the records to copy.').waitFor();
    await box.getByLabel('Select Lakeside RV Park').check();
    await box.getByRole('button', { name: 'Copy selected into this company' }).click();
    await box.getByText('Copied 1 record(s).').waitFor();
    assert.deepEqual(posts.at(-1), { op: 'copy', workspace: A, shareId: 's1', listId: 'clients', rowIds: ['r1'] });
    await page.screenshot({ path: shots + '/rigo-f-sharing.png', fullPage: true });
    // All my companies, from the switcher: each company's money on its own row.
    await page.getByRole('button', { name: /^Jobs$/ }).first().click();
    await page.locator('.user-menu').click();
    await page.getByRole('menuitem', { name: 'Switch company' }).click();
    await page.locator('#rigo-switcher').getByRole('button', { name: 'All my companies' }).click();
    const overview = page.locator('#rigo-overview');
    await overview.getByText('Acme Septic').waitFor();
    assert.equal(await overview.locator('tbody tr').count(), 2);
    assert.equal(await overview.getByText('$1,250.00').count(), 0, 'amounts are never combined');
    await page.screenshot({ path: shots + '/rigo-f-overview.png' });
    await overview.getByRole('button', { name: 'Open' }).click();
    await page.waitForURL(u => u.search.includes('company=' + B));
    assert.deepEqual(errors, []);
    await context.close();
    console.log('Sharing browser checks passed: propose with validation, accept, read-only shared records, copy on request, all-companies view without combined money.');
  } finally { if (browser) await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
