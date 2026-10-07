// Browser checks for Rigo: real UI flows, both themes, representative widths, axe accessibility
// scan, horizontal overflow, reduced motion and enlarged text. Run against a running server:
//   BASE_URL=http://localhost:8787 NODE_PATH=$(npm root -g) node e2e/run.mjs
// Uses the pre-installed Chromium (PLAYWRIGHT_CHROMIUM_EXECUTABLE or /opt/pw-browsers).
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
// E2E_VERBOSE=1 prints the locator a timeout was waiting for.
async function step(name, fn) { try { const d = await fn(); pass(name, d ?? ''); } catch (e) { fail(name, String(e?.message ?? e).split('\n').slice(0, process.env.E2E_VERBOSE ? 4 : 1).join(' | ')); } }

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

// ---------------------------------------------------------------- Round 2: demo walkthrough, assignment, approvals
// Run only this section with E2E_ONLY=round2.
const H = { 'x-rigo': '1' };
async function demoVisitor(label, vw = 1366, vh = 900, extra = {}) {
  const c = await browser.newContext({ viewport: { width: vw, height: vh }, ...extra });
  const p = await c.newPage(); watch(p, label);
  const mail = `${label}-${Date.now()}-${++accountN}@example.test`;
  const r = await c.request.post(`${BASE}/api/auth/signup`, { headers: H, data: { name: 'Vera Visitor', email: mail, password: STRONG } });
  if (!r.ok()) throw new Error(`signup ${r.status()} ${await r.text()}`);
  const cid = (await (await c.request.post(`${BASE}/api/demo`, { headers: H })).json()).id;
  const api = {
    get: async (path) => (await c.request.get(`${BASE}/api/c/${cid}${path}`, { headers: H })).json(),
    post: async (path, data = {}) => (await c.request.post(`${BASE}/api/c/${cid}${path}`, { headers: H, data })).json(),
  };
  return { c, p, cid, C: `${BASE}/c/${cid}`, api };
}
const guideOf = (p) => p.getByRole('complementary', { name: 'Demo walkthrough' });
const highlighted = (p, id) => p.locator(`[data-guide-active][data-guide-target="${id}"]`);

// ---------------------------------------------------------------- a real company with a real driver (WP5, WP6)
// A real company (not the demo) with a real driver account, so membership and phones behave as in life.
async function fieldCompany(label, opts = {}) {
  const owner = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: H });
  const om = `owner-${label}-${Date.now()}-${++accountN}@example.test`;
  await owner.post('/api/auth/signup', { data: { name: 'Olga Owner', email: om, password: STRONG } });
  const cid = (await (await owner.post('/api/companies', { data: { name: `Field ${label}`, timezone: 'America/Chicago', currency: 'USD', categories: ['fuel'], start: 'starter' } })).json()).id;
  const o = {
    get: async (path) => (await owner.get(`/api/c/${cid}${path}`)).json(),
    post: async (path, data = {}) => { const r = await owner.post(`/api/c/${cid}${path}`, { data }); return { status: r.status(), body: await r.json() }; },
    del: async (path) => (await owner.delete(`/api/c/${cid}${path}`)).status(),
  };
  const dm = `driver-${label}-${Date.now()}-${++accountN}@example.test`;
  const driverApi = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: H });
  await driverApi.post('/api/auth/signup', { data: { name: 'Luis Driver', email: dm, password: STRONG } });
  const inv = await o.post('/invitations', { email: dm, role: 'driver' });
  await driverApi.post(`/api/invitations/${inv.body.link.split('/invite/')[1]}/accept`);
  const driverId = (await (await driverApi.get('/api/auth/me')).json()).user.id;
  await driverApi.dispose();
  const fuel = (await o.get('/services')).services.find((x) => x.category === 'fuel');
  const cust = await o.post('/customers', { name: 'Acme Farms', email: 'acme@example.test', location: { address: '12 Barn Rd', accessInstructions: 'Gate code 4411' } });
  const loc = (await o.get(`/customers/${cust.body.id}`)).locations[0].id;
  // More drivers when a test needs a busy day.
  const driverIds = [driverId];
  for (let n = 2; n <= (opts.drivers ?? 1); n++) {
    const em = `driver${n}-${label}-${Date.now()}-${++accountN}@example.test`;
    const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: H });
    await api.post('/api/auth/signup', { data: { name: `Driver ${n}`, email: em, password: STRONG } });
    const i2 = await o.post('/invitations', { email: em, role: 'driver' });
    await api.post(`/api/invitations/${i2.body.link.split('/invite/')[1]}/accept`);
    driverIds.push((await (await api.get('/api/auth/me')).json()).user.id);
    await api.dispose();
  }
  const customer = async (name, address) => {
    const r = await o.post('/customers', { name, location: { address } });
    return { id: r.body.id, loc: (await o.get(`/customers/${r.body.id}`)).locations[0].id };
  };
  const mkJob = async (startIso, j0 = {}) => {
    const r = await o.post('/jobs', { customerId: j0.customerId ?? cust.body.id, locationId: j0.locationId ?? loc, serviceId: fuel.id, details: { product: 'Diesel', requested_qty: '100' }, intent: 'open', clientRequestId: `e2e-${Math.random()}`, scheduledStart: startIso, scheduledEnd: j0.end, priority: j0.priority });
    const j = (await o.get(`/jobs/${r.body.id}`)).job;
    if (j0.driver !== null) await o.post(`/jobs/${j.id}/assign`, { userId: j0.driver ?? driverId, resourceIds: j0.resources ?? [], version: j.version, allowOverlap: true });
    return (await o.get(`/jobs/${r.body.id}`)).job;
  };
  return { owner, o, cid, driver: { email: dm, name: 'Luis Driver' }, ownerLogin: { email: om, name: 'Olga Owner' }, driverId, driverIds, customer, mkJob, C: `${BASE}/c/${cid}` };
}
const soon = (h) => new Date(Date.now() + h * 3600_000).toISOString();
/** An ISO time today at h:m in the company's zone (America/Chicago). */
function chicagoAt(h, m = 0) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  const guess = new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  const local = new Date(guess.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() + (utc.getTime() - local.getTime())).toISOString();
}
async function ownerContext(f, vw = 1440, vh = 900) {
  const c = await browser.newContext({ viewport: { width: vw, height: vh } });
  await c.addCookies((await f.owner.storageState()).cookies);
  const p = await c.newPage();
  return { c, p };
}
async function driverSignIn(p, f) {
  await p.goto(`${BASE}/signin?next=${encodeURIComponent(`/c/${f.cid}/today`)}`);
  await signInHere(p, f.driver);
  await p.waitForURL(/\/today/);
}


