import { Hono } from 'hono';
import { type AppEnv, can } from '../http/context.js';
import { fold } from '../../shared/customers.js';

// Search on every screen: work by number or words, customers by name or address, and people. Each
// part is there only for those who may see it.

export const searchRoutes = new Hono<AppEnv>();

searchRoutes.get('/search', async (c) => {
  const cc = c.get('cc');
  const text = (c.req.query('q') ?? '').trim().slice(0, 80);
  if (text.length < 1) return c.json({ work: [], customers: [], people: [] });
  const like = `%${fold(text)}%`;
  const db = cc.db;
  let work: any[] = [];
  if (can(cc, 'work.view_all') || can(cc, 'work.view_assigned')) {
    const vals: unknown[] = [cc.company.id, like];
    let where = `w.company_id = $1 and (translate(lower(w.title), 'áéíóúñ', 'aeioun') like $2 or translate(lower(coalesce(c.name,'')), 'áéíóúñ', 'aeioun') like $2 or lower(coalesce(p.address,'')) like $2`;
    if (/^#?\d{1,9}$/.test(text)) { vals.push(Number(text.replace('#', ''))); where += ` or w.number = $${vals.length}`; }
    where += ')';
    if (!can(cc, 'work.view_all')) { vals.push(cc.actingUserId); where += ` and exists (select 1 from rigo.work_assignees a where a.work_id = w.id and a.user_id = $${vals.length})`; }
    work = (await db.query(`select w.id, w.number, w.title, w.starts_at, c.name as client_name, s.name as stage_name, s.meaning
        from rigo.work_items w join rigo.stages s on s.id = w.stage_id left join rigo.clients c on c.id = w.client_id left join rigo.client_places p on p.id = w.place_id
       where ${where} order by w.updated_at desc limit 8`, vals)).rows;
  }
  const customers = can(cc, 'customers.view')
    ? (await db.query(`select c.id, c.name, (select address from rigo.client_places p where p.client_id = c.id order by created_at limit 1) as address from rigo.clients c
        where c.company_id = $1 and c.archived_at is null and (translate(lower(c.name), 'áéíóúñ', 'aeioun') like $2 or exists (select 1 from rigo.client_places p where p.client_id = c.id and lower(p.address) like $2))
        order by lower(c.name) limit 8`, [cc.company.id, like])).rows
    : [];
  const people = can(cc, 'members.view')
    ? (await db.query(`select m.id, m.user_id, coalesce(m.display_name, u.name) as name, r.name as role_name from rigo.memberships m join rigo.users u on u.id = m.user_id
        join rigo.roles r on r.company_id = m.company_id and r.key = m.role_key where m.company_id = $1 and m.status = 'active' and lower(coalesce(m.display_name, u.name)) like $2 limit 6`, [cc.company.id, like])).rows
    : [];
  return c.json({ work, customers, people });
});
