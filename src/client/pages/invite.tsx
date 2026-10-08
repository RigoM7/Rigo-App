import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MailOpen } from 'lucide-react';
import { get, post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Banner, Loading, FormError, LinkButton } from '../components/ui';
import { fmtDate } from '../lib/format';
import { refreshMe, signOutAndForget } from '../lib/session';
import { AuthLayout } from './auth';

const GO_KEY = 'rigo-invite-accept';

/** An invitation link: who invited you, as what, and one button to join. */
export function InvitePage() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['invite', token], queryFn: () => get<any>(`/invitations/${token}`) });
  const accept = useSubmit(async () => { const r = await post<{ companyId: string }>(`/invitations/${token}/accept`); await refreshMe(qc); nav(`/w/${r.companyId}`); });
  const signOut = async () => { await signOutAndForget(qc); nav(`/signin?next=/invite/${token}`); };
  const d = q.data;
  // Straight after signing up or in from this page, the invitation is accepted without another click.
  // The mark is set by those buttons in this tab, never by the link itself, so a crafted link can't
  // make someone join a workspace on page load.
  const auto = useRef(false);
  const markGo = () => { try { sessionStorage.setItem(GO_KEY, token); } catch { /* storage off: they press Join */ } };
  useEffect(() => {
    if (!(d?.state === 'pending' && d.signedIn && d.emailMatches) || auto.current) return;
    let go = false;
    try { go = sessionStorage.getItem(GO_KEY) === token; sessionStorage.removeItem(GO_KEY); } catch { /* storage off */ }
    if (go) { auto.current = true; void accept.run(); }
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AuthLayout title={d?.companyName ? `Join ${d.companyName}` : 'Your invitation'}>
      {q.isLoading ? <Loading rows={2} /> : !d || d.state === 'invalid' ? (
        <Banner tone="error" title="This invitation link doesn’t work">Ask the person who invited you for a new one.</Banner>
      ) : (
        <div className="stack">
          <div className="row"><span className="ws-avatar" aria-hidden="true"><MailOpen size={18} /></span>
            <p>{d.state === 'pending' ? <>You’re invited as <strong>{d.roleName}</strong>, for {d.emailHint}. The link works until {fmtDate(d.expiresAt)}.</> : <>The invitation was for {d.roleName}.</>}</p>
          </div>
          {d.state === 'expired' && <Banner tone="attn" title="This invitation has expired">Ask for a new one.</Banner>}
          {d.state === 'revoked' && <Banner tone="attn" title="This invitation was taken back">Ask for a new one if you still need to join.</Banner>}
          {d.state === 'replaced' && <Banner tone="attn" title="A newer invitation replaced this one">Use the latest link you received.</Banner>}
          {d.state === 'accepted' && (d.companyId ? <LinkButton variant="primary" to={`/w/${d.companyId}`}>Open {d.companyName}</LinkButton> : <Banner tone="info">This invitation was already used.</Banner>)}
          {d.state === 'pending' && !d.signedIn && (
            <div className="stack-sm">
              <LinkButton variant="primary" size="lg" block onClick={markGo} to={`/signup?next=${encodeURIComponent(`/invite/${token}`)}`}>Create an account and join</LinkButton>
              <LinkButton block onClick={markGo} to={`/signin?next=${encodeURIComponent(`/invite/${token}`)}`}>I already have an account</LinkButton>
            </div>
          )}
          {d.state === 'pending' && d.signedIn && d.emailMatches === false && (
            <div className="stack-sm">
              <Banner tone="attn" title="You’re signed in with another email">This invitation is for {d.emailHint}. Sign in with that address to join.</Banner>
              <Button variant="primary" onClick={signOut}>Switch account</Button>
            </div>
          )}
          {d.state === 'pending' && d.signedIn && d.emailMatches && (
            <div className="stack-sm">
              <FormError error={accept.error} />
              <Button variant="primary" size="lg" block busy={accept.busy} onClick={() => void accept.run()}>Join {d.companyName}</Button>
            </div>
          )}
        </div>
      )}
    </AuthLayout>
  );
}
