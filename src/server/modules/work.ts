import { Hono } from 'hono';
import { z } from 'zod';
import type { Q } from '../db/index.js';
import { type AppEnv, type CompanyCtx, need, needAny, audit, can } from '../http/context.js';
import { body, patchSchema } from '../lib/util.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { redactValues, mergeHidden, seesContact, seesMoney, visibleDefs } from '../lib/redact.js';
import { cleanValues, moveProblem, nextStages, isClosed, wordsOf, type FieldDef, type Meaning } from '../../shared/workspace.js';
import { lineAmount, parseRate } from '../../shared/money.js';
import { zonedToUtc, addDays } from '../../shared/schedule.js';
import { loadFields, loadStages, type StageRow } from './workspaces.js';
import { notifyUsers } from './notify.js';
import { afterStageChange, afterScheduled } from './automation.js';

// The main work record (a job, appointment, order or visit, in the workspace's words): stages built
// by the owner, scheduling, assigning people and equipment, and what it charges for.

export const workRoutes = new Hono<AppEnv>();

const uuid = z.string().uuid('Choose one from the list');
const iso = z.string().datetime({ offset: true, message: 'Choose a date and time' });
const quantity = z.string().trim().regex(/^\d+(\.\d{1,4})?$/, 'Use digits, like 2 or 1.5').max(14);

export const lineSchema = z.object({
  catalogId: uuid.nullable().optional(),
  description: z.string().trim().min(1, 'Describe the line').max(200, 'Use 200 characters or fewer.'),
  quantity: quantity.default('1'),
  unit: z.string().trim().max(20).default(''),
  /** "45.00": only people who see money can set a price; others get the price list's. */
  rate: z.string().max(20).nullable().optional(),
  taxable: z.boolean().optional(),
});
type LineInput = z.infer<typeof lineSchema>;

const workSchema = z.object({
  title: z.string().trim().max(160, 'Use 160 characters or fewer.').default(''),
  clientId: uuid.nullable().optional(),
  placeId: uuid.nullable().optional(),
  stageKey: z.string().max(40).optional(),
  startsAt: iso.nullable().optional(),
  endsAt: iso.nullable().optional(),
  notes: z.string().trim().max(4000, 'Use 4,000 characters or fewer.').default(''),
  fields: z.record(z.string(), z.unknown()).default({}),
  assignees: z.array(uuid).max(20).default([]),
  equipment: z.array(uuid).max(20).default([]),
  lines: z.array(lineSchema).max(50).default([]),
});

// ---------------------------------------------------------------- reading

const SELECT = `select w.*, s.key as stage_key, s.name as stage_name, s.meaning, s.next_keys, s.requires,
    c.name as client_name, c.phone as client_phone, c.email as client_email, p.label as place_label, p.address as place_address, p.notes as place_notes,
    coalesce((select json_agg(json_build_object('id', a.user_id, 'name', coalesce(m.display_name, u.name)) order by coalesce(m.display_name, u.name))
       from rigo.work_assignees a join rigo.users u on u.id = a.user_id left join rigo.memberships m on m.company_id = a.company_id and m.user_id = a.user_id
      where a.work_id = w.id), '[]') as assignees,
    coalesce((select json_agg(json_build_object('id', e.id, 'name', e.name) order by e.name) from rigo.work_equipment we join rigo.equipment e on e.id = we.equipment_id where we.work_id = w.id), '[]') as equipment
  from rigo.work_items w join rigo.stages s on s.id = w.stage_id left join rigo.clients c on c.id = w.client_id left join rigo.client_places p on p.id = w.place_id`;

/** Whether this person may see all work, or only work assigned to them. */
function scope(cc: CompanyCtx) {
  if (can(cc, 'work.view_all')) return 'all' as const;
  if (can(cc, 'work.view_assigned')) return 'assigned' as const;
  throw forbidden(`Your role (${cc.roleName}) does not allow this.`);
}

