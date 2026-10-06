import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Sun, Moon, Monitor, AlertTriangle, ChevronLeft, MailCheck, Trash2, Send } from 'lucide-react';
import { refreshMe, signOutAndForget, useMe } from '../lib/session';
import { patch, post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { applyTheme, readThemePref, type ThemePref } from '../lib/theme';
import { useDocumentTitle } from '../lib/title';
import { Button, Card, Field, Input, PasswordInput, ErrorSummary, Banner, Pill, useToast, useConfirm, LoadingBlock, Wordmark } from '../components/ui';
import { EmailSuggestion, NAME_MAX } from './auth';
import { PASSWORD_HINT, PASSWORD_MAX } from '../../shared/password';
import { EMAIL_MAX } from '../../shared/email';
import type { Draft } from '../lib/offline';

/** Resend the confirmation email. Shown only when email can actually be sent here. */
export function ConfirmEmailNotice({ email }: { email: string }) {
  const toast = useToast();
  const s = useSubmit(async () => { await post('/auth/me/verify/resend'); toast(`Confirmation email sent to ${email}`); });
  return (
    <Banner tone="info" title="Confirm your email" action={<Button size="sm" busy={s.busy} icon={<Send aria-hidden />} onClick={() => s.run()}>Resend</Button>}>
      We sent a link to <strong className="wrap-anywhere">{email}</strong>. Confirming it lets you reset your password by email if you forget it.
      {s.error ? <div className="field-error" style={{ marginTop: 6 }}>{s.error.message}</div> : null}
    </Banner>
  );
}

function EmailCard() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const user = me.data!.user!;
  const channel = me.data!.emailChannel;
  const [v, setV] = useState({ email: '', password: '' });
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const s = useSubmit(async () => {
    const r = await post('/auth/me/email', v);
    setV({ email: '', password: '' });
    setTouched(false);
    if (r.status === 'pending') { setPending(r.email); return; }
    await refreshMe(qc);
    toast('Email changed. Other devices were signed out.');
  });
  return (
    <Card title="Email" id="email">
      <div className="stack">
        <div className="row" style={{ gap: 8 }}>
          <span className="wrap-anywhere"><strong>{user.email}</strong></span>
          {user.emailVerified ? <Pill tone="success">Confirmed</Pill> : <Pill tone="neutral">Not confirmed</Pill>}
        </div>
        {!user.emailVerified && channel !== 'none' ? <ConfirmEmailNotice email={user.email} /> : null}
        {!user.emailVerified && channel === 'none' ? <p className="hint" style={{ margin: 0 }}>Rigo can't send email yet, so this address can't be confirmed for now. Check that it's spelled right.</p> : null}
        {pending ? (
          <Banner tone="success" title={`Check ${pending}`}>
            Open the link we sent there to finish the change. Until then, keep signing in with {user.email}.
            {channel === 'mailbox' ? <> On this local copy, emails appear in the <Link to="/dev/mailbox">simulated mailbox</Link>.</> : null}
          </Banner>
        ) : null}
        <form className="stack" onSubmit={(e) => { e.preventDefault(); s.run(); }} noValidate>
          <h3 className="h3">Change your email</h3>
          <ErrorSummary error={s.error} />
          <div className="stack-sm">
            <Field label="New email" id="f-email" error={s.fieldError('email')} hint={channel === 'none' ? 'It changes right away, and other devices are signed out.' : "We'll send a link to the new address. The change happens when you open it."}>
              {(p) => <Input {...p} type="email" autoComplete="email" maxLength={EMAIL_MAX} value={v.email} onBlur={() => setTouched(true)} onChange={(e) => setV({ ...v, email: e.target.value })} />}
            </Field>
            {touched ? <EmailSuggestion email={v.email} onUse={(fixed) => setV({ ...v, email: fixed })} /> : null}
          </div>
          <input type="text" autoComplete="username" value={user.email} readOnly hidden />
          <Field label="Current password" id="f-password" error={s.fieldError('password')}>{(p) => <PasswordInput {...p} autoComplete="current-password" maxLength={PASSWORD_MAX} value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />}</Field>
          <div><Button type="submit" busy={s.busy} icon={<MailCheck aria-hidden />}>Change email</Button></div>
        </form>
      </div>
    </Card>
  );
}

function DeleteAccountCard({ onDeleted }: { onDeleted: () => Promise<void> }) {
  const me = useMe();
  const { ask, node } = useConfirm();
  const [password, setPassword] = useState('');
  const owned = (me.data?.companies ?? []).filter((c) => c.kind === 'real');
  const s = useSubmit(async () => {
    const ok = await ask({
      title: 'Delete your account?',
      body: <>You lose access to {owned.length ? owned.map((c) => c.name).join(', ') : 'Rigo'} right away, your demo is deleted, and you're signed out everywhere. Work you did stays in your companies' history as "Deleted user". This can't be undone.</>,
      confirm: 'Delete my account', danger: true,
    });
    if (!ok) return;
    await post('/auth/me/delete', { password });
    await onDeleted();
  });
  return (
    <Card title="Delete account" id="delete">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); s.run(); }} noValidate>
        <p className="muted" style={{ margin: 0 }}>If you're the only owner of a company, make someone else an owner in Team first.</p>
        <ErrorSummary error={s.error} labels={{ password: 'f-delete-password' }} />
        <Field label="Your password" id="f-delete-password" error={s.fieldError('password')}>{(p) => <PasswordInput {...p} autoComplete="current-password" maxLength={PASSWORD_MAX} value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <div><Button type="submit" variant="danger" busy={s.busy} icon={<Trash2 aria-hidden />}>Delete my account</Button></div>
      </form>
      {node}
    </Card>
  );
}

