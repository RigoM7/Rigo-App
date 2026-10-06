import { Hono } from 'hono';
import { z } from 'zod';
import { getDb, type Q } from '../db/index.js';
import { type AppEnv, type CompanyCtx, requireUser, need, audit, can } from '../http/context.js';
import { body } from '../lib/util.js';
import { badRequest, forbidden } from '../http/errors.js';
import { capabilities, storeFile, sniffImage, readStoredFile } from '../adapters/index.js';
import { seedRoles, seedStarterServices, seedDefaultWorkflows, applyStructure, exportStructure } from './structure.js';
import { CURRENCIES } from '../../shared/billing.js';
import { customFieldsSchema, type ServiceCategory } from '../../shared/services.js';
import { accentVariants, ACCENT_PRESETS } from '../../shared/branding.js';
import { guideProgress } from './demo-guide.js';
import { attentionCounts } from './inbox.js';

export const companiesPublic = new Hono<AppEnv>();
export const companyRoutes = new Hono<AppEnv>();

const categories = z.array(z.enum(['fuel', 'portable_toilet', 'septic', 'other'])).max(4);

export const createCompanySchema = z.object({
  name: z.string().trim().min(1, 'Enter the company name').max(80),
  timezone: z.string().max(60).refine(validTz, 'Choose a valid time zone').default('America/New_York'),
  currency: z.enum(CURRENCIES).default('USD'),
  categories: categories.default([]),
  start: z.enum(['starter', 'blank']).default('starter'),
});

export function validTz(tz: string) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

export async function createCompany(q: Q, userId: string, input: z.infer<typeof createCompanySchema>, opts: { structureFrom?: unknown } = {}) {
  const { rows } = await q.query<{ id: string }>(
    `insert into rigo.companies (name, kind, timezone, currency, service_categories, created_by, settings)
     values ($1,'real',$2,$3,$4,$5,$6) returning id`,
    [input.name, input.timezone, input.currency, input.categories, userId,
      JSON.stringify({ setup: { basics: true, start: opts.structureFrom ? 'demo' : input.start, startedAt: new Date().toISOString() } })]);
  const id = rows[0].id;
  await seedRoles(q, id);
  await q.query(`insert into rigo.memberships (company_id, user_id, role_key) values ($1,$2,'owner')`, [id, userId]);
  if (opts.structureFrom) await applyStructure(q, id, userId, opts.structureFrom);
  else if (input.start === 'starter') {
    await seedStarterServices(q, id, input.categories as ServiceCategory[]);
    await seedDefaultWorkflows(q, id, userId);
  }
  await audit(q, { company: { id }, user: { id: userId } }, 'company.created', { name: input.name, start: input.start });
  return id;
}

companiesPublic.post('/companies', async (c) => {
  const user = requireUser(c);
  const input = await body(c, createCompanySchema);
  const db = await getDb();
  const owned = await db.query<{ n: number }>(`select count(*)::int n from rigo.companies where created_by = $1 and kind = 'real' and created_at > now() - interval '1 day'`, [user.id]);
  if (owned.rows[0].n >= 10) throw badRequest('You have created many companies today. Try again tomorrow.');
  const id = await db.tx((q) => createCompany(q, user.id, input));
  return c.json({ id });
});

