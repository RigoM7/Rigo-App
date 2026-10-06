// Browser checks for Rigo: real UI flows, both themes, representative widths, axe accessibility
// scan, horizontal overflow, reduced motion and enlarged text. Run against a running server:
//   BASE_URL=http://localhost:8787 NODE_PATH=$(npm root -g) node e2e/run.mjs
// Uses the pre-installed Chromium (PLAYWRIGHT_CHROMIUM_EXECUTABLE or /opt/pw-browsers).
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const OUT = 'e2e/output';
mkdirSync(OUT, { recursive: true });
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? execSync('ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1').toString().trim();
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js', { paths: [process.cwd()] }), 'utf8');

const results = [];
const fail = (name, detail) => { results.push({ name, ok: false, detail }); console.log(`✗ ${name}: ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)}`); };
const pass = (name, detail = '') => { results.push({ name, ok: true, detail }); console.log(`✓ ${name}${detail ? ` (${detail})` : ''}`); };
async function step(name, fn) { try { const d = await fn(); pass(name, d ?? ''); } catch (e) { fail(name, String(e?.message ?? e).split('\n')[0]); } }

const browser = await chromium.launch({ executablePath: exe });
const consoleErrors = [];
function watch(page, label) {
  page.on('pageerror', (e) => consoleErrors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(`${label}: ${m.text()}`); });
}

async function axe(page, label) {
  await page.addScriptTag({ content: axeSource });
  const r = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes.slice(0, 3).map((x) => x.target.join(' ')) })));
  const serious = r.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  if (serious.length) throw new Error(`${label}: ${JSON.stringify(serious)}`);
  return r.length ? `${r.length} minor/moderate: ${r.map((v) => v.id).join(', ')}` : 'no violations';
}

async function noOverflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (o.sw > o.w + 1) throw new Error(`${label}: page is ${o.sw}px wide in a ${o.w}px viewport`);
}

// ---------------------------------------------------------------- accounts and sign-in
// Run only this section with E2E_ONLY=auth.
const { request: pwRequest } = require('playwright');
const STRONG = 'tidy-lantern-orchard-42';
let accountN = 0;
async function apiAccount(name, opts = {}) {
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-rigo': '1' } });
  const mail = `${name.toLowerCase().replace(/\W+/g, '.')}-${Date.now()}-${++accountN}@example.test`;
  const r = await api.post('/api/auth/signup', { data: { name, email: mail, password: STRONG } });
  if (!r.ok()) throw new Error(`signup ${r.status()} ${await r.text()}`);
  let demoId = null;
  if (opts.demo) demoId = (await (await api.post('/api/demo')).json()).id;
  if (opts.company) {
    const c = await api.post('/api/companies', { data: { name: opts.company, timezone: 'America/Chicago', currency: 'USD', categories: ['fuel'], start: 'blank' } });
    if (!c.ok()) throw new Error(`company ${c.status()} ${await c.text()}`);
  }
  await api.dispose();
  return { email: mail, name, demoId };
}
async function signInHere(p, who) {
  await p.getByLabel('Email').fill(who.email);
  await p.getByLabel('Password', { exact: true }).fill(STRONG);
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
}
async function openSignInFromHome(p) {
  await p.goto(`${BASE}/`);
  await p.waitForLoadState('networkidle');
  // Signed out, "/" is the landing page with "Sign in" in its top bar (older builds redirected).
  if (!/\/signin/.test(p.url())) await p.getByRole('link', { name: 'Sign in', exact: true }).first().click();
  await p.waitForURL(/\/signin/);
}

