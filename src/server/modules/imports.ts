import { Hono } from 'hono';
import { z } from 'zod';
import Papa from 'papaparse';
import { type AppEnv, need, audit } from '../http/context.js';
import { body } from '../lib/util.js';
import { badRequest, conflict, notFound } from '../http/errors.js';

// Reviewed CSV imports: upload -> map fields -> review (validation, duplicates, relationships,
// ambiguity) -> explicit commit. Nothing activates workflows; nothing is invented.

export const importRoutes = new Hono<AppEnv>();

const MAX_BYTES = 1_000_000;
const MAX_ROWS = 2000;

export const IMPORT_FIELDS = {
  customers: [
    { key: 'name', label: 'Customer name', required: true, hints: ['name', 'customer', 'company', 'client'] },
    { key: 'email', label: 'Email', required: false, hints: ['email', 'e-mail', 'mail'] },
    { key: 'phone', label: 'Phone', required: false, hints: ['phone', 'tel', 'mobile', 'cell'] },
    { key: 'billing_address', label: 'Billing address', required: false, hints: ['billing'] },
    { key: 'address', label: 'Service address (creates a location)', required: false, hints: ['address', 'street', 'site', 'location'] },
    { key: 'access', label: 'Access instructions', required: false, hints: ['access', 'gate', 'instructions'] },
    { key: 'notes', label: 'Notes', required: false, hints: ['note', 'comment'] },
  ],
  resources: [
    { key: 'name', label: 'Name', required: true, hints: ['name', 'truck', 'unit', 'equipment'] },
    { key: 'kind', label: 'Type (truck, equipment, unit)', required: true, hints: ['type', 'kind', 'category'] },
    { key: 'identifier', label: 'Identifier / plate', required: false, hints: ['plate', 'id', 'vin', 'serial', 'identifier', 'number'] },
    { key: 'capacity', label: 'Capacity', required: false, hints: ['capacity', 'size'] },
  ],
} as const;
type Kind = keyof typeof IMPORT_FIELDS;

function suggestMapping(kind: Kind, headers: string[]) {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const f of IMPORT_FIELDS[kind]) {
    const h = headers.find((x) => !used.has(x) && f.hints.some((hint) => x.toLowerCase().replace(/[_-]/g, ' ').includes(hint)));
    if (h) { mapping[f.key] = h; used.add(h); }
  }
  return mapping;
}

importRoutes.get('/imports', async (c) => {
  const cc = c.get('cc');
  need(cc, 'imports.run');
  const { rows } = await cc.db.query(`select id, kind, file_name, status, created_at, committed_at, result, jsonb_array_length(rows) as row_count from rigo.imports where company_id = $1 order by created_at desc limit 50`, [cc.company.id]);
  return c.json({ imports: rows, fields: IMPORT_FIELDS, limits: { maxBytes: MAX_BYTES, maxRows: MAX_ROWS } });
});

importRoutes.post('/imports', async (c) => {
  const cc = c.get('cc');
  need(cc, 'imports.run');
  const input = await body(c, z.object({ kind: z.enum(['customers', 'resources']), fileName: z.string().max(200), text: z.string().max(MAX_BYTES, 'The file is larger than 1 MB. Split it into smaller files.') }));
  if (/\.(xlsx|xls|ods|numbers)$/i.test(input.fileName)) throw badRequest('Spreadsheet files are not read directly yet. Save the sheet as CSV (File > Save as > CSV) and upload that.');
  const parsed = Papa.parse<Record<string, string>>(input.text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim().slice(0, 80) });
  const headers = (parsed.meta.fields ?? []).filter(Boolean);
  if (!headers.length) throw badRequest('No header row was found. The first row must name the columns.');
  if (headers.length > 40) throw badRequest('The file has more than 40 columns.');
  if (parsed.data.length === 0) throw badRequest('The file has no data rows.');
  if (parsed.data.length > MAX_ROWS) throw badRequest(`The file has ${parsed.data.length} rows; the limit is ${MAX_ROWS}. Split it into smaller files.`);
  const rows = parsed.data.map((r) => Object.fromEntries(headers.map((h) => [h, String(r[h] ?? '').trim().slice(0, 1000)])));
  const parseErrors = parsed.errors.slice(0, 20).map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`);
  const mapping = suggestMapping(input.kind, headers);
  const { rows: ins } = await cc.db.query<{ id: string }>(`insert into rigo.imports (company_id, kind, file_name, headers, rows, mapping, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [cc.company.id, input.kind, input.fileName, JSON.stringify(headers), JSON.stringify(rows), JSON.stringify(mapping), cc.user.id]);
  return c.json({ id: ins[0].id, headers, mapping, rowCount: rows.length, parseErrors, sample: rows.slice(0, 5) });
});