export function shapeWork(cc: CompanyCtx, defs: FieldDef[], w: any) {
  const contact = seesContact(cc);
  return {
    id: w.id, number: w.number, title: w.title, notes: w.notes, version: w.version, source: w.source, billing: w.billing,
    startsAt: w.starts_at, endsAt: w.ends_at, createdAt: w.created_at, closedAt: w.closed_at,
    stage: { id: w.stage_id, key: w.stage_key, name: w.stage_name, meaning: w.meaning as Meaning },
    client: w.client_id ? { id: w.client_id, name: w.client_name, phone: contact ? w.client_phone : undefined, email: contact ? w.client_email : undefined } : null,
    place: w.place_id ? { id: w.place_id, label: w.place_label, address: w.place_address, notes: w.place_notes } : null,
    assignees: w.assignees as { id: string; name: string }[],
    equipment: w.equipment as { id: string; name: string }[],
    fields: redactValues(cc, visibleDefs(cc, defs, 'work'), w.fields),
  };
}

/** One work item this person may see, or 404 (another workspace's, or not assigned to a worker). */
export async function getWork(q: Q, cc: CompanyCtx, id: string, opts: { lock?: boolean } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('That item');
  const { rows } = await q.query<any>(`${SELECT} where w.id = $1 and w.company_id = $2${opts.lock ? ' for update of w' : ''}`, [id, cc.company.id]);
  const w = rows[0];
  if (!w) throw notFound('That item');
  if (scope(cc) === 'assigned' && !w.assignees.some((a: any) => a.id === cc.actingUserId)) throw notFound('That item');
  return w;
}

workRoutes.get('/work', async (c) => {
  const cc = c.get('cc');
  const sc = scope(cc);
  const vals: unknown[] = [cc.company.id];
  const where = ['w.company_id = $1'];
  const add = (sql: string, v: unknown) => { vals.push(v); where.push(sql.replace('?', `$${vals.length}`)); };
  if (sc === 'assigned') add('exists (select 1 from rigo.work_assignees a where a.work_id = w.id and a.user_id = ?)', cc.actingUserId);
  const stage = c.req.query('stage');
  if (stage) add('s.key = ?', stage);
  const meaning = c.req.query('meaning');
  if (meaning) add('s.meaning = any(?)', meaning.split(',').slice(0, 5));
  const assignee = c.req.query('assignee');
  if (assignee === 'none') where.push('not exists (select 1 from rigo.work_assignees a where a.work_id = w.id)');
  else if (assignee && /^[0-9a-f-]{36}$/i.test(assignee)) add('exists (select 1 from rigo.work_assignees a where a.work_id = w.id and a.user_id = ?)', assignee);
  const client = c.req.query('client');
  if (client && /^[0-9a-f-]{36}$/i.test(client)) add('w.client_id = ?', client);
  if (c.req.query('unscheduled') === '1') where.push('w.starts_at is null');
  const from = c.req.query('from'), to = c.req.query('to');
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) add('w.starts_at >= ?', zonedToUtc(from, '00:00', cc.company.timezone).toISOString());
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) add('w.starts_at < ?', zonedToUtc(addDays(to, 1), '00:00', cc.company.timezone).toISOString());
  const text = (c.req.query('q') ?? '').trim().slice(0, 100);
  if (text) {
    if (/^#?\d+$/.test(text)) add('w.number = ?', Number(text.replace('#', '')));
    else add(`(lower(w.title) like ? or lower(coalesce(c.name,'')) like $${vals.length + 1} or lower(coalesce(p.address,'')) like $${vals.length + 1})`, `%${text.toLowerCase()}%`);
  }
  const order = c.req.query('order') === 'recent' ? 'w.updated_at desc' : 'w.starts_at nulls last, w.number';
  const { rows } = await cc.db.query(`${SELECT} where ${where.join(' and ')} order by ${order} limit 500`, vals);
  const { fields } = await loadFields(cc.db, cc.company.id);
  return c.json({ items: rows.map((w) => shapeWork(cc, fields.work, w)) });
});

async function linesFor(q: Q, cc: CompanyCtx, workId: string) {
  const { rows } = await q.query<any>(`select id, catalog_id, description, quantity, unit, rate_e4, taxable, position from rigo.work_lines where work_id = $1 and company_id = $2 order by position`, [workId, cc.company.id]);
  const money = seesMoney(cc);
  return rows.map((l) => ({
    id: l.id, catalogId: l.catalog_id, description: l.description, quantity: l.quantity, unit: l.unit, taxable: l.taxable,
    rateE4: money ? (l.rate_e4 === null ? null : Number(l.rate_e4)) : undefined,
    amountMinor: money ? lineAmount(l.quantity, l.rate_e4 === null ? null : Number(l.rate_e4)) : undefined,
    priced: l.rate_e4 !== null,
  }));
}