for (const [vw, vh] of [[1440, 900], [390, 844]]) {
  await step(`C1 ${vw}px: from "/", sign in once and land on workspaces`, async () => {
    const who = await apiAccount('Sam Returning');
    const c = await browser.newContext({ viewport: { width: vw, height: vh } });
    const p = await c.newPage(); watch(p, `c1-signin-${vw}`);
    await openSignInFromHome(p);
    await signInHere(p, who);
    await p.waitForURL(/\/workspaces$/, { timeout: 8000 });
    await p.getByRole('heading', { name: 'Hello, Sam' }).waitFor({ timeout: 8000 });
    await c.close();
  });
  await step(`C1 ${vw}px: from "/", create a free account and land on workspaces`, async () => {
    const c = await browser.newContext({ viewport: { width: vw, height: vh } });
    const p = await c.newPage(); watch(p, `c1-signup-${vw}`);
    await p.goto(`${BASE}/`);
    await p.getByRole('link', { name: 'Create a free account' }).first().click();
    await p.waitForURL(/\/signup/);
    await p.getByLabel('Your name').fill('Nina New');
    await p.getByLabel('Email').fill(`nina-${Date.now()}-${vw}@example.test`);
    await p.getByLabel('Password', { exact: true }).fill(STRONG);
    await p.getByRole('button', { name: 'Create account' }).click();
    await p.waitForURL(/\/workspaces$/, { timeout: 8000 });
    await p.getByRole('heading', { name: 'Hello, Nina' }).waitFor({ timeout: 8000 });
    await c.close();
  });
  await step(`C1 ${vw}px: bookmarked pages return to the same page after one sign-in`, async () => {
    const who = await apiAccount('Bea Bookmark', { demo: true });
    for (const path of ['/workspaces', `/c/${who.demoId}/today`]) {
      const c = await browser.newContext({ viewport: { width: vw, height: vh } });
      const p = await c.newPage(); watch(p, `c1-bookmark-${vw}`);
      await p.goto(`${BASE}${path}`);
      await p.waitForURL(/\/signin\?next=/);
      await signInHere(p, who);
      await p.waitForURL((u) => u.pathname === path, { timeout: 8000 });
      await p.locator('main h1').first().waitFor({ timeout: 8000 });
      if (/\/signin/.test(p.url())) throw new Error(`bounced back to sign-in from ${path}`);
      await c.close();
    }
  });
  await step(`C1 ${vw}px: sign out, sign in as someone else in the same tab, no data carries over`, async () => {
    const a = await apiAccount('Alma First', { company: `Alma Fuel ${vw}` });
    const b = await apiAccount('Bruno Second');
    const c = await browser.newContext({ viewport: { width: vw, height: vh } });
    const p = await c.newPage(); watch(p, `c1-switch-${vw}`);
    await p.goto(`${BASE}/signin`);
    await signInHere(p, a);
    await p.getByRole('heading', { name: 'Hello, Alma' }).waitFor({ timeout: 8000 });
    await p.getByText(`Alma Fuel ${vw}`).waitFor();
    await p.getByRole('button', { name: 'Sign out' }).click();
    await p.waitForURL(/\/signin/);
    await signInHere(p, b);
    await p.getByRole('heading', { name: 'Hello, Bruno' }).waitFor({ timeout: 8000 });
    if (await p.getByText(`Alma Fuel ${vw}`).count()) throw new Error("the first user's company is still on screen");
    await c.close();
  });
}
if (process.env.E2E_ONLY === 'auth') {
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
  process.exit(failed ? 1 : 0);
}

const email = `owner-${Date.now()}@example.test`;
const empEmail = `employee-${Date.now()}@example.test`;
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
watch(page, 'owner');

await step('sign-up form creates an account and lands on workspaces', async () => {
  await page.goto(`${BASE}/signup`);
  await page.getByLabel('Your name').fill('Olivia Owner');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/workspaces');
  await page.getByText("You don't belong to a company yet").waitFor();
});

await step('sign-up shows inline errors and a focused error summary', async () => {
  const p2 = await ctx.browser().newPage();
  await p2.goto(`${BASE}/signup`);
  await p2.getByRole('button', { name: 'Create account' }).click();
  await p2.getByRole('alert').waitFor();
  const focused = await p2.evaluate(() => document.activeElement?.getAttribute('role'));
  const inline = await p2.locator('.field-error').count();
  await p2.close();
  if (focused !== 'alert' || inline < 2) throw new Error(`summary focus=${focused}, inline errors=${inline}`);
});

let demoUrl = '';
await step('demo opens with fictional data and a clear demo label', async () => {
  await page.getByRole('button', { name: 'Explore the demo' }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]+$/);
  demoUrl = page.url();
  await page.getByRole('region', { name: 'Demo workspace' }).waitFor();
  await page.getByRole('heading', { name: 'Needs you' }).waitFor();
  await page.screenshot({ path: `${OUT}/demo-home-1440-light.png`, fullPage: true });
});

