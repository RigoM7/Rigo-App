import { Hono } from 'hono';
import { z } from 'zod';
import Papa from 'papaparse';
import { type AppEnv, need, can, audit } from '../http/context.js';
import { body } from '../lib/util.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { addressKey, cleanCell, combineAddress, flipName, formatPhone, isLastFirst, KIND_LABELS, resourceKind, sameCustomer } from '../../shared/imports.js';
import { fold } from '../../shared/customers.js';
import { manualInvoice } from './billing.js';

// Reviewed CSV imports: upload -> map fields -> review (validation, duplicates, relationships,
// ambiguity) -> explicit commit. Nothing activates workflows; nothing is invented.

export const importRoutes = new Hono<AppEnv>();

const MAX_BYTES = 1_000_000;
const MAX_ROWS = 2000;

export const IMPORT_FIELDS = {
  customers: [
    { key: 'name', label: 'Customer name', required: true, hints: ['customer name', 'name', 'customer', 'company', 'client'] },
    { key: 'contact_name', label: 'Contact person', required: false, hints: ['contact name', 'contact', 'attention', 'attn'] },
    { key: 'email', label: 'Email', required: false, hints: ['email', 'e-mail', 'mail'] },
    { key: 'phone', label: 'Phone', required: false, hints: ['phone', 'tel', 'mobile', 'cell'] },
    { key: 'address', label: 'Service street address (creates a location)', required: false, hints: ['service address', 'site address', 'address', 'street', 'site', 'location'] },
    { key: 'address2', label: 'Service address line 2', required: false, hints: ['address 2', 'address2', 'address line 2', 'line 2', 'line2', 'suite', 'apt'] },
    { key: 'city', label: 'City or town', required: false, hints: ['city', 'town'] },
    { key: 'state', label: 'State', required: false, hints: ['state', 'province', 'region'] },
    { key: 'zip', label: 'ZIP or postal code', required: false, hints: ['zip', 'postal', 'postcode'] },
    { key: 'access', label: 'Access instructions', required: false, hints: ['access', 'gate', 'instructions'] },
    { key: 'billing_address', label: 'Billing street address', required: false, hints: ['billing address', 'billing street', 'billing', 'bill to', 'mailing address'] },
    { key: 'billing_city', label: 'Billing city', required: false, hints: ['billing city', 'mailing city'] },
    { key: 'billing_state', label: 'Billing state', required: false, hints: ['billing state', 'mailing state'] },
    { key: 'billing_zip', label: 'Billing ZIP', required: false, hints: ['billing zip', 'billing postal', 'mailing zip'] },
    { key: 'notes', label: 'Notes', required: false, hints: ['note', 'comment'] },
    // Never suggested: bringing in what customers owe is a choice (it creates invoices).
    { key: 'opening_balance', label: 'Opening balance (creates an "Opening balance" invoice draft)', required: false, hints: [] },
  ],
  resources: [
    { key: 'name', label: 'Name', required: true, hints: ['name', 'truck', 'unit', 'equipment'] },
    { key: 'kind', label: 'Type (truck, equipment or unit; words like "vac truck" or "trailer" are understood)', required: true, hints: ['type', 'kind', 'category'] },
    { key: 'identifier', label: 'Identifier / plate', required: false, hints: ['plate', 'id', 'vin', 'serial', 'identifier', 'number'] },
    { key: 'capacity', label: 'Capacity', required: false, hints: ['capacity', 'size'] },
  ],
} as const;
type Kind = keyof typeof IMPORT_FIELDS;

/** Each column goes to the field whose most specific hint it contains ("Billing City" → billing city, not city). */
function suggestMapping(kind: Kind, headers: string[]) {
  const pairs: { key: string; header: string; score: number }[] = [];
  for (const f of IMPORT_FIELDS[kind]) for (const h of headers) {
    const norm = h.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
    const score = Math.max(0, ...f.hints.filter((hint) => norm.includes(hint)).map((hint) => hint.length));
    if (score) pairs.push({ key: f.key, header: h, score });
  }
  pairs.sort((a, b) => b.score - a.score);
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const p of pairs) if (!mapping[p.key] && !used.has(p.header)) { mapping[p.key] = p.header; used.add(p.header); }
  return mapping;
}

