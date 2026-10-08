import { describe, it, expect } from 'vitest';
import { signup, newCompany } from './helpers.js';
import { team, type Team } from './fixtures/team.js';

// Step 6: invoices and payments. Built from finished work, exact totals, a missing price holds the
// invoice, payments recorded, owed by age. Amounts never reach roles without money access.

async function setup(t: Team, opts: { price?: boolean; tax?: string | null } = {}) {
  await t.dana.put(`/c/${t.cid}/automation/rules/invoice_on_finish`, { level: 'manual' });
  const items = (await t.dana.get(`/c/${t.cid}/catalog`)).body.items;
  const fuel = items.find((i: any) => i.name === 'Fuel delivery');
  const fee = items.find((i: any) => i.name === 'Delivery fee');
  if (opts.price !== false) await t.dana.patch(`/c/${t.cid}/catalog/${fuel.id}`, { rate: '3.8995' });
  await t.dana.patch(`/c/${t.cid}/catalog/${fee.id}`, { rate: '45' });
  if (opts.tax !== undefined) await t.dana.patch(`/c/${t.cid}/money/settings`, { taxRate: opts.tax });
  const c = (await t.dana.post(`/c/${t.cid}/customers`, { name: 'Hollis Farm', email: 'hollis@example.test' })).body.id;
  const work = async (qty: string) => {
    const w = (await t.dana.post(`/c/${t.cid}/work`, { title: 'Fuel', clientId: c, lines: [{ catalogId: fuel.id, description: 'Fuel delivery', quantity: qty }, { catalogId: fee.id, description: 'Delivery fee', quantity: '1' }] })).body;
    await t.dana.post(`/c/${t.cid}/work/${w.id}/move`, { to: 'done' });
    return w.id as string;
  };
  return { c, fuel, fee, work };
}

