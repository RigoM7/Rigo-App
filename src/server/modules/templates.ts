import { Hono } from 'hono';
import { z } from 'zod';
import type { Q } from '../db/index.js';
import { type AppEnv, need, audit } from '../http/context.js';
import { body, normEmail } from '../lib/util.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import { exportStructure, applyStructure, planStructure, blankCopy, type Structure } from './structure.js';
import { starterService, SERVICE_CATEGORIES, type ServiceCategory } from '../../shared/services.js';
import { defaultWorkflows } from '../../shared/workflows.js';
import { ROLE_PRESETS } from '../../shared/permissions.js';

// Templates share reusable structure only. Applying one copies it into the company as that
// company's own configuration (workflows arrive as drafts); later template edits never flow in.

export const templateRoutes = new Hono<AppEnv>();

export const SYSTEM_TEMPLATES: { id: string; name: string; description: string; content: Structure }[] = [
  ...(['fuel', 'portable_toilet', 'septic'] as ServiceCategory[]).map((cat) => ({
    id: `system-${cat}`, name: `${SERVICE_CATEGORIES[cat]} starter`,
    description: `Service form and pricing structure for ${SERVICE_CATEGORIES[cat].toLowerCase()}, plus the standard workflows. Set your own rates after applying.`,
    content: { services: [starterService(cat)], roles: [], workflows: defaultWorkflows() } as Structure,
  })),
  {
    id: 'system-multi', name: 'Multi-service field company', description: 'Fuel, portable toilets and septic together, sharing customers, drivers and trucks.',
    content: { services: (['fuel', 'portable_toilet', 'septic'] as ServiceCategory[]).map(starterService), roles: ROLE_PRESETS.filter((r) => !r.isOwner).map((r) => ({ key: r.key, name: r.name, description: r.description, permissions: [...r.permissions] })), workflows: defaultWorkflows() } as Structure,
  },
];

function summarize(content: Structure) {
  return { services: content.services.map((s: any) => s.name), workflows: content.workflows.map((w) => w.name), draftWorkflows: content.workflows.filter((w) => w.draft).map((w) => w.name), customFields: content.customFields ? Object.values(content.customFields).flat().length : 0 };
}

/** What someone sees of a template: its owner gets everything; a published template is the blank copy (D11). */
function contentFor(t: { owner_user_id: string | null; visibility: string; content: any }, userId: string): Structure {
  if (t.owner_user_id === userId || t.visibility !== 'public') return t.content;
  return blankCopy(t.content);
}

async function visibleTemplate(q: Q, id: string, user: { id: string; email: string }) {
  const sys = SYSTEM_TEMPLATES.find((t) => t.id === id);
  if (sys) return { ...sys, visibility: 'system', version: 1, owner_user_id: null };
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Template');
  const { rows } = await q.query<any>(`select t.* from rigo.templates t where t.id = $1 and (t.owner_user_id = $2 or t.visibility = 'public' or (t.visibility = 'shared' and exists (select 1 from rigo.template_shares s where s.template_id = t.id and s.email = $3)))`, [id, user.id, normEmail(user.email)]);
  if (!rows[0]) throw notFound('Template');
  return { ...rows[0], content: contentFor(rows[0], user.id) };
}

templateRoutes.get('/templates', async (c) => {
  const cc = c.get('cc');
  need(cc, 'templates.manage');
  const { rows } = await cc.db.query<any>(
    `select t.id, t.name, t.description, t.visibility, t.version, t.updated_at, t.content, t.owner_user_id, t.owner_user_id = $1 as mine, u.name as owner_name,
            coalesce((select json_agg(s.email) from rigo.template_shares s where s.template_id = t.id and t.owner_user_id = $1), '[]'::json) as shared_with
       from rigo.templates t left join rigo.users u on u.id = t.owner_user_id
      where t.owner_user_id = $1 or t.visibility = 'public' or (t.visibility = 'shared' and exists (select 1 from rigo.template_shares s where s.template_id = t.id and s.email = $2))
      order by t.updated_at desc`, [cc.user.id, normEmail(cc.user.email)]);
  const applied = await cc.db.query(`select template_name, template_version, applied_at from rigo.template_applications where company_id = $1 order by applied_at desc`, [cc.company.id]);
  return c.json({
    system: SYSTEM_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, visibility: 'system', summary: summarize(t.content) })),
    // A published template from someone else is labeled, never named (D11): "Made by another Rigo user".
    templates: rows.map(({ content, owner_user_id, ...t }) => ({ ...t, owner_name: t.mine || t.visibility === 'shared' ? t.owner_name : null, madeBy: !t.mine && t.visibility === 'public' ? 'Made by another Rigo user' : null, summary: summarize(contentFor({ owner_user_id, visibility: t.visibility, content }, cc.user.id)) })),
    applied: applied.rows,
  });
});

const shareEmails = z.array(z.string().trim().email()).max(50).default([]);