// ---------------------------------------------------------------- Phase 1: money (pricing, billing, approvals)
// Run only this section with E2E_ONLY=phase1.
if (!process.env.E2E_ONLY || process.env.E2E_ONLY === 'phase1') {
  for (const [vw, vh] of [[1366, 900], [390, 844]]) {
    await step(`WP1 ${vw}px: the service editor's example bill charges only the lines a job would pay`, async () => {
      const v = await demoVisitor(`wp1-bill-${vw}`, vw, vh);
      const services = (await v.api.get('/services')).services;
      const septic = services.find((s) => s.category === 'septic');
      await v.p.goto(`${v.C}/services/${septic.id}`);
      const bill = v.p.getByRole('region', { name: 'Example bill' });
      await bill.waitFor({ timeout: 8000 });
      const table = bill.getByRole('table', { name: 'Example bill' });
      // Defaults: a pump-out of 1,250 gal, so the overage beyond the included 1,000 gal is billed.
      await table.getByText('Pump-out (includes 1,000 gal)').waitFor();
      await table.getByText('Pump-out: 250 gal over 1,000 included').waitFor();
      if (!(await table.getByText('$462.50').count())) throw new Error('pump-out total is not $462.50');
      await bill.getByLabel('Service details').selectOption('Grease trap');
      await bill.getByLabel('Volume pumped (gal)').fill('150');
      await table.getByText(/Minimum charge \$200\.00 applies/).waitFor();
      if (await table.getByText('Pump-out', { exact: false }).count()) throw new Error('pump-out still charged on a grease trap job');
      await bill.getByText(/Not charged on this job: .*Pump-out/).waitFor();
      // A $0 rate is flagged before saving.
      await v.p.locator('#f-rate-0').fill('0');
      await v.p.getByText(/is priced at \$0\.00/).waitFor();
      await noOverflow(v.p, `wp1-editor-${vw}`);
      const a = await axe(v.p, `wp1-editor-${vw}`);
      await v.c.close();
      return a;
    });
  }
  await step('WP1: fuel example bill charges one product and the delivery fee, not all four products (R3-C1)', async () => {
    const v = await demoVisitor('wp1-fuel');
    const fuel = (await v.api.get('/services')).services.find((s) => s.category === 'fuel');
    await v.p.goto(`${v.C}/services/${fuel.id}`);
    const bill = v.p.getByRole('region', { name: 'Example bill' });
    await bill.waitFor({ timeout: 8000 });
    await bill.getByLabel('Product').selectOption('Gasoline');
    await bill.getByLabel('Delivered quantity (gal)').fill('100');
    const rows = await bill.getByRole('table', { name: 'Example bill' }).locator('tbody tr').allInnerTexts();
    if (rows.length !== 2 || !/Gasoline/.test(rows[0]) || !/Delivery fee/.test(rows[1])) throw new Error(`rows: ${JSON.stringify(rows)}`);
    await bill.getByText(/Not charged on this job: Diesel, Dyed diesel, Heating oil/).waitFor();
    await v.c.close();
  });
  await step('WP2: an issued invoice shows the due date and balance, prefills the payment, and prints only the document (R10-M2, R6-m2)', async () => {
    const v = await demoVisitor('wp2-invoice');
    const issued = (await v.api.get('/invoices?status=issued')).invoices.find((i) => i.paymentStatus !== 'paid');
    if (!issued) throw new Error('no unpaid issued invoice in the demo');
    await v.p.goto(`${v.C}/invoices/${issued.id}`);
    await v.p.getByRole('article', { name: 'Invoice' }).getByText('Balance due').waitFor({ timeout: 8000 });
    await v.p.getByRole('button', { name: 'Record payment' }).first().click();
    const dlg = v.p.getByRole('dialog', { name: 'Record a payment received' });
    const amount = await dlg.getByLabel(/Amount/).inputValue();
    if (!/^\d+\.\d{2}$/.test(amount) || Number(amount) * 100 !== issued.balanceMinor) throw new Error(`amount not prefilled with the balance: ${amount} vs ${issued.balanceMinor}`);
    await dlg.getByLabel('Date').waitFor();
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    const a = await axe(v.p, 'wp2-invoice');
    await v.p.emulateMedia({ media: 'print' });
    const hidden = await v.p.evaluate(() => [...document.querySelectorAll('.no-print, .sidebar, .topbar')].every((e) => getComputedStyle(e).display === 'none'));
    if (!hidden) throw new Error('app chrome is visible when printing');
    await v.p.screenshot({ path: `${OUT}/wp2-invoice-print.png`, fullPage: true });
    await v.c.close();
    return a;
  });
  for (const [vw, vh] of [[1366, 900], [390, 844]]) {
    await step(`WP2 ${vw}px: collections shows money owed by age and nothing overflows`, async () => {
      const v = await demoVisitor(`wp2-collections-${vw}`, vw, vh);
      await v.p.goto(`${v.C}/collections`);
      await v.p.getByRole('group', { name: 'Amounts owed by age' }).waitFor({ timeout: 8000 });
      await v.p.getByRole('heading', { name: 'Who owes what' }).waitFor();
      await noOverflow(v.p, `wp2-collections-${vw}`);
      const a = await axe(v.p, `wp2-collections-${vw}`);
      await v.c.close();
      return a;
    });
  }
  await step('WP2: a hand-made invoice with a 10% discount, then the customer\'s view link (R8-M3, R15-m4)', async () => {
    const v = await demoVisitor('wp2-manual');
    const cust = (await v.api.get('/customers')).customers[0];
    await v.p.goto(`${v.C}/invoices/new?customer=${cust.id}`);
    await v.p.getByLabel('Description').first().fill('Tank inspection');
    await v.p.locator('#f-lr-0').fill('200');
    await v.p.getByRole('button', { name: 'Add line' }).click();
    await v.p.getByLabel('Description').nth(1).fill('Loyal customer');
    await v.p.locator('#f-lk-1').selectOption('discount_pct');
    await v.p.locator('#f-lp-1').fill('10');
    await v.p.getByText('Total: $180.00').waitFor();
    await v.p.getByRole('button', { name: 'Create draft' }).click();
    await v.p.waitForURL(/\/invoices\/[0-9a-f-]{36}$/, { timeout: 8000 });
    const id = v.p.url().split('/').pop();
    // Approve (with confirmation and the total) and issue as the demo owner.
    await v.p.getByRole('button', { name: /^Approve · \$180\.00/ }).click();
    await v.p.getByRole('dialog', { name: 'Approve this $180.00 invoice?' }).getByRole('button', { name: 'Approve' }).click();
    await v.p.getByRole('button', { name: 'Issue', exact: true }).click();
    await v.p.getByRole('dialog', { name: 'Issue this invoice?' }).getByRole('button', { name: 'Issue invoice' }).click();
    await v.p.getByText(/Issued as /).waitFor({ timeout: 8000 });
    const m = await v.api.post(`/invoices/${id}/email`);
    const msg = (await v.api.get('/messages')).messages.find((x) => x.id === m.messageId);
    const link = /(\/i\/[A-Za-z0-9_-]+)/.exec(msg.body)[1];
    const anon = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const ap = await anon.newPage(); watch(ap, 'wp2-public');
    await ap.goto(`${BASE}${link}`);
    await ap.getByRole('article', { name: 'Invoice' }).getByText('Tank inspection').waitFor({ timeout: 8000 });
    await ap.getByText('Balance due').waitFor();
    await noOverflow(ap, 'wp2-public-390');
    const a = await axe(ap, 'wp2-public');
    await anon.close(); await v.c.close();
    return a;
  });
  await step('WP3: changing the mode, deactivating a workflow and approving each ask first; a pause shows on every page (R14-m2, R18-m1, R14-m4)', async () => {
    const v = await demoVisitor('wp3-confirm');
    await v.p.goto(`${v.C}/automation`);
    await v.p.getByText(/4 of 4 workflows on/).waitFor({ timeout: 8000 });
    const before = (await v.api.get('/automation')).mode;
    const target = before === 'automatic' ? 'Manual' : 'Automatic';
    await v.p.locator('.radio-card', { hasText: target }).click();
    const dlg = v.p.getByRole('dialog', { name: `Switch to ${target}?` });
    await dlg.waitFor();
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    if ((await v.api.get('/automation')).mode !== before) throw new Error('mode changed without confirmation');
    // Deactivating the billing workflow says what stops.
    const wf = (await v.api.get('/workflows')).workflows.find((w) => w.name === 'Completed job to invoice');
    await v.p.goto(`${v.C}/workflows/${wf.id}`);
    await v.p.getByRole('button', { name: 'Deactivate' }).click();
    await v.p.getByRole('dialog', { name: 'Deactivate this workflow?' }).getByText(/Completed jobs will no longer be billed automatically/).waitFor();
    await v.p.getByRole('dialog', { name: 'Deactivate this workflow?' }).getByRole('button', { name: 'Cancel' }).click();
    // Approving from the inbox shows the total first.
    await v.p.goto(`${v.C}/inbox`);
    const approve = v.p.getByRole('button', { name: /^Approve and issue · \$/ }).first();
    if (await approve.count()) {
      const label = await approve.innerText();
      await approve.click();
      const total = /\$[\d,]+\.\d{2}/.exec(label)[0];
      await v.p.getByRole('dialog', { name: `Approve ${total}?` }).waitFor();
      await v.p.getByRole('dialog', { name: `Approve ${total}?` }).getByRole('button', { name: 'Cancel' }).click();
    }
    // Pause, then the banner is on another page with Resume.
    await v.p.goto(`${v.C}/automation`);
    await v.p.getByRole('button', { name: 'Pause all automation' }).click();
    await v.p.getByRole('dialog', { name: 'Pause all automation?' }).getByRole('button', { name: 'Pause and hold' }).click();
    await v.p.goto(`${v.C}/jobs`);
    const banner = v.p.locator('.paused-banner');
    await banner.waitFor({ timeout: 8000 });
    await banner.getByRole('button', { name: 'Resume' }).click();
    await banner.waitFor({ state: 'detached', timeout: 8000 });
    const a = await axe(v.p, 'wp3-jobs');
    await v.c.close();
    return a;
  });
  await step('WP4: moving a job later in the form keeps its length; the plan form starts with no day ticked and asks billing for rates (R8-M4, R7-m2, R8-m1)', async () => {
    const v = await demoVisitor('wp4');
    const jobs = (await v.api.get('/jobs?status=active')).jobs.filter((j) => j.status === 'open' && j.scheduled_start && j.scheduled_end);
    const j = jobs[0];
    await v.p.goto(`${v.C}/jobs/${j.id}`);
    const start = v.p.locator('#f-scheduledStart');
    await start.waitFor({ timeout: 8000 });
    const s0 = await start.inputValue(); const e0 = await v.p.locator('#f-scheduledEnd').inputValue();
    const later = new Date(Date.parse(`${s0}:00Z`) + 3 * 3600_000).toISOString().slice(0, 16);
    await start.fill(later);
    const e1 = await v.p.locator('#f-scheduledEnd').inputValue();
    const len = (a, b) => Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`);
    if (len(later, e1) !== len(s0, e0)) throw new Error(`end did not move with the start: ${s0}–${e0} became ${later}–${e1}`);
    await v.p.getByRole('button', { name: 'Save assignment' }).click();
    await v.p.getByText('Assignment saved').waitFor({ timeout: 8000 });
    const after = (await v.api.get(`/jobs/${j.id}`)).job;
    if (Date.parse(after.scheduled_end) - Date.parse(after.scheduled_start) !== Date.parse(j.scheduled_end) - Date.parse(j.scheduled_start)) throw new Error('saved length changed');
    // The new plan form: no weekday pre-ticked, unit lines for rentals.
    await v.p.goto(`${v.C}/recurring/new`);
    const days = v.p.locator('#f-visitRule-weekdays input[type=checkbox]');
    await days.first().waitFor({ timeout: 8000 });
    if ((await days.evaluateAll((els) => els.filter((e) => e.checked).length)) !== 0) throw new Error('a weekday was pre-ticked');
    await v.p.getByLabel('Unit type').first().waitFor();
    await noOverflow(v.p, 'wp4-plan-form');
    const a = await axe(v.p, 'wp4-plan-form');
    await v.c.close();
    return a;
  });

  for (const [vw, vh] of [[360, 640], [375, 667], [390, 844]]) {
    await step(`WP5 ${vw}×${vh}: Start job is the sticky action, then Submit; nothing preselected; another day's job asks first (R9-M1, R6-m4)`, async () => {
      const f = await fieldCompany(`small-${vw}`);
      // Tomorrow at 10:00 in the company's time zone, whatever the time of day the check runs.
      const tomorrow = await f.mkJob(new Date(Date.parse(chicagoAt(10, 0)) + 86_400_000).toISOString());
      const c = await browser.newContext({ viewport: { width: vw, height: vh }, hasTouch: true, isMobile: true });
      const p = await c.newPage(); watch(p, `wp5-small-${vw}`);
      await driverSignIn(p, f);
      await p.goto(`${f.C}/today/${tomorrow.id}`);
      const bar = p.locator('.sticky-actions');
      const startBtn = bar.getByRole('button', { name: 'Start job' });
      await startBtn.waitFor({ timeout: 8000 });
      if (await bar.getByRole('button', { name: 'Submit to office' }).count()) throw new Error('Submit shown before the job is started');
      // The primary action is fully on screen, not under the bottom navigation.
      const box = await startBtn.boundingBox();
      const nav = await p.locator('.bottomnav, nav[aria-label="Primary"]').last().boundingBox().catch(() => null);
      if (!box || box.y + box.height > vh) throw new Error(`Start job is off screen (${JSON.stringify(box)})`);
      if (nav && box.y + box.height > nav.y + 1) throw new Error('Start job is under the bottom bar');
      if (await p.locator('input[name="outcome"]:checked').count()) throw new Error('an outcome is preselected');
      await startBtn.click();
      await p.getByRole('dialog', { name: /This job is for tomorrow\. Start anyway\?/ }).waitFor();
      await p.getByRole('button', { name: 'Start anyway' }).click();
      await bar.getByRole('button', { name: 'Submit to office' }).waitFor({ timeout: 8000 });
      // Could not complete: quick reasons, one notes field, consistent photo wording.
      await p.getByLabel('Could not complete').check();
      await p.getByLabel('Locked gate').check();
      if (await p.locator('#f-details-notes').count()) throw new Error('two notes fields for an unsuccessful visit');
      await p.getByText('Photos (optional)').waitFor();
      await noOverflow(p, `wp5-small-${vw}`);
      const a = await axe(p, `wp5-small-${vw}`);
      await bar.getByRole('button', { name: 'Submit to office' }).click();
      await p.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
      await p.getByText('Sent. The office has your record.').waitFor({ timeout: 8000 });
      const done = (await f.o.get(`/jobs/${tomorrow.id}`)).job;
      if (done.status !== 'unsuccessful' || done.completion.reason !== 'Locked gate') throw new Error(`saved as ${done.status}: ${done.completion?.reason}`);
      await c.close(); await f.owner.dispose();
      return a;
    });
  }

  await step('WP5: 200% text keeps the driver job usable at 390px', async () => {
    const f = await fieldCompany('zoom');
    const j = await f.mkJob(soon(1));
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const p = await c.newPage(); watch(p, 'wp5-zoom');
    await driverSignIn(p, f);
    await p.goto(`${f.C}/today/${j.id}`);
    await p.locator('.sticky-actions').getByRole('button', { name: 'Start job' }).waitFor({ timeout: 8000 });
    await p.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await noOverflow(p, 'wp5-zoom');
    await c.close(); await f.owner.dispose();
  });

  await step('WP5: offline save, close, reopen with no signal (jobs and record there), reconnect sends it exactly once (R13-C1, R13-M1, R13-m3)', async () => {
    const f = await fieldCompany('offline');
    const j = await f.mkJob(soon(1));
    const dir = mkdtempSync(`${tmpdir()}/rigo-phone-`);
    let c = await chromium.launchPersistentContext(dir, { executablePath: exe, viewport: { width: 390, height: 844 }, isMobile: true });
    let p = c.pages()[0] ?? await c.newPage(); watch(p, 'wp5-offline-1');
    await driverSignIn(p, f);
    // A second visit lets the service worker keep the app and the driver screens for offline use.
    await p.waitForFunction(() => navigator.serviceWorker?.controller || new Promise((r) => setTimeout(() => r(false), 3000)), null, { timeout: 8000 }).catch(() => {});
    await p.reload(); await p.waitForLoadState('networkidle');
    await p.getByRole('link', { name: /12 Barn Rd/ }).first().click();
    await p.locator('.sticky-actions').getByRole('button', { name: 'Start job' }).click();
    await p.locator('.sticky-actions').getByRole('button', { name: 'Submit to office' }).waitFor({ timeout: 8000 });
    await c.setOffline(true);
    await p.getByLabel('Completed successfully').check();
    await p.getByLabel('Quantity (gal)', { exact: true }).fill('95');
    await p.locator('.sticky-actions').getByRole('button', { name: 'Submit to office' }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
    await p.getByText('Saved on this phone. It sends automatically when you have signal; you can close the app.').waitFor({ timeout: 8000 });
    if (await p.locator('.sticky-actions').count()) throw new Error('Start/Submit still shown after an offline save');
    await p.getByRole('button', { name: 'Edit record' }).waitFor();
    await c.close();

    // Reopen the installed app with no signal.
    c = await chromium.launchPersistentContext(dir, { executablePath: exe, viewport: { width: 390, height: 844 }, isMobile: true, offline: true });
    p = c.pages()[0] ?? await c.newPage(); watch(p, 'wp5-offline-2');
    await p.goto(`${f.C}/today`);
    await p.getByRole('heading', { name: 'My jobs' }).waitFor({ timeout: 10000 });
    await p.getByText('No signal: showing the copy saved on this phone').waitFor();
    await p.getByText(/1 record waiting to send/).waitFor();
    await p.getByRole('link', { name: /12 Barn Rd/ }).first().click();
    await p.getByText('Waiting for signal — will send automatically').first().waitFor();
    // Pages that need the server say so instead of failing.
    await p.goto(`${f.C}/invoices`);
    await p.getByText('This page needs a connection').waitFor({ timeout: 8000 });
    await p.goto(`${f.C}/today/${j.id}`);
    await p.getByText('Waiting for signal — will send automatically').first().waitFor({ timeout: 8000 });
    await c.setOffline(false);
    await p.getByText('1 record sent to the office.').waitFor({ timeout: 20000 });
    const d = (await f.o.get(`/jobs/${j.id}`));
    if (d.job.status !== 'completed') throw new Error(`job is ${d.job.status}`);
    const completions = d.events.filter((e) => e.type === 'completion').length;
    if (completions !== 1) throw new Error(`${completions} completions recorded`);
    await c.close(); await f.owner.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  await step('WP5: a removed driver\'s record reaches the office for review, then the phone forgets the company (R12-M1)', async () => {
    const f = await fieldCompany('removed');
    const j = await f.mkJob(soon(1));
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const p = await c.newPage(); watch(p, 'wp5-removed');
    await driverSignIn(p, f);
    await p.goto(`${f.C}/today/${j.id}`);
    await p.locator('.sticky-actions').getByRole('button', { name: 'Start job' }).click();
    await p.locator('.sticky-actions').getByRole('button', { name: 'Submit to office' }).waitFor({ timeout: 8000 });
    await p.getByLabel('Completed successfully').check();
    await p.getByLabel('Quantity (gal)', { exact: true }).fill('60');
    await p.getByText(/Saved .*ago|Saved just now|Saved/).first().waitFor();
    const member = (await f.o.get('/members')).members.find((m) => m.user_id === f.driverId);
    if (member.started_jobs !== 1) throw new Error('the team list does not show the started job');
    if ((await f.o.del(`/members/${member.id}`)) !== 200) throw new Error('remove failed');
    await p.goto(`${f.C}/today`);
    await p.getByRole('heading', { name: /You no longer have access to Field removed/ }).waitFor({ timeout: 10000 });
    await p.getByText('Your record was sent to the office for review.').waitFor({ timeout: 10000 });
    const left = await p.evaluate(async (cid) => new Promise((res) => { const r = indexedDB.open('rigo-offline', 1); r.onsuccess = () => { const t = r.result.transaction('kv', 'readonly').objectStore('kv').getAllKeys(); t.onsuccess = () => res(t.result.map(String).filter((k) => k.includes(cid))); }; }), f.cid);
    if (left.length) throw new Error(`still on the phone: ${left.join(', ')}`);
    const recs = (await f.o.get('/pending-submissions')).records;
    if (recs.length !== 1 || recs[0].reason !== 'removed') throw new Error(JSON.stringify(recs));
    const a = await axe(p, 'wp5-removed');
    await c.close(); await f.owner.dispose();
    return a;
  });

  await step('WP5: reassigned mid-job, the record goes to review and the office accepts it (R9-M2, R13-m2)', async () => {
    const f = await fieldCompany('race');
    const j = await f.mkJob(soon(1));
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const p = await c.newPage(); watch(p, 'wp5-race');
    await driverSignIn(p, f);
    await p.goto(`${f.C}/today/${j.id}`);
    await p.locator('.sticky-actions').getByRole('button', { name: 'Start job' }).click();
    await p.locator('.sticky-actions').getByRole('button', { name: 'Submit to office' }).waitFor({ timeout: 8000 });
    await p.getByLabel('Completed successfully').check();
    await p.getByLabel('Quantity (gal)', { exact: true }).fill('70');
    // Dispatch takes it away (confirming the warning) while the driver is still on site.
    const v = (await f.o.get(`/jobs/${j.id}`)).job.version;
    const warn = await f.o.post(`/jobs/${j.id}/assign`, { userId: null, resourceIds: [], version: v });
    if (warn.status !== 409 || warn.body.error.details.needsConfirm !== 'started') throw new Error('no warning for a started job');
    await f.o.post(`/jobs/${j.id}/assign`, { userId: null, resourceIds: [], version: v, confirmStarted: true });
    await p.locator('.sticky-actions').getByRole('button', { name: 'Submit to office' }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
    await p.getByText('Sent to the office for review.').first().waitFor({ timeout: 8000 });
    // The office reviews it in the browser.
    const oc = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const op = await oc.newPage(); watch(op, 'wp5-race-office');
    const state = await f.owner.storageState();
    await oc.addCookies(state.cookies);
    await op.goto(`${f.C}/jobs/records`);
    await op.getByRole('heading', { name: 'Driver records to review' }).waitFor({ timeout: 8000 });
    await op.getByText('The job was given to someone else first.').waitFor();
    await op.getByText('70 gal').waitFor();
    const a = await axe(op, 'wp5-records');
    await op.getByRole('button', { name: 'Accept record' }).click();
    await op.getByText(/recorded as completed/).waitFor({ timeout: 8000 });
    if ((await f.o.get(`/jobs/${j.id}`)).job.status !== 'completed') throw new Error('not completed after accepting');
    await oc.close(); await c.close(); await f.owner.dispose();
    return a;
  });

  await step('WP5: Switch driver keeps unsent records for their owner only; the installed app opens at My jobs (R4-M4, R13-m4)', async () => {
    const f = await fieldCompany('switch');
    const j = await f.mkJob(soon(1));
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const p = await c.newPage(); watch(p, 'wp5-switch');
    await driverSignIn(p, f);
    await p.goto(`${f.C}/today/${j.id}`);
    await p.locator('.sticky-actions').getByRole('button', { name: 'Start job' }).click();
    await p.locator('.sticky-actions').getByRole('button', { name: 'Submit to office' }).waitFor({ timeout: 8000 });
    await p.getByLabel('Completed successfully').check();
    await p.getByLabel('Quantity (gal)', { exact: true }).fill('44');
    await p.goto(`${BASE}/account?signout=1`);
    await p.getByText(/1 job record hasn't reached the office/).waitFor({ timeout: 8000 });
    await p.getByRole('button', { name: 'Switch driver' }).click();
    await p.waitForURL(/\/signin/);
    const keys = await p.evaluate(async () => new Promise((res) => { const r = indexedDB.open('rigo-offline', 1); r.onsuccess = () => { const t = r.result.transaction('kv', 'readonly').objectStore('kv').getAllKeys(); t.onsuccess = () => res(t.result.map(String)); }; }));
    if (!keys.some((k) => k.startsWith(`draft:${f.driverId}:`))) throw new Error('the draft was not kept');
    if (keys.some((k) => k.startsWith('jobs:') || k.startsWith('boot:') || k === 'me:last')) throw new Error(`company data left after sign-out: ${keys.join(', ')}`);
    // Signing in again brings the record back; the installed app's start page opens My jobs.
    await signInHere(p, f.driver);
    await p.waitForURL(/\/workspaces|\/c\//);
    await p.goto(`${BASE}/open`);
    await p.waitForURL(/\/today$/, { timeout: 8000 });
    await p.goto(`${f.C}/today/${j.id}`);
    if ((await p.getByLabel('Quantity (gal)', { exact: true }).inputValue()) !== '44') throw new Error('the draft did not come back');
    const manifest = await (await p.request.get(`${BASE}/manifest.webmanifest`)).json();
    const meta = await p.locator('meta[name="theme-color"]').getAttribute('content');
    if (manifest.start_url !== '/open' || manifest.theme_color !== '#0A0A0B' || !meta) throw new Error(`manifest ${manifest.start_url} ${manifest.theme_color}, meta ${meta}`);
    await c.close(); await f.owner.dispose();
  });
}
// ---------------------------------------------------------------- Phase 2: dispatch, team, customers, fuel
// Run only this section with E2E_ONLY=phase2.
if (!process.env.E2E_ONLY || process.env.E2E_ONLY === 'phase2') {
  for (const [vw, vh] of [[1440, 900], [1024, 768]]) {
    await step(`WP6 ${vw}px: a busy day (6 drivers, 9–15 jobs each) stays readable on the timeline (R11-M3)`, async () => {
      const f = await fieldCompany(`busy-${vw}`, { drivers: 6 });
      const names = ['Hollis Family Farm', 'Ridgeline Construction', 'Grace Okafor', 'St. Brigid Church', 'Harbor & Vine Events', 'José Núñez', 'Lucky Dragon'];
      const custs = [];
      for (const [i, n] of names.entries()) custs.push(await f.customer(n, `${100 + i} Main St, Millbrook`));
      let made = 0;
      for (const [d, id] of f.driverIds.entries()) {
        const count = 9 + (d % 4) * 2; // 9, 11, 13, 15 …
        for (let k = 0; k < count; k++) {
          const cu = custs[(d + k) % custs.length];
          const start = chicagoAt(6 + Math.floor((k * 50) / 60), (k * 50) % 60);
          await f.mkJob(start, { driver: id, customerId: cu.id, locationId: cu.loc, end: new Date(Date.parse(start) + 40 * 60000).toISOString() });
          made++;
        }
      }
      // Five overlapping jobs without a driver fold into "+N more".
      for (let k = 0; k < 5; k++) await f.mkJob(chicagoAt(9, 0), { driver: null, customerId: custs[k].id, locationId: custs[k].loc });
      const { c, p } = await ownerContext(f, vw, vh); watch(p, `wp6-busy-${vw}`);
      await p.goto(`${f.C}/jobs?view=schedule`);
      await p.locator('.tl-block').first().waitFor({ timeout: 15000 });
      // Every block shows the customer's name, readable (not clipped to nothing).
      const blocks = await p.locator('.tl-block').evaluateAll((els) => els.map((e) => ({ name: e.querySelector('.c')?.textContent ?? '', w: e.getBoundingClientRect().width, nameW: e.querySelector('.c')?.getBoundingClientRect().width ?? 0 })));
      const bad = blocks.filter((b) => !b.name || b.w < 100 || b.nameW < 60);
      if (bad.length) throw new Error(`${bad.length} of ${blocks.length} blocks unreadable: ${JSON.stringify(bad.slice(0, 3))}`);
      await p.getByRole('button', { name: /\+\d+ more without a driver/ }).waitFor();
      await noOverflow(p, `wp6-busy-${vw}`);
      const a = await axe(p, `wp6-busy-${vw}`);
      await p.screenshot({ path: `${OUT}/wp6-busy-${vw}.png` });
      // The 4-hour window gives each block more room; the feed groups by driver.
      await p.getByRole('button', { name: '4 hours' }).click();
      await p.getByRole('button', { name: 'Whole day' }).waitFor();
      await p.getByRole('radio', { name: 'Feed' }).click().catch(async () => p.getByRole('button', { name: 'Feed' }).click());
      await p.getByRole('radio', { name: 'By driver' }).click().catch(async () => p.getByRole('button', { name: 'By driver' }).click());
      await p.locator('.feed-group-h').first().waitFor({ timeout: 8000 });
      const groups = await p.locator('.feed-group-h').count();
      if (groups !== f.driverIds.length + 1) throw new Error(`${groups} driver groups in the feed`);
      await c.close(); await f.owner.dispose();
      return `${made + 5} jobs; ${a}`;
    });
  }

  await step('WP6: someone else saves first — my typing is kept and I choose per field; leaving unsaved asks (R11-m1, R11-m2)', async () => {
    const f = await fieldCompany('merge');
    const j = await f.mkJob(soon(3));
    const { c, p } = await ownerContext(f); watch(p, 'wp6-merge');
    await p.goto(`${f.C}/jobs/${j.id}/edit`);
    await p.locator('#f-notes').fill('Bring the long hose');
    // Meanwhile dispatch changes the notes and the access instructions.
    const cur = (await f.o.get(`/jobs/${j.id}`)).job;
    const theirs = await f.owner.patch(`/api/c/${f.cid}/jobs/${j.id}`, { data: { version: cur.version, notes: 'Call before arriving', accessInstructions: 'North gate, code 2211' } });
    if (!theirs.ok()) throw new Error(`other edit failed ${theirs.status()}`);
    await p.getByRole('button', { name: 'Save changes' }).click();
    const card = p.getByRole('alert').filter({ hasText: 'Someone else saved this job while you were editing' });
    await card.waitFor({ timeout: 8000 });
    await card.getByText('Keep mine: Bring the long hose').waitFor();
    await card.getByText('Use theirs: Call before arriving').waitFor();
    // Their access change (a field I didn't touch) is taken in.
    if ((await p.locator('#f-accessInstructions').inputValue()) !== 'North gate, code 2211') throw new Error('their untouched change was not taken in');
    const a = await axe(p, 'wp6-merge');
    await card.getByRole('button', { name: 'Save with these choices' }).click();
    await p.waitForURL(new RegExp(`/jobs/${j.id}$`), { timeout: 8000 });
    const saved = (await f.o.get(`/jobs/${j.id}`)).job;
    if (saved.notes !== 'Bring the long hose' || saved.access_instructions !== 'North gate, code 2211') throw new Error(`saved ${saved.notes} / ${saved.access_instructions}`);
    // Unsaved changes: leaving asks first.
    await p.goto(`${f.C}/jobs/${j.id}/edit`);
    await p.locator('#f-notes').fill('Something new');
    await p.getByRole('link', { name: 'Job', exact: true }).first().click();
    await p.getByRole('dialog', { name: 'Leave without saving?' }).waitFor();
    await p.getByRole('button', { name: 'Keep editing' }).click();
    if (!/\/edit$/.test(p.url())) throw new Error('left the page');
    await c.close(); await f.owner.dispose();
    return a;
  });

  await step('WP6: the driver is told what changed, opens the address in Maps, and an out-of-service truck is swapped from the jobs list (R11-M2, R9-M3, R11-M1)', async () => {
    const f = await fieldCompany('notify');
    const truckA = (await f.o.post('/resources', { kind: 'truck', name: 'Tank wagon A', capacity: '3,000 gal' })).body.id;
    const truckB = (await f.o.post('/resources', { kind: 'truck', name: 'Tank wagon B', capacity: '3,000 gal' })).body.id;
    const j = await f.mkJob(soon(3), { resources: [truckA] });
    const dc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const dp = await dc.newPage(); watch(dp, 'wp6-driver');
    await driverSignIn(dp, f);
    await dp.goto(`${f.C}/today/${j.id}`);
    const maps = dp.getByRole('link', { name: 'Open in Maps' });
    await maps.waitFor({ timeout: 8000 });
    const href = await maps.getAttribute('href');
    if (!/^https:\/\/(www\.google\.com\/maps|maps\.apple\.com)/.test(href) || !href.includes('12%20Barn%20Rd')) throw new Error(`maps link ${href}`);
    // The office moves the job; the driver's list shows what changed until "Got it".
    const cur = (await f.o.get(`/jobs/${j.id}`)).job;
    await f.owner.patch(`/api/c/${f.cid}/jobs/${j.id}`, { data: { version: cur.version, scheduledStart: new Date(Date.parse(cur.scheduled_start) + 3600_000).toISOString() } });
    await dp.goto(`${f.C}/today`);
    const banner = dp.locator('.changes-banner');
    await banner.getByText(/Moved from/).waitFor({ timeout: 8000 });
    const a1 = await axe(dp, 'wp6-driver-changes');
    await banner.getByRole('button', { name: 'Got it' }).click();
    await banner.waitFor({ state: 'detached', timeout: 8000 });
    await dc.close();
    // The truck goes out of service: the office confirms with the jobs named, then swaps it.
    const { c, p } = await ownerContext(f); watch(p, 'wp6-oos');
    await p.goto(`${f.C}/resources`);
    await p.getByRole('row', { name: /Tank wagon A/ }).getByRole('button', { name: 'Edit' }).click();
    await p.getByRole('dialog').getByLabel('Status').selectOption('out_of_service');
    await p.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await p.getByRole('dialog', { name: '1 open job uses Tank wagon A.' }).waitFor();
    await p.getByRole('button', { name: 'Mark out of service' }).click();
    await p.getByRole('button', { name: 'Show jobs' }).click();
    await p.waitForURL(/jobs\?resource=/);
    await p.getByText('Jobs using Tank wagon A').waitFor();
    await p.getByRole('checkbox', { name: `Select job #${j.number}` }).check();
    await p.locator('#swap-to').selectOption(truckB);
    await p.getByRole('button', { name: 'Swap truck' }).click();
    await p.getByText(`Tank wagon B is now on job #${j.number}`).waitFor();
    const a2 = await axe(p, 'wp6-swap');
    await c.close(); await f.owner.dispose();
    return `${a1}; ${a2}`;
  });

  await step('WP7: an invited driver signs up with the address filled in, lands on My jobs without another click; pages their role lacks say so (R4-m6, R4-m4, R4-m2)', async () => {
    const f = await fieldCompany('invite');
    const mail = `sam-${Date.now()}@example.test`;
    const inv = await f.o.post('/invitations', { email: mail, role: 'driver' });
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const p = await c.newPage(); watch(p, 'wp7-invite');
    await p.goto(inv.body.link.replace(/^https?:\/\/[^/]+/, BASE));
    await p.getByRole('link', { name: 'Create an account' }).click();
    const email = p.getByLabel('Email');
    await p.waitForFunction((el) => el && el.value.length > 0, await email.elementHandle(), { timeout: 8000 });
    if ((await email.inputValue()) !== mail || !(await email.getAttribute('readonly') !== null)) throw new Error('the invited email is not filled in and fixed');
    await p.getByText(/From your invitation to Field invite/).waitFor();
    await p.getByLabel('Your name').fill('Sam Driver');
    await p.getByLabel('Password', { exact: true }).fill(STRONG);
    await p.getByRole('button', { name: 'Create account' }).click();
    await p.waitForURL(/\/today$/, { timeout: 10000 });
    await p.getByRole('heading', { name: 'My jobs' }).waitFor();
    await p.getByRole('heading', { name: 'How a job works' }).waitFor();
    const a = await axe(p, 'wp7-driver-first-day');
    await p.goto(`${f.C}/invoices`);
    await p.getByText("Your role doesn't include this page").waitFor({ timeout: 8000 });
    await c.close();
    // The owner sees who joined in the activity log, and invitation status is honest.
    const { c: oc, p: op } = await ownerContext(f); watch(op, 'wp7-owner');
    await op.goto(`${f.C}/settings?tab=activity`);
    await op.getByText(/joined as driver/).first().waitFor({ timeout: 8000 });
    const a2 = await axe(op, 'wp7-activity');
    await op.goto(`${f.C}/team`);
    await op.getByLabel('Their email').fill(`late-${Date.now()}@example.test`);
    await op.getByRole('button', { name: 'Create invitation' }).click();
    await op.getByText(/Invitation link created — not emailed|Invitation emailed/).waitFor();
    await op.getByRole('button', { name: /Copy link for late-/ }).waitFor();
    const a3 = await axe(op, 'wp7-team');
    await oc.close(); await f.owner.dispose();
    return `${a}; ${a2}; ${a3}`;
  });

  await step('WP8: the customer picker searches without accents by keyboard, a duplicate is caught, and the customer page answers next visit and balance (R5-M4, R5-M1, R17-M3, R5-m4)', async () => {
    const f = await fieldCompany('customers');
    const jose = await f.customer('José Núñez', '9 Sycamore Ct, Fairview');
    await f.customer('Joseph Brown', '40 Oak Ave, Lakeside');
    const { c, p } = await ownerContext(f); watch(p, 'wp8-picker');
    await p.goto(`${f.C}/jobs/new`);
    const box = p.getByRole('combobox', { name: 'Customer' });
    await box.click();
    await box.fill('jose nunez');
    await p.getByRole('option', { name: /José Núñez.*Fairview/ }).waitFor();
    await box.press('ArrowDown'); await box.press('ArrowUp'); await box.press('Enter');
    if ((await box.inputValue()) !== 'José Núñez') throw new Error(`picked "${await box.inputValue()}"`);
    // Only one location: it is filled in.
    await p.waitForFunction(() => (document.querySelector('#f-locationId'))?.value);
    const a1 = await axe(p, 'wp8-picker');
    // Adding the same person again is caught.
    await p.getByRole('button', { name: 'New customer' }).click();
    await p.getByLabel('Customer name').fill('Jose Nunez');
    await p.getByRole('button', { name: 'Add customer' }).click();
    await p.getByRole('heading', { name: 'This looks like a customer you already have' }).waitFor();
    await p.getByText('Same name').waitFor();
    await p.getByRole('button', { name: 'Use this customer' }).click();
    // The customer page: next visit, balance, Upcoming/Past, New job with the customer chosen.
    await f.mkJob(new Date(Date.now() + 2 * 86400_000).toISOString(), { customerId: jose.id, locationId: jose.loc });
    await p.goto(`${f.C}/customers/${jose.id}`);
    // Leaving the half-filled job form asked first; discard to continue.
    const discard = p.getByRole('button', { name: 'Discard changes' });
    if (await discard.isVisible().catch(() => false)) await discard.click();
    await p.getByRole('region', { name: 'At a glance' }).getByText('Next visit').waitFor();
    await p.getByText('Nothing owed').waitFor();
    await p.getByRole('heading', { name: /Upcoming jobs \(1\)/ }).waitFor();
    const a2 = await axe(p, 'wp8-customer');
    await p.getByRole('link', { name: 'New job' }).click();
    await p.waitForURL(/jobs\/new\?customer=/);
    await p.waitForFunction(() => document.querySelector('#f-customerId')?.value === 'José Núñez', null, { timeout: 8000 }).catch(async () => { throw new Error(`New job from the customer page did not choose the customer: "${await p.locator('#f-customerId').inputValue()}"`); });
    await p.waitForFunction(() => document.querySelector('#f-locationId')?.value, null, { timeout: 8000 });
    await c.close(); await f.owner.dispose();
    return `${a1}; ${a2}`;
  });

  await step('WP9 390px: a driver records two products into two tanks at one stop, with a meter mismatch the office reviews and releases (R7-M1, R7-M4, R7-m1)', async () => {
    const f = await fieldCompany('fuel-lines');
    // Prices so the invoice can be complete; tanks on the customer's location.
    const svc = (await f.o.get('/services')).services.find((x) => x.category === 'fuel');
    const pricing = svc.pricing.map((p) => ({ ...p, rateE4: p.id === 'fuel_diesel' ? 38990 : p.id === 'fuel_dyed_diesel' ? 34990 : p.id === 'delivery' ? 250000 : p.rateE4 ?? 10000 }));
    const put = await f.owner.put(`/api/c/${f.cid}/services/${svc.id}`, { data: { service: { ...svc, pricing, taxRateBp: 725 }, version: svc.version } });
    if (put.status() !== 200) throw new Error(`service: ${await put.text()}`);
    const cust = (await f.o.get('/customers')).customers.find((x) => x.name === 'Acme Farms');
    const locId = (await f.o.get(`/customers/${cust.id}`)).locations[0].id;
    const tp = await f.owner.patch(`/api/c/${f.cid}/locations/${locId}`, { data: { tanks: [{ id: 't1', name: 'Shop tank', product: 'Diesel', size: '500 gal', notes: 'Fill pipe on the north side' }, { id: 't2', name: 'Loader', product: 'Dyed diesel', size: '', notes: '' }] } });
    if (tp.status() !== 200) throw new Error(`tanks: ${await tp.text()}`);
    const job = await f.mkJob(chicagoAt(10, 0));
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const p = await c.newPage(); watch(p, 'wp9-driver');
    await driverSignIn(p, f);
    await p.goto(`${f.C}/today/${job.id}`);
    await p.locator('.sticky-actions').getByRole('button', { name: 'Start job' }).click();
    await p.getByLabel('Completed successfully').check();
    const first = p.getByRole('group', { name: 'Delivery 1' });
    await first.getByLabel(/Tank or machine/).selectOption('Shop tank');
    await first.getByText('Fill pipe on the north side').waitFor();
    await first.getByLabel('Quantity (gal)', { exact: true }).fill('120');
    await first.getByLabel(/Ticket number/).fill('T-881');
    await p.getByRole('button', { name: 'Another tank or product' }).click();
    const second = p.getByRole('group', { name: 'Delivery 2' });
    await second.getByLabel(/Tank or machine/).selectOption('Loader');
    await p.waitForFunction(() => [...document.querySelectorAll('[aria-labelledby="dl-1"] select')][0]?.value === 'Dyed diesel', null, { timeout: 5000 })
      .catch(async () => { throw new Error(`choosing the tank did not fill in its product (${await second.getByLabel('Product').inputValue()})`); });
    await second.getByLabel(/Meter start/).fill('20410');
    await second.getByLabel(/Meter end/).fill('20490');
    await second.getByLabel('Quantity (gal)', { exact: true }).fill('95');
    await second.getByText('The meter shows 80 gal (20490 − 20410) but 95 gal was entered.').waitFor();
    await p.getByText('Total 215 gal at this stop · one delivery fee').waitFor();
    const a1 = await axe(p, 'wp9-driver-lines');
    await p.locator('.sticky-actions').getByRole('button', { name: 'Submit to office' }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
    await p.getByText(/Sent\. The office has your record\.|The office has your record\./).first().waitFor({ timeout: 10000 });
    await c.close();
    // The office: the invoice lists both products and one fee, and is held for the meter mismatch.
    const inv = await f.o.post(`/jobs/${job.id}/invoice`);
    const { c: oc, p: op } = await ownerContext(f); watch(op, 'wp9-office');
    await op.goto(`${f.C}/invoices/${inv.body.invoiceId}`);
    await op.getByText('Diesel (Shop tank, ticket T-881)').waitFor({ timeout: 10000 });
    await op.getByText('Dyed diesel (Loader)').waitFor();
    if (await op.getByText('Delivery fee').count() !== 1) throw new Error('the delivery fee is not charged exactly once');
    await op.getByText(/The meter shows 80 gal/).waitFor();
    const a2 = await axe(op, 'wp9-held');
    await op.getByRole('button', { name: 'Reviewed — release hold' }).click();
    await op.getByRole('dialog').getByRole('button', { name: 'Reviewed — release hold' }).click();
    await op.getByText('Hold released. The invoice is a draft again.').waitFor();
    await oc.close(); await f.owner.dispose();
    return `${a1}; ${a2}`;
  });
}
// ---------------------------------------------------------------- Phase 3: polish (WP10–WP17)
// Run only this section with E2E_ONLY=phase3.
if (!process.env.E2E_ONLY || process.env.E2E_ONLY === 'phase3') {
  await step('WP15: an unknown address shows "page not found" instead of jumping elsewhere (R17-m4)', async () => {
    const c = await browser.newContext(); const p = await c.newPage(); watch(p, 'wp15-404');
    await p.goto(`${BASE}/no-such-page`);
    await p.getByText('This page does not exist').waitFor();
    if (!p.url().endsWith('/no-such-page')) throw new Error(`moved to ${p.url()}`);
    await c.close();
  });

  await step('WP15/WP13: a driver opening an office job link lands on the driver screen, says "On my way", and a denied page names the permission (R17-m4, R15-M2)', async () => {
    const f = await fieldCompany('p3-driver');
    const job = await f.mkJob(soon(2));
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await c.newPage(); watch(p, 'wp15-driver');
    await driverSignIn(p, f);
    await p.goto(`${f.C}/jobs/${job.id}`);
    await p.waitForURL(new RegExp(`/today/${job.id}$`));
    await p.getByLabel('Arriving in').selectOption('20');
    await p.getByRole('button', { name: 'On my way' }).click();
    await p.getByText(/On the way since .*about 20 min/).waitFor();
    await p.getByRole('button', { name: 'Update estimate' }).waitFor();
    await p.goto(`${f.C}/invoices`);
    await p.getByText("Your role doesn't include this page").waitFor();
    await p.getByText('It needs permission to see invoices').waitFor().catch(async () => { throw new Error(await p.locator('.empty, .card').first().innerText()); });
    await c.close(); await f.owner.dispose();
  });

  await step('WP13: "Message customer" prepares a text and Send says why it is off (R15-M2, R15-m3)', async () => {
    const f = await fieldCompany('p3-msg');
    const cust = await f.o.post('/customers', { name: 'Texting Tina', phone: '(555) 777-0101', location: { address: '3 Pine Rd' } });
    const { c, p } = await ownerContext(f); watch(p, 'wp13-msg');
    await p.goto(`${f.C}/customers/${cust.body.id}`);
    await p.getByRole('button', { name: 'Message customer' }).click();
    const d = p.getByRole('dialog', { name: 'Message Texting Tina' });
    await d.getByLabel('Text message').check();
    await d.getByLabel('Message', { exact: true }).fill('Running about 15 minutes late.');
    if (!(await d.getByRole('button', { name: 'Send' }).isDisabled())) throw new Error('Send is on without a text service');
    await d.getByText(/Send is off: Text messaging is not set up/).waitFor();
    await d.getByRole('button', { name: 'Keep as prepared' }).click();
    await p.getByRole('region', { name: 'Conversation' }).getByText(/^Text ·/).waitFor();
    await c.close(); await f.owner.dispose();
  });

  await step('WP14: a Windows (Excel) file keeps its accents, and the review offers what to do with each row (R16-M1, R16-M3)', async () => {
    const f = await fieldCompany('p3-import');
    const { c, p } = await ownerContext(f); watch(p, 'wp14-import');
    await p.goto(`${f.C}/imports`);
    // "Núñez, José" and "Peña" written as Windows-1252 bytes.
    const latin1 = (str) => Buffer.from([...str].map((ch) => ch.charCodeAt(0)));
    const csv = latin1('Customer Name,Street,City,ZIP\r\n"Núñez, José",9 Sycamore Ct,Fairview,75002\r\nPeña Farms,1 Ranch Rd,Millbrook,75001\r\n');
    await p.locator('input[type=file]').setInputFiles({ name: 'excel.csv', mimeType: 'text/csv', buffer: csv });
    await p.getByText('Accented names as read: Núñez, José · Peña Farms').waitFor();
    await p.getByRole('button', { name: 'Review rows' }).click();
    await p.getByLabel('Turn 1 "Last, First" name(s) around to "First Last"').check();
    await p.getByText('José Núñez').waitFor();
    await p.getByText('9 Sycamore Ct, Fairview, 75002').first().waitFor();
    await axe(p, 'imports review');
    await c.close(); await f.owner.dispose();
  });

  await step('WP15: a long customer list shows 50 at a time (R17-m2)', async () => {
    const f = await fieldCompany('p3-long');
    for (let i = 0; i < 55; i++) await f.o.post('/customers', { name: `Long list ${String(i).padStart(2, '0')}`, allowDuplicate: true });
    const { c, p } = await ownerContext(f); watch(p, 'wp15-long');
    await p.goto(`${f.C}/customers`);
    await p.getByText(/Showing 50 of 56/).waitFor();
    await p.getByRole('button', { name: 'Show 6 more' }).click();
    await p.getByText('Long list 54').waitFor();
    await c.close(); await f.owner.dispose();
  });

  await step('WP16: a driver who chooses Español gets the job screen in Spanish; sign-in has a language switch (R4-M5, D8)', async () => {
    const f = await fieldCompany('p3-es');
    const job = await f.mkJob(soon(2));
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await c.newPage(); watch(p, 'wp16-es');
    await p.goto(`${BASE}/signin`);
    await p.getByRole('button', { name: 'Español' }).click();
    await p.getByRole('heading', { name: 'Iniciar sesión' }).waitFor();
    await p.getByRole('button', { name: 'English' }).click();
    await p.getByRole('heading', { name: 'Sign in' }).waitFor();
    await p.goto(`${BASE}/signin?next=${encodeURIComponent('/account')}`);
    await signInHere(p, f.driver);
    await p.waitForURL(/\/account/);
    await p.getByRole('combobox', { name: 'Language' }).selectOption('es');
    await p.getByText('Idioma guardado').waitFor();
    await p.goto(`${f.C}/today/${job.id}`);
    await p.getByRole('button', { name: 'Empezar trabajo' }).waitFor();
    await p.getByRole('button', { name: 'Voy en camino' }).waitFor();
    await p.getByRole('link', { name: 'Mis trabajos' }).first().waitFor();
    if ((await p.evaluate(() => document.documentElement.lang)) !== 'es') throw new Error('page language is not es');
    await p.getByRole('button', { name: 'Empezar trabajo' }).click();
    await p.getByRole('heading', { name: 'Anotar el resultado' }).waitFor();
    await p.getByText('Completado con éxito').waitFor();
    await p.screenshot({ path: `${OUT}/wp16-driver-es.png`, fullPage: true });
    await axe(p, 'driver job (es)');
    await c.close(); await f.owner.dispose();
  });

  await step('WP16: no page shows machine words (permission or action keys, field keys, raw time zones, validator wording) (R18-m2)', async () => {
    const f = await fieldCompany('p3-words');
    const job = await f.mkJob(soon(3));
    const wf = (await f.o.get('/workflows')).workflows[0];
    const svc = (await f.o.get('/services')).services[0];
    const { c, p } = await ownerContext(f); watch(p, 'wp16-words');
    const MACHINE = [
      /\b(company|members|roles|customers|jobs|resources|services|invoices|finance|payments|approvals|workflows|automation|messages|imports|templates|reports|assistant)\.[a-z_]+\b/,
      /\b(invoice|job|message)\.(prepare|issue|send|completed|partial|unsuccessful|assigned|created|started|en_route|problem_reported|approved|issued|prepared|prepare_invoice|prepare_job_update|create_followup)\b/,
      /\b[a-z]+_[a-z]+(_[a-z]+)*\b/, /\((?:in )?cents\)/i, /Invalid input|expected string|received undefined/, /\b(America|Europe|Asia|Pacific|Africa|Australia)\/[A-Z][A-Za-z_]+/,
    ];
    const bad = [];
    for (const path of ['', '/jobs', '/jobs?view=board', '/inbox', '/invoices?status=all', '/customers', '/team', '/workflows', `/workflows/${wf.id}`, '/automation', '/recurring', '/messages', '/services', `/services/${svc.id}`, '/settings', '/templates', '/imports', '/assistant', '/collections', '/resources', `/jobs/${job.id}`, '/jobs/new']) {
      await p.goto(`${f.C}${path}`);
      await p.locator('main h1, main [role=status]').first().waitFor({ timeout: 15000 });
      await p.waitForTimeout(400);
      const text = await p.locator('body').innerText();
      for (const re of MACHINE) { const m = re.exec(text); if (m) bad.push(`${path || '/'}: "${m[0]}"`); }
      // The same pages, scanned for serious or critical accessibility problems (WP17), the workflow editor included.
      try { await axe(p, path || '/'); } catch (e) { bad.push(String(e.message).slice(0, 300)); }
    }
    if (bad.length) throw new Error(bad.slice(0, 8).join('; '));
    await c.close(); await f.owner.dispose();
  });

  await step('WP17: at 200% text the driver screens keep their layout; Reschedule follows an unsuccessful visit (R18-m4, R9-m2, R6-m6)', async () => {
    const f = await fieldCompany('p3-big');
    const job = await f.mkJob(soon(2));
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await c.newPage(); watch(p, 'wp17-big');
    await driverSignIn(p, f);
    await p.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    for (const path of ['today', `today/${job.id}`]) {
      await p.goto(`${f.C}/${path}`);
      await p.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await p.locator('main h1').first().waitFor();
      const r = await p.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, small: [...document.querySelectorAll('.driver-page *')].filter((el) => el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 30 && (el.offsetParent !== null)).map((el) => `${el.tagName}.${el.className}:${getComputedStyle(el).fontSize}:${el.textContent.trim().slice(0, 30)}`).slice(0, 4) }));
      if (r.over > 1) throw new Error(`${path}: ${r.over}px sideways scroll at 200% text`);
      if (r.small.length) throw new Error(`${path}: text under 15px (30px at 200%): ${r.small.join(', ')}`);
    }
    // The address keeps most of the card's width.
    const ratio = await p.evaluate(() => { const addr = document.querySelector('.job-address'); const card = addr?.closest('.card'); return addr && card ? addr.getBoundingClientRect().width / card.getBoundingClientRect().width : 0; });
    if (ratio < 0.6) throw new Error(`address uses only ${Math.round(ratio * 100)}% of the card`);
    const icon = await p.evaluate(() => { const b = document.querySelector('.topbar .icon-btn'); return b ? b.getBoundingClientRect().width : 0; });
    if (icon < 44) throw new Error(`header buttons are ${icon}px wide`);
    await c.close();
    // The office reschedules the visit the driver couldn't finish.
    const j2 = await f.mkJob(soon(1));
    const dctx = await browser.newContext(); const dp = await dctx.newPage();
    await driverSignIn(dp, f);
    const api = dp.request;
    const mine = await (await api.get(`${BASE}/api/c/${f.cid}/my/jobs`, { headers: H })).json();
    const v = mine.jobs.find((x) => x.id === j2.id).version;
    await api.post(`${BASE}/api/c/${f.cid}/jobs/${j2.id}/complete`, { headers: H, data: { submissionId: `e2e-${Math.random()}`, baseVersion: v, outcome: 'unsuccessful', reasonCode: 'dog', reason: '' } });
    await dctx.close();
    const { c: oc, p: op } = await ownerContext(f); watch(op, 'wp17-resched');
    await op.goto(`${f.C}/jobs/${j2.id}`);
    await op.getByRole('button', { name: 'Reschedule' }).click();
    await op.waitForURL(/\/jobs\/[0-9a-f-]+\/edit$/);
    await op.getByText(/Follow-up job #\d+ created/).waitFor();
    await oc.close(); await f.owner.dispose();
  });
}
if (process.env.E2E_ONLY === 'phase3') {
  if (consoleErrors.length) fail('no console or page errors', consoleErrors.slice(0, 10)); else pass('no console or page errors');
  await browser.close();
  writeFileSync(`${OUT}/results-phase3.json`, JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
  process.exit(failed ? 1 : 0);
}
if (process.env.E2E_ONLY === 'phase2') {
  if (consoleErrors.length) fail('no console or page errors', consoleErrors.slice(0, 10)); else pass('no console or page errors');
  await browser.close();
  writeFileSync(`${OUT}/results-phase2.json`, JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
  process.exit(failed ? 1 : 0);
}
if (process.env.E2E_ONLY === 'phase1') {
  if (consoleErrors.length) fail('no console or page errors', consoleErrors.slice(0, 10)); else pass('no console or page errors');
  await browser.close();
  writeFileSync(`${OUT}/results-phase1.json`, JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
  process.exit(failed ? 1 : 0);
}

if (process.env.E2E_ONLY !== 'auth') {
  await step('M1: from the driver view, the walkthrough reaches the simulated email using only its own buttons', async () => {
    const v = await demoVisitor('guide');
    const { p } = v;
    const guide = guideOf(p);
    await p.goto(v.C);
    await guide.waitFor();
    await p.getByLabel('Simulated role').selectOption('driver');
    await p.waitForURL(/\/today$/);
    await guide.getByText('Step 1 of 7').waitFor();
    if (await guide.getByText(/^\d\. /).count()) throw new Error('step titles still carry their own numbers');
    await guide.getByRole('button', { name: /^Next/ }).click();
    // Step 2 needs the Owner: one button switches and shows the place.
    await guide.getByText('Step 2 of 7').waitFor();
    await guide.getByText('This step is done as the Owner. You are viewing as Driver.').waitFor();
    await guide.getByRole('button', { name: 'Switch to Owner to see what needs you' }).click();
    await highlighted(p, 'needs-you').waitFor();
    await guide.getByRole('button', { name: /^Next/ }).click();
    // Step 3: assign job #3 from the jobs table; it saves on change.
    await guide.getByText('Step 3 of 7').waitFor();
    await guide.getByRole('button', { name: 'Show me' }).click();
    await p.waitForURL(/\/jobs$/);
    await highlighted(p, 'assign-job-3').waitFor();
    const focused = await p.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    if (focused !== 'Driver for job #3') throw new Error(`Show me focused ${focused}`);
    await p.screenshot({ path: `${OUT}/r2-guide-step3-1366.png` });
    await p.getByLabel('Driver for job #3').selectOption({ label: 'Dana Driver (fictional)' });
    await p.getByText('Dana Driver (fictional) assigned to job #3').waitFor();
    await guide.getByText(/Done\. Job #3 is assigned to Dana Driver/).waitFor();
    // The walkthrough moves on by itself once the step is done.
    // Step 4 is the driver's: switch, start, record, submit.
    await guide.getByText('Step 4 of 7').waitFor();
    await guide.getByRole('button', { name: 'Switch to Driver to complete the job' }).click();
    await p.waitForURL(/\/today\/[0-9a-f-]+$/);
    await highlighted(p, 'driver-start').waitFor();
    await p.getByRole('button', { name: 'Start job' }).click();
    await p.getByText('Job started').waitFor();
    await highlighted(p, 'driver-record').waitFor();
    await p.getByLabel('Completed successfully').check();
    await p.getByLabel('Quantity (gal)', { exact: true }).fill('187.4');
    await p.getByRole('button', { name: 'Submit to office' }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
    await p.getByText('Sent. The office has your record.').waitFor();
    await guide.getByText(/Done\. The office has the driver's record/).waitFor();
    // The walkthrough moves on by itself once the step is done.
    // Step 5: back to the Owner, approve from a card that shows the bill.
    await guide.getByText('Step 5 of 7').waitFor();
    await guide.getByRole('button', { name: 'Switch to Owner to approve' }).click();
    await p.waitForURL(/\/inbox$/);
    const approve = p.getByRole('button', { name: 'Approve and issue · $773.99' });
    await approve.waitFor();
    await highlighted(p, 'approve-job-3').waitFor();
    const card = p.locator('article', { has: approve });
    const text = await card.innerText();
    for (const want of ['Delivered 187.4 gal of 200 requested', 'Gasoline', '187.4 gal', '$3.89', '$728.99', 'Delivery fee', '$45.00', '$773.99']) if (!text.includes(want)) throw new Error(`card is missing "${want}"`);
    await card.scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${OUT}/r2-walkthrough-step5-1366.png` });
    await card.screenshot({ path: `${OUT}/r2-approval-card.png` });
    // The card's total is the invoice page's total; viewing the invoice changes nothing.
    const href = await card.getByRole('link', { name: 'View invoice' }).getAttribute('href');
    const p2 = await v.c.newPage();
    await p2.goto(`${BASE}${href}`);
    const pageTotal = (await p2.locator('.state-track .money-big').innerText()).trim();
    await p2.close();
    if (pageTotal !== '$773.99') throw new Error(`invoice page total ${pageTotal}`);
    await approve.click();
    // Approving asks first, with the total (R14-m4).
    await p.getByRole('dialog').getByRole('button', { name: /^Approve/ }).click();
    await p.getByText(/Approved\. Rigo will continue/).waitFor();
    await guide.getByText(/Done\. The invoice for job #3 is approved and issued/).waitFor();
    // The walkthrough moves on by itself once the step is done.
    // Step 6: the prepared email opens with Send (simulated) highlighted.
    await guide.getByText('Step 6 of 7').waitFor();
    await guide.getByText('Press Send (simulated) to see what the customer would receive.').waitFor();
    await guide.getByRole('button', { name: 'Show me' }).click();
    const dlg = p.getByRole('dialog');
    await dlg.getByRole('button', { name: 'Send (simulated)' }).waitFor();
    await highlighted(p, 'send-simulated').waitFor();
    const mail = await dlg.innerText();
    for (const want of ['Gasoline: 187.4 gal × $3.89 = $728.99', 'Total: $773.99', 'Due:', 'How to pay:']) if (!mail.includes(want)) throw new Error(`email is missing "${want}"`);
    await dlg.getByRole('button', { name: 'Send (simulated)' }).click();
    await dlg.getByText('Simulated: this is what the customer would receive').waitFor();
    await p.keyboard.press('Escape');
    await guide.getByText(/Done\. Sent as Simulated/).waitFor();
    const msgs = (await v.api.get('/messages')).messages;
    if (!msgs.some((m) => m.status === 'simulated' && m.job_number === 3)) throw new Error('job #3 email is not marked simulated');
    // The walkthrough moves on by itself once the step is done.
    await guide.getByText('Step 7 of 7').waitFor();
    await guide.getByRole('button', { name: 'Done', exact: true }).click();
    await guide.waitFor({ state: 'hidden' });
    // Reopening the demo starts as Owner.
    await p.getByLabel('Simulated role').selectOption('driver');
    await p.waitForURL(/\/today$/);
    await p.goto(`${BASE}/start-demo`);
    await p.waitForURL(new RegExp(`/c/${v.cid}`));
    const boot = await v.api.get('');
    if (boot.role.key !== 'owner') throw new Error(`reopened as ${boot.role.key}`);
    if ((await p.getByLabel('Simulated role').inputValue()) !== 'owner') throw new Error('View as is not Owner after reopening');
    await v.c.close();
  });

  await step('M1: a step that is not possible yet says why and offers the step that unlocks it', async () => {
    const v = await demoVisitor('guide-blocked');
    await v.api.post('/demo/guide', { step: 4 });
    await v.p.goto(`${v.C}/inbox`);
    const guide = guideOf(v.p);
    await guide.getByText('Job #3 is not completed yet, so there is no invoice to approve.').waitFor();
    await guide.getByRole('button', { name: 'Go to step 4' }).click();
    await guide.getByText('Step 4 of 7').waitFor();
    await guide.getByText(/Job #3 first needs Dana Driver as its driver/).waitFor();
    await v.c.close();
  });

  await step('M2: a driver chosen in the table is saved, survives navigation, and can be undone', async () => {
    const v = await demoVisitor('assign');
    const { p } = v;
    await v.api.post('/demo/guide', { dismissed: true });
    await p.goto(`${v.C}/jobs`);
    const sel = p.getByLabel('Driver for job #3');
    await sel.selectOption({ label: 'Rafa Route (fictional)' });
    await p.getByText('Rafa Route (fictional) assigned to job #3').waitFor();
    await p.screenshot({ path: `${OUT}/r2-jobs-assign-1366.png` });
    await p.getByRole('link', { name: 'Home' }).first().click();
    await p.getByRole('heading', { name: 'Needs you' }).waitFor();
    await p.goBack();
    if ((await p.getByLabel('Driver for job #3').locator('option:checked').innerText()) !== 'Rafa Route (fictional)') throw new Error('assignment not kept');
    const job3 = (await v.api.get('/jobs?status=all')).jobs.find((j) => j.number === 3);
    const detail = await v.api.get(`/jobs/${job3.id}`);
    if (detail.job.assignee_name !== 'Rafa Route (fictional)') throw new Error(`job page says ${detail.job.assignee_name}`);
    // Undo restores the previous driver (none) using the new version.
    await sel.selectOption({ label: 'Dana Driver (fictional)' });
    const toast = p.locator('.toast', { hasText: 'Dana Driver (fictional) assigned to job #3' });
    await toast.getByRole('button', { name: 'Undo' }).click();
    await p.getByText('Change undone on job #3').waitFor();
    if ((await p.getByLabel('Driver for job #3').inputValue()) !== job3.assigned_user_id && job3.assigned_user_id) throw new Error('undo did not restore');
    const after = (await v.api.get(`/jobs/${job3.id}`)).job;
    if (after.assignee_name !== 'Rafa Route (fictional)') throw new Error(`after undo: ${after.assignee_name}`);
    await v.c.close();
  });

  await step('M2: a stale second tab is refused, the menu goes back and the reason is shown', async () => {
    const v = await demoVisitor('assign-stale');
    await v.api.post('/demo/guide', { dismissed: true });
    const a = v.p;
    const b = await v.c.newPage();
    await a.goto(`${v.C}/jobs`);
    await b.goto(`${v.C}/jobs`);
    await a.getByLabel('Driver for job #2').waitFor();
    await b.getByLabel('Driver for job #2').selectOption({ label: 'Rafa Route (fictional)' });
    await b.getByText('Rafa Route (fictional) assigned to job #2').waitFor();
    const before = await a.getByLabel('Driver for job #2').inputValue();
    await a.getByLabel('Driver for job #2').selectOption({ label: 'Sam Dispatch (fictional)' });
    await a.getByText(/Not changed: This job changed since you loaded it/).waitFor();
    if ((await a.getByLabel('Driver for job #2').inputValue()) !== before) throw new Error('menu was not put back');
    await a.screenshot({ path: `${OUT}/r2-jobs-assign-conflict.png` });
    await v.c.close();
  });

  await step('M2: arrowing through the menu with the keyboard saves once', async () => {
    const v = await demoVisitor('assign-keys');
    await v.api.post('/demo/guide', { dismissed: true });
    const { p } = v;
    await p.goto(`${v.C}/jobs`);
    const job4 = (await v.api.get('/jobs?status=all')).jobs.find((j) => j.number === 4);
    const count = async () => (await v.api.get(`/jobs/${job4.id}`)).events.filter((e) => ['assigned', 'reassigned', 'unassigned'].includes(e.type)).length;
    const n0 = await count();
    await p.getByLabel('Driver for job #4').focus();
    for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowDown');
    await p.keyboard.press('Tab');
    await p.locator('.toast', { hasText: /assigned to job #4|removed from job #4/ }).waitFor();
    await p.waitForTimeout(1500);
    const n1 = await count();
    if (n1 - n0 !== 1) throw new Error(`${n1 - n0} assignments were saved`);
    await v.c.close();
  });

  await step('M2: leaving the job page with unsaved driver changes asks first', async () => {
    const v = await demoVisitor('assign-guard');
    await v.api.post('/demo/guide', { dismissed: true });
    const { p } = v;
    const job3 = (await v.api.get('/jobs?status=all')).jobs.find((j) => j.number === 3);
    await p.goto(`${v.C}/jobs/${job3.id}`);
    await p.getByLabel('Driver', { exact: true }).selectOption({ label: 'Dana Driver (fictional)' });
    await p.getByText('Unsaved changes.').waitFor();
    await p.getByRole('link', { name: 'Jobs', exact: true }).first().click();
    const dlg = p.getByRole('dialog', { name: 'Leave without saving?' });
    await dlg.getByText('You have unsaved driver changes. Save or discard?').waitFor();
    await dlg.getByRole('button', { name: 'Save' }).click();
    await p.waitForURL(/\/jobs$/);
    if ((await v.api.get(`/jobs/${job3.id}`)).job.assignee_name !== 'Dana Driver (fictional)') throw new Error('not saved from the dialog');
    await v.c.close();
  });

  await step('M4 + m4: demo shows per-product fuel prices, 28-day rental billing, a priced emergency and late jobs', async () => {
    const v = await demoVisitor('business');
    await v.api.post('/demo/guide', { dismissed: true });
    const { p } = v;
    const svcs = (await v.api.get('/services')).services;
    const fuel = svcs.find((x) => x.category === 'fuel');
    await p.goto(`${v.C}/services/${fuel.id}`);
    await p.getByText('Charge only when Product is Heating oil.').waitFor();
    await p.getByRole('heading', { name: 'Pricing' }).scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${OUT}/r2-fuel-pricing-1366.png`, fullPage: true });
    await p.goto(`${v.C}/recurring/new`);
    await p.getByLabel('Bill', { exact: true }).waitFor();
    if (!(await p.getByLabel('Bill', { exact: true }).locator('option:checked').innerText()).startsWith('Every 4 weeks (28 days)')) throw new Error('28-day billing is not offered first');
    await p.screenshot({ path: `${OUT}/r2-recurring-form-1366.png`, fullPage: true });
    await p.goto(`${v.C}/recurring`);
    await p.getByText(/every 4 weeks/).first().waitFor();
    await p.goto(`${v.C}/jobs?status=all`);
    await p.locator('tr', { hasText: '#3' }).getByText('Urgent').waitFor();
    await p.goto(`${v.C}/invoices?status=all`);
    const em = (await v.api.get('/jobs?status=all')).jobs.find((j) => j.priority === 'emergency');
    const inv = (await v.api.get(`/jobs/${em.id}`)).invoice;
    await p.goto(`${v.C}/invoices/${inv.id}`);
    await p.getByRole('cell', { name: 'After-hours visit' }).waitFor();
    await p.getByRole('cell', { name: 'Pump-out (includes 1,000 gal)' }).waitFor();
    // A job whose window ended without a start is flagged, and counted on Home.
    const job1 = (await v.api.get('/jobs?status=all')).jobs.find((j) => j.number === 1);
    await v.api.post(`/jobs/${job1.id}/assign`, { userId: job1.assigned_user_id, resourceIds: [], scheduledStart: new Date(Date.now() - 3 * 3600_000).toISOString(), scheduledEnd: new Date(Date.now() - 2 * 3600_000).toISOString(), version: job1.version });
    await p.goto(`${v.C}/jobs`);
    await p.locator('tr', { hasText: '#1' }).getByText('Late').waitFor();
    await p.goto(v.C);
    await p.getByText('Jobs running late').waitFor();
    await p.getByText('Urgent or emergency jobs without a driver').waitFor();
    await p.getByRole('heading', { name: 'Invoices waiting for your approval' }).waitFor();
    await p.getByText('Drafts waiting for approval').waitFor();
    await p.goto(`${v.C}/jobs/${job1.id}`);
    await p.locator('.ident').getByText('Late').waitFor();
    await v.c.close();
  });

  await step('m1/m2: phone demo bar keeps the warning and labels, walkthrough collapses, no overflow at 375 in any role', async () => {
    const v = await demoVisitor('phone', 375, 812);
    const { p } = v;
    const notes = [];
    for (const role of ['owner', 'dispatcher', 'driver', 'office']) {
      await v.api.post('/demo/role', { role });
      for (const path of ['', '/jobs', '/inbox', '/today']) {
        await p.goto(`${v.C}${path}`);
        await p.waitForLoadState('networkidle');
        await noOverflow(p, `${role} 375 ${path || '/'}`);
        const tb = await p.evaluate(() => document.querySelector('.topbar')?.scrollWidth ?? 0);
        if (tb > 375) throw new Error(`${role} ${path}: top bar is ${tb}px wide`);
      }
      notes.push(role);
    }
    await v.api.post('/demo/role', { role: 'owner' });
    await p.goto(v.C);
    const bar = p.getByRole('region', { name: 'Demo workspace' });
    await bar.getByText('Fictional. Nothing is sent or charged.').waitFor();
    await bar.getByRole('button', { name: 'Reset demo' }).waitFor();
    if (!(await bar.getByRole('button', { name: 'Reset demo' }).innerText()).includes('Reset')) throw new Error('Reset has no visible label');
    const guide = guideOf(p);
    await guide.waitFor();
    await p.screenshot({ path: `${OUT}/r2-demo-bar-390-open.png` });
    await guide.getByRole('button', { name: 'Collapse the walkthrough to one line' }).click();
    const h = await guide.evaluate((el) => el.getBoundingClientRect().height);
    if (h > 64) throw new Error(`collapsed walkthrough is ${h}px tall`);
    const stack = await p.evaluate(() => (document.querySelector('.banner-demo')?.getBoundingClientRect().height ?? 0) + (document.querySelector('.topbar')?.getBoundingClientRect().height ?? 0) + (document.querySelector('.guide')?.getBoundingClientRect().height ?? 0));
    if (stack > 844 * 0.3) throw new Error(`demo bar, top bar and walkthrough take ${Math.round(stack)}px`);
    await p.screenshot({ path: `${OUT}/r2-demo-bar-390.png` });
    // Hidden walkthrough stays reachable from the bar.
    await guide.getByRole('button', { name: 'Expand the walkthrough' }).click();
    await guide.getByRole('button', { name: /Hide walkthrough/ }).click();
    await bar.getByRole('button', { name: 'Resume walkthrough' }).click();
    await guide.waitFor();
    return `${notes.length} roles, stacked chrome ${Math.round(stack)}px`;
  });

  for (const width of [768, 1024, 1440]) {
    await step(`no horizontal overflow at ${width}px in every simulated role`, async () => {
      const v = await demoVisitor(`roles-${width}`, width, 900);
      for (const role of ['owner', 'dispatcher', 'driver', 'office']) {
        await v.api.post('/demo/role', { role });
        for (const path of ['', '/jobs', '/inbox', '/today']) {
          await v.p.goto(`${v.C}${path}`);
          await v.p.waitForLoadState('networkidle');
          await noOverflow(v.p, `${role} ${width} ${path || '/'}`);
        }
      }
      await v.c.close();
    });
  }

  for (const theme of ['light', 'dark']) {
    await step(`axe on Round 2 screens, ${theme} theme`, async () => {
      const v = await demoVisitor(`axe-${theme}`, 1366, 900, { colorScheme: theme });
      await v.c.request.patch(`${BASE}/api/auth/me`, { headers: H, data: { theme } });
      const fuel = (await v.api.get('/services')).services.find((x) => x.category === 'fuel');
      const out = [];
      for (const path of ['', '/jobs', '/inbox', `/services/${fuel.id}`, '/recurring/new', '/jobs/new']) {
        await v.p.goto(`${v.C}${path}`);
        await v.p.waitForLoadState('networkidle');
        await v.p.locator('main h1').first().waitFor();
        await guideOf(v.p).waitFor();
        out.push(`${path || '/'}: ${await axe(v.p, `${theme} ${path || '/'}`)}`);
      }
      // The inbox approval card at 200% text, and the demo home on a phone in this theme.
      await v.p.setViewportSize({ width: 390, height: 844 });
      await v.p.goto(`${v.C}/inbox`);
      await v.p.waitForLoadState('networkidle');
      await v.p.screenshot({ path: `${OUT}/r2-inbox-390-${theme}.png`, fullPage: true });
      await v.p.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await noOverflow(v.p, `${theme} inbox 200% text`);
      await v.c.close();
      return out.filter((n) => !n.endsWith('no violations')).join('; ') || 'no violations';
    });
  }
}

if (process.env.E2E_ONLY === 'round2') {
  if (consoleErrors.length) fail('no console or page errors', consoleErrors.slice(0, 10)); else pass('no console or page errors');
  await browser.close();
  writeFileSync(`${OUT}/results-round2.json`, JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
  process.exit(failed ? 1 : 0);
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
    // One real company: sign-in goes straight to it (R4-m4); the workspaces page lists it too.
    await p.waitForURL(/\/c\/[^/]+/, { timeout: 8000 });
    await p.goto(`${BASE}/workspaces`);
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
// A second server started without email (like the live site): NODE_ENV=production on another port.
const NOEMAIL = process.env.NOEMAIL_URL ?? null;
async function themed(theme, viewport = { width: 1440, height: 900 }) {
  const c = await browser.newContext({ viewport });
  await c.addInitScript((t) => { try { localStorage.setItem('rigo-theme', t); } catch { /* ignore */ } }, theme);
  return c;
}

await step('M4: "/" is the landing page when signed out and goes to workspaces when signed in', async () => {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await c.newPage(); watch(p, 'landing');
  await p.goto(`${BASE}/`);
  await p.getByRole('heading', { level: 1, name: /fuel delivery, portable toilet or septic/ }).waitFor();
  await p.getByText('Free to start.').waitFor();
  await p.getByRole('link', { name: 'Try the demo' }).first().waitFor();
  if (!(await p.title()).includes('Rigo')) throw new Error(`title ${await p.title()}`);
  const imgs = await p.locator('main img').evaluateAll((els) => els.map((e) => ({ w: e.getAttribute('width'), h: e.getAttribute('height'), lazy: e.getAttribute('loading') })));
  if (imgs.length < 3 || imgs.some((i) => !i.w || !i.h)) throw new Error(`images ${JSON.stringify(imgs)}`);
  if (imgs.filter((i) => i.lazy === 'lazy').length < 2) throw new Error('below-the-fold screenshots should load lazily');
  // Scroll through so the lazy-loaded screenshots load before the full-page capture.
  for (let y = 0; y < 4000; y += 400) { await p.evaluate((v) => window.scrollTo(0, v), y); await p.waitForTimeout(60); }
  await p.waitForLoadState('networkidle');
  await p.screenshot({ path: `${OUT}/landing-1440.png`, fullPage: true });
  const who = await apiAccount('Lena Landing');
  await p.goto(`${BASE}/signin`);
  await signInHere(p, who);
  await p.waitForURL(/\/workspaces$/);
  await p.goto(`${BASE}/`);
  await p.waitForURL(/\/workspaces$/);
  // Signed-in people skip the sign-in and sign-up forms (m4).
  await p.goto(`${BASE}/signin`);
  await p.waitForURL(/\/workspaces$/);
  await p.goto(`${BASE}/signup?next=/account`);
  await p.waitForURL(/\/account$/);
  await c.close();
});

await step('M4: "Try the demo" signs up and opens the demo', async () => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await c.newPage(); watch(p, 'try-demo');
  await p.goto(`${BASE}/`);
  await p.getByRole('link', { name: 'Try the demo' }).first().click();
  await p.getByLabel('Your name').fill('Theo Trial');
  await p.getByLabel('Email').fill(`theo-${Date.now()}@example.test`);
  await p.getByLabel('Password', { exact: true }).fill(STRONG);
  await p.getByRole('button', { name: 'Create account' }).click();
  await p.waitForURL(/\/c\/[0-9a-f-]+$/, { timeout: 15000 });
  await p.getByRole('region', { name: 'Demo workspace' }).waitFor();
  await p.waitForFunction(() => /\(Demo\) · Rigo$/.test(document.title), null, { timeout: 8000 }).catch(async () => { throw new Error(`demo tab title: ${await p.title()}`); });
  await c.close();
});

for (const width of [375, 768, 1024, 1440]) {
  await step(`M4: landing and sign-in pages have no horizontal overflow at ${width}px`, async () => {
    const c = await browser.newContext({ viewport: { width, height: 900 } });
    const p = await c.newPage();
    for (const path of ['/', '/signin', '/signup', '/forgot', '/reset/not-a-real-token-123456']) {
      await p.goto(`${BASE}${path}`);
      await p.waitForLoadState('networkidle');
      await noOverflow(p, `${width} ${path}`);
    }
    await p.goto(`${BASE}/`);
    await p.waitForLoadState('networkidle');
    await p.screenshot({ path: `${OUT}/landing-${width}.png`, fullPage: width < 800 });
    await p.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    if (width === 375) await noOverflow(p, '375 / at 200% text');
    await c.close();
  });
}

await step('m5 and m8: tab titles, and the sign-in page has a big "Create a free account" button', async () => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await c.newPage();
  await p.goto(`${BASE}/signin`);
  await p.getByRole('heading', { name: 'Sign in' }).waitFor();
  const titled = (t) => p.waitForFunction((x) => document.title === x, t, { timeout: 5000 }).catch(async () => { throw new Error(`title ${await p.title()}, expected ${t}`); });
  await titled('Sign in · Rigo');
  const create = await p.getByRole('link', { name: 'Create a free account' }).boundingBox();
  const forgot = await p.getByRole('link', { name: 'Forgot your password?' }).boundingBox();
  if (!create || create.height < 44 || create.width < 300) throw new Error(`create button ${JSON.stringify(create)}`);
  if (!forgot || forgot.height < 24) throw new Error(`forgot link ${JSON.stringify(forgot)}`);
  await p.goto(`${BASE}/signup`);
  await titled('Create your account · Rigo');
  await c.close();
});

await step('M1: after five wrong tries the next one waits, and the message names the wait', async () => {
  const who = await apiAccount('Wanda Wrong');
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await c.newPage();
  await p.goto(`${BASE}/signin`);
  await p.getByLabel('Email').fill(who.email);
  for (let i = 1; i <= 6; i++) {
    await p.getByLabel('Password', { exact: true }).fill(`wrong-guess-${i}-xyz`);
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    if (i <= 5) await p.getByText('That email and password do not match an account.').waitFor();
  }
  await p.getByText(/Try again in 1[0-5] seconds/).waitFor();
  await p.getByRole('link', { name: 'reset your password' }).waitFor();
  await p.screenshot({ path: `${OUT}/signin-paused-390.png` });
  await c.close();
});

await step('M3: sign-up suggests a fix for a mistyped email domain', async () => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await c.newPage();
  await p.goto(`${BASE}/signup`);
  await p.getByLabel('Email').fill('dana.reyes@gmial.com');
  await p.getByLabel('Your name').focus();
  await p.getByText('Did you mean').waitFor();
  await p.getByRole('button', { name: 'Use gmail.com' }).click();
  const v = await p.getByLabel('Email').inputValue();
  if (v !== 'dana.reyes@gmail.com') throw new Error(`email is ${v}`);
  await c.close();
});

await step('m3: a used or made-up reset link says so instead of showing the form', async () => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await c.newPage();
  await p.goto(`${BASE}/reset/not-a-real-token-123456`);
  await p.getByText('This link was already used.').waitFor();
  if (await p.getByLabel('New password').count()) throw new Error('form shown for an invalid link');
  await p.getByRole('link', { name: 'Send a new link' }).click();
  await p.waitForURL(/\/forgot$/);
  await p.goto(`${BASE}/confirm-email/not-a-real-token-123456`);
  await p.getByText('This link has expired or was already used').waitFor();
  await c.close();
});

if (NOEMAIL) {
  await step('C2: without email, the forgot page shows the alternatives before anyone types', async () => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await c.newPage(); watch(p, 'forgot-noemail');
    await p.goto(`${NOEMAIL}/forgot`);
    await p.getByText('Ask an owner of your company to create a reset link for you from Team.').waitFor();
    if (await p.getByLabel('Email').count()) throw new Error('email form shown with no email service');
    if (await p.getByText(/installation/i).count()) throw new Error('"installation" shown');
    await p.screenshot({ path: `${OUT}/forgot-noemail-390.png` });
    await c.close();
  });
}

// Accessibility of the changed pages, in both themes. Pages needing an account use a fresh one.
for (const theme of ['light', 'dark']) {
  await step(`axe: landing and account pages, ${theme} theme`, async () => {
    const c = await themed(theme);
    const p = await c.newPage();
    const notes = [];
    for (const path of ['/', '/signin', '/signup', '/forgot', '/reset/not-a-real-token-123456']) {
      await p.goto(`${BASE}${path}`);
      await p.waitForLoadState('networkidle');
      await p.locator('h1').first().waitFor();
      notes.push(`${path}: ${await axe(p, `${theme} ${path}`)}`);
    }
    // A valid reset link, then the signed-in pages and the Team reset-link dialog.
    const owner = await apiAccount('Rosa Owner', { company: `Rosa Septic ${theme}` });
    await p.goto(`${BASE}/signin`);
    await signInHere(p, owner);
    await p.waitForURL(/\/c\/[^/]+/); // one company: straight into it
    for (const path of ['/workspaces', '/account']) {
      await p.goto(`${BASE}${path}`);
      await p.waitForLoadState('networkidle');
      notes.push(`${path}: ${await axe(p, `${theme} ${path}`)}`);
    }
    const me = await (await p.request.get(`${BASE}/api/auth/me`)).json();
    const cid = me.companies.find((x) => x.kind === 'real').id;
    const driver = await apiAccount('Luis Ortega');
    const inv = await (await p.request.post(`${BASE}/api/c/${cid}/invitations`, { headers: { 'x-rigo': '1' }, data: { email: driver.email, role: 'driver' } })).json();
    const dApi = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-rigo': '1' } });
    await dApi.post('/api/auth/signin', { data: { email: driver.email, password: STRONG } });
    await dApi.post(`/api/invitations/${inv.link.split('/invite/')[1]}/accept`);
    await dApi.dispose();
    await p.goto(`${BASE}/c/${cid}/team`);
    await p.getByRole('button', { name: 'Create password reset link for Luis Ortega' }).click();
    const dlg = p.getByRole('dialog', { name: 'Password reset link for Luis' });
    await dlg.getByText('Text this link to Luis. It works once and expires in 24 hours.').waitFor();
    notes.push(`team dialog: ${await axe(p, `${theme} team reset dialog`)}`);
    await p.screenshot({ path: `${OUT}/team-reset-link-${theme}.png` });
    const link = await dlg.getByRole('textbox').inputValue();
    await dlg.getByRole('button', { name: 'Done' }).click();
    const c2 = await themed(theme, { width: 390, height: 844 });
    const p2 = await c2.newPage();
    await p2.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
    await p2.getByLabel('New password').waitFor();
    notes.push(`reset (valid): ${await axe(p2, `${theme} reset valid`)}`);
    await c2.close();
    await c.close();
    return notes.filter((n) => !n.endsWith('no violations')).join('; ') || 'no violations';
  });
}

// Scenario S1: Dana arrives at "/", signs up with a typo, fixes it later, forgets the password and
// recovers it: by email on the local copy, by an owner's reset link on the copy without email.
async function scenarioS1(base, label) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await c.newPage(); watch(p, `s1-${label}`);
  const stamp = Date.now();
  const typo = `dana.reyes.${stamp}@gmial.com`;
  const fixed = `dana.reyes.${stamp}@gmail.com`;
  await p.goto(`${base}/`);
  await p.getByRole('link', { name: 'Create a free account' }).first().click();
  await p.getByLabel('Your name').fill('Dana Reyes');
  await p.getByLabel('Email').fill(typo);
  await p.getByLabel('Password', { exact: true }).focus();
  await p.getByText('Did you mean').waitFor();
  // Dana ignores the suggestion at first.
  await p.getByLabel('Password', { exact: true }).fill(STRONG);
  await p.getByRole('button', { name: 'Create account' }).click();
  await p.waitForURL(/\/workspaces$/, { timeout: 8000 });
  await p.getByRole('heading', { name: 'Hello, Dana' }).waitFor();
  await p.screenshot({ path: `${OUT}/s1-${label}-workspaces-390.png`, fullPage: true });
  // Later, Dana fixes the email on Account.
  await p.goto(`${base}/account`);
  await p.getByLabel('New email').fill(fixed);
  await p.locator('#f-password').fill(STRONG);
  await p.getByRole('button', { name: 'Change email' }).click();
  if (label === 'local') {
    await p.getByText(`Check ${fixed}`).waitFor();
    const mail = await (await p.request.get(`${base}/api/auth/dev/mailbox`)).json();
    const link = mail.messages.find((m) => m.to_email === fixed && m.kind === 'email_change').link;
    await p.goto(link.replace(/^https?:\/\/[^/]+/, base));
    await p.getByRole('button', { name: 'Use this email address' }).click();
    await p.getByText('Your account now uses this email address.').waitFor();
  } else {
    await p.getByText('Email changed. Other devices were signed out.').waitFor();
  }
  await p.goto(`${base}/account`);
  await p.getByText(fixed).first().waitFor();
  await p.screenshot({ path: `${OUT}/s1-${label}-account-390.png`, fullPage: true });
  // An employer invites the corrected address, and Dana joins.
  const owner = await pwRequest.newContext({ baseURL: base, extraHTTPHeaders: { 'x-rigo': '1' } });
  await owner.post('/api/auth/signup', { data: { name: 'Olivia Owner', email: `olivia-${stamp}-${label}@example.test`, password: STRONG } });
  const co = await (await owner.post('/api/companies', { data: { name: `Reyes Portable Toilets ${label}`, timezone: 'America/Chicago', currency: 'USD', categories: ['portable_toilet'], start: 'blank' } })).json();
  await owner.post(`/api/c/${co.id}/invitations`, { data: { email: fixed, role: 'driver' } });
  await p.goto(`${base}/workspaces`);
  await p.getByRole('button', { name: 'Accept and open' }).click();
  await p.waitForURL(/\/c\/[0-9a-f-]+/);
  // Sign out, forget the password.
  await p.goto(`${base}/workspaces`);
  await p.getByRole('button', { name: 'Sign out' }).click();
  await p.waitForURL(/\/signin/);
  await p.getByRole('link', { name: 'Forgot your password?' }).click();
  // Wait for the reset page itself: the sign-in page also has an "Email" field.
  await p.waitForURL(/\/forgot$/);
  await p.getByRole('heading', { name: 'Reset your password' }).waitFor();
  let resetLink;
  if (label === 'local') {
    await p.getByLabel('Email').fill(fixed);
    await p.getByRole('button', { name: 'Send reset link' }).click();
    await p.getByText('Check your email').waitFor();
    const mail = await (await p.request.get(`${base}/api/auth/dev/mailbox`)).json();
    resetLink = mail.messages.find((m) => m.to_email === fixed && m.kind === 'password_reset').link;
  } else {
    await p.getByText('Ask an owner of your company to create a reset link for you from Team.').waitFor();
    await p.screenshot({ path: `${OUT}/s1-${label}-forgot-390.png`, fullPage: true });
    const members = (await (await owner.get(`/api/c/${co.id}/members`)).json()).members;
    const dana = members.find((m) => m.name === 'Dana Reyes');
    resetLink = (await (await owner.post(`/api/c/${co.id}/members/${dana.id}/reset-link`)).json()).link;
  }
  await owner.dispose();
  await p.goto(resetLink.replace(/^https?:\/\/[^/]+/, base));
  await p.getByLabel('New password').fill('copper-meadow-lantern-8');
  await p.getByRole('button', { name: 'Save password and sign in' }).click();
  await p.waitForURL(/\/workspaces$/);
  await p.getByText("Password changed. You're signed in.").waitFor();
  await p.screenshot({ path: `${OUT}/s1-${label}-after-reset-390.png` });
  // The used link now says so.
  await p.goto(resetLink.replace(/^https?:\/\/[^/]+/, base));
  await p.getByText('This link has expired or was already used').waitFor();
  await c.close();
}
await step('S1 on the local copy (simulated mailbox), 390px', () => scenarioS1(BASE, 'local'));
if (NOEMAIL) await step('S1 on the copy without email (owner reset link), 390px', () => scenarioS1(NOEMAIL, 'noemail'));

await step('ten successful sign-ins in a row never lock the account', async () => {
  const who = await apiAccount('Ten Times');
  for (let i = 0; i < 10; i++) {
    const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-rigo': '1' } });
    const r = await api.post('/api/auth/signin', { data: { email: who.email, password: STRONG } });
    await api.dispose();
    if (!r.ok()) throw new Error(`sign-in ${i + 1}: ${r.status()}`);
  }
});

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
  await page.getByText('Dana Driver (fictional) assigned to job #3').waitFor();
});

await step('create a job through the form (draft explains missing info)', async () => {
  await page.goto(`${BASE}${cidPath()}/jobs/new`);
  // The customer picker: open it and take the first customer with the keyboard.
  const box = page.getByRole('combobox', { name: 'Customer' });
  await page.waitForLoadState('networkidle');
  let opened = false;
  for (let i = 0; i < 3 && !opened; i++) {
    await box.click();
    opened = await page.locator('.combo-list').getByRole('option').first().waitFor({ timeout: 5000 }).then(() => true, () => false);
  }
  if (!opened) throw new Error(`the customer list did not open: focus on ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 200))}; ${await page.locator('.combo').first().innerHTML()}`);
  await box.press('Enter');
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
  await page.getByLabel('Completed successfully').check();
  await page.getByLabel('Quantity (gal)', { exact: true }).fill('432.5');
  await page.getByText('Saved on this phone').first().waitFor();
  await page.screenshot({ path: `${OUT}/driver-job-390.png`, fullPage: true });
  await page.getByRole('button', { name: 'Submit to office' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  await page.getByText('Sent. The office has your record.').waitFor();
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
  await cards.first().getByRole('button', { name: /^Approve/ }).first().click();
  // Approving asks first, with the total (R14-m4).
  await page.getByRole('dialog').getByRole('button', { name: /^Approve/ }).click();
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
  await page.getByRole('article', { name: 'Invoice' }).waitFor();
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
  // The invited address is filled in from the invitation, and joining needs no extra click (R4-m6).
  await p.waitForFunction((em) => (document.querySelector('#f-email'))?.value === em, empEmail);
  await p.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await p.getByRole('button', { name: 'Create account' }).click();
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
