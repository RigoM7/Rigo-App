import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MailOpen } from 'lucide-react';
import { get, post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Banner, LoadingBlock, ErrorSummary, LinkButton, Wordmark } from '../components/ui';
import { fmtDate } from '../lib/format';
import { refreshMe, signOutAndForget } from '../lib/session';
import { useDocumentTitle } from '../lib/title';

export function InvitePage() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['invite', token], queryFn: () => get(`/invitations/${token}`) });
  const accept = useSubmit(async () => { const r = await post(`/invitations/${token}/accept`); await refreshMe(qc); nav(`/c/${r.companyId}`); });
  const signOut = async () => { await signOutAndForget(qc); nav(`/signin?next=/invite/${token}`); };
  const d = q.data;
  useDocumentTitle(d?.companyName ? `Join ${d.companyName}` : 'Invitation');
  return (
    <div className="auth-wrap">
      <main className="auth-card" id="main">
        <Wordmark to="/" />
        <div className="auth-panel stack">
          {q.isLoading ? <LoadingBlock /> : !d || d.state === 'invalid' ? (
            <Banner tone="danger" title="This invitation link is not valid">Check that you copied the whole link, or ask the company to send a new invitation.</Banner>
          ) : (
            <>
              <span className="empty-icon" aria-hidden><MailOpen /></span>
              <h1>Join {d.companyName}</h1>
              <p style={{ margin: 0 }}>You are invited as <strong>{d.roleName}</strong>. The invitation is for <strong>{d.emailHint}</strong>{d.state === 'pending' ? ` and expires ${fmtDate(d.expiresAt)}` : ''}.</p>
              {d.state === 'expired' && <Banner tone="warning" title="This invitation has expired">Ask the company to send a new one.</Banner>}
              {d.state === 'revoked' && <Banner tone="warning" title="This invitation was cancelled">Ask the company if you should still join.</Banner>}
              {d.state === 'replaced' && <Banner tone="warning" title="A newer invitation was sent">Use the most recent link you received.</Banner>}
              {d.state === 'accepted' && (d.companyId ? <LinkButton variant="primary" to={`/c/${d.companyId}`}>Open {d.companyName}</LinkButton> : <Banner tone="info">This invitation has already been used.</Banner>)}
              {d.state === 'pending' && !d.signedIn && (
                <div className="stack-sm">
                  <p className="muted">Sign in or create an account with the invited email address. You don't need to create a company or try the demo first.</p>
                  <LinkButton variant="primary" to={`/signup?next=/invite/${token}`}>Create an account</LinkButton>
                  <LinkButton to={`/signin?next=/invite/${token}`}>I already have an account</LinkButton>
                </div>
              )}
              {d.state === 'pending' && d.signedIn && d.emailMatches === false && (
                <div className="stack-sm">
                  <Banner tone="warning" title="You're signed in with a different email">This invitation is for {d.emailHint}. Sign out, then sign in or create an account with that address.</Banner>
                  <Button variant="primary" onClick={signOut}>Sign out and switch account</Button>
                </div>
              )}
              {d.state === 'pending' && d.signedIn && d.emailMatches && (
                <div className="stack-sm">
                  <ErrorSummary error={accept.error} />
                  <Button variant="primary" size="lg" busy={accept.busy} onClick={() => accept.run()}>Accept invitation</Button>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