templateRoutes.post('/templates', async (c) => {
  const cc = c.get('cc');
  need(cc, 'templates.manage');
  if (cc.isDemo) throw forbidden('Create templates from a real company. The demo can be copied with "Set up my company".');
  const input = await body(c, z.object({ name: z.string().trim().min(1, 'Name the template').max(80), description: z.string().max(400).default(''), visibility: z.enum(['private', 'shared', 'public']).default('private'), shareWith: shareEmails, includeTestedDrafts: z.boolean().default(false) }));
  const content = await exportStructure(cc.db, cc.company.id, { includeTestedDrafts: input.includeTestedDrafts });
  const id = await cc.db.tx(async (q) => {
    const { rows } = await q.query<{ id: string }>(`insert into rigo.templates (owner_user_id, source_company_id, name, description, visibility, content) values ($1,$2,$3,$4,$5,$6) returning id`,
      [cc.user.id, cc.company.id, input.name, input.description, input.visibility, JSON.stringify(content)]);
    for (const e of input.shareWith) await q.query(`insert into rigo.template_shares (template_id, email) values ($1,$2) on conflict do nothing`, [rows[0].id, normEmail(e)]);
    await audit(q, cc, 'template.created', { id: rows[0].id, visibility: input.visibility });
    return rows[0].id;
  });
  return c.json({ id, summary: summarize(content) });
});

templateRoutes.patch('/templates/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'templates.manage');
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(80).optional(), description: z.string().max(400).optional(), visibility: z.enum(['private', 'shared', 'public']).optional(), shareWith: shareEmails.optional(), refreshFromCompany: z.boolean().optional(), includeTestedDrafts: z.boolean().optional() }));
  await cc.db.tx(async (q) => {
    const t = (await q.query<any>(`select * from rigo.templates where id = $1 and owner_user_id = $2 for update`, [c.req.param('id'), cc.user.id])).rows[0];
    if (!t) throw notFound('Template');
    const content = input.refreshFromCompany ? await exportStructure(q, cc.company.id, { includeTestedDrafts: input.includeTestedDrafts ?? (t.content?.workflows ?? []).some((w: any) => w.draft) }) : null;
    await q.query(`update rigo.templates set name = coalesce($2,name), description = coalesce($3,description), visibility = coalesce($4,visibility), content = coalesce($5::jsonb, content), version = version + case when $5::jsonb is null then 0 else 1 end, updated_at = now() where id = $1`,
      [t.id, input.name ?? null, input.description ?? null, input.visibility ?? null, content ? JSON.stringify(content) : null]);
    if (input.visibility && input.visibility !== t.visibility) await audit(q, cc, input.visibility === 'public' ? 'template.published' : t.visibility === 'public' ? 'template.unpublished' : 'template.sharing_changed', { id: t.id, visibility: input.visibility });
    if (input.shareWith) {
      await q.query(`delete from rigo.template_shares where template_id = $1`, [t.id]);
      for (const e of input.shareWith) await q.query(`insert into rigo.template_shares (template_id, email) values ($1,$2) on conflict do nothing`, [t.id, normEmail(e)]);
    }
  });
  return c.json({ ok: true });
});

templateRoutes.delete('/templates/:id', async (c) => {
  const cc = c.get('cc');
  const { rows } = await cc.db.query(`delete from rigo.templates where id = $1 and owner_user_id = $2 returning id`, [c.req.param('id'), cc.user.id]);
  if (!rows.length) throw notFound('Template');
  return c.json({ ok: true });
});

templateRoutes.get('/templates/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'templates.manage');
  const t = await visibleTemplate(cc.db, c.req.param('id'), cc.user);
  return c.json({ template: { id: t.id, name: t.name, description: t.description, visibility: t.visibility, version: t.version, content: t.content, summary: summarize(t.content) } });
});

/** What applying would add and skip, shown before anything changes (R16-M4). */
templateRoutes.get('/templates/:id/plan', async (c) => {
  const cc = c.get('cc');
  need(cc, 'templates.manage');
  const t = await visibleTemplate(cc.db, c.req.param('id'), cc.user);
  const duplicates = c.req.query('duplicates') === 'copy' ? 'copy' : 'skip';
  return c.json({ plan: await planStructure(cc.db, cc.company.id, t.content, duplicates) });
});

templateRoutes.post('/templates/:id/apply', async (c) => {
  const cc = c.get('cc');
  need(cc, 'templates.manage', 'workflows.edit', 'services.manage');
  const input = await body(c, z.object({ confirm: z.literal(true), duplicates: z.enum(['skip', 'copy']).default('skip') }));
  if (!input.confirm) throw badRequest('Confirm to apply.');
  const t = await visibleTemplate(cc.db, c.req.param('id'), cc.user);
  const summary = await cc.db.tx(async (q) => {
    const s = await applyStructure(q, cc.company.id, cc.user.id, t.content, { duplicates: input.duplicates });
    await q.query(`insert into rigo.template_applications (company_id, template_id, template_name, template_version, applied_by) values ($1,$2,$3,$4,$5)`,
      [cc.company.id, /^[0-9a-f-]{36}$/i.test(t.id) ? t.id : null, t.name, t.version, cc.user.id]);
    await audit(q, cc, 'template.applied', { template: t.name, version: t.version, ...s });
    return s;
  });
  return c.json({ summary });
});
