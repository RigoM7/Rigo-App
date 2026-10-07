import '../lib/zod-messages.js';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { type AppEnv, loadUser, companyScope } from './context.js';
import { HttpError } from './errors.js';
import { accounts, cleanupAuth } from '../modules/accounts.js';
import { companiesPublic, companyRoutes } from '../modules/companies.js';
import { teamRoutes, invitationPublic } from '../modules/team.js';
import { inboxRoutes } from '../modules/inbox.js';
import { recordRoutes } from '../modules/records.js';
import { jobRoutes } from '../modules/jobs.js';
import { billingRoutes } from '../modules/billing.js';
import { workflowRoutes } from '../modules/workflows.js';
import { recurringRoutes, generateAll } from '../modules/recurring.js';
import { importRoutes } from '../modules/imports.js';
import { templateRoutes } from '../modules/templates.js';
import { assistantRoutes } from '../modules/assistant.js';
import { demoPublic, demoRoutes } from '../modules/demo.js';
import { overviewRoutes } from '../modules/overview.js';
import { invoiceViewPublic } from '../modules/invoice-view.js';
import { collectionRoutes, runCollections } from '../modules/collections.js';
import { latePublic, lateRoutes } from '../modules/late-records.js';
import { processAll, escalateApprovals } from '../automation/engine.js';
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
  app.route('/', companiesPublic);
  app.route('/', invitationPublic);
  app.route('/', demoPublic);
  app.route('/', invoiceViewPublic);
  app.route('/', latePublic);

  const company = new Hono<AppEnv>();
  company.use('*', companyScope);
  // In serverless deployments there is no background process, so mutating requests drain due automation before returning.
  company.use('*', async (c, next) => {
    await next();
    if (config.isServerless && c.req.method !== 'GET' && c.res.status < 400) await processAll(2500).catch((e) => console.error('[automation]', e));
  });
  for (const r of [companyRoutes, teamRoutes, inboxRoutes, recordRoutes, jobRoutes, billingRoutes, collectionRoutes, lateRoutes, workflowRoutes, recurringRoutes, importRoutes, templateRoutes, assistantRoutes, demoRoutes, overviewRoutes]) {
    company.route('/', r);
  }
  app.route('/c/:cid', company);

  // Scheduled maintenance (Vercel Cron or any external scheduler). Protected by CRON_SECRET when set.
  app.get('/cron/tick', async (c) => {
    if (config.cronSecret && c.req.header('authorization') !== `Bearer ${config.cronSecret}`) return c.json({ error: 'unauthorized' }, 401);
    const visits = await generateAll();
    const escalated = await escalateApprovals();
    await runCollections();
    await processAll(8000);
    await cleanupAuth();
    return c.json({ ok: true, visits, escalated });
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
