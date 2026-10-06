import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api';
import { Banner, LoadingBlock } from '../components/ui';
import { fmtDateTime } from '../lib/format';

/** Local-only stand-in for an email inbox. Disabled in production deployments. */
export function DevMailbox() {
  const q = useQuery({ queryKey: ['mailbox'], queryFn: () => get('/auth/dev/mailbox'), refetchInterval: 5000 });
  return (
    <div className="auth-wrap" style={{ alignItems: 'start' }}>
      <main className="page page-narrow" id="main" style={{ width: '100%' }}>
        <Link to="/" className="brand"><span className="brand-mark" aria-hidden>R</span>Rigo</Link>
        <h1>Simulated mailbox</h1>
        <Banner tone="info">These emails were <strong>not sent</strong>. This local preview shows what Rigo would send (invitations and password resets) when no email service is configured.</Banner>
        {q.isLoading ? <LoadingBlock /> : !q.data?.enabled ? <Banner tone="warning">The simulated mailbox is turned off on this installation.</Banner> : q.data.messages.length === 0 ? <p className="muted">No messages yet.</p> : q.data.messages.map((m: any) => (
          <article key={m.id} className="card stack-sm">
            <div className="small muted">To {m.to_email} · {fmtDateTime(m.created_at)} · {m.kind.replace('_', ' ')}</div>
            <h2 style={{ fontSize: '1.0625rem' }}>{m.subject}</h2>
            <p className="pre">{m.body}</p>
            {m.link ? <a className="btn btn-primary" href={new URL(m.link).pathname}>Open link</a> : null}
          </article>
        ))}
      </main>
    </div>
  );
}
