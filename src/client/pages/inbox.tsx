import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, Pencil, Hand, AlertTriangle, Info, Inbox as InboxIcon, Check, Eye } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Tabs, LoadingBlock, ErrorState, Empty, Pill, PriorityPill, GuideTarget, Dialog, Field, Textarea, ErrorSummary, useToast, useConfirm } from '../components/ui';
import { relTime, fmtDateTime, formatMoney } from '../lib/format';
import { formatRate } from '../../shared/billing';
import { useDocumentTitle } from '../lib/title';

/** What an approval would act on: the invoice lines and total, or a job's or message's key facts. */
export function ApprovalSummary({ s, compact }: { s: any; compact?: boolean }) {
  const c = useCompany();
  if (!s) return null;
  if (s.kind === 'invoice') {
    const fin = s.totalMinor !== undefined;
    return (
      <div className="approval-summary">
        <div className="as-head">
          <span><strong>{s.customerName ?? 'No customer'}</strong>{s.jobNumber ? <> · Job <span className="num">#{s.jobNumber}</span></> : null}{s.serviceName ? ` · ${s.serviceName}` : ''}</span>
          {fin ? <span className="as-total"><span className="sr-only">Total </span>{formatMoney(s.totalMinor, s.currency)}</span> : null}
        </div>
        {s.quantityNote ? <p className="as-note"><Info aria-hidden />{s.quantityNote}</p> : null}
        {!compact && s.lines.length > 0 && (
          // Scrolls sideways on its own when large text makes the lines wider than a phone.
          <div className="as-lines-wrap" tabIndex={0} role="region" aria-label={`Invoice lines${s.jobNumber ? ` for job #${s.jobNumber}` : ''}`}>
          <table className="as-lines">
            <caption className="sr-only">Invoice lines</caption>
            <thead><tr><th scope="col">Item</th><th scope="col" className="r">Quantity</th>{fin ? <><th scope="col" className="r">Rate</th><th scope="col" className="r">Amount</th></> : null}</tr></thead>
            <tbody>
              {s.lines.map((l: any, i: number) => (
                <tr key={i}><td>{l.description}{l.note ? <div className="as-line-note">{l.note}</div> : null}</td><td className="r num">{l.quantity}{l.unit ? ` ${l.unit}` : ''}</td>{fin ? <><td className="r num">{l.rateE4 === null ? 'Not set' : formatRate(l.rateE4, s.currency)}</td><td className="r num">{l.amountMinor === null ? '—' : formatMoney(l.amountMinor, s.currency)}</td></> : null}</tr>
              ))}
            </tbody>
            {fin ? (
              <tfoot>
                {s.moreLines ? <tr><td colSpan={4} className="muted small">and {s.moreLines} more line{s.moreLines === 1 ? '' : 's'} on the invoice</td></tr> : null}
                {s.discountMinor ? <tr><th scope="row" colSpan={3} className="r">Discount</th><td className="r num">-{formatMoney(s.discountMinor, s.currency)}</td></tr> : null}
                <tr><th scope="row" colSpan={3} className="r">Tax</th><td className="r num">{s.taxMinor === null ? '—' : formatMoney(s.taxMinor, s.currency)}</td></tr>
                <tr className="as-total-row"><th scope="row" colSpan={3} className="r">Total</th><td className="r num">{s.totalMinor === null ? 'Incomplete' : formatMoney(s.totalMinor, s.currency)}</td></tr>
              </tfoot>
            ) : null}
          </table>
          </div>
        )}
        {s.holdReasons?.length ? <div className="banner banner-warning"><AlertTriangle aria-hidden /><div><strong>On hold</strong><ul style={{ margin: 0, paddingLeft: 18 }}>{s.holdReasons.map((r: string) => <li key={r}>{r}</li>)}</ul></div></div> : null}
        {!fin ? <p className="small muted" style={{ margin: 0 }}>Amounts are hidden for your role.</p> : null}
      </div>
    );
  }
  if (s.kind === 'job') {
    return (
      <dl className="kv approval-summary">
        <dt>Job</dt><dd><span className="num">#{s.jobNumber}</span> {s.serviceName ?? ''}</dd>
        <dt>Customer</dt><dd>{s.customerName ?? '—'}</dd>
        <dt>When</dt><dd className="num">{s.scheduledStart ? fmtDateTime(s.scheduledStart, c.company.timezone) : 'Not scheduled'}</dd>
        <dt>Driver</dt><dd>{s.assigneeName ?? 'Unassigned'}</dd>
        {s.priority && s.priority !== 'normal' ? <><dt>Priority</dt><dd><PriorityPill priority={s.priority} /></dd></> : null}
      </dl>
    );
  }
  if (s.kind === 'message') {
    return (
      <dl className="kv approval-summary">
        <dt>Message</dt><dd>{s.subject}</dd>
        <dt>To</dt><dd>{s.customerName ?? '—'}{s.recipient ? ` (${s.recipient})` : ''}</dd>
        <dt>By</dt><dd>{s.channel === 'sms' ? 'Text message' : 'Email'}</dd>
      </dl>
    );
  }
  return null;
}

/** The approve button says exactly what happens, with the amount: "Approve and issue · $773.99". */
export function approveLabel(a: { actionType?: string; summary?: any }) {
  const amount = a.summary?.kind === 'invoice' && a.summary.totalMinor !== undefined && a.summary.totalMinor !== null ? ` · ${formatMoney(a.summary.totalMinor, a.summary.currency)}` : '';
  switch (a.actionType) {
    case 'invoice.issue': return `Approve and issue${amount}`;
    case 'message.send': return 'Approve and send';
    case 'job.create_followup': return 'Approve and create the job';
    default: return `Approve${amount}`;
  }
}

function ApprovalCard({ a, onDone }: { a: any; onDone: () => void }) {
  const c = useCompany();
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const { ask, node } = useConfirm();
  const decide = useSubmit(async (decision: 'approve' | 'reject') => {
    // Approving commits money or a message: confirm it, with the total for invoices (R2-M3, R6-m8).
    if (decision === 'approve') {
      const total = a.summary?.totalMinor !== undefined && a.summary?.totalMinor !== null ? formatMoney(a.summary.totalMinor, a.summary.currency) : null;
      const what = a.actionType === 'invoice.issue' ? `It is issued${total ? ` for ${total}` : ''} and gets the next invoice number.` : a.actionType === 'message.send' ? 'The message is sent through the connected service.' : 'The step runs right away.';
      if (!(await ask({ title: total ? `Approve ${total}?` : 'Approve this?', body: `${a.title}. ${what}`, confirm: approveLabel(a) }))) return;
    }
    const r = await post(`/c/${c.cid}/approvals/${a.id}/decide`, { decision, note });
    if (r.status === 'stale') toast(`Not approved: ${r.reason} A fresh approval request was created if the step still applies.`, 'info');
    else toast(decision === 'approve' ? 'Approved. Rigo will continue the workflow.' : 'Rejected. The step will not run.');
    setRejecting(false);
    onDone();
  });
  const isInvoice = a.subject_type === 'invoice';
  const viewLink = isInvoice ? c.to(`invoices/${a.subject_id}`) : a.subject_type === 'job' ? c.to(`jobs/${a.subject_id}`) : a.subject_type === 'message' ? c.to('messages') : null;
  const editLink = isInvoice ? c.to(`invoices/${a.subject_id}?edit=1`) : a.subject_type === 'job' ? c.to(`jobs/${a.subject_id}/edit`) : null;
  const held = isInvoice && a.summary?.holdReasons?.length > 0;
  return (
    <article className="card stack-sm" id={`ap-${a.id}`} aria-labelledby={`ap-${a.id}-t`}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}><h3 id={`ap-${a.id}-t`}>{a.title}</h3><span className="row" style={{ gap: 6 }}>{a.escalated_at ? <Pill tone="danger" icon={<AlertTriangle aria-hidden />}>Escalated</Pill> : null}<Pill tone="warning">Waiting for approval</Pill></span></div>
      <p className="xsmall muted" style={{ margin: 0 }}>
        {a.workflow_name ? <>From workflow “{a.workflow_name}” · </> : null}Requested {relTime(a.created_at)}
        {a.escalated_at ? <> · it passed its waiting time and is still pending. It is never approved automatically.</> : null}
      </p>
      <ApprovalSummary s={a.summary} />
      <dl className="consequences">
        <div><dt><CheckCircle2 aria-hidden />If approved</dt><dd>{a.consequence}</dd></div>
        <div><dt><XCircle aria-hidden />If rejected</dt><dd>The step does not run and the workflow stops. Nothing already done is undone.</dd></div>
        <div><dt><Pencil aria-hidden />If edited</dt><dd>Editing changes the record, so this request goes out of date and Rigo asks again. Viewing it changes nothing.</dd></div>
      </dl>
      <ErrorSummary error={decide.error} />
      {a.canDecide ? (
        <div className="form-actions">
          <GuideTarget id={a.summary?.jobNumber ? `approve-job-${a.summary.jobNumber}` : `approve-${a.id}`}>
            <Button variant="primary" className="btn-wrap" icon={<CheckCircle2 aria-hidden />} busy={decide.busy} disabled={held} onClick={() => decide.run('approve')}>{approveLabel(a)}</Button>
          </GuideTarget>
          {viewLink && <Link className="btn" to={viewLink}><Eye aria-hidden />{isInvoice ? 'View invoice' : a.subject_type === 'job' ? 'View job' : 'View message'}</Link>}
          {editLink && <Link className="btn" to={editLink}><Pencil aria-hidden />{isInvoice ? 'Edit invoice' : 'Edit job'}</Link>}
          <Button variant="danger" icon={<XCircle aria-hidden />} onClick={() => setRejecting(true)}>Reject</Button>
        </div>
      ) : <p className="small muted">You can see this but are not an approver for it.</p>}
      {held && a.canDecide ? <p className="small" style={{ margin: 0 }}>Fix the hold on the invoice before approving it.</p> : null}
      <Dialog open={rejecting} onClose={() => setRejecting(false)} title="Reject this step?" footer={<><Button onClick={() => setRejecting(false)}>Cancel</Button><Button variant="danger" busy={decide.busy} onClick={() => decide.run('reject')}>Reject</Button></>}>
        <div className="stack">
          <p>The step will not run and the workflow stops here. Nothing that already happened is reversed.</p>
          <ErrorSummary error={decide.error} />
          <Field label="Reason" id="f-note" hint="Tell the team what to change." error={decide.fieldError('note')}>{(p) => <Textarea {...p} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
      </Dialog>
      {node}
    </article>
  );
}

export function InboxPage() {
  const c = useCompany();
  useDocumentTitle('Inbox');
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') ?? 'action') as 'action' | 'warnings' | 'updates' | 'decided';
  const approvals = useQuery({ queryKey: [c.cid, 'approvals', 'pending'], queryFn: () => get(`/c/${c.cid}/approvals?status=pending`) });
  const decided = useQuery({ queryKey: [c.cid, 'approvals', 'decided'], queryFn: () => get(`/c/${c.cid}/approvals?status=decided`), enabled: tab === 'decided' });
  const cat = tab === 'action' ? 'needs_action' : tab === 'warnings' ? 'warning' : 'update';
  const notes = useQuery({ queryKey: [c.cid, 'notifications', cat], queryFn: () => get(`/c/${c.cid}/notifications?category=${cat}&state=${tab === 'updates' ? 'all' : 'open'}`), enabled: tab !== 'decided' });
  const refresh = () => qc.invalidateQueries({ queryKey: [c.cid] });
  const resolve = async (id: string) => { await post(`/c/${c.cid}/notifications/${id}/resolve`); refresh(); };
  const markRead = async (id: string) => { await post(`/c/${c.cid}/notifications/read`, { ids: [id] }); refresh(); };
  const list = (notes.data?.notifications ?? []).filter((n: any) => !(tab === 'action' && n.ref_type === 'approval'));
  // Links from Home point at one approval card (#ap-…): bring it into view once the cards have loaded.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id && approvals.data) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [approvals.data]);
  return (
    <div className="page page-narrow">
      <div className="page-header"><div><h1>Inbox</h1><div className="sub">Approvals and next steps first, then warnings and updates. Reading an item does not resolve it.</div></div>{c.attention.unread ? <span className="small muted"><span className="num" style={{ color: 'var(--text)' }}>{c.attention.unread}</span> unread</span> : null}</div>
      <Tabs label="Inbox sections" value={tab} onChange={(k) => setSp({ tab: k })} tabs={[
        { key: 'action', label: <><Hand aria-hidden style={{ width: 16 }} />Needs action{c.attention.needs_action ? <span className="count">{c.attention.needs_action}</span> : null}</> },
        { key: 'warnings', label: <><AlertTriangle aria-hidden style={{ width: 16 }} />Warnings{c.attention.warnings ? <span className="count">{c.attention.warnings}</span> : null}</> },
        { key: 'updates', label: <><Info aria-hidden style={{ width: 16 }} />Updates</> },
        { key: 'decided', label: 'Decided' },
      ]} />
      {tab === 'action' && (
        <section className="stack" aria-label="Approvals">
          {approvals.isLoading ? <LoadingBlock /> : approvals.error ? <ErrorState error={approvals.error} /> : approvals.data.approvals.map((a: any) => <ApprovalCard key={a.id} a={a} onDone={refresh} />)}
        </section>
      )}
      {tab === 'decided' ? (
        decided.isLoading ? <LoadingBlock /> : (
          <div className="card card-flush"><ul className="list">{decided.data?.approvals.map((a: any) => (
            <li key={a.id} className="list-item"><span style={{ flex: 1, minWidth: 0 }}><strong>{a.title}</strong><div className="small muted">{a.status} {a.decided_by_name ? `by ${a.decided_by_name}` : ''} {a.decided_at ? fmtDateTime(a.decided_at, c.company.timezone) : ''}{a.decision_note ? ` · ${a.decision_note}` : ''}</div>{a.summary?.kind === 'invoice' ? <div className="small">{a.summary.customerName}{a.summary.jobNumber ? ` · job #${a.summary.jobNumber}` : ''}{a.summary.number ? ` · ${a.summary.number}` : ''}</div> : null}</span>
              <span className="decided-side">{a.summary?.kind === 'invoice' && a.summary.totalMinor !== undefined ? <span className="num as-total">{formatMoney(a.summary.totalMinor, a.summary.currency)}</span> : null}<Pill tone={a.status === 'approved' ? 'success' : a.status === 'rejected' ? 'danger' : 'neutral'}>{a.status}</Pill></span></li>
          ))}</ul>{decided.data?.approvals.length === 0 && <Empty icon={<Check />} title="No decisions yet" />}</div>
        )
      ) : notes.isLoading ? <LoadingBlock /> : (
        list.length === 0 && (tab !== 'action' || !approvals.data?.approvals.length) ? <Card><Empty icon={<InboxIcon />} title="All clear">{tab === 'action' ? 'Nothing is waiting for you.' : tab === 'warnings' ? 'No open warnings.' : 'No updates.'}</Empty></Card> : list.length > 0 && (
          <div className="card card-flush"><ul className="list">{list.map((n: any) => (
            <li key={n.id} className="list-item">
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, marginTop: 8, background: n.read_at ? 'transparent' : 'var(--primary)', flex: 'none' }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="row" style={{ gap: 8 }}><strong style={{ fontWeight: n.read_at ? 550 : 650 }}>{n.title}</strong>{n.read_at ? null : <span className="sr-only"> (unread)</span>}{!n.resolved_at && n.category !== 'update' ? <Pill tone="neutral">Unresolved</Pill> : null}</span>
                {n.body ? <div className="small">{n.body}</div> : null}
                <div className="xsmall muted">{relTime(n.created_at)}{n.resolved_at ? ' · resolved' : ''}</div>
                <div className="row" style={{ marginTop: 6 }}>
                  {n.link && <Link className="btn btn-sm" to={c.to(n.link)} onClick={() => markRead(n.id)}>Open</Link>}
                  {!n.read_at && <Button size="sm" variant="ghost" onClick={() => markRead(n.id)}>Mark read</Button>}
                  {!n.resolved_at && n.category !== 'update' && !['approval', 'action'].includes(n.ref_type) && <Button size="sm" variant="ghost" icon={<Check aria-hidden />} onClick={() => resolve(n.id)}>Mark resolved</Button>}
                </div>
              </span>
            </li>
          ))}</ul></div>
        )
      )}
    </div>
  );
}
