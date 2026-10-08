import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, KeyRound, MailCheck, Users } from 'lucide-react';
import { get, post, type ApiError } from '../lib/api';
import { useSubmit } from '../lib/form';
import { refreshMe, safeNext, useMe } from '../lib/session';
import { useTitle } from '../lib/title';
import { Button, TextField, FormError, Banner, Wordmark, LinkButton, Loading, ErrorState, useToast } from '../components/ui';
import { PASSWORD_HINT, PASSWORD_MAX } from '../../shared/password';
import { EMAIL_MAX, suggestEmail } from '../../shared/email';

// Accounts and sign-in, kept from the earlier app and rebuilt under the new look: lockout messages
// that name the wait, email typo suggestions, recovery without email, single-use links.

export const NAME_MAX = 80;

function AuthLayout({ title, sub, children, foot }: { title: string; sub?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  useTitle(title);
  return (
    <div className="public">
      <header className="public-top"><Wordmark /></header>
      <main className="auth-wrap" id="main">
        <div className="auth-card">
          <div className="card card-lg stack">
            <div className="stack-sm"><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
            {children}
          </div>
          {foot && <p className="muted" style={{ textAlign: 'center' }}>{foot}</p>}
        </div>
      </main>
      <footer className="footer">Rigo · one place to run your business</footer>
    </div>
  );
}

const withNext = (path: string, next: string | null) => (next ? `${path}?next=${encodeURIComponent(next)}` : path);

function PasswordField({ label, value, onChange, error, hint, autoComplete }: { label: string; value: string; onChange: (v: string) => void; error?: string | null; hint?: string; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="stack-sm">
      <TextField label={label} type={show ? 'text' : 'password'} autoComplete={autoComplete} maxLength={PASSWORD_MAX} value={value} onChange={(e) => onChange(e.target.value)} error={error} hint={hint} />
      <button type="button" className="link-btn small" style={{ justifySelf: 'start' }} onClick={() => setShow((s) => !s)} aria-pressed={show}>
        {show ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />} {show ? 'Hide password' : 'Show password'}
      </button>
    </div>
  );
}

/** "Did you mean …@gmail.com?" under an email field. Never blocks. */
function EmailSuggestion({ email, onUse }: { email: string; onUse: (fixed: string) => void }) {
  const fixed = suggestEmail(email);
  if (!fixed) return null;
  return (
    <div className="banner" role="status">
      <div className="grow small">Did you mean <strong className="wrap-anywhere">{fixed}</strong>?</div>
      <Button size="sm" onClick={() => onUse(fixed)}>Use {fixed.split('@')[1]}</Button>
    </div>
  );
}

/** A pause names the wait and offers recovery; the last tries before a pause are counted. */
function SignInProblem({ error }: { error: ApiError }) {
  if (error.code === 'rate_limited') return <Banner tone="attn" title="Sign-in is paused for a moment">{error.message.replace(/,? or reset your password\.?$/, '.')} <Link to="/forgot">Or reset your password.</Link></Banner>;
  const left = error.details?.remaining as number | undefined;
  return (
    <Banner tone="error" title={error.message}>
      {left ? <>{left} {left === 1 ? 'try' : 'tries'} left before sign-in pauses for {error.details.pauseMinutes} minutes. <Link to="/forgot">Reset your password</Link> if you're not sure.</> : 'Check both and try again.'}
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
  const hasFields = s.error && Object.keys(s.error.fields).length > 0;
  return (
    <AuthLayout title="Sign in" foot={<>New to Rigo? <Link to={withNext('/signup', next)}>Create a free workspace</Link></>}>
      <form onSubmit={(e) => { e.preventDefault(); void s.run(); }} className="stack" noValidate>
        {hasFields ? <FormError error={s.error} /> : s.error ? <SignInProblem error={s.error} /> : null}
        <TextField label="Email" type="email" autoComplete="email" maxLength={EMAIL_MAX} value={email} onChange={(e) => setEmail(e.target.value)} error={s.fieldError('email')} />
        <PasswordField label="Password" autoComplete="current-password" value={password} onChange={setPassword} error={s.fieldError('password')} />
        <Button type="submit" variant="primary" busy={s.busy} block size="lg">Sign in</Button>
        <Link to="/forgot">Forgot your password?</Link>
      </form>
    </AuthLayout>
  );
}

function LegalNote() {
  const q = useQuery({ queryKey: ['legal'], queryFn: () => get<{ termsUrl: string | null; privacyUrl: string | null }>('/auth/legal'), staleTime: Infinity });
  const { termsUrl, privacyUrl } = q.data ?? {};
  if (!termsUrl && !privacyUrl) return null;
  return (
    <p className="small muted">
      By creating an account you agree to the {termsUrl ? <a href={termsUrl} target="_blank" rel="noreferrer">terms of service</a> : 'terms of service'} and
      the {privacyUrl ? <a href={privacyUrl} target="_blank" rel="noreferrer">privacy policy</a> : 'privacy policy'}.
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
  // Signing up from an invitation: the invited address is filled in, and the invitation accepted next.
  const inviteToken = /^\/invite\/([A-Za-z0-9_-]+)/.exec(next ?? '')?.[1] ?? null;
  const invite = useQuery({ queryKey: ['invite', inviteToken], queryFn: () => get<any>(`/invitations/${inviteToken}`), enabled: !!inviteToken });
  const invitedEmail: string | null = invite.data?.email ?? null;
  useEffect(() => { if (invitedEmail) setV((x) => ({ ...x, email: invitedEmail })); }, [invitedEmail]);
  const s = useSubmit(async () => { await post('/auth/signup', v); await refreshMe(qc); nav(next ? safeNext(next) : '/start', { replace: true }); });
  return (
    <AuthLayout title="Create your free account" sub={inviteToken ? 'Then you can join the workspace you were invited to.' : 'Next, you’ll name your workspace and pick how it works.'}
      foot={<>Already have an account? <Link to={withNext('/signin', next)}>Sign in</Link></>}>
      <form onSubmit={(e) => { e.preventDefault(); void s.run(); }} className="stack" noValidate>
        <FormError error={s.error} />
        <TextField label="Your name" autoComplete="name" maxLength={NAME_MAX} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={s.fieldError('name')} />
        <div className="stack-sm">
          <TextField label="Email" type="email" autoComplete="email" maxLength={EMAIL_MAX} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })}
            onBlur={() => setEmailTouched(true)} error={s.fieldError('email')} readOnly={!!invitedEmail}
            hint={invitedEmail ? `The address ${invite.data.companyName} invited.` : 'If someone invited you, use the address they used.'} />
          {emailTouched && !invitedEmail && <EmailSuggestion email={v.email} onUse={(fixed) => setV({ ...v, email: fixed })} />}
        </div>
        <PasswordField label="Password" autoComplete="new-password" value={v.password} onChange={(p) => setV({ ...v, password: p })} error={s.fieldError('password')} hint={PASSWORD_HINT} />
        <LegalNote />
        <Button type="submit" variant="primary" busy={s.busy} block size="lg">Create account</Button>
      </form>
    </AuthLayout>
  );
}

interface Recovery { methods: ('email' | 'mailbox' | 'owner_link')[]; supportEmail: string | null }

/** Recovery through an owner, for when email can't help. */
function OwnerHelp({ supportEmail, heading }: { supportEmail: string | null; heading?: string }) {
  return (
    <div className="card soft row" style={{ alignItems: 'flex-start' }}>
      <span className="empty-icon" style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--primary-soft)', color: 'var(--primary-text)' }} aria-hidden="true"><Users size={20} /></span>
      <div className="stack-sm grow">
        {heading && <h2 style={{ fontSize: '1.0625rem' }}>{heading}</h2>}
        <p>An owner of your workspace can make you a one-time reset link from Settings, People.</p>
        {supportEmail && <p>If you are the only owner, write to <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p>}
      </div>
    </div>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<null | 'email' | 'mailbox' | 'unavailable'>(null);
  const q = useQuery({ queryKey: ['recovery'], queryFn: () => get<Recovery>('/auth/recovery'), staleTime: 60_000 });
  const s = useSubmit(async () => { const r = await post<{ channel: 'email' | 'mailbox' | 'unavailable' }>('/auth/forgot', { email }); setSent(r.channel); });
  const canEmail = q.data && (q.data.methods.includes('email') || q.data.methods.includes('mailbox'));
  return (
    <AuthLayout title="Reset your password" sub={canEmail && !sent ? 'We’ll email you a link that works once, for one hour.' : undefined}>
      {q.isLoading ? <Loading rows={2} /> : q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : !canEmail || sent === 'unavailable' ? (
        <>
          <Banner tone="info" title="Reset emails aren’t set up here yet">So Rigo can’t email you a link.</Banner>
          <OwnerHelp supportEmail={q.data?.supportEmail ?? null} />
        </>
      ) : sent ? (
        <>
          <Banner tone="info" title="Check your email">If {email.trim()} has an account, a reset link is on its way. {sent === 'mailbox' && <Link to="/dev/mailbox">Open the test inbox.</Link>}</Banner>
          <OwnerHelp supportEmail={q.data?.supportEmail ?? null} heading="No email after a few minutes?" />
        </>
      ) : (
        <>
          <form onSubmit={(e) => { e.preventDefault(); void s.run(); }} className="stack" noValidate>
            <FormError error={s.error} />
            <TextField label="Email" type="email" autoComplete="email" maxLength={EMAIL_MAX} value={email} onChange={(e) => setEmail(e.target.value)} error={s.fieldError('email')} />
            <Button type="submit" variant="primary" busy={s.busy} block size="lg">Send reset link</Button>
          </form>
          <OwnerHelp supportEmail={q.data?.supportEmail ?? null} heading="Can’t get email?" />
        </>
      )}
      <Link to="/signin">Back to sign in</Link>
    </AuthLayout>
  );
}

const LINK_TITLE = { used: 'This link was already used', expired: 'This link has expired', invalid: 'This link doesn’t work' } as const;

function ExpiredLink({ what, again, reason }: { what: string; again: { to: string; label: string }; reason?: keyof typeof LINK_TITLE }) {
  return (
    <>
      <Banner tone="attn" title={reason ? LINK_TITLE[reason] : 'This link has expired or was already used'}>{what}</Banner>
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
    try { await post('/auth/reset', { token, password }); } catch (e) { if ((e as ApiError).details?.invalidLink) setUsedUp(true); throw e; }
    await refreshMe(qc);
    toast('Password changed. You’re signed in.');
    nav('/home', { replace: true });
  });
  const invalid = usedUp || check.data?.valid === false;
  return (
    <AuthLayout title={invalid ? 'This link can’t be used' : 'Choose a new password'} sub={!invalid && check.data ? 'You’ll be signed in here, and signed out everywhere else.' : undefined}>
      {check.isLoading ? <Loading rows={2} /> : check.error ? <ErrorState error={check.error} retry={() => check.refetch()} /> : invalid ? (
        <ExpiredLink reason={usedUp ? 'used' : check.data?.reason} what={check.data?.reason === 'invalid' && !usedUp ? 'Copy the whole link from the message, or ask for a new one.' : 'Reset links work once and expire. Ask for a new one.'} again={{ to: '/forgot', label: 'Send a new link' }} />
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void s.run(); }} className="stack" noValidate>
          <FormError error={s.error} />
          <PasswordField label="New password" autoComplete="new-password" value={password} onChange={setPassword} error={s.fieldError('password')} hint={PASSWORD_HINT} />
          <Button type="submit" variant="primary" busy={s.busy} block size="lg" icon={<KeyRound aria-hidden="true" />}>Save password</Button>
        </form>
      )}
      <Link to="/signin">Back to sign in</Link>
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
    try { const r = await post<{ purpose: 'verify' | 'change' }>(`/auth/email-token/${encodeURIComponent(token)}`); setDone(r.purpose); } catch (e) { if ((e as ApiError).details?.invalidLink) setUsedUp(true); throw e; }
    await refreshMe(qc);
  });
  const signedIn = !!me.data?.user;
  const change = check.data?.purpose === 'change';
  const invalid = usedUp || check.data?.valid === false;
  const title = done ? (done === 'change' ? 'Email changed' : 'Email confirmed') : invalid ? 'This link can’t be used' : change ? 'Use your new email' : 'Confirm your email';
  return (
    <AuthLayout title={title}>
      {check.isLoading ? <Loading rows={2} /> : check.error ? <ErrorState error={check.error} retry={() => check.refetch()} /> : done ? (
        <>
          <Banner tone="info" title={done === 'change' ? 'Your account uses the new address now' : 'Thanks, your address is confirmed'}>
            {done === 'change' ? 'Sign in with it from now on.' : 'You can recover your account by email if you forget your password.'}
          </Banner>
          <LinkButton variant="primary" block size="lg" to={signedIn ? '/home' : '/signin'}>{signedIn ? 'Go to your workspace' : 'Sign in'}</LinkButton>
        </>
      ) : invalid ? (
        <ExpiredLink what="Email links work once and expire. Send a new one from your account." again={{ to: signedIn ? '/account' : '/signin?next=/account', label: 'Send a new link' }} />
      ) : (
        <div className="stack">
          <p>{change ? 'Your account will switch to this address.' : 'Confirming lets you recover your account by email.'}</p>
          <FormError error={s.error} />
          <Button variant="primary" block size="lg" busy={s.busy} icon={<MailCheck aria-hidden="true" />} onClick={() => void s.run()}>{change ? 'Use this email' : 'Confirm my email'}</Button>
        </div>
      )}
    </AuthLayout>
  );
}

export { AuthLayout };
