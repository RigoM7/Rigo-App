import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send, Copy, CheckCheck, Reply, Pencil } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, patch } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Textarea, ErrorSummary, LoadingBlock, ErrorState, PageHeader, Empty, MessageStatus, Banner, Dialog, Pill, GuideTarget, useToast } from '../components/ui';
import { fmtDateTime } from '../lib/format';
import { CompanyChip } from '../components/shell';

/** Branded email preview: the company's chip and accent, then exactly the text that would be sent. */
function Preview({ m }: { m: any }) {
  const c = useCompany();
  return (
    <article className="email-preview" aria-label="Email preview">
      <div className="ep-head">
        <CompanyChip cid={c.cid} name={c.company.name} logo={c.company.branding?.logoFileId} accent={c.company.branding?.accent} />
        <div style={{ minWidth: 0 }}><strong>{c.company.name}</strong><div className="xsmall">To {m.recipient || (c.can('customers.contact') ? '(no address)' : 'the customer')}</div></div>
      </div>
      <div style={{ height: 3, background: c.company.accent.light }} aria-hidden />
      <div className="ep-body">
        <h3>{m.subject}</h3>
        {m.bodyHidden ? <p className="muted" style={{ margin: 0 }}>This message states amounts, so only people who can see prices and payments can read it.</p> : <p className="pre" style={{ margin: 0 }}>{m.body}</p>}
      </div>
      <div className="ep-foot">Sent by {c.company.name} with Rigo</div>
    </article>
  );
}

