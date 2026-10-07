import { describe, it, expect } from 'vitest';
import { triCounty } from './fixtures/tricounty.js';
import { signup, newCompany, rid } from './helpers.js';

// WP11: setup isn't "ready" without prices, complete jobs are open, drafts aren't hidden by surprise.

describe('setup needs prices (R3-M4)', () => {
  it('a new company is not ready until every service has rates or is priced on each invoice', async () => {
    const owner = await signup('Sam Setup');
    const cid = await newCompany(owner);
    await owner.post(`/c/${cid}/setup`, { mark: 'basics' });
    await owner.post(`/c/${cid}/setup`, { mark: 'automation' });
    let setup = (await owner.get(`/c/${cid}`)).body.setup;
    const pricing = setup.items.find((i: any) => i.key === 'pricing');
    expect(pricing).toMatchObject({ required: true, done: false, link: 'setup?step=prices' });
    expect(pricing.note).toMatch(/3 services have prices not set yet/);
    expect(setup.ready).toBe(false);
    for (const s of (await owner.get(`/c/${cid}/services`)).body.services) expect((await owner.post(`/c/${cid}/services/${s.id}/priced-per-job`, { value: true })).status).toBe(200);
    setup = (await owner.get(`/c/${cid}`)).body.setup;
    expect(setup.items.find((i: any) => i.key === 'pricing').done).toBe(true);
    expect(setup.ready).toBe(true);
    expect((await owner.get(`/c/${cid}/services`)).body.services.every((s: any) => s.pricedPerJob)).toBe(true);
  });
});

describe('drafts (R3-M7)', () => {
  it('a job with everything it needs is created open; an incomplete one stays a draft', async () => {
    const t = await triCounty();
    const c = t.customers.grace;
    const full = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, clientRequestId: rid() });
    expect(full.body.status).toBe('open');
    const part = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, serviceId: t.services.fuel.id, clientRequestId: rid() });
    expect(part.body.status).toBe('draft');
    expect(part.body.missing.length).toBeGreaterThan(0);
  });

  it('assigning a draft asks to open it, opens it when complete, and refuses when not', async () => {
    const t = await triCounty();
    const c = t.customers.grace;
    const d = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, intent: 'draft', clientRequestId: rid() });
    let j = (await t.dana.get(`/c/${t.cid}/jobs/${d.body.id}`)).body.job;
    const ask = await t.marcus.post(`/c/${t.cid}/jobs/${j.id}/assign`, { userId: t.ids.luis, version: j.version });
    expect(ask.status).toBe(409);
    expect(ask.body.error).toMatchObject({ message: `Drivers can't see drafts. Open job #${j.number} now?`, details: { needsConfirm: 'draft' } });
    expect((await t.marcus.post(`/c/${t.cid}/jobs/${j.id}/assign`, { userId: t.ids.luis, version: j.version, openDraft: true })).status).toBe(200);
    j = (await t.dana.get(`/c/${t.cid}/jobs/${d.body.id}`)).body.job;
    expect(j).toMatchObject({ status: 'open', assigned_user_id: t.ids.luis });
    expect((await t.luis.get(`/c/${t.cid}/my/jobs`)).body.jobs.some((x: any) => x.id === j.id)).toBe(true);
    // An incomplete draft can't be opened by assigning it.
    const bare = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, intent: 'draft', clientRequestId: rid() });
    const b = (await t.dana.get(`/c/${t.cid}/jobs/${bare.body.id}`)).body.job;
    const no = await t.marcus.post(`/c/${t.cid}/jobs/${b.id}/assign`, { userId: t.ids.luis, version: b.version, openDraft: true });
    expect(no.status).toBe(400);
    expect(no.body.error.message).toMatch(new RegExp(`Job #${b.number} can't be opened yet`));
  });
});

