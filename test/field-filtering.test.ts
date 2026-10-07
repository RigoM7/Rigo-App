import { describe, it, expect } from 'vitest';
import { triCounty, type TriCounty } from './fixtures/tricounty.js';
import { rid, processAll, getDb } from './helpers.js';

// Money and contact details are removed on the server for people whose role can't see them
// (Phase 1 review): booked prices, check photos, invoice emails and statements, workflow dry runs.

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function fuelJob(t: TriCounty) {
  const c = t.customers.grace;
  const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel', requested_qty: '100' }, intent: 'open', clientRequestId: rid(), scheduledStart: new Date(Date.now() + 3600_000).toISOString() });
  const j = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
  const a = await t.dana.post(`/c/${t.cid}/jobs/${j.id}/assign`, { userId: t.ids.luis, resourceIds: [], version: j.version });
  return { id: j.id as string, version: a.body.version as number };
}

describe('field filtering (Phase 1 review)', () => {
  it('drivers and dispatchers get no booked prices, check photos, invoice email bodies or real invoice totals', async () => {
    const t = await triCounty();
    const j = await fuelJob(t);
    const done = await t.luis.post(`/c/${t.cid}/jobs/${j.id}/complete`, { submissionId: rid(), baseVersion: j.version, outcome: 'completed', values: { delivered_qty: '100' },
      collected: { method: 'check', amountMinor: 38990, reference: '1001', photo: PNG } });
    expect(done.status).toBe(200);
    await processAll();

    // Booked prices are price data.
    expect((await t.dana.get(`/c/${t.cid}/jobs/${j.id}`)).body.job.booked_rates).toBeTruthy();
    expect((await t.marcus.get(`/c/${t.cid}/jobs/${j.id}`)).body.job.booked_rates).toBeUndefined();
    expect((await t.luis.get(`/c/${t.cid}/jobs/${j.id}`)).body.job.booked_rates).toBeUndefined();

    // A photo of a check shows the amount and bank details.
    const ownerView = (await t.dana.get(`/c/${t.cid}/jobs/${j.id}`)).body;
    const check = ownerView.files.find((f: any) => f.name === 'check.jpg');
    expect(check).toBeTruthy();
    expect((await t.marcus.get(`/c/${t.cid}/jobs/${j.id}`)).body.files.some((f: any) => f.id === check.id)).toBe(false);
    expect((await t.marcus.get(`/c/${t.cid}/jobs/${j.id}/files/${check.id}`)).status).toBe(404);
    expect((await t.dana.get(`/c/${t.cid}/jobs/${j.id}/files/${check.id}`)).status).toBe(200);

    // Invoice emails carry amounts and a link to the priced invoice.
    const inv = ownerView.invoice;
    let d = (await t.dana.get(`/c/${t.cid}/invoices/${inv.id}`)).body;
    if (d.invoice.status !== 'issued') {
      if (d.invoice.status !== 'approved') await t.dana.post(`/c/${t.cid}/invoices/${inv.id}/approve`, { version: d.invoice.version });
      await processAll();
      d = (await t.dana.get(`/c/${t.cid}/invoices/${inv.id}`)).body;
      if (d.invoice.status !== 'issued') await t.dana.post(`/c/${t.cid}/invoices/${inv.id}/issue`, { version: d.invoice.version });
    }
    await t.dana.post(`/c/${t.cid}/invoices/${inv.id}/email`);
    const mine = (await t.dana.get(`/c/${t.cid}/messages`)).body.messages.find((m: any) => m.invoice_id === inv.id);
    expect(mine.body).toContain('$');
    const theirs = (await t.marcus.get(`/c/${t.cid}/messages`)).body.messages.find((m: any) => m.invoice_id === inv.id);
    expect(theirs.body).toBeNull();
    expect(theirs.bodyHidden).toBe(true);
    expect(JSON.stringify(theirs)).not.toContain('/i/');

    // A dry run of an invoice workflow uses the latest real invoice; its total is money.
    const wf = await t.dana.post(`/c/${t.cid}/workflows`, { name: 'Issued invoices', definition: { trigger: { event: 'invoice.issued' }, conditions: [], steps: [{ id: 'n', action: 'notify', params: { roles: ['owner'], text: 'Issued' }, mode: null, approval: { required: 'never', conditions: [], approverRoles: [], approverUserIds: [], backupUserIds: [], escalateAfterHours: null }, onException: { notifyRoles: ['owner'], stop: true } }] } });
    const test = await t.dana.post(`/c/${t.cid}/workflows/${wf.body.id}/versions/${wf.body.versionId}/test`, {});
    expect(test.body.result.sample['invoice.total_minor']).toBe(d.invoice.totalMinor);
    const seen = (await t.marcus.get(`/c/${t.cid}/workflows/${wf.body.id}`)).body.versions[0].testResult;
    expect(seen.sample['invoice.total_minor']).toBeUndefined();
  });

  it('pausing or ending a plan tells a dispatcher it was done, not the credit amount; plans show no tax rate', async () => {
    const t = await triCounty();
    const c = t.customers.harbor;
    const plan = (await t.dana.post(`/c/${t.cid}/recurring`, {
      name: 'Harbor units', kind: 'rental', customerId: c.id, locationId: c.locationId, serviceId: t.services.portable_toilet.id, units: 1,
      visitRule: { frequency: 'weekly', interval: 1, weekdays: [3], time: '07:00', durationMinutes: 60 },
      billingRule: { frequency: 'every_n_days', everyDays: 28, lines: [{ id: 'std', label: 'Standard unit', quantity: 1, rateE4: 1_350_000 }] },
      startsOn: new Date().toISOString().slice(0, 10), details: { visit_type: 'Service' },
    })).body;
    const shown = (await t.marcus.get(`/c/${t.cid}/recurring/${plan.id}`)).body.plan;
    expect(shown.tax_rate_bp).toBeUndefined();
    const today = new Date().toISOString().slice(0, 10);
    const p = await t.marcus.post(`/c/${t.cid}/recurring/${plan.id}/pause`, { from: today, until: null });
    expect(p.status).toBe(200);
    expect(p.body.creditMinor).toBeUndefined();
    await t.marcus.post(`/c/${t.cid}/recurring/${plan.id}/resume`);
    const e = await t.marcus.post(`/c/${t.cid}/recurring/${plan.id}/end`, { endsOn: today, createPickup: false });
    expect(e.status).toBe(200);
    expect(e.body.creditMinor).toBeUndefined();
  });

  it('only members removed in the last 7 days are told they were removed; earlier ones get "not found"', async () => {
    const t = await triCounty();
    const tyler = (await t.dana.get(`/c/${t.cid}/members`)).body.members.find((m: any) => m.user_id === t.ids.tyler);
    await t.dana.del(`/c/${t.cid}/members/${tyler.id}`);
    expect((await t.tyler.get(`/c/${t.cid}`)).body.error.code).toBe('not_member');
    await (await getDb()).query(`update rigo.memberships set removed_at = now() - interval '8 days' where id = $1`, [tyler.id]);
    expect((await t.tyler.get(`/c/${t.cid}`)).status).toBe(404);
  });
});
