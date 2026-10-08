// Browser checks for Rigo: real flows through the screens, both themes, four widths, an axe
// accessibility scan (WCAG 2.2 AA; serious and critical findings fail), sideways scrolling, and
// console errors. Run against a running server:
//   BASE_URL=http://localhost:8787 NODE_PATH=$(npm root -g) node e2e/run.mjs
// E2E_ONLY=<group> runs one group: auth, start, office, worker, booking, demo, screens.
// Uses the pre-installed Chromium (PLAYWRIGHT_CHROMIUM_EXECUTABLE or /opt/pw-browsers).
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { chromium, request: pwRequest } = require('playwright');
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const OUT = 'e2e/output';
const ONLY = process.env.E2E_ONLY ?? '';
mkdirSync(OUT, { recursive: true });
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? execSync('ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1').toString().trim();
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js', { paths: [process.cwd()] }), 'utf8');

const results = [];
const fail = (name, detail) => { results.push({ name, ok: false, detail }); console.log(`✗ ${name}: ${String(detail).slice(0, 600)}`); };
const pass = (name, detail = '') => { results.push({ name, ok: true, detail }); console.log(`✓ ${name}${detail ? ` (${detail})` : ''}`); };
let lastPage = null;
async function step(name, fn) {
  try { const d = await fn(); pass(name, d ?? ''); } catch (e) {
    fail(name, String(e?.message ?? e).split('\n').slice(0, process.env.E2E_VERBOSE ? 6 : 2).join(' | '));
    // What the screen showed when it failed, for the CI artifact.
    if (lastPage && !lastPage.isClosed()) await lastPage.screenshot({ path: `${OUT}/fail-${name.replace(/\W+/g, '_').slice(0, 60)}.png`, fullPage: true }).catch(() => {});
  }
}
const group = (g) => !ONLY || ONLY.split(',').includes(g);

const browser = await chromium.launch({ executablePath: exe });
const consoleErrors = [];
function watch(page, label) {
  lastPage = page;
  page.on('framenavigated', () => { lastPage = page; });
  page.on('pageerror', (e) => consoleErrors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(`${label}: ${m.text()}`); });
}
async function axe(page, label) {
  await page.addScriptTag({ content: axeSource });
  const r = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations
    .map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes.slice(0, 3).map((x) => x.target.join(' ')) })));
  const serious = r.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  if (serious.length) throw new Error(`${label}: ${JSON.stringify(serious)}`);
  return r.length ? `${r.length} minor: ${r.map((v) => v.id).join(', ')}` : 'clean';
}
async function noOverflow(page, label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (o.sw > o.w + 1) throw new Error(`${label}: page is ${o.sw}px wide in a ${o.w}px viewport`);
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => {});

