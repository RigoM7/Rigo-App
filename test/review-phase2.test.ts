import { describe, it, expect } from 'vitest';
import { triCounty, fixtureServices, type TriCounty } from './fixtures/tricounty.js';
import { rid, getDb } from './helpers.js';
import { buildDeliveryLines, type DeliveryLine } from '../src/shared/deliveries.js';
import { computeTotals } from '../src/shared/billing.js';
import { activityText } from '../src/shared/activity.js';

// Findings from the Phase 2 review, each fixed with a test.

const line = (p: Partial<DeliveryLine>): DeliveryLine => ({ product: 'Diesel', tank: '', quantity: '', meterStart: '', meterEnd: '', ticket: '', ...p });

describe('money', () => {
  it("a product's minimum charge applies once per stop, not once per tank", () => {
    const { fuel } = fixtureServices();
    const pricing = fuel.pricing.map((p) => (p.id === 'fuel_diesel' ? { ...p, rateE4: 40000, minimumMinor: 15000 } : p));
    const labels = Object.fromEntries(fuel.fields.map((f) => [f.key, f.label]));
    const split = buildDeliveryLines(pricing, {}, [line({ quantity: '20', tank: 'Tank A' }), line({ quantity: '20', tank: 'Tank B' })], labels);
    const diesel = split.lines.filter((l) => l.description.startsWith('Diesel'));
    expect(diesel.reduce((t, l) => t + (l.amountMinor ?? 0), 0)).toBe(16000); // 40 gal × $4.00, above the $150 minimum
    const small = buildDeliveryLines(pricing, {}, [line({ quantity: '10', tank: 'Tank A' }), line({ quantity: '5', tank: 'Tank B' })], labels);
    const d2 = small.lines.filter((l) => l.description.startsWith('Diesel'));
    expect(d2.reduce((t, l) => t + (l.amountMinor ?? 0), 0)).toBe(15000); // 15 gal = $60, minimum $150 once
    expect(d2.map((l) => l.description)).toEqual(['Diesel (Tank A)', 'Diesel (Tank B)', 'Diesel: minimum charge']);
    expect(d2[2].note).toBe('Minimum charge $150.00 applies (15 gal × $4.00 = $60.00)');
    expect(d2[2].taxable).toBe(true); // taxed like the product it tops up
    expect(computeTotals(small.lines, 725).holdReasons).toEqual([]);
  });

  it('activity amounts use the company currency', () => {
    expect(activityText('payment.recorded', { amountMinor: 1200 }, 'EUR')).toBe('recorded a payment €12.00');
    expect(activityText('payment.recorded', { amountMinor: 1200 })).toBe('recorded a payment $12.00');
  });
});

async function issued(t: TriCounty) {
  const c = t.customers.grace;
  const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, intent: 'open', clientRequestId: rid() });
  const j = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
  const a = await t.dana.post(`/c/${t.cid}/jobs/${j.id}/assign`, { userId: t.ids.luis, resourceIds: [], version: j.version });
  await t.luis.post(`/c/${t.cid}/jobs/${j.id}/complete`, { submissionId: rid(), baseVersion: a.body.version, outcome: 'completed', values: { delivered_qty: '100' } });
  const inv = (await t.dana.post(`/c/${t.cid}/jobs/${j.id}/invoice`)).body.invoiceId;
  let d = (await t.dana.get(`/c/${t.cid}/invoices/${inv}`)).body.invoice;
  await t.dana.post(`/c/${t.cid}/invoices/${inv}/approve`, { version: d.version });
  d = (await t.dana.get(`/c/${t.cid}/invoices/${inv}`)).body.invoice;
  await t.dana.post(`/c/${t.cid}/invoices/${inv}/issue`, { version: d.version });
  return (await t.dana.get(`/c/${t.cid}/invoices/${inv}`)).body.invoice;
}

describe('the customer page', () => {
  it('"Owes" counts every unpaid invoice, not only the newest 50', async () => {
    const t = await triCounty();
    const old = await issued(t);
    // Fifty newer invoices that are already settled.
    const db = await getDb();
    for (let i = 0; i < 50; i++) {
      await db.query(`insert into rigo.invoices (company_id, billable_key, customer_id, kind, status, currency, subtotal_minor, discount_minor, tax_minor, total_minor, paid_minor, payment_status, hold_reasons, created_at)
        values ($1, $2, $3, 'manual', 'issued', 'USD', 100, 0, 0, 100, 100, 'paid', '[]', now() + interval '1 minute')`, [t.cid, `test:${rid()}`, t.customers.grace.id]);
    }
    const owes = (await t.dana.get(`/c/${t.cid}/customers/${t.customers.grace.id}`)).body.summary.owes;
    expect(owes).toMatchObject({ balanceMinor: old.totalMinor, unpaid: 1 });
  });
});

