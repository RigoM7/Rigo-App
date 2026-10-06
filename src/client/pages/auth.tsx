import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Field, Input, PasswordInput, ErrorSummary, Banner, Wordmark } from '../components/ui';

function AuthLayout({ title, sub, children, foot }: { title: string; sub?: React.ReactNode; children: React.ReactNode; foot?: React.ReactNode }) {
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

function safeNext(n: string | null) { return n && n.startsWith('/') && !n.startsWith('//') ? n : '/workspaces'; }

export function SignIn() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const s = useSubmit(async () => { await post('/auth/signin', { email, password }); await qc.invalidateQueries({ queryKey: ['me'] }); nav(safeNext(sp.get('next'))); });
  const onSubmit = (e: FormEvent) => { e.preventDefault(); s.run(); };
  return (
    <AuthLayout title="Sign in" sub="Field-service operations, with Rigo doing the routine work."
      foot={<>New to Rigo? <Link to={`/signup${sp.get('next') ? `?next=${encodeURIComponent(sp.get('next')!)}` : ''}`}>Create a free account</Link> to explore the demo or set up your company.</>}>
      <form onSubmit={onSubmit} className="stack" noValidate>
        <ErrorSummary error={s.error && Object.keys(s.error.fields).length ? s.error : null} />
        {s.error && !Object.keys(s.error.fields).length ? <Banner tone="danger">{s.error.message}</Banner> : null}
        <Field label="Email" id="f-email" error={s.fieldError('email')}>{(p) => <Input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Password" id="f-password" error={s.fieldError('password')}>{(p) => <PasswordInput {...p} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <Button type="submit" variant="primary" busy={s.busy} block size="lg">Sign in</Button>
        <Link to="/forgot" className="small">Forgot your password?</Link>
      </form>
    </AuthLayout>
  );
}

export function SignUp() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [v, setV] = useState({ name: '', email: '', password: '' });
  const s = useSubmit(async () => { await post('/auth/signup', v); await qc.invalidateQueries({ queryKey: ['me'] }); nav(safeNext(sp.get('next'))); });
  return (
    <AuthLayout title="Create your account" sub="A personal account is free. It does not give access to any company until you create one or accept an invitation."
      foot={<>Already have an account? <Link to={`/signin${sp.get('next') ? `?next=${encodeURIComponent(sp.get('next')!)}` : ''}`}>Sign in</Link></>}>
      <form onSubmit={(e) => { e.preventDefault(); s.run(); }} className="stack" noValidate>
        <ErrorSummary error={s.error} />
        <Field label="Your name" id="f-name" error={s.fieldError('name')}>{(p) => <Input {...p} autoComplete="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <Field label="Email" id="f-email" error={s.fieldError('email')} hint="If you were invited, use the email the invitation was sent to.">{(p) => <Input {...p} type="email" autoComplete="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
        <Field label="Password" id="f-password" error={s.fieldError('password')} hint="At least 10 characters. A password manager works here.">{(p) => <PasswordInput {...p} autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />}</Field>
        <Button type="submit" variant="primary" busy={s.busy} block size="lg">Create account</Button>
      </form>
    </AuthLayout>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<null | 'mailbox' | 'unavailable'>(null);
  const s = useSubmit(async () => { const r = await post('/auth/forgot', { email }); setResult(r.channel); });
  return (
    <AuthLayout title="Reset your password">
      {result === 'mailbox' && <Banner tone="success" title="Check your email">If an account exists for that address, a reset link was sent. On this local installation it appears in the <Link to="/dev/mailbox">simulated mailbox</Link>.</Banner>}
      {result === 'unavailable' && <Banner tone="warning" title="Email is not set up on this installation">Password reset by email needs an email service, which is not configured yet. Contact the person who runs this Rigo installation.</Banner>}
      {!result && (
        <form onSubmit={(e) => { e.preventDefault(); s.run(); }} className="stack" noValidate>
          <ErrorSummary error={s.error} />
          <Field label="Email" id="f-email" error={s.fieldError('email')}>{(p) => <Input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Button type="submit" variant="primary" busy={s.busy} block>Send reset link</Button>
        </form>
      )}
      <Link to="/signin" className="small">Back to sign in</Link>
    </AuthLayout>
  );
}

export function Reset() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const s = useSubmit(async () => { await post('/auth/reset', { token, password }); nav('/signin'); });
  return (
    <AuthLayout title="Choose a new password" sub="Signing in again will be required on your other devices.">
      <form onSubmit={(e) => { e.preventDefault(); s.run(); }} className="stack" noValidate>
        <ErrorSummary error={s.error} />
        <Field label="New password" id="f-password" error={s.fieldError('password')} hint="At least 10 characters.">{(p) => <PasswordInput {...p} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <Button type="submit" variant="primary" busy={s.busy} block>Save password</Button>
      </form>
    </AuthLayout>
  );
}
