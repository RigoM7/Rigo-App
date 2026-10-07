import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, MailCheck, Users } from 'lucide-react';
import { get, post, type ApiError } from '../lib/api';
import { useSubmit } from '../lib/form';
import { refreshMe, safeNext, useMe } from '../lib/session';
import { useDocumentTitle } from '../lib/title';
import { Button, Field, Input, PasswordInput, ErrorSummary, Banner, Wordmark, LinkButton, LoadingBlock, ErrorState, useToast } from '../components/ui';
import { PASSWORD_HINT, PASSWORD_MAX } from '../../shared/password';
import { EMAIL_MAX, suggestEmail } from '../../shared/email';
import { useT, LanguageSwitch } from '../lib/i18n';

export const NAME_MAX = 80;

function AuthLayout({ title, sub, children, foot }: { title: string; sub?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  useDocumentTitle(title);
  return (
    <div className="auth-wrap">
      <main className="auth-card" id="main">
        <Wordmark to="/" />
        <div className="auth-panel stack">
          <div><h1>{title}</h1>{sub ? <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>{sub}</p> : null}</div>
          {children}
        </div>
        {foot ? <div className="auth-foot">{foot}</div> : null}
        <LanguageSwitch />
      </main>
    </div>
  );
}

const withNext = (path: string, next: string | null) => (next ? `${path}?next=${encodeURIComponent(next)}` : path);

/** "Did you mean …@gmail.com?" under an email field. Never blocks. */
export function EmailSuggestion({ email, onUse }: { email: string; onUse: (fixed: string) => void }) {
  const fixed = suggestEmail(email);
  const t = useT();
  if (!fixed) return null;
  const [before, after] = t('auth.didYouMean', { email: '\u0000' }).split('\u0000');
  return (
    <div className="email-suggest" role="status">
      <span>{before}<strong className="wrap-anywhere">{fixed}</strong>{after}</span>
      <Button size="sm" onClick={() => onUse(fixed)}>{t('auth.use', { domain: fixed.split('@')[1] })}</Button>
    </div>
  );
}

/** Sign-in errors: a pause names the wait and offers recovery; the last tries before a pause are counted. */
function SignInProblem({ error }: { error: ApiError }) {
  const t = useT();
  if (error.code === 'rate_limited') {
    const text = t.phrase(error.message.replace(/,? or reset your password\.?$/, '.')).replace(/\.$/, '');
    return <Banner tone="warning" title={t('auth.paused')}>{text}, <Link to="/forgot">{t('auth.orReset')}</Link>.</Banner>;
  }
  const left = error.details?.remaining as number | undefined;
  return (
    <Banner tone="danger" title={t.phrase(error.message)}>
      {left ? <>{t.plural('auth.triesLeft', left, { m: error.details.pauseMinutes })} <Link to="/forgot">{t('auth.resetIfUnsure')}</Link></> : t('auth.checkAndRetry')}
    </Banner>
  );
}

export function SignIn() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const next = sp.get('next');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const s = useSubmit(async () => { await post('/auth/signin', { email, password }); await refreshMe(qc); nav(safeNext(next), { replace: true }); });
  const onSubmit = (e: FormEvent) => { e.preventDefault(); s.run(); };
  const fieldErrors = s.error && Object.keys(s.error.fields).length ? s.error : null;
  const t = useT();
  return (
    <AuthLayout title={t('auth.signIn')}>
      <form onSubmit={onSubmit} className="stack" noValidate>
        <ErrorSummary error={fieldErrors} />
        {s.error && !fieldErrors ? <SignInProblem error={s.error} /> : null}
        <Field label={t('auth.email')} id="f-email" error={t.phrase(s.fieldError('email'))}>{(p) => <Input {...p} type="email" autoComplete="email" maxLength={EMAIL_MAX} value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label={t('auth.password')} id="f-password" error={t.phrase(s.fieldError('password'))}>{(p) => <PasswordInput {...p} autoComplete="current-password" maxLength={PASSWORD_MAX} value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <Button type="submit" variant="primary" busy={s.busy} block size="lg">{t('auth.signIn')}</Button>
        <Link to="/forgot" className="small link-target">{t('auth.forgot')}</Link>
      </form>
      <div className="auth-alt">
        <p className="small muted">{t('auth.newToRigo')}</p>
        <LinkButton to={withNext('/signup', next)} block size="lg">{t('auth.createFree')}</LinkButton>
      </div>
    </AuthLayout>
  );
}

function LegalNote() {
  const q = useQuery({ queryKey: ['legal'], queryFn: () => get<{ termsUrl: string | null; privacyUrl: string | null }>('/auth/legal'), staleTime: Infinity });
  const { termsUrl, privacyUrl } = q.data ?? {};
  const t = useT();
  if (!termsUrl && !privacyUrl) return null;
  const parts = t('auth.agree', { terms: '\u0000', privacy: '\u0001' }).split(/[\u0000\u0001]/);
  return (
    <p className="small muted" style={{ margin: 0 }}>
      {parts[0]}{termsUrl ? <a href={termsUrl} target="_blank" rel="noreferrer">{t('auth.terms')}</a> : t('auth.terms')}
      {parts[1]}{privacyUrl ? <a href={privacyUrl} target="_blank" rel="noreferrer">{t('auth.privacy')}</a> : t('auth.privacy')}{parts[2]}
    </p>
  );
}

export function SignUp() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const next = sp.get('next');
  const [v, setV] = useState({ name: '', email: '', password: '' });
  const [emailTouched, setEmailTouched] = useState(false);
  // Signing up from an invitation: the invited address is filled in and fixed, and the invitation is
  // accepted right after (R4-m6).
  const inviteToken = /^\/invite\/([A-Za-z0-9_-]+)/.exec(next ?? '')?.[1] ?? null;
  const invite = useQuery({ queryKey: ['invite', inviteToken], queryFn: () => get<any>(`/invitations/${inviteToken}`), enabled: !!inviteToken });
  const invitedEmail: string | null = invite.data?.email ?? null;
  useEffect(() => { if (invitedEmail) setV((x) => ({ ...x, email: invitedEmail })); }, [invitedEmail]);
  const s = useSubmit(async () => { await post('/auth/signup', v); await refreshMe(qc); nav(safeNext(next), { replace: true }); });
  const t = useT();
  return (
    <AuthLayout title={t('auth.createTitle')} sub={t('auth.createSub')}
      foot={<>{t('auth.haveAccount')} <Link to={withNext('/signin', next)}>{t('auth.signIn')}</Link></>}>
      <form onSubmit={(e) => { e.preventDefault(); s.run(); }} className="stack" noValidate>
        <ErrorSummary error={s.error} />
        <Field label={t('auth.yourName')} id="f-name" error={t.phrase(s.fieldError('name'))}>{(p) => <Input {...p} autoComplete="name" maxLength={NAME_MAX} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <div className="stack-sm">
          <Field label={t('auth.email')} id="f-email" error={t.phrase(s.fieldError('email'))} hint={invitedEmail ? t('auth.fromInvite', { company: invite.data.companyName }) : t('auth.inviteHint')}>{(p) => <Input {...p} type="email" autoComplete="email" maxLength={EMAIL_MAX} value={v.email} readOnly={!!invitedEmail} onBlur={() => setEmailTouched(true)} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
          {emailTouched && !invitedEmail ? <EmailSuggestion email={v.email} onUse={(fixed) => setV({ ...v, email: fixed })} /> : null}
        </div>
        <Field label={t('auth.password')} id="f-password" error={t.phrase(s.fieldError('password'))} hint={t.lang === 'en' ? PASSWORD_HINT : t('auth.passwordHint')}>{(p) => <PasswordInput {...p} autoComplete="new-password" maxLength={PASSWORD_MAX} value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />}</Field>
        <LegalNote />
        <Button type="submit" variant="primary" busy={s.busy} block size="lg">{t('auth.createAccount')}</Button>
      </form>
    </AuthLayout>
  );
}

interface Recovery { methods: ('email' | 'mailbox' | 'owner_link')[]; supportEmail: string | null }

/** Recovery through an owner of the person's company, for when email can't help. */
function OwnerHelp({ supportEmail, heading }: { supportEmail: string | null; heading?: string }) {
  const t = useT();
  const [pre, post] = t('auth.onlyOwner', { email: '\u0000' }).split('\u0000');
  return (
    <div className="recovery-help">
      <span className="empty-icon" aria-hidden><Users /></span>
      <div className="stack-sm">
        {heading ? <h2 className="h3">{heading}</h2> : null}
        <p style={{ margin: 0 }}>{t('auth.ownerHelp')}</p>
        {supportEmail ? <p style={{ margin: 0 }}>{pre}<a href={`mailto:${supportEmail}`}>{supportEmail}</a>{post}</p> : null}
      </div>
    </div>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<null | 'email' | 'mailbox' | 'unavailable'>(null);
  const q = useQuery({ queryKey: ['recovery'], queryFn: () => get<Recovery>('/auth/recovery'), staleTime: 60_000 });
  const s = useSubmit(async () => { const r = await post('/auth/forgot', { email }); setSent(r.channel); });
  const canEmail = q.data && (q.data.methods.includes('email') || q.data.methods.includes('mailbox'));
  const t = useT();
  return (
    <AuthLayout title={t('auth.resetTitle')} sub={canEmail && !sent ? t('auth.resetSub') : undefined}>
      {q.isLoading ? <LoadingBlock rows={2} /> : q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : !canEmail || sent === 'unavailable' ? (
        <>
          <Banner tone="info" title={t('auth.noResetEmails')}>{t('auth.noResetEmailsBody')}</Banner>
          <OwnerHelp supportEmail={q.data?.supportEmail ?? null} />
        </>
      ) : sent ? (
        <>
          <Banner tone="success" title={t('auth.checkEmail')}>
            {t('auth.sentIfAccount', { email: email.trim() })}
            {sent === 'mailbox' ? <> <Link to="/dev/mailbox">{t('auth.testInbox')}</Link></> : null}
          </Banner>
          <OwnerHelp supportEmail={q.data?.supportEmail ?? null} heading={t('auth.noEmail')} />
        </>
      ) : (
        <>
          <form onSubmit={(e) => { e.preventDefault(); s.run(); }} className="stack" noValidate>
            <ErrorSummary error={s.error} />
            <Field label={t('auth.email')} id="f-email" error={t.phrase(s.fieldError('email'))}>{(p) => <Input {...p} type="email" autoComplete="email" maxLength={EMAIL_MAX} value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
            <Button type="submit" variant="primary" busy={s.busy} block size="lg">{t('auth.sendReset')}</Button>
          </form>
          <OwnerHelp supportEmail={q.data?.supportEmail ?? null} heading={t('auth.cantGetEmail')} />
        </>
      )}
      <Link to="/signin" className="small link-target">{t('auth.backToSignIn')}</Link>
    </AuthLayout>
  );
}

const LINK_TITLE = { used: 'auth.link.used', expired: 'auth.link.expired', invalid: 'auth.link.invalid' } as const;

function ExpiredLink({ what, again, reason }: { what: string; again: { to: string; label: string }; reason?: keyof typeof LINK_TITLE }) {
  const t = useT();
  return (
    <>
      <Banner tone="warning" title={reason ? t(LINK_TITLE[reason]) : t('auth.link.either')}>{what}</Banner>
      <LinkButton variant="primary" block size="lg" to={again.to}>{again.label}</LinkButton>
    </>
  );
}

export function Reset() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [usedUp, setUsedUp] = useState(false);
  const t = useT();
  const check = useQuery({ queryKey: ['reset-link', token], queryFn: () => get<{ valid: boolean; reason?: 'used' | 'expired' | 'invalid' }>(`/auth/reset/${encodeURIComponent(token)}`), staleTime: Infinity, retry: false });
  const s = useSubmit(async () => {
    try { await post('/auth/reset', { token, password }); } catch (e) {
      if ((e as ApiError).details?.invalidLink) setUsedUp(true);
      throw e;
    }
    await refreshMe(qc);
    toast(t('auth.passwordChanged'));
    nav('/workspaces', { replace: true });
  });
  const invalid = usedUp || check.data?.valid === false;
  return (
    <AuthLayout title={invalid ? t('auth.linkNotValid') : t('auth.chooseNew')} sub={!invalid && check.data ? t('auth.signedInHere') : undefined}>
      {check.isLoading ? <LoadingBlock rows={2} /> : check.error ? <ErrorState error={check.error} retry={() => check.refetch()} /> : invalid ? (
        <ExpiredLink reason={usedUp ? 'used' : check.data?.reason} what={check.data?.reason === 'invalid' && !usedUp ? t('auth.copyWhole') : t('auth.resetOnce')} again={{ to: '/forgot', label: t('auth.sendNewLink') }} />
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); s.run(); }} className="stack" noValidate>
          <ErrorSummary error={s.error} />
          <Field label={t('auth.newPassword')} id="f-password" error={t.phrase(s.fieldError('password'))} hint={t.lang === 'en' ? PASSWORD_HINT : t('auth.passwordHint')}>{(p) => <PasswordInput {...p} autoComplete="new-password" maxLength={PASSWORD_MAX} value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <Button type="submit" variant="primary" busy={s.busy} block size="lg" icon={<KeyRound aria-hidden />}>{t('auth.savePassword')}</Button>
        </form>
      )}
      <Link to="/signin" className="small link-target">{t('auth.backToSignIn')}</Link>
    </AuthLayout>
  );
}

/** Opens links that confirm an email address or switch an account to a new one. */
export function ConfirmEmail() {
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const me = useMe();
  const [done, setDone] = useState<null | 'verify' | 'change'>(null);
  const [usedUp, setUsedUp] = useState(false);
  const t = useT();
  const check = useQuery({ queryKey: ['email-link', token], queryFn: () => get<{ valid: boolean; purpose?: 'verify' | 'change' }>(`/auth/email-token/${encodeURIComponent(token)}`), staleTime: Infinity, retry: false });
  const s = useSubmit(async () => {
    try { const r = await post(`/auth/email-token/${encodeURIComponent(token)}`); setDone(r.purpose); } catch (e) {
      if ((e as ApiError).details?.invalidLink) setUsedUp(true);
      throw e;
    }
    await refreshMe(qc);
  });
  const signedIn = !!me.data?.user;
  const change = check.data?.purpose === 'change';
  const invalid = usedUp || check.data?.valid === false;
  const title = done ? (done === 'change' ? t('auth.emailChanged') : t('auth.emailConfirmed')) : invalid ? t('auth.linkNotValid') : change ? t('auth.useNewEmail') : t('auth.confirmEmail');
  return (
    <AuthLayout title={title}>
      {check.isLoading ? <LoadingBlock rows={2} /> : check.error ? <ErrorState error={check.error} retry={() => check.refetch()} /> : done ? (
        <>
          <Banner tone="success" title={done === 'change' ? t('auth.nowUses') : t('auth.thanksConfirmed')}>
            {done === 'change' ? t('auth.signInWithIt') : t('auth.canRecover')}
          </Banner>
          <LinkButton variant="primary" block size="lg" to={signedIn ? '/workspaces' : '/signin'}>{signedIn ? t('auth.goWorkspaces') : t('auth.signIn')}</LinkButton>
        </>
      ) : invalid ? (
        <ExpiredLink what={t('auth.emailLinksOnce')} again={{ to: signedIn ? '/account' : '/signin?next=/account', label: t('auth.sendNewLink') }} />
      ) : (
        <div className="stack">
          <p style={{ margin: 0 }}>{change ? t('auth.willSwitch') : t('auth.confirmingLets')}</p>
          <ErrorSummary error={s.error} />
          <Button variant="primary" block size="lg" busy={s.busy} icon={<MailCheck aria-hidden />} onClick={() => s.run()}>{change ? t('auth.useThisEmail') : t('auth.confirmButton')}</Button>
        </div>
      )}
    </AuthLayout>
  );
}
