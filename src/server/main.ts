import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './http/app.js';
import { config } from './config.js';
import { getDb } from './db/index.js';
import { processAll, escalateApprovals } from './automation/engine.js';
import { generateAll } from './modules/recurring.js';
import { cleanupAuth } from './modules/accounts.js';

// Local server: API + built web app + an in-process worker. The worker only runs while this
// process runs; due work is persisted and picked up again after a restart.

const root = new Hono();
root.route('/', createApp());
const dist = resolve(config.rootDir, 'dist');
if (existsSync(dist)) {
  root.use('/*', serveStatic({ root: 'dist' }));
  const index = readFileSync(resolve(dist, 'index.html'), 'utf8');
  root.get('*', (c) => (c.req.path.startsWith('/api/') ? c.notFound() : c.html(index)));
}

await getDb();
serve({ fetch: root.fetch, port: config.port }, (info) => {
  console.log(`Rigo API on http://localhost:${info.port}${existsSync(dist) ? ' (serving built web app)' : ' (run "npm run dev:web" for the web app)'}`);
});

async function tick() {
  try {
    await processAll(10_000);
    await escalateApprovals();
  } catch (e) { console.error('[worker]', e); }
}
async function hourly() {
  try { await generateAll(); } catch (e) { console.error('[recurring]', e); }
  try { await cleanupAuth(); } catch (e) { console.error('[auth cleanup]', e); }
}
// Restart recovery: catch up on anything that became due while the process was stopped.
await hourly();
await tick();
setInterval(tick, 15_000);
setInterval(hourly, 3600_000);
