import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Receipt, CheckCircle2, Send, Printer, Pencil, Plus, Trash2, Ban, CircleDollarSign, Mail } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, put, newId } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Select, Textarea, ErrorSummary, LoadingBlock, ErrorState, PageHeader, Empty, Pill, InvoiceStatus, MessageStatus, Banner, Dialog, Checkbox, Segmented, useToast, useConfirm } from '../components/ui';
import { formatMoney, parseMoney, minorToInput, fmtDate, fmtDateTime } from '../lib/format';
import { computeTotals, lineAmount } from '../../shared/billing';

const DELIVERY: Record<string, string> = { not_prepared: 'Not prepared', prepared: 'Email prepared', simulated: 'Simulated (demo)', queued: 'Queued', sent: 'Sent', delivered: 'Delivered', failed: 'Failed' };
const PAYMENT: Record<string, [any, string]> = { unpaid: ['neutral', 'Unpaid'], partially_paid: ['info', 'Partly paid'], paid: ['success', 'Paid'] };

export function Invoices() {
  const c = useCompany();
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') ?? 'attention';
  const q = useQuery({ queryKey: [c.cid, 'invoices', status], queryFn: () => get(`/c/${c.cid}/invoices?status=${status}`) });
  const fin = c.can('finance.view');
  return (
    <div className="page">
      <PageHeader title="Invoices" sub="Draft, approval, issue, delivery and payment are tracked separately." />
      <Segmented label="Filter invoices" value={status} onChange={(k) => setSp({ status: k })} options={[{ key: 'attention', label: 'Needs work' }, { key: 'held', label: 'On hold' }, { key: 'issued', label: 'Issued' }, { key: 'unpaid', label: 'Unpaid' }, { key: 'all', label: 'All' }]} />
      {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorState error={q.error} /> : q.data.invoices.length === 0 ? (
        <Card><Empty icon={<Receipt aria-hidden />} title="No invoices here">Invoices are prepared from completed jobs, by a person or by your workflows.</Empty></Card>
      ) : (
        <div className="card card-flush"><div className="table-wrap"><table className="table responsive">
          <thead><tr><th>Invoice</th><th>Customer</th><th>Status</th><th>Delivery</th><th>Payment</th>{fin && <th className="right">Total</th>}</tr></thead>
          <tbody>{q.data.invoices.map((i: any) => (
            <tr key={i.id}>
              <td data-primary><Link className="row-link" to={c.to(`invoices/${i.id}`)}>{i.number ?? 'Draft'}</Link><div className="small muted">{i.jobNumber ? `Job #${i.jobNumber}` : i.recurringPlanId ? 'Rental billing' : ''} · {fmtDate(i.createdAt)}</div></td>
              <td data-label="Customer">{i.customerName ?? '—'}</td>
              <td data-label="Status"><InvoiceStatus status={i.status} /></td>
              <td data-label="Delivery" className="small">{DELIVERY[i.deliveryStatus]}</td>
              <td data-label="Payment"><Pill tone={PAYMENT[i.paymentStatus][0]}>{PAYMENT[i.paymentStatus][1]}</Pill></td>
              {fin && <td data-label="Total" className="right num">{i.totalMinor === null ? <span className="muted">Incomplete</span> : formatMoney(i.totalMinor, i.currency)}</td>}
            </tr>
          ))}</tbody>
        </table></div></div>
      )}
    </div>
  );
}

