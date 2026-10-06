import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Receipt, CheckCircle2, Send, Printer, Pencil, Plus, Trash2, Ban, CircleDollarSign, Mail, ChevronLeft, ClipboardList, Undo2, FileMinus, Wallet, RotateCcw, XCircle, FilePlus2 } from 'lucide-react';
import { useCompany } from '../lib/session';
import { CustomerPicker } from '../components/customer-picker';
import { get, post, put, newId, type ApiError } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Select, Textarea, ErrorSummary, LoadingBlock, ErrorState, PageHeader, Empty, Pill, InvoiceStatus, MessageStatus, Banner, Dialog, Checkbox, Tabs, LinkButton, AskRigo, useToast, useConfirm } from '../components/ui';
import { InvoiceDocument } from '../components/invoice-doc';
import { formatMoney, parseMoney, minorToInput, fmtDate, fmtDateTime } from '../lib/format';
import { computeTotals, lineAmount, parseRate, rateToInput, resolveDiscounts } from '../../shared/billing';
import { PAYMENT_METHODS } from '../../shared/invoices';
import { localDate } from '../../shared/schedule';

const DELIVERY: Record<string, string> = { not_prepared: 'Not prepared', prepared: 'Email prepared', simulated: 'Simulated (demo)', queued: 'Queued', sent: 'Sent', delivered: 'Delivered', failed: 'Failed' };

/** The one payment status (R6-m1), as the server worked it out for this invoice. */
export function PaymentPill({ payment }: { payment?: { key: string; label: string; tone: any } | null }) {
  if (!payment || payment.key === 'not_issued' || payment.key === 'void') return <span className="small muted">{payment?.key === 'void' ? 'Void' : 'Not issued'}</span>;
  return <Pill tone={payment.tone}>{payment.label}</Pill>;
}

const GROUPS: { key: string; title: string; test: (i: any) => boolean }[] = [
  { key: 'held', title: 'On hold', test: (i) => i.status === 'held' },
  { key: 'approval', title: 'Draft or awaiting approval', test: (i) => i.status === 'draft' || i.status === 'pending_approval' },
  { key: 'ready', title: 'Approved, ready to issue', test: (i) => i.status === 'approved' },
  { key: 'overdue', title: 'Overdue', test: (i) => i.status === 'issued' && i.payment?.key === 'overdue' },
  { key: 'unpaid', title: 'Issued, awaiting payment', test: (i) => i.status === 'issued' && i.paymentStatus !== 'paid' && i.payment?.key !== 'overdue' },
  { key: 'paid', title: 'Paid', test: (i) => i.status === 'issued' && i.paymentStatus === 'paid' },
  { key: 'void', title: 'Void', test: (i) => i.status === 'void' },
];
const FILTERS = ['attention', 'held', 'issued', 'unpaid', 'overdue', 'all'];

/** What the invoice is for: the job, the rental period (R10-m1), or a hand-made invoice. */
function invoiceFor(i: any) {
  if (i.jobNumber) return <>Job <span className="num">#{i.jobNumber}</span></>;
  if (i.periodStart) return <>Rental {fmtDate(i.periodStart)} to {fmtDate(i.periodEnd)}</>;
  if (i.kind === 'manual') return 'Manual invoice';
  return i.recurringPlanId ? 'Rental billing' : '';
}