importRoutes.get('/imports', async (c) => {
  const cc = c.get('cc');
  need(cc, 'imports.run');
  const { rows } = await cc.db.query(`select id, kind, file_name, status, created_at, committed_at, result, jsonb_array_length(rows) as row_count from rigo.imports where company_id = $1 and status <> 'discarded' order by created_at desc limit 50`, [cc.company.id]);
  return c.json({ imports: rows, fields: IMPORT_FIELDS, limits: { maxBytes: MAX_BYTES, maxRows: MAX_ROWS } });
});

importRoutes.post('/imports', async (c) => {
  const cc = c.get('cc');
  need(cc, 'imports.run');
  const input = await body(c, z.object({ kind: z.enum(['customers', 'resources']), fileName: z.string().max(200), text: z.string().max(MAX_BYTES, 'The file is larger than 1 MB. Split it into smaller files.'), encoding: z.enum(['utf-8', 'windows-1252']).optional() }));
  if (/\.(xlsx|xls|ods|numbers)$/i.test(input.fileName)) throw badRequest('Spreadsheet files are not read directly yet. Save the sheet as CSV (File > Save as > CSV) and upload that.');
  const parsed = Papa.parse<Record<string, string>>(input.text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => cleanCell(h).value.trim().slice(0, 80) });
  const headers = [...new Set((parsed.meta.fields ?? []).filter(Boolean))];
  if (!headers.length) throw badRequest('No header row was found. The first row must name the columns.');
  if (headers.length > 40) throw badRequest('The file has more than 40 columns.');
  if (parsed.data.length === 0) throw badRequest('The file has no data rows.');
  if (parsed.data.length > MAX_ROWS) throw badRequest(`The file has ${parsed.data.length} rows; the limit is ${MAX_ROWS}. Split it into smaller files.`);
  // Control characters (a stray NUL from an old system) are removed and named by row (R16-m2).
  const cleanedRows: number[] = [];
  const unreadable: number[] = [];
  const rows = parsed.data.map((r, i) => Object.fromEntries(headers.map((h) => {
    const cell = cleanCell(String(r[h] ?? ''));
    if (cell.changed && cleanedRows.at(-1) !== i + 2) cleanedRows.push(i + 2);
    if (cell.value.includes('�') && unreadable.at(-1) !== i + 2) unreadable.push(i + 2);
    return [h, cell.value.trim().slice(0, 1000)];
  })));
  const rowList = (n: number[]) => `${n.slice(0, 10).join(', ')}${n.length > 10 ? ` and ${n.length - 10} more` : ''}`;
  const parseErrors = parsed.errors.slice(0, 20).map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`);
  const warnings = [
    ...(cleanedRows.length ? [`Removed invisible control characters from row${cleanedRows.length === 1 ? '' : 's'} ${rowList(cleanedRows)}.`] : []),
    ...(unreadable.length ? [`Some characters in row${unreadable.length === 1 ? '' : 's'} ${rowList(unreadable)} could not be read (shown as �). Try reading the file as ${input.encoding === 'windows-1252' ? 'UTF-8' : 'Windows (Excel)'} text.`] : []),
  ];
  const mapping = suggestMapping(input.kind, headers);
  const { rows: ins } = await cc.db.query<{ id: string }>(`insert into rigo.imports (company_id, kind, file_name, headers, rows, mapping, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [cc.company.id, input.kind, input.fileName, JSON.stringify(headers), JSON.stringify(rows), JSON.stringify(mapping), cc.user.id]);
  return c.json({ id: ins[0].id, kind: input.kind, fileName: input.fileName, headers, mapping, rowCount: rows.length, parseErrors, warnings, sample: rows.slice(0, 5), accented: accentedSamples(rows) });
});

/** A few values with accents or other non-English letters, so people can see they were read right. */
function accentedSamples(rows: Record<string, string>[]) {
  const out = new Set<string>();
  for (const r of rows) for (const v of Object.values(r)) { if (out.size >= 4) break; if (/[^\x00-\x7F]/.test(v)) out.add(v.slice(0, 60)); }
  return [...out];
}

