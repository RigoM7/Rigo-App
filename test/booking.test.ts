import { describe, it, expect } from 'vitest';
import { Client, signup, newCompany } from './helpers.js';
import { team } from './fixtures/team.js';
import { bookingSlots } from '../src/shared/booking.js';

// Step 8: public booking and request pages, and the shared template library.

describe('booking slots', () => {
  it('offers times inside the hours where someone is still free, in the workspace time zone', () => {
    const slots = bookingSlots({ from: '2030-01-07', days: 2, hours: { days: [1], start: '09:00', end: '11:00' }, slotMinutes: 60, timeZone: 'America/Chicago', capacity: 1,
      taken: [{ start: '2030-01-07T15:00:00.000Z', end: '2030-01-07T16:00:00.000Z' }] });
    // Monday only (Jan 7, 2030); 9:00 is taken, 10:00 is free (16:00 UTC).
    expect(slots).toEqual(['2030-01-07T16:00:00.000Z']);
  });
});

describe('request pages', () => {
  it('takes a request without sign-in; it lands in the inbox; accepting makes the customer and the work', async () => {
    const t = await team();
    const items = (await t.dana.get(`/c/${t.cid}/catalog`)).body.items;
    const septic = items.find((i: any) => i.name === 'Septic pump-out');
    expect((await t.luis.put(`/c/${t.cid}/booking`, { slug: 'tri-county', enabled: true, mode: 'request' })).status).toBe(403);
    expect((await t.dana.put(`/c/${t.cid}/booking`, { slug: 'tri-county', enabled: true, mode: 'request', headline: 'Ask for service', catalogIds: [septic.id] })).status).toBe(200);
    const anon = new Client('anon');
    const page = (await anon.get('/public/tri-county')).body;
    expect(page).toMatchObject({ name: 'Tri-County Field Services', mode: 'request', items: [{ name: 'Septic pump-out' }] });
    expect(JSON.stringify(page)).not.toMatch(/rate|price|Luis|Marcus/i);
    expect((await anon.post('/public/tri-county/requests', { name: 'Grace' })).body.error.message).toBe('Leave an email address or a phone number so they can answer you.');
    const sent = await anon.post('/public/tri-county/requests', { name: 'Grace Okafor', email: 'grace@example.test', address: '812 Willow Ln', message: 'Tank is full', catalogId: septic.id });
    expect(sent.status).toBe(200);
    const inbox = (await t.marcus.get(`/c/${t.cid}/inbox`)).body;
    expect(inbox.requests).toHaveLength(1);
    expect(inbox.requests[0]).toMatchObject({ name: 'Grace Okafor', wanted: 'Septic pump-out', email: 'grace@example.test' });
    expect((await t.luis.get(`/c/${t.cid}/inbox`)).body.requests).toEqual([]);
    const ok = await t.marcus.post(`/c/${t.cid}/requests/${inbox.requests[0].id}/accept`, {});
    expect(ok.status).toBe(200);
    const w = (await t.marcus.get(`/c/${t.cid}/work/${ok.body.workId}`)).body;
    expect(w.item).toMatchObject({ title: 'Septic pump-out', source: 'request', client: { name: 'Grace Okafor' }, place: { address: '812 Willow Ln' } });
    expect((await t.marcus.post(`/c/${t.cid}/requests/${inbox.requests[0].id}/accept`, {})).status).toBe(409);
    // A second request from the same email joins the same customer.
    await anon.post('/public/tri-county/requests', { name: 'Grace O.', email: 'GRACE@example.test' });
    const r2 = (await t.marcus.get(`/c/${t.cid}/inbox`)).body.requests[0];
    expect((await t.marcus.post(`/c/${t.cid}/requests/${r2.id}/accept`, {})).body.clientId).toBe(ok.body.clientId);
  });

  it('a page that is off, or another workspace’s request, is not found; bots and floods are refused', async () => {
    const t = await team();
    await t.dana.put(`/c/${t.cid}/booking`, { slug: 'quiet-co', enabled: false, mode: 'request' });
    const anon = new Client('anon');
    expect((await anon.get('/public/quiet-co')).status).toBe(404);
    expect((await anon.get('/public/no-such-page')).status).toBe(404);
    await t.dana.put(`/c/${t.cid}/booking`, { slug: 'quiet-co', enabled: true, mode: 'request' });
    // The hidden "website" field catches bots: thanked, nothing kept.
    expect((await anon.post('/public/quiet-co/requests', { name: 'Bot', email: 'b@example.test', website: 'http://spam' })).status).toBe(200);
    expect((await t.dana.get(`/c/${t.cid}/requests`)).body.requests).toEqual([]);
    for (let i = 0; i < 10; i++) await anon.post('/public/quiet-co/requests', { name: `P${i}`, phone: '5550100' });
    expect((await anon.post('/public/quiet-co/requests', { name: 'P11', phone: '5550100' })).status).toBe(429);
    const req = (await t.dana.get(`/c/${t.cid}/requests`)).body.requests[0];
    const other = await signup();
    const ocid = await newCompany(other);
    expect((await other.post(`/c/${ocid}/requests/${req.id}/accept`, {})).status).toBe(404);
    // Addresses are unique across workspaces.
    expect((await other.put(`/c/${ocid}/booking`, { slug: 'quiet-co', enabled: true, mode: 'request' })).status).toBe(409);
  });

  it('booking mode offers only free times and refuses a taken one', async () => {
    const t = await team();
    await t.dana.put(`/c/${t.cid}/booking`, { slug: 'book-me', enabled: true, mode: 'book', hours: { days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '12:00' }, slotMinutes: 60 });
    const anon = new Client('anon');
    const page = (await anon.get('/public/book-me')).body;
    expect(page.slots.length).toBe(14 * 3);
    expect((await anon.post('/public/book-me/requests', { name: 'A', phone: '555' })).body.error.message).toBe('Choose a time.');
    expect((await anon.post('/public/book-me/requests', { name: 'A', phone: '555', preferredAt: '2031-01-01T15:00:00.000Z' })).status).toBe(409);
    expect((await anon.post('/public/book-me/requests', { name: 'A', phone: '555', preferredAt: page.slots[0] })).status).toBe(200);
  });
});

