import { describe, it, expect } from 'vitest';
import { triCounty } from './fixtures/tricounty.js';
import { getDb, rid } from './helpers.js';

// WP15: long lists come a page at a time and are searched on the server (R17-m2).

describe('paging and server search (R17-m2)', () => {
  it('customers come a page at a time, with the total, in a stable order', async () => {
    const t = await triCounty();
    const db = await getDb();
    for (let i = 0; i < 60; i++) await db.query(`insert into rigo.customers (company_id, name) values ($1, $2)`, [t.cid, `Bulk customer ${String(i).padStart(2, '0')}`]);
    const first = (await t.dana.get(`/c/${t.cid}/customers?limit=50`)).body;
    expect(first.customers).toHaveLength(50);
    expect(first).toMatchObject({ hasMore: true, limit: 50, offset: 0 });
    const total = first.total as number;
    expect(total).toBeGreaterThan(60);
    const rest = (await t.dana.get(`/c/${t.cid}/customers?limit=50&offset=50`)).body;
    expect(rest.customers.length).toBe(total - 50);
    expect(rest.hasMore).toBe(false);
    const ids = new Set([...first.customers, ...rest.customers].map((x: any) => x.id));
    expect(ids.size).toBe(total);
    // Search runs on the server and the total follows it.
    const found = (await t.dana.get(`/c/${t.cid}/customers?limit=5&q=bulk customer 1`)).body;
    expect(found.total).toBe(10);
    expect(found.customers).toHaveLength(5);
    // Nonsense paging values fall back to safe ones.
    expect((await t.dana.get(`/c/${t.cid}/customers?limit=abc&offset=-4`)).body).toMatchObject({ offset: 0, limit: 500 });
  });

  it('jobs page with hasMore; invoices are searched by number, customer or job number', async () => {
    const t = await triCounty();
    for (let i = 0; i < 5; i++) await t.dana.post(`/c/${t.cid}/jobs`, { customerId: t.customers.grace.id, locationId: t.customers.grace.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, clientRequestId: rid() });
    const all = (await t.dana.get(`/c/${t.cid}/jobs?status=all&sort=number`)).body.jobs;
    const page1 = (await t.dana.get(`/c/${t.cid}/jobs?status=all&sort=number&limit=3`)).body;
    expect(page1.jobs).toHaveLength(3);
    expect(page1.hasMore).toBe(true);
    const page2 = (await t.dana.get(`/c/${t.cid}/jobs?status=all&sort=number&limit=3&offset=3`)).body;
    expect(page2.jobs.map((j: any) => j.id)).toEqual(all.slice(3, 6).map((j: any) => j.id));
    // A manual invoice for Grace, then searched for.
    const inv = await t.dana.post(`/c/${t.cid}/invoices`, { customerId: t.customers.grace.id, lines: [{ description: 'Callout', quantity: '1', rateE4: 500000 }], clientRequestId: rid() });
    expect(inv.status).toBe(200);
    const byName = (await t.dana.get(`/c/${t.cid}/invoices?status=all&q=okafor&limit=5`)).body.invoices;
    expect(byName.some((i: any) => i.id === inv.body.id)).toBe(true);
    expect((await t.dana.get(`/c/${t.cid}/invoices?status=all&q=nobody-matches-this&limit=5`)).body.invoices).toEqual([]);
  });
});
