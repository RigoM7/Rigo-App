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
      </main>
    </div>
  );
}

const withNext = (path: string, next: string | null) => (next ? `${path}?next=${encodeURIComponent(next)}` : path);

/** "Did you mean …@gmail.com?" under an email field. Never blocks. */
export function EmailSuggestion({ email, onUse }: { email: string; onUse: (fixed: string) => void }) {
  const fixed = suggestEmail(email);
  if (!fixed) return null;
  return (
    <div className="email-suggest" role="status">
      <span>Did you mean <strong className="wrap-anywhere">{fixed}</strong>?</span>
      <Button size="sm" onClick={() => onUse(fixed)}>Use {fixed.split('@')[1]}</Button>
    </div>
  );
}

/** Sign-in errors: a pause names the wait and offers recovery; the last tries before a pause are counted. */
function SignInProblem({ error }: { error: ApiError }) {
  if (error.code === 'rate_limited') {
    const text = error.message.replace(/,? or reset your password\.?$/, '');
    return <Banner tone="warning" title="Sign-in is paused">{text}, or <Link to="/forgot">reset your password</Link>.</Banner>;
  }
  const left = error.details?.remaining as number | undefined;
  return (
    <Banner tone="danger" title={error.message}>
      {left ? <>{left === 1 ? '1 more try' : `${left} more tries`} before a {error.details.pauseMinutes}-minute pause. <Link to="/forgot">Reset your password</Link> if you're not sure.</> : 'Check the email address and password, then try again.'}
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
  return (
    <AuthLayout title="Sign in">
      <form onSubmit={onSubmit} className="stack" noValidate>
        <ErrorSummary error={fieldErrors} />
        {s.error && !fieldErrors ? <SignInProblem error={s.error} /> : null}
        <Field label="Email" id="f-email" error={s.fieldError('email')}>{(p) => <Input {...p} type="email" autoComplete="email" maxLength={EMAIL_MAX} value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Password" id="f-password" error={s.fieldError('password')}>{(p) => <PasswordInput {...p} autoComplete="current-password" maxLength={PASSWORD_MAX} value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <Button type="submit" variant="primary" busy={s.busy} block size="lg">Sign in</Button>
        <Link to="/forgot" className="small link-target">Forgot your password?</Link>
      </form>
      <div className="auth-alt">
        <p className="small muted">New to Rigo?</p>
        <LinkButton to={withNext('/signup', next)} block size="lg">Create a free account</LinkButton>
      </div>
    </AuthLayout>
  );
}

function LegalNote() {
  const q = useQuery({ queryKey: ['legal'], queryFn: () => get<{ termsUrl: string | null; privacyUrl: string | null }>('/auth/legal'), staleTime: Infinity });
  const { termsUrl, privacyUrl } = q.data ?? {};
  if (!termsUrl && !privacyUrl) return null;
  return (
    <p className="small muted" style={{ margin: 0 }}>
      By creating an account you agree to the {termsUrl ? <a href={termsUrl} target="_blank" rel="noreferrer">Terms</a> : 'Terms'}
      {' and '}{privacyUrl ? <a href={privacyUrl} target="_blank" rel="noreferrer">Privacy Policy</a> : 'Privacy Policy'}.
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
  return (
    <AuthLayout title="Create your account" sub="It's free. Next you can try a sample company, set up your own, or join the one that invited you."
      foot={<>Already have an account? <Link to={withNext('/signin', next)}>Sign in</Link></>}>
      <form onSubmit={(e) => { e.preventDefault(); s.run(); }} className="stack" noValidate>
        <ErrorSummary error={s.error} />
        <Field label="Your name" id="f-name" error={s.fieldError('name')}>{(p) => <Input {...p} autoComplete="name" maxLength={NAME_MAX} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <div className="stack-sm">
          <Field label="Email" id="f-email" error={s.fieldError('email')} hint={invitedEmail ? `From your invitation to ${invite.data.companyName}.` : 'If a company invited you, use the address the invitation went to.'}>{(p) => <Input {...p} type="email" autoComplete="email" maxLength={EMAIL_MAX} value={v.email} readOnly={!!invitedEmail} onBlur={() => setEmailTouched(true)} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
          {emailTouched && !invitedEmail ? <EmailSuggestion email={v.email} onUse={(fixed) => setV({ ...v, email: fixed })} /> : null}
        </div>
        <Field label="Password" id="f-password" error={s.fieldError('password')} hint={PASSWORD_HINT}>{(p) => <PasswordInput {...p} autoComplete="new-password" maxLength={PASSWORD_MAX} value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />}</Field>
        <LegalNote />
        <Button type="submit" variant="primary" busy={s.busy} block size="lg">Create account</Button>
      </form>
    </AuthLayout>
  );
}

interface Recovery { methods: ('email' | 'mailbox' | 'owner_link')[]; supportEmail: string | null }

/** Recovery through an owner of the person's company, for when email can't help. */
function OwnerHelp({ supportEmail, heading }: { supportEmail: string | null; heading?: string }) {
  return (
    <div className="recovery-help">
      <span className="empty-icon" aria-hidden><Users /></span>
      <div className="stack-sm">
        {heading ? <h2 className="h3">{heading}</h2> : null}
        <p style={{ margin: 0 }}>Ask an owner of your company to create a reset link for you from Team. It works once and expires in 24 hours.</p>
        {supportEmail ? <p style={{ margin: 0 }}>If you're the only owner, email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p> : null}
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
  return (
    <AuthLayout title="Reset your password" sub={canEmail && !sent ? "Enter your account's email address and we'll send you a link to choose a new password." : undefined}>
      {q.isLoading ? <LoadingBlock rows={2} /> : q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : !canEmail || sent === 'unavailable' ? (
        <>
          <Banner tone="info" title="Reset emails aren't available yet">Rigo can't send email yet, so there's no reset link to send.</Banner>
          <OwnerHelp supportEmail={q.data?.supportEmail ?? null} />
        </>
      ) : sent ? (
        <>
          <Banner tone="success" title="Check your email">
            If an account uses {email.trim()}, we sent it a reset link. It works for one hour.
            {sent === 'mailbox' ? <> On this local copy, emails appear in the <Link to="/dev/mailbox">test inbox</Link>.</> : null}
          </Banner>
          <OwnerHelp supportEmail={q.data?.supportEmail ?? null} heading="No email?" />
        </>
      ) : (
        <>
          <form onSubmit={(e) => { e.preventDefault(); s.run(); }} className="stack" noValidate>
            <ErrorSummary error={s.error} />
            <Field label="Email" id="f-email" error={s.fieldError('email')}>{(p) => <Input {...p} type="email" autoComplete="email" maxLength={EMAIL_MAX} value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
            <Button type="submit" variant="primary" busy={s.busy} block size="lg">Send reset link</Button>
          </form>
          <OwnerHelp supportEmail={q.data?.supportEmail ?? null} heading="Can't get to your email?" />
        </>
      )}
      <Link to="/signin" className="small link-target">Back to sign in</Link>
    </AuthLayout>
  );
}

const LINK_TITLE = { used: 'This link was already used.', expired: 'This link has expired.', invalid: "This link doesn't work." } as const;

function ExpiredLink({ what, again, reason }: { what: string; again: { to: string; label: string }; reason?: keyof typeof LINK_TITLE }) {
  return (
    <>
      <Banner tone="warning" title={reason ? LINK_TITLE[reason] : 'This link has expired or was already used'}>{what}</Banner>
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
  const check = useQuery({ queryKey: ['reset-link', token], queryFn: () => get<{ valid: boolean; reason?: 'used' | 'expired' | 'invalid' }>(`/auth/reset/${encodeURIComponent(token)}`), staleTime: Infinity, retry: false });
  const s = useSubmit(async () => {
    try { await post('/auth/reset', { token, password }); } catch (e) {
      if ((e as ApiError).details?.invalidLink) setUsedUp(true);
      throw e;
    }
    await refreshMe(qc);
    toast("Password changed. You're signed in.");
    nav('/workspaces', { replace: true });
  });
  const invalid = usedUp || check.data?.valid === false;
  return (
    <AuthLayout title={invalid ? 'Link not valid' : 'Choose a new password'} sub={!invalid && check.data ? "You'll be signed in here. Other devices will need to sign in again." : undefined}>
      {check.isLoading ? <LoadingBlock rows={2} /> : check.error ? <ErrorState error={check.error} retry={() => check.refetch()} /> : invalid ? (
        <ExpiredLink reason={usedUp ? 'used' : check.data?.reason} what={check.data?.reason === 'invalid' && !usedUp ? 'Check that you copied the whole link. Reset links work once, and only for a limited time.' : 'Reset links work once, and only for a limited time.'} again={{ to: '/forgot', label: 'Send a new link' }} />
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); s.run(); }} className="stack" noValidate>
          <ErrorSummary error={s.error} />
          <Field label="New password" id="f-password" error={s.fieldError('password')} hint={PASSWORD_HINT}>{(p) => <PasswordInput {...p} autoComplete="new-password" maxLength={PASSWORD_MAX} value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <Button type="submit" variant="primary" busy={s.busy} block size="lg" icon={<KeyRound aria-hidden />}>Save password and sign in</Button>
        </form>
      )}
      <Link to="/signin" className="small link-target">Back to sign in</Link>
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
  const title = done ? (done === 'change' ? 'Email address changed' : 'Email confirmed') : invalid ? 'Link not valid' : change ? 'Use your new email address' : 'Confirm your email';
  return (
    <AuthLayout title={title}>
      {check.isLoading ? <LoadingBlock rows={2} /> : check.error ? <ErrorState error={check.error} retry={() => check.refetch()} /> : done ? (
        <>
          <Banner tone="success" title={done === 'change' ? 'Your account now uses this email address.' : 'Thanks, your email address is confirmed.'}>
            {done === 'change' ? 'Sign in with it from now on. Other devices were signed out.' : 'You can now recover your account by email if you forget your password.'}
          </Banner>
          <LinkButton variant="primary" block size="lg" to={signedIn ? '/workspaces' : '/signin'}>{signedIn ? 'Go to my workspaces' : 'Sign in'}</LinkButton>
        </>
      ) : invalid ? (
        <ExpiredLink what="Email links work once, and only for a limited time. You can send a new one from your account." again={{ to: signedIn ? '/account' : '/signin?next=/account', label: 'Send a new link' }} />
      ) : (
        <div className="stack">
          <p style={{ margin: 0 }}>{change ? 'Your account will switch to the address this link was sent to. Sign in with it from now on.' : 'Confirming your email lets you recover your account if you forget your password.'}</p>
          <ErrorSummary error={s.error} />
          <Button variant="primary" block size="lg" busy={s.busy} icon={<MailCheck aria-hidden />} onClick={() => s.run()}>{change ? 'Use this email address' : 'Confirm email'}</Button>
        </div>
      )}
    </AuthLayout>
  );
}
