import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Sparkles, FileText, Trash2 } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, ApiError } from '../lib/api';
import { Button, Pill, Banner, LoadingBlock, PageHeader } from '../components/ui';
import { relTime } from '../lib/format';

const SUGGESTIONS = ['What needs my attention?', 'Why is an invoice on hold?', 'What is on today?', 'When a job is completed, prepare an invoice and ask me to approve it'];

function ProposalCard({ p }: { p: any }) {
  const c = useCompany();
  return (
    <div className="card stack-sm" style={{ padding: 12, marginTop: 8 }}>
      <div className="row-between"><strong className="row" style={{ gap: 6 }}><FileText aria-hidden style={{ width: 16 }} />{p.name}</strong><Pill tone="info">Proposed</Pill></div>
      {p.validation?.errors?.length ? <Banner tone="danger">{p.validation.errors.join(' ')}</Banner> : null}
      {p.validation?.warnings?.length ? <Banner tone="warning">{p.validation.warnings.join(' ')}</Banner> : null}
      <Link className="btn btn-sm" to={c.to(`workflows/${p.workflowId}`)}>Review proposal</Link>
    </div>
  );
}

export function AssistantChat({ compact }: { compact?: boolean }) {
  const c = useCompany();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [c.cid, 'assistant'], queryFn: () => get(`/c/${c.cid}/assistant`) });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [q.data]);
  const send = async (t: string) => {
    if (!t.trim()) return;
    setBusy(true); setErr(null);
    try { await post(`/c/${c.cid}/assistant`, { text: t }); setText(''); await qc.invalidateQueries({ queryKey: [c.cid, 'assistant'] }); qc.invalidateQueries({ queryKey: [c.cid, 'workflows'] }); }
    catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); }
  };
  const clear = async () => { await post(`/c/${c.cid}/assistant/clear`); qc.invalidateQueries({ queryKey: [c.cid, 'assistant'] }); };
  const ai = q.data?.ai;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: compact ? 0 : 480 }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }} className="small">
        {ai?.state === 'available' ? <Pill tone="success">AI on</Pill> : <Pill tone="neutral">Prepared responses · AI off</Pill>} <span className="muted">{ai?.reason}</span>
      </div>
      <div className="chat" aria-live="polite" aria-busy={busy}>
        {q.isLoading ? <LoadingBlock /> : q.data?.messages.length === 0 ? (
          <div className="stack-sm">
            <p className="muted">Ask about your work or describe a workflow. Answers only use information your role can see. Proposals never change your setup until you accept, test and activate them.</p>
            {SUGGESTIONS.map((s) => <button key={s} className="btn btn-sm" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => send(s)}>{s}</button>)}
          </div>
        ) : q.data?.messages.map((m: any) => (
          <div key={m.id} className={`msg ${m.role === 'user' ? 'msg-user' : 'msg-assistant'}`}>
            {m.role === 'assistant' && <div className="msg-meta">{m.source === 'ai' ? <><Sparkles aria-hidden style={{ width: 12 }} />AI response</> : 'Prepared response (not AI)'} · {relTime(m.created_at)}</div>}
            {m.content}
            {m.proposal ? <ProposalCard p={m.proposal} /> : null}
          </div>
        ))}
        <div ref={end} />
      </div>
      {err && <div style={{ padding: '0 12px' }}><Banner tone="danger">{err}</Banner></div>}
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <label htmlFor={compact ? 'chat-c' : 'chat-p'} className="sr-only">Message the assistant</label>
        <input id={compact ? 'chat-c' : 'chat-p'} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask or describe a workflow…" autoComplete="off" />
        <Button type="submit" variant="primary" busy={busy} aria-label="Send"><Send aria-hidden /></Button>
      </form>
      {q.data?.messages.length ? <div style={{ padding: '0 12px 12px' }}><Button size="sm" variant="ghost" icon={<Trash2 aria-hidden />} onClick={clear}>Clear conversation</Button></div> : null}
    </div>
  );
}

export function AssistantPage() {
  return (
    <div className="page page-narrow">
      <PageHeader title="Assistant" sub="Help with setup, exceptions, today's work and workflow proposals." />
      <div className="card card-flush" style={{ display: 'flex', flexDirection: 'column', minHeight: '60dvh' }}><AssistantChat /></div>
    </div>
  );
}
