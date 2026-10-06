// Milestone D browser checks (in the local demo): Today, approvals, issues, recurring service,
// automation settings and the driver's My work today.
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
    const { context, log, errors } = await setup(browser, { height: 1300 });
    const page = await context.newPage();
    await page.goto(origin + '/?demo=1');
    const today = page.locator('#rigo-today');
    await today.getByRole('heading', { name: 'Today', exact: true }).waitFor();
    await today.getByText(/Running late: Gate locked/).waitFor();
    await page.screenshot({ path: shots + '/rigo-d-today.png' });
    // Approve exactly the proposed invoice.
    const invoicesBefore = await page.evaluate(() => window.rigoRef.current.state.invoices.length);
    page.once('dialog', d => d.accept());
    await today.getByRole('button', { name: 'Approve $1,700.00' }).click();
    await page.waitForFunction(n => window.rigoRef.current.state.invoices.length === n + 1, invoicesBefore);
    assert.equal(await page.evaluate(() => window.rigoRef.current.state.invoices.at(-1).total), 1700);
    await today.getByRole('button', { name: /^Approve/ }).waitFor({ state: 'detached' });
    // Resolve the reported problem (needs an outcome).
    await today.getByRole('button', { name: 'Resolve' }).click();
    const resolve = page.locator('#rigo-resolve');
    await resolve.getByLabel(/Outcome/).selectOption('reschedule');
    await resolve.getByLabel('Note').fill('Park manager opens the gate at 3 pm (fictional)');
    await resolve.getByRole('button', { name: 'Mark resolved' }).click();
    await resolve.waitFor({ state: 'detached' });
    await page.waitForFunction(() => !window.rigoRef.current.state.jobs.some(j => (j.issues || []).some(i => i.status === 'open')));
    // Recurring service: planning again is idempotent; pausing archives unstarted visits.
    const visits = () => page.evaluate(() => window.rigoRef.current.state.jobs.filter(j => j.seriesId && !j.archived).length);
    const planned = await visits();
    await today.getByRole('button', { name: 'Plan visits for the next 2 weeks' }).click();
    await page.waitForFunction(() => window.rigoRef.current.state.lastPlanning?.made === 0);
    assert.equal(await visits(), planned, 'no duplicate visits');
    page.once('dialog', d => d.accept());
    await today.getByRole('button', { name: 'Pause', exact: true }).click();
    await today.getByText(/Paused/).first().waitFor();
    // New recurring service with validation.
    await today.getByRole('button', { name: 'New recurring service' }).click();
    const editor = page.locator('#rigo-series');
    await editor.getByRole('button', { name: 'Save' }).click();
    await editor.getByText('Name the recurring service.').waitFor();
    await editor.getByLabel(/Name/).fill('Monthly septic check · Lakeside');
    await editor.getByLabel(/Client/).selectOption({ label: 'Lakeside RV Park' });
    await editor.getByLabel(/Service/).selectOption({ label: 'Septic pump-out' });
    await editor.getByLabel(/^Unit/).selectOption('month');
    await page.screenshot({ path: shots + '/rigo-d-series.png' });
    await editor.getByRole('button', { name: 'Save' }).click();
    await editor.waitFor({ state: 'detached' });
    await today.getByText('Monthly septic check · Lakeside').waitFor();
    // Automation settings live in Process builder; owners choose the mode.
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Process builder' }).click();
    const settings = page.locator('#rigo-automation');
    await settings.getByText('How much Rigo handles').waitFor();
    await settings.getByRole('radio', { name: /^Automatic/ }).check();
    await settings.getByRole('button', { name: 'Save automation settings' }).click();
    await settings.getByText('Saved.').waitFor();
    assert.equal(await page.evaluate(() => window.rigoRef.current.state.automation.default), 'automatic');
    await page.screenshot({ path: shots + '/rigo-d-automation.png', fullPage: true });
    // Driver view: My work today with accept, report a problem and open job.
    await page.locator('#rigo-demo-role').selectOption('Field employee');
    const mine = page.locator('#rigo-today');
    await mine.getByRole('heading', { name: 'My work today' }).waitFor();
    await mine.getByText('Deliver 4 units to Ridgeway jobsite').waitFor();
    await mine.getByText(/Gate code 0000/).waitFor();
    await mine.getByRole('button', { name: 'Accept' }).click();
    await page.waitForFunction(() => window.rigoRef.current.state.jobs.some(j => j.title.startsWith('Deliver 4') && j.acknowledgment?.status === 'Accepted'));
    await mine.getByRole('button', { name: 'Report a problem' }).first().click();
    const issue = page.locator('#rigo-issue');
    await issue.getByLabel(/What happened/).selectOption('equipment_failure');
    await issue.getByLabel('Details').fill('Hand wash pump broken (fictional)');
    await issue.getByRole('button', { name: 'Send to the office' }).click();
    await issue.waitFor({ state: 'detached' });
    await mine.getByText('Reported: Equipment failure').waitFor();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: shots + '/rigo-d-my-work-mobile.png' });
    assert(await noSideScroll(page));
    await mine.getByRole('button', { name: /Open to update or complete/ }).first().click();
    await page.getByText('Complete field work').first().waitFor();
    assert.deepEqual(log.api.filter(a => a !== 'GET config' && a !== 'GET workspaces'), [], 'all local in the demo');
    assert.deepEqual(errors, []);
    await context.close();
    console.log('Today browser checks passed: approve exact invoice, resolve issue, idempotent planning, pause, new series with validation, automation settings, driver accept, report problem, open job, phone.');
  } finally { if (browser) await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