importRoutes.get('/imports/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'imports.run');
  const { rows } = await cc.db.query<any>(`select * from rigo.imports where id = $1 and company_id = $2`, [c.req.param('id'), cc.company.id]);
  if (!rows[0]) throw notFound('Import');
  const imp = rows[0];
  // Everything needed to pick up an import left half done (R16-m3).
  return c.json({
    import: { id: imp.id, kind: imp.kind, fileName: imp.file_name, status: imp.status, headers: imp.headers, mapping: imp.mapping, sample: imp.rows.slice(0, 5), rowCount: imp.rows.length, accented: accentedSamples(imp.rows), createdAt: imp.created_at, result: imp.result },
    review: imp.status === 'reviewed' && imp.review ? { ...imp.review, rows: imp.review.rows.slice(0, 500) } : null,
    fields: IMPORT_FIELDS[imp.kind as Kind],
  });
});

type Option = { value: string; label: string };
type RowReview = { index: number; values: Record<string, string>; errors: string[]; warnings: string[]; info: string[]; duplicateOf: string | null; action: string; options: Option[] };

const reviewInput = z.object({
  mapping: z.record(z.string(), z.string()),
  notesColumns: z.array(z.string().max(80)).max(40).default([]),
  flipNames: z.boolean().default(false),
});

/** "$1,234.50" → 123450 minor units; "(12.00)" or "-12" is a credit, which isn't imported. */
function balanceMinor(raw: string): { minor: number | null; error?: string } {
  const t = raw.trim();
  if (!t) return { minor: null };
  if (/^\(.*\)$/.test(t) || t.startsWith('-')) return { minor: null, error: 'A negative balance (a credit) is not imported. Leave it empty and add the credit by hand.' };
  const n = t.replace(/[$,\s]|USD|CAD/gi, '');
  if (!/^\d+(\.\d{1,2})?$/.test(n)) return { minor: null, error: `Opening balance "${t}" is not an amount` };
  const minor = Math.round(Number(n) * 100);
  return { minor: minor > 0 ? minor : null };
}

