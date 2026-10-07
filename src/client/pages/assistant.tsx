import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Sparkles, FileText, Trash2, ShieldCheck, Eye, Workflow, ArrowUpRight, ChevronRight } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, ApiError } from '../lib/api';
import { Button, Pill, Banner, LoadingBlock, PageHeader, Card, useConfirm } from '../components/ui';
import { relTime } from '../lib/format';

const SUGGESTIONS = ['What needs my attention?', 'Who is free at 2pm tomorrow?', 'Why is an invoice on hold?', 'When a job is completed, prepare an invoice and ask me to approve it'];

function ProposalCard({ p }: { p: any }) {
  const c = useCompany();
  return (
    <div className="card stack-sm" style={{ padding: 14, marginTop: 10, whiteSpace: 'normal' }}>
      <div className="row-between"><strong className="row" style={{ gap: 6 }}><FileText aria-hidden style={{ width: 16 }} />{p.name}</strong><Pill tone="info">Proposed</Pill></div>
      {p.validation?.errors?.length ? <Banner tone="danger">{p.validation.errors.join(' ')}</Banner> : null}
      {p.validation?.warnings?.length ? <Banner tone="warning">{p.validation.warnings.join(' ')}</Banner> : null}
      {p.explanation?.length ? <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{p.explanation.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul> : null}
      <p className="xsmall muted" style={{ margin: 0 }}>Not active. Accepting makes a draft you test and activate yourself.</p>
      <div><Link className="btn btn-sm btn-primary" to={c.to(`workflows/${p.workflowId}`)}><ArrowUpRight aria-hidden />Review proposal</Link></div>
    </div>
  );
}

export function AssistantChat({ compact, initial = '' }: { compact?: boolean; initial?: string }) {
  const c = useCompany();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [c.cid, 'assistant'], queryFn: () => get(`/c/${c.cid}/assistant`) });
  const [text, setText] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (initial) { setText(initial); inputRef.current?.focus(); } }, [initial]);
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
  const { ask, node: confirmNode } = useConfirm();
  const clear = async () => {
    if (!(await ask({ title: 'Clear this conversation?', body: 'Your questions and Rigo\'s answers are removed for you. Anything Rigo prepared (drafts, proposals) stays where it is.', confirm: 'Clear conversation', danger: true }))) return;
    await post(`/c/${c.cid}/assistant/clear`); qc.invalidateQueries({ queryKey: [c.cid, 'assistant'] });
  };
  const ai = q.data?.ai;
  return (
    <div className="chat-shell" style={compact ? { minHeight: 0 } : undefined}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }} className="small row">
        {ai?.state === 'available' ? <Pill tone="success" icon={<Sparkles aria-hidden />}>AI on</Pill> : <Pill tone="neutral">Prepared responses · AI off</Pill>} <span className="muted">{ai?.reason}</span>
      </div>
      <div className="chat" aria-live="polite" aria-busy={busy}>
        {q.isLoading ? <LoadingBlock /> : q.data?.messages.length === 0 ? (
          <div className="stack" style={{ margin: 'auto 0', alignItems: 'flex-start' }}>
            <h2 style={{ fontSize: 'var(--fs-22)' }}>What can Rigo help with?</h2>
            <p className="muted prose" style={{ margin: 0 }}>Ask about your work or describe a workflow. Answers only use information your role can see. Proposals never change your setup until you accept, test and activate them.</p>
            <div className="suggestions">{SUGGESTIONS.map((s) => <button key={s} type="button" className="suggestion" onClick={() => send(s)}><Sparkles aria-hidden />{s}</button>)}</div>
          </div>
        ) : q.data?.messages.map((m: any) => (
          <div key={m.id} className={`msg ${m.role === 'user' ? 'msg-user' : 'msg-assistant'}`}>
            {m.role === 'assistant' && <div className="msg-meta">{m.source === 'ai' ? <Pill tone="brand" icon={<Sparkles aria-hidden />}>AI response</Pill> : <Pill tone="neutral">Prepared response (not AI)</Pill>}<span>{relTime(m.created_at)}</span></div>}
            {m.content}
            {m.links?.length ? <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>{m.links.map((l: any) => <Link key={`${l.to}-${l.label}`} className="btn btn-sm" to={c.to(l.to)}>{l.label}<ChevronRight aria-hidden /></Link>)}</div> : null}
            {m.proposal ? <ProposalCard p={m.proposal} /> : null}
          </div>
        ))}
        <div ref={end} />
      </div>
      {err && <div style={{ padding: '0 12px' }}><Banner tone="danger">{err}</Banner></div>}
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <label htmlFor={compact ? 'chat-c' : 'chat-p'} className="sr-only">Message the assistant</label>
        <input ref={inputRef} id={compact ? 'chat-c' : 'chat-p'} className="input" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask or describe a workflow…" autoComplete="off" />
        <Button type="submit" variant="primary" busy={busy} aria-label="Send"><Send aria-hidden /></Button>
      </form>
      {q.data?.messages.length ? <div style={{ padding: '0 12px 12px' }}><Button size="sm" variant="ghost" icon={<Trash2 aria-hidden />} onClick={clear}>Clear conversation</Button></div> : null}
      {confirmNode}
    </div>
  );
}

export function AssistantPage() {
  const [sp] = useSearchParams();
  const ask = sp.get('ask') ?? '';
  return (
    <div className="page">
      <PageHeader title="Assistant" sub="Help with setup, exceptions, today's work and workflow proposals." />
      <div className="assistant-page">
        <div className="card card-flush" style={{ display: 'flex', flexDirection: 'column' }}><AssistantChat initial={ask} /></div>
        <aside className="stack" aria-label="About the assistant">
          <Card title="How it works">
            <ul className="list small">
              <li className="row" style={{ padding: '8px 0', flexWrap: 'nowrap', alignItems: 'flex-start' }}><Eye aria-hidden style={{ width: 16, flex: 'none', marginTop: 3 }} /><span>It only sees what your role can see.</span></li>
              <li className="row" style={{ padding: '8px 0', flexWrap: 'nowrap', alignItems: 'flex-start' }}><ShieldCheck aria-hidden style={{ width: 16, flex: 'none', marginTop: 3 }} /><span>It never sets prices, computes totals, approves or changes anything.</span></li>
              <li className="row" style={{ padding: '8px 0', flexWrap: 'nowrap', alignItems: 'flex-start' }}><Workflow aria-hidden style={{ width: 16, flex: 'none', marginTop: 3 }} /><span>Workflow ideas become proposals. You accept, test and activate them yourself.</span></li>
            </ul>
          </Card>
          <Card title="Answer labels">
            <div className="stack-sm small">
              <span className="row" style={{ gap: 8 }}><Pill tone="neutral">Prepared response (not AI)</Pill></span><span className="muted">Built from your records without AI.</span>
              <span className="row" style={{ gap: 8 }}><Pill tone="brand" icon={<Sparkles aria-hidden />}>AI response</Pill></span><span className="muted">Written by AI when it is turned on for your company.</span>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
