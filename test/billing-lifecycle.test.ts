import { describe, it, expect } from 'vitest';
import { resolveDiscounts, computeTotals, type DraftLine } from '../src/shared/billing.js';
import { agingBucket, reminderStage, paymentState, dueDateFor, balanceDue } from '../src/shared/invoices.js';
import { localDate, addDays } from '../src/shared/schedule.js';
import { triCounty, type TriCounty } from './fixtures/tricounty.js';
import { rid, getDb, processAll } from './helpers.js';

const charge = (amountMinor: number, taxable = false): DraftLine => ({ description: 'Charge', quantity: '1', unit: '', rateE4: amountMinor * 100, amountMinor, taxable, kind: 'charge' });
const discount = (p: Partial<DraftLine>): DraftLine => ({ description: 'Discount', quantity: '1', unit: '', rateE4: null, amountMinor: null, taxable: false, kind: 'discount', ...p });
const chicagoToday = () => localDate(new Date(), 'America/Chicago');

describe('billing rules (shared)', () => {
  it('percent and fixed discounts, refused above the charges unless the invoice is made free (R10-M1)', () => {
    const pct = resolveDiscounts([charge(32700), discount({ percentBp: 1000 })]);
    expect(pct.lines[1].amountMinor).toBe(-3270);
    expect(computeTotals(pct.lines, null).totalMinor).toBe(29430);
    const big = resolveDiscounts([charge(32700), discount({ rateE4: 5_000 * 10_000 })]);
    expect(big.excessMinor).toBe(500_000 - 32700);
    const free = resolveDiscounts([charge(32700), discount({ rateE4: 5_000 * 10_000 })], { allowFree: true });
    expect(free.excessMinor).toBe(0);
    // The printed lines add up to the total: $327.00 − $327.00 = $0.00.
    expect(free.lines.reduce((s, l) => s + (l.amountMinor ?? 0), 0)).toBe(0);
    expect(computeTotals(free.lines, null)).toMatchObject({ totalMinor: 0, holdReasons: [] });
  });

  it('due dates, balances, one payment status, aging buckets and reminder days (D18, D19)', () => {
    expect(dueDateFor('2026-10-06', 30)).toBe('2026-11-05');
    expect(dueDateFor('2026-10-06', 0)).toBe('2026-10-06');
    expect(balanceDue({ totalMinor: 10000, paidMinor: 2500, creditedMinor: 1000 })).toBe(6500);
    expect(balanceDue({ totalMinor: 10000, paidMinor: 12000 })).toBe(0);
    expect(paymentState({ status: 'issued', paymentStatus: 'partially_paid', dueDate: '2026-10-01' }, '2026-10-06')).toMatchObject({ key: 'overdue', label: 'Overdue 5 days' });
    expect(paymentState({ status: 'issued', paymentStatus: 'paid', dueDate: '2026-10-01' }, '2026-10-06').label).toBe('Paid');
    expect(paymentState({ status: 'void', paymentStatus: 'unpaid' }, '2026-10-06').label).toBe('Void');
    expect(['2026-10-06', '2026-10-05', '2026-09-06', '2026-09-05', '2026-08-01'].map((d) => agingBucket(d, '2026-10-06'))).toEqual(['current', 'd1_30', 'd1_30', 'd31_60', 'd60_plus']);
    expect(['2026-10-09', '2026-10-10', '2026-10-06', '2026-09-29', '2026-09-06'].map((d) => reminderStage(d, '2026-10-06'))).toEqual(['due_soon', null, null, 'overdue_7', 'overdue_30']);
  });
});

