import { Hono } from 'hono';
import { z } from 'zod';
import type { Q } from '../db/index.js';
import { type AppEnv, type CompanyCtx, need, can, audit } from '../http/context.js';
import { body } from '../lib/util.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';

// Duplicate customers (R5-M1, D14): archive (hidden from pickers, kept for history), delete only what
// was never used, and merge one customer into another, with everything moved recorded so the merge
// can be undone within 30 days.

export const customerMergeRoutes = new Hono<AppEnv>();

/** Owners and office (anyone who edits customers and invoices) merge customers (D14). */
function needMerge(cc: CompanyCtx) {
  if (!cc.isOwner && !(can(cc, 'customers.edit') && can(cc, 'invoices.edit'))) throw forbidden('Only owners and office staff can merge customers.');
}

async function loadCustomer(q: Q, cc: CompanyCtx, id: string, lock = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Customer');
  const r = (await q.query<any>(`select * from rigo.customers where id = $1 and company_id = $2${lock ? ' for update' : ''}`, [id, cc.company.id])).rows[0];
  if (!r) throw notFound('Customer');
  return r;
}

/** Records that belong to a customer and move with a merge. */
const MOVES: { table: string; column: string }[] = [
  { table: 'locations', column: 'customer_id' }, { table: 'jobs', column: 'customer_id' }, { table: 'jobs', column: 'bill_to_customer_id' },
  { table: 'invoices', column: 'customer_id' }, { table: 'messages', column: 'customer_id' }, { table: 'payments', column: 'customer_id' },
  { table: 'credit_entries', column: 'customer_id' }, { table: 'recurring_plans', column: 'customer_id' },
];

customerMergeRoutes.post('/customers/:id/archive', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.edit');
  await cc.db.tx(async (q) => {
    const cu = await loadCustomer(q, cc, c.req.param('id'), true);
    // Open work at their address, or open work they pay for (a bill-to customer).
    const open = (await q.query<{ n: number }>(`select count(*)::int n from rigo.jobs where company_id = $2 and (customer_id = $1 or bill_to_customer_id = $1) and status in ('draft','open','in_progress')`, [cu.id, cc.company.id])).rows[0].n;
    if (open) throw conflict(`${cu.name} has ${open} open job${open === 1 ? '' : 's'}. Finish or cancel ${open === 1 ? 'it' : 'them'} before archiving.`);
    await q.query(`update rigo.customers set archived_at = now(), updated_at = now() where id = $1`, [cu.id]);
    await audit(q, cc, 'customer.archived', { id: cu.id, name: cu.name });
  });
  return c.json({ ok: true });
});

customerMergeRoutes.post('/customers/:id/unarchive', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.edit');
  await cc.db.tx(async (q) => {
    const cu = await loadCustomer(q, cc, c.req.param('id'), true);
    if (cu.merged_into) throw conflict('This customer was merged into another. Undo the merge instead.');
    await q.query(`update rigo.customers set archived_at = null, updated_at = now() where id = $1`, [cu.id]);
    await audit(q, cc, 'customer.unarchived', { id: cu.id, name: cu.name });
  });
  return c.json({ ok: true });
});

/** Only a customer with no jobs, invoices, plans, messages or payments can be deleted. */
customerMergeRoutes.delete('/customers/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'customers.edit');
  await cc.db.tx(async (q) => {
    const cu = await loadCustomer(q, cc, c.req.param('id'), true);
    for (const m of MOVES.filter((x) => x.table !== 'locations')) {
      const used = (await q.query(`select 1 from rigo.${m.table} where ${m.column} = $1 limit 1`, [cu.id])).rows.length;
      if (used) throw conflict(`${cu.name} has history (jobs, invoices or messages), so it is kept. Archive it instead.`);
    }
    if ((await q.query(`select 1 from rigo.customer_merges where survivor_id = $1 or merged_id = $1 limit 1`, [cu.id])).rows.length) throw conflict(`${cu.name} is part of a merge, so it is kept. Archive it instead.`);
    await q.query(`delete from rigo.locations where customer_id = $1`, [cu.id]);
    await q.query(`delete from rigo.customers where id = $1`, [cu.id]);
    await audit(q, cc, 'customer.deleted', { id: cu.id, name: cu.name });
  });
  return c.json({ ok: true });
});

/**
 * Merge `mergedId` into `:id` (the one kept). Its locations, jobs, invoices, messages, payments,
 * credit and plans move to the kept customer; blanks on the kept customer are filled from the other;
 * the merged customer is archived and points to the kept one. Issued invoices keep their printed
 * names (their snapshot) and their history.
 */
