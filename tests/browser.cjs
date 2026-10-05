const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const domain = require('../lib/domain.cjs');
(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox'] });
    const origin = 'https://rigo-test.example';
    const context = await browser.newContext();
    await context.route(origin + '/**', route => {
      const filename = new URL(route.request().url()).pathname.slice(1) || 'index.html';
      if (!['index.html', 'rigo-access.js', 'rigo-access.css'].includes(filename)) return route.fulfill({ status: 404 });
      return route.fulfill({ body: fs.readFileSync(filename), contentType: filename.endsWith('.js') ? 'application/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    // The deployed app must continue to work before Supabase is configured.
    const local = await context.newPage();
    const errors = []; local.on('pageerror', e => errors.push(e.message));
    await local.route('**/api/rigo?*', route => route.fulfill({ json: { configured: false } }));
    await local.goto(origin);
    await local.getByRole('button', { name: 'App settings', exact: true }).click();
    await local.getByRole('tab', { name: 'Permissions' }).click();
    await local.getByPlaceholder('name@company.com').fill('employee@gmail.com');
    assert(await local.getByRole('button', { name: 'Send invitation', exact: true }).isDisabled());
    assert.equal(await local.getByRole('button', { name: 'Download backup' }).count(), 1);
    assert.equal(errors.length, 0, errors.join('\n'));
    await local.close();

    const page = await context.newPage();
    const state = domain.createState('Rigo'); state.id = '22222222-2222-4222-8222-222222222222';
    let signedIn = false;
    const requests = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/rigo?*', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.searchParams.get('route') === 'config') return route.fulfill({ json: { configured: true, url: 'https://test.supabase.co', key: 'public-key' } });
      assert.equal(request.headers().authorization, 'Bearer test-token');
      if (request.method() === 'POST') {
        const body = request.postDataJSON(); requests.push(body);
        state.members = [{ email: body.action.email, role: body.action.role, invitation: { status: 'sent' } }];
        return route.fulfill({ json: { ok: true, invitationSent: true } });
      }
      if (url.searchParams.get('id')) return route.fulfill({ json: { state, version: requests.length + 1, role: 'Owner', user: 'owner@example.com', audit: [] } });
      return route.fulfill({ json: { workspaces: [{ id: state.id, name: state.name, role: 'Owner' }], invitations: [], user: 'owner@example.com', userId: 'owner' } });
    });
    await page.route('https://test.supabase.co/auth/v1/**', route => {
      if (route.request().url().includes('token?')) { signedIn = true; return route.fulfill({ json: { access_token: 'test-token', refresh_token: 'refresh', expires_in: 3600 } }); }
      return route.fulfill({ json: { id: 'owner', email: 'owner@example.com' } });
    });
    await page.goto(origin);
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill('owner@example.com');
    await page.getByLabel('Password', { exact: true }).fill('owner-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    // Shared data lives in Supabase, so the browser-backup toolbar is hidden once connected.
    assert.equal(await page.locator('.html-toolbar').count(), 0);
    await page.getByRole('tab', { name: 'Permissions' }).click();
    await page.getByPlaceholder('name@company.com').fill('employee@gmail.com');
    await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
    await page.getByText('Dispatcher · Invitation sent', { exact: true }).waitFor();
    assert(signedIn); assert.equal(requests[0].action.email, 'employee@gmail.com');
    assert.equal(errors.length, 0, errors.join('\n'));
    await page.screenshot({ path: '/tmp/rigo-invitations.png', fullPage: true });
    // Invitation callback strips token from the URL and requires a matching password.
    await page.goto(origin + '/?invite=1#access_token=test-token&refresh_token=refresh&expires_in=3600&type=invite');
    await page.getByRole('heading', { name: 'Set your Rigo password' }).waitFor();
    assert(!page.url().includes('access_token'));
    await page.getByLabel('New password').fill('employee-password');
    await page.getByLabel('Confirm password').fill('different-password');
    await page.getByRole('button', { name: 'Save password and continue' }).click();
    await page.getByText('Passwords must match.', { exact: true }).waitFor();
    await page.getByLabel('Confirm password').fill('employee-password');
    await page.getByRole('button', { name: 'Save password and continue' }).click();
    await page.getByRole('button', { name: 'App settings', exact: true }).waitFor();
    assert.equal(errors.length, 0, errors.join('\n'));
    // Employee self-signup: shared link opens the sign-up form, then the request waits for approval.
    const joiner = await browser.newContext();
    await joiner.route(origin + '/**', route => {
      const filename = new URL(route.request().url()).pathname.slice(1) || 'index.html';
      if (!['index.html', 'rigo-access.js', 'rigo-access.css'].includes(filename)) return route.fulfill({ status: 404 });
      return route.fulfill({ body: fs.readFileSync(filename), contentType: filename.endsWith('.js') ? 'application/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    const employeePage = await joiner.newPage();
    employeePage.on('pageerror', e => errors.push(e.message));
    let signupBody, requestBody, signupUrl;
    await employeePage.route('**/api/rigo?*', async route => {
      const url = new URL(route.request().url()); const name = url.searchParams.get('route');
      if (name === 'config') return route.fulfill({ json: { configured: true, url: 'https://test.supabase.co', key: 'public-key' } });
      if (name === 'requests') { requestBody = route.request().postDataJSON(); return route.fulfill({ json: { status: 'pending' } }); }
      return route.fulfill({ json: { workspaces: [], invitations: [], user: 'new@example.com', userId: 'new' } });
    });
    await employeePage.route('https://test.supabase.co/auth/v1/**', route => {
      const url = route.request().url();
      if (url.includes('/signup')) { signupUrl = url; signupBody = route.request().postDataJSON(); return route.fulfill({ json: { access_token: 'new-token', refresh_token: 'r', expires_in: 3600 } }); }
      return route.fulfill({ json: { id: 'new', email: 'new@example.com', user_metadata: { full_name: 'New Hire' } } });
    });
    await employeePage.goto(origin + '/?signup=1&join=' + state.id);
    await employeePage.getByRole('heading', { name: 'Create your Rigo account' }).waitFor();
    await employeePage.getByLabel('Full name').fill('New Hire');
    await employeePage.getByLabel('Email').fill('new@example.com');
    await employeePage.getByLabel('Password', { exact: true }).fill('new-password');
    await employeePage.getByLabel('Confirm password').fill('new-password');
    await employeePage.getByRole('button', { name: 'Create account' }).click();
    await employeePage.getByRole('heading', { name: 'Waiting for approval' }).waitFor();
    assert.equal(signupBody.data.full_name, 'New Hire');
    assert.deepEqual(requestBody, { op: 'request', workspace: state.id, name: 'New Hire' });
    assert.ok(signupUrl.includes('join%3D' + state.id), 'the confirmation link keeps the company');
    await employeePage.screenshot({ path: '/tmp/rigo-waiting.png' });
    await joiner.close();

    // Owner sees pending requests and approves with a role.
    const decisions = [];
    await page.route(/\/api\/rigo\?.*route=requests/, route => {
      if (route.request().method() === 'POST') { decisions.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ json: { signupUrl: origin + '/?signup=1&join=' + state.id, requests: decisions.length ? [] : [{ id: 'req-1', email: 'new@example.com', name: 'New Hire', at: '2026-10-05T00:00:00Z' }] } });
    });
    await page.goto(origin);
    await page.getByRole('button', { name: 'Access requests (1)' }).click();
    await page.getByText('New Hire', { exact: true }).waitFor();
    await page.getByLabel('Role for new@example.com').selectOption('Dispatcher');
    await page.screenshot({ path: '/tmp/rigo-requests.png' });
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.getByText('No pending requests.').waitFor();
    assert.deepEqual(decisions[0], { op: 'approve', workspace: state.id, requestId: 'req-1', role: 'Dispatcher' });
    assert.equal(errors.length, 0, errors.join('\n'));
    // Signing out from the account menu returns to the sign-in page and clears the session.
    await page.locator('.user-menu').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.getByRole('heading', { name: 'Sign in to Rigo' }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('rigo-auth-session-v1')), null);
    await page.screenshot({ path: '/tmp/rigo-signed-out.png' });
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Browser checks passed: employee sign-up, approval queue, sign out.');
    console.log('Browser checks passed: standalone fallback, owner invitation, password setup, token removal.');
  } finally { if (browser) await browser.close();  }
})().catch(error => { console.error(error); process.exitCode = 1; });
