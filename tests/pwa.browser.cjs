// Milestone G groundwork: the installed app opens offline from its own files, never caches
// company data or sign-in, and the manifest meets store packaging basics. Uses the built public/
// folder (run `npm run build` first) on a throwaway local server.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..', 'public');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const api = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    api.push(url.search);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(url.searchParams.get('route') === 'config' ? { configured: false } : { secret: 'company data ' + Date.now() }));
  }
  const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  let browser;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://localhost:' + server.address().port;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
    for (const key of ['id', 'name', 'short_name', 'start_url', 'scope', 'display', 'description', 'theme_color', 'background_color']) assert.ok(manifest[key], 'manifest has ' + key);
    assert.ok(manifest.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable') && manifest.icons.some(i => i.sizes === '192x192'));
    assert.ok(!/__RIGO_BUILD__/.test(fs.readFileSync(path.join(root, 'sw.js'), 'utf8')), 'the service worker is stamped per build');
    assert.ok(!fs.existsSync(path.join(root, '.well-known/assetlinks.json')) || process.env.RIGO_ANDROID_PACKAGE, 'no app-link file without owner-provided details');

    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox'] });
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin);
    await page.getByText('Data stays in this browser').waitFor();
    // Automation skips automatic registration; register explicitly as an installed app would.
    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.evaluate(() => fetch('/api/rigo?route=workspaces').then(r => r.json()));
    const cached = await page.evaluate(async () => { const out = []; for (const key of await caches.keys()) for (const req of await (await caches.open(key)).keys()) out.push(new URL(req.url).pathname); return out; });
    assert.ok(cached.includes('/') && cached.includes('/rigo-access.js'), 'app shell cached');
    assert.ok(cached.every(p => !p.startsWith('/api/')), 'company data is never cached: ' + cached.join(', '));
    // Offline: the app still opens; company data requests fail instead of returning stale copies.
    await context.setOffline(true);
    await page.reload();
    await page.getByText('Data stays in this browser').waitFor();
    const apiOffline = await page.evaluate(() => fetch('/api/rigo?route=workspaces').then(() => 'answered', () => 'failed'));
    assert.equal(apiOffline, 'failed');
    // A shared (connected) company offline: a clear offline screen, no stale company data.
    await page.evaluate(() => localStorage.setItem('rigo-last-mode', 'connected'));
    await page.reload();
    await page.getByRole('heading', { name: "You're offline" }).waitFor();
    await context.setOffline(false);
    assert.deepEqual(errors, []);
    await context.close();
    console.log('Installable app checks passed: manifest, per-build service worker, offline launch, no company data cached, no app-link file without owner details.');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