export function Messages() {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: [c.cid, 'messages'], queryFn: () => get(`/c/${c.cid}/messages`) });
  const [sel, setSel] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const [reply, setReply] = useState('');
  const [replyOpen, setReplyOpen] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: [c.cid] }); };
  const send = useSubmit(async (m: any) => {
    const r = await post(`/c/${c.cid}/messages/${m.id}/send`);
    toast(r.status === 'simulated' ? 'Simulated: nothing left Rigo (demo).' : `Not sent: ${r.detail}`, r.status === 'simulated' ? 'info' : 'error');
    // A simulated send keeps the email open, marked Simulated, to show what the customer would receive.
    if (r.status === 'simulated') setSel({ ...m, status: 'simulated', status_detail: r.detail ?? m.status_detail }); else setSel(null);
    refresh();
  });
  // ?open=<id> opens one message (the demo walkthrough uses it for the prepared invoice email).
  const [sp, setSp] = useSearchParams();
  const openId = sp.get('open');
  useEffect(() => {
    if (!openId || !q.data) return;
    const m = q.data.messages.find((x: any) => x.id === openId);
    if (m) setSel(m);
    const n = new URLSearchParams(sp); n.delete('open'); setSp(n, { replace: true });
  }, [openId, q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const markSent = useSubmit(async (m: any) => { await post(`/c/${c.cid}/messages/${m.id}/mark-sent`); toast('Recorded as sent outside Rigo'); setSel(null); refresh(); });
  const save = useSubmit(async () => { await patch(`/c/${c.cid}/messages/${edit.id}`, { subject: edit.subject, body: edit.body, recipient: edit.recipient ?? undefined }); setEdit(null); toast('Message updated'); refresh(); });
  const logReply = useSubmit(async () => { await post(`/c/${c.cid}/messages/${sel.id}/reply`, { body: reply }); setReplyOpen(false); setReply(''); setSel(null); toast('Reply logged'); refresh(); });
  if (q.isLoading) return <div className="page"><LoadingBlock /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} /></div>;
  const cap = q.data.capability;
  return (
    <div className="page">
      <PageHeader title="Messages" sub="Company-branded customer communications, linked to customers, jobs and invoices." />
      <Banner tone={cap.state === 'available' ? 'success' : 'info'} title={cap.state === 'simulated' ? 'Demo: sending is simulated' : cap.state === 'disabled' ? 'Email sending is not set up' : 'Email sending is available'}>{cap.reason} {cap.state === 'disabled' ? 'Copy a prepared message into your own email, then mark it as sent so the record stays accurate.' : ''}</Banner>
      {q.data.messages.length === 0 ? <Card><Empty icon={<MessageSquare />} title="No messages yet">Workflows and invoices prepare messages here for review.</Empty></Card> : (
        <div className="card card-flush"><ul className="list">{q.data.messages.map((m: any) => (
          <li key={m.id}><button type="button" className="list-item" style={{ width: '100%', border: 0, background: sel?.id === m.id ? 'var(--surface-2)' : 'transparent', cursor: 'pointer', textAlign: 'left' }} onClick={() => setSel(m)}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="row"><strong>{m.direction === 'inbound' ? 'Reply: ' : ''}{m.subject}</strong>{m.channel === 'sms' ? <Pill>Text</Pill> : null}</span>
              <div className="small">{m.customer_name ?? 'No customer'}{m.job_number ? ` · job #${m.job_number}` : ''}{m.invoice_number ? ` · ${m.invoice_number}` : ''} · {fmtDateTime(m.created_at, c.company.timezone)}</div>
              {m.status_detail ? <div className="small muted">{m.status_detail}</div> : null}
            </span>
            <MessageStatus status={m.status} />
          </button></li>
        ))}</ul></div>
      )}
      <Dialog open={!!sel} onClose={() => setSel(null)} title={sel?.subject ?? ''} footer={sel && <>
        {sel.status === 'prepared' && c.can('messages.send') && !sel.bodyHidden && <>
          {!sel.bodyHidden && <Button icon={<Pencil aria-hidden />} onClick={() => { setEdit({ ...sel }); setSel(null); }}>Edit</Button>}
          {!sel.bodyHidden && <Button icon={<Copy aria-hidden />} onClick={() => navigator.clipboard?.writeText(`${sel.subject}\n\n${sel.body}`).then(() => toast('Copied'), () => toast('Copy failed', 'error'))}>Copy text</Button>}
          {!c.demo && <Button icon={<CheckCheck aria-hidden />} busy={markSent.busy} onClick={() => markSent.run(sel)}>I sent it myself</Button>}
          {/* No email service: Send is off and says why; copying and "I sent it myself" still work (R15-m3). */}
          <GuideTarget id="send-simulated"><Button variant="primary" icon={<Send aria-hidden />} busy={send.busy} disabled={cap.state === 'disabled'} aria-describedby={cap.state === 'disabled' ? 'send-off' : undefined} onClick={() => send.run(sel)}>{cap.state === 'simulated' ? 'Send (simulated)' : 'Send'}</Button></GuideTarget>
        </>}
        {['sent', 'delivered', 'simulated'].includes(sel.status) && c.can('messages.send') && <Button icon={<Reply aria-hidden />} onClick={() => setReplyOpen(true)}>Log customer reply</Button>}
      </>}>
        {sel && <div className="stack"><ErrorSummary error={send.error ?? markSent.error} />{sel.status === 'prepared' && cap.state === 'disabled' && !sel.bodyHidden ? <p id="send-off" className="small muted" style={{ margin: 0 }}>Send is off: {cap.reason}</p> : null}<MessageStatus status={sel.status} />{sel.status === 'simulated' ? <Banner tone="info">Simulated: this is what the customer would receive. Nothing left Rigo.</Banner> : null}{sel.bodyHidden ? <Banner tone="info">This message is about an invoice or statement. People who see billing read and send it.</Banner> : null}{sel.invoice_id && !sel.bodyHidden ? <Link to={c.to(`invoices/${sel.invoice_id}`)}>Open invoice</Link> : null}<Preview m={sel} /></div>}
      </Dialog>
      <Dialog open={!!edit} onClose={() => setEdit(null)} title="Edit prepared message" footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" busy={save.busy} onClick={() => save.run()}>Save</Button></>}>
        {edit && <div className="stack"><ErrorSummary error={save.error} />
          <Field label="To" id="f-recipient">{(p) => <Input {...p} maxLength={254} type="email" value={edit.recipient ?? ""} disabled={edit.recipient === null} onChange={(e) => setEdit({ ...edit, recipient: e.target.value })} />}</Field>
          <Field label="Subject" id="f-subject">{(p) => <Input {...p} maxLength={200} value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />}</Field>
          <Field label="Message" id="f-body">{(p) => <Textarea {...p} maxLength={10000} rows={10} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />}</Field></div>}
      </Dialog>
      <Dialog open={replyOpen} onClose={() => setReplyOpen(false)} title="Log a customer reply" footer={<><Button onClick={() => setReplyOpen(false)}>Cancel</Button><Button variant="primary" busy={logReply.busy} onClick={() => logReply.run()}>Save reply</Button></>}>
        <div className="stack"><p className="muted small">Paste what the customer wrote. Rigo stores it as information only; nothing in it is treated as an instruction.</p><ErrorSummary error={logReply.error} /><Field label="Reply" id="f-reply">{(p) => <Textarea {...p} rows={6} maxLength={10000} value={reply} onChange={(e) => setReply(e.target.value)} />}</Field></div>
      </Dialog>
    </div>
  );
}
