import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Wallet, Check, Send, Ban, Printer, RefreshCw, Plus, Tag, AlertTriangle, Pencil, Trash2, Receipt } from 'lucide-react';
import { get, post, put, patch } from '../lib/api';
import { useWorkspace } from '../lib/session';
import { useSubmit } from '../lib/form';
import { useTitle } from '../lib/title';
import { fmtDate, minorToInput } from '../lib/format';
import { PageHeader, Button, LinkButton, Empty, Loading, ErrorState, Segmented, TextField, SelectField, FormError, Money, Dialog, Banner, Badge, Check as CheckBox, useToast, Confirm } from '../components/ui';
import { formatRate, rateToInput, lineAmount, parseRate } from '../../shared/money';
import { PAYMENT_METHODS } from '../../shared/invoices';

// Money: what is owed by age, finished work ready to bill, invoices with exact totals (a missing
// price holds the invoice), approvals, payments and the price list. Only roles that see money.

function NeedsMoney({ children }: { children: React.ReactNode }) {
  const ws = useWorkspace();
  if (!ws.can('money.view')) return <div className="page"><ErrorState error={{ status: 403, message: `Your role (${ws.role.name}) doesn't show money.` }} /></div>;
  return <>{children}</>;
}

const TONE: Record<string, 'open' | 'good' | 'bad' | 'attn' | 'cancelled'> = { not_issued: 'open', unpaid: 'open', partly_paid: 'attn', paid: 'good', overdue: 'bad', void: 'cancelled' };
function InvoiceState({ inv }: { inv: any }) {
  if (inv.status === 'held') return <Badge tone="attn" icon={<AlertTriangle aria-hidden="true" />}>Held</Badge>;
  if (inv.status === 'draft') return <Badge tone="open">Waiting for approval</Badge>;
  if (inv.status === 'approved') return <Badge tone="good">Approved, not issued</Badge>;
  return <Badge tone={TONE[inv.payment.key]}>{inv.payment.label}</Badge>;
}

