import { Hono } from 'hono';
import { z } from 'zod';
import { getDb, type Q } from '../db/index.js';
import { type AppEnv, type CompanyCtx, requireUser, need, audit, can } from '../http/context.js';
import { body } from '../lib/util.js';
import { badRequest, conflict, forbidden } from '../http/errors.js';
import { capabilities } from '../adapters/index.js';
import { CURRENCIES } from '../../shared/money.js';
import {
  structureSchema, structureProblems, vocabularySchema, wordsOf, stageDefSchema, stageProblems, fieldListSchema,
  RECORD_KINDS, type Structure, type FieldDef, type RecordKind, type StageDef, count,
} from '../../shared/workspace.js';
import { TEMPLATES, templateByKey, structureOf, matchTemplates, GENERAL } from '../../shared/templates.js';
import { unreadCount } from './notify.js';
import { libraryStructure } from './library.js';

export const workspacesPublic = new Hono<AppEnv>();
export const workspaceRoutes = new Hono<AppEnv>();

export function validTz(tz: string) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

const nameSchema = z.string().trim().min(1, 'Name your workspace').max(80, 'Use 80 characters or fewer.');
const descriptionSchema = z.string().trim().max(300, 'Use 300 characters or fewer.');

export const createWorkspaceSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.default(''),
  templateKey: z.string().max(40).default('general'),
  /** The template's structure as adjusted on the review screen; missing means the template as it is. */
  structure: structureSchema.optional(),
  timezone: z.string().max(60).refine(validTz, 'Choose a valid time zone').default('America/New_York'),
  currency: z.enum(CURRENCIES).default('USD'),
  /** The person saw that they already have a workspace with this name and wants another (R3-m1). */
  allowDuplicateName: z.boolean().default(false),
});

/** Validates a structure beyond its shape; throws a 400 listing the problems in plain words. */
export function checkStructure(s: Structure) {
  const problems = structureProblems(s);
  if (problems.length) throw badRequest(problems[0], { problems });
}

/** Writes a structure into an empty workspace: words, roles, record types and fields, stages, price list names. */
export async function applyStructure(q: Q, companyId: string, s: Structure) {
  await q.query(`update rigo.companies set vocabulary = $2 where id = $1`, [companyId, JSON.stringify(s.words)]);
  await q.query(`insert into rigo.roles (company_id, key, name, description, permissions, is_owner, app, position) values ($1,'owner','Owner','Can do everything, including roles and billing.','{}',true,'office',0)
                 on conflict (company_id, key) do nothing`, [companyId]);
  let pos = 1;
  for (const r of s.roles) {
    await q.query(`insert into rigo.roles (company_id, key, name, description, permissions, app, position) values ($1,$2,$3,$4,$5,$6,$7)
                   on conflict (company_id, key) do update set name = excluded.name, description = excluded.description, permissions = excluded.permissions, app = excluded.app, position = excluded.position`,
      [companyId, r.key, r.name, r.description ?? '', r.permissions, r.app, pos++]);
  }
  for (const kind of RECORD_KINDS) {
    await q.query(`insert into rigo.record_types (company_id, kind, enabled, fields) values ($1,$2,$3,$4)
                   on conflict (company_id, kind) do update set enabled = excluded.enabled, fields = excluded.fields, updated_at = now()`,
      [companyId, kind, kind === 'equipment' ? s.equipment : true, JSON.stringify(s.fields[kind])]);
  }
  await writeStages(q, companyId, s.stages);
  let cpos = 0;
  for (const item of s.catalog) {
    // Names only: a template never carries prices, so every rate starts as "not set".
    await q.query(`insert into rigo.catalog_items (company_id, name, unit, rate_e4, taxable, position) values ($1,$2,$3,null,$4,$5)`, [companyId, item.name, item.unit, item.taxable, cpos++]);
  }
}

async function writeStages(q: Q, companyId: string, stages: StageDef[]) {
  let pos = 0;
  for (const st of stages) {
    await q.query(`insert into rigo.stages (company_id, key, name, meaning, position, requires, next_keys) values ($1,$2,$3,$4,$5,$6,$7)
                   on conflict (company_id, key) do update set name = excluded.name, meaning = excluded.meaning, position = excluded.position, requires = excluded.requires, next_keys = excluded.next_keys`,
      [companyId, st.key, st.name, st.meaning, pos++, st.requires ?? [], st.next ?? null]);
  }
}