export function Invoices() {
  const c = useCompany();
  const [sp, setSp] = useSearchParams();
  const status = FILTERS.includes(sp.get('status') ?? '') ? (sp.get('status') as string) : 'attention';
  // The server filters by status, so older invoices are never missing from a filter.
  const q = useQuery({ queryKey: [c.cid, 'invoices', status], queryFn: () => get(`/c/${c.cid}/invoices?status=${status}`) });
  const fin = c.can('finance.view');
  const shown: any[] = q.data?.invoices ?? [];
  const tab = (k: string, label: string) => ({ key: k, label });
  const cols = fin ? 7 : 5;
  return (
    <div className="page">
      <PageHeader title="Invoices" sub="Draft, approval, issue, delivery and payment are tracked separately."
        actions={<>{fin && <LinkButton to={c.to('collections')} icon={<Wallet aria-hidden />}>Collections</LinkButton>}{c.can('invoices.edit') && fin && <LinkButton variant="primary" to={c.to('invoices/new')} icon={<Plus aria-hidden />}>New invoice</LinkButton>}</>} />
      <Tabs label="Filter invoices" value={status} onChange={(k) => setSp({ status: k })} tabs={[tab('attention', 'Needs work'), tab('held', 'On hold'), tab('issued', 'Issued'), tab('unpaid', 'Unpaid'), tab('overdue', 'Overdue'), tab('all', 'All')]} />
      {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : shown.length === 0 ? (
        <Card><Empty icon={<Receipt />} title={status === 'attention' ? 'Nothing needs work' : status === 'overdue' ? 'Nothing is overdue' : 'No invoices here'}>Invoices are prepared from completed jobs, by a person or by your workflows.</Empty></Card>
      ) : (
        <div className="card card-flush"><div className="table-wrap"><table className="table responsive">
          <thead><tr><th>Invoice</th><th>Customer</th><th>Status</th><th>Payment</th><th>Due</th>{fin && <th className="right">Total</th>}{fin && <th className="right">Balance</th>}</tr></thead>
          {GROUPS.map((g) => {
            const rows = shown.filter(g.test);
            if (!rows.length) return null;
            return (
              <tbody key={g.key}>
                <tr className="group-row"><th colSpan={cols} scope="colgroup">{g.title}<span className="num muted">{rows.length}</span></th></tr>
                {rows.map((i: any) => (
                  <tr key={i.id}>
                    <td data-primary><Link className="row-link" to={c.to(`invoices/${i.id}`)}>{i.number ? <span className="num">{i.number}</span> : 'Draft'}</Link><div className="xsmall muted">{invoiceFor(i)}{invoiceFor(i) ? ' · ' : ''}{fmtDate(i.createdAt, c.company.timezone)}</div></td>
                    <td data-label="Customer">{i.customerName ?? '—'}</td>
                    <td data-label="Status"><InvoiceStatus status={i.status} /></td>
                    <td data-label="Payment"><PaymentPill payment={i.payment} /></td>
                    <td data-label="Due" className="small">{i.dueDate ? fmtDate(i.dueDate) : <span className="muted">—</span>}</td>
                    {fin && <td data-label="Total" className="right money">{i.totalMinor === null ? <span className="muted" style={{ fontFamily: 'var(--font-sans)' }}>Incomplete</span> : formatMoney(i.totalMinor, i.currency)}</td>}
                    {fin && <td data-label="Balance" className="right money">{i.status === 'issued' ? formatMoney(i.balanceMinor, i.currency) : <span className="muted">—</span>}</td>}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table></div></div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- line editing (also used for new invoices)

type EditLine = { id?: string; description: string; quantity: string; unit: string; rate: string; percent: string; taxable: boolean; kind: 'charge' | 'discount'; discountType: 'fixed' | 'percent'; original?: any };

const toEdit = (l: any): EditLine => ({ id: l.id, description: l.description, quantity: l.quantity, unit: l.unit ?? '', rate: rateToInput(l.rateE4), percent: l.percentBp ? String(l.percentBp / 100) : '', taxable: l.taxable, kind: l.kind,
  discountType: l.kind === 'discount' && l.percentBp ? 'percent' : 'fixed', original: l });

/** Parse the editor's lines; returns an error message for the first line that isn't valid. */
function readLines(lines: EditLine[]) {
  let bad: string | null = null;
  const out = lines.map((l, n) => {
    const percentBp = l.kind === 'discount' && l.discountType === 'percent' ? Math.round(Number(l.percent.replace(',', '.')) * 100) : null;
    if (percentBp !== null && (!Number.isFinite(percentBp) || percentBp < 1 || percentBp > 10000)) bad ??= `Line ${n + 1}: enter a percentage between 0.01 and 100.`;
    const rateE4 = percentBp !== null ? null : l.rate.trim() === '' ? null : parseRate(l.rate);
    if (percentBp === null && l.rate.trim() !== '' && rateE4 === null) bad ??= `Line ${n + 1}: enter the rate like 12.50 or 3.8995.`;
    return { id: l.id, description: l.description, quantity: l.kind === 'discount' ? '1' : l.quantity.trim().replace(',', '.'), unit: l.kind === 'discount' ? '' : l.unit, rateE4, percentBp, taxable: l.kind === 'charge' && l.taxable, kind: l.kind };
  });
  return { lines: out, bad };
}

function LineRows({ lines, setLines, currency, fieldError, defaultTaxable }: { lines: EditLine[]; setLines: (l: EditLine[]) => void; currency: string; fieldError: (k: string) => string | undefined; defaultTaxable: boolean }) {
  const set = (i: number, p: Partial<EditLine>) => setLines(lines.map((l, x) => (x === i ? { ...l, ...p } : l)));
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} className="card" style={{ padding: 12 }}>
          <div className="grid-2">
            <Field label="Description" id={`f-lines-${i}-description`} error={fieldError(`lines.${i}.description`)}>{(p) => <Input {...p} maxLength={200} value={l.description} onChange={(e) => set(i, { description: e.target.value })} />}</Field>
            <Field label="Type" id={`f-lk-${i}`}>{(p) => <Select {...p} value={l.kind === 'charge' ? 'charge' : l.discountType === 'percent' ? 'discount_pct' : 'discount'} onChange={(e) => set(i, e.target.value === 'charge' ? { kind: 'charge' } : { kind: 'discount', discountType: e.target.value === 'discount_pct' ? 'percent' : 'fixed', taxable: false })}>
              <option value="charge">Charge</option><option value="discount">Discount (amount)</option><option value="discount_pct">Discount (percent of charges)</option></Select>}</Field>
            {l.kind === 'charge' && <Field label="Quantity" id={`f-lines-${i}-quantity`} error={fieldError(`lines.${i}.quantity`)}>{(p) => <Input {...p} className="input num-input" inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />}</Field>}
            {l.kind === 'discount' && l.discountType === 'percent'
              ? <Field label="Percent off" id={`f-lp-${i}`} hint="Of all charges on this invoice.">{(p) => <Input {...p} className="input num-input" inputMode="decimal" value={l.percent} onChange={(e) => set(i, { percent: e.target.value })} />}</Field>
              : <Field label={l.kind === 'discount' ? `Amount off (${currency})` : `Rate (${currency})${l.unit ? ` per ${l.unit}` : ''}`} id={`f-lr-${i}`} hint={l.kind === 'charge' ? 'Up to 4 decimals. Empty keeps the invoice on hold.' : undefined}>{(p) => <Input {...p} className="input num-input" inputMode="decimal" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} />}</Field>}
          </div>
          <div className="row-between" style={{ marginTop: 8 }}>
            {l.kind === 'charge' ? <Checkbox label="Taxable" checked={l.taxable} onChange={(e) => set(i, { taxable: e.target.checked })} /> : <span />}
            <Button size="sm" variant="danger" icon={<Trash2 aria-hidden />} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, x) => x !== i))}>Remove line</Button>
          </div>
        </div>
      ))}
      <div><Button size="sm" icon={<Plus aria-hidden />} onClick={() => setLines([...lines, { description: '', quantity: '1', unit: '', rate: '', percent: '', taxable: defaultTaxable, kind: 'charge', discountType: 'fixed' }])}>Add line</Button></div>
    </>
  );
}

/** Running totals while editing, worked out by the same shared code the server uses. */
function previewTotals(lines: EditLine[], taxRateBp: number | null, allowFree: boolean) {
  const parsed = readLines(lines).lines.map((l, n) => {
    const o = lines[n].original;
    // Untouched lines keep the amount pricing worked out (a minimum charge); edited ones are quantity × rate.
    const same = o && o.kind === 'charge' && l.kind === 'charge' && o.quantity === l.quantity && o.rateE4 === l.rateE4;
    const amountMinor = same ? o.amountMinor : l.kind === 'charge' && l.rateE4 !== null && /^\d+(\.\d+)?$/.test(l.quantity) ? lineAmount(l.quantity, l.rateE4) : null;
    return { ...l, amountMinor };
  });
  const r = resolveDiscounts(parsed, { allowFree });
  return { totals: computeTotals(r.lines, taxRateBp), excess: r.excessMinor };
}

function FreeConfirm({ error, onFree }: { error: ApiError | null; onFree: () => void }) {
  if (!error?.details?.freeConfirm) return null;
  return (
    <Banner tone="warning" title="The discounts are more than the charges" action={<Button onClick={onFree}>Make this invoice free</Button>}>
      {error.message} A free invoice shows the discount reduced to the charges, so the lines add up to $0.
    </Banner>
  );
}

function LinesEditor({ data, onDone, onCancel }: { data: any; onDone: () => void; onCancel: () => void }) {
  const c = useCompany();
  const [lines, setLines] = useState<EditLine[]>(() => data.lines.map(toEdit));
  const [notes, setNotes] = useState(data.invoice.notes ?? '');
  const [allowFree, setAllowFree] = useState(!!data.invoice.freeConfirmed);
  const preview = previewTotals(lines, data.taxRateBp ?? null, allowFree);
  const s = useSubmit(async (free?: boolean) => {
    const r = readLines(lines);
    if (r.bad) throw new Error(r.bad);
    const af = free ?? allowFree;
    await put(`/c/${c.cid}/invoices/${data.invoice.id}/lines`, { version: data.invoice.version, notes, lines: r.lines, allowFree: af });
    onDone();
  });
  return (
    <Card id="edit" title="Edit lines">
      <div className="stack">
        <Banner tone="info">Saving recalculates totals and cancels any approval given for the previous version.</Banner>
        <ErrorSummary error={s.error?.details?.freeConfirm ? null : s.error} />
        <FreeConfirm error={s.error} onFree={() => { setAllowFree(true); s.run(true); }} />
        <LineRows lines={lines} setLines={setLines} currency={data.invoice.currency} fieldError={s.fieldError} defaultTaxable={!!data.taxRateBp} />
        <Field label="Note on invoice" optionalText id="f-notes">{(p) => <Textarea {...p} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <p className="small muted num">Total: {preview.totals.totalMinor === null ? 'incomplete' : formatMoney(preview.totals.totalMinor, data.invoice.currency)}{preview.excess > 0 ? ` · discounts are ${formatMoney(preview.excess, data.invoice.currency)} more than the charges` : ''}</p>
        <div className="form-actions"><Button variant="primary" busy={s.busy} onClick={() => s.run()}>Save lines</Button><Button onClick={onCancel}>Cancel</Button></div>
      </div>
    </Card>
  );
}

/** A hand-made invoice (R8-M3): a customer, optionally one of their sites, and custom lines. */
export function NewInvoice() {
  const c = useCompany();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [customerId, setCustomerId] = useState(sp.get('customer') ?? '');
  const [locationId, setLocationId] = useState('');
  const [lines, setLines] = useState<EditLine[]>([{ description: '', quantity: '1', unit: '', rate: '', percent: '', taxable: false, kind: 'charge', discountType: 'fixed' }]);
  const [tax, setTax] = useState('');
  const [notes, setNotes] = useState('');
  const [key] = useState(() => newId('inv'));
  const [allowFree, setAllowFree] = useState(false);
  const cust = useQuery({ queryKey: [c.cid, 'customer', customerId], queryFn: () => get(`/c/${c.cid}/customers/${customerId}`), enabled: !!customerId });
  const taxBp = tax.trim() === '' ? null : Math.round(Number(tax.replace(',', '.')) * 100);
  const preview = previewTotals(lines, taxBp, allowFree);
  const s = useSubmit(async (free?: boolean) => {
    if (!customerId) throw Object.assign(new Error('Choose the customer.'), { fields: { customerId: 'Choose a customer' } });
    if (taxBp !== null && (!Number.isFinite(taxBp) || taxBp < 0 || taxBp > 5000)) throw new Error('Tax rate must be a percentage between 0 and 50.');
    const r = readLines(lines);
    if (r.bad) throw new Error(r.bad);
    const out = await post(`/c/${c.cid}/invoices`, { customerId, locationId: locationId || null, lines: r.lines, notes, taxRateBp: taxBp, allowFree: free ?? allowFree, clientRequestId: key });
    nav(c.to(`invoices/${out.id}`));
  });
  return (
    <div className="page page-narrow">
      <PageHeader back={{ to: c.to('invoices'), label: 'Invoices' }} title="New invoice" sub="For work without a job: a fee, an accepted quote, or a correction. It starts as a draft." />
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); s.run(); }}>
        <ErrorSummary error={s.error?.details?.freeConfirm ? null : s.error} />
        <FreeConfirm error={s.error} onFree={() => { setAllowFree(true); s.run(true); }} />
        <Card id="who" title="Customer">
          <div className="grid-2">
            <Field label="Customer" id="f-customerId" error={s.fieldError('customerId')}>{(p) => <CustomerPicker id={p.id} invalid={p['aria-invalid']} describedBy={p['aria-describedby']} value={customerId} onChange={(id) => { setCustomerId(id); setLocationId(''); }} />}</Field>
            <Field label="Site" optionalText id="f-locationId" error={s.fieldError('locationId')}>{(p) => <Select {...p} value={locationId} disabled={!customerId} onChange={(e) => setLocationId(e.target.value)}><option value="">No site</option>{(cust.data?.locations ?? []).map((l: any) => <option key={l.id} value={l.id}>{l.label ? `${l.label}: ` : ''}{l.address}</option>)}</Select>}</Field>
          </div>
          {cust.data?.customer?.taxExempt ? <p className="small muted" style={{ marginTop: 8 }}>This customer is tax exempt: no tax is charged.</p> : null}
        </Card>
        <Card id="lines" title="Lines">
          <div className="stack">
            <LineRows lines={lines} setLines={setLines} currency={c.company.currency} fieldError={s.fieldError} defaultTaxable={!!taxBp} />
            <div style={{ maxWidth: 220 }}><Field label="Tax rate (%)" optionalText id="f-tax" hint="Applied to taxable lines.">{(p) => <Input {...p} inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />}</Field></div>
            <Field label="Note on invoice" optionalText id="f-notes">{(p) => <Textarea {...p} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
            <p className="small muted num">Total: {preview.totals.totalMinor === null ? 'incomplete' : formatMoney(preview.totals.totalMinor, c.company.currency)}</p>
          </div>
        </Card>
        <div className="form-actions"><Button type="submit" variant="primary" size="lg" icon={<FilePlus2 aria-hidden />} busy={s.busy}>Create draft</Button></div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- invoice page

const PAY_METHOD_OPTIONS = (['check', 'cash', 'card', 'card_terminal', 'bank_transfer', 'other'] as const).map((k) => [k, PAYMENT_METHODS[k]] as const);

function MoneyDialog({ open, onClose, title, intro, submitLabel, currency, defaults, withMethod = true, noteLabel = 'Note', noteRequired = false, onSubmit, danger, tz }: {
  open: boolean; onClose: () => void; title: string; intro?: string; submitLabel: string; currency: string; defaults: { amount: string }; withMethod?: boolean; noteLabel?: string; noteRequired?: boolean; danger?: boolean; tz: string;
  onSubmit: (v: { amountMinor: number; method: string; paidOn: string; reference: string; note: string; idempotencyKey: string }) => Promise<void>;
}) {
  const today = localDate(new Date(), tz);
  const [v, setV] = useState({ amount: defaults.amount, method: 'check', paidOn: today, reference: '', note: '', key: newId('pay') });
  useEffect(() => { if (open) setV({ amount: defaults.amount, method: 'check', paidOn: localDate(new Date(), tz), reference: '', note: '', key: newId('pay') }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = useSubmit(async () => {
    const minor = parseMoney(v.amount);
    if (minor === null || minor <= 0) throw Object.assign(new Error('Enter an amount like 125.00.'), { fields: { amountMinor: 'Enter an amount' } });
    await onSubmit({ amountMinor: minor, method: v.method, paidOn: v.paidOn, reference: v.reference, note: v.note, idempotencyKey: v.key });
  });
  return (
    <Dialog open={open} onClose={onClose} title={title} footer={<><Button onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} busy={s.busy} onClick={() => s.run()}>{submitLabel}</Button></>}>
      <div className="stack">
        {intro ? <p className="muted" style={{ margin: 0 }}>{intro}</p> : null}
        <ErrorSummary error={s.error} />
        <div className="grid-2">
          <Field label={`Amount (${currency})`} id="f-amountMinor" error={s.fieldError('amountMinor')}>{(p) => <Input {...p} className="input num-input" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />}</Field>
          {withMethod && <Field label="Date" id="f-paidOn" error={s.fieldError('paidOn')}>{(p) => <Input {...p} type="date" max={today} value={v.paidOn} onChange={(e) => setV({ ...v, paidOn: e.target.value })} />}</Field>}
          {withMethod && <Field label="Method" id="f-method">{(p) => <Select {...p} value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>{PAY_METHOD_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>}
          {withMethod && <Field label={v.method === 'check' ? 'Check number' : 'Reference'} optionalText id="f-reference">{(p) => <Input {...p} maxLength={80} value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />}</Field>}
        </div>
        <Field label={noteLabel} optionalText={!noteRequired} id="f-note" error={s.fieldError('note')}>{(p) => <Input {...p} maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

export function InvoiceDetail() {
  const c = useCompany();
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { ask, node } = useConfirm();
  const q = useQuery({ queryKey: [c.cid, 'invoice', id], queryFn: () => get(`/c/${c.cid}/invoices/${id}`) });
  const [sp] = useSearchParams();
  // "Edit invoice" from an approval card opens the line editor directly; "View invoice" does not.
  const [editing, setEditing] = useState(sp.get('edit') === '1');
  const [dialog, setDialog] = useState<null | 'pay' | 'refund' | 'credit' | 'void' | 'reject'>(null);
  const [voidReason, setVoidReason] = useState('');
  const [reject, setReject] = useState<{ id: string; reason: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: [c.cid] });
  const tz = c.company.timezone;
  const issuesOnApprove = !!q.data?.approvals.some((a: any) => a.status === 'pending' && a.action_type === 'invoice.issue');
  const approve = useSubmit(async () => {
    const i = q.data.invoice;
    const total = i.totalMinor !== undefined && i.totalMinor !== null ? formatMoney(i.totalMinor, i.currency) : null;
    // Approving is a decision about money: confirm it, with the total (R6-m8).
    if (!(await ask({ title: `Approve ${total ? `this ${total} invoice` : 'this invoice'}?`, body: issuesOnApprove ? 'Approving also issues it: it receives the next invoice number and becomes the official record.' : 'It can then be issued. Editing it later cancels this approval.', confirm: issuesOnApprove ? 'Approve and issue' : 'Approve' }))) return;
    await post(`/c/${c.cid}/invoices/${id}/approve`, { version: i.version }); toast('Invoice approved'); refresh();
  });
  const submit = useSubmit(async () => { await post(`/c/${c.cid}/invoices/${id}/submit`, { version: q.data.invoice.version }); toast('Sent for approval. Approvers were notified.'); refresh(); });
  const issue = useSubmit(async () => {
    if (!(await ask({ title: 'Issue this invoice?', body: 'It receives the next invoice number, a due date from the customer\'s terms, and becomes the official record. Any customer credit is applied. Issued invoices can\'t be edited; they can be voided while nothing is paid.', confirm: 'Issue invoice' }))) return;
    const r = await post(`/c/${c.cid}/invoices/${id}/issue`, { version: q.data.invoice.version }); toast(`Issued as ${r.number}`); refresh();
  });
  const email = useSubmit(async () => { await post(`/c/${c.cid}/invoices/${id}/email`); toast('Email prepared with a view link. Review it in Messages.'); refresh(); });
  const applyCredit = useSubmit(async () => { const r = await post(`/c/${c.cid}/invoices/${id}/apply-credit`); toast(`${formatMoney(r.appliedMinor, q.data.invoice.currency)} of credit applied`); refresh(); });
  const replacement = useSubmit(async () => { const r = await post(`/c/${c.cid}/invoices/${id}/replacement`); toast('Replacement invoice prepared'); refresh(); nav(c.to(`invoices/${r.invoiceId}`)); });
  const confirmPay = useSubmit(async (pid: string) => { const r = await post(`/c/${c.cid}/payments/${pid}/confirm`); toast(r.toCredit ? 'Confirmed. It went to the customer\'s credit and paid their open invoices.' : r.waitingForInvoice ? 'Confirmed. It pays the invoice when it is issued.' : 'Payment confirmed'); refresh(); });
  const rejectPay = useSubmit(async () => { await post(`/c/${c.cid}/payments/${reject!.id}/reject`, { reason: reject!.reason }); setReject(null); setDialog(null); toast('Payment rejected. It no longer counts.'); refresh(); });
  const voidIt = useSubmit(async () => { await post(`/c/${c.cid}/invoices/${id}/void`, { reason: voidReason }); setDialog(null); toast('Invoice voided. The job can be billed again.'); refresh(); });
  if (q.isLoading) return <div className="page"><LoadingBlock /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} /></div>;
  const d = q.data;
  const i = d.invoice;
  const fin = c.can('finance.view');
  const err = approve.error ?? issue.error ?? email.error ?? submit.error ?? applyCredit.error ?? replacement.error ?? confirmPay.error;
  const amount = i.totalMinor !== undefined && i.totalMinor !== null ? ` · ${formatMoney(i.totalMinor, i.currency)}` : '';
  const approveText = `${issuesOnApprove ? 'Approve and issue' : 'Approve'}${amount}`;
  const money = (n: number) => formatMoney(n, i.currency);
  return (
    <div className="page">
      <div className="no-print record-head">
        <Link className="back-link" to={c.to('invoices')}><ChevronLeft aria-hidden />Invoices</Link>
        <div className="page-header">
          <div className="stack-sm" style={{ minWidth: 0 }}>
            <div className="ident"><h1 className={i.number ? 'num' : undefined} style={{ letterSpacing: '-0.03em' }}>{i.number ?? 'Draft invoice'}</h1><InvoiceStatus status={i.status} /></div>
            <div className="record-meta"><span>{i.customerId ? <Link to={c.to(`customers/${i.customerId}`)}>{i.customerName}</Link> : 'No customer'}</span>{i.jobId ? <span><ClipboardList aria-hidden /><Link to={c.to(`jobs/${i.jobId}`)}>Job <span className="num">#{i.jobNumber}</span></Link></span> : i.periodStart ? <span>Rental {fmtDate(i.periodStart)} to {fmtDate(i.periodEnd)}</span> : i.kind === 'manual' ? <span>Manual invoice</span> : null}<span>Prepared {fmtDate(i.createdAt, tz)}</span></div>
          </div>
          <div className="row">
            <Button icon={<Printer aria-hidden />} onClick={() => window.print()}>Print / save PDF</Button>
            {d.can.edit && !editing && <Button icon={<Pencil aria-hidden />} onClick={() => setEditing(true)}>Edit lines</Button>}
            {d.can.message && <Button icon={<Mail aria-hidden />} busy={email.busy} onClick={() => email.run()}>Prepare email</Button>}
            {d.can.submit && <Button variant={d.can.approve ? 'default' : 'primary'} icon={<Send aria-hidden />} busy={submit.busy} onClick={() => submit.run()}>Send for approval</Button>}
            {d.can.approve && i.status !== 'held' && <Button variant="primary" icon={<CheckCircle2 aria-hidden />} busy={approve.busy} onClick={() => approve.run()}>{approveText}</Button>}
            {d.can.issue && (i.status === 'approved' || !d.approvalRequired) && <Button variant="primary" icon={<Send aria-hidden />} busy={issue.busy} onClick={() => issue.run()}>Issue</Button>}
            {d.can.pay && <Button variant="primary" icon={<CircleDollarSign aria-hidden />} onClick={() => setDialog('pay')}>Record payment</Button>}
            {d.can.prepareReplacement && <Button variant="primary" icon={<RotateCcw aria-hidden />} busy={replacement.busy} onClick={() => replacement.run()}>Prepare new invoice</Button>}
          </div>
        </div>
      </div>
      <div className="state-track no-print" aria-label="Invoice states">
        <div><span className="k">Invoice</span><InvoiceStatus status={i.status} /></div>
        <div><span className="k">Approval</span><span className="small">{i.status === 'held' ? 'Blocked until the hold is fixed' : i.status === 'approved' || i.status === 'issued' ? 'Approved' : i.status === 'pending_approval' ? 'Waiting for an approver' : d.approvalRequired ? 'Required' : 'Not required'}</span></div>
        <div><span className="k">Delivery</span><span className="small">{DELIVERY[i.deliveryStatus]}</span></div>
        <div><span className="k">Payment</span><PaymentPill payment={i.payment} /></div>
        {i.dueDate && <div><span className="k">Due</span><span className="small">{fmtDate(i.dueDate)}{i.termsLabel ? ` · ${i.termsLabel}` : ''}</span></div>}
        {fin && <div><span className="k">{i.status === 'issued' ? 'Balance due' : 'Total'}</span><span className="money-big" style={{ fontSize: 'var(--fs-22)' }}>{i.totalMinor === null ? <span className="small muted" style={{ fontFamily: 'var(--font-sans)' }}>Incomplete</span> : money(i.status === 'issued' ? i.balanceMinor : i.totalMinor)}</span></div>}
      </div>
      <div className="no-print stack">
        <ErrorSummary error={err} />
        {d.replaces && <Banner tone="info">Replaces <Link to={c.to(`invoices/${d.replaces.id}`)}>{d.replaces.number ?? 'a voided invoice'}</Link>, which was voided.</Banner>}
        {i.status === 'void' && <Banner tone="warning" title="This invoice was voided">{i.voidReason ? `Reason: ${i.voidReason}. ` : ''}{d.replacedBy ? <>It was replaced by <Link to={c.to(`invoices/${d.replacedBy.id}`)}>{d.replacedBy.number ?? 'a new draft'}</Link>.</> : i.jobId ? 'The job can be billed again: prepare a new invoice.' : null}</Banner>}
        {i.status === 'held' && <Banner tone="warning" title="On hold: this invoice cannot be approved or issued yet">{<ul style={{ margin: 0 }}>{i.holdReasons.map((r: string) => <li key={r}>{r}</li>)}</ul>}{c.can('services.manage') ? <p style={{ margin: '8px 0 0' }}>Set missing rates in <Link to={c.to('services')}>Services &amp; pricing</Link> or edit the lines here.</p> : null}{c.can('assistant.use') ? <div style={{ marginTop: 8 }}><AskRigo to={c.to('assistant')} prompt={`Why is invoice ${i.number ?? `for job #${i.jobNumber ?? ''}`} on hold?`} /></div> : null}</Banner>}
        {i.status === 'draft' && d.approvalRequired && <Banner tone="info">This draft needs approval before it can be issued.{d.can.submit ? ' Send it for approval to ask everyone who can approve invoices.' : ''}</Banner>}
        {i.status === 'pending_approval' && <Banner tone="info">Waiting for approval. Editing the lines cancels the request; send it again after.</Banner>}
        {!fin && <Banner tone="info">Amounts are hidden for your role.</Banner>}
        {editing && <LinesEditor data={d} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); toast('Lines saved'); refresh(); }} />}
      </div>
      <div className="detail-grid">
        <InvoiceDocument company={d.company} invoice={i} lines={d.lines} serviceRecord={d.serviceRecord} logoUrl={d.company.logo ? `/api/c/${c.cid}/branding/logo` : null} accent={c.company.accent.light} showAmounts={fin} tz={tz} internal />
        <div className="stack no-print" style={{ minWidth: 0 }}>
          {fin && i.status === 'issued' && (
            <Card id="money" title="Payments and credit">
              <dl className="kv">
                <dt>Total</dt><dd className="num">{money(i.totalMinor)}</dd>
                <dt>Paid</dt><dd className="num">{money(i.paidMinor)}</dd>
                {i.creditedMinor ? <><dt>Credited</dt><dd className="num">{money(i.creditedMinor)}</dd></> : null}
                <dt>Balance due</dt><dd className="num"><strong>{money(i.balanceMinor)}</strong></dd>
                {d.customerCreditMinor ? <><dt>Customer credit</dt><dd className="num">{money(d.customerCreditMinor)}</dd></> : null}
              </dl>
              <div className="row" style={{ marginTop: 12 }}>
                {d.can.applyCredit && <Button size="sm" icon={<Wallet aria-hidden />} busy={applyCredit.busy} onClick={() => applyCredit.run()}>Apply {money(Math.min(d.customerCreditMinor, i.balanceMinor))} credit</Button>}
                {d.can.creditNote && <Button size="sm" icon={<FileMinus aria-hidden />} onClick={() => setDialog('credit')}>Credit note</Button>}
                {d.can.refund && <Button size="sm" icon={<Undo2 aria-hidden />} onClick={() => setDialog('refund')}>Refund</Button>}
                {d.can.void && <Button size="sm" variant="danger" icon={<Ban aria-hidden />} onClick={() => setDialog('void')}>Void invoice</Button>}
              </div>
              {d.can.voidBlocked && <p className="small muted" style={{ margin: '8px 0 0' }}>Void isn't available: {d.can.voidBlocked}</p>}
            </Card>
          )}
          {fin && (d.payments.length > 0 || d.credits.length > 0) && (
            <Card id="pays" title="Payment history">
              <ul className="list">
                {d.payments.map((p: any) => (
                  <li key={p.id} style={{ padding: '10px 0' }}>
                    <div className="row-between" style={{ alignItems: 'flex-start' }}>
                      <span>
                        {p.kind === 'refund' ? 'Refund' : p.collectedAtStop ? 'Collected at the stop' : 'Payment'} · {p.methodLabel}{p.reference ? ` #${p.reference}` : ''}
                        <div className="small muted">{p.paidOn ? `${fmtDate(p.paidOn)} · ` : ''}recorded {fmtDateTime(p.recordedAt, tz)}{p.recordedByName ? ` by ${p.recordedByName}` : ''}</div>
                        {p.note ? <div className="small muted">{p.note}</div> : null}
                        {p.appliedMinor !== null && p.kind === 'payment' && p.state === 'confirmed' && p.appliedMinor < p.amountMinor && i.status === 'issued' ? <div className="small muted">{money(p.amountMinor - p.appliedMinor)} became customer credit</div> : null}
                        {p.state === 'rejected' ? <div className="small">Rejected by {p.rejectedByName}: {p.rejectedReason}</div> : null}
                      </span>
                      <span className="stack-sm" style={{ alignItems: 'flex-end' }}>
                        <span className={`num${p.state === 'rejected' ? ' struck' : ''}`}>{p.kind === 'refund' ? '−' : ''}{money(p.amountMinor)}</span>
                        {p.state === 'unconfirmed' ? <Pill tone="warning">Not confirmed</Pill> : p.state === 'rejected' ? <Pill tone="danger">Rejected</Pill> : null}
                      </span>
                    </div>
                    {(p.state === 'unconfirmed' && d.can.confirmPayments) || (p.state !== 'rejected' && d.can.rejectPayments && p.kind === 'payment') ? (
                      <div className="row" style={{ marginTop: 8 }}>
                        {p.state === 'unconfirmed' && d.can.confirmPayments && <Button size="sm" icon={<CheckCircle2 aria-hidden />} busy={confirmPay.busy} onClick={() => confirmPay.run(p.id)}>Confirm {money(p.amountMinor)}</Button>}
                        {d.can.rejectPayments && p.kind === 'payment' && p.state !== 'rejected' && <Button size="sm" variant="danger" icon={<XCircle aria-hidden />} onClick={() => { setReject({ id: p.id, reason: '' }); setDialog('reject'); }}>Reject</Button>}
                      </div>
                    ) : null}
                  </li>
                ))}
                {d.credits.map((cr: any) => (
                  <li key={cr.id} style={{ padding: '10px 0' }} className="row-between">
                    <span>{cr.source === 'credit_note' ? 'Credit note' : 'Customer credit applied'}<div className="small muted">{fmtDateTime(cr.createdAt, tz)}{cr.createdByName ? ` by ${cr.createdByName}` : ''}{cr.note ? ` · ${cr.note}` : ''}</div></span>
                    <span className="num">−{money(cr.amountMinor)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card id="appr" title="Approvals">{d.approvals.length === 0 ? <p className="muted">No approval requests yet.</p> : <ul className="list">{d.approvals.map((a: any) => <li key={a.id} style={{ padding: '8px 0' }} className="row-between"><span><span className="small">{fmtDateTime(a.created_at, tz)}</span>{a.decided_by_name ? <div className="small muted">{a.status} by {a.decided_by_name}{a.decision_note ? `: ${a.decision_note}` : ''}</div> : a.decision_note ? <div className="small muted">{a.decision_note}</div> : null}</span><Pill tone={a.status === 'approved' ? 'success' : a.status === 'pending' ? 'warning' : a.status === 'rejected' ? 'danger' : 'neutral'}>{a.status}</Pill></li>)}</ul>}</Card>
          <Card id="msg" title="Messages">
            {d.messages.length === 0 ? <p className="muted">No messages yet.</p> : (
              <ul className="list">{d.messages.map((m: any) => <li key={m.id} style={{ padding: '8px 0' }} className="row-between"><span>{m.subject}<div className="small muted">{m.recipient || 'No recipient'}{m.status_detail ? ` · ${m.status_detail}` : ''}</div></span><MessageStatus status={m.status} /></li>)}</ul>
            )}
            {d.messages.length > 0 && <LinkButton size="sm" to={c.to('messages')}>Open messages</LinkButton>}
          </Card>
        </div>
      </div>
      <MoneyDialog open={dialog === 'pay'} onClose={() => setDialog(null)} title="Record a payment received" tz={tz} currency={i.currency}
        intro="Records money you already received. Rigo does not charge cards or move money. Anything over the balance becomes credit for this customer."
        submitLabel="Record payment" defaults={{ amount: i.balanceMinor ? minorToInput(i.balanceMinor) : '' }}
        onSubmit={async (v) => { const r = await post(`/c/${c.cid}/invoices/${id}/payments`, v); setDialog(null); toast(r.duplicate ? 'That payment was already recorded.' : r.creditMinor > 0 ? `Payment recorded. ${money(r.creditMinor)} became customer credit.` : 'Payment recorded'); refresh(); }} />
      <MoneyDialog open={dialog === 'refund'} onClose={() => setDialog(null)} title="Record a refund" tz={tz} currency={i.currency} danger noteLabel="Reason" noteRequired
        intro="Records money you gave back. It reopens the balance by the same amount." submitLabel="Record refund" defaults={{ amount: '' }}
        onSubmit={async (v) => { await post(`/c/${c.cid}/invoices/${id}/refunds`, v); setDialog(null); toast('Refund recorded'); refresh(); }} />
      <MoneyDialog open={dialog === 'credit'} onClose={() => setDialog(null)} title="Issue a credit note" tz={tz} currency={i.currency} withMethod={false} noteLabel="Reason" noteRequired
        intro="Takes an amount off what the customer owes on this invoice, with the reason on record." submitLabel="Issue credit note" defaults={{ amount: '' }}
        onSubmit={async (v) => { await post(`/c/${c.cid}/invoices/${id}/credit-notes`, { amountMinor: v.amountMinor, note: v.note }); setDialog(null); toast('Credit note issued'); refresh(); }} />
      <Dialog open={dialog === 'void'} onClose={() => setDialog(null)} title="Void this invoice?" footer={<><Button onClick={() => setDialog(null)}>Keep it</Button><Button variant="danger" icon={<Ban aria-hidden />} busy={voidIt.busy} onClick={() => voidIt.run()}>Void invoice</Button></>}>
        <div className="stack"><p style={{ margin: 0 }}>The invoice keeps its number but no longer counts as owed, and its view link stops working. {i.jobId ? 'The job can then be billed again with a new invoice that says it replaces this one.' : ''}</p><ErrorSummary error={voidIt.error} />
          <Field label="Reason" id="f-reason" error={voidIt.fieldError('reason')}>{(p) => <Input {...p} maxLength={500} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />}</Field></div>
      </Dialog>
      <Dialog open={dialog === 'reject' && !!reject} onClose={() => { setDialog(null); setReject(null); }} title="Reject this payment?" footer={<><Button onClick={() => { setDialog(null); setReject(null); }}>Keep it</Button><Button variant="danger" icon={<XCircle aria-hidden />} busy={rejectPay.busy} onClick={() => rejectPay.run()}>Reject payment</Button></>}>
        <div className="stack"><p style={{ margin: 0 }}>It stops counting toward the invoice, and any credit it created is taken back. It stays in the history with your reason.</p><ErrorSummary error={rejectPay.error} />
          <Field label="Reason" id="f-reject" error={rejectPay.fieldError('reason')}>{(p) => <Input {...p} maxLength={500} placeholder="For example: the check bounced" value={reject?.reason ?? ''} onChange={(e) => setReject(reject && { ...reject, reason: e.target.value })} />}</Field></div>
      </Dialog>
      {node}
    </div>
  );
}
