import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, CheckCircle2, Send, SkipForward, Printer, RefreshCw, ChevronLeft, Inbox } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, ErrorSummary, LoadingBlock, ErrorState, PageHeader, Empty, MessageStatus, useToast } from '../components/ui';
import { formatMoney, fmtDate, fmtDateTime } from '../lib/format';

/**
 * Collections (R10-M3): who owes what and for how long, money drivers collected at stops waiting
 * for the office, and reminders and statements prepared for review. Nothing is sent without a
 * person pressing Send, and only through a connected email service.
 */
export function Collections() {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: [c.cid, 'collections'], queryFn: () => get(`/c/${c.cid}/collections`) });
  const refresh = () => qc.invalidateQueries({ queryKey: [c.cid] });
  const prepare = useSubmit(async () => { const r = await post(`/c/${c.cid}/collections/prepare`); toast(r.reminders || r.statements ? `${r.reminders} reminder(s) and ${r.statements} statement(s) prepared` : 'Nothing new to prepare today'); refresh(); });
  const confirm = useSubmit(async (id: string) => { const r = await post(`/c/${c.cid}/payments/${id}/confirm`); toast(r.toCredit ? 'Confirmed. The visit isn\'t billed on its own, so it went to the customer\'s credit and paid their open invoices.' : r.waitingForInvoice ? 'Confirmed. It pays the job\'s invoice when it is issued.' : 'Payment confirmed and applied'); refresh(); });
  const send = useSubmit(async (id: string) => { const r = await post(`/c/${c.cid}/messages/${id}/send`); toast(r.status === 'simulated' ? 'Simulated (demo): nothing was sent.' : r.detail); refresh(); });
  const skip = useSubmit(async (id: string) => { await post(`/c/${c.cid}/messages/${id}/skip`); toast('Skipped. It will not be prepared again.'); refresh(); });
  if (q.isLoading) return <div className="page"><LoadingBlock /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} retry={() => q.refetch()} /></div>;
  const d = q.data;
  const money = (n: number) => formatMoney(n, d.currency);
  const err = prepare.error ?? confirm.error ?? send.error ?? skip.error;
  return (
    <div className="page">
      <PageHeader title="Collections" sub={`Who owes what, as of ${fmtDate(d.asOf)}. Reminders go out 3 days before a due date and at 7 and 30 days overdue, only after someone approves them.`}
        actions={d.can.prepare ? <Button icon={<RefreshCw aria-hidden />} busy={prepare.busy} onClick={() => prepare.run()}>Check for reminders now</Button> : undefined} />
      <ErrorSummary error={err} />
      <div className="aging" role="group" aria-label="Amounts owed by age">
        {d.buckets.map((b: any) => <div key={b.key} className={b.key === 'd60_plus' && d.totals[b.key] ? 'aging-late' : undefined}><span className="k">{b.label}</span><span className="money-big">{money(d.totals[b.key])}</span></div>)}
        <div><span className="k">Total owed</span><span className="money-big">{money(d.totalMinor)}</span></div>
      </div>
      {d.unconfirmed.length > 0 && (
        <Card id="collected" title="Collected at stops, to confirm">
          <p className="muted" style={{ marginTop: 0 }}>Drivers recorded these payments. Check the money or check in hand, then confirm it so it counts toward the invoice.</p>
          <ul className="list">{d.unconfirmed.map((p: any) => (
            <li key={p.id} className="row-between" style={{ padding: '10px 0' }}>
              <span><strong className="num">{money(p.amountMinor)}</strong> · {p.method}{p.reference ? ` #${p.reference}` : ''}
                <div className="small muted">{p.customerName ?? 'No customer'} · {p.jobId ? <Link to={c.to(`jobs/${p.jobId}`)}>job #{p.jobNumber}</Link> : null} · {fmtDateTime(p.recordedAt, c.company.timezone)} by {p.recordedByName}{p.hasPhoto ? ' · photo of the check on the job' : ''}</div>
                <div className="small muted">{p.invoiceId ? <>For <Link to={c.to(`invoices/${p.invoiceId}`)}>{p.invoiceNumber ?? 'the draft invoice'}</Link></> : 'No invoice yet: it pays the job\'s invoice when it is issued, or the customer\'s open invoices if the visit isn\'t billed.'}</div>
              </span>
              {d.can.confirm && <Button size="sm" icon={<CheckCircle2 aria-hidden />} busy={confirm.busy} onClick={() => confirm.run(p.id)}>Confirm</Button>}
            </li>
          ))}</ul>
        </Card>
      )}
      <Card id="review" title="Reminders and statements to review">
        {d.reminders.length === 0 ? <Empty icon={<Inbox aria-hidden />} title="Nothing to review">Reminders appear here when an invoice is close to or past its due date. Statements are prepared on the 1st for customers who get them.</Empty> : (
          <ul className="list">{d.reminders.map((m: any) => (
            <li key={m.id} className="row-between" style={{ padding: '10px 0', alignItems: 'flex-start' }}>
              <span style={{ minWidth: 0 }}>{m.subject}
                <div className="small muted">{m.kind === 'statement' ? 'Statement' : m.stage} · {m.customerName}{m.invoiceId ? <> · <Link to={c.to(`invoices/${m.invoiceId}`)}>{m.invoiceNumber}</Link></> : null} · to {m.recipient || <strong>no email on file</strong>}</div>
              </span>
              {d.can.send && <span className="row" style={{ flex: 'none' }}>
                <Button size="sm" icon={<SkipForward aria-hidden />} busy={skip.busy} onClick={() => skip.run(m.id)}>Skip</Button>
                <Button size="sm" variant="primary" icon={<Send aria-hidden />} busy={send.busy} disabled={!m.recipient} onClick={() => send.run(m.id)}>Approve and send</Button>
              </span>}
            </li>
          ))}</ul>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>Read or edit the text first in <Link to={c.to('messages')}>Messages</Link>.</p>
      </Card>
      <Card id="owed" title="Who owes what" flush>
        {d.customers.length === 0 ? <div style={{ padding: 16 }}><Empty icon={<Wallet aria-hidden />} title="Nobody owes anything">Issued invoices with a balance appear here by age.</Empty></div> : (
          <div className="table-wrap"><table className="table responsive">
            <thead><tr><th>Customer</th>{d.buckets.map((b: any) => <th key={b.key} className="right">{b.label}</th>)}<th className="right">Total</th></tr></thead>
            <tbody>{d.customers.map((r: any) => (
              <tr key={r.customerId ?? 'none'}>
                <td data-primary>{r.customerId ? <Link className="row-link" to={c.to(`customers/${r.customerId}`)}>{r.customerName}</Link> : r.customerName}<div className="xsmall muted">{r.invoices} invoice{r.invoices === 1 ? '' : 's'}{r.oldestDue ? ` · oldest due ${fmtDate(r.oldestDue)}` : ''}</div></td>
                {d.buckets.map((b: any) => <td key={b.key} data-label={b.label} className="right money">{r[b.key] ? money(r[b.key]) : <span className="muted">—</span>}</td>)}
                <td data-label="Total" className="right money"><strong>{money(r.balanceMinor)}</strong></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {d.credits.length > 0 && (
        <Card id="credit" title="Customer credit">
          <ul className="list">{d.credits.map((r: any) => <li key={r.customerId} className="row-between" style={{ padding: '8px 0' }}><Link to={c.to(`customers/${r.customerId}`)}>{r.customerName}</Link><span className="num">{money(r.creditMinor)}</span></li>)}</ul>
        </Card>
      )}
    </div>
  );
}

/** A customer statement, ready to print (D20). */
export function StatementView() {
  const c = useCompany();
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: [c.cid, 'statement', id], queryFn: () => get(`/c/${c.cid}/statements/${id}`) });
  if (q.isLoading) return <div className="page"><LoadingBlock /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} /></div>;
  const { statement: s, company: co, currency, buckets } = q.data;
  const money = (n: number) => formatMoney(n, currency);
  return (
    <div className="page">
      <div className="no-print row-between">
        <Link className="back-link" to={c.to(`customers/${s.customerId}`)}><ChevronLeft aria-hidden />{s.customerName}</Link>
        <span className="row">{s.messageStatus ? <MessageStatus status={s.messageStatus} /> : null}<Button icon={<Printer aria-hidden />} onClick={() => window.print()}>Print / save PDF</Button></span>
      </div>
      <article className="doc" aria-label="Statement">
        <div className="doc-head">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            {co.logo ? <img src={`/api/c/${c.cid}/branding/logo`} alt={`${co.name} logo`} style={{ maxHeight: 56, maxWidth: 160 }} /> : null}
            <div><h2>{co.name}</h2><div className="muted small">{[co.address, co.phone, co.email].filter(Boolean).join(' · ')}</div></div>
          </div>
          <div className="doc-head-right"><div className="doc-title">Statement</div><div className="muted small">As of {fmtDate(s.date)}</div></div>
        </div>
        <div style={{ margin: '20px 0' }}><div className="muted small">To</div><strong>{s.customerName}</strong>{s.billingAddress ? <div className="pre">{s.billingAddress}</div> : null}</div>
        <table>
          <thead><tr><th>Invoice</th><th>Issued</th><th>Due</th><th className="right">Total</th><th className="right">Paid</th><th className="right">Balance</th></tr></thead>
          <tbody>
            {s.openInvoices.length === 0 ? <tr><td colSpan={6} className="muted">No open invoices. Thank you!</td></tr> : s.openInvoices.map((i: any) => (
              <tr key={i.id}><td className="num">{i.number}</td><td>{i.issuedOn ? fmtDate(i.issuedOn) : '—'}</td><td>{i.dueDate ? fmtDate(i.dueDate) : '—'}</td><td className="right num">{money(i.totalMinor)}</td><td className="right num">{money(i.paidMinor)}</td><td className="right num">{money(i.balanceMinor)}</td></tr>
            ))}
          </tbody>
        </table>
        <table className="doc-totals" style={{ marginTop: 16 }}>
          <tbody>
            {buckets.map((b: any) => <tr key={b.key}><td>{b.label}</td><td className="right num">{money(s.aging[b.key] ?? 0)}</td></tr>)}
            <tr className="doc-total"><td><strong>Total due</strong></td><td className="right num"><strong>{money(s.totalDueMinor)}</strong></td></tr>
            {s.creditMinor > 0 ? <tr><td>Credit on your account</td><td className="right num">{money(s.creditMinor)}</td></tr> : null}
          </tbody>
        </table>
        {s.payments.length > 0 && <>
          <h3 className="small muted" style={{ margin: '20px 0 6px' }}>Payments received in the last month</h3>
          <table><tbody>{s.payments.map((p: any, n: number) => <tr key={n}><td>{fmtDate(p.paidOn)}</td><td>{p.kind === 'refund' ? 'Refund' : p.kind === 'deposit' ? 'Deposit' : 'Payment'} · {p.method}{p.reference ? ` #${p.reference}` : ''}{p.invoiceNumber ? ` · ${p.invoiceNumber}` : ''}</td><td className="right num">{p.kind === 'refund' ? '−' : ''}{money(p.amountMinor)}</td></tr>)}</tbody></table>
        </>}
        {co.paymentInstructions || co.remitTo ? <div className="doc-pay">{co.paymentInstructions ? <p className="small pre"><strong>How to pay:</strong> {co.paymentInstructions}</p> : null}{co.remitTo ? <p className="small pre"><strong>Send payments to:</strong> {co.remitTo}</p> : null}</div> : null}
      </article>
      {s.messageId && s.messageStatus === 'prepared' ? <p className="small muted no-print">The statement email is prepared. Review and send it from <Link to={c.to('collections')}>Collections</Link> or <Link to={c.to('messages')}>Messages</Link>.</p> : null}
    </div>
  );
}