async function fuelJob(t: TriCounty, customer = 'grace', qty = '100') {
  const c = t.customers[customer];
  const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel', requested_qty: qty }, intent: 'open', clientRequestId: rid(), scheduledStart: new Date(Date.now() + 3600_000).toISOString() });
  const job = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
  const a = await t.dana.post(`/c/${t.cid}/jobs/${job.id}/assign`, { userId: t.ids.luis, resourceIds: [t.trucks['Tank wagon 1']], version: job.version });
  return { id: job.id as string, version: a.body.version as number };
}
async function completeJob(t: TriCounty, job: { id: string; version: number }, extra: Record<string, unknown> = {}, qty = '100') {
  const r = await t.luis.post(`/c/${t.cid}/jobs/${job.id}/complete`, { submissionId: extra.submissionId ?? rid(), baseVersion: job.version, outcome: 'completed', values: { delivered_qty: qty }, ...extra });
  expect(r.status).toBe(200);
  return r;
}
async function issue(t: TriCounty, invoiceId: string) {
  let d = (await t.dana.get(`/c/${t.cid}/invoices/${invoiceId}`)).body;
  expect((await t.dana.post(`/c/${t.cid}/invoices/${invoiceId}/approve`, { version: d.invoice.version })).status).toBe(200);
  d = (await t.dana.get(`/c/${t.cid}/invoices/${invoiceId}`)).body;
  const r = await t.dana.post(`/c/${t.cid}/invoices/${invoiceId}/issue`, { version: d.invoice.version });
  expect(r.status).toBe(200);
  return (await t.dana.get(`/c/${t.cid}/invoices/${invoiceId}`)).body;
}
async function issuedFuelInvoice(t: TriCounty, customer = 'grace') {
  const j = await fuelJob(t, customer);
  await completeJob(t, j);
  const inv = (await t.dana.post(`/c/${t.cid}/jobs/${j.id}/invoice`)).body;
  return { job: j, invoiceId: inv.invoiceId as string, detail: await issue(t, inv.invoiceId) };
}
const pay = (t: TriCounty, invoiceId: string, amountMinor: number, extra: Record<string, unknown> = {}) =>
  t.priya.post(`/c/${t.cid}/invoices/${invoiceId}/payments`, { amountMinor, method: 'check', reference: '1001', idempotencyKey: rid(), ...extra });

