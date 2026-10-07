import type { Q } from '../db/index.js';

// Recording what happened to a customer message after a send attempt, the same way from Messages
// and from a workflow step. States stay honest: simulated, sent, failed, or still prepared.

export type DeliveryResult = { status: 'simulated' | 'sent' | 'failed' | 'blocked'; detail: string; provider: string };

export async function recordDelivery(q: Q, m: { id: string; invoice_id: string | null }, r: DeliveryResult) {
  if (r.status === 'blocked') return; // stays "prepared" so a person can copy it and send it themselves
  await q.query(`update rigo.messages set status = $2, status_detail = $3, provider = $4, updated_at = now() where id = $1`, [m.id, r.status, r.detail, r.provider]);
  if (m.invoice_id && r.status !== 'failed') await q.query(`update rigo.invoices set delivery_status = $2 where id = $1`, [m.invoice_id, r.status === 'sent' ? 'sent' : 'simulated']);
}
