import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, Pencil, Hand, AlertTriangle, Info, Inbox as InboxIcon, Check } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Tabs, LoadingBlock, ErrorState, Empty, Pill, Dialog, Field, Textarea, ErrorSummary, useToast } from '../components/ui';
import { relTime, fmtDateTime } from '../lib/format';
import { useDocumentTitle } from '../lib/title';

function ApprovalCard({ a, onDone }: { a: any; onDone: () => void }) {
  const c = useCompany();
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const decide = useSubmit(async (decision: 'approve' | 'reject') => {
    const r = await post(`/c/${c.cid}/approvals/${a.id}/decide`, { decision, note });
    if (r.status === 'stale') toast(`Not approved: ${r.reason} A fresh approval request was created if the step still applies.`, 'info');
    else toast(decision === 'approve' ? 'Approved. Rigo will continue the workflow.' : 'Rejected. The step will not run.');
    setRejecting(false);
    onDone();
  });
  const editLink = a.subject_type === 'invoice' ? c.to(`invoices/${a.subject_id}`) : a.subject_type === 'job' ? c.to(`jobs/${a.subject_id}`) : null;
  return (
    <article className="card stack-sm" aria-labelledby={`ap-${a.id}`}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}><h3 id={`ap-${a.id}`}>{a.title}</h3><span className="row" style={{ gap: 6 }}>{a.escalated_at ? <Pill tone="danger" icon={<AlertTriangle aria-hidden />}>Escalated</Pill> : null}<Pill tone="warning">Waiting for approval</Pill></span></div>
      <p className="xsmall muted" style={{ margin: 0 }}>
        {a.workflow_name ? <>From workflow “{a.workflow_name}” · </> : null}Requested {relTime(a.created_at)}
        {a.escalated_at ? <> · it passed its waiting time and is still pending. It is never approved automatically.</> : null}
      </p>
      <dl className="consequences">
        <div><dt><CheckCircle2 aria-hidden />If approved</dt><dd>{a.consequence}</dd></div>
        <div><dt><XCircle aria-hidden />If rejected</dt><dd>The step does not run and the workflow stops. Nothing already done is undone.</dd></div>
        <div><dt><Pencil aria-hidden />If edited</dt><dd>Edit opens the record. Any change makes this request out of date and Rigo asks again.</dd></div>
      </dl>
      <ErrorSummary error={decide.error} />
      {a.canDecide ? (
        <div className="form-actions">
          <Button variant="primary" icon={<CheckCircle2 aria-hidden />} busy={decide.busy} onClick={() => decide.run('approve')}>Approve</Button>
          {editLink && <Link className="btn" to={editLink}><Pencil aria-hidden />Edit</Link>}
          <Button variant="danger" icon={<XCircle aria-hidden />} onClick={() => setRejecting(true)}>Reject</Button>
        </div>
      ) : <p className="small muted">You can see this but are not an approver for it.</p>}
      <Dialog open={rejecting} onClose={() => setRejecting(false)} title="Reject this step?" footer={<><Button onClick={() => setRejecting(false)}>Cancel</Button><Button variant="danger" busy={decide.busy} onClick={() => decide.run('reject')}>Reject</Button></>}>
        <div className="stack">
          <p>The step will not run and the workflow stops here. Nothing that already happened is reversed.</p>
          <ErrorSummary error={decide.error} />
          <Field label="Reason" id="f-note" hint="Tell the team what to change." error={decide.fieldError('note')}>{(p) => <Textarea {...p} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
      </Dialog>
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
            <li key={a.id} className="list-item"><span style={{ flex: 1 }}><strong>{a.title}</strong><div className="small muted">{a.status} {a.decided_by_name ? `by ${a.decided_by_name}` : ''} {a.decided_at ? fmtDateTime(a.decided_at) : ''}{a.decision_note ? ` · ${a.decision_note}` : ''}</div></span><Pill tone={a.status === 'approved' ? 'success' : a.status === 'rejected' ? 'danger' : 'neutral'}>{a.status}</Pill></li>
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