describe('billing lifecycle with the fixture company', () => {
  it('a voided invoice no longer blocks the job: a replacement is prepared and linked both ways (R10-C1)', async () => {
    const t = await triCounty();
    const { job, invoiceId } = await issuedFuelInvoice(t);
    expect((await t.dana.post(`/c/${t.cid}/invoices/${invoiceId}/void`, { reason: 'Wrong product' })).status).toBe(200);
    const jd = (await t.dana.get(`/c/${t.cid}/jobs/${job.id}`)).body;
    expect(jd.invoice).toBeNull();
    expect(jd.voidedInvoices.map((i: any) => i.id)).toEqual([invoiceId]);
    expect(jd.can.prepareInvoice).toBe(true);
    const old = (await t.dana.get(`/c/${t.cid}/invoices/${invoiceId}`)).body;
    expect(old.can.prepareReplacement).toBe(true);
    const again = await t.dana.post(`/c/${t.cid}/invoices/${invoiceId}/replacement`);
    expect(again.status).toBe(200);
    expect(again.body.invoiceId).not.toBe(invoiceId);
    const fresh = (await t.dana.get(`/c/${t.cid}/invoices/${again.body.invoiceId}`)).body;
    expect(fresh.replaces).toMatchObject({ id: invoiceId, number: old.invoice.number });
    expect((await t.dana.get(`/c/${t.cid}/invoices/${invoiceId}`)).body.replacedBy.id).toBe(again.body.invoiceId);
    // Preparing again returns the same replacement: never billed twice.
    expect((await t.dana.post(`/c/${t.cid}/jobs/${job.id}/invoice`)).body.invoiceId).toBe(again.body.invoiceId);
  });

  it('discounts: percent off, refusing more than the charges, and an explicit free invoice (R10-M1)', async () => {
    const t = await triCounty();
    const j = await fuelJob(t);
    await completeJob(t, j);
    const inv = (await t.dana.post(`/c/${t.cid}/jobs/${j.id}/invoice`)).body;
    let d = (await t.dana.get(`/c/${t.cid}/invoices/${inv.invoiceId}`)).body;
    const lines = d.lines.map(({ id, description, quantity, unit, rateE4, taxable, kind }: any) => ({ id, description, quantity, unit, rateE4, taxable, kind }));
    const tenPct = await t.dana.put(`/c/${t.cid}/invoices/${inv.invoiceId}/lines`, { version: d.invoice.version, lines: [...lines, { description: 'Loyal customer', quantity: '1', rateE4: null, kind: 'discount', percentBp: 1000 }] });
    expect(tenPct.status).toBe(200);
    d = (await t.dana.get(`/c/${t.cid}/invoices/${inv.invoiceId}`)).body;
    expect(d.lines[2]).toMatchObject({ description: 'Loyal customer', percentBp: 1000, amountMinor: -4149 });
    expect(d.invoice).toMatchObject({ subtotalMinor: 41490, discountMinor: 4149 });
    const huge = await t.dana.put(`/c/${t.cid}/invoices/${inv.invoiceId}/lines`, { version: d.invoice.version, lines: [...lines, { description: 'Goodwill', quantity: '1', rateE4: 50_000_000, kind: 'discount' }] });
    expect(huge.status).toBe(400);
    expect(huge.body.error.details.freeConfirm).toBe(true);
    expect(huge.body.error.message).toMatch(/\$4,585\.10 more than the charges/);
    const free = await t.dana.put(`/c/${t.cid}/invoices/${inv.invoiceId}/lines`, { version: d.invoice.version, allowFree: true, lines: [...lines, { description: 'Goodwill', quantity: '1', rateE4: 50_000_000, kind: 'discount' }] });
    expect(free.status).toBe(200);
    d = (await t.dana.get(`/c/${t.cid}/invoices/${inv.invoiceId}`)).body;
    expect(d.invoice).toMatchObject({ totalMinor: 0, taxMinor: 0, freeConfirmed: true });
    expect(d.lines.reduce((s: number, l: any) => s + l.amountMinor, 0)).toBe(0);
  });

  it('issued invoices and finished jobs keep the address and name they had; open jobs change only when asked (R10-M4, R5-M3)', async () => {
    const t = await triCounty();
    const { job, invoiceId } = await issuedFuelInvoice(t);
    const open = await fuelJob(t);
    const openJob2 = await fuelJob(t);
    const g = t.customers.grace;
    const cust = (await t.dana.get(`/c/${t.cid}/customers/${g.id}`)).body;
    expect(cust.locations[0].open_jobs).toBe(2);
    expect((await t.dana.patch(`/c/${t.cid}/locations/${g.locationId}`, { address: '900 New Rd, Fairview' })).body.updatedJobs).toBe(0);
    await t.dana.patch(`/c/${t.cid}/customers/${g.id}`, { name: 'Grace Okafor-Lee', version: cust.customer.version });
    const inv = (await t.dana.get(`/c/${t.cid}/invoices/${invoiceId}`)).body.invoice;
    expect(inv).toMatchObject({ customerName: 'Grace Okafor', locationAddress: '812 Willow Ln, Fairview' });
    const done = (await t.dana.get(`/c/${t.cid}/jobs/${job.id}`)).body.location;
    expect(done).toMatchObject({ address: '812 Willow Ln, Fairview', current_address: '900 New Rd, Fairview' });
    expect((await t.dana.get(`/c/${t.cid}/jobs/${open.id}`)).body.location.address).toBe('812 Willow Ln, Fairview');
    // "Also update the open jobs": they move to the new address and their driver is told.
    const upd = await t.dana.patch(`/c/${t.cid}/locations/${g.locationId}`, { address: '901 New Rd, Fairview', updateOpenJobs: true });
    expect(upd.body.updatedJobs).toBe(2);
    expect((await t.dana.get(`/c/${t.cid}/jobs/${openJob2.id}`)).body.location).toMatchObject({ address: '901 New Rd, Fairview', current_address: null });
    expect((await t.luis.get(`/c/${t.cid}/my/jobs`)).body.jobs.find((x: any) => x.id === open.id).address).toBe('901 New Rd, Fairview');
    expect((await t.dana.get(`/c/${t.cid}/jobs/${job.id}`)).body.location.address).toBe('812 Willow Ln, Fairview');
    const notes = (await t.luis.get(`/c/${t.cid}/notifications`)).body;
    expect(JSON.stringify(notes)).toMatch(/New address: 901 New Rd, Fairview/);
  });

  it('due date from the customer terms, dated payments, balance due, overpayment credit used on the next invoice (D6, D18, R6-m2)', async () => {
    const t = await triCounty();
    const cust = (await t.dana.get(`/c/${t.cid}/customers/${t.customers.grace.id}`)).body.customer;
    expect((await t.dana.patch(`/c/${t.cid}/customers/${cust.id}`, { paymentTermsDays: 15, version: cust.version })).status).toBe(200);
    const { invoiceId, detail } = await issuedFuelInvoice(t);
    expect(detail.invoice).toMatchObject({ dueDate: addDays(chicagoToday(), 15), termsLabel: 'Net 15', balanceMinor: 44498, payment: { key: 'unpaid' } });
    expect(detail.can.pay).toBe(true);
    const future = await pay(t, invoiceId, 1000, { paidOn: addDays(chicagoToday(), 2) });
    expect(future.status).toBe(400);
    const part = await pay(t, invoiceId, 20000, { paidOn: addDays(chicagoToday(), -3) });
    expect(part.body).toMatchObject({ appliedMinor: 20000, creditMinor: 0 });
    let d = (await t.dana.get(`/c/${t.cid}/invoices/${invoiceId}`)).body;
    expect(d.invoice).toMatchObject({ paidMinor: 20000, balanceMinor: 24498, payment: { key: 'partly_paid' } });
    expect(d.payments[0]).toMatchObject({ paidOn: addDays(chicagoToday(), -3), reference: '1001', methodLabel: 'Check', state: 'confirmed' });
    // $300 against a $244.98 balance: the extra $55.02 becomes credit (it isn't refused).
    const over = await pay(t, invoiceId, 30000);
    expect(over.body).toMatchObject({ appliedMinor: 24498, creditMinor: 5502 });
    d = (await t.dana.get(`/c/${t.cid}/invoices/${invoiceId}`)).body;
    expect(d.invoice).toMatchObject({ balanceMinor: 0, payment: { key: 'paid', label: 'Paid' } });
    expect((await t.dana.get(`/c/${t.cid}/customers/${cust.id}/account`)).body.creditMinor).toBe(5502);
    // The next invoice uses the credit when it's issued.
    const next = await issuedFuelInvoice(t);
    expect(next.detail.invoice).toMatchObject({ creditedMinor: 5502, balanceMinor: 44498 - 5502 });
    expect(next.detail.credits[0]).toMatchObject({ source: 'customer_credit', amountMinor: 5502 });
    expect((await t.dana.get(`/c/${t.cid}/customers/${cust.id}/account`)).body.creditMinor).toBe(0);
  });

  it('only an owner rejects a payment; it stops counting, its credit is reversed and the history stays (D6)', async () => {
    const t = await triCounty();
    const { invoiceId } = await issuedFuelInvoice(t);
    await pay(t, invoiceId, 50000);
    let d = (await t.dana.get(`/c/${t.cid}/invoices/${invoiceId}`)).body;
    const p = d.payments[0];
    expect((await t.priya.post(`/c/${t.cid}/payments/${p.id}/reject`, { reason: 'Bounced check' })).status).toBe(403);
    expect((await t.dana.post(`/c/${t.cid}/payments/${p.id}/reject`, { reason: 'Bounced check' })).status).toBe(200);
    d = (await t.dana.get(`/c/${t.cid}/invoices/${invoiceId}`)).body;
    expect(d.invoice).toMatchObject({ paidMinor: 0, balanceMinor: 44498, payment: { key: 'unpaid' } });
    expect(d.payments[0]).toMatchObject({ state: 'rejected', rejectedReason: 'Bounced check' });
    expect((await t.dana.get(`/c/${t.cid}/customers/${t.customers.grace.id}/account`)).body.creditMinor).toBe(0);
  });

  it('void is explained while paid; refund, then void; credit notes take off the balance (R10-m2)', async () => {
    const t = await triCounty();
    const { invoiceId } = await issuedFuelInvoice(t);
    await pay(t, invoiceId, 10000);
    let d = (await t.dana.get(`/c/${t.cid}/invoices/${invoiceId}`)).body;
    expect(d.can.void).toBe(false);
    expect(d.can.voidBlocked).toMatch(/Refund them first/);
    expect((await t.dana.post(`/c/${t.cid}/invoices/${invoiceId}/credit-notes`, { amountMinor: 4498, note: 'Late delivery' })).status).toBe(200);
    d = (await t.dana.get(`/c/${t.cid}/invoices/${invoiceId}`)).body;
    expect(d.invoice).toMatchObject({ creditedMinor: 4498, balanceMinor: 30000 });
    expect((await t.dana.post(`/c/${t.cid}/invoices/${invoiceId}/credit-notes`, { amountMinor: 30001, note: 'Too much' })).status).toBe(400);
    expect((await t.priya.post(`/c/${t.cid}/invoices/${invoiceId}/refunds`, { amountMinor: 10000, method: 'check', note: 'Wrong invoice', idempotencyKey: rid() })).status).toBe(200);
    d = (await t.dana.get(`/c/${t.cid}/invoices/${invoiceId}`)).body;
    expect(d.invoice.paidMinor).toBe(0);
    expect(d.can.void).toBe(true);
    expect((await t.dana.post(`/c/${t.cid}/invoices/${invoiceId}/void`, { reason: 'Re-billing' })).status).toBe(200);
  });

  it('money collected at the stop waits for the office, then pays the invoice once (D21)', async () => {
    const t = await triCounty();
    const j = await fuelJob(t);
    const noNumber = await t.luis.post(`/c/${t.cid}/jobs/${j.id}/complete`, { submissionId: rid(), baseVersion: j.version, outcome: 'completed', values: { delivered_qty: '100' }, collected: { method: 'check', amountMinor: 44498 } });
    expect(noNumber.status).toBe(400);
    const sub = rid();
    await completeJob(t, j, { submissionId: sub, collected: { method: 'check', amountMinor: 44498, reference: '5521' } });
    // The same submission again (a retry) records nothing new.
    const again = await t.luis.post(`/c/${t.cid}/jobs/${j.id}/complete`, { submissionId: sub, baseVersion: j.version, outcome: 'completed', values: { delivered_qty: '100' }, collected: { method: 'check', amountMinor: 44498, reference: '5521' } });
    expect(again.body.duplicate).toBe(true);
    const col = (await t.priya.get(`/c/${t.cid}/collections`)).body;
    expect(col.unconfirmed).toHaveLength(1);
    expect(col.unconfirmed[0]).toMatchObject({ amountMinor: 44498, method: 'Check', reference: '5521', recordedByName: 'Luis' });
    // The driver sees no invoice amounts.
    expect(JSON.stringify((await t.luis.get(`/c/${t.cid}/my/jobs`)).body)).not.toMatch(/44498/);
    const inv = (await t.dana.post(`/c/${t.cid}/jobs/${j.id}/invoice`)).body;
    expect((await t.priya.post(`/c/${t.cid}/payments/${col.unconfirmed[0].id}/confirm`)).body.waitingForInvoice).toBe(true);
    const d = await issue(t, inv.invoiceId);
    expect(d.invoice).toMatchObject({ paidMinor: 44498, balanceMinor: 0, payment: { key: 'paid' } });
    expect(d.payments).toHaveLength(1);
    expect(d.payments[0]).toMatchObject({ collectedAtStop: true, state: 'confirmed' });
  });

  it('a hand-made invoice is sent for approval, and the approver issues it (R8-M3, R6-M3)', async () => {
    const t = await triCounty();
    const c = t.customers.brigid;
    const r = await t.priya.post(`/c/${t.cid}/invoices`, { customerId: c.id, locationId: c.locationId, clientRequestId: rid(), lines: [{ description: 'Generator tank inspection', quantity: '1', rateE4: 950_000, taxable: false, kind: 'charge' }] });
    expect(r.status).toBe(200);
    let d = (await t.priya.get(`/c/${t.cid}/invoices/${r.body.id}`)).body;
    expect(d.invoice).toMatchObject({ kind: 'manual', status: 'draft', totalMinor: 9500, locationAddress: '1 Church St, Millbrook' });
    expect(d.can.submit).toBe(true);
    expect((await t.priya.post(`/c/${t.cid}/invoices/${r.body.id}/submit`, { version: d.invoice.version })).status).toBe(200);
    d = (await t.priya.get(`/c/${t.cid}/invoices/${r.body.id}`)).body;
    expect(d.invoice.status).toBe('pending_approval');
    const ap = (await t.dana.get(`/c/${t.cid}/approvals`)).body.approvals.find((a: any) => a.subject_id === r.body.id);
    expect(ap).toBeTruthy();
    expect((await t.dana.post(`/c/${t.cid}/approvals/${ap.id}/decide`, { decision: 'approve' })).status).toBe(200);
    await processAll();
    d = (await t.dana.get(`/c/${t.cid}/invoices/${r.body.id}`)).body;
    expect(d.invoice.status).toBe('issued');
    expect(d.invoice.number).toMatch(/^INV-/);
  });

  it('invoice numbers continue from the previous system and only move forward (D17)', async () => {
    const t = await triCounty();
    expect((await t.dana.patch(`/c/${t.cid}/settings`, { invoicePrefix: 'TC-', nextInvoiceNumber: 1042, remitTo: 'PO Box 9, Millbrook', taxId: '12-3456789' })).status).toBe(200);
    const { detail } = await issuedFuelInvoice(t);
    expect(detail.invoice.number).toBe('TC-01042');
    expect(detail.company).toMatchObject({ remitTo: 'PO Box 9, Millbrook', taxId: '12-3456789' });
    const back = await t.dana.patch(`/c/${t.cid}/settings`, { nextInvoiceNumber: 1000 });
    expect(back.status).toBe(400);
    expect(back.body.error.message).toMatch(/1043 or higher/);
  });

  it('the invoice email has lines, balance, due date and an expiring view link that stops working on void (R2-m9, R15-m4)', async () => {
    const t = await triCounty();
    const { invoiceId, detail } = await issuedFuelInvoice(t);
    await pay(t, invoiceId, 10000);
    const m = await t.dana.post(`/c/${t.cid}/invoices/${invoiceId}/email`);
    const msg = (await t.dana.get(`/c/${t.cid}/messages`)).body.messages.find((x: any) => x.id === m.body.messageId);
    expect(msg.body).toMatch(/Diesel: 100 gal × \$3\.899 = \$389\.90/);
    expect(msg.body).toMatch(/Balance due: \$344\.98/);
    expect(msg.body).toMatch(/Due: .* \(Net 30\)/);
    const token = /\/i\/([A-Za-z0-9_-]+)/.exec(msg.body)![1];
    const view = await t.dana.get(`/public/invoices/${token}`);
    expect(view.status).toBe(200);
    expect(view.body.invoice).toMatchObject({ number: detail.invoice.number, balanceMinor: 34498, customerName: 'Grace Okafor' });
    expect(JSON.stringify(view.body)).not.toMatch(/Price changed|grace@example/);
    expect((await t.dana.get(`/public/invoices/${token.slice(0, -2)}xx`)).status).toBe(404);
    await t.priya.post(`/c/${t.cid}/invoices/${invoiceId}/refunds`, { amountMinor: 10000, method: 'check', note: 'Re-billing', idempotencyKey: rid() });
    await t.dana.post(`/c/${t.cid}/invoices/${invoiceId}/void`, { reason: 'Re-billing' });
    expect((await t.dana.get(`/public/invoices/${token}`)).body.unavailable).toBe(true);
  });

  it('collections: aging by customer, reminders prepared for approval, monthly statements with totals (R10-M3, D19, D20)', async () => {
    const t = await triCounty();
    const a = await issuedFuelInvoice(t, 'grace');
    const b = await issuedFuelInvoice(t, 'ridgeline');
    const db = await getDb();
    // Make one 40 days overdue and the other due in 2 days.
    await db.query(`update rigo.invoices set due_date = $2 where id = $1`, [a.invoiceId, addDays(chicagoToday(), -40)]);
    await db.query(`update rigo.invoices set due_date = $2 where id = $1`, [b.invoiceId, addDays(chicagoToday(), 2)]);
    let col = (await t.priya.get(`/c/${t.cid}/collections`)).body;
    expect(col.totals).toMatchObject({ current: 44498, d31_60: 44498 });
    expect(col.customers.map((c: any) => c.customerName).sort()).toEqual(['Grace Okafor', 'Ridgeline Construction']);
    expect((await t.priya.post(`/c/${t.cid}/collections/prepare`)).body.reminders).toBe(2);
    expect((await t.priya.post(`/c/${t.cid}/collections/prepare`)).body.reminders).toBe(0);
    col = (await t.priya.get(`/c/${t.cid}/collections`)).body;
    expect(col.reminders.map((r: any) => r.stage).sort()).toEqual(['30 days overdue', 'Due in 3 days']);
    const overdue = col.reminders.find((r: any) => r.stage === '30 days overdue');
    expect((await t.priya.post(`/c/${t.cid}/messages/${overdue.id}/skip`)).status).toBe(200);
    // Statements: open invoices, aging and total due.
    const st = await t.priya.post(`/c/${t.cid}/customers/${t.customers.grace.id}/statements`);
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ totalDueMinor: 44498, aging: { d31_60: 44498 } });
    const view = (await t.priya.get(`/c/${t.cid}/statements/${st.body.statementId}`)).body;
    expect(view.statement.openInvoices[0].number).toBe(a.detail.invoice.number);
    // Drivers and dispatchers without finance access see none of it.
    expect((await t.marcus.get(`/c/${t.cid}/collections`)).status).toBe(403);
    expect((await t.luis.get(`/c/${t.cid}/statements/${st.body.statementId}`)).status).toBe(403);
  });

  it('deposits become credit that pays the next invoice (R8-M3, D22)', async () => {
    const t = await triCounty();
    const h = t.customers.harbor;
    expect((await t.priya.post(`/c/${t.cid}/customers/${h.id}/deposits`, { amountMinor: 20000, method: 'card', idempotencyKey: rid() })).status).toBe(200);
    const acct = (await t.priya.get(`/c/${t.cid}/customers/${h.id}/account`)).body;
    expect(acct.creditMinor).toBe(20000);
    expect(acct.history[0]).toMatchObject({ kind: 'deposit', amountMinor: 20000 });
    const { detail } = await issuedFuelInvoice(t, 'harbor');
    expect(detail.invoice).toMatchObject({ creditedMinor: 20000, balanceMinor: 24498 });
  });
});
