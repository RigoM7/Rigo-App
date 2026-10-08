import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { getDb, type Q } from '../db/index.js';
import { type AppEnv, type CompanyCtx, need, audit, can } from '../http/context.js';
import { body, normEmail, sha256 } from '../lib/util.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { clientIp, limitCalls, recordCall } from './accounts.js';
import { businessHoursSchema } from '../../shared/hours.js';
import { wordsOf } from '../../shared/workspace.js';
import { bookingSlots, SLUG_RE, RESERVED_SLUGS } from '../../shared/booking.js';
import { localDate, addDays } from '../../shared/schedule.js';
import { createWork } from './work.js';
import { notifyPermission, resolveNotices } from './notify.js';

// Public booking and request pages. Anyone can ask for work or pick a time; nothing is booked until a
// person accepts it in the inbox (Assisted). Requests never see prices, people or other customers.

export const bookingPublic = new Hono<AppEnv>();
export const bookingRoutes = new Hono<AppEnv>();

const pageSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(SLUG_RE, 'Use 3 to 40 lower-case letters, numbers and dashes'),
  enabled: z.boolean(),
  mode: z.enum(['request', 'book']),
  headline: z.string().trim().max(120).default(''),
  intro: z.string().trim().max(600).default(''),
  catalogIds: z.array(z.string().uuid()).max(30).default([]),
  hours: businessHoursSchema.nullable().default(null),
  slotMinutes: z.number().int().min(15).max(480).default(60),
});

async function pageOf(q: Q, companyId: string) {
  return (await q.query<any>(`select * from rigo.booking_pages where company_id = $1`, [companyId])).rows[0] ?? null;
}

bookingRoutes.get('/booking', async (c) => {
  const cc = c.get('cc');
  need(cc, 'requests.manage');
  const p = await pageOf(cc.db, cc.company.id);
  const suggested = cc.company.name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).padEnd(3, '-x');
  return c.json({ page: p ? { slug: p.slug, enabled: p.enabled, mode: p.mode, headline: p.headline, intro: p.intro, catalogIds: p.catalog_ids, hours: p.hours, slotMinutes: p.slot_minutes } : null, suggestedSlug: suggested });
});