// Theme is saved to the account and the device; set both like the account menu does.
async function setTheme(t) {
  await page.request.patch(`${BASE}/api/auth/me`, { headers: { 'x-rigo': '1' }, data: { theme: t } });
  await page.evaluate((x) => localStorage.setItem('rigo-theme', x), t);
}
async function assertTheme(t) {
  const got = await page.evaluate(() => document.documentElement.dataset.theme);
  if (got !== t) throw new Error(`expected ${t} theme, page is ${got}`);
}
const cidPath = () => new URL(demoUrl).pathname;
const pages = ['', '?tl=feed', '/jobs', '/jobs?view=board', '/jobs?view=schedule', '/inbox', '/invoices?status=all', '/customers', '/team', '/workflows', '/automation', '/recurring', '/messages', '/services', '/settings', '/templates', '/imports', '/assistant'];

for (const theme of ['light', 'dark']) {
  await step(`axe scan, ${theme} theme, key pages`, async () => {
    await setTheme(theme);
    const notes = [];
    for (const p of pages) {
      await page.goto(`${BASE}${cidPath()}${p}`);
      await page.waitForLoadState('networkidle');
      await page.locator('main h1').first().waitFor();
      await assertTheme(theme);
      notes.push(`${p || '/'}: ${await axe(page, `${theme} ${p || '/'}`)}`);
    }
    return notes.filter((n) => !n.endsWith('no violations')).join('; ') || 'no violations';
  });
}
await setTheme('light');

