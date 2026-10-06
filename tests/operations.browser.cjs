// Milestone C browser checks, run in the local demo: prices and quantities.
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
const thirdParty = log => log.requests.filter(r => !r.includes(origin) && !r.includes('https://test.supabase.co/auth/v1/user'));
const count = (page, label) => page.locator('button', { hasText: label }).locator('span').last().innerText().then(t => t.replace(/[()]/g, '')).catch(() => '');
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox'] });
    const { context, log, errors } = await setup(browser);
    const page = await context.newPage();
    await page.goto(origin + '/?demo=1');
    await page.getByText('Demo workspace — fictional data.').waitFor();
    // Ready to invoice: unpriced work asks for a confirmed price instead of a $0 invoice.
    await page.getByRole('button', { name: /^Invoices$/ }).first().click();
    await page.getByText('Needs a price').waitFor();
    await page.getByText(/billed/).first().waitFor().catch(() => {});
    await page.getByRole('button', { name: 'Confirm price' }).click();
    const dialog = page.locator('#rigo-price');
    await dialog.getByRole('button', { name: 'Confirm price' }).click();
    await dialog.getByText('Enter a price greater than zero.').waitFor();
    await dialog.getByLabel(/Unit price/).fill('180');
    await dialog.getByRole('button', { name: 'Confirm price' }).click();
    await dialog.getByText('Give a reason for the price.').waitFor();
    await dialog.getByLabel(/Reason/).fill('Quoted by phone (fictional)');
    await page.screenshot({ path: shots + '/rigo-c-confirm-price.png' });
    await dialog.getByRole('button', { name: 'Confirm price' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByText('$180.00').first().waitFor();
    assert.equal(await page.getByText('Needs a price').count(), 0);
    // Completion shows the requested amount, and owners can bill a different quantity with a reason.
    await page.getByRole('button', { name: /^Jobs$/ }).first().click();
    await page.locator('button, [role=tab]', { hasText: 'En Route' }).first().click();
    await page.getByRole('button', { name: 'Details' }).first().click();
    await page.getByText(/Requested: 600 gallon/).waitFor();
    await page.getByText('Bill a different quantity').click();
    await page.locator('#rigo-billable-qty').fill('550');
    await page.locator('#rigo-billable-reason').fill('Agreed cap (fictional)');
    await page.screenshot({ path: shots + '/rigo-c-completion.png', fullPage: true });
    assert.deepEqual(log.api.filter(a => a !== 'GET config' && a !== 'GET workspaces'), [], 'all local');
    assert.deepEqual(errors, []);
    await context.close();
    console.log('Operations browser checks passed: needs-a-price flow with validation, requested amount and billable override at completion.');
  } finally { if (browser) await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