importRoutes.post('/imports/:id/review', async (c) => {
  const cc = c.get('cc');
  need(cc, 'imports.run');
  const input = await body(c, reviewInput);
  const imp = (await cc.db.query<any>(`select * from rigo.imports where id = $1 and company_id = $2`, [c.req.param('id'), cc.company.id])).rows[0];
  if (!imp) throw notFound('Import');
  if (imp.status === 'committed') throw conflict('This import was already committed.');
  if (imp.status === 'discarded') throw conflict('This import was discarded. Upload the file again.');
  const kind = imp.kind as Kind;
  const mapping = Object.fromEntries(Object.entries(input.mapping).filter(([k, h]) => h && IMPORT_FIELDS[kind].some((f) => f.key === k)));
  for (const f of IMPORT_FIELDS[kind]) if (f.required && !mapping[f.key]) throw badRequest(`Choose the column for "${f.label}".`, { fields: { [f.key]: 'Required' } });
  for (const h of [...Object.values(mapping), ...input.notesColumns]) if (!imp.headers.includes(h)) throw badRequest(`Column "${h}" is not in the file.`);
  if (mapping.opening_balance && !(can(cc, 'invoices.edit') && can(cc, 'finance.view'))) throw forbidden('Only people who prepare invoices can import opening balances.');
  const mapped = new Set(Object.values(mapping));
  const notesColumns = input.notesColumns.filter((h) => !mapped.has(h));
  const unmapped = (imp.headers as string[]).filter((h) => !mapped.has(h));
  const out: RowReview[] = [];
  let lastFirst = 0;
  if (kind === 'customers') {
    const existing = (await cc.db.query<any>(`select c.id, c.name, c.email, c.phone, coalesce((select json_agg(l.address) from rigo.locations l where l.customer_id = c.id), '[]'::json) as addresses
        from rigo.customers c where c.company_id = $1 and c.archived_at is null and c.merged_into is null`, [cc.company.id])).rows;
    for (const e of existing) e.keys = new Set((e.addresses as string[]).map(addressKey));
    const roots: { index: number; v: Record<string, string>; keys: Set<string> }[] = [];
    imp.rows.forEach((r: Record<string, string>, index: number) => {
      const raw = Object.fromEntries(Object.entries(mapping).map(([k, h]) => [k, r[h] ?? '']));
      const v: Record<string, string> = {};
      const rv: RowReview = { index, values: v, errors: [], warnings: [], info: [], duplicateOf: null, action: 'create', options: [] };
      v.name = raw.name ?? '';
      if (isLastFirst(v.name)) {
        lastFirst++;
        if (input.flipNames) { rv.info.push(`Name turned around from "${v.name}"`); v.name = flipName(v.name); }
        else rv.warnings.push('Looks like "Last, First". Choose "Turn names around" to fix it.');
      }
      if (raw.contact_name) v.contact_name = raw.contact_name;
      if (raw.email) v.email = raw.email;
      if (raw.phone) v.phone = formatPhone(raw.phone);
      const address = combineAddress({ street: raw.address, line2: raw.address2, city: raw.city, state: raw.state, zip: raw.zip });
      if (address) v.address = address;
      if (raw.access) v.access = raw.access;
      const billing = combineAddress({ street: raw.billing_address, city: raw.billing_city, state: raw.billing_state, zip: raw.billing_zip });
      if (billing) v.billing_address = billing;
      const extra = notesColumns.map((h) => (r[h] ? `${h}: ${r[h]}` : '')).filter(Boolean);
      const notes = [raw.notes ?? '', ...extra].filter(Boolean).join('\n');
      if (notes) v.notes = notes;
      if (mapping.opening_balance) {
        const b = balanceMinor(raw.opening_balance ?? '');
        if (b.error) rv.errors.push(b.error);
        else if (b.minor) v.opening_balance = (b.minor / 100).toFixed(2);
      }
      if (!v.name) rv.errors.push('Missing customer name');
      if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) rv.errors.push('Email is not valid');
      if ((raw.city || raw.state || raw.zip || raw.address2) && !raw.address) rv.warnings.push('Has a town or ZIP but no street address; no location will be created');
      else if (!v.address) rv.warnings.push('No service address; no location will be created');
      const key = v.address ? addressKey(v.address) : '';
      const opt = (value: string, label: string) => rv.options.push({ value, label });
      opt('create', 'Create a separate customer');
      // Earlier rows in this file with the same name (R16-M3): the same customer only when the email or phone matches too.
      for (const root of roots.filter((x) => fold(x.v.name).trim() === fold(v.name).trim())) {
        const same = sameCustomer(v, root.v);
        if (v.address) opt(`row:${root.index}`, `Add as a location of row ${root.index + 2}`);
        if (same) {
          if (!v.address || root.keys.has(key)) { rv.action = 'skip'; rv.warnings.push(`Repeats row ${root.index + 2}${v.address ? ' with the same address' : ''}`); }
          else { rv.action = `row:${root.index}`; rv.info.push(`Same customer as row ${root.index + 2} (the ${v.email && v.email.toLowerCase() === (root.v.email ?? '').toLowerCase() ? 'email' : 'phone'} matches): added as another location`); root.keys.add(key); }
        } else rv.warnings.push(`Same name as row ${root.index + 2}, but the email and phone don't match. Kept as a separate customer unless you choose otherwise.`);
        if (same) break;
      }
      // Customers already in Rigo.
      if (rv.action === 'create') {
        const nameMatches = existing.filter((e) => fold(e.name).trim() === fold(v.name).trim());
        for (const e of nameMatches) {
          if (v.address && !e.keys.has(key)) opt(`existing:${e.id}`, `Add a location to "${e.name}" (already in Rigo)`);
          if (sameCustomer(v, e)) {
            rv.duplicateOf = e.id;
            if (v.address && !e.keys.has(key)) { rv.action = `existing:${e.id}`; rv.info.push(`Already a customer ("${e.name}"): this address is added as a new location`); e.keys.add(key); }
            else { rv.action = 'skip'; rv.warnings.push(`Already a customer ("${e.name}")${v.address ? ' with this address' : ''}`); }
          }
        }
        if (!rv.duplicateOf && nameMatches.length) rv.warnings.push(`Same name as ${nameMatches.length === 1 ? `existing customer "${nameMatches[0].name}"` : `${nameMatches.length} existing customers`}, but the email and phone don't match. Kept as a separate customer unless you choose otherwise.`);
      }
      opt('skip', 'Skip this row');
      if (rv.action === 'create') roots.push({ index, v, keys: new Set(key ? [key] : []) });
      if (v.opening_balance && rv.action !== 'create') rv.info.push('The opening balance is only imported for a new customer');
      if (rv.errors.length) { rv.action = 'skip'; rv.options = [{ value: 'skip', label: 'Skip this row' }]; }
      out.push(rv);
    });
  } else {
    const existing = (await cc.db.query<any>(`select id, lower(name) as lname from rigo.resources where company_id = $1`, [cc.company.id])).rows;
    const names = new Map(existing.map((e) => [e.lname, e.id]));
    const seen = new Set<string>();
    imp.rows.forEach((r: Record<string, string>, index: number) => {
      const v = Object.fromEntries(Object.entries(mapping).map(([k, h]) => [k, r[h] ?? '']));
      const rv: RowReview = { index, values: v, errors: [], warnings: [], info: [], duplicateOf: null, action: 'create', options: [{ value: 'create', label: 'Create' }, { value: 'skip', label: 'Skip this row' }] };
      if (!v.name) rv.errors.push('Missing name');
      const k = resourceKind(v.kind ?? '');
      if (!k.kind) rv.errors.push(`Type "${v.kind ?? ''}" isn't a truck, equipment or unit`);
      else { if (!k.exact) rv.info.push(`Type "${v.kind}" read as ${KIND_LABELS[k.kind]}`); v.kind = k.kind; }
      if (names.has((v.name ?? '').toLowerCase())) { rv.duplicateOf = names.get(v.name.toLowerCase()); rv.warnings.push('Something with this name already exists'); rv.action = 'skip'; }
      if (seen.has((v.name ?? '').toLowerCase())) { rv.warnings.push('Listed twice in this file'); rv.action = 'skip'; }
      seen.add((v.name ?? '').toLowerCase());
      if (rv.errors.length) { rv.action = 'skip'; rv.options = [{ value: 'skip', label: 'Skip this row' }]; }
      out.push(rv);
    });
  }
  const summary = {
    total: out.length, create: out.filter((r) => r.action === 'create').length, addLocation: out.filter((r) => /^(row|existing):/.test(r.action)).length,
    skip: out.filter((r) => r.action === 'skip').length, errors: out.filter((r) => r.errors.length).length, warnings: out.filter((r) => r.warnings.length).length,
    lastFirst, openingBalances: out.filter((r) => r.values.opening_balance && r.action === 'create').length,
  };
  await cc.db.query(`update rigo.imports set mapping = $2, review = $3, status = 'reviewed' where id = $1`, [imp.id, JSON.stringify(mapping), JSON.stringify({ rows: out, summary, unmapped, notesColumns, flipNames: input.flipNames })]);
  return c.json({ summary, rows: out.slice(0, 500), unmapped, notesColumns, flipNames: input.flipNames });
});

