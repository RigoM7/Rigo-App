import '../lib/zod-messages.js';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { type AppEnv, loadUser, companyScope } from './context.js';
import { HttpError } from './errors.js';
import { accounts, cleanupAuth } from '../modules/accounts.js';
import { workspacesPublic, workspaceRoutes } from '../modules/workspaces.js';
import { teamRoutes, invitationPublic } from '../modules/team.js';
import { notifyRoutes } from '../modules/notify.js';
import { customerRoutes } from '../modules/customers.js';
import { workRoutes } from '../modules/work.js';
import { workerRoutes } from '../modules/worker.js';
import { billingRoutes } from '../modules/billing.js';
import { automationRoutes, runDueReminders } from '../modules/automation.js';
import { bookingPublic, bookingRoutes } from '../modules/booking.js';
import { libraryPublic, libraryRoutes } from '../modules/library.js';
import { demoPublic, demoRoutes } from '../modules/demo.js';
import { searchRoutes } from '../modules/search.js';
import { config } from '../config.js';

export function createApp() {
  const app = new Hono<AppEnv>().basePath('/api');

  app.use('*', secureHeaders({ crossOriginResourcePolicy: 'same-origin' }));
  app.use('*', async (c, next) => {
    c.header('cache-control', 'no-store');
    // CSRF defense: state-changing requests must carry a custom header, which cross-site forms cannot send.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('x-rigo') !== '1' && !c.req.path.startsWith('/api/cron')) {
      return c.json({ error: { code: 'csrf', message: 'Missing request header.' } }, 403);
    }
    await next();
  });
  app.use('*', loadUser);

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/auth', accounts);
  app.route('/', workspacesPublic);
  app.route('/', invitationPublic);
  app.route('/', bookingPublic);
  app.route('/', libraryPublic);
  app.route('/', demoPublic);

  const company = new Hono<AppEnv>();
  company.use('*', companyScope);
  for (const r of [workspaceRoutes, teamRoutes, notifyRoutes, customerRoutes, workRoutes, workerRoutes, billingRoutes, automationRoutes, bookingRoutes, libraryRoutes, demoRoutes, searchRoutes]) company.route('/', r);
  app.route('/c/:cid', company);

  // Scheduled maintenance (Vercel Cron or any external scheduler). Protected by CRON_SECRET when set.
  app.get('/cron/tick', async (c) => {
    if (config.cronSecret && c.req.header('authorization') !== `Bearer ${config.cronSecret}`) return c.json({ error: 'unauthorized' }, 401);
    await cleanupAuth();
    const reminders = await runDueReminders();
    return c.json({ ok: true, reminders });
  });

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      const retry = (err.details as any)?.retryAfter;
      if (err.status === 429 && retry) c.header('Retry-After', String(retry));
      return c.json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, err.status as any);
    }
    console.error(err);
    return c.json({ error: { code: 'server_error', message: 'Something went wrong on the server. Nothing was partially saved; try again.' } }, 500);
  });
  return app;
}