describe('companies (R3-m1, R17-M2)', () => {
  it('asks before a second company with the same name, and the list tells them apart', async () => {
    const owner = await signup('Dee Duplicate');
    await newCompany(owner, ['fuel'], 'Acme Fuel');
    const again = await owner.post('/companies', { name: 'acme fuel', timezone: 'America/Chicago', currency: 'USD', categories: ['fuel'] });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ message: 'You already have a company called acme fuel. Create another one anyway?', details: { needsConfirm: 'duplicateName' } });
    expect((await owner.post('/companies', { name: 'acme fuel', timezone: 'America/Chicago', currency: 'USD', categories: ['fuel'], allowDuplicateName: true })).status).toBe(200);
    const cos = (await owner.get('/auth/me')).body.companies.filter((c: any) => c.kind === 'real');
    expect(cos).toHaveLength(2);
    expect(cos.every((c: any) => c.created_at && 'address' in c && c.archived_at === null)).toBe(true);
  });

  it('owners archive with the typed name, and delete only a company that never billed anything', async () => {
    const t = await triCounty();
    const wrong = await t.dana.post(`/c/${t.cid}/archive`, { confirmName: 'Tri County' });
    expect(wrong.status).toBe(400);
    expect((await t.marcus.post(`/c/${t.cid}/archive`, { confirmName: 'Tri-County Field Services' })).status).toBe(403);
    expect((await t.dana.post(`/c/${t.cid}/archive`, { confirmName: 'tri-county field services' })).status).toBe(200);
    expect((await t.dana.get('/auth/me')).body.companies.find((c: any) => c.id === t.cid).archived_at).toBeTruthy();
    expect((await t.dana.post(`/c/${t.cid}/unarchive`, {})).status).toBe(200);
    // A company with an issued invoice is kept.
    const c = t.customers.grace;
    const j = (await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, clientRequestId: rid() })).body;
    const job = (await t.dana.get(`/c/${t.cid}/jobs/${j.id}`)).body.job;
    const a = await t.dana.post(`/c/${t.cid}/jobs/${j.id}/assign`, { userId: t.ids.luis, version: job.version });
    await t.luis.post(`/c/${t.cid}/jobs/${j.id}/complete`, { submissionId: rid(), baseVersion: a.body.version, outcome: 'completed', values: { delivered_qty: '10' } });
    const inv = (await t.dana.post(`/c/${t.cid}/jobs/${j.id}/invoice`)).body.invoiceId;
    let d = (await t.dana.get(`/c/${t.cid}/invoices/${inv}`)).body.invoice;
    await t.dana.post(`/c/${t.cid}/invoices/${inv}/approve`, { version: d.version });
    d = (await t.dana.get(`/c/${t.cid}/invoices/${inv}`)).body.invoice;
    await t.dana.post(`/c/${t.cid}/invoices/${inv}/issue`, { version: d.version });
    const del = await t.dana.post(`/c/${t.cid}/delete`, { confirmName: 'Tri-County Field Services' });
    expect(del.status).toBe(409);
    expect(del.body.error.message).toMatch(/Archive it instead/);
    // A company that was only tried out can go.
    const owner = await signup('Tess Tryout');
    const cid = await newCompany(owner, ['fuel'], 'Tryout Co');
    expect((await owner.post(`/c/${cid}/delete`, { confirmName: 'Tryout Co' })).status).toBe(200);
    expect((await owner.get(`/c/${cid}`)).status).toBe(404);
  });
});

describe('business hours (D16)', () => {
  it('marks a visit outside the hours as after-hours, and nothing before hours are set', async () => {
    const { isAfterHours, hoursText } = await import('../src/shared/hours.js');
    const h = { days: [1, 2, 3, 4, 5], start: '07:00', end: '17:00' };
    expect(hoursText(h)).toBe('Mon–Fri, 7:00 AM – 5:00 PM');
    expect(isAfterHours('2026-10-07T14:00:00Z', 'America/Chicago', h)).toBe(false); // Wed 9:00 AM Chicago
    expect(isAfterHours('2026-10-07T23:30:00Z', 'America/Chicago', h)).toBe(true); // Wed 6:30 PM
    expect(isAfterHours('2026-10-10T15:00:00Z', 'America/Chicago', h)).toBe(true); // Saturday
    expect(isAfterHours('2026-10-10T15:00:00Z', 'America/Chicago', null)).toBe(false);
    const t = await triCounty();
    const c = t.customers.grace;
    const evening = '2026-10-07T23:30:00Z';
    const before = (await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, scheduledStart: evening, clientRequestId: rid() })).body;
    expect((await t.dana.get(`/c/${t.cid}/jobs/${before.id}`)).body.job.details.after_hours).toBeUndefined();
    expect((await t.dana.patch(`/c/${t.cid}/settings`, { businessHours: { days: [1, 2, 3, 4, 5], start: '17:00', end: '07:00' } })).status).toBe(400);
    expect((await t.dana.patch(`/c/${t.cid}/settings`, { businessHours: h })).status).toBe(200);
    expect((await t.dana.get(`/c/${t.cid}`)).body.company.businessHours).toEqual(h);
    const after = (await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, scheduledStart: evening, clientRequestId: rid() })).body;
    expect((await t.dana.get(`/c/${t.cid}/jobs/${after.id}`)).body.job.details.after_hours).toBe(true);
    // Someone's own choice is kept.
    const chosen = (await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel', after_hours: false }, scheduledStart: evening, clientRequestId: rid() })).body;
    expect((await t.dana.get(`/c/${t.cid}/jobs/${chosen.id}`)).body.job.details.after_hours).toBe(false);
  });
});
