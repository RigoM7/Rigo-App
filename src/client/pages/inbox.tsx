import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox as InboxIcon, Check, X, Hand, Mail, FileText, AlertTriangle, Bell, UserPlus } from 'lucide-react';
import { get, post } from '../lib/api';
import { useWorkspace } from '../lib/session';
import { useTitle } from '../lib/title';
import { fmtDateTime, relTime } from '../lib/format';
import { PageHeader, Button, Empty, Loading, ErrorState, Money, Badge, Banner, Dialog, TextField, useToast, LinkButton } from '../components/ui';
import { LEVELS } from '../../shared/automation';

/** The approvals inbox: what Rigo prepared and waits for a person, requests from the booking page, held invoices and updates. */
export function Inbox() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  useTitle('Inbox', ws.workspace.name);
  const q = useQuery({ queryKey: [ws.cid, 'inbox'], queryFn: () => get<any>(`/c/${ws.cid}/inbox`) });
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<any>(null);
  const [reason, setReason] = useState('');
  const done = () => { void qc.invalidateQueries({ queryKey: [ws.cid] }); };
  const act = async (id: string, what: 'approve' | 'take-over', body: unknown = {}) => {
    setBusy(id);
    try {
      const r = await post<any>(`/c/${ws.cid}/inbox/${id}/${what}`, body);
      if (what === 'take-over') toast('It’s yours now. Rigo won’t touch it.');
      else if (r.issued) toast(`Approved and issued as ${r.issued}.`);
      else if (r.status === 'simulated') toast('Approved. Demo: simulated, nothing was sent.', 'info');
      else if (r.status === 'blocked') toast(`Approved, but not sent: ${r.detail}`, 'info');
      else if (r.status === 'sent') toast('Approved and sent.');
      else if (r.status === 'failed') toast(`Approved, but sending failed: ${r.detail}`, 'error');
      else toast('Approved.');
      done();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };
  const request = async (id: string, what: 'accept' | 'decline') => {
    setBusy(id);
    try {
      const r = await post<any>(`/c/${ws.cid}/requests/${id}/${what}`, {});
      toast(what === 'accept' ? `Added as ${ws.words.work.one.toLowerCase()} #${r.number}.` : 'Declined.');
      done();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };
  if (q.isLoading) return <div className="page"><Loading /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} retry={() => q.refetch()} /></div>;
  const d = q.data;
  const total = d.approvals.length + d.requests.length + d.held.length;
  return (
    <div className="page page-narrow">
      <PageHeader title="Inbox" sub={total ? `${total} waiting for a person.` : 'Nothing is waiting for you.'} />
      {d.paused && <Banner tone="attn" title="Rigo is paused">Approving is off until it’s resumed. You can still take items over and do them yourself.</Banner>}

      {d.approvals.length > 0 && (
        <section className="stack" aria-labelledby="ib-approve">
          <h2 id="ib-approve">To approve</h2>
          {d.approvals.map((a: any) => (
            <article key={a.id} className="card stack" aria-labelledby={`a-${a.id}`}>
              <div className="row-between">
                <div className="row">{a.kind === 'invoice' ? <FileText aria-hidden="true" /> : <Mail aria-hidden="true" />}<h3 id={`a-${a.id}`}>{a.title}</h3></div>
                <Badge tone="open">Rigo prepared · {LEVELS[a.level as keyof typeof LEVELS].label}</Badge>
              </div>
              {a.kind === 'invoice' ? (
                <div className="row-between">
                  {a.invoice_status === 'held' ? <span className="row small"><AlertTriangle size={16} aria-hidden="true" />{a.hold_reasons?.[0]}</span> : <span>Total <Money minor={a.total_minor} currency={a.currency} /></span>}
                  <Link to={ws.to(`money/invoices/${a.subject_id}`)}>Check the invoice</Link>
                </div>
              ) : (
                <div className="stack-sm">
                  <p className="small muted">{a.message_channel === 'sms' ? 'Text' : 'Email'}{a.message_recipient ? ` to ${a.message_recipient}` : ''}</p>
                  <blockquote className="card soft small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{a.message_body}</blockquote>
                </div>
              )}
              <div className="form-actions">
                <Button variant="primary" busy={busy === a.id} disabled={d.paused || a.invoice_status === 'held'} onClick={() => void act(a.id, 'approve', a.kind === 'invoice' ? { invoiceVersion: a.invoice_version } : {})} icon={<Check size={18} aria-hidden="true" />}>
                  {a.kind === 'invoice' ? (a.level === 'automatic' ? 'Approve and issue' : 'Approve') : 'Approve and send'}
                </Button>
                <Button onClick={() => { setRejecting(a); setReason(''); }} icon={<X size={18} aria-hidden="true" />}>Reject</Button>
                <Button variant="ghost" onClick={() => void act(a.id, 'take-over')} icon={<Hand size={18} aria-hidden="true" />}>Take over</Button>
              </div>
              <p className="tiny muted">Prepared {relTime(a.created_at)}. Nothing happens until a person decides.</p>
            </article>
          ))}
        </section>
      )}

      {d.requests.length > 0 && (
        <section className="stack" aria-labelledby="ib-req">
          <h2 id="ib-req">New requests</h2>
          {d.requests.map((r: any) => (
            <article key={r.id} className="card stack">
              <div className="row-between"><div className="row"><UserPlus aria-hidden="true" /><h3>{r.name}</h3></div><span className="small muted">{relTime(r.created_at)}</span></div>
              <dl className="details">
                {r.wanted && <div><dt>Asked for</dt><dd>{r.wanted}</dd></div>}
                {r.preferred_at && <div><dt>Time</dt><dd>{fmtDateTime(r.preferred_at, ws.workspace.timezone)}</dd></div>}
                {r.address && <div><dt>Address</dt><dd>{r.address}</dd></div>}
                {(r.email || r.phone) && <div><dt>Contact</dt><dd>{[r.email, r.phone].filter(Boolean).join(' · ')}</dd></div>}
                {r.message && <div style={{ gridColumn: '1 / -1' }}><dt>Message</dt><dd>{r.message}</dd></div>}
              </dl>
              <div className="form-actions">
                <Button variant="primary" busy={busy === r.id} onClick={() => void request(r.id, 'accept')} icon={<Check size={18} aria-hidden="true" />}>Accept and add</Button>
                <Button onClick={() => void request(r.id, 'decline')}>Decline</Button>
              </div>
            </article>
          ))}
        </section>
      )}

      {d.held.length > 0 && (
        <section className="stack" aria-labelledby="ib-held">
          <h2 id="ib-held">Held invoices</h2>
          <div className="card card-flush"><ul className="divider-list">
            {d.held.map((h: any) => (
              <li key={h.id}><Link className="list-row" to={ws.to(`money/invoices/${h.id}`)}>
                <AlertTriangle aria-hidden="true" style={{ color: 'var(--attention-ink)' }} />
                <span className="row-main"><span className="row-title">{h.client_name}</span><span className="row-sub">{h.hold_reasons[0]}</span></span>
                <span className="btn btn-sm">Fix it</span>
              </Link></li>
            ))}
          </ul></div>
        </section>
      )}

      {total === 0 && <div className="card"><Empty icon={<InboxIcon />} title="All clear">When Rigo prepares something, or a customer sends a request, it waits here for a person.</Empty></div>}

      {d.notifications.length > 0 && (
        <section className="stack" aria-labelledby="ib-upd">
          <div className="row-between"><h2 id="ib-upd">Updates</h2><Button size="sm" variant="ghost" onClick={async () => { await post(`/c/${ws.cid}/notifications/read`, { all: true }); done(); }}>Mark all read</Button></div>
          <div className="card card-flush"><ul className="divider-list">
            {d.notifications.map((n: any) => (
              <li key={n.id}>
                {n.link ? <Link className="list-row" to={ws.to(n.link)}><Bell aria-hidden="true" style={{ color: n.read_at ? 'var(--text-2)' : 'var(--primary-text)' }} /><span className="row-main"><span className="row-title">{n.title}</span>{n.body && <span className="row-sub">{n.body}</span>}</span><span className="small muted">{relTime(n.created_at)}</span></Link>
                  : <div className="list-row"><Bell aria-hidden="true" /><span className="row-main"><span className="row-title">{n.title}</span>{n.body && <span className="row-sub">{n.body}</span>}</span><span className="small muted">{relTime(n.created_at)}</span></div>}
              </li>
            ))}
          </ul></div>
        </section>
      )}
      {ws.can('automation.manage') && <p className="small muted">Choose how much Rigo does on its own in <Link to={ws.to('settings/automation')}>Settings, Automation</Link>.</p>}

      {rejecting && (
        <Dialog title="Reject this?" onClose={() => setRejecting(null)} actions={<>
          <Button variant="primary" busy={busy === rejecting.id} onClick={async () => {
            setBusy(rejecting.id);
            try { await post(`/c/${ws.cid}/inbox/${rejecting.id}/reject`, { reason }); toast(rejecting.kind === 'invoice' ? 'Rejected. The work is back in Ready to bill.' : 'Rejected. Nothing was sent.'); setRejecting(null); done(); }
            catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
          }}>Reject</Button>
          <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
        </>}>
          <p className="muted">{rejecting.kind === 'invoice' ? 'The prepared invoice is removed and the work goes back to Ready to bill, for a person to handle.' : 'The message is not sent.'}</p>
          <TextField label="Why" optional value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </Dialog>
      )}
      <LinkButton to={ws.to()} variant="ghost" className="no-print">Back to Today</LinkButton>
    </div>
  );
}
