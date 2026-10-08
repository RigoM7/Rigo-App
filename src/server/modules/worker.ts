import { Hono } from 'hono';
import { z } from 'zod';
import { type AppEnv, needAny, audit } from '../http/context.js';
import { body } from '../lib/util.js';
import { conflict, HttpError } from '../http/errors.js';
import { localDate, zonedToUtc, addDays } from '../../shared/schedule.js';
import { nextStages } from '../../shared/workspace.js';
import { loadFields, loadStages } from './workspaces.js';
import { shapeWork, getWork, moveWork } from './work.js';
import { visibleDefs } from '../lib/redact.js';

// The worker's phone: Today, Upcoming and Done, one next step at a time. Records made offline are
// sent with a submission id, so a retry never applies twice; only the server's acceptance counts.

export const workerRoutes = new Hono<AppEnv>();

const SELECT = `select w.*, s.key as stage_key, s.name as stage_name, s.meaning, c.name as client_name, c.phone as client_phone, c.email as client_email,
    p.label as place_label, p.address as place_address, p.notes as place_notes,
    coalesce((select json_agg(json_build_object('id', a.user_id, 'name', coalesce(m.display_name, u.name))) from rigo.work_assignees a join rigo.users u on u.id = a.user_id
       left join rigo.memberships m on m.company_id = a.company_id and m.user_id = a.user_id where a.work_id = w.id), '[]') as assignees,
    coalesce((select json_agg(json_build_object('id', e.id, 'name', e.name)) from rigo.work_equipment we join rigo.equipment e on e.id = we.equipment_id where we.work_id = w.id), '[]') as equipment
  from rigo.work_items w join rigo.stages s on s.id = w.stage_id left join rigo.clients c on c.id = w.client_id left join rigo.client_places p on p.id = w.place_id`;

workerRoutes.get('/my/work', async (c) => {
  const cc = c.get('cc');
  needAny(cc, 'work.view_assigned', 'work.view_all');
  const tz = cc.company.timezone;
  const today = localDate(new Date(), tz);
  const start = zonedToUtc(today, '00:00', tz).toISOString();
  const end = zonedToUtc(addDays(today, 1), '00:00', tz).toISOString();
  const mine = `w.company_id = $1 and exists (select 1 from rigo.work_assignees a where a.work_id = w.id and a.user_id = $2)`;
  const db = cc.db;
  const [todayRows, upcoming, done] = await Promise.all([
    // Today: anything open or started that is due today or earlier (or has no time), in order.
    db.query(`${SELECT} where ${mine} and s.meaning in ('open','active') and (w.starts_at is null or w.starts_at < $3) order by s.meaning = 'active' desc, w.starts_at nulls last, w.number`, [cc.company.id, cc.actingUserId, end]),
    db.query(`${SELECT} where ${mine} and s.meaning in ('open','active') and w.starts_at >= $3 order by w.starts_at limit 100`, [cc.company.id, cc.actingUserId, end]),
    db.query(`${SELECT} where ${mine} and s.meaning in ('finished','failed','cancelled') and w.closed_at >= now() - interval '14 days' order by w.closed_at desc limit 100`, [cc.company.id, cc.actingUserId]),
  ]);
  const { fields } = await loadFields(db, cc.company.id);
  const stages = await loadStages(db, cc.company.id);
  const shape = (w: any) => {
    const current = stages.find((s) => s.id === w.stage_id)!;
    return { ...shapeWork(cc, fields.work, w), next: nextStages(current, stages).filter((s) => s.meaning !== 'cancelled').map((s) => ({ key: s.key, name: s.name, meaning: s.meaning, requires: s.requires })) };
  };
  return c.json({
    today: todayRows.rows.map(shape), upcoming: upcoming.rows.map(shape), done: done.rows.map(shape),
    fields: visibleDefs(cc, fields.work, 'work'), date: today, from: start,
  });
});

/**
 * A record from the phone: move the work to a stage, with the fields it needs and a note. The same
 * submission id always gets the same answer, so offline retries are safe.
 */
workerRoutes.post('/my/work/:id/submit', async (c) => {
  const cc = c.get('cc');
  needAny(cc, 'work.do', 'work.edit');
  const input = await body(c, z.object({
    submissionId: z.string().min(8).max(100), baseVersion: z.number().int(), to: z.string().max(40),
    fields: z.record(z.string(), z.unknown()).default({}), note: z.string().trim().max(1000).default(''),
  }));
  const id = c.req.param('id');
  const r = await cc.db.tx(async (q) => {
    const done = (await q.query<{ result: any; work_id: string; user_id: string }>(`select result, work_id, user_id from rigo.worker_submissions where company_id = $1 and submission_id = $2`, [cc.company.id, input.submissionId])).rows[0];
    if (done) {
      if (done.work_id !== id || done.user_id !== cc.user.id) throw conflict('This record was already used for something else.');
      return { ...done.result, repeated: true };
    }
    const w = await getWork(q, cc, id, { lock: true });
    const changedSince = w.version !== input.baseVersion;
    try {
      const moved = await moveWork(q, cc, id, { to: input.to, fields: input.fields, note: input.note });
      const result = { ok: true, stage: moved.stage, changedSince };
      await q.query(`insert into rigo.worker_submissions (company_id, submission_id, work_id, user_id, result) values ($1,$2,$3,$4,$5)`, [cc.company.id, input.submissionId, id, cc.user.id, JSON.stringify(result)]);
      await audit(q, cc, 'work.submitted', { id, to: input.to, changedSince });
      return result;
    } catch (e) {
      // Explain a record the office overtook (moved or changed the work since the phone saw it).
      if (e instanceof HttpError && changedSince && (e.status === 400 || e.status === 409)) {
        throw conflict(`This changed in the office since you opened it: ${e.message}`, { changedSince: true });
      }
      throw e;
    }
  });
  return c.json(r);
});
