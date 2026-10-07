import { describe, it, expect } from 'vitest';
import { triCounty, type TriCounty } from './fixtures/tricounty.js';
import { rid } from './helpers.js';

// WP12: what each role can read. Round 12 checked keys only and missed invoice amounts in message
// text (R17-M1); this scans the full text of every response a role can open.

async function moneyTrail(t: TriCounty) {
  const c = t.customers.grace;
  const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel', requested_qty: '100' }, intent: 'open', clientRequestId: rid(), scheduledStart: new Date(Date.now() + 3600_000).toISOString() });
  const j = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
  const a = await t.dana.post(`/c/${t.cid}/jobs/${j.id}/assign`, { userId: t.ids.luis, resourceIds: [], version: j.version });
  expect((await t.luis.post(`/c/${t.cid}/jobs/${j.id}/complete`, { submissionId: rid(), baseVersion: a.body.version, outcome: 'completed', values: { delivered_qty: '100' } })).status).toBe(200);
  const inv = (await t.dana.post(`/c/${t.cid}/jobs/${j.id}/invoice`)).body.invoiceId;
  let d = (await t.dana.get(`/c/${t.cid}/invoices/${inv}`)).body.invoice;
  await t.dana.post(`/c/${t.cid}/invoices/${inv}/approve`, { version: d.version });
  d = (await t.dana.get(`/c/${t.cid}/invoices/${inv}`)).body.invoice;
  await t.dana.post(`/c/${t.cid}/invoices/${inv}/issue`, { version: d.version });
  const email = (await t.dana.post(`/c/${t.cid}/invoices/${inv}/email`)).body.messageId as string;
  return { jobId: j.id as string, invoiceId: inv as string, messageId: email, customerId: c.id };
}

const MONEY = /\$\s?\d|"(total|subtotal|tax|balance|paid|amount)(_minor|Minor)"\s*:\s*\d/;
const CONTACT = /grace@example\.test|555\)? ?201-0003/;

describe('privacy (R17-M1, WP12)', () => {
  it('dispatchers can neither read nor send messages about money', async () => {
    const t = await triCounty();
    const m = await moneyTrail(t);
    const list = (await t.marcus.get(`/c/${t.cid}/messages`)).body.messages;
    expect(list.find((x: any) => x.id === m.messageId)).toMatchObject({ body: null, bodyHidden: true });
    expect((await t.marcus.post(`/c/${t.cid}/messages/${m.messageId}/send`)).status).toBe(403);
    expect((await t.marcus.post(`/c/${t.cid}/messages/${m.messageId}/mark-sent`)).status).toBe(403);
    // Office can.
    expect((await t.priya.post(`/c/${t.cid}/messages/${m.messageId}/mark-sent`)).status).toBe(200);
  });

  it('no amount reaches a role without finance access, and no contact detail a role without contact access, on any page it can open', async () => {
    const t = await triCounty();
    const m = await moneyTrail(t);
    const base = `/c/${t.cid}`;
    const pages = ['/overview', '/jobs', `/jobs/${m.jobId}`, '/customers', `/customers/${m.customerId}`, '/messages', '/notifications', '/approvals', '/resources', '/members',
      '/services', '/recurring', '/workflows', '/automation', '/my/jobs', '/pending-submissions', '/templates', '/structure', '/roles', '/delegations', '/activity'];
    const checked: string[] = [];
    for (const [who, client, contact] of [['dispatcher', t.marcus, true], ['driver', t.luis, false]] as const) {
      for (const p of pages) {
        const r = await client.get(`${base}${p}`);
        if (r.status !== 200) continue; // a page they can't open shows nothing
        const text = JSON.stringify(r.body);
        expect(text, `${who} ${p} shows an amount`).not.toMatch(MONEY);
        if (!contact) expect(text, `${who} ${p} shows contact details`).not.toMatch(CONTACT);
        checked.push(`${who} ${p}`);
      }
    }
    // The scan really covered pages with the invoice and the message on them.
    expect(checked).toEqual(expect.arrayContaining(['dispatcher /messages', `dispatcher /jobs/${m.jobId}`, `dispatcher /customers/${m.customerId}`, 'driver /my/jobs', `driver /jobs/${m.jobId}`]));
  });
});
