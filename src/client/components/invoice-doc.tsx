import { formatMoney, fmtDate } from '../lib/format';
import { formatRate } from '../../shared/billing';

/**
 * The printed invoice, shared by the app and the customer's view link. Every amount comes from the
 * server; `showAmounts` is false only for people without finance access, whose data has none.
 * The printed lines always add up to the total, and the balance due is what is still owed.
 */
export function InvoiceDocument({ company, invoice: i, lines, serviceRecord = [], logoUrl, accent, showAmounts = true, tz, internal = false }: {
  company: any; invoice: any; lines: any[]; serviceRecord?: { label: string; value: string }[]; logoUrl?: string | null; accent?: string; showAmounts?: boolean; tz?: string; internal?: boolean;
}) {
  const period = i.periodStart ? `${fmtDate(i.periodStart)} to ${fmtDate(i.periodEnd)}` : null;
  const paid = (i.paidMinor ?? 0) + (internal ? (i.creditedMinor ?? 0) : 0);
  const showBalance = showAmounts && i.number && i.totalMinor !== null && (paid > 0 || i.balanceMinor !== undefined);
  return (
    <article className="doc" aria-label="Invoice">
      {accent ? <div className="doc-accent" style={{ background: accent }} aria-hidden /> : null}
      <div className="doc-head">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          {logoUrl ? <img src={logoUrl} alt={`${company.name} logo`} style={{ maxHeight: 56, maxWidth: 160 }} /> : null}
          <div><h2>{company.name}</h2><div className="muted small">{[company.address, company.phone, company.email].filter(Boolean).join(' · ')}</div>{company.taxId ? <div className="muted small">Tax ID {company.taxId}</div> : null}</div>
        </div>
        <div className="doc-head-right">
          <div className="doc-title">Invoice</div>
          <div className="num">{i.number ?? 'DRAFT, not issued'}</div>
          <dl className="doc-dates">
            <dt>{i.issuedAt ? 'Issued' : 'Prepared'}</dt><dd>{fmtDate(i.issuedAt ?? i.createdAt, tz)}</dd>
            {i.dueDate ? <><dt>Due</dt><dd>{fmtDate(i.dueDate)}{i.termsLabel ? ` (${i.termsLabel})` : ''}</dd></> : null}
            {period ? <><dt>Period</dt><dd>{period}</dd></> : null}
          </dl>
        </div>
      </div>
      <div className="grid-2" style={{ margin: '20px 0' }}>
        <div><div className="muted small">Bill to</div><strong>{i.customerName ?? '—'}</strong>{i.billingAddress ? <div className="pre">{i.billingAddress}</div> : null}</div>
        <div><div className="muted small">{i.serviceName || i.jobNumber ? 'Service' : 'Site'}</div>{i.serviceName ?? ''}{i.jobNumber ? `${i.serviceName ? ' · ' : ''}job #${i.jobNumber}` : ''}{i.locationAddress ? <div>{i.locationAddress}</div> : null}{i.completedAt ? <div className="muted small">Completed {fmtDate(i.completedAt, tz)}</div> : null}</div>
      </div>
      <table>
        <thead><tr><th>Description</th><th className="right">Qty</th>{showAmounts && <th className="right">Rate</th>}{showAmounts && <th className="right">Amount</th>}</tr></thead>
        <tbody>{lines.map((l: any, n: number) => (
          <tr key={l.id ?? n}>
            <td>{l.description}{internal && showAmounts && l.priceDate && l.unit ? <span className="doc-sub"> · price on {fmtDate(l.priceDate)}</span> : null}{l.note ? <div className={l.bookedRateE4 ? 'doc-note doc-note-flag no-print' : 'doc-note'}>{l.note}</div> : null}</td>
            <td className="right num">{l.kind === 'discount' ? '' : <>{l.quantity} <span style={{ fontFamily: 'var(--font-sans)' }}>{l.unit}</span></>}</td>
            {showAmounts && <td className="right num">{l.kind === 'discount' && l.percentBp ? `${l.percentBp / 100}%` : l.rateE4 === null || l.rateE4 === undefined ? (l.kind === 'discount' ? '' : <strong>Not set</strong>) : formatRate(l.rateE4, i.currency)}</td>}
            {showAmounts && <td className="right num">{l.amountMinor === null || l.amountMinor === undefined ? '—' : l.amountMinor < 0 ? `−${formatMoney(-l.amountMinor, i.currency)}` : formatMoney(l.amountMinor, i.currency)}</td>}
          </tr>
        ))}</tbody>
      </table>
      {serviceRecord.length > 0 && (
        <div className="doc-record"><div className="muted small">Service record</div><dl>{serviceRecord.map((r) => <div key={r.label}><dt>{r.label}</dt><dd className="pre">{r.value}</dd></div>)}</dl></div>
      )}
      {showAmounts && (
        <table className="doc-totals">
          <tbody>
            <tr><td>Subtotal</td><td className="right num">{formatMoney(i.subtotalMinor, i.currency)}</td></tr>
            {i.discountMinor ? <tr><td>Discounts</td><td className="right num">−{formatMoney(i.discountMinor, i.currency)}</td></tr> : null}
            <tr><td>Tax</td><td className="right num">{i.taxMinor === null ? '—' : formatMoney(i.taxMinor, i.currency)}</td></tr>
            <tr className="doc-total"><td><strong>Total</strong></td><td className="right num"><strong>{i.totalMinor === null ? 'Incomplete' : formatMoney(i.totalMinor, i.currency)}</strong></td></tr>
            {showBalance && paid > 0 ? <tr><td>Paid{internal && i.creditedMinor ? ' and credited' : ''}</td><td className="right num">−{formatMoney(paid, i.currency)}</td></tr> : null}
            {showBalance ? <tr className="doc-total"><td><strong>Balance due</strong></td><td className="right num"><strong>{formatMoney(i.balanceMinor, i.currency)}</strong></td></tr> : null}
          </tbody>
        </table>
      )}
      {i.notes ? <p className="pre" style={{ marginTop: 16 }}>{i.notes}</p> : null}
      {company.paymentInstructions || company.remitTo ? (
        <div className="doc-pay">
          {company.paymentInstructions ? <p className="small pre"><strong>How to pay:</strong> {company.paymentInstructions}</p> : null}
          {company.remitTo ? <p className="small pre"><strong>Send payments to:</strong> {company.remitTo}</p> : null}
        </div>
      ) : null}
    </article>
  );
}