importRoutes.get('/imports/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'imports.run');
  const { rows } = await cc.db.query<any>(`select * from rigo.imports where id = $1 and company_id = $2`, [c.req.param('id'), cc.company.id]);
  if (!rows[0]) throw notFound('Import');
  const imp = rows[0];
  return c.json({ import: { ...imp, rows: undefined, sample: imp.rows.slice(0, 5), rowCount: imp.rows.length }, fields: IMPORT_FIELDS[imp.kind as Kind] });
});

type RowReview = { index: number; values: Record<string, string>; errors: string[]; warnings: string[]; duplicateOf: string | null; action: 'create' | 'skip' | 'add_location' };

importRoutes.post('/imports/:id/review', async (c) => {
  const cc = c.get('cc');
  need(cc, 'imports.run');
  const input = await body(c, z.object({ mapping: z.record(z.string(), z.string()) }));
  const imp = (await cc.db.query<any>(`select * from rigo.imports where id = $1 and company_id = $2`, [c.req.param('id'), cc.company.id])).rows[0];
  if (!imp) throw notFound('Import');
  if (imp.status === 'committed') throw conflict('This import was already committed.');
  const kind = imp.kind as Kind;
  for (const f of IMPORT_FIELDS[kind]) if (f.required && !input.mapping[f.key]) throw badRequest(`Choose the column for "${f.label}".`, { fields: { [f.key]: 'Required' } });
  for (const h of Object.values(input.mapping)) if (h && !imp.headers.includes(h)) throw badRequest(`Column "${h}" is not in the file.`);
  const out: RowReview[] = [];
  if (kind === 'customers') {
    const existing = (await cc.db.query<any>(`select id, name, lower(name) as lname, lower(coalesce(email,'')) as lemail from rigo.customers where company_id = $1`, [cc.company.id])).rows;
    const byEmail = new Map(existing.filter((e) => e.lemail).map((e) => [e.lemail, e]));
    const byName = new Map<string, any[]>();
    for (const e of existing) byName.set(e.lname, [...(byName.get(e.lname) ?? []), e]);
    const seen = new Map<string, number>();
    imp.rows.forEach((r: Record<string, string>, index: number) => {
      const v = Object.fromEntries(Object.entries(input.mapping).filter(([, h]) => h).map(([k, h]) => [k, r[h] ?? '']));
      const rv: RowReview = { index, values: v, errors: [], warnings: [], duplicateOf: null, action: 'create' };
      if (!v.name) rv.errors.push('Missing customer name');
      if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) rv.errors.push('Email is not valid');
      const key = `${(v.name ?? '').toLowerCase()}|${(v.email ?? '').toLowerCase()}`;
      if (seen.has(key)) {
        // Same customer listed again: treat the extra row as another location when it has a different address.
        rv.warnings.push(`Same customer as row ${seen.get(key)! + 2} in this file`);
        rv.action = v.address ? 'add_location' : 'skip';
      } else seen.set(key, index);
      const emailMatch = v.email ? byEmail.get(v.email.toLowerCase()) : undefined;
      const nameMatches = byName.get((v.name ?? '').toLowerCase()) ?? [];
      if (emailMatch) { rv.duplicateOf = emailMatch.id; rv.warnings.push(`Matches existing customer "${emailMatch.name}" by email`); rv.action = 'skip'; }
      else if (nameMatches.length === 1) { rv.duplicateOf = nameMatches[0].id; rv.warnings.push(`Same name as existing customer "${nameMatches[0].name}". Rigo will not merge them unless you choose to.`); rv.action = 'skip'; }
      else if (nameMatches.length > 1) rv.warnings.push(`Ambiguous: ${nameMatches.length} existing customers share this name. Rigo will not guess which one.`);
      if (!v.address) rv.warnings.push('No service address; no location will be created');
      if (rv.errors.length) rv.action = 'skip';
      out.push(rv);
    });
  } else {
    const existing = (await cc.db.query<any>(`select id, lower(name) as lname from rigo.resources where company_id = $1`, [cc.company.id])).rows;
    const names = new Map(existing.map((e) => [e.lname, e.id]));
    const seen = new Set<string>();
    imp.rows.forEach((r: Record<string, string>, index: number) => {
      const v = Object.fromEntries(Object.entries(input.mapping).filter(([, h]) => h).map(([k, h]) => [k, r[h] ?? '']));
      const rv: RowReview = { index, values: v, errors: [], warnings: [], duplicateOf: null, action: 'create' };
      if (!v.name) rv.errors.push('Missing name');
      const kindVal = (v.kind ?? '').toLowerCase();
      if (!['truck', 'equipment', 'unit'].includes(kindVal)) rv.errors.push('Type must be truck, equipment or unit');
      else rv.values.kind = kindVal;
      if (names.has((v.name ?? '').toLowerCase())) { rv.duplicateOf = names.get(v.name.toLowerCase()); rv.warnings.push('A resource with this name already exists'); rv.action = 'skip'; }
      if (seen.has((v.name ?? '').toLowerCase())) { rv.warnings.push('Listed twice in this file'); rv.action = 'skip'; }
      seen.add((v.name ?? '').toLowerCase());
      if (rv.errors.length) rv.action = 'skip';
      out.push(rv);
    });
  }
  const summary = { total: out.length, create: out.filter((r) => r.action === 'create').length, addLocation: out.filter((r) => r.action === 'add_location').length, skip: out.filter((r) => r.action === 'skip').length, errors: out.filter((r) => r.errors.length).length, warnings: out.filter((r) => r.warnings.length).length };
  await cc.db.query(`update rigo.imports set mapping = $2, review = $3, status = 'reviewed' where id = $1`, [imp.id, JSON.stringify(input.mapping), JSON.stringify({ rows: out, summary })]);
  return c.json({ summary, rows: out.slice(0, 500) });
});