export async function setupChecklist(q: Q, companyId: string) {
  const { rows } = await q.query<any>(`select settings, branding,
      (select count(*)::int from rigo.services s where s.company_id = c.id and s.active) as services,
      (select count(*)::int from rigo.services s where s.company_id = c.id and s.active and exists (
          select 1 from jsonb_array_elements(s.pricing) p where coalesce(p->'rateE4', p->'rateMinor', 'null'::jsonb) = 'null'::jsonb)) as unpriced,
      (select count(*)::int from rigo.resources r where r.company_id = c.id) as resources,
      (select count(*)::int from rigo.memberships m where m.company_id = c.id and m.status = 'active') as members,
      (select count(*)::int from rigo.invitations i where i.company_id = c.id and i.status = 'pending') as invites,
      (select count(*)::int from rigo.jobs j where j.company_id = c.id) as jobs,
      (select count(*)::int from rigo.customers x where x.company_id = c.id) as customers,
      (select count(*)::int from rigo.workflows w where w.company_id = c.id and w.active_version_id is not null) as active_workflows
    from rigo.companies c where c.id = $1`, [companyId]);
  const r = rows[0];
  const s = r.settings?.setup ?? {};
  const items = [
    { key: 'basics', label: 'Company basics', done: !!s.basics, required: true, link: 'settings' },
    { key: 'services', label: 'Choose the services you offer', done: r.services > 0, required: true, link: 'setup?step=services' },
    { key: 'automation', label: 'Choose how much Rigo automates', done: !!s.automation, required: true, link: 'setup?step=automation' },
    { key: 'pricing', label: 'Set service rates', done: r.services > 0 && r.unpriced === 0, required: false, link: 'services', note: r.unpriced ? `${r.unpriced} service(s) have prices not set yet. Invoices for them will be held.` : '' },
    { key: 'resources', label: 'Add trucks or equipment', done: r.resources > 0 || !!s.resourcesSkipped, required: false, link: 'setup?step=resources' },
    { key: 'team', label: 'Invite your team', done: r.members > 1 || r.invites > 0 || !!s.teamSkipped, required: false, link: 'setup?step=team' },
    { key: 'customers', label: 'Add or import customers', done: r.customers > 0, required: false, link: 'customers' },
    { key: 'workflows', label: 'Activate a workflow', done: r.active_workflows > 0, required: false, link: 'workflows' },
    { key: 'testJob', label: 'Run a test job', done: r.jobs > 0 || !!s.testJobSkipped, required: false, link: 'setup?step=test' },
    { key: 'branding', label: 'Add your logo and colors', done: !!r.branding?.logoFileId || !!r.branding?.accent, required: false, link: 'settings?tab=branding' },
  ];
  const ready = items.filter((i) => i.required).every((i) => i.done);
  return { items, ready, done: items.filter((i) => i.done).length, total: items.length, step: s.step ?? 'basics', dismissed: !!s.dismissed };
}

companyRoutes.get('/', async (c) => {
  const cc = c.get('cc');
  const caps = capabilities(cc.company);
  const db = cc.db;
  const counts = await attentionCounts(cc);
  const members = can(cc, 'members.view') || can(cc, 'jobs.assign')
    ? (await db.query(`select m.user_id as id, coalesce(m.display_name, u.name) as name, m.role_key from rigo.memberships m join rigo.users u on u.id = m.user_id where m.company_id = $1 and m.status = 'active' order by name`, [cc.company.id])).rows
    : [];
  const roles = (await db.query(`select key, name from rigo.roles where company_id = $1 order by is_owner desc, name`, [cc.company.id])).rows;
  const { settings, ...company } = cc.company;
  return c.json({
    company: { ...company, customFields: customFieldsSchema.parse(settings?.customFields ?? {}), accent: accentVariants(cc.company.branding?.accent),
      invoiceDueDays: settings?.invoiceDueDays ?? 30, paymentInstructions: settings?.paymentInstructions ?? '' },
    role: { key: cc.roleKey, name: cc.roleName, isOwner: cc.isOwner, simulated: cc.simulatedRole },
    permissions: [...cc.perms],
    capabilities: caps,
    attention: counts,
    setup: can(cc, 'company.settings') ? await setupChecklist(db, cc.company.id) : null,
    demo: cc.isDemo ? { guide: settings?.demo?.guide ?? { step: 0, dismissed: false }, simRole: settings?.demo?.simRole ?? 'owner', progress: await guideProgress(db, cc.company.id, settings) } : null,
    members,
    roles,
    me: { id: cc.user.id, actingUserId: cc.actingUserId },
  });
});

