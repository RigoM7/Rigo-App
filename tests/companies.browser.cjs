// Milestone A browser checks: entry routing, company creation, invitations, picker, deep links,
// switcher, per-tab company binding, leaving a company, keyboard use and narrow screens.
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const domain = require('../lib/domain.cjs');
const origin = 'https://rigo-test.example';
const shots = process.env.RIGO_SHOTS || '/tmp';
const A = '0a000000-0000-4000-8000-000000000001', B = '0b000000-0000-4000-8000-000000000002';
const C = '0c000000-0000-4000-8000-000000000003', NEW = '0d000000-0000-4000-8000-000000000004';
const UNKNOWN = '0e000000-0000-4000-8000-000000000005';

function company(id, name) { const state = domain.createState(name); state.id = id; return state; }
// An in-memory stand-in for /api/rigo with per-account memberships.
function fakeApi() {
  const states = { [A]: company(A, '370 Enviro LLC'), [B]: company(B, 'Acme Septic'), [C]: company(C, 'Bay Pumping') };
  const api = {
    states, posts: [], creates: [], leaves: [], failNextCreate: false,
    members: { [A]: 'Owner', [B]: 'Dispatcher' },
    invitations: [{ id: 'inv-c', workspace: C, company: 'Bay Pumping', role: 'Viewer', expiresAt: '2026-10-19T00:00:00Z' }],
    async handle(route) {
      const request = route.request(); const url = new URL(request.url()); const name = url.searchParams.get('route');
      const body = request.method() === 'POST' ? request.postDataJSON() : null;
      const json = (data, status = 200) => route.fulfill({ status, json: data });
      if (name === 'config') return json({ configured: true, url: 'https://test.supabase.co', key: 'public-key' });
      if (name === 'requests') return json({ requests: [], signupUrl: origin + '/?signup=1&join=' + url.searchParams.get('workspace') });
      if (name === 'companies') {
        api.creates.push(body);
        if (api.failNextCreate) { api.failNextCreate = false; return json({ error: 'Network error.' }, 502); }
        states[NEW] ||= company(NEW, body.name); api.members[NEW] = 'Owner';
        return json({ id: NEW });
      }
      if (name === 'invitations') {
        const invite = api.invitations.find(i => i.id === body.id);
        api.invitations = api.invitations.filter(i => i.id !== body.id);
        if (body.op === 'accept') { api.members[invite.workspace] = invite.role; return json({ status: 'accepted', workspace: invite.workspace }); }
        return json({ status: 'declined' });
      }
      if (name === 'leave') { api.leaves.push(body); delete api.members[body.workspace]; return json({ ok: true }); }
      if (name !== 'workspaces') return json({ error: 'Unknown request.' }, 404);
      if (body) {
        if (!api.members[body.id]) return json({ error: 'You do not have access to this company.' }, 403);
        api.posts.push(body); return json({ ok: true });
      }
      const id = url.searchParams.get('id');
      if (id) {
        if (!api.members[id]) return json({ error: 'You do not have access to this company.' }, 403);
        return json({ state: states[id], version: 1, role: api.members[id], user: 'owner@example.com', audit: [] });
      }
      return json({ user: 'owner@example.com', userId: 'user-1',
        workspaces: Object.entries(api.members).map(([wid, role]) => ({ id: wid, name: states[wid].state?.name || states[wid].name, role })).sort((x, y) => x.name.localeCompare(y.name)),
        invitations: api.invitations.map(({ workspace, ...rest }) => rest) });
    }
  };
  return api;
}
async function setup(browser, api, { width = 1280, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.route(origin + '/**', route => {
    const filename = new URL(route.request().url()).pathname.slice(1) || 'index.html';
    if (!['index.html', 'rigo-access.js', 'rigo-access.css'].includes(filename)) return route.fulfill({ status: 404 });
    return route.fulfill({ body: fs.readFileSync(filename), contentType: filename.endsWith('.js') ? 'application/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html' });
  });
  await context.route(/\/api\/rigo\?/, route => api.handle(route));
  await context.route('https://test.supabase.co/auth/v1/**', route => route.fulfill({ json: { id: 'user-1', email: 'owner@example.com' } }));
  await context.addInitScript(() => {
    if (location.origin === 'https://rigo-test.example' && !localStorage.getItem('rigo-auth-session-v1')) localStorage.setItem('rigo-auth-session-v1', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600 }));
  });
  const errors = [];
  context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
  return { context, errors };
}
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const companyOf = page => page.evaluate(() => window.Rigo.workspaceId);

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox'] });

    // 1. A brand-new account sees onboarding (no company, nothing opened) and can create one safely.
    {
      const api = fakeApi(); api.members = {}; api.invitations = [];
      const { context, errors } = await setup(browser, api, { width: 375, height: 800 });
      const page = await context.newPage();
      await page.goto(origin);
      await page.getByRole('heading', { name: 'Welcome to Rigo' }).waitFor();
      assert.equal(await page.locator('.operations-content').count(), 0, 'no company is opened by default');
      assert.equal(await page.getByText('Coming soon.', { exact: false }).count(), 1, 'demo is shown as not yet available');
      assert(await noSideScroll(page), 'onboarding fits a phone screen');
      await page.screenshot({ path: shots + '/rigo-a-onboarding-mobile.png', fullPage: true });
      await page.getByRole('button', { name: /Create my company/ }).click();
      await page.getByRole('heading', { name: 'Create a company' }).waitFor();
      await page.getByRole('button', { name: 'Create company' }).click();
      await page.getByText('Enter the company name.').waitFor();
      assert.equal(await page.getByLabel(/Company name/).getAttribute('aria-invalid'), 'true');
      await page.getByLabel(/Company name/).fill('Rivera Plumbing');
      api.failNextCreate = true;
      await page.getByRole('button', { name: 'Create company' }).click();
      await page.getByText(/Network error\. Your entry is kept/).waitFor();
      assert.equal(await page.getByLabel(/Company name/).inputValue(), 'Rivera Plumbing');
      await page.screenshot({ path: shots + '/rigo-a-create-retry-mobile.png', fullPage: true });
      await page.getByRole('button', { name: 'Create company' }).click();
      await page.waitForURL(url => url.search.includes('company=' + NEW));
      await page.locator('.operations-content').waitFor();
      assert.equal(api.creates.length, 2);
      assert.equal(api.creates[0].requestId, api.creates[1].requestId, 'a retry reuses the request ID');
      assert.equal(await companyOf(page), NEW);
      assert(await noSideScroll(page));
      assert.deepEqual(errors, []);
      await context.close();
    }

    // 2. Invitations come first; then a picker (keyboard operable); deep links are checked.
    {
      const api = fakeApi();
      const { context, errors } = await setup(browser, api);
      const page = await context.newPage();
      await page.goto(origin);
      await page.getByRole('heading', { name: 'You have an invitation' }).waitFor();
      await page.getByText('Bay Pumping').waitFor();
      await page.screenshot({ path: shots + '/rigo-a-invitation.png' });
      await page.getByRole('button', { name: 'Decide later' }).click();
      await page.getByRole('heading', { name: 'Choose a company' }).waitFor();
      assert.equal(await page.locator('.operations-content').count(), 0, 'no default company with several memberships');
      await page.screenshot({ path: shots + '/rigo-a-picker.png' });
      // Keyboard: focus moves through company buttons in visual order; Enter opens one.
      const focused = () => page.evaluate(() => document.activeElement.dataset.id);
      await page.locator('.rigo-company').first().focus();
      assert.equal(await focused(), A);
      await page.keyboard.press('Tab');
      assert.equal(await focused(), B);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await focused(), A);
      await page.keyboard.press('Enter');
      await page.locator('.operations-content').waitFor();
      assert.equal(await companyOf(page), A);
      assert(page.url().includes('company=' + A));
      // A remembered choice opens next time; an unknown company link gets a neutral message.
      await page.goto(origin + '/?company=' + UNKNOWN);
      await page.getByRole('heading', { name: 'You have an invitation' }).waitFor();
      await page.getByRole('button', { name: 'Accept' }).click();
      await page.locator('.operations-content').waitFor();
      assert.equal(await companyOf(page), C, 'accepting opens the company joined');
      assert.equal(api.members[C], 'Viewer');
      await page.goto(origin + '/?company=' + UNKNOWN);
      await page.getByRole('heading', { name: 'Choose a company' }).waitFor();
      await page.getByText('That company link is not available to this account.', { exact: false }).waitFor();
      assert.equal(await page.locator('.rigo-company').count(), 3);
      await page.goto(origin);
      await page.locator('.operations-content').waitFor();
      assert.equal(await companyOf(page), C, 'the remembered company opens');
      assert.deepEqual(errors, []);
      await context.close();
    }

    // 3. Switcher, per-tab binding, offline queue per company, leaving a company.
    {
      const api = fakeApi(); api.invitations = [];
      const { context, errors } = await setup(browser, api);
      const first = await context.newPage();
      await first.goto(origin);
      await first.evaluate(() => {
        localStorage.setItem('rigo-pending-owner@example.com', '[]');
        localStorage.setItem('fieldbase-html-workspace', '0a000000-0000-4000-8000-000000000001');
      });
      await first.goto(origin + '/?company=' + A);
      await first.locator('.operations-content').waitFor();
      const keys = await first.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('rigo-pending-')));
      assert.deepEqual(keys, ['rigo-pending-owner@example.com:' + A], 'the legacy queue moves to the company it belonged to');
      // Second tab switches to another company.
      const second = await context.newPage();
      await second.goto(origin + '/?company=' + A);
      await second.locator('.operations-content').waitFor();
      await second.locator('.user-menu').click();
      await second.getByRole('menuitem', { name: 'Switch company' }).click();
      const dialog = second.locator('#rigo-switcher');
      await dialog.waitFor();
      assert.equal(await dialog.locator('[aria-current="true"]').getAttribute('data-id'), A);
      await second.screenshot({ path: shots + '/rigo-a-switcher.png' });
      await dialog.getByRole('button', { name: /Acme Septic/ }).click();
      await second.waitForURL(url => url.search.includes('company=' + B));
      await second.locator('.operations-content').waitFor();
      assert.equal(await companyOf(second), B);
      // The first tab stays bound to its own company; its writes carry that company explicitly.
      assert.equal(await companyOf(first), A);
      await first.getByRole('button', { name: 'App settings', exact: true }).click();
      await first.getByRole('tab', { name: 'Permissions' }).click();
      await first.getByPlaceholder('name@company.com').fill('helper@example.com');
      await first.getByRole('button', { name: 'Send invitation', exact: true }).click();
      for (let i = 0; i < 50 && !api.posts.length; i++) await new Promise(r => setTimeout(r, 100));
      assert.equal(api.posts.at(-1)?.id, A, 'write goes to the tab\'s company even after another tab switched');
      // Owner sees the Owner role option; a Dispatcher company hides People & access invites.
      await first.getByRole('combobox').filter({ hasText: /Dispatcher|Administrator|Field employee|Viewer|Owner/ }).first().click();
      assert.equal(await first.getByRole('option', { name: 'Owner', exact: true }).count(), 1);
      await first.keyboard.press('Escape');
      // Leave a company from the switcher (with confirmation).
      second.once('dialog', d => d.accept());
      await second.locator('.user-menu').click();
      await second.getByRole('menuitem', { name: 'Switch company' }).click();
      await second.getByRole('button', { name: 'Leave Acme Septic' }).click();
      await second.waitForURL(url => !url.search.includes('company=' + B));
      assert.deepEqual(api.leaves, [{ workspace: B }]);
      await second.locator('.operations-content').waitFor();
      assert.equal(await companyOf(second), A, 'with one company left, it opens');
      assert.deepEqual(errors, []);
      await context.close();
    }

    // 4. Narrow screen picker and switcher fit without sideways scrolling.
    {
      const api = fakeApi(); api.invitations = [];
      const { context, errors } = await setup(browser, api, { width: 360, height: 740 });
      const page = await context.newPage();
      await page.goto(origin);
      await page.getByRole('heading', { name: 'Choose a company' }).waitFor();
      assert(await noSideScroll(page));
      const box = await page.locator('.rigo-company').first().boundingBox();
      assert(box.height >= 44, 'company buttons are touch-sized');
      await page.screenshot({ path: shots + '/rigo-a-picker-mobile.png', fullPage: true });
      await page.locator('.rigo-company').first().click();
      await page.locator('.operations-content').waitFor();
      const menu = await page.locator('.user-menu').boundingBox();
      assert(menu && menu.width >= 44 && menu.height >= 44, 'the account menu stays reachable on phones');
      await page.screenshot({ path: shots + '/rigo-a-app-mobile.png' });
      await page.locator('.user-menu').click();
      await page.getByRole('menuitem', { name: 'Switch company' }).click();
      await page.locator('#rigo-switcher').waitFor();
      assert(await noSideScroll(page));
      await page.screenshot({ path: shots + '/rigo-a-switcher-mobile.png' });
      await page.keyboard.press('Escape');
      await page.locator('#rigo-switcher').waitFor({ state: 'detached' });
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Company browser checks passed: onboarding, create + retry, invitations, picker, deep link, switcher, tab binding, offline queue, leave, keyboard, narrow screens.');
  } finally { if (browser) await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
