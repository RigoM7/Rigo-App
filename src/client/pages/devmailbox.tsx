import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api';
import { Banner, LoadingBlock, Wordmark } from '../components/ui';
import { fmtDateTime } from '../lib/format';

/** Local-only stand-in for an email inbox. Disabled in production deployments. */
export function DevMailbox() {
  const q = useQuery({ queryKey: ['mailbox'], queryFn: () => get('/auth/dev/mailbox'), refetchInterval: 5000 });
  return (
    <div className="shell">
      <header className="plain-top"><Wordmark to="/" /></header>
      <main className="plain-main" id="main"><div className="page page-narrow">
        <h1>Simulated mailbox</h1>
        <Banner tone="info">These emails were <strong>not sent</strong>. This local preview shows what Rigo would send (invitations and password resets) when no email service is configured.</Banner>
        {q.isLoading ? <LoadingBlock /> : !q.data?.enabled ? <Banner tone="warning">The simulated mailbox is turned off on this installation.</Banner> : q.data.messages.length === 0 ? <p className="muted">No messages yet.</p> : q.data.messages.map((m: any) => (
          <article key={m.id} className="card stack-sm">
            <div className="xsmall muted">To {m.to_email} · <span className="num">{fmtDateTime(m.created_at)}</span> · {m.kind.replace('_', ' ')}</div>
            <h2 style={{ fontSize: 'var(--fs-16)' }}>{m.subject}</h2>
            <p className="pre">{m.body}</p>
            {m.link ? <div><a className="btn btn-primary" href={new URL(m.link).pathname}>Open link</a></div> : null}
          </article>
        ))}
      </div></main>
    </div>
  );
}