describe('invoices from finished work', () => {
  it('bills finished work once, exactly, with tax on taxable lines', async () => {
    const t = await team();
    const s = await setup(t, { tax: '8.25' });
    const w = await s.work('187.4');
    expect((await t.priya.get(`/c/${t.cid}/money/ready`)).body.work.map((x: any) => x.id)).toEqual([w]);
    const inv = await t.priya.post(`/c/${t.cid}/invoices`, { workIds: [w] });
    expect(inv.status).toBe(200);
    expect(inv.body.status).toBe('draft');
    const d = (await t.priya.get(`/c/${t.cid}/invoices/${inv.body.id}`)).body;
    // 187.4 gal × $3.8995 = $730.7663 → $730.77; fee $45; tax 8.25% of the taxable fuel only.
    expect(d.lines.map((l: any) => l.amountMinor)).toEqual([73077, 4500]);
    expect(d.invoice).toMatchObject({ subtotalMinor: 77577, taxMinor: 6029, totalMinor: 83606 });
    expect((await t.priya.post(`/c/${t.cid}/invoices`, { workIds: [w] })).status).toBe(409);
    expect((await t.priya.get(`/c/${t.cid}/money/ready`)).body.work).toEqual([]);
  });

  it('holds an invoice with a missing price, then clears the hold once the price is set', async () => {
    const t = await team();
    const s = await setup(t, { price: false, tax: '8.25' });
    const w = await s.work('100');
    const inv = (await t.priya.post(`/c/${t.cid}/invoices`, { workIds: [w] })).body;
    expect(inv.status).toBe('held');
    expect(inv.holds[0]).toBe('No price is set for "Fuel delivery". Add it before this invoice can be approved.');
    const d = (await t.priya.get(`/c/${t.cid}/invoices/${inv.id}`)).body;
    expect(d.invoice.totalMinor).toBeNull();
    expect((await t.priya.post(`/c/${t.cid}/invoices/${inv.id}/approve`, { version: d.invoice.version })).status).toBe(409);
    expect((await t.priya.post(`/c/${t.cid}/invoices/${inv.id}/issue`)).status).toBe(409);
    await t.dana.patch(`/c/${t.cid}/catalog/${s.fuel.id}`, { rate: '4' });
    const r = await t.priya.post(`/c/${t.cid}/invoices/${inv.id}/refresh`);
    expect(r.body).toMatchObject({ status: 'draft', holds: [] });
    expect((await t.priya.get(`/c/${t.cid}/invoices/${inv.id}`)).body.invoice.totalMinor).toBe(40000 + 4500 + 3300);
  });

  it('holds taxable work until a tax rate is set, and a tax-exempt customer pays none', async () => {
    const t = await team();
    const s = await setup(t);
    const inv = (await t.priya.post(`/c/${t.cid}/invoices`, { workIds: [await s.work('10')] })).body;
    expect(inv.status).toBe('held');
    expect(inv.holds).toContain('Some lines are taxable but no tax rate is set. Set it in Money, Prices.');
    await t.dana.patch(`/c/${t.cid}/customers/${s.c}`, { taxExempt: true, version: 1 });
    const exempt = (await t.priya.post(`/c/${t.cid}/invoices`, { workIds: [await s.work('10')] })).body;
    expect(exempt.status).toBe('draft');
  });

  it('approves, issues with a number, records payments and ages what is owed', async () => {
    const t = await team();
    const s = await setup(t, { tax: '0' });
    const inv = (await t.priya.post(`/c/${t.cid}/invoices`, { workIds: [await s.work('100')] })).body;
    let d = (await t.priya.get(`/c/${t.cid}/invoices/${inv.id}`)).body;
    expect((await t.priya.post(`/c/${t.cid}/invoices/${inv.id}/issue`)).body.error.message).toBe('This invoice needs approving before it is issued.');
    expect((await t.priya.post(`/c/${t.cid}/invoices/${inv.id}/approve`, { version: d.invoice.version })).status).toBe(200);
    const issued = await t.priya.post(`/c/${t.cid}/invoices/${inv.id}/issue`);
    expect(issued.body.number).toBe('INV-00001');
    d = (await t.priya.get(`/c/${t.cid}/invoices/${inv.id}`)).body;
    expect(d.invoice.totalMinor).toBe(43495);
    const over = await t.priya.post(`/c/${t.cid}/invoices/${inv.id}/payments`, { amount: '500', method: 'check' });
    expect(over.status).toBe(400);
    expect(over.body.error.message).toBe('That is more than the $434.95 still owed.');
    expect((await t.priya.post(`/c/${t.cid}/invoices/${inv.id}/payments`, { amount: '100', method: 'cash' })).body.status).toBe('partially_paid');
    const sum = (await t.priya.get(`/c/${t.cid}/money/summary`)).body;
    expect(sum.owedMinor).toBe(33495);
    expect(sum.aging.find((a: any) => a.key === 'current').minor).toBe(33495);
    expect((await t.dana.get(`/c/${t.cid}/customers/${s.c}`)).body.owesMinor).toBe(33495);
    // Voiding needs the payments undone first; an issued invoice keeps its number.
    expect((await t.priya.post(`/c/${t.cid}/invoices/${inv.id}/void`, { reason: 'Wrong customer' })).status).toBe(409);
    const pay = d.payments.length ? d.payments[0] : (await t.priya.get(`/c/${t.cid}/invoices/${inv.id}`)).body.payments[0];
    await t.priya.post(`/c/${t.cid}/payments/${pay.id}/void`);
    expect((await t.priya.post(`/c/${t.cid}/invoices/${inv.id}/void`, { reason: 'Wrong customer' })).status).toBe(200);
    const v = (await t.priya.get(`/c/${t.cid}/invoices/${inv.id}`)).body.invoice;
    expect(v).toMatchObject({ status: 'void', number: 'INV-00001' });
    expect((await t.priya.get(`/c/${t.cid}/money/ready`)).body.work.length).toBe(1);
  });

  it('an approval is for the amounts seen: changing the invoice needs approving again', async () => {
    const t = await team();
    const s = await setup(t, { tax: '0' });
    const inv = (await t.priya.post(`/c/${t.cid}/invoices`, { workIds: [await s.work('10')] })).body;
    const v1 = (await t.priya.get(`/c/${t.cid}/invoices/${inv.id}`)).body.invoice.version;
    await t.priya.post(`/c/${t.cid}/invoices/${inv.id}/approve`, { version: v1 });
    const d = (await t.priya.get(`/c/${t.cid}/invoices/${inv.id}`)).body;
    const lines = d.lines.map((l: any) => ({ description: l.description, quantity: l.quantity, unit: l.unit, rate: '5', taxable: l.taxable }));
    expect((await t.priya.put(`/c/${t.cid}/invoices/${inv.id}`, { version: d.invoice.version, lines })).body.status).toBe('draft');
    expect((await t.priya.post(`/c/${t.cid}/invoices/${inv.id}/approve`, { version: d.invoice.version })).status).toBe(409);
  });

  it('only money roles see invoices, and other workspaces get 404', async () => {
    const t = await team();
    const s = await setup(t, { tax: '0' });
    const inv = (await t.priya.post(`/c/${t.cid}/invoices`, { workIds: [await s.work('10')] })).body;
    for (const who of [t.marcus, t.luis]) {
      expect((await who.get(`/c/${t.cid}/invoices`)).status).toBe(403);
      expect((await who.get(`/c/${t.cid}/invoices/${inv.id}`)).status).toBe(403);
      expect((await who.get(`/c/${t.cid}/money/summary`)).status).toBe(403);
    }
    expect((await t.marcus.post(`/c/${t.cid}/invoices/${inv.id}/approve`, { version: 1 })).status).toBe(403);
    const other = await signup();
    const ocid = await newCompany(other);
    expect((await other.get(`/c/${ocid}/invoices/${inv.id}`)).status).toBe(404);
    expect((await other.post(`/c/${ocid}/invoices`, { workIds: [inv.id] })).status).toBe(400);
  });

  it('invoice numbers continue from a previous system and only move forward', async () => {
    const t = await team();
    expect((await t.dana.patch(`/c/${t.cid}/money/settings`, { invoicePrefix: 'TC-', nextNumber: 1042 })).status).toBe(200);
    expect((await t.dana.patch(`/c/${t.cid}/money/settings`, { nextNumber: 5 })).status).toBe(400);
    expect((await t.priya.patch(`/c/${t.cid}/money/settings`, { approvalRequired: false })).status).toBe(403);
    expect((await t.dana.get(`/c/${t.cid}/money/settings`)).body).toMatchObject({ invoicePrefix: 'TC-', nextNumber: 1042 });
  });
});
