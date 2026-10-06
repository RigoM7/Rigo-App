// Captures the landing page screenshots from a fresh demo company (fictional data) in both themes
// and writes optimized WebP files to static/landing/. Run against a local server:
//   npm run build && npm start &
//   BASE_URL=http://localhost:8787 NODE_PATH=$(npm root -g) node scripts/landing-shots.mjs
// Needs the pre-installed Chromium (/opt/pw-browsers) and ffmpeg with libwebp.
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const OUT = 'static/landing';
const TMP = join(tmpdir(), `rigo-landing-${Date.now()}`);
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? execSync('ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1').toString().trim();
const browser = await chromium.launch({ executablePath: exe });

const toWebp = (png, name) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '78', '-compression_level', '6', join(OUT, `${name}.webp`)]);

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const api = (method, path, data) => page.request.fetch(`${BASE}/api${path}`, { method, headers: { 'x-rigo': '1' }, data });
  const email = `landing-${theme}-${Date.now()}@example.test`;
  const r = await api('POST', '/auth/signup', { name: 'Morgan Reyes', email, password: 'tidy-lantern-orchard-42' });
  if (!r.ok()) throw new Error(`signup failed: ${await r.text()}`);
  const demo = await (await api('POST', '/demo')).json();
  await api('PATCH', '/auth/me', { theme });
  await page.goto(`${BASE}/`);
  await page.evaluate((t) => localStorage.setItem('rigo-theme', t), theme);
  // Hide the walkthrough so the screenshots show the product itself.
  await api('POST', `/c/${demo.id}/demo/guide`, { dismissed: true });

  // Office: Home with today's timeline.
  await page.goto(`${BASE}/c/${demo.id}`);
  await page.getByRole('heading', { name: "Today's timeline" }).waitFor();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(TMP, 'timeline.png') });
  toWebp(join(TMP, 'timeline.png'), `timeline-${theme}`);

  // Owner: an invoice prepared by Rigo.
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${BASE}/c/${demo.id}/invoices?status=all`);
  await page.locator('a.row-link').first().click();
  await page.getByRole('article', { name: 'Invoice preview' }).waitFor();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(TMP, 'invoice.png') });
  toWebp(join(TMP, 'invoice.png'), `invoice-${theme}`);

  // Driver: a started fuel delivery on a phone.
  await api('POST', `/c/${demo.id}/demo/role`, { role: 'driver' });
  await page.setViewportSize({ width: 390, height: 844 });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce', storageState: await ctx.storageState() });
  const p = await phone.newPage();
  await p.goto(`${BASE}/c/${demo.id}/today`);
  await p.getByRole('heading', { name: 'My jobs' }).waitFor();
  await p.locator('a.driver-job', { hasText: 'Fuel delivery' }).first().click();
  await p.getByRole('button', { name: 'Start job' }).click();
  await p.getByText('Job started').waitFor();
  await p.getByLabel(/Delivered quantity/).fill('432.5');
  await p.getByText('Saved on this device').first().waitFor();
  await p.waitForTimeout(6500); // let the confirmation toast leave
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.screenshot({ path: join(TMP, 'driver.png') });
  toWebp(join(TMP, 'driver.png'), `driver-${theme}`);
  await phone.close();
  await ctx.close();
  console.log(`captured ${theme}`);
}
await browser.close();
rmSync(TMP, { recursive: true, force: true });
console.log(execSync(`ls -la ${OUT}`).toString());