export async function createWorkspace(q: Q, userId: string, input: z.infer<typeof createWorkspaceSchema>, opts: { kind?: 'real' | 'demo' } = {}) {
  const template = templateByKey(input.templateKey) ?? GENERAL;
  const structure = input.structure ?? structureOf(template);
  const templateKey = input.templateKey.startsWith('lib:') ? input.templateKey : template.key;
  checkStructure(structure);
  const kind = opts.kind ?? 'real';
  const { rows } = await q.query<{ id: string }>(
    `insert into rigo.companies (name, kind, demo_user_id, timezone, currency, created_by, template_key, description, settings)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [input.name, kind, kind === 'demo' ? userId : null, input.timezone, input.currency, userId, templateKey, input.description,
      JSON.stringify({ setup: { startedAt: new Date().toISOString() } })]);
  const id = rows[0].id;
  await applyStructure(q, id, structure);
  await q.query(`insert into rigo.memberships (company_id, user_id, role_key) values ($1,$2,'owner')`, [id, userId]);
  await audit(q, { company: { id }, user: { id: userId } }, 'workspace.created', { name: input.name, template: templateKey });
  return id;
}

// ---------------------------------------------------------------- public: templates and word matching

workspacesPublic.get('/templates', (c) => c.json({
  templates: TEMPLATES.map((t) => ({ key: t.key, name: t.name, blurb: t.blurb, examples: t.examples, structure: t.structure })),
}));

workspacesPublic.post('/templates/match', async (c) => {
  const input = await body(c, z.object({ description: z.string().max(500) }));
  return c.json({ matches: matchTemplates(input.description) });
});

workspacesPublic.post('/companies', async (c) => {
  const user = requireUser(c);
  const input = await body(c, createWorkspaceSchema);
  const db = await getDb();
  const owned = await db.query<{ n: number }>(`select count(*)::int n from rigo.companies where created_by = $1 and kind = 'real' and created_at > now() - interval '1 day'`, [user.id]);
  if (owned.rows[0].n >= 10) throw badRequest('You have created many workspaces today. Try again tomorrow.');
  // Two workspaces with the same name are hard to tell apart (R3-m1): ask first.
  if (!input.allowDuplicateName) {
    const same = (await db.query<{ created_at: string }>(`select c.created_at from rigo.companies c join rigo.memberships m on m.company_id = c.id and m.user_id = $1 and m.status = 'active'
        where c.kind = 'real' and lower(c.name) = lower($2) order by c.created_at limit 1`, [user.id, input.name])).rows[0];
    if (same) throw conflict(`You already have a workspace called ${input.name}. Create another one anyway?`, { needsConfirm: 'duplicateName', createdAt: same.created_at, fields: { name: 'You already have a workspace with this name' } });
  }
  // A template from the shared library ("lib:<id>"): its structure, unless the review screen adjusted it.
  if (input.templateKey.startsWith('lib:') && !input.structure) input.structure = await libraryStructure(input.templateKey.slice(4));
  const id = await db.tx((q) => createWorkspace(q, user.id, input));
  return c.json({ id });
});

// ---------------------------------------------------------------- the workspace model, read

export async function loadFields(q: Q, companyId: string) {
  const { rows } = await q.query<{ kind: RecordKind; enabled: boolean; fields: FieldDef[] }>(`select kind, enabled, fields from rigo.record_types where company_id = $1`, [companyId]);
  const fields = { work: [] as FieldDef[], customer: [] as FieldDef[], equipment: [] as FieldDef[] };
  let equipment = false;
  for (const r of rows) { fields[r.kind] = r.fields ?? []; if (r.kind === 'equipment') equipment = r.enabled; }
  return { fields, equipment };
}

export interface StageRow { id: string; key: string; name: string; meaning: StageDef['meaning']; position: number; requires: string[]; next: string[] | null }

export async function loadStages(q: Q, companyId: string): Promise<StageRow[]> {
  const { rows } = await q.query<StageRow>(`select id, key, name, meaning, position, requires, next_keys as next from rigo.stages where company_id = $1 order by position, name`, [companyId]);
  return rows;
}

export async function setupChecklist(q: Q, cc: CompanyCtx) {
  const words = wordsOf(cc.company.vocabulary);
  const { rows } = await q.query<any>(`select
      (select count(*)::int from rigo.memberships m where m.company_id = $1 and m.status = 'active') as members,
      (select count(*)::int from rigo.invitations i where i.company_id = $1 and i.status = 'pending') as invites,
      (select count(*)::int from rigo.clients x where x.company_id = $1) as customers,
      (select count(*)::int from rigo.work_items w where w.company_id = $1) as work,
      (select count(*)::int from rigo.catalog_items k where k.company_id = $1 and k.active) as catalog,
      (select count(*)::int from rigo.catalog_items k where k.company_id = $1 and k.active and k.rate_e4 is null) as unpriced`, [cc.company.id]);
  const r = rows[0];
  const s = cc.company.settings?.setup ?? {};
  const items = [
    { key: 'team', label: `Invite your ${words.person.many === 'Team' ? 'team' : words.person.many.toLowerCase()}`, done: r.members > 1 || r.invites > 0 || !!s.teamSkipped, link: 'settings/people' },
    { key: 'customers', label: `Add your first ${words.customer.one.toLowerCase()}`, done: r.customers > 0, link: 'customers/new' },
    { key: 'prices', label: 'Set your prices', done: r.catalog > 0 && r.unpriced === 0, link: 'money/prices',
      note: r.unpriced ? `${count(r.unpriced, { one: 'item has', many: 'items have' })} no price yet. Invoices that use ${r.unpriced === 1 ? 'it' : 'them'} are held until it is set.` : '' },
    { key: 'work', label: `Add your first ${words.work.one.toLowerCase()}`, done: r.work > 0, link: 'work/new' },
    { key: 'automation', label: 'Choose how much Rigo does on its own', done: !!s.automationChosen, link: 'settings/automation' },
  ];
  return { items, done: items.filter((i) => i.done).length, total: items.length, dismissed: !!s.dismissed };
}

workspaceRoutes.get('/', async (c) => {
  const cc = c.get('cc');
  const db = cc.db;
  const { fields, equipment } = await loadFields(db, cc.company.id);
  const stages = await loadStages(db, cc.company.id);
  const members = can(cc, 'members.view') || can(cc, 'work.assign') || can(cc, 'work.view_all')
    ? (await db.query(`select m.user_id as id, coalesce(m.display_name, u.name) as name, m.role_key, case when r.is_owner then 'office' else r.app end as app
        from rigo.memberships m join rigo.users u on u.id = m.user_id join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
        where m.company_id = $1 and m.status = 'active' order by name`, [cc.company.id])).rows
    : [];
  const roles = (await db.query(`select key, name, case when is_owner then 'office' else app end as app, is_owner from rigo.roles where company_id = $1 order by is_owner desc, position, name`, [cc.company.id])).rows;
  const co = cc.company;
  return c.json({
    workspace: {
      id: co.id, name: co.name, kind: co.kind, timezone: co.timezone, currency: co.currency, description: co.description, templateKey: co.template_key,
      archivedAt: co.archived_at, taxRateBp: can(cc, 'money.view') ? (co as any).tax_rate_bp ?? null : undefined,
      automation: { mode: co.automation_mode, paused: co.paused, pausedAt: co.paused_at },
    },
    words: wordsOf(co.vocabulary),
    role: { key: cc.roleKey, name: cc.roleName, isOwner: cc.isOwner, app: cc.roleApp, simulated: cc.simulatedRole },
    permissions: [...cc.perms],
    stages,
    fields: cc.roleApp === 'worker' ? { ...fields, work: fields.work.filter((f) => f.forWorkers) } : fields,
    equipment,
    capabilities: capabilities(co),
    setup: can(cc, 'workspace.settings') ? await setupChecklist(db, cc) : null,
    members,
    roles,
    unread: await unreadCount(db, co.id, cc.user.id),
    demo: cc.isDemo ? { sample: !!co.settings?.demo?.sample, view: cc.simulatedRole ?? 'owner' } : null,
    me: { id: cc.user.id, actingUserId: cc.actingUserId },
  });
});

// ---------------------------------------------------------------- the workspace model, change

workspaceRoutes.patch('/settings', async (c) => {
  const cc = c.get('cc');
  need(cc, 'workspace.settings');
  const input = await body(c, z.object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    timezone: z.string().max(60).refine(validTz, 'Choose a valid time zone').optional(),
    currency: z.enum(CURRENCIES).optional(),
    phone: z.string().trim().max(40).optional(), email: z.string().trim().max(254).optional(), address: z.string().trim().max(300).optional(),
    /** Tax on taxable lines, in basis points (8.25% = 825); null: not set, so taxable work is held. */
    taxRateBp: z.number().int().min(0).max(5000).nullable().optional(),
  }));
  if (input.taxRateBp !== undefined) need(cc, 'catalog.manage');
  await cc.db.tx(async (q) => {
    const sets: string[] = []; const vals: unknown[] = [cc.company.id];
    const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (input.name !== undefined) add('name', input.name);
    if (input.description !== undefined) add('description', input.description);
    if (input.timezone !== undefined) add('timezone', input.timezone);
    if (input.currency !== undefined) add('currency', input.currency);
    if (input.phone !== undefined) add('phone', input.phone);
    if (input.email !== undefined) add('email', input.email);
    if (input.address !== undefined) add('address', input.address);
    if (input.taxRateBp !== undefined) add('tax_rate_bp', input.taxRateBp);
    if (sets.length) await q.query(`update rigo.companies set ${sets.join(', ')} where id = $1`, vals);
    await audit(q, cc, 'workspace.settings_updated', input);
  });
  return c.json({ ok: true });
});

workspaceRoutes.put('/words', async (c) => {
  const cc = c.get('cc');
  need(cc, 'workspace.settings');
  const input = await body(c, z.object({ words: vocabularySchema }));
  await cc.db.tx(async (q) => {
    await q.query(`update rigo.companies set vocabulary = $2, config_version = config_version + 1 where id = $1`, [cc.company.id, JSON.stringify(input.words)]);
    await audit(q, cc, 'words.updated', input.words);
  });
  return c.json({ ok: true, words: input.words });
});

workspaceRoutes.get('/stages', async (c) => {
  const cc = c.get('cc');
  const stages = await loadStages(cc.db, cc.company.id);
  const counts = (await cc.db.query<{ stage_id: string; n: number }>(`select stage_id, count(*)::int n from rigo.work_items where company_id = $1 group by stage_id`, [cc.company.id])).rows;
  return c.json({ stages: stages.map((s) => ({ ...s, inUse: counts.find((x) => x.stage_id === s.id)?.n ?? 0 })) });
});

/**
 * Saves the whole stage list in its new order. Stages are matched by key; a stage that still holds
 * work can't be removed (move the work first), so no record is ever left without a stage.
 */
workspaceRoutes.put('/stages', async (c) => {
  const cc = c.get('cc');
  need(cc, 'workspace.settings');
  const input = await body(c, z.object({ stages: z.array(stageDefSchema).max(15, 'Use 15 stages or fewer.') }));
  await cc.db.tx(async (q) => {
    const { fields } = await loadFields(q, cc.company.id);
    const problems = stageProblems(input.stages, fields.work);
    if (problems.length) throw badRequest(problems[0], { problems });
    const current = await loadStages(q, cc.company.id);
    const words = wordsOf(cc.company.vocabulary);
    for (const old of current.filter((s) => !input.stages.some((n) => n.key === s.key))) {
      const n = (await q.query<{ n: number }>(`select count(*)::int n from rigo.work_items where company_id = $1 and stage_id = $2`, [cc.company.id, old.id])).rows[0].n;
      if (n) throw conflict(`${old.name} still has ${count(n, words.work)}. Move ${n === 1 ? 'it' : 'them'} to another stage before removing it.`, { stage: old.key, inUse: n });
      await q.query(`delete from rigo.stages where id = $1`, [old.id]);
    }
    await writeStages(q, cc.company.id, input.stages);
    await q.query(`update rigo.companies set config_version = config_version + 1 where id = $1`, [cc.company.id]);
    await audit(q, cc, 'stages.updated', { stages: input.stages.map((s) => `${s.name} (${s.meaning})`) });
  });
  return c.json({ stages: await loadStages(cc.db, cc.company.id) });
});

workspaceRoutes.put('/fields/:kind', async (c) => {
  const cc = c.get('cc');
  need(cc, 'workspace.settings');
  const kind = c.req.param('kind') as RecordKind;
  if (!RECORD_KINDS.includes(kind)) throw badRequest('Choose work, customer or equipment.');
  const input = await body(c, z.object({ fields: fieldListSchema, enabled: z.boolean().optional() }));
  await cc.db.tx(async (q) => {
    if (kind === 'work') {
      const stages = await loadStages(q, cc.company.id);
      const used = stages.flatMap((s) => s.requires.filter((k) => !input.fields.some((f) => f.key === k)).map(() => s.name));
      if (used.length) throw conflict(`${used[0]} needs a field you removed. Change that stage first.`);
    }
    await q.query(`insert into rigo.record_types (company_id, kind, enabled, fields) values ($1,$2,$3,$4)
                   on conflict (company_id, kind) do update set fields = excluded.fields, enabled = coalesce($5, rigo.record_types.enabled), updated_at = now()`,
      [cc.company.id, kind, input.enabled ?? true, JSON.stringify(input.fields), kind === 'equipment' ? input.enabled ?? null : null]);
    await q.query(`update rigo.companies set config_version = config_version + 1 where id = $1`, [cc.company.id]);
    await audit(q, cc, 'fields.updated', { kind, fields: input.fields.map((f) => f.label), enabled: input.enabled });
  });
  return c.json({ ok: true });
});

workspaceRoutes.post('/setup', async (c) => {
  const cc = c.get('cc');
  need(cc, 'workspace.settings');
  const input = await body(c, z.object({ mark: z.enum(['teamSkipped', 'automationChosen', 'dismissed']), value: z.boolean().default(true) }));
  await cc.db.query(`update rigo.companies set settings = jsonb_set(settings, '{setup}', coalesce(settings->'setup','{}'::jsonb) || jsonb_build_object($2::text, $3::boolean)) where id = $1`,
    [cc.company.id, input.mark, input.value]);
  const fresh = (await cc.db.query(`select settings from rigo.companies where id = $1`, [cc.company.id])).rows[0];
  return c.json(await setupChecklist(cc.db, { ...cc, company: { ...cc.company, settings: fresh.settings } }));
});

/** The workspace's structure as a template would carry it (no prices, people or records). */
export async function exportStructure(q: Q, cc: CompanyCtx): Promise<Structure> {
  const { fields, equipment } = await loadFields(q, cc.company.id);
  const stages = await loadStages(q, cc.company.id);
  const roles = (await q.query<any>(`select key, name, description, app, permissions from rigo.roles where company_id = $1 and not is_owner order by position, name`, [cc.company.id])).rows;
  const catalog = (await q.query<any>(`select name, unit, taxable from rigo.catalog_items where company_id = $1 and active order by position, name`, [cc.company.id])).rows;
  return {
    words: wordsOf(cc.company.vocabulary), roles, equipment, fields, catalog,
    stages: stages.map((s) => ({ key: s.key, name: s.name, meaning: s.meaning, ...(s.requires.length ? { requires: s.requires } : {}), ...(s.next ? { next: s.next } : {}) })),
  };
}

// ---------------------------------------------------------------- archive and delete (R3-m1)

/** Owners type the workspace's name to confirm; a slip of the mouse never archives or deletes it. */
function confirmName(cc: CompanyCtx, typed: string) {
  if (!cc.isOwner) throw forbidden('Only owners can archive or delete the workspace.');
  if (cc.isDemo) throw badRequest('Demos are cleared from the demo page instead.');
  if (typed.trim().toLowerCase() !== cc.company.name.trim().toLowerCase()) throw badRequest(`Type the workspace name, ${cc.company.name}, to confirm.`, { fields: { confirmName: 'Type the workspace name exactly' } });
}

workspaceRoutes.post('/archive', async (c) => {
  const cc = c.get('cc');
  const input = await body(c, z.object({ confirmName: z.string().max(120) }));
  confirmName(cc, input.confirmName);
  await cc.db.tx(async (q) => {
    await q.query(`update rigo.companies set archived_at = now() where id = $1`, [cc.company.id]);
    await audit(q, cc, 'workspace.archived', { name: cc.company.name });
  });
  return c.json({ ok: true });
});

workspaceRoutes.post('/unarchive', async (c) => {
  const cc = c.get('cc');
  if (!cc.isOwner) throw forbidden('Only owners can restore the workspace.');
  await cc.db.tx(async (q) => {
    await q.query(`update rigo.companies set archived_at = null where id = $1`, [cc.company.id]);
    await audit(q, cc, 'workspace.unarchived', { name: cc.company.name });
  });
  return c.json({ ok: true });
});

/** Whether the workspace has billing history that must be kept (issued invoices or payments). */
export async function hasMoneyHistory(q: Q, companyId: string) {
  const { rows } = await q.query<{ n: number }>(`select count(*)::int n from rigo.work_items where company_id = $1 and billing = 'invoiced'`, [companyId]);
  return rows[0].n > 0;
}

/** Deletes a workspace that was only tried out: nothing invoiced or paid. Anything else is archived instead. */
workspaceRoutes.post('/delete', async (c) => {
  const cc = c.get('cc');
  const input = await body(c, z.object({ confirmName: z.string().max(120) }));
  confirmName(cc, input.confirmName);
  await cc.db.tx(async (q) => {
    if (await hasMoneyHistory(q, cc.company.id)) throw conflict(`${cc.company.name} has issued invoices or recorded payments, so it is kept for your records. Archive it instead.`);
    await q.query(`delete from rigo.companies where id = $1 and kind = 'real'`, [cc.company.id]);
    // Recorded on the owner's account, since the workspace's own log goes with it.
    await q.query(`insert into rigo.audit_log (company_id, actor_user_id, action, detail) values (null, $1, 'workspace.deleted', $2)`, [cc.user.id, JSON.stringify({ id: cc.company.id, name: cc.company.name })]);
  });
  return c.json({ ok: true });
});
