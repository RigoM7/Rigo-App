import { describe, it, expect } from 'vitest';
import { getDb } from './helpers.js';
import { team } from './fixtures/team.js';

// Step 5: the worker's phone. Today / Upcoming / Done, one action at a time; records sent from the
// phone apply once, however many times a weak signal makes it retry.

const today = (h: number) => { const d = new Date(); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };

describe('worker lists', () => {
  it('shows only the worker’s own work, split into Today, Upcoming and Done', async () => {
    const t = await team();
    const c = (await t.dana.post(`/c/${t.cid}/customers`, { name: 'Acme', phone: '(555) 201-0001', place: { address: '12 Barn Rd', notes: 'Gate code 4411' } })).body.id;
    const place = (await t.dana.get(`/c/${t.cid}/customers/${c}`)).body.places[0].id;
    const a = (await t.marcus.post(`/c/${t.cid}/work`, { title: 'Now', clientId: c, placeId: place, startsAt: new Date(Date.now() - 3600_000).toISOString(), assignees: [t.ids.luis] })).body;
    await t.marcus.post(`/c/${t.cid}/work`, { title: 'Later', startsAt: new Date(Date.now() + 5 * 86400_000).toISOString(), assignees: [t.ids.luis] });
    await t.marcus.post(`/c/${t.cid}/work`, { title: 'Sam’s', startsAt: today(15), assignees: [t.ids.sam] });
    const done = (await t.marcus.post(`/c/${t.cid}/work`, { title: 'Finished', assignees: [t.ids.luis] })).body;
    await t.marcus.post(`/c/${t.cid}/work/${done.id}/move`, { to: 'done' });
    const r = (await t.luis.get(`/c/${t.cid}/my/work`)).body;
    expect(r.today.map((w: any) => w.title)).toEqual(['Now']);
    expect(r.upcoming.map((w: any) => w.title)).toEqual(['Later']);
    expect(r.done.map((w: any) => w.title)).toEqual(['Finished']);
    // The address and access notes first; the next steps never include Cancel.
    expect(r.today[0].place).toMatchObject({ address: '12 Barn Rd', notes: 'Gate code 4411' });
    expect(r.today[0].next.map((s: any) => s.meaning)).not.toContain('cancelled');
    // Drivers in this template see no customer phone numbers.
    expect(r.today[0].client).not.toHaveProperty('phone');
    expect(JSON.stringify(r)).not.toContain('201-0001');
    expect(r.fields.every((f: any) => f.forWorkers)).toBe(true);
    expect(a.number).toBe(1);
  });
});

describe('records sent from the phone', () => {
  it('applies a submission once, however many times it is sent', async () => {
    const t = await team();
    const w = (await t.marcus.post(`/c/${t.cid}/work`, { title: 'Fuel', assignees: [t.ids.luis] })).body;
    const v = (await t.luis.get(`/c/${t.cid}/work/${w.id}`)).body.item.version;
    const send = () => t.luis.post(`/c/${t.cid}/my/work/${w.id}/submit`, { submissionId: 'sub-abc-123', baseVersion: v, to: 'in_progress', fields: {}, note: '' });
    const [x, y] = [await send(), await send()];
    expect(x.status).toBe(200);
    expect(y.status).toBe(200);
    expect(y.body.repeated).toBe(true);
    const h = (await t.dana.get(`/c/${t.cid}/work/${w.id}`)).body.history.filter((e: any) => e.type === 'moved');
    expect(h).toHaveLength(1);
    // The same id can't be reused for other work or by someone else.
    const other = (await t.marcus.post(`/c/${t.cid}/work`, { title: 'Other', assignees: [t.ids.luis] })).body;
    expect((await t.luis.post(`/c/${t.cid}/my/work/${other.id}/submit`, { submissionId: 'sub-abc-123', baseVersion: 1, to: 'in_progress' })).status).toBe(409);
  });

  it('fills what the stage needs, and explains when the office changed the work meanwhile', async () => {
    const t = await team();
    const boot = (await t.dana.get(`/c/${t.cid}`)).body;
    await t.dana.put(`/c/${t.cid}/stages`, { stages: boot.stages.map((s: any) => ({ key: s.key, name: s.name, meaning: s.meaning, ...(s.key === 'done' ? { requires: ['quantity'] } : {}) })) });
    const w = (await t.marcus.post(`/c/${t.cid}/work`, { title: 'Fuel', assignees: [t.ids.luis] })).body;
    const missing = await t.luis.post(`/c/${t.cid}/my/work/${w.id}/submit`, { submissionId: 'sub-need-1', baseVersion: 1, to: 'done' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toBe('Fill in Quantity delivered before moving to Done.');
    const ok = await t.luis.post(`/c/${t.cid}/my/work/${w.id}/submit`, { submissionId: 'sub-need-2', baseVersion: 1, to: 'done', fields: { quantity: '187.4' }, note: 'Tank was low' });
    expect(ok.status).toBe(200);
    expect((await t.dana.get(`/c/${t.cid}/work/${w.id}`)).body.item.fields.quantity).toBe('187.4');
    // The office cancels a job while the phone is offline; the phone's record is refused, with why.
    const w2 = (await t.marcus.post(`/c/${t.cid}/work`, { title: 'Second', assignees: [t.ids.luis] })).body;
    await t.marcus.post(`/c/${t.cid}/work/${w2.id}/move`, { to: 'cancelled' });
    const late = await t.luis.post(`/c/${t.cid}/my/work/${w2.id}/submit`, { submissionId: 'sub-late-1', baseVersion: 1, to: 'in_progress' });
    expect(late.status).toBe(409);
    expect(late.body.error.message).toBe('This changed in the office since you opened it: This is Cancelled now. Ask the office if it should be reopened.');
    const db = await getDb();
    expect((await db.query(`select count(*)::int n from rigo.worker_submissions where submission_id = 'sub-late-1'`)).rows[0].n).toBe(0);
  });

  it('a worker taken off the work can no longer send records for it', async () => {
    const t = await team();
    const w = (await t.marcus.post(`/c/${t.cid}/work`, { title: 'Fuel', assignees: [t.ids.luis] })).body;
    await t.marcus.put(`/c/${t.cid}/work/${w.id}/assignees`, { userIds: [t.ids.sam] });
    expect((await t.luis.post(`/c/${t.cid}/my/work/${w.id}/submit`, { submissionId: 'sub-gone-1', baseVersion: 1, to: 'in_progress' })).status).toBe(404);
    expect((await t.luis.get(`/c/${t.cid}/my/work`)).body.today).toEqual([]);
  });
});