workRoutes.get('/work/:id', async (c) => {
  const cc = c.get('cc');
  const w = await getWork(cc.db, cc, c.req.param('id'));
  const { fields } = await loadFields(cc.db, cc.company.id);
  const stages = await loadStages(cc.db, cc.company.id);
  const current = stages.find((s) => s.id === w.stage_id)!;
  const history = (await cc.db.query<any>(
    `select h.id, h.type, h.data, h.created_at, coalesce(m.display_name, u.name, 'Rigo') as actor from rigo.work_history h
       left join rigo.users u on u.id = h.actor_user_id left join rigo.memberships m on m.company_id = h.company_id and m.user_id = h.actor_user_id
      where h.work_id = $1 and h.company_id = $2 order by h.created_at desc limit 100`, [w.id, cc.company.id])).rows;
  const invoice = seesMoney(cc)
    ? (await cc.db.query(`select i.id, i.number, i.status from rigo.money_invoice_work x join rigo.money_invoices i on i.id = x.invoice_id where x.work_id = $1 and x.company_id = $2`, [w.id, cc.company.id])).rows[0] ?? null
    : undefined;
  return c.json({
    item: shapeWork(cc, fields.work, w), lines: await linesFor(cc.db, cc, w.id), history, invoice,
    next: allowedNext(cc, w, current, stages).map((s) => ({ key: s.key, name: s.name, meaning: s.meaning })),
  });
});

/** Stages this person may move the work to now. Workers never cancel. */
function allowedNext(cc: CompanyCtx, w: any, current: StageRow, stages: StageRow[]) {
  const list = nextStages(current, stages);
  if (can(cc, 'work.edit')) return list;
  // Workers move their own open work forward; reopening closed work is for the office.
  if (can(cc, 'work.do') && w.assignees.some((a: any) => a.id === cc.actingUserId) && !isClosed(current.meaning)) return list.filter((s) => s.meaning !== 'cancelled');
  return [];
}

// ---------------------------------------------------------------- writing

async function history(q: Q, cc: CompanyCtx, workId: string, type: string, data: unknown = {}) {
  await q.query(`insert into rigo.work_history (company_id, work_id, type, actor_user_id, data) values ($1,$2,$3,$4,$5)`, [cc.company.id, workId, type, cc.user.id, JSON.stringify(data)]);
}

/** Checks that ids from the request belong to this workspace; anything else is refused. */
async function checkRefs(q: Q, cc: CompanyCtx, input: { clientId?: string | null; placeId?: string | null; assignees?: string[]; equipment?: string[] }) {
  const words = wordsOf(cc.company.vocabulary);
  if (input.clientId) {
    const r = await q.query(`select 1 from rigo.clients where id = $1 and company_id = $2`, [input.clientId, cc.company.id]);
    if (!r.rows.length) throw badRequest(`Choose a ${words.customer.one.toLowerCase()} from this workspace.`, { fields: { clientId: `Choose a ${words.customer.one.toLowerCase()}` } });
  }
  if (input.placeId) {
    if (!input.clientId) throw badRequest(`Choose the ${words.customer.one.toLowerCase()} first.`, { fields: { placeId: `Choose the ${words.customer.one.toLowerCase()} first` } });
    const r = await q.query(`select 1 from rigo.client_places where id = $1 and client_id = $2 and company_id = $3`, [input.placeId, input.clientId, cc.company.id]);
    if (!r.rows.length) throw badRequest(`Choose one of this ${words.customer.one.toLowerCase()}'s places.`, { fields: { placeId: 'Choose a place' } });
  }
  if (input.assignees?.length) {
    const r = await q.query<{ user_id: string }>(`select user_id from rigo.memberships where company_id = $1 and status = 'active' and user_id = any($2)`, [cc.company.id, input.assignees]);
    if (r.rows.length !== new Set(input.assignees).size) throw badRequest(`Choose people from your ${words.person.many.toLowerCase()}.`, { fields: { assignees: 'Someone chosen is not in this workspace' } });
  }
  if (input.equipment?.length) {
    const r = await q.query(`select id from rigo.equipment where company_id = $1 and id = any($2)`, [cc.company.id, input.equipment]);
    if (r.rows.length !== new Set(input.equipment).size) throw badRequest(`Choose ${words.equipment.many.toLowerCase()} from this workspace.`, { fields: { equipment: 'Not found' } });
  }
}