companyRoutes.patch('/settings', async (c) => {
  const cc = c.get('cc');
  need(cc, 'company.settings');
  const input = await body(c, z.object({
    name: z.string().trim().min(1, 'Enter the company name').max(80).optional(),
    timezone: z.string().max(60).refine(validTz, 'Choose a valid time zone').optional(),
    currency: z.enum(CURRENCIES).optional(),
    phone: z.string().max(40).optional(), email: z.string().max(254).optional(), address: z.string().max(300).optional(),
    serviceCategories: categories.optional(),
    customFields: customFieldsSchema.optional(),
    invoiceDueDays: z.number().int().min(0).max(180).optional(),
    paymentInstructions: z.string().trim().max(500).optional(),
  }));
  await cc.db.tx(async (q) => {
    const sets: string[] = []; const vals: unknown[] = [cc.company.id];
    const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (input.name !== undefined) add('name', input.name);
    if (input.timezone !== undefined) add('timezone', input.timezone);
    if (input.currency !== undefined) add('currency', input.currency);
    if (input.phone !== undefined) add('phone', input.phone);
    if (input.email !== undefined) add('email', input.email);
    if (input.address !== undefined) add('address', input.address);
    if (input.serviceCategories !== undefined) add('service_categories', input.serviceCategories);
    if (sets.length) await q.query(`update rigo.companies set ${sets.join(', ')} where id = $1`, vals);
    if (input.customFields) await q.query(`update rigo.companies set settings = jsonb_set(settings, '{customFields}', $2::jsonb), config_version = config_version + 1 where id = $1`, [cc.company.id, JSON.stringify(input.customFields)]);
    if (input.invoiceDueDays !== undefined) await q.query(`update rigo.companies set settings = jsonb_set(settings, '{invoiceDueDays}', $2::jsonb) where id = $1`, [cc.company.id, JSON.stringify(input.invoiceDueDays)]);
    if (input.paymentInstructions !== undefined) await q.query(`update rigo.companies set settings = jsonb_set(settings, '{paymentInstructions}', to_jsonb($2::text)) where id = $1`, [cc.company.id, input.paymentInstructions]);
    await audit(q, cc, 'company.settings_updated', Object.keys(input));
  });
  return c.json({ ok: true });
});

companyRoutes.post('/setup', async (c) => {
  const cc = c.get('cc');
  need(cc, 'company.settings');
  const input = await body(c, z.object({
    step: z.string().max(30).optional(),
    mark: z.enum(['automation', 'resourcesSkipped', 'teamSkipped', 'testJobSkipped', 'dismissed', 'completed']).optional(),
    undismiss: z.boolean().optional(),
  }));
  const patch: Record<string, unknown> = {};
  if (input.step) patch.step = input.step;
  if (input.mark) patch[input.mark] = true;
  if (input.mark === 'completed') patch.completedAt = new Date().toISOString();
  if (input.undismiss) patch.dismissed = false;
  await cc.db.query(`update rigo.companies set settings = jsonb_set(settings, '{setup}', coalesce(settings->'setup','{}'::jsonb) || $2::jsonb) where id = $1`, [cc.company.id, JSON.stringify(patch)]);
  return c.json(await setupChecklist(cc.db, cc.company.id));
});