describe('the template library', () => {
  it('owners publish structure only; anyone can start a workspace from it', async () => {
    const t = await team();
    await t.dana.patch(`/c/${t.cid}/catalog/${(await t.dana.get(`/c/${t.cid}/catalog`)).body.items[0].id}`, { rate: '3.89' });
    await t.dana.post(`/c/${t.cid}/customers`, { name: 'Secret Customer' });
    expect((await t.marcus.post(`/c/${t.cid}/library`, { name: 'Fuel co' })).status).toBe(403);
    const pub = await t.dana.post(`/c/${t.cid}/library`, { name: 'Rural fuel and septic', blurb: 'How we run a fuel and septic route.', examples: ['Fuel'] });
    expect(pub.status).toBe(200);
    const lib = (await new Client('anon').get('/library')).body;
    const mine = lib.shared.find((x: any) => x.id === pub.body.id);
    expect(mine).toMatchObject({ name: 'Rural fuel and septic', from: 'Tri-County Field Services' });
    const text = JSON.stringify(mine.structure);
    expect(text).not.toMatch(/Secret Customer|3\.89|38900|Luis|Dana/);
    const someone = await signup('New Owner');
    const r = await someone.post('/companies', { name: 'My Fuel', templateKey: `lib:${pub.body.id}` });
    expect(r.status).toBe(200);
    const boot = (await someone.get(`/c/${r.body.id}`)).body;
    expect(boot.roles.map((x: any) => x.name)).toEqual(['Owner', 'Dispatcher', 'Driver', 'Office / billing']);
    expect(boot.workspace.templateKey).toBe(`lib:${pub.body.id}`);
    // Unpublishing takes it out of the library; workspaces made from it keep their copy.
    expect((await t.dana.del(`/c/${t.cid}/library/${pub.body.id}`)).status).toBe(200);
    expect((await someone.post('/companies', { name: 'Late', templateKey: `lib:${pub.body.id}` })).status).toBe(404);
    expect((await someone.get(`/c/${r.body.id}`)).body.stages.length).toBe(6);
  });
});