/** Lines as stored: prices come from the price list unless someone who sees money typed one. */
async function resolveLines(q: Q, cc: CompanyCtx, lines: LineInput[], previous: any[] = []) {
  const out: { catalog_id: string | null; description: string; quantity: string; unit: string; rate_e4: number | null; taxable: boolean }[] = [];
  for (const l of lines) {
    let item: any = null;
    if (l.catalogId) {
      item = (await q.query(`select id, name, unit, rate_e4, taxable from rigo.catalog_items where id = $1 and company_id = $2`, [l.catalogId, cc.company.id])).rows[0];
      if (!item) throw badRequest('Choose an item from your price list.', { fields: { lines: 'Not in your price list' } });
    }
    let rate: number | null = item?.rate_e4 === null || item?.rate_e4 === undefined ? null : Number(item.rate_e4);
    if (seesMoney(cc) && l.rate !== undefined) {
      if (l.rate === null || l.rate === '') rate = item ? rate : null;
      else {
        const parsed = parseRate(l.rate);
        if (parsed === null) throw badRequest('Enter a price like 45 or 3.8995.', { fields: { lines: `"${l.rate}" is not a price` } });
        rate = parsed;
      }
    } else if (!seesMoney(cc) && !item) {
      // Someone who can't see prices keeps an existing line's price when editing it.
      const prev = previous.find((p) => p.description === l.description && !p.catalog_id);
      rate = prev ? (prev.rate_e4 === null ? null : Number(prev.rate_e4)) : null;
    }
    out.push({ catalog_id: item?.id ?? null, description: l.description, quantity: l.quantity, unit: l.unit || item?.unit || '', rate_e4: rate, taxable: l.taxable ?? item?.taxable ?? false });
  }
  return out;
}