companyRoutes.patch('/branding', async (c) => {
  const cc = c.get('cc');
  need(cc, 'company.settings');
  const input = await body(c, z.object({ accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #B91C1C').nullable().optional(), removeLogo: z.boolean().optional() }));
  const branding = { ...(cc.company.branding ?? {}) };
  if (input.accent !== undefined) {
    if (input.accent && !ACCENT_PRESETS.some((p) => p.hex.toLowerCase() === input.accent!.toLowerCase()) && !accentVariants(input.accent).usable) {
      throw badRequest('That color cannot be made readable in both themes. Choose another.', { fields: { accent: 'Not enough contrast in both themes' } });
    }
    branding.accent = input.accent;
  }
  if (input.removeLogo) delete branding.logoFileId;
  await cc.db.query(`update rigo.companies set branding = $2 where id = $1`, [cc.company.id, JSON.stringify(branding)]);
  return c.json({ ok: true, accent: accentVariants(branding.accent) });
});

companyRoutes.post('/branding/logo', async (c) => {
  const cc = c.get('cc');
  need(cc, 'company.settings');
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('Choose an image file.');
  if (file.size > 512 * 1024) throw badRequest('The logo must be 512 KB or smaller.');
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffImage(buf);
  if (!mime) throw badRequest('Use a PNG, JPEG or WebP image. SVG and other formats are not accepted.');
  const id = crypto.randomUUID();
  const stored = cc.isDemo ? { storage: 'database' as const, storage_key: null, data: buf } : storeFile(id, buf);
  await cc.db.tx(async (q) => {
    await q.query(`insert into rigo.files (id, company_id, subject_type, name, mime, size, storage, storage_key, data, created_by) values ($1,$2,'company',$3,$4,$5,$6,$7,$8,$9)`,
      [id, cc.company.id, file.name.slice(0, 120), mime, buf.length, stored.storage, stored.storage_key, stored.data, cc.user.id]);
    await q.query(`update rigo.companies set branding = branding || jsonb_build_object('logoFileId', $2::text) where id = $1`, [cc.company.id, id]);
  });
  return c.json({ ok: true, fileId: id });
});

/** Logo is visible to any member (it appears in the shell). */
companyRoutes.get('/branding/logo', async (c) => {
  const cc = c.get('cc');
  const id = cc.company.branding?.logoFileId;
  if (!id) return c.body(null, 404);
  const { rows } = await cc.db.query(`select * from rigo.files where id = $1 and company_id = $2`, [id, cc.company.id]);
  const data = rows[0] && readStoredFile(rows[0]);
  if (!data) return c.body(null, 404);
  return c.body(new Uint8Array(data), 200, { 'content-type': rows[0].mime, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' });
});

// ---------------------------------------------------------------- automation controls
companyRoutes.patch('/automation', async (c) => {
  const cc = c.get('cc');
  const input = await body(c, z.object({
    mode: z.enum(['manual', 'assisted', 'automatic']).optional(),
    paused: z.boolean().optional(),
    queued: z.enum(['hold', 'cancel']).optional(),
  }));
  if (input.mode) need(cc, 'company.settings');
  if (input.paused !== undefined) need(cc, 'automation.control');
  const result = await cc.db.tx(async (q) => {
    let cancelled = 0;
    if (input.mode) {
      await q.query(`update rigo.companies set automation_mode = $2, settings = jsonb_set(settings, '{setup,automation}', 'true'::jsonb) where id = $1`, [cc.company.id, input.mode]);
      await audit(q, cc, 'automation.mode_changed', { mode: input.mode });
    }
    if (input.paused === true) {
      await q.query(`update rigo.companies set paused = true, paused_at = now(), paused_by = $2 where id = $1`, [cc.company.id, cc.user.id]);
      if (input.queued === 'cancel') {
        const r = await q.query(`update rigo.actions set status = 'cancelled', explanation = 'Cancelled when automation was paused.', updated_at = now()
                                  where company_id = $1 and status in ('queued','proposed','suggested') returning id`, [cc.company.id]);
        cancelled = r.rows.length;
      }
      await audit(q, cc, 'automation.paused', { queued: input.queued ?? 'hold', cancelled });
    }
    if (input.paused === false) {
      await q.query(`update rigo.companies set paused = false, paused_at = null, paused_by = null where id = $1`, [cc.company.id]);
      await audit(q, cc, 'automation.resumed', {});
    }
    return { cancelled };
  });
  return c.json({ ok: true, ...result });
});

companyRoutes.get('/structure', async (c) => {
  const cc = c.get('cc');
  need(cc, 'templates.manage');
  return c.json(await exportStructure(cc.db, cc.company.id));
});

export function assertNotDemo(cc: CompanyCtx, what: string) {
  if (cc.isDemo) throw forbidden(`${what} is not available in the demo workspace.`);
}
