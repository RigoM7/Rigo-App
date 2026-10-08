import { describe, it, expect, vi, afterEach } from 'vitest';
import { getDb } from './helpers.js';
import { team, type Team } from './fixtures/team.js';
import { effectiveLevel } from '../src/shared/automation.js';
import { runDueReminders } from '../src/server/modules/automation.js';

// Step 7: assisted automation and the approvals inbox. Rigo prepares, a person approves; owners
// choose levels, pause everything and take over. Nothing approves itself.

afterEach(() => vi.restoreAllMocks());

async function finishedWork(t: Team, opts: { priced?: boolean } = {}) {
  const items = (await t.dana.get(`/c/${t.cid}/catalog`)).body.items;
  const svc = items.find((i: any) => i.name === 'Septic pump-out');
  if (opts.priced !== false) await t.dana.patch(`/c/${t.cid}/catalog/${svc.id}`, { rate: '375' });
  const tag = Math.random().toString(36).slice(2, 8);
  const c = (await t.dana.post(`/c/${t.cid}/customers`, { name: `Customer ${tag}`, email: `${tag}@example.test`, allowDuplicate: true })).body.id;
  const w = (await t.marcus.post(`/c/${t.cid}/work`, { title: 'Pump-out', clientId: c, assignees: [t.ids.luis], lines: [{ catalogId: svc.id, description: 'Septic pump-out', quantity: '1' }] })).body;
  await t.luis.post(`/c/${t.cid}/work/${w.id}/move`, { to: 'in_progress' });
  await t.luis.post(`/c/${t.cid}/work/${w.id}/move`, { to: 'done' });
  return { workId: w.id as string, clientId: c as string };
}

describe('levels', () => {
  it('the safest level wins', () => {
    expect(effectiveLevel('assisted', 'automatic')).toBe('assisted');
    expect(effectiveLevel('automatic', 'manual')).toBe('manual');
    expect(effectiveLevel('manual', 'assisted')).toBe('manual');
    expect(effectiveLevel('automatic', 'off')).toBe('off');
  });
});

