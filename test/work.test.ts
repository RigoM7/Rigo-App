import { describe, it, expect } from 'vitest';
import { signup, newCompany, getDb } from './helpers.js';
import { team, type Team } from './fixtures/team.js';

// Step 4: work and schedule, then customers. Every case checks a permission or isolation edge too.

async function customer(t: Team, name = 'Acme Farms') {
  const r = await t.dana.post(`/c/${t.cid}/customers`, { name, email: `${name.split(' ')[0].toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '')}@example.test`, phone: '(555) 201-0001', place: { label: 'Main', address: '12 Barn Rd, Millbrook', notes: 'Gate code 4411' } });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  const d = await t.dana.get(`/c/${t.cid}/customers/${r.body.id}`);
  return { id: r.body.id as string, place: d.body.places[0].id as string };
}

describe('customers', () => {
  it('adds customers with places, asks before a likely duplicate, and searches by name or address', async () => {
    const t = await team();
    const a = await customer(t, 'José Núñez');
    const dup = await t.dana.post(`/c/${t.cid}/customers`, { name: 'Jose Nunez' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.needsConfirm).toBe('duplicate');
    expect((await t.dana.post(`/c/${t.cid}/customers`, { name: 'Jose Nunez', allowDuplicate: true })).status).toBe(200);
    expect((await t.dana.get(`/c/${t.cid}/customers?q=nunez`)).body.customers.map((c: any) => c.name)).toEqual(['Jose Nunez', 'José Núñez']);
    expect((await t.dana.get(`/c/${t.cid}/customers?q=barn rd`)).body.customers.map((c: any) => c.id)).toEqual([a.id]);
    // A driver can't open the customer list at all.
    expect((await t.luis.get(`/c/${t.cid}/customers`)).status).toBe(403);
  });

  it("leads with the next visit and what they owe; contact details only for roles allowed to see them", async () => {
    const t = await team();
    const c = await customer(t);
    const soon = new Date(Date.now() + 86400_000).toISOString();
    await t.dana.post(`/c/${t.cid}/work`, { title: 'Delivery', clientId: c.id, placeId: c.place, startsAt: soon });
    const full = (await t.dana.get(`/c/${t.cid}/customers/${c.id}`)).body;
    expect(full.next.title).toBe('Delivery');
    expect(full.owesMinor).toBe(0);
    expect(full.customer.email).toBe('acme@example.test');
    // Marcus (dispatcher) sees contact details but no money.
    const marcus = (await t.marcus.get(`/c/${t.cid}/customers/${c.id}`)).body;
    expect(marcus.customer.phone).toBe('(555) 201-0001');
    expect(marcus.owesMinor).toBeUndefined();
    expect(marcus.invoices).toBeUndefined();
    // Without contact access the server leaves them out entirely.
    await t.dana.patch(`/c/${t.cid}/roles/dispatcher`, { permissions: ['customers.view', 'work.view_all'] });
    const hidden = await t.marcus.get(`/c/${t.cid}/customers/${c.id}`);
    expect(hidden.body.customer).not.toHaveProperty('email');
    expect(hidden.body.customer).not.toHaveProperty('phone');
    expect(JSON.stringify(hidden.body)).not.toContain('201-0001');
    expect(JSON.stringify((await t.marcus.get(`/c/${t.cid}/customers`)).body)).not.toContain('acme@example.test');
  });

  it('another workspace gets 404 for a customer id, and can’t attach it to its work', async () => {
    const t = await team();
    const c = await customer(t);
    const other = await signup('Other');
    const cid = await newCompany(other, 'cleaning', 'Other Co');
    expect((await other.get(`/c/${cid}/customers/${c.id}`)).status).toBe(404);
    expect((await other.patch(`/c/${cid}/customers/${c.id}`, { name: 'Taken', version: 1 })).status).toBe(404);
    expect((await other.post(`/c/${cid}/customers/${c.id}/places`, { address: 'x' })).status).toBe(404);
    expect((await other.post(`/c/${cid}/work`, { clientId: c.id })).status).toBe(400);
    expect((await other.post(`/c/${cid}/work`, { assignees: [t.ids.luis] })).status).toBe(400);
  });
});

describe('work', () => {
  it('starts in the first Open stage, moves along stages and keeps history', async () => {
    const t = await team();
    const c = await customer(t);
    const r = await t.marcus.post(`/c/${t.cid}/work`, { title: 'Pump-out', clientId: c.id, placeId: c.place, assignees: [t.ids.luis] });
    expect(r.status).toBe(200);
    expect(r.body.number).toBe(1);
    let d = (await t.marcus.get(`/c/${t.cid}/work/${r.body.id}`)).body;
    expect(d.item.stage).toMatchObject({ key: 'requested', meaning: 'open' });
    expect(d.next.map((s: any) => s.key)).toContain('cancelled');
    expect((await t.marcus.post(`/c/${t.cid}/work/${r.body.id}/move`, { to: 'in_progress' })).status).toBe(200);
    expect((await t.marcus.post(`/c/${t.cid}/work/${r.body.id}/move`, { to: 'done' })).status).toBe(200);
    d = (await t.marcus.get(`/c/${t.cid}/work/${r.body.id}`)).body;
    expect(d.item.stage.meaning).toBe('finished');
    expect(d.item.closedAt).not.toBeNull();
    // Assisted by default: Rigo prepared the invoice for a person to approve.
    expect(d.item.billing).toBe('invoiced');
    expect(d.history.map((h: any) => [h.type, h.actor])).toEqual([['invoiced', 'Rigo'], ['moved', 'Marcus'], ['moved', 'Marcus'], ['created', 'Marcus']]);
    // The driver was told.
    const notes = await (await getDb()).query(`select title from rigo.notifications where company_id = $1 and user_id = $2`, [t.cid, t.ids.luis]);
    expect(notes.rows.some((n: any) => /New job for you: #1 Pump-out/.test(n.title))).toBe(true);
  });

  it('follows the paths and required fields the owner set', async () => {
    const t = await team();
    const boot = (await t.dana.get(`/c/${t.cid}`)).body;
    const stages = boot.stages.map((s: any) => ({ key: s.key, name: s.name, meaning: s.meaning,
      ...(s.key === 'requested' ? { next: ['scheduled', 'cancelled'] } : {}), ...(s.key === 'done' ? { requires: ['quantity'] } : {}) }));
    expect((await t.dana.put(`/c/${t.cid}/stages`, { stages })).status).toBe(200);
    const w = (await t.dana.post(`/c/${t.cid}/work`, { title: 'Fuel' })).body;
    const jump = await t.dana.post(`/c/${t.cid}/work/${w.id}/move`, { to: 'done' });
    expect(jump.status).toBe(400);
    expect(jump.body.error.message).toBe("Work in Requested can't move to Done.");
    await t.dana.post(`/c/${t.cid}/work/${w.id}/move`, { to: 'scheduled' });
    const missing = await t.dana.post(`/c/${t.cid}/work/${w.id}/move`, { to: 'done' });
    expect(missing.body.error.message).toBe('Fill in Quantity delivered before moving to Done.');
    expect((await t.dana.post(`/c/${t.cid}/work/${w.id}/move`, { to: 'done', fields: { quantity: '187.4' } })).status).toBe(200);
    // A stage holding work can't be removed.
    const without = stages.filter((s: any) => s.key !== 'done');
    without.find((s: any) => s.key === 'in_progress').meaning = 'finished';
    const rm = await t.dana.put(`/c/${t.cid}/stages`, { stages: without });
    expect(rm.status).toBe(409);
    expect(rm.body.error.message).toBe('Done still has 1 job. Move it to another stage before removing it.');
  });

  it('drivers see and move only their own work, and never cancel it', async () => {
    const t = await team();
    const mine = (await t.marcus.post(`/c/${t.cid}/work`, { title: 'Mine', assignees: [t.ids.luis] })).body;
    const theirs = (await t.marcus.post(`/c/${t.cid}/work`, { title: 'Theirs', assignees: [t.ids.sam] })).body;
    const list = (await t.luis.get(`/c/${t.cid}/work`)).body.items;
    expect(list.map((w: any) => w.title)).toEqual(['Mine']);
    expect((await t.luis.get(`/c/${t.cid}/work/${theirs.id}`)).status).toBe(404);
    expect((await t.luis.post(`/c/${t.cid}/work/${theirs.id}/move`, { to: 'in_progress' })).status).toBe(404);
    expect((await t.luis.post(`/c/${t.cid}/work/${mine.id}/move`, { to: 'cancelled' })).status).toBe(403);
    expect((await t.luis.post(`/c/${t.cid}/work/${mine.id}/move`, { to: 'in_progress' })).status).toBe(200);
    expect((await t.luis.post(`/c/${t.cid}/work`, { title: 'New' })).status).toBe(403);
    expect((await t.luis.patch(`/c/${t.cid}/work/${mine.id}`, { title: 'Renamed', version: 2 })).status).toBe(403);
    expect((await t.luis.get(`/c/${t.cid}/schedule?from=2030-01-01`)).status).toBe(403);
  });

  it('keeps prices from roles without money access, while still billing them exactly', async () => {
    const t = await team();
    const cat = (await t.dana.get(`/c/${t.cid}/catalog`)).body.items;
    const fuel = cat.find((i: any) => i.name === 'Fuel delivery');
    expect(fuel.rateE4).toBeNull();
    expect((await t.dana.patch(`/c/${t.cid}/catalog/${fuel.id}`, { rate: '3.8995' })).status).toBe(200);
    expect((await t.marcus.patch(`/c/${t.cid}/catalog/${fuel.id}`, { rate: '0.01' })).status).toBe(403);
    const w = (await t.marcus.post(`/c/${t.cid}/work`, { title: 'Fuel', lines: [{ catalogId: fuel.id, description: 'Fuel delivery', quantity: '100', rate: '0.01' }] })).body;
    const marcusView = (await t.marcus.get(`/c/${t.cid}/work/${w.id}`)).body;
    expect(marcusView.lines[0]).not.toHaveProperty('rateE4');
    expect(marcusView.lines[0]).not.toHaveProperty('amountMinor');
    expect(marcusView.lines[0].priced).toBe(true);
    // Marcus's typed price was ignored: the price list's applies.
    const danaView = (await t.dana.get(`/c/${t.cid}/work/${w.id}`)).body;
    expect(danaView.lines[0]).toMatchObject({ rateE4: 38995, amountMinor: 38995 });
    expect((await t.marcus.get(`/c/${t.cid}/catalog`)).body.items.every((i: any) => !('rateE4' in i))).toBe(true);
  });

  it('refuses stale edits and checks times', async () => {
    const t = await team();
    const w = (await t.dana.post(`/c/${t.cid}/work`, { title: 'A' })).body;
    expect((await t.dana.patch(`/c/${t.cid}/work/${w.id}`, { title: 'B', version: 1 })).status).toBe(200);
    const stale = await t.marcus.patch(`/c/${t.cid}/work/${w.id}`, { title: 'C', version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.stale).toBe(true);
    const bad = await t.dana.patch(`/c/${t.cid}/work/${w.id}`, { startsAt: '2030-01-01T10:00:00Z', endsAt: '2030-01-01T09:00:00Z', version: 2 });
    expect(bad.body.error.message).toBe('The end must be after the start.');
  });

  it('a partial edit changes only what it names (work, customers, equipment, prices, roles)', async () => {
    const t = await team();
    const w = (await t.dana.post(`/c/${t.cid}/work`, { title: 'A', notes: 'Back gate', fields: { access: '4411' } })).body;
    await t.dana.patch(`/c/${t.cid}/work/${w.id}`, { title: 'B', version: 1 });
    expect((await t.dana.get(`/c/${t.cid}/work/${w.id}`)).body.item).toMatchObject({ title: 'B', notes: 'Back gate', fields: { access: '4411' } });
    const c = (await t.dana.post(`/c/${t.cid}/customers`, { name: 'Keep', notes: 'Pays by check', place: { label: 'Yard', address: '1 Road', notes: 'Dog' } })).body.id;
    await t.dana.patch(`/c/${t.cid}/customers/${c}`, { name: 'Kept', version: 1 });
    const cd = (await t.dana.get(`/c/${t.cid}/customers/${c}`)).body;
    expect(cd.customer.notes).toBe('Pays by check');
    await t.dana.patch(`/c/${t.cid}/customers/${c}/places/${cd.places[0].id}`, { address: '2 Road' });
    expect((await t.dana.get(`/c/${t.cid}/customers/${c}`)).body.places[0]).toMatchObject({ label: 'Yard', notes: 'Dog', address: '2 Road' });
    const fuel = (await t.dana.get(`/c/${t.cid}/catalog`)).body.items.find((i: any) => i.name === 'Fuel delivery');
    await t.dana.patch(`/c/${t.cid}/catalog/${fuel.id}`, { rate: '4' });
    expect((await t.dana.get(`/c/${t.cid}/catalog`)).body.items.find((i: any) => i.id === fuel.id)).toMatchObject({ unit: 'gal', taxable: true, rateE4: 40000 });
    const e = (await t.dana.post(`/c/${t.cid}/equipment`, { name: 'Tanker', identifier: 'TX-1', status: 'out_of_service' })).body.id;
    await t.dana.patch(`/c/${t.cid}/equipment/${e}`, { name: 'Tanker 12' });
    expect((await t.dana.get(`/c/${t.cid}/equipment`)).body.equipment[0]).toMatchObject({ name: 'Tanker 12', identifier: 'TX-1', status: 'out_of_service' });
    await t.dana.patch(`/c/${t.cid}/roles/driver`, { name: 'Truck driver' });
    const driver = (await t.dana.get(`/c/${t.cid}/roles`)).body.roles.find((r: any) => r.key === 'driver');
    expect(driver.description).toMatch(/Does the jobs/);
  });

  it('shows a schedule with lanes for people and equipment, in the workspace time zone', async () => {
    const t = await team();
    await t.dana.post(`/c/${t.cid}/equipment`, { name: 'Tanker 12' });
    // 23:30 in Chicago on Jan 1 is Jan 2 in UTC: it still belongs to Jan 1.
    await t.dana.post(`/c/${t.cid}/work`, { title: 'Late', startsAt: '2030-01-02T05:30:00Z', assignees: [t.ids.luis] });
    await t.dana.post(`/c/${t.cid}/work`, { title: 'Someday' });
    const s = (await t.marcus.get(`/c/${t.cid}/schedule?from=2030-01-01&to=2030-01-01`)).body;
    expect(s.items.map((w: any) => w.title)).toEqual(['Late']);
    expect(s.unscheduled.map((w: any) => w.title)).toEqual(['Someday']);
    expect(s.people.map((p: any) => p.name)).toEqual(expect.arrayContaining(['Luis', 'Sam', 'Dana']));
    expect(s.equipment.map((e: any) => e.name)).toEqual(['Tanker 12']);
    expect((await t.marcus.get(`/c/${t.cid}/schedule?from=2030-01-01&to=2030-06-01`)).status).toBe(400);
  });

  it('a removed person’s open work goes back to unassigned, with history', async () => {
    const t = await team();
    const w = (await t.dana.post(`/c/${t.cid}/work`, { title: 'Open', assignees: [t.ids.tyler] })).body;
    const tyler = (await t.dana.get(`/c/${t.cid}/members`)).body.members.find((m: any) => m.user_id === t.ids.tyler);
    expect(tyler.open_work).toBe(1);
    await t.dana.del(`/c/${t.cid}/members/${tyler.id}`);
    const d = (await t.dana.get(`/c/${t.cid}/work/${w.id}`)).body;
    expect(d.item.assignees).toEqual([]);
    expect(d.history[0].type).toBe('unassigned');
    expect((await t.dana.get(`/c/${t.cid}/work?assignee=none`)).body.items.map((x: any) => x.id)).toContain(w.id);
  });

  it('search finds work by number and customers by name, within the person’s scope', async () => {
    const t = await team();
    const c = await customer(t, 'Ridgeline Construction');
    await t.dana.post(`/c/${t.cid}/work`, { title: 'Pump', clientId: c.id, assignees: [t.ids.luis] });
    await t.dana.post(`/c/${t.cid}/work`, { title: 'Ridge job 2' });
    const s = (await t.marcus.get(`/c/${t.cid}/search?q=ridge`)).body;
    expect(s.customers.map((x: any) => x.name)).toEqual(['Ridgeline Construction']);
    expect(s.work.map((x: any) => x.title).sort()).toEqual(['Pump', 'Ridge job 2']);
    const luis = (await t.luis.get(`/c/${t.cid}/search?q=ridge`)).body;
    expect(luis.customers).toEqual([]);
    expect(luis.work.map((x: any) => x.title)).toEqual(['Pump']);
    expect((await t.dana.get(`/c/${t.cid}/search?q=%231`)).body.work[0].number).toBe(1);
  });
});