importRoutes.post('/imports/:id/commit', async (c) => {
  const cc = c.get('cc');
  need(cc, 'imports.run');
  const input = await body(c, z.object({ confirm: z.literal(true), overrides: z.record(z.string(), z.string().max(60)).default({}) }));
  const db = cc.db;
  const imp = (await db.query<any>(`select * from rigo.imports where id = $1 and company_id = $2`, [c.req.param('id'), cc.company.id])).rows[0];
  if (!imp) throw notFound('Import');
  if (imp.status === 'committed') return c.json({ result: imp.result, already: true });
  if (imp.status !== 'reviewed' || !imp.review) throw conflict('Review the import before committing it.');
  const rows = imp.review.rows as RowReview[];
  // A choice must be one the review offered for that row.
  for (const [i, a] of Object.entries(input.overrides)) {
    const r = rows.find((x) => String(x.index) === i);
    if (!r || !(r.options ?? []).some((o) => o.value === a)) throw badRequest(`Row ${Number(i) + 2}: choose one of the offered actions.`);
  }
  const balances = rows.some((r) => r.values.opening_balance);
  if (balances && !(can(cc, 'invoices.edit') && can(cc, 'finance.view'))) throw forbidden('Only people who prepare invoices can import opening balances.');
  try {
    const result = await db.tx(async (q) => {
      // Lock the import so two commits cannot both run.
      const lock = await q.query(`update rigo.imports set status = 'committed', committed_at = now() where id = $1 and status = 'reviewed' returning id`, [imp.id]);
      if (!lock.rows.length) throw conflict('This import is already being committed.');
      const counts = { customers: 0, locations: 0, resources: 0, skipped: 0, locationsAlreadyOnFile: 0, openingBalances: 0, notes: [] as string[] };
      const created = new Map<number, string>();
      const keysFor = new Map<string, Set<string>>();
      const keys = async (custId: string) => {
        if (!keysFor.has(custId)) keysFor.set(custId, new Set((await q.query<{ address: string }>(`select address from rigo.locations where customer_id = $1`, [custId])).rows.map((l) => addressKey(l.address))));
        return keysFor.get(custId)!;
      };
      for (const r of rows) {
        const action = r.errors.length ? 'skip' : input.overrides[String(r.index)] ?? r.action;
        if (action === 'skip') { counts.skipped++; continue; }
        const v = r.values;
        if (imp.kind === 'customers') {
          let custId: string | undefined;
          if (action.startsWith('row:')) {
            custId = created.get(Number(action.slice(4)));
            if (!custId) { counts.skipped++; counts.notes.push(`Row ${r.index + 2}: row ${Number(action.slice(4)) + 2} wasn't saved, so this location wasn't added.`); continue; }
          } else if (action.startsWith('existing:')) {
            custId = (await q.query<{ id: string }>(`select id from rigo.customers where id = $1 and company_id = $2 and merged_into is null`, [action.slice(9), cc.company.id])).rows[0]?.id;
            if (!custId) { counts.skipped++; counts.notes.push(`Row ${r.index + 2}: that customer no longer exists.`); continue; }
          } else {
            const ins = await q.query<{ id: string }>(`insert into rigo.customers (company_id, name, email, phone, billing_address, notes, billing_contact) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
              [cc.company.id, v.name, v.email || null, v.phone || null, v.billing_address || null, v.notes ?? '', JSON.stringify(v.contact_name && !v.address ? { name: v.contact_name } : {})]);
            custId = ins.rows[0].id; created.set(r.index, custId); counts.customers++;
            if (v.opening_balance) {
              const minor = Math.round(Number(v.opening_balance) * 100);
              await manualInvoice(q, cc, { customerId: custId, lines: [{ description: 'Opening balance', quantity: '1', unit: '', rateE4: minor * 100, taxable: false, kind: 'charge', note: `Brought over from ${imp.file_name}` }], notes: '', taxRateBp: null, allowFree: false, clientRequestId: `import-${imp.id}-${r.index}` }, { quiet: true });
              counts.openingBalances++;
            }
          }
          if (v.address) {
            const k = await keys(custId);
            const key = addressKey(v.address);
            // The same address twice is one location, however it was written (R16-M3).
            if (k.has(key)) { counts.locationsAlreadyOnFile++; continue; }
            await q.query(`insert into rigo.locations (company_id, customer_id, address, access_instructions, site_contact) values ($1,$2,$3,$4,$5)`, [cc.company.id, custId, v.address, v.access ?? '', v.contact_name ?? '']);
            k.add(key);
            counts.locations++;
          }
        } else {
          await q.query(`insert into rigo.resources (company_id, kind, name, identifier, capacity) values ($1,$2,$3,$4,$5)`, [cc.company.id, v.kind, v.name, v.identifier ?? '', v.capacity ?? '']);
          counts.resources++;
        }
      }
      await q.query(`update rigo.imports set result = $2 where id = $1`, [imp.id, JSON.stringify(counts)]);
      await audit(q, cc, 'import.committed', { id: imp.id, customers: counts.customers, locations: counts.locations, resources: counts.resources, skipped: counts.skipped, openingBalances: counts.openingBalances });
      return counts;
    });
    return c.json({ result });
  } catch (e: any) {
    if (e?.status === 409 || e?.status === 403) throw e;
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