export function MoneyHome() {
  const ws = useWorkspace();
  useTitle('Money', ws.workspace.name);
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const s = useQuery({ queryKey: [ws.cid, 'money', 'summary'], queryFn: () => get<any>(`/c/${ws.cid}/money/summary`), enabled: ws.can('money.view') });
  const ready = useQuery({ queryKey: [ws.cid, 'money', 'ready'], queryFn: () => get<{ work: any[] }>(`/c/${ws.cid}/money/ready`), enabled: ws.can('invoices.manage') && ws.can('money.view') });
  const [picked, setPicked] = useState<string[]>([]);
  const bill = useSubmit(async (ids: string[]) => {
    const r = await post<{ id: string; status: string }>(`/c/${ws.cid}/invoices`, { workIds: ids });
    await qc.invalidateQueries({ queryKey: [ws.cid] });
    toast(r.status === 'held' ? 'Invoice prepared, but held: it needs a fix.' : 'Invoice prepared.');
    nav(ws.to(`money/invoices/${r.id}`));
  });
  const cur = ws.workspace.currency;
  const groups = new Map<string, any[]>();
  for (const w of ready.data?.work ?? []) groups.set(w.client_id ?? 'none', [...(groups.get(w.client_id ?? 'none') ?? []), w]);
  return (
    <NeedsMoney>
      <div className="page">
        <PageHeader title="Money">
          <LinkButton to={ws.to('money/invoices')} icon={<FileText size={18} aria-hidden="true" />}>Invoices</LinkButton>
          {ws.can('catalog.manage') && <LinkButton to={ws.to('money/prices')} icon={<Tag size={18} aria-hidden="true" />}>Prices</LinkButton>}
        </PageHeader>
        {s.isLoading ? <Loading /> : s.error ? <ErrorState error={s.error} retry={() => s.refetch()} /> : (
          <>
            <section aria-labelledby="m-owed" className="stack">
              <h2 id="m-owed">Owed to you</h2>
              <div className="facts">
                <div className="fact"><span className="label">Total owed</span><Money className="value mono" minor={s.data.owedMinor} currency={cur} /></div>
                {s.data.aging.map((a: any) => (
                  <Link key={a.key} to={ws.to('money/invoices?status=unpaid')} className="fact" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <span className="label">{a.label}</span><Money className="value mono" minor={a.minor} currency={cur} />
                  </Link>
                ))}
              </div>
              <p className="small muted">Paid this month: <Money minor={s.data.paidThisMonthMinor} currency={cur} /></p>
            </section>
            {(s.data.held > 0 || s.data.waiting > 0 || s.data.approved > 0) && (
              <div className="grid-3">
                {s.data.held > 0 && <Link to={ws.to('money/invoices?status=held')} className="card attention-card row" style={{ textDecoration: 'none', color: 'inherit' }}><AlertTriangle className="icon-attn" aria-hidden="true" /><span><strong>{s.data.held} held</strong><br /><span className="small">Need a price or a fix</span></span></Link>}
                {s.data.waiting > 0 && <Link to={ws.to('money/invoices?status=draft')} className="card row" style={{ textDecoration: 'none', color: 'inherit' }}><FileText aria-hidden="true" /><span><strong>{s.data.waiting} waiting for approval</strong></span></Link>}
                {s.data.approved > 0 && <Link to={ws.to('money/invoices?status=approved')} className="card row" style={{ textDecoration: 'none', color: 'inherit' }}><Send aria-hidden="true" /><span><strong>{s.data.approved} approved</strong><br /><span className="small">Ready to issue</span></span></Link>}
              </div>
            )}
          </>
        )}
        {ws.can('invoices.manage') && (
          <section className="stack" aria-labelledby="m-ready">
            <div className="row-between"><h2 id="m-ready">Ready to bill</h2>{picked.length > 0 && <Button variant="primary" busy={bill.busy} onClick={() => void bill.run(picked)}>Prepare one invoice for {picked.length}</Button>}</div>
            <FormError error={bill.error} />
            {ready.isLoading ? <Loading rows={2} /> : !ready.data?.work.length ? (
              <div className="card"><Empty icon={<Receipt />} title="Nothing waiting to be billed">Finished {ws.words.work.many.toLowerCase()} appear here until they’re on an invoice.</Empty></div>
            ) : [...groups.entries()].map(([cid, items]) => (
              <div key={cid} className="card stack-sm">
                <div className="row-between"><strong>{items[0].client_name ?? `No ${ws.words.customer.one.toLowerCase()}`}</strong>
                  {cid !== 'none' && <Button size="sm" busy={bill.busy} onClick={() => void bill.run(items.map((w) => w.id))}>Bill {items.length === 1 ? 'it' : `all ${items.length}`}</Button>}</div>
                {items.map((w) => (
                  <div key={w.id} className="row">
                    {cid !== 'none' && <input type="checkbox" aria-label={`Choose #${w.number}`} checked={picked.includes(w.id)} onChange={() => setPicked(picked.includes(w.id) ? picked.filter((x) => x !== w.id) : [...picked.filter((x) => items.some((i) => i.id === x)), w.id])} style={{ width: 20, height: 20 }} />}
                    <Link to={ws.to(`work/${w.id}`)} className="grow">#{w.number} {w.title}</Link>
                    {w.unpriced > 0 ? <Badge tone="attn">No price on {w.unpriced}</Badge> : !w.lines ? <Badge tone="attn">No lines</Badge> : null}
                  </div>
                ))}
                {cid === 'none' && <p className="small muted">Add a {ws.words.customer.one.toLowerCase()} to these before billing.</p>}
              </div>
            ))}
          </section>
        )}
      </div>
    </NeedsMoney>
  );
}

