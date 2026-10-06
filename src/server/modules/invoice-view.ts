import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { getDb } from '../db/index.js';
import type { AppEnv } from '../http/context.js';
import { notFound } from '../http/errors.js';
import { readStoredFile } from '../adapters/index.js';
import { balanceDue, termsLabel } from '../../shared/invoices.js';
import { lineFromRow } from './invoicing.js';

// The customer's view of one issued invoice, reached by the link in the invoice email. No sign-in:
// the random token is the key, stored only as a hash, expiring after 60 days and revoked on void.
// It shows what the printed invoice shows and nothing else: no internal notes, no other records.

export const invoiceViewPublic = new Hono<AppEnv>();

async function byToken(token: string) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw notFound('Invoice');
  const db = await getDb();
  const { rows } = await db.query<any>(
    `select k.revoked_at, k.expires_at, i.*, co.name as company_name, co.phone as company_phone, co.email as company_email, co.address as company_address, co.settings as company_settings, co.branding
       from rigo.invoice_links k join rigo.invoices i on i.id = k.invoice_id and i.company_id = k.company_id join rigo.companies co on co.id = i.company_id
      where k.token_hash = $1`, [createHash('sha256').update(token).digest('hex')]);
  const r = rows[0];
  if (!r || new Date(r.expires_at) < new Date()) throw notFound('Invoice');
  return { db, r };
}

invoiceViewPublic.get('/public/invoices/:token', async (c) => {
  const { db, r } = await byToken(c.req.param('token'));
  c.header('x-robots-tag', 'noindex');
  if (r.revoked_at || r.status !== 'issued') {
    return c.json({ unavailable: true, companyName: r.company_name, companyPhone: r.company_phone, message: r.status === 'void' ? 'This invoice was cancelled. Contact us if you have questions.' : 'This link is no longer active.' });
  }
  const lines = (await db.query<any>(`select * from rigo.invoice_lines where invoice_id = $1 order by position`, [r.id])).rows.map((row) => {
    const l = lineFromRow(row);
    // Only the customer-facing note (a minimum charge) is shown; price-change notes are for the office.
    return { description: l.description, quantity: l.quantity, unit: l.unit, kind: l.kind, rateE4: l.rateE4, percentBp: l.percentBp, amountMinor: l.amountMinor, note: l.note?.startsWith('Minimum') ? l.note : '' };
  });
  const s = r.company_settings ?? {};
  const bt = r.bill_to ?? {};
  return c.json({
    company: { name: r.company_name, phone: r.company_phone, email: r.company_email, address: r.company_address, logo: !!r.branding?.logoFileId, accent: r.branding?.accent ?? null,
      paymentInstructions: s.paymentInstructions ?? '', remitTo: s.remitTo ?? '', taxId: s.taxId ?? '' },
    invoice: {
      number: r.number, currency: r.currency, issuedAt: r.issued_at, dueDate: r.due_date, termsLabel: termsLabel(r.due_days), periodStart: r.period_start, periodEnd: r.period_end,
      customerName: bt.customerName ?? null, billingAddress: bt.billingAddress ?? null, locationAddress: bt.locationAddress ?? null, serviceName: bt.serviceName ?? null, jobNumber: bt.jobNumber ?? null,
      subtotalMinor: r.subtotal_minor, discountMinor: r.discount_minor, taxMinor: r.tax_minor, totalMinor: r.total_minor, paidMinor: Number(r.paid_minor) + Number(r.credited_minor ?? 0),
      balanceMinor: balanceDue({ totalMinor: r.total_minor, paidMinor: Number(r.paid_minor), creditedMinor: Number(r.credited_minor ?? 0) }), paymentStatus: r.payment_status, notes: (r.notes ?? '').split('\nVoided:')[0],
    },
    lines,
  });
});

invoiceViewPublic.get('/public/invoices/:token/logo', async (c) => {
  const { db, r } = await byToken(c.req.param('token'));
  const id = r.branding?.logoFileId;
  if (!id || r.revoked_at) return c.body(null, 404);
  const { rows } = await db.query(`select * from rigo.files where id = $1 and company_id = $2`, [id, r.company_id]);
  const data = rows[0] && readStoredFile(rows[0]);
  if (!data) return c.body(null, 404);
  return c.body(new Uint8Array(data), 200, { 'content-type': rows[0].mime, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' });
});