async function writeLines(q: Q, cc: CompanyCtx, workId: string, lines: Awaited<ReturnType<typeof resolveLines>>) {
  await q.query(`delete from rigo.work_lines where work_id = $1 and company_id = $2`, [workId, cc.company.id]);
  let pos = 0;
  for (const l of lines) {
    await q.query(`insert into rigo.work_lines (company_id, work_id, catalog_id, description, quantity, unit, rate_e4, taxable, position) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [cc.company.id, workId, l.catalog_id, l.description, l.quantity, l.unit, l.rate_e4, l.taxable, pos++]);
  }
}

function checkTimes(startsAt?: string | null, endsAt?: string | null) {
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) throw badRequest('The end must be after the start.', { fields: { endsAt: 'Choose a later end' } });
}

function fieldProblems(problems: Record<string, string>) {
  return badRequest('Some information needs attention.', { fields: Object.fromEntries(Object.entries(problems).map(([k, v]) => [`fields.${k}`, v])) });
}

export async function createWork(q: Q, cc: CompanyCtx, input: z.infer<typeof workSchema>, opts: { source?: string } = {}) {
  checkTimes(input.startsAt, input.endsAt);
  await checkRefs(q, cc, input);
  if ((input.assignees.length || input.equipment.length) && !can(cc, 'work.assign')) throw forbidden(`Your role (${cc.roleName}) can't assign people or equipment.`);
  const { fields } = await loadFields(q, cc.company.id);
  const clean = cleanValues(fields.work, mergeHidden(cc, fields.work, {}, input.fields, 'work'));
  if (Object.keys(clean.problems).length) throw fieldProblems(clean.problems);
  const stages = await loadStages(q, cc.company.id);
  const stage = input.stageKey ? stages.find((s) => s.key === input.stageKey) : stages.find((s) => s.meaning === 'open');
  if (!stage) throw badRequest('Choose a stage.', { fields: { stageKey: 'Choose a stage' } });
  const problem = moveProblem(null, stage, clean.values, fields.work);
  if (problem) throw badRequest(problem, { fields: { stageKey: problem } });
  const n = (await q.query<{ job_seq: number }>(`update rigo.companies set job_seq = job_seq + 1 where id = $1 returning job_seq`, [cc.company.id])).rows[0].job_seq;
  const closed = isClosed(stage.meaning);
  const { rows } = await q.query<{ id: string }>(
    `insert into rigo.work_items (company_id, number, title, client_id, place_id, stage_id, starts_at, ends_at, notes, fields, source, billing, created_by, closed_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
    [cc.company.id, n, input.title, input.clientId ?? null, input.placeId ?? null, stage.id, input.startsAt ?? null, input.endsAt ?? null, input.notes,
      JSON.stringify(clean.values), opts.source ?? 'staff', stage.meaning === 'finished' ? 'ready' : 'none', cc.user.id, closed ? new Date().toISOString() : null]);
  const id = rows[0].id;
  for (const u of new Set(input.assignees)) await q.query(`insert into rigo.work_assignees (company_id, work_id, user_id) values ($1,$2,$3)`, [cc.company.id, id, u]);
  for (const e of new Set(input.equipment)) await q.query(`insert into rigo.work_equipment (company_id, work_id, equipment_id) values ($1,$2,$3)`, [cc.company.id, id, e]);
  await writeLines(q, cc, id, await resolveLines(q, cc, input.lines));
  await history(q, cc, id, 'created', { stage: stage.name });
  if (input.startsAt) await afterScheduled(q, cc, id);
  const others = input.assignees.filter((u) => u !== cc.user.id);
  if (others.length) {
    const words = wordsOf(cc.company.vocabulary);
    await notifyUsers(q, cc.company.id, others, { category: 'update', title: `New ${words.work.one.toLowerCase()} for you: #${n}${input.title ? ` ${input.title}` : ''}`, link: `work/${id}`, refType: 'work', refId: id });
  }
  return { id, number: n };
}

workRoutes.post('/work', async (c) => {
  const cc = c.get('cc');
  need(cc, 'work.create');
  const input = await body(c, workSchema);
  const r = await cc.db.tx(async (q) => {
    const made = await createWork(q, cc, input);
    await audit(q, cc, 'work.created', made);
    return made;
  });
  return c.json(r);
});

workRoutes.patch('/work/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'work.edit');
  const input = await body(c, patchSchema(workSchema.omit({ stageKey: true, assignees: true, equipment: true, lines: true })).and(z.object({ version: z.number().int() })));
  await cc.db.tx(async (q) => {
    const w = await getWork(q, cc, c.req.param('id'), { lock: true });
    if (w.version !== input.version) throw conflict('Someone else changed this. Reload to see their changes.', { stale: true });
    const clientId = input.clientId !== undefined ? input.clientId : w.client_id;
    const placeId = input.placeId !== undefined ? input.placeId : (input.clientId !== undefined && input.clientId !== w.client_id ? null : w.place_id);
    await checkRefs(q, cc, { clientId, placeId });
    const startsAt = input.startsAt !== undefined ? input.startsAt : w.starts_at;
    const endsAt = input.endsAt !== undefined ? input.endsAt : w.ends_at;
    checkTimes(startsAt, endsAt);
    const { fields } = await loadFields(q, cc.company.id);
    let values = w.fields;
    if (input.fields) {
      const clean = cleanValues(fields.work, mergeHidden(cc, fields.work, w.fields, input.fields, 'work'));
      if (Object.keys(clean.problems).length) throw fieldProblems(clean.problems);
      values = clean.values;
    }
    await q.query(`update rigo.work_items set title = $3, client_id = $4, place_id = $5, starts_at = $6, ends_at = $7, notes = $8, fields = $9, version = version + 1, updated_at = now()
                    where id = $1 and company_id = $2`,
      [w.id, cc.company.id, input.title ?? w.title, clientId, placeId, startsAt, endsAt, input.notes ?? w.notes, JSON.stringify(values)]);
    const changed = Object.keys(input).filter((k) => k !== 'version');
    const moved = (input.startsAt !== undefined && String(input.startsAt) !== String(w.starts_at ? new Date(w.starts_at).toISOString() : null));
    await history(q, cc, w.id, moved ? 'rescheduled' : 'edited', { changed, ...(moved ? { from: w.starts_at, to: input.startsAt } : {}) });
    if (moved && input.startsAt) await afterScheduled(q, cc, w.id);
    if (moved) {
      const others = (w.assignees as any[]).map((a) => a.id).filter((u) => u !== cc.user.id);
      const words = wordsOf(cc.company.vocabulary);
      if (others.length) await notifyUsers(q, cc.company.id, others, { category: 'update', title: `${words.work.one} #${w.number} moved to a new time`, link: `work/${w.id}`, refType: 'work', refId: w.id });
    }
  });
  return c.json({ ok: true });
});

/** Moves work to another stage, along the paths the owner allows, with what that stage requires. */
workRoutes.post('/work/:id/move', async (c) => {
  const cc = c.get('cc');
  needAny(cc, 'work.edit', 'work.do');
  const input = await body(c, z.object({ to: z.string().max(40), version: z.number().int().optional(), fields: z.record(z.string(), z.unknown()).optional(), note: z.string().trim().max(1000).optional() }));
  const r = await cc.db.tx((q) => moveWork(q, cc, c.req.param('id'), input));
  return c.json(r);
});

export async function moveWork(q: Q, cc: CompanyCtx, id: string, input: { to: string; version?: number; fields?: Record<string, unknown>; note?: string }) {
  const w = await getWork(q, cc, id, { lock: true });
  if (input.version !== undefined && w.version !== input.version) throw conflict('Someone else changed this. Reload to see their changes.', { stale: true });
  const stages = await loadStages(q, cc.company.id);
  const from = stages.find((s) => s.id === w.stage_id)!;
  const to = stages.find((s) => s.key === input.to);
  if (!to) throw badRequest('Choose a stage.');
  if (!allowedNext(cc, w, from, stages).some((s) => s.key === to.key) && from.key !== to.key) {
    if (!can(cc, 'work.edit') && !(can(cc, 'work.do') && w.assignees.some((a: any) => a.id === cc.actingUserId))) throw forbidden(`Your role (${cc.roleName}) can't move this.`);
    if (!can(cc, 'work.edit') && isClosed(from.meaning)) throw conflict(`This is ${from.name} now. Ask the office if it should be reopened.`);
    if (!nextStages(from, stages).some((s) => s.key === to.key)) throw badRequest(`Work in ${from.name} can't move to ${to.name}.`);
    throw forbidden(`Your role (${cc.roleName}) can't move work to ${to.name}.`);
  }
  const { fields } = await loadFields(q, cc.company.id);
  let values = w.fields;
  if (input.fields) {
    const clean = cleanValues(fields.work, mergeHidden(cc, fields.work, w.fields, { ...redactValues(cc, fields.work, w.fields), ...input.fields }, 'work'));
    if (Object.keys(clean.problems).length) throw fieldProblems(clean.problems);
    values = clean.values;
  }
  const problem = moveProblem(from, to, values, fields.work);
  if (problem) throw badRequest(problem, { missing: to.requires });
  const invoiced = (await q.query(`select 1 from rigo.money_invoice_work x join rigo.money_invoices i on i.id = x.invoice_id where x.work_id = $1 and i.status <> 'void'`, [w.id])).rows.length > 0;
  if (invoiced && to.meaning !== 'finished') throw conflict('This is on an invoice. Void the invoice first if the work was not finished.');
  const billing = invoiced ? 'invoiced' : to.meaning === 'finished' ? (w.billing === 'not_billable' ? 'not_billable' : 'ready') : 'none';
  const closed = isClosed(to.meaning);
  await q.query(`update rigo.work_items set stage_id = $3, fields = $4, billing = $5, closed_at = case when $6 then coalesce(closed_at, now()) else null end, version = version + 1, updated_at = now()
                  where id = $1 and company_id = $2`, [w.id, cc.company.id, to.id, JSON.stringify(values), billing, closed]);
  if (from.key !== to.key) await history(q, cc, w.id, 'moved', { from: from.name, to: to.name, meaning: to.meaning, note: input.note ?? '' });
  else if (input.fields) await history(q, cc, w.id, 'edited', { changed: ['fields'] });
  if (from.key !== to.key) await afterStageChange(q, cc, { workId: w.id, number: w.number, from, to });
  return { ok: true, stage: { key: to.key, name: to.name, meaning: to.meaning } };
}

workRoutes.put('/work/:id/assignees', async (c) => {
  const cc = c.get('cc');
  need(cc, 'work.assign');
  const input = await body(c, z.object({ userIds: z.array(uuid).max(20), version: z.number().int().optional() }));
  await cc.db.tx(async (q) => {
    const w = await getWork(q, cc, c.req.param('id'), { lock: true });
    if (input.version !== undefined && w.version !== input.version) throw conflict('Someone else changed this. Reload to see their changes.', { stale: true });
    await checkRefs(q, cc, { assignees: input.userIds });
    const before = (w.assignees as any[]).map((a) => a.id);
    await q.query(`delete from rigo.work_assignees where work_id = $1 and company_id = $2`, [w.id, cc.company.id]);
    for (const u of new Set(input.userIds)) await q.query(`insert into rigo.work_assignees (company_id, work_id, user_id) values ($1,$2,$3)`, [cc.company.id, w.id, u]);
    await q.query(`update rigo.work_items set version = version + 1, updated_at = now() where id = $1`, [w.id]);
    const added = input.userIds.filter((u) => !before.includes(u));
    const removed = before.filter((u) => !input.userIds.includes(u));
    await history(q, cc, w.id, 'assigned', { added, removed });
    const words = wordsOf(cc.company.vocabulary);
    const label = `${words.work.one} #${w.number}${w.title ? ` ${w.title}` : ''}`;
    if (added.length) await notifyUsers(q, cc.company.id, added.filter((u) => u !== cc.user.id), { category: 'update', title: `${label} is yours`, link: `work/${w.id}`, refType: 'work', refId: w.id });
    if (removed.length) await notifyUsers(q, cc.company.id, removed.filter((u) => u !== cc.user.id), { category: 'update', title: `${label} was given to someone else`, link: '', refType: 'work', refId: w.id });
  });
  return c.json({ ok: true });
});

workRoutes.put('/work/:id/equipment', async (c) => {
  const cc = c.get('cc');
  need(cc, 'work.assign');
  const input = await body(c, z.object({ equipmentIds: z.array(uuid).max(20) }));
  await cc.db.tx(async (q) => {
    const w = await getWork(q, cc, c.req.param('id'), { lock: true });
    await checkRefs(q, cc, { equipment: input.equipmentIds });
    await q.query(`delete from rigo.work_equipment where work_id = $1 and company_id = $2`, [w.id, cc.company.id]);
    for (const e of new Set(input.equipmentIds)) await q.query(`insert into rigo.work_equipment (company_id, work_id, equipment_id) values ($1,$2,$3)`, [cc.company.id, w.id, e]);
    await q.query(`update rigo.work_items set version = version + 1, updated_at = now() where id = $1`, [w.id]);
    await history(q, cc, w.id, 'equipment', { equipment: input.equipmentIds });
  });
  return c.json({ ok: true });
});

workRoutes.put('/work/:id/lines', async (c) => {
  const cc = c.get('cc');
  need(cc, 'work.edit');
  const input = await body(c, z.object({ lines: z.array(lineSchema).max(50) }));
  await cc.db.tx(async (q) => {
    const w = await getWork(q, cc, c.req.param('id'), { lock: true });
    if (w.billing === 'invoiced') throw conflict('This is on an invoice already. Change the invoice instead.');
    const previous = (await q.query(`select * from rigo.work_lines where work_id = $1 and company_id = $2`, [w.id, cc.company.id])).rows;
    await writeLines(q, cc, w.id, await resolveLines(q, cc, input.lines, previous));
    await q.query(`update rigo.work_items set version = version + 1, updated_at = now() where id = $1`, [w.id]);
    await history(q, cc, w.id, 'lines', { count: input.lines.length });
  });
  return c.json({ ok: true });
});

workRoutes.post('/work/:id/billing', async (c) => {
  const cc = c.get('cc');
  need(cc, 'invoices.manage');
  const input = await body(c, z.object({ billable: z.boolean() }));
  await cc.db.tx(async (q) => {
    const w = await getWork(q, cc, c.req.param('id'), { lock: true });
    if (w.billing === 'invoiced') throw conflict('This is on an invoice already.');
    const billing = input.billable ? (w.meaning === 'finished' ? 'ready' : 'none') : 'not_billable';
    await q.query(`update rigo.work_items set billing = $2, version = version + 1, updated_at = now() where id = $1`, [w.id, billing]);
    await history(q, cc, w.id, input.billable ? 'billable' : 'not_billable', {});
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- the schedule

/** Work between two dates (company time), plus the people and equipment it can be assigned to. */
workRoutes.get('/schedule', async (c) => {
  const cc = c.get('cc');
  need(cc, 'work.view_all');
  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw badRequest('Choose the dates to show.');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 62) throw badRequest('Show at most two months at a time.');
  const tz = cc.company.timezone;
  const { rows } = await cc.db.query(`${SELECT} where w.company_id = $1 and w.starts_at >= $2 and w.starts_at < $3 order by w.starts_at, w.number`,
    [cc.company.id, zonedToUtc(from, '00:00', tz).toISOString(), zonedToUtc(addDays(to, 1), '00:00', tz).toISOString()]);
  const unscheduled = (await cc.db.query(`${SELECT} where w.company_id = $1 and w.starts_at is null and s.meaning in ('open','active') order by w.number limit 100`, [cc.company.id])).rows;
  const people = (await cc.db.query(`select m.user_id as id, coalesce(m.display_name, u.name) as name, r.name as role_name, case when r.is_owner then 'office' else r.app end as app
      from rigo.memberships m join rigo.users u on u.id = m.user_id join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
     where m.company_id = $1 and m.status = 'active' order by (case when r.is_owner then 'office' else r.app end) = 'office', name`, [cc.company.id])).rows;
  const equipment = (await cc.db.query(`select id, name, status from rigo.equipment where company_id = $1 and status <> 'retired' order by name`, [cc.company.id])).rows;
  const { fields } = await loadFields(cc.db, cc.company.id);
  return c.json({ items: rows.map((w) => shapeWork(cc, fields.work, w)), unscheduled: unscheduled.map((w) => shapeWork(cc, fields.work, w)), people, equipment });
});

// ---------------------------------------------------------------- equipment

const equipmentSchema = z.object({
  name: z.string().trim().min(1, 'Name it').max(80, 'Use 80 characters or fewer.'),
  identifier: z.string().trim().max(60).default(''),
  status: z.enum(['available', 'out_of_service', 'retired']).default('available'),
  fields: z.record(z.string(), z.unknown()).default({}),
});

workRoutes.get('/equipment', async (c) => {
  const cc = c.get('cc');
  needAny(cc, 'work.view_all', 'equipment.manage');
  const { rows } = await cc.db.query<any>(`select e.*, (select count(*)::int from rigo.work_equipment we join rigo.work_items w on w.id = we.work_id join rigo.stages s on s.id = w.stage_id
      where we.equipment_id = e.id and s.meaning in ('open','active')) as open_work from rigo.equipment e where e.company_id = $1 order by e.status = 'retired', e.name`, [cc.company.id]);
  const { fields } = await loadFields(cc.db, cc.company.id);
  return c.json({ equipment: rows.map((e) => ({ id: e.id, name: e.name, identifier: e.identifier, status: e.status, openWork: e.open_work, fields: redactValues(cc, fields.equipment, e.fields) })) });
});

workRoutes.post('/equipment', async (c) => {
  const cc = c.get('cc');
  need(cc, 'equipment.manage');
  const input = await body(c, equipmentSchema);
  const { fields } = await loadFields(cc.db, cc.company.id);
  const clean = cleanValues(fields.equipment, input.fields);
  if (Object.keys(clean.problems).length) throw fieldProblems(clean.problems);
  const { rows } = await cc.db.query<{ id: string }>(`insert into rigo.equipment (company_id, name, identifier, status, fields) values ($1,$2,$3,$4,$5) returning id`,
    [cc.company.id, input.name, input.identifier, input.status, JSON.stringify(clean.values)]);
  await audit(cc.db, cc, 'equipment.created', { id: rows[0].id, name: input.name });
  return c.json({ id: rows[0].id });
});

workRoutes.patch('/equipment/:id', async (c) => {
  const cc = c.get('cc');
  need(cc, 'equipment.manage');
  const input = await body(c, patchSchema(equipmentSchema));
  const { fields } = await loadFields(cc.db, cc.company.id);
  let values: Record<string, unknown> | null = null;
  if (input.fields) {
    const clean = cleanValues(fields.equipment, input.fields);
    if (Object.keys(clean.problems).length) throw fieldProblems(clean.problems);
    values = clean.values;
  }
  const { rows } = await cc.db.query(`update rigo.equipment set name = coalesce($3, name), identifier = coalesce($4, identifier), status = coalesce($5, status), fields = coalesce($6, fields)
      where id = $1 and company_id = $2 returning id`, [c.req.param('id'), cc.company.id, input.name ?? null, input.identifier ?? null, input.status ?? null, values ? JSON.stringify(values) : null]);
  if (!rows.length) throw notFound('Equipment');
  await audit(cc.db, cc, 'equipment.updated', { id: c.req.param('id'), ...input });
  return c.json({ ok: true });
});
