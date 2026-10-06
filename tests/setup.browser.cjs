// Milestone E browser checks: reviewed setup changes, customer messages (never sent), templates.
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
    // 1. In the demo: an assistant-style proposal is reviewed and applied; messages are prepared, not sent.
    {
      const { context, log, errors } = await setup(browser, { height: 1300 });
      const page = await context.newPage();
      await page.goto(origin + '/?demo=1');
      await page.getByText('Demo workspace — fictional data.').waitFor();
      await page.waitForFunction(() => window.rigoAct && window.rigoRef?.current?.state);
      const proposed = await page.evaluate(() => window.rigoAct({ type: 'proposeConfig', source: 'assistant', summary: 'Track hose length for fuel', ops: [{ op: 'addField', list: 'Services', name: 'Hose length', type: 'select', options: ['50 ft', '100 ft'] }] }));
      assert.equal(proposed, true);
      await page.getByRole('button', { name: 'App settings', exact: true }).click();
      await page.getByRole('tab', { name: 'Process builder' }).click();
      const review = page.locator('#rigo-config');
      await review.getByText('Track hose length for fuel').waitFor();
      await review.getByText('Add select field “Hose length” to Services (50 ft, 100 ft)').waitFor();
      await review.getByText(/built-in assistant is not set up/).waitFor();
      assert.equal(await page.evaluate(() => window.rigoRef.current.state.lists.find(l => l.id === 'services').fields.some(f => f.name === 'Hose length')), false, 'not applied before review');
      await page.screenshot({ path: shots + '/rigo-e-review.png', fullPage: true });
      await review.getByRole('button', { name: 'Apply these changes' }).click();
      await page.waitForFunction(() => window.rigoRef.current.state.lists.find(l => l.id === 'services').fields.some(f => f.name === 'Hose length'));
      // Customer messages: explicit opt-in, wording, outbox; nothing is sent.
      page.once('dialog', d => d.accept());
      await review.getByLabel(/Prepare customer messages/).check();
      await page.waitForFunction(() => window.rigoRef.current.state.messaging?.enabled);
      await review.getByText('Edit message wording').waitFor();
      await page.getByRole('button', { name: /^Jobs$/ }).first().click();
      const today = page.locator('#rigo-today');
      await today.getByRole('button', { name: "Prepare tomorrow's reminders" }).click();
      await page.waitForFunction(() => (window.rigoRef.current.state.outbox || []).some(m => m.event === 'reminder'));
      await today.getByRole('button', { name: 'Review outbox' }).click();
      const outbox = page.locator('#rigo-outbox');
      await outbox.getByText(/Nothing here has been sent/).waitFor();
      await outbox.getByText(/Not prepared: No email on the client record|Not sent: No email or SMS provider/).first().waitFor();
      await page.screenshot({ path: shots + '/rigo-e-outbox.png' });
      await outbox.getByRole('button', { name: 'Close' }).click();
      assert.ok(await page.evaluate(() => window.rigoRef.current.state.outbox.every(m => m.status !== 'sent')));
      assert.deepEqual(log.api.filter(a => a !== 'GET config' && a !== 'GET workspaces'), [], 'the demo never calls the server');
      assert.deepEqual(thirdParty(log), []);
      assert.deepEqual(errors, []);
      await context.close();
    }
    // 2. A real company (mocked server): save, share and review templates.
    {
      const domain = require('../lib/domain.cjs');
      const state = domain.applyAction(domain.createState('370 Enviro LLC'), { type: 'applyTemplate', template: 'fuel' }, 'Owner');
      const WS = REAL; state.id = WS;
      const calls = [];
      const context = await browser.newContext({ viewport: { width: 1280, height: 1300 } });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === origin && url.pathname.startsWith('/api/rigo')) {
          const name = url.searchParams.get('route'); const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
          if (name === 'config') return route.fulfill({ json: { configured: true, url: 'https://test.supabase.co', key: 'k' } });
          if (name === 'templates') {
            calls.push(body || { get: true });
            if (body?.op === 'publish') return route.fulfill({ json: { id: 'tpl-1', version: 1 } });
            if (body?.op === 'apply') return route.fulfill({ json: { proposal: 'p1' } });
            return route.fulfill({ json: { templates: [{ id: 'tpl-2', name: 'Septic setup', description: 'From a partner', version: 3, mine: false }] } });
          }
          if (name === 'requests') return route.fulfill({ json: { requests: [] } });
          if (name === 'integrations') return route.fulfill({ json: { geocoding: { available: false, enabled: false } } });
          if (name === 'workspaces' && url.searchParams.get('id')) return route.fulfill({ json: { state, version: 1, role: 'Owner', user: 'owner@example.com', audit: [] } });
          return route.fulfill({ json: { user: 'owner@example.com', userId: 'u1', workspaces: [{ id: WS, name: state.name, role: 'Owner' }], invitations: [] } });
        }
        if (url.origin === origin) { const file = files[url.pathname.slice(1) || 'index.html']; return file ? route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }) : route.fulfill({ status: 404 }); }
        if (url.origin === 'https://test.supabase.co') return route.fulfill({ json: { id: 'u1', email: 'owner@example.com' } });
        return route.abort();
      });
      await context.addInitScript(() => { if (location.origin === 'https://rigo-test.example') localStorage.setItem('rigo-auth-session-v1', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600 })); });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(origin);
      await page.getByRole('button', { name: 'App settings', exact: true }).click();
      await page.getByRole('tab', { name: 'Process builder' }).click();
      const box = page.locator('#rigo-config');
      await box.getByText('Septic setup').waitFor();
      await box.getByRole('button', { name: 'Save as template' }).click();
      await box.getByText('Name the template.').waitFor();
      await box.getByLabel('Template name').fill('Fuel delivery setup');
      await box.getByRole('button', { name: 'Save as template' }).click();
      await box.getByText('Saved as version 1.').waitFor();
      assert.deepEqual(calls.find(c => c.op === 'publish'), { op: 'publish', workspace: WS, name: 'Fuel delivery setup', description: '' }, 'no content is sent from the browser');
      await box.getByRole('button', { name: 'Review for this company' }).click();
      await box.getByText(/Nothing has changed yet/).waitFor();
      assert.deepEqual(calls.find(c => c.op === 'apply'), { op: 'apply', templateId: 'tpl-2', version: 3, workspace: WS });
      await page.screenshot({ path: shots + '/rigo-e-templates.png', fullPage: true });
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Setup browser checks passed: reviewed assistant proposal, apply, messages opt-in, reminders, outbox (never sent), templates save/review without client-supplied content.');
  } finally { if (browser) await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