export function Invoices() {
  const ws = useWorkspace();
  useTitle('Invoices', ws.workspace.name);
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') ?? '';
  const r = useQuery({ queryKey: [ws.cid, 'invoices', status], queryFn: () => get<{ invoices: any[] }>(`/c/${ws.cid}/invoices${status ? `?status=${status}` : ''}`), enabled: ws.can('money.view') });
  return (
    <NeedsMoney>
      <div className="page">
        <PageHeader back={{ to: ws.to('money'), label: 'Money' }} title="Invoices" />
        <Segmented label="Show" value={status} onChange={(v) => setSp(v ? { status: v } : {}, { replace: true })} options={[
          { value: '', label: 'All' }, { value: 'held', label: 'Held' }, { value: 'draft', label: 'To approve' }, { value: 'approved', label: 'To issue' }, { value: 'unpaid', label: 'Unpaid' }, { value: 'paid', label: 'Paid' },
        ]} />
        {r.isLoading ? <Loading /> : r.error ? <ErrorState error={r.error} retry={() => r.refetch()} /> : !r.data!.invoices.length ? (
          <div className="card"><Empty icon={<FileText />} title="No invoices here">Invoices are prepared from finished work in Money.</Empty></div>
        ) : (
          <div className="card card-flush"><table className="table stackable">
            <thead><tr><th>Invoice</th><th>{ws.words.customer.one}</th><th>State</th><th>Due</th><th className="r">Total</th><th className="r">Still owed</th></tr></thead>
            <tbody>{r.data!.invoices.map((i) => (
              <tr key={i.id}>
                <td data-label="Invoice"><Link to={ws.to(`money/invoices/${i.id}`)}>{i.number ?? 'Not issued'}</Link></td>
                <td data-label={ws.words.customer.one}>{i.client?.name ?? '—'}</td>
                <td data-label="State"><InvoiceState inv={i} /></td>
                <td data-label="Due">{i.dueOn ? fmtDate(i.dueOn) : '—'}</td>
                <td data-label="Total" className="r"><Money minor={i.totalMinor} currency={i.currency} /></td>
                <td data-label="Still owed" className="r">{i.status === 'issued' ? <Money minor={i.balanceMinor} currency={i.currency} /> : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </NeedsMoney>
  );
}

export function InvoiceDetail() {
  const ws = useWorkspace();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const r = useQuery({ queryKey: [ws.cid, 'invoice', id], queryFn: () => get<any>(`/c/${ws.cid}/invoices/${id}`), enabled: ws.can('money.view') });
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [editing, setEditing] = useState(false);
  useTitle(r.data?.invoice.number ?? 'Invoice', ws.workspace.name);
  const refresh = () => qc.invalidateQueries({ queryKey: [ws.cid] });
  const approve = useSubmit(async () => { await post(`/c/${ws.cid}/invoices/${id}/approve`, { version: r.data.invoice.version }); toast('Approved.'); await refresh(); });
  const issue = useSubmit(async () => { const x = await post<{ number: string }>(`/c/${ws.cid}/invoices/${id}/issue`); toast(`Issued as ${x.number}.`); await refresh(); });
  const recheck = useSubmit(async () => { const x = await post<{ status: string }>(`/c/${ws.cid}/invoices/${id}/refresh`); toast(x.status === 'held' ? 'Still held. See why below.' : 'Prices filled in. It’s ready for approval.'); await refresh(); });
  const undoPay = useSubmit(async (pid: string) => { await post(`/c/${ws.cid}/payments/${pid}/void`); toast('Payment removed.'); await refresh(); });
  if (!ws.can('money.view')) return <NeedsMoney>{null}</NeedsMoney>;
  if (r.isLoading) return <div className="page"><Loading /></div>;
  if (r.error) return <div className="page"><ErrorState error={r.error} retry={() => r.refetch()} /></div>;
  const { invoice: inv, lines, payments, work, from, billTo, approvalRequired } = r.data;
  const cur = inv.currency;
  const err = approve.error ?? issue.error ?? recheck.error ?? undoPay.error;
  return (
    <div className="page">
      <PageHeader back={{ to: ws.to('money/invoices'), label: 'Invoices' }} title={inv.number ?? (inv.status === 'held' ? 'Held invoice' : 'Draft invoice')} eyebrow={<InvoiceState inv={inv} />}>
        <Button icon={<Printer size={18} aria-hidden="true" />} onClick={() => window.print()} className="no-print">Print</Button>
      </PageHeader>
      <FormError error={err} />
      {inv.status === 'held' && (
        <Banner tone="attn" title="Held: it can’t be approved yet" action={ws.can('invoices.manage') ? <Button size="sm" busy={recheck.busy} onClick={() => void recheck.run()} icon={<RefreshCw size={16} aria-hidden="true" />}>Check again</Button> : undefined}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{inv.holdReasons.map((h: string) => <li key={h}>{h}</li>)}</ul>
          {ws.can('catalog.manage') && <> Set missing prices in <Link to={ws.to('money/prices')}>Prices</Link>, then check again.</>}
        </Banner>
      )}
      {inv.preparedBy === 'rigo' && inv.status !== 'issued' && <Banner tone="info" title="Rigo prepared this invoice">It waits for a person. Nothing is approved or issued by itself.</Banner>}
      {inv.status !== 'void' && inv.status !== 'issued' && (
        <div className="form-actions no-print">
          {inv.status === 'draft' && ws.can('invoices.approve') && <Button variant="primary" size="lg" busy={approve.busy} onClick={() => void approve.run()} icon={<Check size={18} aria-hidden="true" />}>Approve <Money minor={inv.totalMinor} currency={cur} /></Button>}
          {(inv.status === 'approved' || (inv.status === 'draft' && !approvalRequired)) && ws.can('invoices.manage') && <Button variant="primary" size="lg" busy={issue.busy} onClick={() => void issue.run()} icon={<Send size={18} aria-hidden="true" />}>Issue it</Button>}
          {ws.can('invoices.manage') && <Button onClick={() => setEditing(true)} icon={<Pencil size={18} aria-hidden="true" />}>Change lines</Button>}
          {ws.can('invoices.manage') && <Button variant="ghost" onClick={() => setVoiding(true)} icon={<Trash2 size={18} aria-hidden="true" />}>Discard</Button>}
        </div>
      )}
      {inv.status === 'issued' && (
        <div className="form-actions no-print">
          {inv.payment.key !== 'paid' && ws.can('payments.record') && <Button variant="primary" size="lg" onClick={() => setPaying(true)} icon={<Wallet size={18} aria-hidden="true" />}>Record a payment</Button>}
          {ws.can('invoices.manage') && <Button variant="ghost" onClick={() => setVoiding(true)} icon={<Ban size={18} aria-hidden="true" />}>Void</Button>}
        </div>
      )}

      <article className="paper" aria-label="Invoice">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div className="stack-sm"><h2 style={{ fontSize: '1.5rem' }}>{from.name}</h2><span className="muted small">{[from.address, from.phone, from.email].filter(Boolean).join(' · ')}</span></div>
          <div className="stack-sm" style={{ textAlign: 'right' }}><strong className="mono">{inv.number ?? 'DRAFT'}</strong>
            {inv.issuedOn && <span className="small">Issued {fmtDate(inv.issuedOn)}</span>}{inv.dueOn && <span className="small">Due {fmtDate(inv.dueOn)}</span>}
            {!inv.issuedOn && <span className="small muted">{inv.termsDays === 0 ? 'Due on receipt' : `Net ${inv.termsDays}`}</span>}</div>
        </div>
        {billTo && <div className="stack-sm"><span className="small muted">Bill to</span><strong>{billTo.name}</strong><span className="small">{[billTo.address, billTo.email, billTo.phone].filter(Boolean).join(' · ')}</span></div>}
        <table>
          <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Price</th><th className="r">Amount</th></tr></thead>
          <tbody>{lines.map((l: any) => (
            <tr key={l.id}><td>{l.description}{l.taxable ? <span className="muted small"> · taxable</span> : null}</td><td className="r mono">{l.quantity}{l.unit ? ` ${l.unit}` : ''}</td>
              <td className="r">{l.rateE4 === null ? <strong>No price</strong> : <span className="money">{formatRate(l.rateE4, cur)}</span>}</td><td className="r"><Money minor={l.amountMinor} currency={cur} /></td></tr>
          ))}</tbody>
        </table>
        <div className="totals">
          <div><span>Subtotal</span><Money minor={inv.subtotalMinor} currency={cur} /></div>
          <div><span>Tax{inv.taxExempt ? ' (exempt)' : inv.taxRateBp !== null ? ` (${(inv.taxRateBp / 100).toFixed(2).replace(/\.?0+$/, '')}%)` : ''}</span><Money minor={inv.taxMinor} currency={cur} /></div>
          <div className="grand"><span>Total</span><Money minor={inv.totalMinor} currency={cur} /></div>
          {inv.status === 'issued' && <><div><span>Paid</span><Money minor={inv.paidMinor} currency={cur} /></div><div><strong>Still owed</strong><strong><Money minor={inv.balanceMinor} currency={cur} /></strong></div></>}
        </div>
        {inv.notes && <p className="small">{inv.notes}</p>}
      </article>

      {work.length > 0 && <p className="small muted no-print">For {work.map((w: any, i: number) => <span key={w.id}>{i ? ', ' : ''}<Link to={ws.to(`work/${w.id}`)}>#{w.number} {w.title}</Link></span>)}.</p>}
      {inv.approvedBy && <p className="small muted no-print">Approved by {inv.approvedBy}.</p>}
      {inv.status === 'void' && <Banner tone="plain" title="Void">It keeps its number. {inv.voidReason}</Banner>}

      {payments.length > 0 && (
        <section className="card stack no-print" aria-labelledby="pays">
          <h2 id="pays">Payments</h2>
          <ul className="divider-list">{payments.map((p: any) => (
            <li key={p.id} className="list-row" style={{ paddingInline: 0 }}>
              <span className="row-main"><span className="row-title"><Money minor={p.amount_minor} currency={cur} /> by {PAYMENT_METHODS[p.method as keyof typeof PAYMENT_METHODS] ?? p.method}{p.voided_at ? ' (removed)' : ''}</span><span className="row-sub">{fmtDate(p.received_on)}{p.reference ? ` · ${p.reference}` : ''}{p.recorded_by ? ` · recorded by ${p.recorded_by}` : ''}</span></span>
              {!p.voided_at && ws.can('payments.record') && <Button size="sm" variant="ghost" onClick={() => void undoPay.run(p.id)}>Remove</Button>}
            </li>
          ))}</ul>
        </section>
      )}

      {paying && <PaymentDialog inv={inv} onClose={() => setPaying(false)} onDone={() => { setPaying(false); void refresh(); }} />}
      {voiding && <VoidDialog inv={inv} onClose={() => setVoiding(false)} onDone={() => { setVoiding(false); void refresh(); if (inv.status !== 'issued') nav(ws.to('money')); }} />}
      {editing && <EditLines inv={inv} lines={lines} onClose={() => setEditing(false)} onDone={() => { setEditing(false); void refresh(); }} />}
    </div>
  );
}

function PaymentDialog({ inv, onClose, onDone }: { inv: any; onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const [v, setV] = useState({ amount: minorToInput(inv.balanceMinor), method: 'check', reference: '', receivedOn: '' });
  const save = useSubmit(async () => {
    const r = await post<{ status: string }>(`/c/${ws.cid}/invoices/${inv.id}/payments`, { ...v, receivedOn: v.receivedOn || undefined });
    toast(r.status === 'paid' ? 'Paid in full.' : 'Payment recorded.');
    onDone();
  });
  return (
    <Dialog title="Record a payment" onClose={onClose} actions={<><Button variant="primary" busy={save.busy} onClick={() => void save.run()}>Record payment</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></>}>
      <p className="muted">Still owed: <Money minor={inv.balanceMinor} currency={inv.currency} />. Rigo records money you received; it doesn’t take payments.</p>
      <FormError error={save.error} />
      <TextField label="Amount" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} error={save.fieldError('amount')} />
      <SelectField label="How" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
        {(['cash', 'check', 'card', 'bank_transfer', 'other'] as const).map((m) => <option key={m} value={m}>{PAYMENT_METHODS[m]}</option>)}
      </SelectField>
      <TextField label="Reference" optional hint="Check number or receipt." value={v.reference} maxLength={80} onChange={(e) => setV({ ...v, reference: e.target.value })} />
      <TextField label="Received on" optional type="date" value={v.receivedOn} onChange={(e) => setV({ ...v, receivedOn: e.target.value })} error={save.fieldError('receivedOn')} />
    </Dialog>
  );
}

function VoidDialog({ inv, onClose, onDone }: { inv: any; onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const [reason, setReason] = useState('');
  const save = useSubmit(async () => { await post(`/c/${ws.cid}/invoices/${inv.id}/void`, { reason }); onDone(); });
  const issued = inv.status === 'issued';
  return (
    <Dialog title={issued ? `Void ${inv.number}?` : 'Discard this invoice?'} onClose={onClose} actions={<><Button variant="danger" busy={save.busy} onClick={() => void save.run()}>{issued ? 'Void invoice' : 'Discard invoice'}</Button><Button variant="ghost" onClick={onClose}>Keep it</Button></>}>
      <p className="muted">{issued ? 'It keeps its number and shows as void. The work can be billed again.' : 'It is removed, and the work goes back to Ready to bill.'}</p>
      <FormError error={save.error} />
      <TextField label="Why" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} error={save.fieldError('reason')} />
    </Dialog>
  );
}

function EditLines({ inv, lines: initial, onClose, onDone }: { inv: any; lines: any[]; onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const [lines, setLines] = useState(initial.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, rate: l.rateE4 === null ? '' : rateToInput(l.rateE4), taxable: l.taxable, workId: l.workId })));
  const [terms, setTerms] = useState(String(inv.termsDays));
  const save = useSubmit(async () => { await put(`/c/${ws.cid}/invoices/${inv.id}`, { version: inv.version, termsDays: Number(terms), lines: lines.map((l) => ({ ...l, rate: l.rate || null })) }); onDone(); });
  const set = (i: number, p: any) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <Dialog wide title="Change the lines" onClose={onClose} actions={<><Button variant="primary" busy={save.busy} onClick={() => void save.run()}>Save</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></>}>
      {inv.status === 'approved' && <Banner tone="attn">Changing an approved invoice needs approving again.</Banner>}
      <FormError error={save.error} />
      {lines.map((l, i) => (
        <div key={i} className="card soft stack-sm">
          <div className="input-group" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
            <TextField label="Item" value={l.description} maxLength={200} onChange={(e) => set(i, { description: e.target.value })} style={{ minWidth: 160 }} />
            <TextField label="Qty" inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value.replace(/[^\d.]/g, '') })} />
            <TextField label="Price" inputMode="decimal" placeholder="No price" value={l.rate} onChange={(e) => set(i, { rate: e.target.value.replace(/[^\d.]/g, '') })} />
            <Button variant="ghost" className="icon-btn" aria-label={`Remove ${l.description}`} onClick={() => setLines(lines.filter((_, j) => j !== i))} style={{ flex: '0 0 auto' }}><Trash2 size={18} /></Button>
          </div>
          <div className="row-between"><CheckBox label="Taxable" checked={l.taxable} onChange={(e) => set(i, { taxable: e.target.checked })} />
            {parseRate(l.rate) !== null && /^\d+(\.\d+)?$/.test(l.quantity) && <span className="small">Amount <Money minor={lineAmount(l.quantity, parseRate(l.rate))} currency={inv.currency} /></span>}</div>
        </div>
      ))}
      <Button icon={<Plus size={18} aria-hidden="true" />} onClick={() => setLines([...lines, { description: '', quantity: '1', unit: '', rate: '', taxable: false, workId: null }])}>Add a line</Button>
      <SelectField label="Payment terms" value={terms} onChange={(e) => setTerms(e.target.value)}>
        {[0, 7, 14, 15, 30, 45, 60].map((d) => <option key={d} value={d}>{d === 0 ? 'Due on receipt' : `Net ${d} days`}</option>)}
      </SelectField>
    </Dialog>
  );
}

export function Prices() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  useTitle('Prices', ws.workspace.name);
  const items = useQuery({ queryKey: [ws.cid, 'catalog'], queryFn: () => get<{ items: any[] }>(`/c/${ws.cid}/catalog`) });
  const settings = useQuery({ queryKey: [ws.cid, 'money', 'settings'], queryFn: () => get<any>(`/c/${ws.cid}/money/settings`), enabled: ws.can('money.view') });
  const [edit, setEdit] = useState<any>(null);
  const [st, setSt] = useState<any>(null);
  const [confirmApproval, setConfirmApproval] = useState(false);
  useEffect(() => { if (settings.data) setSt({ invoicePrefix: settings.data.invoicePrefix, nextNumber: String(settings.data.nextNumber), termsDays: String(settings.data.termsDays), approvalRequired: settings.data.approvalRequired, taxRate: settings.data.taxRateBp === null ? '' : String(settings.data.taxRateBp / 100) }); }, [settings.data]);
  const saveSettings = useSubmit(async (approvalRequired?: boolean) => {
    await patch(`/c/${ws.cid}/money/settings`, { invoicePrefix: st.invoicePrefix, termsDays: Number(st.termsDays), taxRate: st.taxRate === '' ? null : st.taxRate,
      ...(Number(st.nextNumber) !== settings.data.nextNumber ? { nextNumber: Number(st.nextNumber) } : {}), ...(approvalRequired !== undefined ? { approvalRequired } : {}) });
    toast('Saved.');
    await qc.invalidateQueries({ queryKey: [ws.cid] });
  });
  if (!ws.can('catalog.manage')) return <div className="page"><ErrorState error={{ status: 403, message: `Your role (${ws.role.name}) can't set prices.` }} /></div>;
  const unpriced = (items.data?.items ?? []).filter((i) => i.active && !i.priced).length;
  return (
    <div className="page page-narrow">
      <PageHeader back={{ to: ws.to('money'), label: 'Money' }} title="Prices" sub="What you sell and what it costs. A missing price holds any invoice that uses it; it is never charged as zero.">
        <Button variant="primary" icon={<Plus size={18} aria-hidden="true" />} onClick={() => setEdit({})}>Add an item</Button>
      </PageHeader>
      {unpriced > 0 && <Banner tone="attn" title={`${unpriced} item${unpriced === 1 ? ' has' : 's have'} no price yet`}>Invoices that use {unpriced === 1 ? 'it' : 'them'} are held until a price is set.</Banner>}
      {items.isLoading ? <Loading /> : (
        <div className="card card-flush"><ul className="divider-list">
          {items.data!.items.map((i) => (
            <li key={i.id}><button className="list-row" onClick={() => setEdit(i)}>
              <span className="row-main"><span className="row-title">{i.name}{!i.active && <span className="muted"> (hidden)</span>}</span><span className="row-sub">{[i.unit && `per ${i.unit}`, i.taxable ? 'taxable' : 'not taxable'].filter(Boolean).join(' · ')}</span></span>
              <span className="row-end">{i.rateE4 === null ? <Badge tone="attn">No price</Badge> : <span className="money">{formatRate(i.rateE4, ws.workspace.currency)}</span>}</span>
            </button></li>
          ))}
          {!items.data!.items.length && <li><Empty icon={<Tag />} title="No items yet">Add what you sell, with its price.</Empty></li>}
        </ul></div>
      )}
      {st && (
        <section className="card stack" aria-labelledby="inv-set">
          <h2 id="inv-set">Invoices and tax</h2>
          <FormError error={saveSettings.error} />
          <div className="grid-2">
            <TextField label="Tax rate" hint="A percentage, like 8.25. Leave empty if not set yet." inputMode="decimal" value={st.taxRate} onChange={(e) => setSt({ ...st, taxRate: e.target.value })} error={saveSettings.fieldError('taxRate')} />
            <SelectField label="Payment terms" value={st.termsDays} onChange={(e) => setSt({ ...st, termsDays: e.target.value })}>
              {[0, 7, 14, 15, 30, 45, 60].map((d) => <option key={d} value={d}>{d === 0 ? 'Due on receipt' : `Net ${d} days`}</option>)}
            </SelectField>
            <TextField label="Number prefix" value={st.invoicePrefix} maxLength={12} onChange={(e) => setSt({ ...st, invoicePrefix: e.target.value })} error={saveSettings.fieldError('invoicePrefix')} />
            <TextField label="Next number" hint="Continue from your previous system. Only moves forward." inputMode="numeric" value={st.nextNumber} onChange={(e) => setSt({ ...st, nextNumber: e.target.value.replace(/\D/g, '') })} error={saveSettings.fieldError('nextNumber')} />
          </div>
          {ws.role.isOwner && <CheckBox label="Every invoice needs a person’s approval before it is issued" hint="Recommended. Turning this off lets invoices be issued without an approval step." checked={st.approvalRequired}
            onChange={(e) => { if (!e.target.checked) setConfirmApproval(true); else { setSt({ ...st, approvalRequired: true }); void saveSettings.run(true); } }} />}
          <div><Button busy={saveSettings.busy} onClick={() => void saveSettings.run()}>Save</Button></div>
        </section>
      )}
      {confirmApproval && <Confirm title="Stop requiring approval?" danger confirm="Stop requiring approval" body="Invoices could then be issued without anyone approving the amounts. Rigo’s Automatic level could issue them by itself." onClose={() => setConfirmApproval(false)}
        onConfirm={() => { setConfirmApproval(false); setSt({ ...st, approvalRequired: false }); void saveSettings.run(false); }} />}
      {edit && <ItemDialog item={edit.id ? edit : null} onClose={() => setEdit(null)} onDone={() => { setEdit(null); void qc.invalidateQueries({ queryKey: [ws.cid] }); }} />}
    </div>
  );
}

function ItemDialog({ item, onClose, onDone }: { item: any | null; onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const [v, setV] = useState({ name: item?.name ?? '', unit: item?.unit ?? '', rate: item?.rateE4 === null || item?.rateE4 === undefined ? '' : rateToInput(item.rateE4), taxable: item?.taxable ?? false, active: item?.active ?? true });
  const save = useSubmit(async () => {
    const body = { ...v, rate: v.rate.trim() === '' ? null : v.rate };
    if (item) await patch(`/c/${ws.cid}/catalog/${item.id}`, body); else await post(`/c/${ws.cid}/catalog`, body);
    onDone();
  });
  return (
    <Dialog title={item ? item.name : 'Add an item'} onClose={onClose} actions={<><Button variant="primary" busy={save.busy} onClick={() => void save.run()}>Save</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></>}>
      <FormError error={save.error} />
      <TextField label="Name" value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} error={save.fieldError('name')} />
      <div className="grid-2">
        <TextField label="Price" optional hint="Up to 4 decimals, like 3.8995." inputMode="decimal" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} error={save.fieldError('rate')} />
        <TextField label="Per" optional hint="For example, hour, gal, visit." value={v.unit} maxLength={20} onChange={(e) => setV({ ...v, unit: e.target.value })} />
      </div>
      <CheckBox label="Taxable" checked={v.taxable} onChange={(e) => setV({ ...v, taxable: e.target.checked })} />
      <CheckBox label="Offer it" hint="Hidden items stay on old work and invoices." checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
    </Dialog>
  );
}
