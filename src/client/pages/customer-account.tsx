import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, FileText, PiggyBank, Undo2 } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, newId } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Dialog, Field, Input, Select, ErrorSummary, LoadingBlock, MessageStatus, useToast } from '../components/ui';
import { formatMoney, parseMoney, fmtDate, fmtDateTime } from '../lib/format';
import { PAYMENT_METHODS } from '../../shared/invoices';
import { localDate } from '../../shared/schedule';

const KIND: Record<string, string> = { overpayment: 'Overpayment', deposit: 'Deposit', applied: 'Used on an invoice', refund: 'Refunded', reversal: 'Reversed' };

/** A customer's account (finance only): balance, overdue, credit and its history, deposits and statements. */
export function CustomerAccount({ customerId }: { customerId: string }) {
  const c = useCompany();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const q = useQuery({ queryKey: [c.cid, 'customer', customerId, 'account'], queryFn: () => get(`/c/${c.cid}/customers/${customerId}/account`) });
  const [dialog, setDialog] = useState<null | 'deposit' | 'refund'>(null);
  const today = localDate(new Date(), c.company.timezone);
  const [v, setV] = useState({ amount: '', method: 'check', paidOn: today, reference: '', note: '', key: newId('dep') });
  const open = (k: 'deposit' | 'refund') => { setV({ amount: '', method: k === 'deposit' ? 'check' : 'check', paidOn: today, reference: '', note: '', key: newId(k) }); setDialog(k); };
  const money = (n: number) => formatMoney(n, c.company.currency);
  const save = useSubmit(async () => {
    const minor = parseMoney(v.amount);
    if (minor === null || minor <= 0) throw Object.assign(new Error('Enter an amount like 250.00.'), { fields: { amountMinor: 'Enter an amount' } });
    const body = { amountMinor: minor, method: v.method, paidOn: v.paidOn, reference: v.reference, note: v.note, idempotencyKey: v.key };
    await post(`/c/${c.cid}/customers/${customerId}/${dialog === 'deposit' ? 'deposits' : 'credit-refunds'}`, body);
    setDialog(null); toast(dialog === 'deposit' ? 'Deposit recorded as customer credit' : 'Refund recorded'); qc.invalidateQueries({ queryKey: [c.cid] });
  });
  const statement = useSubmit(async () => { const r = await post(`/c/${c.cid}/customers/${customerId}/statements`); qc.invalidateQueries({ queryKey: [c.cid] }); nav(c.to(`statements/${r.statementId}`)); });
  if (q.isLoading) return <Card id="account" title="Account"><LoadingBlock rows={2} /></Card>;
  if (q.error) return null;
  const a = q.data;
  return (
    <Card id="account" title={<h2 className="row"><Wallet aria-hidden />Account</h2>}>
      <ErrorSummary error={statement.error} />
      <dl className="kv">
        <dt>Owed</dt><dd className="num"><strong>{money(a.balanceMinor)}</strong>{a.openInvoices ? <span className="small muted"> on {a.openInvoices} invoice{a.openInvoices === 1 ? '' : 's'}</span> : null}</dd>
        {a.overdueMinor > 0 && <><dt>Overdue</dt><dd className="num">{money(a.overdueMinor)}</dd></>}
        <dt>Credit</dt><dd className="num">{money(a.creditMinor)}{a.creditMinor > 0 ? <span className="small muted"> · used automatically on the next invoice</span> : null}</dd>
        {a.unconfirmedMinor > 0 && <><dt>Collected, to confirm</dt><dd className="num">{money(a.unconfirmedMinor)} <Link className="small" to={c.to('collections')}>Review</Link></dd></>}
      </dl>
      <div className="row" style={{ marginTop: 12 }}>
        {a.can.deposit && <Button size="sm" icon={<PiggyBank aria-hidden />} onClick={() => open('deposit')}>Record deposit</Button>}
        {a.can.refundCredit && <Button size="sm" icon={<Undo2 aria-hidden />} onClick={() => open('refund')}>Refund credit</Button>}
        {a.can.statement && <Button size="sm" icon={<FileText aria-hidden />} busy={statement.busy} onClick={() => statement.run()}>Prepare statement</Button>}
      </div>
      {a.statements.length > 0 && <>
        <h3 className="small muted" style={{ margin: '16px 0 4px' }}>Statements</h3>
        <ul className="list">{a.statements.map((s: any) => <li key={s.id} className="row-between" style={{ padding: '6px 0' }}><Link to={c.to(`statements/${s.id}`)}>{fmtDate(s.date)}</Link><span className="row"><span className="num small">{money(s.balanceMinor)}</span>{s.messageStatus ? <MessageStatus status={s.messageStatus} /> : null}</span></li>)}</ul>
      </>}
      {a.history.length > 0 && <details className="advanced" style={{ marginTop: 12 }}><summary className="small">Credit history</summary>
        <ul className="list">{a.history.map((e: any) => <li key={e.id} className="row-between" style={{ padding: '6px 0' }}><span className="small">{KIND[e.kind] ?? e.kind}{e.invoiceNumber ? ` · ${e.invoiceNumber}` : ''}{e.note ? ` · ${e.note}` : ''}<div className="xsmall muted">{fmtDateTime(e.createdAt, c.company.timezone)}{e.createdByName ? ` by ${e.createdByName}` : ''}</div></span><span className="num small">{e.amountMinor > 0 ? '+' : '−'}{money(Math.abs(e.amountMinor))}</span></li>)}</ul>
      </details>}
      <Dialog open={!!dialog} onClose={() => setDialog(null)} title={dialog === 'deposit' ? 'Record a deposit or prepayment' : 'Refund customer credit'}
        footer={<><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant={dialog === 'refund' ? 'danger' : 'primary'} busy={save.busy} onClick={() => save.run()}>{dialog === 'deposit' ? 'Record deposit' : 'Record refund'}</Button></>}>
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>{dialog === 'deposit' ? 'Money received before the work. It becomes credit and pays this customer\'s next invoices when they are issued.' : `Money given back from their credit (${money(a.creditMinor)} available).`}</p>
          <ErrorSummary error={save.error} />
          <div className="grid-2">
            <Field label={`Amount (${c.company.currency})`} id="f-amountMinor" error={save.fieldError('amountMinor')}>{(p) => <Input {...p} className="input num-input" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />}</Field>
            <Field label="Date" id="f-paidOn">{(p) => <Input {...p} type="date" max={today} value={v.paidOn} onChange={(e) => setV({ ...v, paidOn: e.target.value })} />}</Field>
            <Field label="Method" id="f-method">{(p) => <Select {...p} value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>{Object.entries(PAYMENT_METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
            <Field label={v.method === 'check' ? 'Check number' : 'Reference'} optionalText id="f-reference">{(p) => <Input {...p} maxLength={80} value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />}</Field>
          </div>
          <Field label={dialog === 'refund' ? 'Reason' : 'Note'} optionalText={dialog !== 'refund'} id="f-note" error={save.fieldError('note')}>{(p) => <Input {...p} maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />}</Field>
        </div>
      </Dialog>
    </Card>
  );
}
