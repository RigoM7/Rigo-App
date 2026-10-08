import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { type AppEnv, need, audit, requireUser } from '../http/context.js';
import { body } from '../lib/util.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import { TEMPLATES } from '../../shared/templates.js';
import { structureSchema, structureProblems } from '../../shared/workspace.js';
import { exportStructure } from './workspaces.js';

// The template library: Rigo's built-in templates plus the ones owners publish for others. A
// template is structure only (words, roles, stages, fields, item names), never prices, people or
// records. Applying one copies it; later changes to the template never change a workspace.

export const libraryPublic = new Hono<AppEnv>();
export const libraryRoutes = new Hono<AppEnv>();

libraryPublic.get('/library', async (c) => {
  const db = await getDb();
  const { rows } = await db.query<any>(`select l.id, l.name, l.blurb, l.examples, l.structure, l.uses, l.created_at, c.name as from_name
      from rigo.library_templates l left join rigo.companies c on c.id = l.company_id where l.unpublished_at is null order by l.uses desc, l.created_at desc limit 200`);
  return c.json({
    builtIn: TEMPLATES.map((t) => ({ key: t.key, name: t.name, blurb: t.blurb, examples: t.examples, structure: t.structure })),
    shared: rows.map((r) => ({ id: r.id, key: `lib:${r.id}`, name: r.name, blurb: r.blurb, examples: r.examples, structure: r.structure, uses: r.uses, from: r.from_name, createdAt: r.created_at })),
  });
});

/** A published template's structure, re-validated (it may have been published under older rules). */
export async function libraryStructure(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Template');
  const db = await getDb();
  const row = (await db.query<any>(`select structure from rigo.library_templates where id = $1 and unpublished_at is null`, [id])).rows[0];
  if (!row) throw notFound('Template');
  const s = structureSchema.safeParse(row.structure);
  if (!s.success || structureProblems(s.data).length) throw badRequest('This template can’t be used any more. Choose another.');
  await db.query(`update rigo.library_templates set uses = uses + 1 where id = $1`, [id]);
  return s.data;
}

libraryRoutes.get('/library/mine', async (c) => {
  const cc = c.get('cc');
  need(cc, 'templates.manage');
  const { rows } = await cc.db.query(`select id, name, blurb, examples, uses, created_at, updated_at from rigo.library_templates where company_id = $1 and unpublished_at is null order by created_at desc`, [cc.company.id]);
  return c.json({ templates: rows });
});

libraryRoutes.post('/library', async (c) => {
  const cc = c.get('cc');
  need(cc, 'templates.manage');
  if (!cc.isOwner) throw forbidden('Only owners can publish their workspace as a template.');
  if (cc.isDemo) throw forbidden('Demos can’t be published. Create a workspace first.');
  const input = await body(c, z.object({
    name: z.string().trim().min(1, 'Name the template').max(60, 'Use 60 characters or fewer.'),
    blurb: z.string().trim().max(200, 'Use 200 characters or fewer.').default(''),
    examples: z.array(z.string().trim().min(1).max(40)).max(6).default([]),
  }));
  const structure = await exportStructure(cc.db, cc);
  const { rows } = await cc.db.query<{ id: string }>(`insert into rigo.library_templates (company_id, published_by, name, blurb, examples, structure) values ($1,$2,$3,$4,$5,$6) returning id`,
    [cc.company.id, cc.user.id, input.name, input.blurb, input.examples, JSON.stringify(structure)]);
  await audit(cc.db, cc, 'template.published', { id: rows[0].id, name: input.name });
  return c.json({ id: rows[0].id });
});

libraryRoutes.delete('/library/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'templates.manage');
  if (!/^[0-9a-f-]{36}$/i.test(c.req.param('id'))) throw notFound('Template');
  const { rows } = await cc.db.query(`update rigo.library_templates set unpublished_at = now() where id = $1 and company_id = $2 and unpublished_at is null returning id`, [c.req.param('id'), cc.company.id]);
  if (!rows.length) throw notFound('Template');
  await audit(cc.db, cc, 'template.unpublished', { id: c.req.param('id') });
  return c.json({ ok: true });
});

export { requireUser };
