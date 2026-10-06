import { describe, it, expect } from 'vitest';
import { triCounty } from './fixtures/tricounty.js';
import { rid, getDb, signup, invite } from './helpers.js';
import { handlers } from '../src/server/automation/actions.js';
import { isEligibleApprover } from '../src/server/automation/engine.js';
import { ALL_PERMISSIONS } from '../src/shared/permissions.js';

// Phase 1 security review: approvals can't be skipped, delegated authority ends with the person,
// and a removed driver can't flood the office.

async function manualInvoice(t: Awaited<ReturnType<typeof triCounty>>) {
  const c = t.customers.brigid;
  const r = await t.priya.post(`/c/${t.cid}/invoices`, { customerId: c.id, locationId: c.locationId, clientRequestId: rid(), lines: [{ description: 'Generator tank inspection', quantity: '1', rateE4: 950_000, taxable: false, kind: 'charge' }] });
  expect(r.status).toBe(200);
  const d = (await t.priya.get(`/c/${t.cid}/invoices/${r.body.id}`)).body;
  const s = await t.priya.post(`/c/${t.cid}/invoices/${r.body.id}/submit`, { version: d.invoice.version });
  expect(s.status).toBe(200);
  return r.body.id as string;
}

describe('security review (Phase 1)', () => {
  it('a workflow step never issues an invoice that is still waiting for approval', async () => {
    const t = await triCounty();
    const id = await manualInvoice(t);
    const db = await getDb();
    const r = await db.tx((q) => handlers['invoice.issue']({ q, companyId: t.cid, companyKind: 'real', actorUserId: t.ids.priya, actionId: crypto.randomUUID(), depth: 0, subject: { type: 'invoice', id }, params: {}, context: {} }));
    expect(r.status).toBe('blocked');
    expect((await t.dana.get(`/c/${t.cid}/invoices/${id}`)).body.invoice.status).toBe('pending_approval');
  });

  it('approving on the invoice page can\'t skip an approver a workflow named', async () => {
    const t = await triCounty();
    const id = await manualInvoice(t);
    // The waiting approval names only the owner (as a workflow step "over $5,000 needs the Owner" would).
    await (await getDb()).query(`update rigo.approvals set approver_roles = '{owner}', approver_user_ids = '{}' where subject_id = $1 and status = 'pending'`, [id]);
    const v = (await t.priya.get(`/c/${t.cid}/invoices/${id}`)).body.invoice.version;
    const r = await t.priya.post(`/c/${t.cid}/invoices/${id}/approve`, { version: v });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toContain('waiting for approval from Owner');
    expect((await t.dana.post(`/c/${t.cid}/invoices/${id}/approve`, { version: v })).status).toBe(200);
  });

  it('authority delegated by a named approver ends when they are removed', async () => {
    const t = await triCounty();
    const kim = await signup('Kim');
    await invite(t.dana, t.cid, kim, 'office');
    const kimId = (await kim.get('/auth/me')).body.user.id;
    const id = await manualInvoice(t);
    const db = await getDb();
    await db.query(`update rigo.approvals set approver_roles = '{}', approver_user_ids = $2 where subject_id = $1 and status = 'pending'`, [id, [t.ids.priya]]);
    expect((await t.priya.post(`/c/${t.cid}/delegations`, { toUserId: kimId, endsAt: null })).status).toBe(200);
    const ap = (await db.query<any>(`select * from rigo.approvals where subject_id = $1 and status = 'pending'`, [id])).rows[0];
    const kimActor = { db, companyId: t.cid, userId: kimId, perms: new Set<string>(ALL_PERMISSIONS), isOwner: false, isDemo: false };
    expect(await isEligibleApprover(db, ap, kimActor)).toBe(true);
    const priya = (await t.dana.get(`/c/${t.cid}/members`)).body.members.find((m: any) => m.user_id === t.ids.priya);
    await t.dana.del(`/c/${t.cid}/members/${priya.id}`);
    expect(await isEligibleApprover(db, ap, kimActor)).toBe(false);
    const open = (await db.query(`select 1 from rigo.approval_delegations where company_id = $1 and from_user_id = $2 and (ends_at is null or ends_at > now())`, [t.cid, t.ids.priya])).rows;
    expect(open).toHaveLength(0);
  });

  it('one held record per driver and job; a second one is refused politely, not stored', async () => {
    const t = await triCounty();
    const c = t.customers.grace;
    const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel', requested_qty: '100' }, intent: 'open', clientRequestId: rid() });
    const j = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
    const a = await t.dana.post(`/c/${t.cid}/jobs/${j.id}/assign`, { userId: t.ids.luis, resourceIds: [], version: j.version });
    await t.dana.post(`/c/${t.cid}/jobs/${j.id}/assign`, { userId: t.ids.sam, resourceIds: [], version: a.body.version });
    const send = (sub: string) => t.luis.post(`/c/${t.cid}/jobs/${j.id}/complete`, { submissionId: sub, baseVersion: a.body.version, outcome: 'completed', values: { delivered_qty: '50' } });
    expect((await send('sub-hold-0001')).body).toMatchObject({ pendingReview: true, duplicate: false });
    const second = await send('sub-hold-0002');
    expect(second.body).toMatchObject({ pendingReview: true, duplicate: true });
    expect((await t.dana.get(`/c/${t.cid}/pending-submissions`)).body.records).toHaveLength(1);
  });
});