export function Account() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [sp] = useSearchParams();
  const { ask, node } = useConfirm();
  const [name, setName] = useState('');
  const [pref, setPref] = useState<ThemePref>(readThemePref());
  const [pw, setPw] = useState({ current: '', password: '' });
  const [unsynced, setUnsynced] = useState<Draft[] | null>(null);
  useDocumentTitle('Account');
  useEffect(() => { if (me.data?.user) setName(me.data.user.name); }, [me.data?.user]);
  useEffect(() => {
    (async () => {
      if (!me.data?.user) return;
      const { listDrafts } = await import('../lib/offline');
      const all: Draft[] = [];
      for (const c of me.data.companies) all.push(...(await listDrafts(me.data.user.id, c.id)).filter((d) => d.state !== 'accepted'));
      setUnsynced(all);
    })();
  }, [me.data]);
  const saveName = useSubmit(async () => { await patch('/auth/me', { name }); await refreshMe(qc); toast('Name saved'); });
  const savePw = useSubmit(async () => { await post('/auth/me/password', pw); setPw({ current: '', password: '' }); toast('Password changed. Other devices were signed out.'); });
  const setTheme = async (t: ThemePref) => { setPref(t); applyTheme(t); await patch('/auth/me', { theme: t }).catch(() => {}); };
  const forgetDevice = async () => {
    const uid = me.data?.user?.id;
    const { clearUserData } = await import('../lib/offline');
    if (uid) await clearUserData(uid);
  };
  const signOut = async (discard: boolean) => {
    if (unsynced?.length && !discard) return;
    if (discard && unsynced?.length && !(await ask({ title: 'Discard unsynced drafts?', body: `${unsynced.length} job draft(s) on this device have not been accepted by the server. Signing out deletes them from this device. The jobs stay as they are on the server.`, confirm: 'Discard and sign out', danger: true }))) return;
    await forgetDevice();
    await signOutAndForget(qc);
    nav('/signin');
  };
  const onDeleted = async () => {
    await forgetDevice();
    await signOutAndForget(qc);
    toast('Your account was deleted.');
    nav('/', { replace: true });
  };
  if (!me.data?.user) return <LoadingBlock />;
  return (
    <div className="shell">
      <header className="plain-top"><Wordmark to="/workspaces" /></header>
      <main className="plain-main" id="main"><div className="page page-narrow">
        <div><Link className="back-link" to="/workspaces"><ChevronLeft aria-hidden />Workspaces</Link><h1 style={{ marginTop: 8 }}>Account</h1><p className="muted wrap-anywhere">{me.data.user.email}</p></div>
        {(sp.get('signout') || (unsynced && unsynced.length > 0)) && unsynced && unsynced.length > 0 && (
          <Banner tone="warning" title={`${unsynced.length} job draft(s) are not synced yet`}>
            They are saved only on this device. Open them and sync before signing out, or discard them.
            <ul>{unsynced.map((d) => <li key={d.jobId}><Link to={`/c/${d.companyId}/today/${d.jobId}`}>Job #{d.jobNumber}</Link>: {d.state === 'conflict' ? 'conflict needs review' : d.state === 'failed' ? 'waiting to sync' : 'saved on this device'}</li>)}</ul>
          </Banner>
        )}
        <Card title="Theme" id="theme">
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {([['light', 'Light', <Sun key="l" aria-hidden />], ['dark', 'Dark', <Moon key="d" aria-hidden />], ['system', 'System', <Monitor key="s" aria-hidden />]] as const).map(([k, l, i]) => <button key={k} role="radio" aria-checked={pref === k} onClick={() => setTheme(k)}>{i}{l}</button>)}
          </div>
          <p className="hint" style={{ marginTop: 8 }}>Saved to your account and this device. System follows your device setting.</p>
        </Card>
        <Card title="Profile" id="profile">
          <form className="stack" onSubmit={(e) => { e.preventDefault(); saveName.run(); }} noValidate>
            <ErrorSummary error={saveName.error} />
            <Field label="Name" id="f-name" error={saveName.fieldError('name')}>{(p) => <Input {...p} autoComplete="name" maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <div><Button type="submit" busy={saveName.busy}>Save name</Button></div>
          </form>
        </Card>
        <EmailCard />
        <Card title="Password" id="pw">
          <form className="stack" onSubmit={(e) => { e.preventDefault(); savePw.run(); }} noValidate>
            <ErrorSummary error={savePw.error} labels={{ password: 'f-new-password' }} />
            <input type="text" autoComplete="username" value={me.data.user.email} readOnly hidden />
            <Field label="Current password" id="f-current" error={savePw.fieldError('current')}>{(p) => <PasswordInput {...p} autoComplete="current-password" maxLength={PASSWORD_MAX} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />}</Field>
            <Field label="New password" id="f-new-password" hint={PASSWORD_HINT} error={savePw.fieldError('password')}>{(p) => <PasswordInput {...p} autoComplete="new-password" maxLength={PASSWORD_MAX} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} />}</Field>
            <div><Button type="submit" busy={savePw.busy}>Change password</Button></div>
          </form>
        </Card>
        <Card title="Sign out" id="so">
          {unsynced && unsynced.length > 0 ? (
            <div className="row"><Button variant="danger" icon={<AlertTriangle aria-hidden />} onClick={() => signOut(true)}>Discard drafts and sign out</Button></div>
          ) : <Button onClick={() => signOut(false)}>Sign out</Button>}
        </Card>
        <DeleteAccountCard onDeleted={onDeleted} />
        {node}
      </div></main>
    </div>
  );
}
