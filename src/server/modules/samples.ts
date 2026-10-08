import type { Q } from '../db/index.js';
import type { CompanyCtx } from '../http/context.js';
import { SAMPLES } from '../../shared/samples.js';
import { parseRate } from '../../shared/money.js';
import { localDate, addDays, zonedToUtc } from '../../shared/schedule.js';
import { createWork, moveWork } from './work.js';
import { loadStages } from './workspaces.js';

// Fills a demo with its template's sample data through the same paths people use, so the demo shows
// real behaviour: invoices Rigo prepared waiting for approval, a held invoice, confirmations to send.
// Only ever called for demo workspaces (the route checks); demos never reach a provider.

export async function fillSampleData(q: Q, cc: CompanyCtx) {
  const set = SAMPLES[cc.company.template_key ?? 'general'] ?? SAMPLES.general;
  const tz = cc.company.timezone;
  const today = localDate(new Date(), tz);
  for (const [name, rate] of Object.entries(set.prices)) {
    await q.query(`update rigo.catalog_items set rate_e4 = $3 where company_id = $1 and name = $2`, [cc.company.id, name, parseRate(rate)]);
  }
  await q.query(`update rigo.companies set tax_rate_bp = 700 where id = $1`, [cc.company.id]);
  const clients: { id: string; place: string }[] = [];
  for (const c of set.customers) {
    const id = (await q.query<{ id: string }>(`insert into rigo.clients (company_id, name, email, phone, notes, created_by) values ($1,$2,$3,$4,'Sample customer (fictional).',$5) returning id`,
      [cc.company.id, c.name, c.email, c.phone, cc.user.id])).rows[0].id;
    const place = (await q.query<{ id: string }>(`insert into rigo.client_places (company_id, client_id, label, address) values ($1,$2,'Main',$3) returning id`, [cc.company.id, id, c.address])).rows[0].id;
    clients.push({ id, place });
  }
  const equipment: string[] = [];
  const eqOn = (await q.query<{ enabled: boolean }>(`select enabled from rigo.record_types where company_id = $1 and kind = 'equipment'`, [cc.company.id])).rows[0]?.enabled;
  if (eqOn) for (const name of set.equipment) equipment.push((await q.query<{ id: string }>(`insert into rigo.equipment (company_id, name) values ($1,$2) returning id`, [cc.company.id, name])).rows[0].id);
  const workers = (await q.query<{ user_id: string }>(`select m.user_id from rigo.memberships m join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
      where m.company_id = $1 and m.status = 'active' and r.app = 'worker' and not r.is_owner order by m.created_at`, [cc.company.id])).rows.map((r) => r.user_id);
  const catalog = (await q.query<{ id: string; name: string }>(`select id, name from rigo.catalog_items where company_id = $1`, [cc.company.id])).rows;
  const stages = await loadStages(q, cc.company.id);
  const stageFor = (m: string) => stages.find((s) => s.meaning === m)!;
  let i = 0;
  for (const w of set.work) {
    const day = addDays(today, w.day);
    const starts = zonedToUtc(day, `${String(w.hour).padStart(2, '0')}:00`, tz);
    const item = catalog.find((x) => x.name === w.item);
    const made = await createWork(q, cc, {
      title: w.title ?? w.item, clientId: clients[w.c].id, placeId: clients[w.c].place, notes: '', fields: {},
      startsAt: starts.toISOString(), endsAt: new Date(starts.getTime() + (w.minutes ?? 90) * 60000).toISOString(),
      assignees: workers.length ? [workers[i % workers.length]] : [], equipment: equipment.length ? [equipment[i % equipment.length]] : [],
      lines: item ? [{ catalogId: item.id, description: item.name, quantity: w.qty, unit: '' }] : [],
      stageKey: stageFor('open').key,
    }, { source: 'sample' });
    if (w.meaning !== 'open') {
      if (w.meaning === 'finished' || w.meaning === 'failed') await moveWork(q, cc, made.id, { to: stageFor('active').key });
      await moveWork(q, cc, made.id, { to: stageFor(w.meaning).key });
    }
    i++;
  }
  // One invoice Rigo prepared is approved, issued and part paid, so Money shows what is owed.
  const first = (await q.query<{ id: string; total_minor: number }>(`select id, total_minor from rigo.money_invoices where company_id = $1 and status = 'draft' order by created_at limit 1`, [cc.company.id])).rows[0];
  if (first) {
    const { issueInvoice } = await import('./billing.js');
    await q.query(`update rigo.money_invoices set status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [first.id, cc.user.id]);
    await q.query(`update rigo.auto_actions set status = 'approved', decided_by = $2, decided_at = now() where subject_id = $1`, [first.id, cc.user.id]);
    await issueInvoice(q, cc, first.id);
    const part = Math.floor(Number(first.total_minor) / 2);
    if (part > 0) {
      await q.query(`insert into rigo.money_payments (company_id, invoice_id, client_id, amount_minor, method, reference, received_on, recorded_by)
                     select company_id, id, client_id, $2, 'check', 'Sample check 1042', $3, $4 from rigo.money_invoices where id = $1`, [first.id, part, today, cc.user.id]);
      await q.query(`update rigo.money_invoices set paid_minor = $2, payment_status = 'partially_paid' where id = $1`, [first.id, part]);
    }
  }
}