customerMergeRoutes.post('/customers/:id/merge', async (c) => {
  const cc = c.get('cc');
  needMerge(cc);
  const input = await body(c, z.object({ mergedId: z.string().uuid() }));
  if (input.mergedId === c.req.param('id')) throw badRequest('Choose a different customer to merge.');
  const out = await cc.db.tx(async (q) => {
    const keep = await loadCustomer(q, cc, c.req.param('id'), true);
    const gone = await loadCustomer(q, cc, input.mergedId, true);
    if (keep.archived_at || gone.archived_at) throw conflict('Archived customers can\'t be merged. Restore them first.');
    const moved: Record<string, string[]> = {};
    for (const m of MOVES) {
      const r = await q.query<{ id: string }>(`update rigo.${m.table} set ${m.column} = $1 where ${m.column} = $2 and company_id = $3 returning id`, [keep.id, gone.id, cc.company.id]);
      if (r.rows.length) moved[`${m.table}.${m.column}`] = r.rows.map((x) => x.id);
    }
    // Statements are dated documents: they move unless the kept customer already has one that day.
    const st = await q.query<{ id: string }>(`update rigo.statements s set customer_id = $1 where s.customer_id = $2 and s.company_id = $3
        and not exists (select 1 from rigo.statements x where x.customer_id = $1 and x.statement_date = s.statement_date) returning id`, [keep.id, gone.id, cc.company.id]);
    if (st.rows.length) moved['statements.customer_id'] = st.rows.map((x) => x.id);
    // Blanks on the kept customer are filled from the merged one (and emptied again on undo).
    const filled: Record<string, string> = {};
    for (const col of ['email', 'phone', 'billing_address'] as const) if (!keep[col] && gone[col]) filled[col] = gone[col];
    if (!keep.notes && gone.notes) filled.notes = gone.notes;
    for (const [col, v] of Object.entries(filled)) await q.query(`update rigo.customers set ${col} = $2 where id = $1`, [keep.id, v]);
    await q.query(`update rigo.customers set version = version + 1, updated_at = now() where id = $1`, [keep.id]);
    await q.query(`update rigo.customers set archived_at = now(), merged_into = $2, updated_at = now() where id = $1`, [gone.id, keep.id]);
    const m = await q.query<{ id: string }>(`insert into rigo.customer_merges (company_id, survivor_id, merged_id, moved, filled, merged_by) values ($1,$2,$3,$4,$5,$6) returning id`,
      [cc.company.id, keep.id, gone.id, JSON.stringify(moved), JSON.stringify(filled), cc.user.id]);
    await audit(q, cc, 'customer.merged', { kept: keep.id, keptName: keep.name, merged: gone.id, mergedName: gone.name, mergeId: m.rows[0].id, moved: Object.fromEntries(Object.entries(moved).map(([k, v]) => [k, v.length])) });
    return { mergeId: m.rows[0].id, moved: Object.fromEntries(Object.entries(moved).map(([k, v]) => [k, v.length])) };
  });
  return c.json(out);
});

/** Undo a merge within 30 days: exactly what moved goes back, and the merged customer is restored. */
customerMergeRoutes.post('/customer-merges/:id/undo', async (c) => {
  const cc = c.get('cc');
  needMerge(cc);
  await cc.db.tx(async (q) => {
    if (!/^[0-9a-f-]{36}$/i.test(c.req.param('id'))) throw notFound('Merge');
    const m = (await q.query<any>(`select *, created_at > now() - interval '30 days' as recent from rigo.customer_merges where id = $1 and company_id = $2 for update`, [c.req.param('id'), cc.company.id])).rows[0];
    if (!m) throw notFound('Merge');
    if (m.undone_at) throw conflict('This merge was already undone.');
    if (!m.recent) throw conflict('Merges can be undone for 30 days. This one is older.');
    // The records moved on with a later merge: undo that one first, or nothing would come back.
    const kept = (await q.query<any>(`select name, merged_into from rigo.customers where id = $1`, [m.survivor_id])).rows[0];
    if (kept?.merged_into) throw conflict(`${kept.name} was merged into another customer since. Undo that merge first.`);
    for (const [key, ids] of Object.entries(m.moved as Record<string, string[]>)) {
      const [table, column] = key.split('.');
      if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column)) continue;
      await q.query(`update rigo.${table} set ${column} = $1 where id = any($2) and ${column} = $3 and company_id = $4`, [m.merged_id, ids, m.survivor_id, cc.company.id]);
    }
    for (const [col, v] of Object.entries(m.filled as Record<string, string>)) {
      if (!['email', 'phone', 'billing_address', 'notes'].includes(col)) continue;
      await q.query(`update rigo.customers set ${col} = case when ${col} = $2 then ${col === 'notes' ? "''" : 'null'} else ${col} end where id = $1`, [m.survivor_id, v]);
    }
    await q.query(`update rigo.customers set archived_at = null, merged_into = null, updated_at = now() where id = $1`, [m.merged_id]);
    await q.query(`update rigo.customers set version = version + 1, updated_at = now() where id = $1`, [m.survivor_id]);
    await q.query(`update rigo.customer_merges set undone_at = now(), undone_by = $2 where id = $1`, [m.id, cc.user.id]);
    await audit(q, cc, 'customer.merge_undone', { mergeId: m.id, kept: m.survivor_id, restored: m.merged_id });
  });
  return c.json({ ok: true });
});
