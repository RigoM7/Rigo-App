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
  workflows: z.array(z.object({ name: z.string().max(80), description: z.string().max(300).default(''), definition: z.any() })).max(20).default([]),
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

export async function seedDefaultWorkflows(q: Q, companyId: string, userId: string | null) {
  const out = [];
  for (const wf of defaultWorkflows()) out.push(await insertWorkflow(q, companyId, userId, wf, 'system'));
  return out;
}

export async function exportStructure(q: Q, companyId: string): Promise<Structure> {
  const services = await q.query(`select name, category, description, fields, pricing, tax_rate_bp, requires_photo, requires_signature, invoice_shows_notes from rigo.services where company_id = $1 and active order by created_at`, [companyId]);
  const company = await q.query<{ settings: any }>(`select settings from rigo.companies where id = $1`, [companyId]);
  const roles = await q.query(`select key, name, description, permissions from rigo.roles where company_id = $1 and not is_owner order by key`, [companyId]);
  const wfs = await q.query(
    `select w.name, w.description, coalesce(av.definition, lv.definition) as definition
       from rigo.workflows w
       left join rigo.workflow_versions av on av.id = w.active_version_id
       left join lateral (select definition from rigo.workflow_versions where workflow_id = w.id and status <> 'proposal' order by version desc limit 1) lv on true
      where w.company_id = $1 order by w.created_at`, [companyId]);
  return {
    services: services.rows.map((s: any) => ({
      name: s.name, category: s.category, description: s.description, fields: s.fields,
      // Rates are company pricing decisions, not reusable structure; the receiving company sets its own.
      pricing: readPricing(s.pricing).map(withoutRates),
      taxRateBp: null, requiresPhoto: s.requires_photo, requiresSignature: s.requires_signature, active: true, invoiceShowsNotes: !!s.invoice_shows_notes,
    })),
    customFields: customFieldsSchema.parse(company.rows[0]?.settings?.customFields ?? {}),
    roles: roles.rows as any,
    workflows: wfs.rows.filter((w: any) => w.definition).map((w: any) => ({ name: w.name, description: w.description, definition: w.definition })),
  };
}

/**
 * Copy structure into a company as its own configuration. Workflows always arrive as drafts so
 * nothing activates without the owner testing and activating it.
 */
export async function applyStructure(q: Q, companyId: string, userId: string, content: unknown) {
  const s = structureSchema.parse(content);
  const summary = { services: 0, workflows: 0, roles: 0, customFields: 0, skipped: [] as string[] };
  for (const raw of s.services) {
    const parsed = serviceInputSchema.safeParse(raw);
    if (!parsed.success) { summary.skipped.push(`Service "${(raw as any)?.name ?? '?'}" is not valid`); continue; }
    await insertService(q, companyId, { ...parsed.data, pricing: parsed.data.pricing.map(withoutRates), taxRateBp: null });
    summary.services++;
  }
  for (const r of s.roles) {
    const perms = r.permissions.filter((p) => (ALL_PERMISSIONS as string[]).includes(p));
    const res = await q.query(`update rigo.roles set permissions = $3, description = $4 where company_id = $1 and key = $2 and not is_owner`, [companyId, r.key, perms, r.description]);
    if ((res as any).rowCount ?? (res as any).affectedRows) summary.roles++;
  }
  const roleKeys = (await q.query<{ key: string }>(`select key from rigo.roles where company_id = $1`, [companyId])).rows.map((r) => r.key);
  for (const w of s.workflows) {
    const d = definitionSchema.safeParse(w.definition);
    if (!d.success) { summary.skipped.push(`Workflow "${w.name}" is not valid`); continue; }
    const referenced = d.data.steps.flatMap((st) => [...(st.params.roles ?? []), ...st.approval.approverRoles, ...st.onException.notifyRoles]);
    const usesUnknownRole = referenced.some((r) => !roleKeys.includes(r));
    // Approver user ids belong to the source company and are never carried over.
    const def = { ...d.data, steps: d.data.steps.map((st) => ({ ...st, approval: { ...st.approval, approverUserIds: [], backupUserIds: [] } })) };
    await insertWorkflow(q, companyId, userId, { name: w.name, description: w.description, definition: def }, 'template');
    if (usesUnknownRole) summary.skipped.push(`Workflow "${w.name}" refers to a role this company does not have; fix it before testing.`);
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