describe('assisted by default', () => {
  it('a worker finishing work makes Rigo prepare an invoice; a person approves it in the inbox', async () => {
    const t = await team();
    const { workId } = await finishedWork(t);
    const inbox = (await t.priya.get(`/c/${t.cid}/inbox`)).body;
    expect(inbox.approvals).toHaveLength(1);
    expect(inbox.approvals[0]).toMatchObject({ kind: 'invoice', status: 'waiting', level: 'assisted', total_minor: 37500 });
    // The driver and the dispatcher can't decide money; the invoice isn't approved by itself.
    expect((await t.luis.get(`/c/${t.cid}/inbox`)).body.approvals).toEqual([]);
    expect((await t.marcus.post(`/c/${t.cid}/inbox/${inbox.approvals[0].id}/approve`, {})).status).toBe(403);
    const inv = (await t.priya.get(`/c/${t.cid}/invoices/${inbox.approvals[0].subject_id}`)).body.invoice;
    expect(inv).toMatchObject({ status: 'draft', preparedBy: 'rigo' });
    expect((await t.priya.post(`/c/${t.cid}/inbox/${inbox.approvals[0].id}/approve`, { invoiceVersion: inv.version })).status).toBe(200);
    expect((await t.priya.get(`/c/${t.cid}/invoices/${inv.id}`)).body.invoice).toMatchObject({ status: 'approved', approvedBy: 'Priya' });
    // Assisted never issues: a person does that.
    expect((await t.priya.get(`/c/${t.cid}/invoices/${inv.id}`)).body.invoice.number).toBeNull();
    // Finishing it again never makes a second invoice.
    await t.dana.post(`/c/${t.cid}/work/${workId}/move`, { to: 'done' });
    expect((await t.priya.get(`/c/${t.cid}/inbox`)).body.approvals).toHaveLength(0);
  });

  it('a prepared invoice with a missing price shows as held, not ready to approve', async () => {
    const t = await team();
    await finishedWork(t, { priced: false });
    const inbox = (await t.priya.get(`/c/${t.cid}/inbox`)).body;
    expect(inbox.held).toHaveLength(1);
    expect(inbox.approvals[0].summary).toMatch(/^Held: No price is set/);
    expect((await t.priya.post(`/c/${t.cid}/inbox/${inbox.approvals[0].id}/approve`, {})).status).toBe(409);
  });

  it('rejecting puts the work back to be billed by a person; taking over stops Rigo on it', async () => {
    const t = await team();
    const a = await finishedWork(t);
    let inbox = (await t.priya.get(`/c/${t.cid}/inbox`)).body;
    expect((await t.priya.post(`/c/${t.cid}/inbox/${inbox.approvals[0].id}/reject`, { reason: 'Bill monthly' })).status).toBe(200);
    expect((await t.priya.get(`/c/${t.cid}/money/ready`)).body.work.map((w: any) => w.id)).toEqual([a.workId]);
    expect((await t.priya.get(`/c/${t.cid}/invoices/${inbox.approvals[0].subject_id}`)).status).toBe(404);
    await finishedWork(t);
    inbox = (await t.priya.get(`/c/${t.cid}/inbox`)).body;
    expect((await t.priya.post(`/c/${t.cid}/inbox/${inbox.approvals[0].id}/take-over`)).status).toBe(200);
    expect((await t.priya.get(`/c/${t.cid}/inbox`)).body.approvals).toEqual([]);
    expect((await t.priya.post(`/c/${t.cid}/inbox/${inbox.approvals[0].id}/approve`, {})).status).toBe(409);
    const activity = (await t.dana.get(`/c/${t.cid}/automation`)).body.activity.map((x: any) => x.status);
    expect(activity).toEqual(expect.arrayContaining(['rejected', 'taken_over']));
  });
});