bookingRoutes.put('/booking', async (c) => {
  const cc = c.get('cc');
  need(cc, 'requests.manage');
  const input = await body(c, pageSchema);
  if (RESERVED_SLUGS.includes(input.slug)) throw badRequest('That address is taken. Choose another.', { fields: { slug: 'Taken' } });
  if (input.mode === 'book' && !input.hours) throw badRequest('Set the days and times people can book.', { fields: { hours: 'Set your hours' } });
  await cc.db.tx(async (q) => {
    const taken = (await q.query(`select 1 from rigo.booking_pages where slug = $1 and company_id <> $2`, [input.slug, cc.company.id])).rows.length;
    if (taken) throw conflict('That address is taken. Choose another.', { fields: { slug: 'Taken' } });
    if (input.catalogIds.length) {
      const ok = (await q.query<{ n: number }>(`select count(*)::int n from rigo.catalog_items where company_id = $1 and id = any($2)`, [cc.company.id, input.catalogIds])).rows[0].n;
      if (ok !== new Set(input.catalogIds).size) throw badRequest('Choose items from your price list.');
    }
    await q.query(`insert into rigo.booking_pages (company_id, slug, enabled, mode, headline, intro, catalog_ids, hours, slot_minutes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                   on conflict (company_id) do update set slug = excluded.slug, enabled = excluded.enabled, mode = excluded.mode, headline = excluded.headline, intro = excluded.intro,
                   catalog_ids = excluded.catalog_ids, hours = excluded.hours, slot_minutes = excluded.slot_minutes, updated_at = now()`,
      [cc.company.id, input.slug, input.enabled, input.mode, input.headline, input.intro, input.catalogIds, input.hours ? JSON.stringify(input.hours) : null, input.slotMinutes]);
    await audit(q, cc, 'booking.updated', { slug: input.slug, enabled: input.enabled, mode: input.mode });
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- the public page

async function publicPage(slug: string) {
  const db = await getDb();
  if (!SLUG_RE.test(slug)) throw notFound('Page');
  const p = (await db.query<any>(`select b.*, c.name as company_name, c.timezone, c.vocabulary, c.kind, c.archived_at from rigo.booking_pages b join rigo.companies c on c.id = b.company_id where b.slug = $1`, [slug])).rows[0];
  if (!p || !p.enabled || p.archived_at) throw notFound('Page');
  return { db, p };
}

/** Times still free: within the page's hours, after today, where fewer jobs start than people can do them. */
async function freeSlots(q: Q, p: any) {
  if (p.mode !== 'book' || !p.hours) return [];
  const from = addDays(localDate(new Date(), p.timezone), 1);
  const capacity = Math.max(1, (await q.query<{ n: number }>(`select count(*)::int n from rigo.memberships m join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key
      where m.company_id = $1 and m.status = 'active' and r.app = 'worker' and not r.is_owner`, [p.company_id])).rows[0].n);
  const taken = (await q.query<{ starts_at: string; ends_at: string | null }>(`select w.starts_at, w.ends_at from rigo.work_items w join rigo.stages s on s.id = w.stage_id
      where w.company_id = $1 and s.meaning in ('open','active') and w.starts_at >= now() and w.starts_at < now() + interval '15 days'`, [p.company_id])).rows;
  return bookingSlots({ from, days: 14, hours: p.hours, slotMinutes: p.slot_minutes, timeZone: p.timezone, capacity, taken: taken.map((t) => ({ start: new Date(t.starts_at).toISOString(), end: t.ends_at ? new Date(t.ends_at).toISOString() : null })) });
}

bookingPublic.get('/public/:slug', async (c) => {
  const { db, p } = await publicPage(c.req.param('slug'));
  const items = p.catalog_ids.length ? (await db.query(`select id, name from rigo.catalog_items where company_id = $1 and id = any($2) and active order by position, name`, [p.company_id, p.catalog_ids])).rows : [];
  const words = wordsOf(p.vocabulary);
  return c.json({
    name: p.company_name, demo: p.kind === 'demo', mode: p.mode, headline: p.headline, intro: p.intro, items, timezone: p.timezone,
    work: words.work, slots: await freeSlots(db, p), slotMinutes: p.slot_minutes,
  });
});

const requestSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(80, 'Use 80 characters or fewer.'),
  email: z.string().trim().max(254).email('Enter a valid email address.').or(z.literal('')).default(''),
  phone: z.string().trim().max(40).default(''),
  address: z.string().trim().max(300).default(''),
  message: z.string().trim().max(2000, 'Use 2,000 characters or fewer.').default(''),
  catalogId: z.string().uuid().nullable().optional(),
  preferredAt: z.string().datetime({ offset: true }).nullable().optional(),
  /** Left empty by people; filled by bots. */
  website: z.string().max(200).optional(),
});

bookingPublic.post('/public/:slug/requests', async (c) => {
  const { db, p } = await publicPage(c.req.param('slug'));
  const input = await body(c, requestSchema);
  if (!input.email && !input.phone) throw badRequest('Leave an email address or a phone number so they can answer you.', { fields: { email: 'Add an email or a phone number' } });
  if (input.website) return c.json({ ok: true }); // a bot: say thanks and keep nothing
  const ip = clientIp(c as Context<AppEnv>);
  await limitCalls(db, `request:${ip}`, 10, 60, 'requests');
  await limitCalls(db, `request-co:${p.company_id}`, 200, 24 * 60, 'requests to this business today');
  let catalog: any = null;
  if (input.catalogId) {
    catalog = (await db.query(`select id, name from rigo.catalog_items where id = $1 and company_id = $2 and id = any($3)`, [input.catalogId, p.company_id, p.catalog_ids])).rows[0];
    if (!catalog) throw badRequest('Choose one of the options.', { fields: { catalogId: 'Choose one of the options' } });
  }
  if (p.mode === 'book') {
    if (!input.preferredAt) throw badRequest('Choose a time.', { fields: { preferredAt: 'Choose a time' } });
    const free = await freeSlots(db, p);
    if (!free.includes(new Date(input.preferredAt).toISOString())) throw conflict('That time was just taken. Choose another.', { fields: { preferredAt: 'Choose another time' } });
  }
  await db.tx(async (q) => {
    const { rows } = await q.query<{ id: string }>(
      `insert into rigo.requests (company_id, name, email, phone, address, message, wanted, catalog_id, preferred_at, sender_key) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [p.company_id, input.name, input.email ? normEmail(input.email) : null, input.phone || null, input.address, input.message, catalog?.name ?? '', catalog?.id ?? null, input.preferredAt ?? null, sha256(ip).slice(0, 16)]);
    await recordCall(q, `request:${ip}`);
    await recordCall(q, `request-co:${p.company_id}`);
    await notifyPermission(q, p.company_id, 'requests.manage', { category: 'needs_action', title: `New request from ${input.name}`, body: [catalog?.name, input.message].filter(Boolean).join(' · ').slice(0, 300), link: 'inbox', refType: 'request', refId: rows[0].id });
  });
  return c.json({ ok: true, when: p.mode === 'book' ? input.preferredAt : null });
});

// ---------------------------------------------------------------- deciding requests

async function getRequest(q: Q, cc: CompanyCtx, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Request');
  const r = (await q.query<any>(`select * from rigo.requests where id = $1 and company_id = $2 for update`, [id, cc.company.id])).rows[0];
  if (!r) throw notFound('Request');
  if (r.status !== 'new') throw conflict('Someone already answered this request.');
  return r;
}

/** Accepts a request: the customer (matched by email or phone, or new) and the work, at the time asked for. */
bookingRoutes.post('/requests/:id/accept', async (c) => {
  const cc = c.get('cc');
  need(cc, 'requests.manage');
  need(cc, 'customers.edit');
  need(cc, 'work.create');
  const input = await body(c, z.object({ clientId: z.string().uuid().nullable().optional() }));
  const r = await cc.db.tx(async (q) => {
    const req = await getRequest(q, cc, c.req.param('id'));
    let clientId = input.clientId ?? null;
    if (clientId && !(await q.query(`select 1 from rigo.clients where id = $1 and company_id = $2`, [clientId, cc.company.id])).rows.length) throw badRequest('Choose a customer from this workspace.');
    if (!clientId) {
      const match = (await q.query<{ id: string }>(`select id from rigo.clients where company_id = $1 and archived_at is null and ((email is not null and lower(email) = $2) or (phone is not null and regexp_replace(phone, '[^0-9]', '', 'g') = $3 and length($3) >= 7)) limit 1`,
        [cc.company.id, req.email ?? '', (req.phone ?? '').replace(/\D/g, '')])).rows[0];
      clientId = match?.id ?? (await q.query<{ id: string }>(`insert into rigo.clients (company_id, name, email, phone, notes, created_by) values ($1,$2,$3,$4,'From the booking page.',$5) returning id`,
        [cc.company.id, req.name, req.email, req.phone, cc.user.id])).rows[0].id;
    }
    let placeId: string | null = null;
    if (req.address) {
      placeId = (await q.query<{ id: string }>(`select id from rigo.client_places where client_id = $1 and lower(address) = lower($2) limit 1`, [clientId, req.address])).rows[0]?.id
        ?? (await q.query<{ id: string }>(`insert into rigo.client_places (company_id, client_id, address) values ($1,$2,$3) returning id`, [cc.company.id, clientId, req.address])).rows[0].id;
    }
    const page = await pageOf(q, cc.company.id);
    const ends = req.preferred_at ? new Date(new Date(req.preferred_at).getTime() + (page?.slot_minutes ?? 60) * 60000).toISOString() : null;
    const made = await createWork(q, cc, {
      title: req.wanted || 'Request', clientId, placeId, notes: req.message, startsAt: req.preferred_at ? new Date(req.preferred_at).toISOString() : null, endsAt: ends,
      fields: {}, assignees: [], equipment: [], lines: req.catalog_id ? [{ catalogId: req.catalog_id, description: req.wanted, quantity: '1', unit: '' }] : [],
    }, { source: page?.mode === 'book' ? 'booking' : 'request' });
    await q.query(`update rigo.requests set status = 'accepted', work_id = $2, client_id = $3, decided_by = $4, decided_at = now() where id = $1`, [req.id, made.id, clientId, cc.user.id]);
    await resolveNotices(q, cc.company.id, 'request', req.id);
    await audit(q, cc, 'booking.request_accepted', { id: req.id, work: made.id });
    return { workId: made.id, number: made.number, clientId };
  });
  return c.json(r);
});

bookingRoutes.post('/requests/:id/decline', async (c) => {
  const cc = c.get('cc');
  need(cc, 'requests.manage');
  await cc.db.tx(async (q) => {
    const req = await getRequest(q, cc, c.req.param('id'));
    await q.query(`update rigo.requests set status = 'declined', decided_by = $2, decided_at = now() where id = $1`, [req.id, cc.user.id]);
    await resolveNotices(q, cc.company.id, 'request', req.id);
    await audit(q, cc, 'booking.request_declined', { id: req.id });
  });
  return c.json({ ok: true });
});

bookingRoutes.get('/requests', async (c) => {
  const cc = c.get('cc');
  need(cc, 'requests.manage');
  const contact = can(cc, 'customers.contact');
  const { rows } = await cc.db.query<any>(`select * from rigo.requests where company_id = $1 order by created_at desc limit 100`, [cc.company.id]);
  return c.json({ requests: rows.map((r) => ({ id: r.id, name: r.name, email: contact ? r.email : undefined, phone: contact ? r.phone : undefined, address: r.address, message: r.message, wanted: r.wanted, preferredAt: r.preferred_at, status: r.status, workId: r.work_id, createdAt: r.created_at })) });
});
