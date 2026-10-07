import { z } from 'zod';
import type { Q } from '../db/index.js';
import { ROLE_PRESETS, ALL_PERMISSIONS } from '../../shared/permissions.js';
import { serviceInputSchema, starterService, customFieldsSchema, readPricing, storedPricing, type ServiceCategory, type ServiceInput, type PriceLine } from '../../shared/services.js';
import { definitionSchema, defaultWorkflows, stableHash, type Definition } from '../../shared/workflows.js';

// "Structure" is reusable configuration: services, custom fields, role permissions and workflow
// definitions. It never includes customers, people, jobs, invoices, files or credentials.

export const structureSchema = z.object({
  services: z.array(z.any()).max(30).default([]),
  customFields: customFieldsSchema.optional(),
  roles: z.array(z.object({ key: z.string().max(40), name: z.string().max(60), description: z.string().max(300).default(''), permissions: z.array(z.string()) })).max(20).default([]),
  // `draft`: a tested workflow that wasn't switched on in the source company. Never part of a published copy.
  workflows: z.array(z.object({ name: z.string().max(80), description: z.string().max(300).default(''), definition: z.any(), draft: z.boolean().optional() })).max(20).default([]),
});
export type Structure = z.infer<typeof structureSchema>;

export async function seedRoles(q: Q, companyId: string) {
  for (const r of ROLE_PRESETS) {
    await q.query(`insert into rigo.roles (company_id, key, name, description, permissions, is_owner) values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
      [companyId, r.key, r.name, r.description, r.permissions, !!r.isOwner]);
  }
}

/** Structure without prices: rates, overage rates, minimums and rate dates are the company's own decisions. */
const withoutRates = (p: PriceLine): PriceLine => ({ ...p, rateE4: null, overageRateE4: null, minimumMinor: null, rateSince: null });

export async function insertService(q: Q, companyId: string, s: ServiceInput) {
  const { rows } = await q.query<{ id: string }>(
    `insert into rigo.services (company_id, name, category, description, fields, pricing, tax_rate_bp, requires_photo, requires_signature, active, invoice_shows_notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [companyId, s.name, s.category, s.description, JSON.stringify(s.fields), JSON.stringify(storedPricing(s.pricing)), s.taxRateBp, s.requiresPhoto, s.requiresSignature, s.active, !!s.invoiceShowsNotes]);
  return rows[0].id;
}

export async function seedStarterServices(q: Q, companyId: string, categories: ServiceCategory[]) {
  for (const cat of categories) await insertService(q, companyId, starterService(cat));
}

export async function insertWorkflow(q: Q, companyId: string, userId: string | null, wf: { name: string; description: string; definition: Definition }, source: string, status: 'draft' | 'proposal' = 'draft') {
  const { rows } = await q.query<{ id: string }>(`insert into rigo.workflows (company_id, name, description) values ($1,$2,$3) returning id`, [companyId, wf.name, wf.description]);
  const v = await q.query<{ id: string }>(
    `insert into rigo.workflow_versions (workflow_id, company_id, version, status, source, definition, definition_hash, created_by)
     values ($1,$2,1,$3,$4,$5,$6,$7) returning id`,
    [rows[0].id, companyId, status, source, JSON.stringify(wf.definition), stableHash(wf.definition), userId]);
  return { workflowId: rows[0].id, versionId: v.rows[0].id };
}

/**
 * The standard workflows. With `activate`, they start on, acting for the owner who created the
 * company, so completed jobs are never left unbilled (R3-M3); issuing still needs approval.
 */
export async function seedDefaultWorkflows(q: Q, companyId: string, userId: string | null, opts: { activate?: boolean; note?: string } = {}) {
  const out = [];
  for (const wf of defaultWorkflows()) {
    const w = await insertWorkflow(q, companyId, userId, wf, 'system');
    if (opts.activate && userId) {
      await q.query(`update rigo.workflow_versions set status = 'active', tested_hash = definition_hash, tested_at = now(), activated_at = now(), activated_by = $2, test_result = $3 where id = $1`,
        [w.versionId, userId, JSON.stringify({ note: opts.note ?? 'Standard workflow, on from the start. Invoices still need approval before they are issued.' })]);
      await q.query(`update rigo.workflows set active_version_id = $2 where id = $1`, [w.workflowId, w.versionId]);
    }
    out.push(w);
  }
  return out;
}

/** Approvers and backups are people in the source company: never part of a template (R16-m4). */
function withoutPeople(definition: any) {
  if (!definition?.steps) return definition;
  return { ...definition, steps: definition.steps.map((st: any) => ({ ...st, approval: st.approval ? { ...st.approval, approverUserIds: [], backupUserIds: [] } : st.approval })) };
}

/**
 * A company's structure as a template. Only workflows that are switched on are included, plus
 * tested drafts when asked for; test runs, untested drafts and the people who approve are left out.
 */
export async function exportStructure(q: Q, companyId: string, opts: { includeTestedDrafts?: boolean } = {}): Promise<Structure> {
  const services = await q.query(`select name, category, description, fields, pricing, tax_rate_bp, requires_photo, requires_signature, invoice_shows_notes from rigo.services where company_id = $1 and active order by created_at`, [companyId]);
  const company = await q.query<{ settings: any }>(`select settings from rigo.companies where id = $1`, [companyId]);
  const roles = await q.query(`select key, name, description, permissions from rigo.roles where company_id = $1 and not is_owner order by key`, [companyId]);
  const wfs = await q.query(
    `select w.name, w.description, av.definition as active, lv.definition as latest, lv.status as latest_status
       from rigo.workflows w
       left join rigo.workflow_versions av on av.id = w.active_version_id
       left join lateral (select definition, status from rigo.workflow_versions where workflow_id = w.id and status <> 'proposal' order by version desc limit 1) lv on true
      where w.company_id = $1 order by w.created_at`, [companyId]);
  const workflows = wfs.rows.flatMap((w: any) => {
    if (w.active) return [{ name: w.name, description: w.description, definition: withoutPeople(w.active) }];
    if (opts.includeTestedDrafts && w.latest && w.latest_status === 'tested') return [{ name: w.name, description: w.description, definition: withoutPeople(w.latest), draft: true }];
    return [];
  });
  return {
    services: services.rows.map((s: any) => ({
      name: s.name, category: s.category, description: s.description, fields: s.fields,
      // Rates are company pricing decisions, not reusable structure; the receiving company sets its own.
      pricing: readPricing(s.pricing).map(withoutRates),
      taxRateBp: null, requiresPhoto: s.requires_photo, requiresSignature: s.requires_signature, active: true, invoiceShowsNotes: !!s.invoice_shows_notes,
    })),
    customFields: customFieldsSchema.parse(company.rows[0]?.settings?.customFields ?? {}),
    roles: roles.rows as any,
    workflows,
  };
}

/** What a published template shows other people (D11): structure only, never drafts or people. */
export function blankCopy(content: unknown): Structure {
  const s = structureSchema.parse(content);
  return { ...s, workflows: s.workflows.filter((w) => !w.draft).map((w) => ({ name: w.name, description: w.description, definition: withoutPeople(w.definition) })) };
}

export type PlanAction = 'add' | 'skip' | 'copy';
export interface StructurePlan {
  services: { name: string; action: PlanAction; as?: string }[];
  workflows: { name: string; action: PlanAction; as?: string }[];
  roles: { name: string; action: 'update' | 'same' | 'keep' | 'missing' }[];
  customFields: { label: string; action: 'add' | 'skip' }[];
}

const nameKey = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ');
function copyName(name: string, taken: Set<string>) {
  for (let i = 2; i < 100; i++) { const n = `${name} (${i})`.slice(0, 80); if (!taken.has(nameKey(n))) return n; }
  return `${name} (copy)`.slice(0, 80);
}

/**
 * What applying a template would do (R16-M4): anything this company already has by name is
 * skipped, or added as a copy named "… (2)" when asked. Applying the same template twice adds nothing.
 */
export async function planStructure(q: Q, companyId: string, content: unknown, duplicates: 'skip' | 'copy' = 'skip'): Promise<StructurePlan> {
  const s = structureSchema.parse(content);
  const svcNames = new Set((await q.query<{ name: string }>(`select name from rigo.services where company_id = $1 and active`, [companyId])).rows.map((r) => nameKey(r.name)));
  const wfNames = new Set((await q.query<{ name: string }>(`select name from rigo.workflows where company_id = $1`, [companyId])).rows.map((r) => nameKey(r.name)));
  const roles = new Map((await q.query<{ key: string; name: string; permissions: string[] }>(`select key, name, permissions from rigo.roles where company_id = $1 and not is_owner`, [companyId])).rows.map((r) => [r.key, r]));
  const cur = customFieldsSchema.parse((await q.query<{ settings: any }>(`select settings from rigo.companies where id = $1`, [companyId])).rows[0]?.settings?.customFields ?? {});
  const named = (items: { name: string }[], taken: Set<string>) => items.map((x) => {
    if (!taken.has(nameKey(x.name))) { taken.add(nameKey(x.name)); return { name: x.name, action: 'add' as const }; }
    if (duplicates === 'skip') return { name: x.name, action: 'skip' as const };
    const as = copyName(x.name, taken); taken.add(nameKey(as));
    return { name: x.name, action: 'copy' as const, as };
  });
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  return {
    services: named(s.services.map((x: any) => ({ name: String(x?.name ?? '?') })), svcNames),
    workflows: named(s.workflows, wfNames),
    // A role this company already set up is kept as it is; the template never changes someone's access silently.
    roles: s.roles.map((r) => {
      const mine = roles.get(r.key);
      const perms = r.permissions.filter((p) => (ALL_PERMISSIONS as string[]).includes(p));
      return { name: mine?.name ?? r.name, action: !mine ? 'missing' as const : sameSet(perms, mine.permissions) ? 'same' as const : 'keep' as const };
    }),
    customFields: s.customFields ? (['customers', 'jobs', 'locations'] as const).flatMap((k) => s.customFields![k].map((f) => ({ label: f.label, action: cur[k].some((x) => x.key === f.key) ? 'skip' as const : 'add' as const }))) : [],
  };
}

/**
 * Copy structure into a company as its own configuration, following the plan. Workflows always
 * arrive as drafts so nothing activates without the owner testing and activating it.
 */
export async function applyStructure(q: Q, companyId: string, userId: string, content: unknown, opts: { duplicates?: 'skip' | 'copy'; updateRoles?: boolean } = {}) {
  const s = structureSchema.parse(content);
  const plan = await planStructure(q, companyId, s, opts.duplicates ?? 'skip');
  const summary = { services: 0, workflows: 0, roles: 0, customFields: 0, skipped: [] as string[], copied: [] as string[] };
  for (const [i, raw] of s.services.entries()) {
    const step = plan.services[i];
    if (step.action === 'skip') { summary.skipped.push(`Service "${step.name}": you already have one with this name`); continue; }
    const parsed = serviceInputSchema.safeParse(raw);
    if (!parsed.success) { summary.skipped.push(`Service "${(raw as any)?.name ?? '?'}" is not valid`); continue; }
    await insertService(q, companyId, { ...parsed.data, name: step.as ?? parsed.data.name, pricing: parsed.data.pricing.map(withoutRates), taxRateBp: null });
    if (step.as) summary.copied.push(`Service "${step.name}" added as "${step.as}"`);
    summary.services++;
  }
  // A brand-new company built from another one's structure takes its role permissions too.
  if (opts.updateRoles) {
    for (const r of s.roles) {
      const perms = r.permissions.filter((p) => (ALL_PERMISSIONS as string[]).includes(p));
      const res = await q.query(`update rigo.roles set permissions = $3, description = $4 where company_id = $1 and key = $2 and not is_owner`, [companyId, r.key, perms, r.description]);
      if ((res as any).rowCount ?? (res as any).affectedRows) summary.roles++;
    }
  } else for (const r of plan.roles) if (r.action === 'keep') summary.skipped.push(`Role "${r.name}": your own permissions are kept`);
  const roleKeys = (await q.query<{ key: string }>(`select key from rigo.roles where company_id = $1`, [companyId])).rows.map((r) => r.key);
  for (const [i, w] of s.workflows.entries()) {
    const step = plan.workflows[i];
    if (step.action === 'skip') { summary.skipped.push(`Workflow "${step.name}": you already have one with this name`); continue; }
    const d = definitionSchema.safeParse(w.definition);
    if (!d.success) { summary.skipped.push(`Workflow "${w.name}" is not valid`); continue; }
    const referenced = d.data.steps.flatMap((st) => [...(st.params.roles ?? []), ...st.approval.approverRoles, ...st.onException.notifyRoles]);
    const usesUnknownRole = referenced.some((r) => !roleKeys.includes(r));
    await insertWorkflow(q, companyId, userId, { name: step.as ?? w.name, description: w.description, definition: withoutPeople(d.data) }, 'template');
    if (usesUnknownRole) summary.skipped.push(`Workflow "${w.name}" refers to a role this company does not have; fix it before testing.`);
    if (step.as) summary.copied.push(`Workflow "${step.name}" added as "${step.as}"`);
    summary.workflows++;
  }
  if (s.customFields) {
    const cur = await q.query<{ settings: any }>(`select settings from rigo.companies where id = $1`, [companyId]);
    const existing = customFieldsSchema.parse(cur.rows[0].settings?.customFields ?? {});
    const merged: any = {};
    for (const k of ['customers', 'jobs', 'locations'] as const) {
      const keys = new Set(existing[k].map((f) => f.key));
      merged[k] = [...existing[k], ...s.customFields[k].filter((f) => !keys.has(f.key))].slice(0, 20);
      summary.customFields += merged[k].length - existing[k].length;
    }
    await q.query(`update rigo.companies set settings = jsonb_set(settings, '{customFields}', $2::jsonb) where id = $1`, [companyId, JSON.stringify(merged)]);
  }
  return summary;
}