importRoutes.post('/imports/:id/commit', async (c) => {
  const cc = c.get('cc');
  need(cc, 'imports.run');
  const input = await body(c, z.object({ confirm: z.literal(true), overrides: z.record(z.string(), z.enum(['create', 'skip'])).default({}) }));
  const db = cc.db;
  const imp = (await db.query<any>(`select * from rigo.imports where id = $1 and company_id = $2`, [c.req.param('id'), cc.company.id])).rows[0];
  if (!imp) throw notFound('Import');
  if (imp.status === 'committed') return c.json({ result: imp.result, already: true });
  if (imp.status !== 'reviewed' || !imp.review) throw conflict('Review the import before committing it.');
  try {
    const result = await db.tx(async (q) => {
      // Lock the import so two commits cannot both run.
      const lock = await q.query(`update rigo.imports set status = 'committed', committed_at = now() where id = $1 and status = 'reviewed' returning id`, [imp.id]);
      if (!lock.rows.length) throw conflict('This import is already being committed.');
      const counts = { customers: 0, locations: 0, resources: 0, skipped: 0 };
      const created = new Map<string, string>();
      for (const r of imp.review.rows as RowReview[]) {
        const override = input.overrides[String(r.index)];
        const action = (r.errors.length ? 'skip' : override ?? r.action) as RowReview['action'];
        if (action === 'skip') { counts.skipped++; continue; }
        const v = r.values;
        if (imp.kind === 'customers') {
          const key = `${(v.name ?? '').toLowerCase()}|${(v.email ?? '').toLowerCase()}`;
          let custId = created.get(key);
          // An extra location row only attaches to a customer created by this import; it never creates a second copy.
          if (!custId && action === 'add_location') { counts.skipped++; continue; }
          if (!custId) {
            const ins = await q.query<{ id: string }>(`insert into rigo.customers (company_id, name, email, phone, billing_address, notes) values ($1,$2,$3,$4,$5,$6) returning id`,
              [cc.company.id, v.name, v.email || null, v.phone || null, v.billing_address || null, v.notes ?? '']);
            custId = ins.rows[0].id; created.set(key, custId); counts.customers++;
          }
          if (v.address) {
            await q.query(`insert into rigo.locations (company_id, customer_id, address, access_instructions) values ($1,$2,$3,$4)`, [cc.company.id, custId, v.address, v.access ?? '']);
            counts.locations++;
          }
        } else {
          await q.query(`insert into rigo.resources (company_id, kind, name, identifier, capacity) values ($1,$2,$3,$4,$5)`, [cc.company.id, v.kind, v.name, v.identifier ?? '', v.capacity ?? '']);
          counts.resources++;
        }
      }
      await q.query(`update rigo.imports set result = $2 where id = $1`, [imp.id, JSON.stringify(counts)]);
      await audit(q, cc, 'import.committed', { id: imp.id, ...counts });
      return counts;
    });
    return c.json({ result });
  } catch (e: any) {
    if (e?.status === 409) throw e;
    // Nothing was saved (the transaction rolled back); the reviewed import can be committed again.
    throw badRequest(`The import could not be saved and nothing was changed: ${String(e?.message ?? e).slice(0, 200)}`);
  }
});

importRoutes.post('/imports/:id/discard', async (c) => {
  const cc = c.get('cc');
  need(cc, 'imports.run');
  await cc.db.query(`update rigo.imports set status = 'discarded', rows = '[]'::jsonb, review = null where id = $1 and company_id = $2 and status <> 'committed'`, [c.req.param('id'), cc.company.id]);
  return c.json({ ok: true });
});