function LinesEditor({ data, onDone, onCancel }: { data: any; onDone: () => void; onCancel: () => void }) {
  const c = useCompany();
  const [lines, setLines] = useState<any[]>(() => data.lines.map((l: any) => ({ ...l, rate: minorToInput(l.rateMinor) })));
  const [notes, setNotes] = useState(data.invoice.notes ?? '');
  const parsed = lines.map((l) => ({ ...l, rateMinor: l.rate.trim() === '' ? null : parseMoney(l.rate) }));
  const preview = computeTotals(parsed.map((l) => ({ ...l, amountMinor: l.rateMinor === null || !/^\d+(\.\d+)?$/.test(l.quantity) ? null : l.kind === 'discount' ? -Math.abs(lineAmount(l.quantity, l.rateMinor) as number) : lineAmount(l.quantity, l.rateMinor) })), null);
  const s = useSubmit(async () => {
    if (parsed.some((l) => l.rate.trim() !== '' && l.rateMinor === null)) throw new Error('Enter rates like 12.50.');
    await put(`/c/${c.cid}/invoices/${data.invoice.id}/lines`, { version: data.invoice.version, notes, lines: parsed.map(({ description, quantity, unit, rateMinor, taxable, kind }) => ({ description, quantity, unit, rateMinor, taxable, kind })) });
    onDone();
  });
  const set = (i: number, p: any) => setLines(lines.map((l, x) => (x === i ? { ...l, ...p } : l)));
  return (
    <Card id="edit" title="Edit lines">
      <div className="stack">
        <Banner tone="info">Saving recalculates totals and cancels any approval given for the previous version.</Banner>
        <ErrorSummary error={s.error} />
        {lines.map((l, i) => (
          <div key={i} className="card" style={{ padding: 12 }}>
            <div className="grid-2">
              <Field label="Description" id={`f-lines-${i}-description`} error={s.fieldError(`lines.${i}.description`)}>{(p) => <Input {...p} value={l.description} onChange={(e) => set(i, { description: e.target.value })} />}</Field>
              <Field label="Type" id={`f-lk-${i}`}>{(p) => <Select {...p} value={l.kind} onChange={(e) => set(i, { kind: e.target.value })}><option value="charge">Charge</option><option value="discount">Discount</option></Select>}</Field>
              <Field label="Quantity" id={`f-lines-${i}-quantity`} error={s.fieldError(`lines.${i}.quantity`)}>{(p) => <Input {...p} inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />}</Field>
              <Field label={`Rate (${data.invoice.currency})`} id={`f-lr-${i}`} hint="Empty keeps the invoice on hold.">{(p) => <Input {...p} inputMode="decimal" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} />}</Field>
            </div>
            <div className="row-between" style={{ marginTop: 8 }}>
              {l.kind === 'charge' ? <Checkbox label="Taxable" checked={l.taxable} onChange={(e) => set(i, { taxable: e.target.checked })} /> : <span />}
              <Button size="sm" variant="danger" icon={<Trash2 aria-hidden />} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, x) => x !== i))}>Remove line</Button>
            </div>
          </div>
        ))}
        <div><Button size="sm" icon={<Plus aria-hidden />} onClick={() => setLines([...lines, { description: '', quantity: '1', unit: '', rate: '', taxable: false, kind: 'charge' }])}>Add line</Button></div>
        <Field label="Note on invoice" optionalText id="f-notes">{(p) => <Textarea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <p className="small muted num">Subtotal before tax: {preview.subtotalMinor === null ? 'incomplete' : formatMoney(preview.subtotalMinor - (preview.discountMinor ?? 0), data.invoice.currency)}. Tax is applied by the server from the service's configured rate.</p>
        <div className="form-actions"><Button variant="primary" busy={s.busy} onClick={() => s.run()}>Save lines</Button><Button onClick={onCancel}>Cancel</Button></div>
      </div>
    </Card>
  );
}

