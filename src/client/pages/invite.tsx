import { useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MailOpen } from 'lucide-react';
import { get, post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Banner, LoadingBlock, ErrorSummary, LinkButton, Wordmark } from '../components/ui';
import { fmtDate } from '../lib/format';
import { refreshMe, signOutAndForget } from '../lib/session';
import { useDocumentTitle } from '../lib/title';
import { useT, LanguageSwitch } from '../lib/i18n';

const GO_KEY = 'rigo-invite-accept';

export function InvitePage() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['invite', token], queryFn: () => get(`/invitations/${token}`) });
  const accept = useSubmit(async () => { const r = await post(`/invitations/${token}/accept`); await refreshMe(qc); nav(`/c/${r.companyId}`); });
  const signOut = async () => { await signOutAndForget(qc); nav(`/signin?next=/invite/${token}`); };
  const d = q.data;
  const t = useT();
  useDocumentTitle(d?.companyName ? t('invite.title', { company: d.companyName }) : t('invite.docTitle'));
  // Straight after signing up or in from this page, the invitation is accepted without another click
  // (R4-m6). The mark is set by those buttons in this tab, never by the link itself, so a crafted
  // link can't make someone join a company on page load (security review).
  const auto = useRef(false);
  const markGo = () => { try { sessionStorage.setItem(GO_KEY, token); } catch { /* storage off: they press Accept */ } };
  useEffect(() => {
    if (!(d?.state === 'pending' && d.signedIn && d.emailMatches) || auto.current) return;
    let go = false;
    try { go = sessionStorage.getItem(GO_KEY) === token; sessionStorage.removeItem(GO_KEY); } catch { /* storage off */ }
    if (go) { auto.current = true; void accept.run(); }
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="auth-wrap">
      <main className="auth-card" id="main">
        <Wordmark to="/" />
        <div className="auth-panel stack">
          {q.isLoading ? <LoadingBlock /> : !d || d.state === 'invalid' ? (
            <Banner tone="danger" title={t('invite.notValid')}>{t('invite.notValidBody')}</Banner>
          ) : (
            <>
              <span className="empty-icon" aria-hidden><MailOpen /></span>
              <h1>{t('invite.title', { company: d.companyName })}</h1>
              <p style={{ margin: 0 }}>{d.state === 'pending' ? t('invite.asRoleExpires', { role: d.roleName, email: d.emailHint, date: fmtDate(d.expiresAt, undefined, t.locale) }) : t('invite.asRole', { role: d.roleName, email: d.emailHint })}</p>
              {d.state === 'expired' && <Banner tone="warning" title={t('invite.expired')}>{t('invite.expiredBody')}</Banner>}
              {d.state === 'revoked' && <Banner tone="warning" title={t('invite.revoked')}>{t('invite.revokedBody')}</Banner>}
              {d.state === 'replaced' && <Banner tone="warning" title={t('invite.replaced')}>{t('invite.replacedBody')}</Banner>}
              {d.state === 'accepted' && (d.companyId ? <LinkButton variant="primary" to={`/c/${d.companyId}`}>{t('invite.open', { company: d.companyName })}</LinkButton> : <Banner tone="info">{t('invite.used')}</Banner>)}
              {d.state === 'pending' && !d.signedIn && (
                <div className="stack-sm">
                  <p className="muted">{t('invite.signInOrCreate')}</p>
                  <LinkButton variant="primary" onClick={markGo} to={`/signup?next=${encodeURIComponent(`/invite/${token}`)}`}>{t('invite.create')}</LinkButton>
                  <LinkButton onClick={markGo} to={`/signin?next=${encodeURIComponent(`/invite/${token}`)}`}>{t('invite.haveAccount')}</LinkButton>
                </div>
              )}
              {d.state === 'pending' && d.signedIn && d.emailMatches === false && (
                <div className="stack-sm">
                  <Banner tone="warning" title={t('invite.otherEmail')}>{t('invite.otherEmailBody', { email: d.emailHint })}</Banner>
                  <Button variant="primary" onClick={signOut}>{t('invite.switch')}</Button>
                </div>
              )}
              {d.state === 'pending' && d.signedIn && d.emailMatches && (
                <div className="stack-sm">
                  <ErrorSummary error={accept.error} />
                  <Button variant="primary" size="lg" busy={accept.busy} onClick={() => accept.run()}>{t('invite.accept')}</Button>
                </div>
              )}
            </>
          )}
        </div>
        <LanguageSwitch />
      </main>
    </div>
  );
}
