// Milestone B browser checks: the demo is isolated, local and side-effect free.
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const origin = 'https://rigo-test.example';
const shots = process.env.RIGO_SHOTS || '/tmp';
const REAL = '0a000000-0000-4000-8000-000000000001';
const files = { 'index.html': 'index.html', 'rigo-access.js': 'rigo-access.js', 'rigo-access.css': 'rigo-access.css', 'rigo-demo-seed.js': 'lib/demo-seed.js' };

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

    // 1. An account with no company explores the demo; it is local and fictional.
    {
      const { context, log, errors } = await setup(browser);
      const page = await context.newPage();
      await page.goto(origin);
      await page.getByRole('button', { name: /Explore the demo/ }).click();
      await page.getByText('Demo workspace — fictional data.').waitFor();
      await page.getByText('Prairie Services Co. (demo)').first().waitFor();
      assert.equal(await page.locator('.html-toolbar').count() ? await page.locator('.html-toolbar').isVisible() : false, false);
      assert.equal(await count(page, 'All Jobs'), '8');
      await page.screenshot({ path: shots + '/rigo-b-demo.png' });
      const apiBefore = log.api.length;
      // A real write in the demo: dispatch the new request, through the app's own rules.
      await page.getByRole('button', { name: 'Mark Dispatched' }).first().click();
      await page.waitForFunction(() => document.body.innerText.includes('Dispatched'));
      await page.waitForTimeout(500);
      assert.equal(await count(page, 'Call Received'), '0', 'the demo job moved');
      // Map view makes no third-party request.
      await page.getByRole('tab', { name: 'Map' }).or(page.getByRole('button', { name: 'Map', exact: true })).first().click();
      await page.waitForTimeout(500);
      assert.deepEqual(log.api.slice(apiBefore), [], 'the demo never calls the server');
      assert.deepEqual(thirdParty(log), [], 'no third-party requests');
      // Automation modes are prepared examples.
      await page.getByRole('button', { name: 'Automation modes' }).click();
      await page.getByRole('heading', { name: 'How much Rigo handles' }).waitFor();
      await page.screenshot({ path: shots + '/rigo-b-modes.png' });
      await page.keyboard.press('Escape');
      await page.locator('#rigo-modes').waitFor({ state: 'detached' });
      // Reset restores the seed and touches nothing else.
      const other = await page.evaluate(() => { localStorage.setItem('fieldbase-html-workspace', 'real-marker'); return Object.keys(localStorage).filter(k => !k.startsWith('rigo-demo')).sort(); });
      page.once('dialog', d => d.accept());
      await page.getByRole('button', { name: 'Reset demo' }).click();
      await page.getByText('Demo workspace — fictional data.').waitFor();
      await page.waitForFunction(() => document.body.innerText.includes('Call Received'));
      assert.equal(await count(page, 'Call Received'), '1', 'reset restores the sample data');
      assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(k => !k.startsWith('rigo-demo')).sort()), other, 'reset changes only demo storage');
      assert.equal(await page.evaluate(() => localStorage.getItem('fieldbase-html-workspace')), 'real-marker', 'the demo leaves real markers alone');
      assert.deepEqual(errors, []);
      await context.close();
    }

    // 2. Role preview: the field view shows only that driver's work and changes no real access.
    {
      const { context, log, errors } = await setup(browser);
      const page = await context.newPage();
      await page.goto(origin + '/?demo=1');
      await page.getByText('Demo workspace — fictional data.').waitFor();
      await page.locator('#rigo-demo-role').selectOption('Field employee');
      await page.getByText('Demo workspace — fictional data.').waitFor();
      await page.waitForFunction(() => /All Jobs/.test(document.body.innerText));
      assert.equal(await count(page, 'All Jobs'), '2', 'only the previewed driver’s jobs');
      await page.screenshot({ path: shots + '/rigo-b-field-preview.png' });
      await page.locator('#rigo-demo-role').selectOption('Viewer');
      await page.getByText('Demo workspace — fictional data.').waitFor();
      await page.waitForFunction(() => /All Jobs/.test(document.body.innerText));
      assert.equal(await count(page, 'All Jobs'), '8');
      assert.ok(log.api.every(a => a === 'GET config' || a === 'GET workspaces'), 'role preview never calls membership endpoints: ' + log.api.join(', '));
      assert.deepEqual(errors, []);
      await context.close();
    }

    // 3. A person with a real company: demo actions never reach that company; accounts are separate.
    {
      const { context, log, errors } = await setup(browser, { companies: [{ id: REAL, name: '370 Enviro LLC', role: 'Owner' }] });
      const page = await context.newPage();
      await page.goto(origin + '/?demo=1');
      await page.getByText('Demo workspace — fictional data.').waitFor();
      await page.getByRole('button', { name: 'Mark Dispatched' }).first().click();
      await page.waitForTimeout(800);
      assert.ok(!log.api.some(a => a.startsWith('POST')), 'no write reached the server');
      assert.equal(await page.evaluate(() => window.Rigo.workspaceId), null, 'no real company is bound in the demo');
      // Another account in the same browser sees its own fresh demo.
      await context.close();
    }
    {
      const { context, errors } = await setup(browser, { account: { id: 'user-1', email: 'one@example.com' } });
      const page = await context.newPage();
      await page.goto(origin + '/?demo=1');
      await page.getByText('Demo workspace — fictional data.').waitFor();
      await page.getByRole('button', { name: 'Mark Dispatched' }).first().click();
      await page.waitForTimeout(800);
      const state = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
      await context.close();
      const second = await setup(browser, { account: { id: 'user-2', email: 'two@example.com' } });
      await second.context.addInitScript(saved => { if (location.origin === 'https://rigo-test.example' && !localStorage.getItem('seeded')) { for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v); localStorage.setItem('seeded', '1'); } }, state);
      const other = await second.context.newPage();
      await other.goto(origin + '/?demo=1');
      await other.getByText('Demo workspace — fictional data.').waitFor();
      await other.waitForFunction(() => /Call Received/.test(document.body.innerText));
      assert.equal(await count(other, 'Call Received'), '1', 'the second account does not see the first account’s demo changes');
      assert.deepEqual([...errors, ...second.errors], []);
      await second.context.close();
    }

    // 3b. An outdated demo from an earlier seed version is replaced, with a notice.
    {
      const { context, errors } = await setup(browser);
      await context.addInitScript(() => {
        if (location.origin === 'https://rigo-test.example' && !sessionStorage.getItem('stale')) {
          localStorage.setItem('rigo-demo:user-1', JSON.stringify({ state: { demoSeed: 1, id: 'demo-workspace' }, version: 9, audit: [] }));
          sessionStorage.setItem('stale', '1');
        }
      });
      const page = await context.newPage();
      await page.goto(origin + '/?demo=1');
      await page.getByText('The demo was refreshed with new sample data.').waitFor();
      await page.waitForFunction(() => /All Jobs/.test(document.body.innerText));
      assert.equal(await count(page, 'All Jobs'), '8');
      assert.deepEqual(errors, []);
      await context.close();
    }

    // 4. Blocked storage is explained, not broken.
    {
      const { context } = await setup(browser, { blockStorage: true });
      const page = await context.newPage();
      await page.goto(origin + '/?demo=1');
      await page.getByRole('heading', { name: 'The demo needs browser storage' }).waitFor();
      await context.close();
    }

    // 5. From the demo to a real company: structure only, generated on the server.
    {
      const { context, log, errors } = await setup(browser, { width: 375, height: 812 });
      const page = await context.newPage();
      await page.goto(origin + '/?demo=1');
      await page.getByText('Demo workspace — fictional data.').waitFor();
      assert(await noSideScroll(page));
      const bar = await page.locator('#rigo-demo-bar').boundingBox();
      assert(bar.height < 120, 'the demo bar stays compact on phones');
      await page.screenshot({ path: shots + '/rigo-b-demo-mobile.png' });
      await page.getByRole('button', { name: 'Demo options' }).click();
      await page.getByRole('button', { name: 'Create my company' }).waitFor();
      await page.screenshot({ path: shots + '/rigo-b-demo-mobile-open.png' });
      // Keyboard: the controls are reachable in order.
      await page.locator('#rigo-demo-role').focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'rigo-demo-modes');
      await page.getByRole('button', { name: 'Create my company' }).click();
      await page.getByRole('heading', { name: 'Create a company' }).waitFor();
      await page.getByLabel(/Company name/).fill('Prairie Real Co');
      await page.getByText('All three', { exact: true }).click();
      await page.getByText('What is copied and what is not').click();
      assert(await noSideScroll(page));
      await page.screenshot({ path: shots + '/rigo-b-create-structure.png', fullPage: true });
      await page.getByRole('button', { name: 'Create company' }).click();
      await page.waitForURL(url => url.search.includes('company=' + REAL));
      assert.equal(log.creates.length, 1);
      assert.equal(log.creates[0].template, 'combined');
      assert.equal(log.creates[0].name, 'Prairie Real Co');
      assert.deepEqual(Object.keys(log.creates[0]).sort(), ['name', 'requestId', 'template'], 'no demo data is sent');
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Demo browser checks passed: local and fictional, no server or third-party calls, reset, role preview, account separation, real company untouched, blocked storage, structure-only creation, keyboard, phone.');
  } finally { if (browser) await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