export function InvoiceDoc({ data }: { data: any }) {
  const c = useCompany();
  const i = data.invoice;
  const co = data.company;
  const fin = c.can('finance.view');
  return (
    <article className="doc" aria-label="Invoice preview">
      <div className="doc-accent" style={{ background: c.company.accent.light }} aria-hidden />
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="row">{co.logo ? <img src={`/api/c/${c.cid}/branding/logo`} alt={`${co.name} logo`} style={{ maxHeight: 56, maxWidth: 160 }} /> : null}<div><h2>{co.name}</h2><div className="muted small">{[co.address, co.phone, co.email].filter(Boolean).join(' · ')}</div></div></div>
        <div style={{ textAlign: 'right' }}><div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '1.25rem' }}>INVOICE</div><div className="num">{i.number ?? 'DRAFT — not issued'}</div><div className="muted small">{i.issuedAt ? `Issued ${fmtDate(i.issuedAt)}` : `Prepared ${fmtDate(i.createdAt)}`}</div></div>
      </div>
      <div className="grid-2" style={{ margin: '20px 0' }}>
        <div><div className="muted small">Bill to</div><strong>{i.customerName}</strong>{i.billingAddress ? <div>{i.billingAddress}</div> : null}</div>
        <div><div className="muted small">Service</div>{i.serviceName ?? '—'}{i.jobNumber ? ` · job #${i.jobNumber}` : ''}{i.locationAddress ? <div>{i.locationAddress}</div> : null}{i.completedAt ? <div className="muted small">Completed {fmtDate(i.completedAt)}</div> : null}</div>
      </div>
      <table>
        <thead><tr><th>Description</th><th className="right">Qty</th>{fin && <th className="right">Rate</th>}{fin && <th className="right">Amount</th>}</tr></thead>
        <tbody>{data.lines.map((l: any) => (
          <tr key={l.id}><td>{l.description}</td><td className="right num">{l.quantity} {l.unit}</td>{fin && <td className="right num">{l.rateMinor === null ? <strong>Not set</strong> : formatMoney(l.rateMinor, i.currency)}</td>}{fin && <td className="right num">{l.amountMinor === null ? '—' : formatMoney(l.amountMinor, i.currency)}</td>}</tr>
        ))}</tbody>
      </table>
      {fin && (
        <table style={{ width: 'auto', marginLeft: 'auto', marginTop: 12 }}>
          <tbody>
            <tr><td>Subtotal</td><td className="right num">{formatMoney(i.subtotalMinor, i.currency)}</td></tr>
            {i.discountMinor ? <tr><td>Discount</td><td className="right num">−{formatMoney(i.discountMinor, i.currency)}</td></tr> : null}
            <tr><td>Tax</td><td className="right num">{i.taxMinor === null ? '—' : formatMoney(i.taxMinor, i.currency)}</td></tr>
            <tr><td><strong>Total</strong></td><td className="right num"><strong>{i.totalMinor === null ? 'Incomplete' : formatMoney(i.totalMinor, i.currency)}</strong></td></tr>
            {i.paidMinor ? <tr><td>Paid</td><td className="right num">{formatMoney(i.paidMinor, i.currency)}</td></tr> : null}
          </tbody>
        </table>
      )}
      {i.notes ? <p className="pre small" style={{ marginTop: 16 }}>{i.notes}</p> : null}
      {i.dueDays ? <p className="muted small" style={{ marginTop: 8 }}>Payment due within {i.dueDays} days of issue.</p> : null}
    </article>
  );
}