describe('trucks back in service', () => {
  it('a truck whose "out of service until" date has passed is available everywhere, not only on the trucks page', async () => {
    const t = await triCounty();
    const tw = t.trucks['Tank wagon 2'];
    const until = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
    expect((await t.dana.patch(`/c/${t.cid}/resources/${tw}`, { status: 'out_of_service', outOfServiceUntil: until })).status).toBe(200);
    await (await getDb()).query(`update rigo.resources set out_of_service_until = current_date - 1 where id = $1`, [tw]);
    const c = t.customers.grace;
    const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, intent: 'open', clientRequestId: rid() });
    const j = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
    // Assigning it works without anyone opening the trucks page first.
    expect((await t.marcus.post(`/c/${t.cid}/jobs/${j.id}/assign`, { userId: t.ids.luis, resourceIds: [tw], version: j.version })).status).toBe(200);
  });

  it('only dispatchers can swap a truck on jobs', async () => {
    const t = await triCounty();
    expect((await t.luis.post(`/c/${t.cid}/jobs/swap-resource`, { fromId: t.trucks['Tank wagon 1'], toId: t.trucks['Tank wagon 2'], jobIds: [] })).status).toBe(403);
  });
});

describe('merges and archives', () => {
  it('refuses to undo a merge whose kept customer was merged again since', async () => {
    const t = await triCounty();
    const a = (await t.priya.post(`/c/${t.cid}/customers`, { name: 'Dup One', allowDuplicate: true })).body.id;
    const b = (await t.priya.post(`/c/${t.cid}/customers`, { name: 'Dup Two', allowDuplicate: true })).body.id;
    const first = (await t.priya.post(`/c/${t.cid}/customers/${b}/merge`, { mergedId: a })).body.mergeId;
    expect((await t.priya.post(`/c/${t.cid}/customers/${t.customers.harbor.id}/merge`, { mergedId: b })).status).toBe(200);
    const undo = await t.priya.post(`/c/${t.cid}/customer-merges/${first}/undo`, {});
    expect(undo.status).toBe(409);
    expect(undo.body.error.message).toMatch(/was merged into another customer since/);
  });

  it('a customer who pays for an open job is not archived, and archived customers are not chosen for new jobs', async () => {
    const t = await triCounty();
    const realtor = (await t.priya.post(`/c/${t.cid}/customers`, { name: 'Lakeside Realty' })).body.id;
    const c = t.customers.grace;
    expect((await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.septic.id, billToCustomerId: realtor, details: { service_detail: 'Inspection' }, intent: 'draft', clientRequestId: rid() })).status).toBe(200);
    expect((await t.dana.post(`/c/${t.cid}/customers/${realtor}/archive`, {})).status).toBe(409);
    expect((await t.dana.post(`/c/${t.cid}/customers/${t.customers.brigid.id}/archive`, {})).status).toBe(200);
    const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.septic.id, billToCustomerId: t.customers.brigid.id, details: { service_detail: 'Inspection' }, intent: 'draft', clientRequestId: rid() });
    expect(r.status).toBe(400);
    expect(r.body.error.details.fields.billToCustomerId).toBe('Archived customer');
  });

  it('finds a duplicate by phone even when many customers share the first letters of the name', async () => {
    const t = await triCounty();
    const db = await getDb();
    for (let i = 0; i < 60; i++) await db.query(`insert into rigo.customers (company_id, name) values ($1, $2)`, [t.cid, `John Smith ${i}`]);
    await t.priya.post(`/c/${t.cid}/customers`, { name: 'John Q Public', phone: '555-777-1234', allowDuplicate: true });
    const r = await t.priya.post(`/c/${t.cid}/customers/duplicates`, { name: 'Johnny', phone: '(555) 777-1234' });
    expect(r.body.candidates.map((x: any) => x.name)).toContain('John Q Public');
  });
});