// ---------------------------------------------------------------- set-up through the API
const STRONG = 'tidy-lantern-orchard-42';
const H = { 'x-rigo': '1' };
let n = 0;
async function account(name, opts = {}) {
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: H });
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}-${Date.now()}-${++n}@example.test`;
  const r = await api.post('/api/auth/signup', { data: { name, email, password: STRONG } });
  if (!r.ok()) throw new Error(`signup ${r.status()} ${await r.text()}`);
  if (opts.theme) await api.patch('/api/auth/me', { data: { theme: opts.theme } });
  const call = async (method, path, data) => { const x = await api.fetch(`/api${path}`, { method, data }); const body = await x.json().catch(() => null); if (!x.ok()) throw new Error(`${method} ${path} ${x.status()} ${JSON.stringify(body)}`); return body; };
  return { email, name, api, get: (p) => call('GET', p), post: (p, d = {}) => call('POST', p, d), put: (p, d = {}) => call('PUT', p, d), patch: (p, d = {}) => call('PATCH', p, d) };
}
async function signInPage(who, { width = 1280, height = 900, label = 'page' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  watch(page, label);
  await page.goto(`${BASE}/signin`);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(STRONG);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'));
  return { ctx, page };
}
/** A field-service workspace with an owner, a driver, a customer and priced services. */
async function business(label) {
  const owner = await account(`Olga ${label}`);
  const { id: cid } = await owner.post('/companies', { name: `Field ${label}`, templateKey: 'field_service', timezone: 'America/Chicago', currency: 'USD' });
  const driver = await account(`Luis ${label}`);
  const inv = await owner.post(`/c/${cid}/invitations`, { email: driver.email, role: 'driver' });
  await driver.post(`/invitations/${inv.link.split('/invite/')[1]}/accept`);
  const driverId = (await driver.get('/auth/me')).user.id;
  const items = (await owner.get(`/c/${cid}/catalog`)).items;
  const septic = items.find((i) => i.name === 'Septic pump-out');
  await owner.patch(`/c/${cid}/catalog/${septic.id}`, { rate: '375' });
  const cust = await owner.post(`/c/${cid}/customers`, { name: 'Acme Farms', email: 'acme@example.test', phone: '(555) 201-0001', place: { address: '12 Barn Rd, Millbrook', notes: 'Gate code 4411' } });
  const place = (await owner.get(`/c/${cid}/customers/${cust.id}`)).places[0].id;
  return { owner, driver, cid, driverId, septic, customerId: cust.id, placeId: place };
}

// ---------------------------------------------------------------- auth
if (group('auth')) {
  await step('front page loads with the hero and sign-up', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(); watch(page, 'landing');
    await page.goto(`${BASE}/`);
    await page.getByRole('heading', { name: 'One place to run your business, whatever it is.' }).waitFor();
    if (!(await page.getByRole('link', { name: 'Create a free workspace' }).first().isVisible())) throw new Error('no sign-up button');
    if (!(await page.getByRole('link', { name: 'Try a demo' }).first().isVisible())) throw new Error('no demo button');
    await page.getByRole('heading', { name: 'What isn’t connected yet' }).waitFor();
    const r = await axe(page, 'landing');
    await ctx.close();
    return r;
  });
  await step('sign up, sign out, a wrong password says so, and sign in again', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage(); watch(page, 'signup');
    const email = `signup-${Date.now()}@example.test`;
    await page.goto(`${BASE}/signup`);
    await page.getByLabel('Your name').fill('Ana Signup');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(STRONG);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL(/\/start/);
    await page.getByRole('heading', { name: 'Let’s set up your workspace' }).waitFor();
    await ctx.clearCookies();
    await page.goto(`${BASE}/signin`);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByText('That email and password do not match an account.').waitFor();
    await page.getByLabel('Password', { exact: true }).fill(STRONG);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(/\/(start|home|workspaces|w\/)/);
    await ctx.close();
  });
  await step('forgot password explains recovery before anyone types', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage(); watch(page, 'forgot');
    await page.goto(`${BASE}/forgot`);
    await page.getByRole('heading', { name: 'Reset your password' }).waitFor();
    await page.getByText(/An owner of your workspace can make you a one-time reset link/).first().waitFor();
    const r = await axe(page, 'forgot');
    await ctx.close();
    return r;
  });
}

// ---------------------------------------------------------------- the first five minutes
if (group('start')) {
  await step('describe the business, get the closest template, adjust words, skip invites, land on Today', async () => {
    const who = await account('Cleo First');
    const { ctx, page } = await signInPage(who, { width: 390, height: 844, label: 'start' });
    await page.goto(`${BASE}/start`);
    await page.getByLabel('Business name').fill('Sparkle Homes');
    await page.getByLabel(/What does your business do/).fill('We clean homes and small offices');
    await page.getByText('Sounds like').waitFor();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Cleaning and home services' }).waitFor();
    await page.getByRole('button', { name: /^Use Cleaning/ }).click();
    await page.getByRole('heading', { name: 'Make it yours' }).waitFor();
    const one = page.getByRole('group', { name: /Main record/ }).getByLabel('One');
    await one.fill('Clean');
    await page.getByRole('group', { name: /Main record/ }).getByLabel('Many').fill('Cleans');
    await shot(page, 'start-review');
    await page.getByRole('button', { name: 'Create Sparkle Homes' }).click();
    await page.getByRole('heading', { name: /Invite your/ }).waitFor();
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await page.getByRole('heading', { name: 'Today', exact: true }).waitFor();
    await page.getByRole('link', { name: 'New clean' }).first().waitFor();
    await page.getByRole('heading', { name: 'Finish setting up' }).waitFor();
    const nav = page.getByRole('navigation', { name: 'Main' }).last();
    for (const label of ['Today', 'Cleans', 'Clients', 'Money', 'Settings']) await nav.getByRole('link', { name: label }).waitFor();
    const r = await axe(page, 'today');
    await noOverflow(page, 'today 390');
    await ctx.close();
    return r;
  });
}

// ---------------------------------------------------------------- office flows
if (group('office')) {
  await step('add a job with the form, see it in every view, move it along, and Rigo prepares the invoice', async () => {
    const b = await business('office');
    const { ctx, page } = await signInPage(b.owner, { label: 'office' });
    await page.goto(`${BASE}/w/${b.cid}/work/new`);
    await page.getByLabel(/What is it/).fill('Pump-out');
    await page.getByLabel(/^Customer/).selectOption({ label: 'Acme Farms' });
    await page.getByLabel(/^Site/).selectOption({ index: 1 });
    // Tomorrow in the workspace's time zone, which is what the screens show.
    const chicago = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d);
    const day = chicago(new Date(Date.now() + 86400_000));
    await page.getByLabel(/^Starts/).fill(`${day}T10:00`);
    await page.getByRole('checkbox', { name: /Luis office/ }).check();
    await page.getByLabel('Add from your price list').selectOption({ label: 'Septic pump-out' });
    await page.getByRole('button', { name: 'Add job' }).click();
    await page.getByRole('heading', { name: 'Pump-out' }).waitFor();
    await page.getByText('12 Barn Rd, Millbrook').first().waitFor();
    const id = page.url().split('/work/')[1];
    for (const v of ['list', 'board', 'calendar', 'timeline']) {
      await page.goto(`${BASE}/w/${b.cid}/work?view=${v}`);
      await page.waitForLoadState('networkidle');
      // The job is tomorrow: the timeline moves a day; the calendar a month only when tomorrow is in the next one.
      if (v === 'timeline' || (v === 'calendar' && day.slice(0, 7) !== chicago(new Date()).slice(0, 7))) await page.getByRole('button', { name: /^Next/ }).first().click();
      await page.locator(`a[href$="/work/${id}"]`).first().waitFor();
    }
    await page.goto(`${BASE}/w/${b.cid}/work/${id}`);
    await page.getByRole('button', { name: 'Move to Scheduled' }).click();
    await page.getByText('Moved to Scheduled.').waitFor();
    // Pick the next stage once the page shows the new one (the stage card redraws when it reloads).
    await page.getByRole('button', { name: 'Move to In progress' }).waitFor();
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Or move to').selectOption({ label: 'Done' });
    await page.getByText('Moved to Done.').waitFor();
    await page.goto(`${BASE}/w/${b.cid}/inbox`);
    await page.getByRole('heading', { name: /Invoice for Acme Farms/ }).waitFor();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.getByText('Approved.').waitFor();
    const r = await axe(page, 'inbox');
    await ctx.close();
    return r;
  });
  await step('an invoice with a missing price is held, then cleared once the price is set', async () => {
    const b = await business('held');
    await b.owner.put(`/c/${b.cid}/automation/rules/invoice_on_finish`, { level: 'manual' });
    const items = (await b.owner.get(`/c/${b.cid}/catalog`)).items;
    const grease = items.find((i) => i.name === 'Grease trap pump-out');
    const w = await b.owner.post(`/c/${b.cid}/work`, { title: 'Grease', clientId: b.customerId, lines: [{ catalogId: grease.id, description: 'Grease trap pump-out', quantity: '1' }] });
    await b.owner.post(`/c/${b.cid}/work/${w.id}/move`, { to: 'done' });
    const { ctx, page } = await signInPage(b.owner, { label: 'money' });
    await page.goto(`${BASE}/w/${b.cid}/money`);
    await page.getByRole('button', { name: 'Bill it' }).click();
    await page.getByText('Held: it can’t be approved yet').waitFor();
    await page.getByText('No price is set for "Grease trap pump-out"').waitFor();
    const invUrl = page.url();
    await page.goto(`${BASE}/w/${b.cid}/money/prices`);
    await page.getByRole('button', { name: /Grease trap pump-out/ }).click();
    await page.getByLabel(/^Price/).fill('180');
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.goto(invUrl);
    await page.getByRole('button', { name: 'Check again' }).click();
    await page.getByRole('button', { name: /^Approve/ }).waitFor();
    const r = await axe(page, 'invoice');
    await ctx.close();
    return r;
  });
  await step('a customer page leads with the next visit and what they owe', async () => {
    const b = await business('cust');
    const { ctx, page } = await signInPage(b.owner, { width: 390, height: 844, label: 'customer' });
    await b.owner.post(`/c/${b.cid}/work`, { title: 'Next one', clientId: b.customerId, placeId: b.placeId, startsAt: new Date(Date.now() + 2 * 86400_000).toISOString() });
    await page.goto(`${BASE}/w/${b.cid}/customers/${b.customerId}`);
    await page.getByText('Next job').waitFor();
    await page.getByText('Owes').first().waitFor();
    await page.getByText('Gate code 4411').waitFor();
    await noOverflow(page, 'customer 390');
    const r = await axe(page, 'customer');
    await ctx.close();
    return r;
  });
}

// ---------------------------------------------------------------- worker phone
if (group('worker')) {
  await step('a worker sees only their work, starts it, and a finish made offline sends once signal returns', async () => {
    const b = await business('worker');
    const w = await b.owner.post(`/c/${b.cid}/work`, { title: 'Pump-out', clientId: b.customerId, placeId: b.placeId, startsAt: new Date(Date.now() - 3600_000).toISOString(), assignees: [b.driverId] });
    await b.owner.post(`/c/${b.cid}/work`, { title: 'Not his', startsAt: new Date().toISOString() });
    const { ctx, page } = await signInPage(b.driver, { width: 390, height: 844, label: 'worker' });
    await page.goto(`${BASE}/w/${b.cid}`);
    await page.getByRole('heading', { name: 'Today', exact: true }).waitFor();
    await page.getByText('12 Barn Rd, Millbrook').waitFor();
    if (await page.getByText('Not his').count()) throw new Error('a worker saw work that isn’t theirs');
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const label of ['Today', 'Upcoming', 'Done']) await nav.getByRole('link', { name: label }).waitFor();
    if (await nav.getByRole('link', { name: 'Money' }).count()) throw new Error('a worker sees Money');
    await page.getByText('12 Barn Rd, Millbrook').click();
    await page.getByText('Gate code 4411').waitFor();
    await page.getByRole('link', { name: 'Directions' }).waitFor();
    const r = await axe(page, 'worker item');
    await noOverflow(page, 'worker 390');
    await page.getByRole('button', { name: /^Start: In progress/ }).click();
    await page.getByText('In progress. Sent.').waitFor();
    await page.goto(`${BASE}/w/${b.cid}/work/${w.id}`);
    await page.getByRole('button', { name: /^Finish: Done/ }).waitFor();
    await ctx.setOffline(true);
    await page.getByRole('button', { name: /^Finish: Done/ }).click();
    await page.getByText(/Saved on this phone/).first().waitFor();
    const before = (await b.owner.get(`/c/${b.cid}/work/${w.id}`)).item.stage.key;
    if (before !== 'in_progress') throw new Error(`offline finish reached the server: ${before}`);
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    for (let i = 0; i < 40; i++) {
      if ((await b.owner.get(`/c/${b.cid}/work/${w.id}`)).item.stage.key === 'done') break;
      await page.waitForTimeout(500);
    }
    const after = await b.owner.get(`/c/${b.cid}/work/${w.id}`);
    if (after.item.stage.key !== 'done') throw new Error(`not sent after signal returned: ${after.item.stage.key}`);
    if (after.history.filter((h) => h.type === 'moved' && h.data.to === 'Done').length !== 1) throw new Error('the finish was applied more than once');
    await ctx.close();
    return r;
  });
}

// ---------------------------------------------------------------- booking page
if (group('booking')) {
  await step('a visitor books a time on the public page; the owner accepts it from the inbox', async () => {
    const b = await business('book');
    await b.owner.put(`/c/${b.cid}/booking`, { slug: `field-book-${Date.now()}`, enabled: true, mode: 'book', catalogIds: [b.septic.id], hours: { days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '12:00' }, slotMinutes: 60 });
    const slug = (await b.owner.get(`/c/${b.cid}/booking`)).page.slug;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage(); watch(page, 'booking');
    await page.goto(`${BASE}/book/${slug}`);
    await page.getByLabel('What do you need?').selectOption({ label: 'Septic pump-out' });
    await page.getByRole('radiogroup', { name: 'Day' }).getByRole('radio').first().click();
    await page.getByRole('radiogroup', { name: 'Time' }).getByRole('radio').first().click();
    await page.getByLabel('Your name').fill('Grace Okafor');
    await page.getByLabel(/^Email/).fill('grace@example.test');
    const r = await axe(page, 'booking');
    await noOverflow(page, 'booking 390');
    await page.getByRole('button', { name: 'Request this time' }).click();
    await page.getByRole('heading', { name: 'Thanks, Grace' }).waitFor();
    await ctx.close();
    const owner = await signInPage(b.owner, { label: 'booking inbox' });
    await owner.page.goto(`${BASE}/w/${b.cid}/inbox`);
    await owner.page.getByRole('heading', { name: 'Grace Okafor' }).waitFor();
    await owner.page.getByRole('button', { name: 'Accept and add' }).click();
    await owner.page.getByText(/Added as job #/).waitFor();
    await owner.ctx.close();
    return r;
  });
}

// ---------------------------------------------------------------- demos
if (group('demo')) {
  await step('open a demo, show sample data, and see it as a worker', async () => {
    const who = await account('Dee Demo');
    const { ctx, page } = await signInPage(who, { width: 1280, height: 900, label: 'demo' });
    await page.goto(`${BASE}/demo`);
    await page.getByRole('button', { name: /Appointments/ }).click();
    await page.getByRole('region', { name: 'Demo' }).waitFor();
    await page.getByRole('button', { name: 'Show sample data' }).click();
    await page.getByText('Sample data added.').waitFor();
    await page.getByRole('link', { name: /Appointments/ }).first().click();
    await page.getByRole('heading', { name: 'Appointments' }).waitFor();
    await page.getByRole('button', { name: /See it as a specialist/ }).click();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Upcoming' }).waitFor();
    await page.getByRole('heading', { name: 'Today', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back to the owner’s view' }).click();
    await page.getByRole('heading', { name: 'Today', exact: true }).waitFor();
    await ctx.close();
  });
}

// ---------------------------------------------------------------- every screen: widths, themes, accessibility
if (group('screens')) {
  const light = await account('Sky Light');
  const dark = await account('Nox Dark', { theme: 'dark' });
  const prepare = async (who) => {
    const { id } = await who.post('/demo', { templateKey: 'field_service' });
    await who.post(`/c/${id}/demo/sample`);
    const work = (await who.get(`/c/${id}/work`)).items[0].id;
    const customer = (await who.get(`/c/${id}/customers`)).customers[0].id;
    const invoice = (await who.get(`/c/${id}/invoices`)).invoices[0].id;
    return { id, work, customer, invoice };
  };
  const screens = (d) => [
    '/', '/templates', '/signin', '/signup', '/home', '/workspaces', '/start', '/demo', '/account',
    `/w/${d.id}`, `/w/${d.id}/inbox`, `/w/${d.id}/work`, `/w/${d.id}/work?view=board`, `/w/${d.id}/work?view=calendar`, `/w/${d.id}/work?view=timeline`,
    `/w/${d.id}/work/${d.work}`, `/w/${d.id}/work/new`, `/w/${d.id}/customers`, `/w/${d.id}/customers/${d.customer}`, `/w/${d.id}/customers/new`,
    `/w/${d.id}/money`, `/w/${d.id}/money/invoices`, `/w/${d.id}/money/invoices/${d.invoice}`, `/w/${d.id}/money/prices`,
    `/w/${d.id}/settings`, `/w/${d.id}/settings/workspace`, `/w/${d.id}/settings/words`, `/w/${d.id}/settings/stages`, `/w/${d.id}/settings/fields`,
    `/w/${d.id}/settings/people`, `/w/${d.id}/settings/roles`, `/w/${d.id}/settings/automation`, `/w/${d.id}/settings/booking`, `/w/${d.id}/settings/equipment`,
  ];
  for (const [who, theme] of [[light, 'light'], [dark, 'dark']]) {
    const d = await prepare(who);
    for (const width of [375, 768, 1024, 1440]) {
      await step(`every screen at ${width}px, ${theme}`, async () => {
        const { ctx, page } = await signInPage(who, { width, height: 900, label: `${theme}-${width}` });
        const found = [];
        for (const path of screens(d)) {
          await page.goto(`${BASE}${path}`);
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(150);
          const got = await page.evaluate(() => document.documentElement.dataset.theme);
          if (got !== theme) found.push(`${path}: theme is ${got}`);
          try { await noOverflow(page, path); } catch (e) { found.push(e.message); }
          // The full accessibility scan runs once per theme at a phone and a desktop width.
          if (width === 375 || width === 1440) { try { await axe(page, path); } catch (e) { found.push(e.message); await shot(page, `axe-${theme}-${width}-${path.replace(/\W+/g, '_')}`); } }
          const raw = await page.evaluate(() => document.body.innerText);
          const leak = raw.match(/\b(work\.view_all|customers\.contact|money\.view|undefined|NaN|\[object Object\]|Invalid input)\b/);
          if (leak) found.push(`${path}: shows "${leak[0]}"`);
        }
        await ctx.close();
        if (found.length) throw new Error(found.join(' || '));
      });
    }
  }
  await step('reduced motion turns animation off', async () => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`);
    await page.locator('.btn').first().waitFor();
    const d = await page.evaluate(() => getComputedStyle(document.querySelector('.btn')).transitionDuration);
    await ctx.close();
    if (!/^0s/.test(d)) throw new Error(`transition is ${d}`);
  });
  await step('200% text keeps the sign-in page inside the screen', async () => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/signin`);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await noOverflow(page, 'signin at 200%');
    await ctx.close();
  });
}

await step('no console errors', async () => { if (consoleErrors.length) throw new Error(consoleErrors.slice(0, 8).join(' || ')); });
await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