describe('owners stay in charge', () => {
  it('pausing holds everything; resuming runs or cancels what was held', async () => {
    const t = await team();
    expect((await t.marcus.patch(`/c/${t.cid}/automation`, { paused: true })).status).toBe(403);
    expect((await t.dana.patch(`/c/${t.cid}/automation`, { paused: true })).status).toBe(200);
    await finishedWork(t);
    let auto = (await t.dana.get(`/c/${t.cid}/automation`)).body;
    expect(auto).toMatchObject({ paused: true, held: 1, waiting: 0 });
    expect((await t.priya.get(`/c/${t.cid}/inbox`)).body.approvals).toEqual([]);
    expect((await t.dana.patch(`/c/${t.cid}/automation`, { paused: false, held: 'run' })).body.ran).toBe(1);
    auto = (await t.dana.get(`/c/${t.cid}/automation`)).body;
    expect(auto).toMatchObject({ paused: false, held: 0, waiting: 1 });
    // Held items can be cancelled instead.
    await t.dana.patch(`/c/${t.cid}/automation`, { paused: true });
    await finishedWork(t);
    expect((await t.dana.patch(`/c/${t.cid}/automation`, { paused: false, held: 'cancel' })).body.cancelled).toBe(1);
  });

  it('Manual prepares nothing; Automatic for money needs an owner’s confirmation and still waits for approval', async () => {
    const t = await team();
    await t.dana.put(`/c/${t.cid}/automation/rules/invoice_on_finish`, { level: 'manual' });
    await finishedWork(t);
    expect((await t.priya.get(`/c/${t.cid}/inbox`)).body.approvals).toEqual([]);
    expect((await t.priya.get(`/c/${t.cid}/money/ready`)).body.work).toHaveLength(1);

    const ask = await t.dana.put(`/c/${t.cid}/automation/rules/invoice_on_finish`, { level: 'automatic' });
    expect(ask.status).toBe(409);
    expect(ask.body.error.details.needsConfirm).toBe('money');
    await t.dana.patch(`/c/${t.cid}/roles/office`, { permissions: ['automation.manage', 'money.view'] });
    expect((await t.priya.put(`/c/${t.cid}/automation/rules/invoice_on_finish`, { level: 'automatic', confirmMoney: true })).status).toBe(403);
    expect((await t.dana.put(`/c/${t.cid}/automation/rules/invoice_on_finish`, { level: 'automatic', confirmMoney: true })).status).toBe(200);
    // The workspace level is Assisted, so Assisted still applies.
    expect((await t.dana.get(`/c/${t.cid}/automation`)).body.rules[0]).toMatchObject({ level: 'automatic', effective: 'assisted' });
    await t.dana.patch(`/c/${t.cid}/automation`, { mode: 'automatic' });
    await t.dana.patch(`/c/${t.cid}/roles/office`, { permissions: ['customers.view', 'money.view', 'invoices.manage', 'invoices.approve', 'payments.record', 'approvals.decide'] });
    await finishedWork(t);
    const inbox = (await t.priya.get(`/c/${t.cid}/inbox`)).body;
    // Invoices need approval in this workspace, so even Automatic waits; once approved, Rigo issues it.
    expect(inbox.approvals[0]).toMatchObject({ level: 'automatic', status: 'waiting' });
    const r = await t.priya.post(`/c/${t.cid}/inbox/${inbox.approvals[0].id}/approve`, {});
    expect(r.body.issued).toBe('INV-00001');
  });

  it('booking confirmations are prepared, approved and honestly not sent without an email service', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const t = await team();
    const c = (await t.dana.post(`/c/${t.cid}/customers`, { name: 'Grace Okafor', email: 'grace@example.test' })).body.id;
    const soon = new Date(Date.now() + 2 * 86400_000).toISOString();
    await t.marcus.post(`/c/${t.cid}/work`, { title: 'Delivery', clientId: c, startsAt: soon });
    const inbox = (await t.marcus.get(`/c/${t.cid}/inbox`)).body;
    expect(inbox.approvals).toEqual([]); // dispatchers don't decide approvals in this template
    const office = (await t.priya.get(`/c/${t.cid}/inbox`)).body.approvals;
    expect(office[0]).toMatchObject({ kind: 'message', message_channel: 'email', message_recipient: 'grace@example.test' });
    expect(office[0].message_body).toMatch(/This confirms your job with Tri-County Field Services/);
    const sent = await t.priya.post(`/c/${t.cid}/inbox/${office[0].id}/approve`, {});
    expect(sent.body.status).toBe('blocked');
    expect(sent.body.detail).toMatch(/No email service is configured/);
    const msgs = (await t.priya.get(`/c/${t.cid}/messages`)).body.messages;
    expect(msgs[0].status).toBe('blocked');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('overdue invoices get one reminder, prepared for approval', async () => {
    const t = await team();
    await t.dana.put(`/c/${t.cid}/automation/rules/invoice_on_finish`, { level: 'manual' });
    await t.dana.patch(`/c/${t.cid}/money/settings`, { taxRate: '0' });
    const { workId } = await finishedWork(t);
    const inv = (await t.priya.post(`/c/${t.cid}/invoices`, { workIds: [workId] })).body;
    await t.priya.post(`/c/${t.cid}/invoices/${inv.id}/approve`, { version: (await t.priya.get(`/c/${t.cid}/invoices/${inv.id}`)).body.invoice.version });
    await t.priya.post(`/c/${t.cid}/invoices/${inv.id}/issue`);
    await (await getDb()).query(`update rigo.money_invoices set due_on = current_date - 10 where id = $1`, [inv.id]);
    await runDueReminders();
    await runDueReminders();
    const office = (await t.priya.get(`/c/${t.cid}/inbox`)).body.approvals.filter((a: any) => a.rule_key === 'payment_reminder');
    expect(office).toHaveLength(1);
    expect(office[0].message_body).toMatch(/\$375\.00 is still open/);
  });
});