export function InvoiceDetail() {
  const c = useCompany();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { ask, node } = useConfirm();
  const q = useQuery({ queryKey: [c.cid, 'invoice', id], queryFn: () => get(`/c/${c.cid}/invoices/${id}`) });
  const [editing, setEditing] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [pay, setPay] = useState({ amount: '', method: 'check', note: '', key: newId('pay') });
  const [voidReason, setVoidReason] = useState('');
  useEffect(() => { if (payOpen) setPay((p) => ({ ...p, key: newId('pay') })); }, [payOpen]);
  const refresh = () => qc.invalidateQueries({ queryKey: [c.cid] });
  const approve = useSubmit(async () => { await post(`/c/${c.cid}/invoices/${id}/approve`, { version: q.data.invoice.version }); toast('Invoice approved'); refresh(); });
  const issue = useSubmit(async () => {
    if (!(await ask({ title: 'Issue this invoice?', body: 'It receives the next invoice number and becomes the official record. Issued invoices cannot be edited; they can only be voided if no payment is recorded.', confirm: 'Issue invoice' }))) return;
    const r = await post(`/c/${c.cid}/invoices/${id}/issue`, { version: q.data.invoice.version }); toast(`Issued as ${r.number}`); refresh();
  });
  const email = useSubmit(async () => { await post(`/c/${c.cid}/invoices/${id}/email`); toast('Email prepared. Review it in Messages.'); refresh(); });
  const recordPay = useSubmit(async () => {
    const minor = parseMoney(pay.amount);
    if (minor === null) throw Object.assign(new Error('Enter an amount like 125.00'), {});
    const r = await post(`/c/${c.cid}/invoices/${id}/payments`, { amountMinor: minor, method: pay.method, note: pay.note, idempotencyKey: pay.key });
    setPayOpen(false); toast(r.duplicate ? 'That payment was already recorded.' : 'Payment recorded'); refresh();
  });
  const voidIt = useSubmit(async () => { await post(`/c/${c.cid}/invoices/${id}/void`, { reason: voidReason }); setVoidOpen(false); toast('Invoice voided'); refresh(); });
  if (q.isLoading) return <div className="page"><LoadingBlock /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} /></div>;
  const d = q.data;
  const i = d.invoice;
  const err = approve.error ?? issue.error ?? email.error;
  return (
    <div className="page">
      <div className="no-print"><PageHeader back={{ to: c.to('invoices'), label: 'Invoices' }} title={<span className="row">{i.number ?? 'Draft invoice'}<InvoiceStatus status={i.status} /></span>}
        sub={<span className="row" style={{ gap: 8 }}><span>Delivery: {DELIVERY[i.deliveryStatus]}</span><Pill tone={PAYMENT[i.paymentStatus][0]}>{PAYMENT[i.paymentStatus][1]}</Pill>{i.jobId ? <Link to={c.to(`jobs/${i.jobId}`)}>Job #{i.jobNumber}</Link> : null}</span>}
        actions={<>
          {d.can.edit && !editing && <Button icon={<Pencil aria-hidden />} onClick={() => setEditing(true)}>Edit lines</Button>}
          {d.can.approve && i.status !== 'held' && <Button variant="primary" icon={<CheckCircle2 aria-hidden />} busy={approve.busy} onClick={() => approve.run()}>Approve</Button>}
          {d.can.issue && (i.status === 'approved' || !d.approvalRequired) && <Button variant="primary" icon={<Send aria-hidden />} busy={issue.busy} onClick={() => issue.run()}>Issue</Button>}
          {d.can.message && <Button icon={<Mail aria-hidden />} busy={email.busy} onClick={() => email.run()}>Prepare email</Button>}
          {d.can.pay && <Button icon={<CircleDollarSign aria-hidden />} onClick={() => setPayOpen(true)}>Record payment</Button>}
          <Button icon={<Printer aria-hidden />} onClick={() => window.print()}>Print / save PDF</Button>
          {d.can.void && <Button variant="danger" icon={<Ban aria-hidden />} onClick={() => setVoidOpen(true)}>Void</Button>}
        </>} /></div>
      <div className="no-print stack">
        <ErrorSummary error={err} />
        {i.status === 'held' && <Banner tone="warning" title="On hold: this invoice cannot be approved or issued yet">{<ul style={{ margin: 0 }}>{i.holdReasons.map((r: string) => <li key={r}>{r}</li>)}</ul>}{c.can('services.manage') ? <p style={{ margin: '8px 0 0' }}>Set missing rates in <Link to={c.to('services')}>Services &amp; pricing</Link> or edit the lines here.</p> : null}</Banner>}
        {i.status === 'draft' && d.approvalRequired && <Banner tone="info">This draft needs approval before it can be issued.</Banner>}
        {!c.can('finance.view') && <Banner tone="info">Amounts are hidden for your role.</Banner>}
        {editing && <LinesEditor data={d} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); toast('Lines saved'); refresh(); }} />}
      </div>
      <InvoiceDoc data={d} />
      <div className="grid-2 no-print" style={{ alignItems: 'start' }}>
        <Card id="appr" title="Approvals">{d.approvals.length === 0 ? <p className="muted">No approval requests yet.</p> : <ul className="list">{d.approvals.map((a: any) => <li key={a.id} style={{ padding: '8px 0' }} className="row-between"><span><span className="small">{fmtDateTime(a.created_at)}</span>{a.decided_by_name ? <div className="small muted">{a.status} by {a.decided_by_name}{a.decision_note ? `: ${a.decision_note}` : ''}</div> : a.decision_note ? <div className="small muted">{a.decision_note}</div> : null}</span><Pill tone={a.status === 'approved' ? 'success' : a.status === 'pending' ? 'warning' : a.status === 'rejected' ? 'danger' : 'neutral'}>{a.status}</Pill></li>)}</ul>}</Card>
        <Card id="msg" title="Messages and payments">
          {d.messages.length === 0 && d.payments.length === 0 ? <p className="muted">Nothing yet.</p> : null}
          <ul className="list">
            {d.messages.map((m: any) => <li key={m.id} style={{ padding: '8px 0' }} className="row-between"><span>{m.subject}<div className="small muted">{m.recipient || 'No recipient'}{m.status_detail ? ` · ${m.status_detail}` : ''}</div></span><MessageStatus status={m.status} /></li>)}
            {d.payments.map((p: any) => <li key={p.id} style={{ padding: '8px 0' }} className="row-between"><span>Payment ({p.method.replace('_', ' ')}){p.note ? ` · ${p.note}` : ''}<div className="small muted">{fmtDateTime(p.recorded_at)} by {p.recorded_by_name}</div></span><span className="num">{formatMoney(p.amount_minor, i.currency)}</span></li>)}
          </ul>
          {d.messages.length > 0 && <Link to={c.to('messages')}>Open messages</Link>}
        </Card>
      </div>
      <Dialog open={payOpen} onClose={() => setPayOpen(false)} title="Record a payment received" footer={<><Button onClick={() => setPayOpen(false)}>Cancel</Button><Button variant="primary" busy={recordPay.busy} onClick={() => recordPay.run()}>Record payment</Button></>}>
        <div className="stack">
          <p className="muted">Records money you already received. Rigo does not charge cards or move money.</p>
          <ErrorSummary error={recordPay.error} />
          <Field label={`Amount (${i.currency})`} id="f-amountMinor" hint={`Balance due: ${formatMoney((i.totalMinor ?? 0) - (i.paidMinor ?? 0), i.currency)}`} error={recordPay.fieldError('amountMinor')}>{(p) => <Input {...p} inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />}</Field>
          <Field label="Method" id="f-method">{(p) => <Select {...p} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option value="check">Check</option><option value="cash">Cash</option><option value="card">Card (processed elsewhere)</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></Select>}</Field>
          <Field label="Note" optionalText id="f-note">{(p) => <Input {...p} value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} />}</Field>
        </div>
      </Dialog>
      <Dialog open={voidOpen} onClose={() => setVoidOpen(false)} title="Void this invoice?" footer={<><Button onClick={() => setVoidOpen(false)}>Keep it</Button><Button variant="danger" icon={<Ban aria-hidden />} busy={voidIt.busy} onClick={() => voidIt.run()}>Void invoice</Button></>}>
        <div className="stack"><p>The invoice keeps its number but no longer counts as owed. The job becomes ready to bill again.</p><ErrorSummary error={voidIt.error} />
          <Field label="Reason" id="f-reason" error={voidIt.fieldError('reason')}>{(p) => <Input {...p} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />}</Field></div>
      </Dialog>
      {node}
    </div>
  );
}