for (const width of [375, 768, 1024, 1440]) {
  await step(`no horizontal overflow at ${width}px`, async () => {
    await page.setViewportSize({ width, height: width < 800 ? 812 : 900 });
    for (const p of ['', '/jobs', '/inbox', '/invoices?status=all', '/workflows', '/team', '/today']) {
      await page.goto(`${BASE}${cidPath()}${p}`);
      await page.waitForLoadState('networkidle');
      await noOverflow(page, `${width} ${p || '/'}`);
    }
    await page.goto(`${BASE}${cidPath()}`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${OUT}/demo-home-${width}.png`, fullPage: false });
  });
}
await step('mobile shows at most five bottom destinations', async () => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${BASE}${cidPath()}`);
  await page.locator('nav.bottom-nav > a').first().waitFor();
  const n = await page.locator('nav.bottom-nav > a').count();
  if (n > 5) throw new Error(`${n} items`);
  return `${n} items`;
});
await page.setViewportSize({ width: 1440, height: 900 });

await step('home: live timeline with driver lanes, now line, job panel and feed view', async () => {
  await page.goto(`${BASE}${cidPath()}`);
  await page.getByRole('heading', { name: "Today's timeline" }).waitFor();
  await page.getByRole('list', { name: /^Dana Driver/ }).waitFor();
  await page.getByRole('list', { name: /^Unassigned: 1 job/ }).waitFor();
  if ((await page.locator('.tl-now').count()) !== 1) throw new Error('no now line on today');
  await page.getByRole('list', { name: /^Unassigned/ }).getByRole('button', { name: /#3/ }).click();
  const panel = page.getByRole('dialog');
  await panel.getByRole('link', { name: 'Open job' }).waitFor();
  await panel.getByLabel(/Driver for job #3/).waitFor();
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Feed' }).click();
  await page.waitForURL(/tl=feed/);
  await page.getByRole('list', { name: 'Jobs in time order' }).waitFor();
  await page.screenshot({ path: `${OUT}/home-feed-1440.png`, fullPage: true });
});

await step('command menu: Ctrl+K finds a job by number and opens it', async () => {
  await page.goto(`${BASE}${cidPath()}/inbox`);
  await page.locator('main h1').first().waitFor();
  await page.keyboard.press('Control+k');
  const menu = page.getByRole('dialog', { name: 'Command menu' });
  await menu.waitFor();
  await menu.getByRole('combobox').fill('3');
  await menu.getByRole('option', { name: /#3 Fuel delivery/ }).waitFor();
  await page.screenshot({ path: `${OUT}/command-menu.png` });
  await menu.getByRole('option', { name: /#3 Fuel delivery/ }).click();
  await page.waitForURL(/\/jobs\/[0-9a-f-]+$/);
  await page.keyboard.press('Control+k');
  await menu.getByRole('combobox').fill('invoices');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/invoices$/);
});

await step('sidebar collapses to icons and remembers it', async () => {
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await page.reload();
  await page.locator('.shell.nav-collapsed').waitFor();
  await page.getByRole('link', { name: 'Jobs' }).first().waitFor();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  if (await page.locator('.shell.nav-collapsed').count()) throw new Error('still collapsed');
});

let jobPath = '';
await step('dispatcher: assign the unassigned fuel job to Dana from the list', async () => {
  await page.goto(`${BASE}${cidPath()}/jobs?assignee=none`);
  const sel = page.getByLabel(/Driver for job #3/);
  await sel.selectOption({ label: 'Dana Driver (fictional)' });
  await page.getByRole('button', { name: 'Save' }).first().click();
  await page.getByText('Driver assigned').waitFor();
});

await step('create a job through the form (draft explains missing info)', async () => {
  await page.goto(`${BASE}${cidPath()}/jobs/new`);
  await page.getByLabel('Customer', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Save as draft' }).click();
  await page.waitForURL(/\/jobs\/[0-9a-f-]+$/);
  await page.getByText('This draft still needs information').waitFor();
  jobPath = new URL(page.url()).pathname;
});

await step('driver (simulated): completes a job with offline-capable draft and server acceptance', async () => {
  await page.goto(`${BASE}${cidPath()}`);
  await page.getByLabel('Simulated role').selectOption('driver');
  await page.waitForURL(/\/today$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: 'My jobs' }).waitFor();
  await page.locator('a.driver-job', { hasText: 'Fuel delivery' }).first().click();
  await page.getByRole('button', { name: 'Start job' }).click();
  await page.getByText('Job started').waitFor();
  await page.getByLabel(/Delivered quantity/).fill('432.5');
  await page.getByText('Saved on this device').first().waitFor();
  await page.screenshot({ path: `${OUT}/driver-job-390.png`, fullPage: true });
  await page.getByRole('button', { name: 'Submit to office' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  await page.getByText('Accepted. The office has your record.').waitFor();
  await page.getByText(/Recorded as completed successfully/i).waitFor();
});

await step('driver view hides financial and admin destinations', async () => {
  const nav = await page.locator('nav.bottom-nav').innerText();
  if (/Invoices|Team|Settings/.test(nav)) throw new Error(nav);
  const r = await page.request.get(`${BASE}/api${cidPath()}/invoices`);
  if (r.status() !== 403) throw new Error(`invoices API returned ${r.status()} for simulated driver`);
});

await step('owner approves the prepared invoice from the inbox', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}${cidPath()}`);
  await page.getByLabel('Simulated role').selectOption('owner');
  await page.goto(`${BASE}${cidPath()}/inbox`);
  const cards = page.locator('article.card');
  await cards.first().waitFor();
  const before = await cards.count();
  await cards.first().getByRole('button', { name: 'Approve' }).click();
  await page.getByText(/Approved\. Rigo will continue/).waitFor();
  return `${before} approval(s) were waiting`;
});

await step('workflow editor: visual and form views, test, activation guard', async () => {
  await page.goto(`${BASE}${cidPath()}/workflows`);
  await page.getByRole('link', { name: /Completed job to invoice/ }).click();
  await page.getByRole('list', { name: 'Workflow steps' }).waitFor();
  await page.getByRole('button', { name: /Step 2/ }).click();
  await page.getByLabel('Escalate after (hours)').fill('12');
  await page.getByText('Unsaved changes').waitFor();
  await page.getByRole('button', { name: 'Save as new draft version' }).click();
  await page.getByText(/Saved as new draft v2/).waitFor();
  const act = page.getByRole('button', { name: /Activate v2/ });
  if (!(await act.isDisabled())) throw new Error('activate enabled before testing');
  await page.getByRole('button', { name: 'Test with sample data' }).click();
  await page.getByText('Test finished').waitFor();
  await page.getByRole('heading', { name: 'Test results' }).waitFor();
  await page.goto(page.url() + '?view=form');
  await page.getByRole('heading', { name: 'Trigger and conditions' }).waitFor();
  await page.screenshot({ path: `${OUT}/workflow-form.png`, fullPage: true });
});

await step('assistant: prepared response labeled, proposal stays separate', async () => {
  await page.goto(`${BASE}${cidPath()}/assistant`);
  await page.getByLabel('Message the assistant').fill('When a septic job is completed, prepare an invoice and ask the owner to approve it');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText('Prepared response (not AI)').first().waitFor();
  await page.getByRole('link', { name: 'Review proposal' }).first().click();
  await page.getByText('This is a proposal').waitFor();
});

await step('invoice preview renders branded document and print control', async () => {
  await page.goto(`${BASE}${cidPath()}/invoices?status=all`);
  await page.locator('a.row-link').first().click();
  await page.getByRole('article', { name: 'Invoice preview' }).waitFor();
  await page.getByRole('button', { name: /Print/ }).waitFor();
  await page.screenshot({ path: `${OUT}/invoice.png`, fullPage: true });
});

await step('reduced motion and 200% text keep pages usable', async () => {
  const c2 = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce', storageState: await ctx.storageState() });
  const p = await c2.newPage();
  await p.goto(`${BASE}${cidPath()}/jobs`);
  await p.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await p.waitForLoadState('networkidle');
  const dur = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dur').trim());
  await noOverflow(p, '200% text /jobs');
  await p.screenshot({ path: `${OUT}/jobs-375-text200.png` });
  await c2.close();
  if (parseFloat(dur) !== 0) throw new Error(`--dur is ${dur}`);
});

await step('keyboard: skip link and visible focus', async () => {
  await page.goto(`${BASE}${cidPath()}/jobs`);
  await page.locator('main h1').first().waitFor();
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => document.activeElement?.textContent);
  await page.keyboard.press('Enter');
  const outline = await page.evaluate(() => { const el = document.activeElement; return el ? getComputedStyle(el).outlineStyle : ''; });
  if (first !== 'Skip to content') throw new Error(`first tab stop: ${first}`);
  return `focus outline ${outline}`;
});

await step('real company: create, empty state, setup checklist', async () => {
  await page.goto(`${BASE}/workspaces/new`);
  await page.getByLabel('Company name').fill('Acme Septic & Fuel');
  await page.getByLabel('Fuel delivery').check();
  await page.getByLabel('Septic services').check();
  await page.getByRole('button', { name: 'Create company' }).click();
  await page.waitForURL(/\/setup$/);
  await page.getByRole('heading', { name: 'Set up your company' }).waitFor();
  const real = new URL(page.url()).pathname.replace('/setup', '');
  await page.goto(`${BASE}${real}`);
  await page.getByText('No jobs yet').waitFor();
  await page.getByText('Finish setting up').waitFor();
  const demoBar = await page.getByRole('region', { name: 'Demo workspace' }).count();
  if (demoBar) throw new Error('demo bar shown in real company');
  await page.screenshot({ path: `${OUT}/real-empty-home.png`, fullPage: true });
});

await step('dark theme screenshots', async () => {
  await setTheme('dark');
  await page.goto(`${BASE}${cidPath()}`);
  await page.waitForLoadState('networkidle');
  await assertTheme('dark');
  await page.screenshot({ path: `${OUT}/demo-home-1440-dark.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}${cidPath()}/jobs`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/jobs-390-dark.png` });
  await setTheme('light');
});

await step('invitation link flow for an employee (no company or demo required)', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const me = await (await page.request.get(`${BASE}/api/auth/me`)).json();
  const real = me.companies.find((c) => c.kind === 'real');
  const inv = await (await page.request.post(`${BASE}/api/c/${real.id}/invitations`, { headers: { 'x-rigo': '1' }, data: { email: empEmail, role: 'driver' } })).json();
  const c3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await c3.newPage();
  watch(p, 'employee');
  await p.goto(inv.link.replace(/^https?:\/\/[^/]+/, BASE));
  await p.getByRole('heading', { name: /Join Acme/ }).waitFor();
  await p.getByRole('link', { name: 'Create an account' }).click();
  await p.getByLabel('Your name').fill('Dana Employee');
  await p.getByLabel('Email').fill(empEmail);
  await p.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await p.getByRole('button', { name: 'Create account' }).click();
  await p.getByRole('button', { name: 'Accept invitation' }).click();
  await p.waitForURL(/\/today$/);
  await p.getByRole('heading', { name: 'My jobs' }).waitFor();
  await c3.close();
});

if (consoleErrors.length) fail('no console or page errors', consoleErrors.slice(0, 10)); else pass('no console or page errors');
await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
process.exit(failed ? 1 : 0);
