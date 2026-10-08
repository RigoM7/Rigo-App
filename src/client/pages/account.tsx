import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Inbox as InboxIcon } from 'lucide-react';
import { get, post, patch } from '../lib/api';
import { useMe, refreshMe, signOutAndForget } from '../lib/session';
import { useSubmit } from '../lib/form';
import { useTitle } from '../lib/title';
import { applyTheme, readThemePref, type ThemePref } from '../lib/theme';
import { hasUnsynced } from '../lib/offline';
import { relTime } from '../lib/format';
import { Button, TextField, FormError, Banner, Segmented, Wordmark, Confirm, useToast, Loading, LinkButton, Empty } from '../components/ui';
import { PASSWORD_HINT, PASSWORD_MAX } from '../../shared/password';
import { EMAIL_MAX } from '../../shared/email';

function Frame({ children, title }: { children: React.ReactNode; title: string }) {
  useTitle(title);
  return (
    <div className="public">
      <header className="public-top"><Wordmark to="/home" /><LinkButton to="/home" variant="ghost" icon={<ArrowLeft size={18} aria-hidden="true" />}>Back to work</LinkButton></header>
      <main id="main" className="main" style={{ paddingBottom: 48 }}><div className="page page-narrow">{children}</div></main>
    </div>
  );
}

export function Account() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const user = me.data?.user;
  const [name, setName] = useState(user?.name ?? '');
  const [theme, setThemeState] = useState<ThemePref>(user?.theme ?? readThemePref());
  const [pw, setPw] = useState({ current: '', password: '' });
  const [em, setEm] = useState({ email: '', password: '' });
  const [del, setDel] = useState({ open: false, password: '' });
  const [unsent, setUnsent] = useState(false);
  useEffect(() => { if (user) void hasUnsynced(user.id).then(setUnsent); }, [user]);
  const saveName = useSubmit(async () => { await patch('/auth/me', { name }); await refreshMe(qc); toast('Name saved.'); });
  const savePw = useSubmit(async () => { await post('/auth/me/password', pw); setPw({ current: '', password: '' }); toast('Password changed. Other devices were signed out.'); });
  const saveEmail = useSubmit(async () => {
    const r = await post<{ status: 'pending' | 'changed'; email: string }>('/auth/me/email', em);
    setEm({ email: '', password: '' });
    await refreshMe(qc);
    toast(r.status === 'pending' ? `Check ${r.email} for a link to finish the change.` : `Your email is now ${r.email}.`);
  });
  const resend = useSubmit(async () => { await post('/auth/me/verify/resend'); toast(`Confirmation email sent to ${user?.email}.`); });
  const remove = useSubmit(async () => { await post('/auth/me/delete', { password: del.password }); await signOutAndForget(qc); nav('/'); });
  const setTheme = async (t: ThemePref) => { setThemeState(t); applyTheme(t); await patch('/auth/me', { theme: t }).catch(() => {}); };
  if (!user) return <Loading />;
  return (
    <Frame title="Your account">
      <div className="stack-sm"><h1>Your account</h1><p className="muted">{user.email}</p></div>
      {!user.emailVerified && me.data?.emailChannel !== 'none' && (
        <Banner tone="attn" title="Confirm your email" action={<Button size="sm" busy={resend.busy} onClick={() => void resend.run()}>Send the link again</Button>}>So you can recover your account if you forget your password.</Banner>
      )}
      <section className="card stack" aria-labelledby="a-name">
        <h2 id="a-name">Name and look</h2>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void saveName.run(); }} noValidate>
          <FormError error={saveName.error} />
          <TextField label="Your name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} error={saveName.fieldError('name')} />
          <div><Button type="submit" busy={saveName.busy}>Save name</Button></div>
        </form>
        <div className="stack-sm"><span className="field-label">Theme</span>
          <Segmented label="Theme" value={theme} onChange={setTheme} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'Same as this device' }]} />
        </div>
      </section>
      <section className="card stack" aria-labelledby="a-pw">
        <h2 id="a-pw">Password</h2>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void savePw.run(); }} noValidate>
          <FormError error={savePw.error} />
          <TextField label="Current password" type="password" autoComplete="current-password" maxLength={PASSWORD_MAX} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} error={savePw.fieldError('current')} />
          <TextField label="New password" type="password" autoComplete="new-password" maxLength={PASSWORD_MAX} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} error={savePw.fieldError('password')} hint={PASSWORD_HINT} />
          <div><Button type="submit" busy={savePw.busy}>Change password</Button></div>
        </form>
      </section>
      <section className="card stack" aria-labelledby="a-email">
        <h2 id="a-email">Email address</h2>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void saveEmail.run(); }} noValidate>
          <FormError error={saveEmail.error} />
          <TextField label="New email" type="email" autoComplete="email" maxLength={EMAIL_MAX} value={em.email} onChange={(e) => setEm({ ...em, email: e.target.value })} error={saveEmail.fieldError('email')} />
          <TextField label="Your password" type="password" autoComplete="current-password" maxLength={PASSWORD_MAX} value={em.password} onChange={(e) => setEm({ ...em, password: e.target.value })} error={saveEmail.fieldError('password')} />
          <div><Button type="submit" busy={saveEmail.busy}>Change email</Button></div>
        </form>
      </section>
      <section className="card stack" aria-labelledby="a-del">
        <h2 id="a-del">Delete your account</h2>
        <p className="muted">Your name and email are removed and you leave every workspace. Work you did stays in each workspace’s history.</p>
        {unsent && <Banner tone="attn" title="Records not sent yet">This phone still has updates that weren’t sent. Open your workspace with signal first, or they’ll be lost.</Banner>}
        <div><Button variant="danger" onClick={() => setDel({ open: true, password: '' })}>Delete my account</Button></div>
      </section>
      {del.open && (
        <Confirm title="Delete your account?" danger confirm="Delete my account" busy={remove.busy} onClose={() => setDel({ open: false, password: '' })} onConfirm={() => void remove.run()}
          body={<div className="stack">
            <p>This can’t be undone.</p>
            <FormError error={remove.error} />
            <TextField label="Your password" type="password" autoComplete="current-password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} error={remove.fieldError('password')} />
          </div>} />
      )}
    </Frame>
  );
}

/** Local copies only: where account emails land when no email service is set up. */
export function DevMailbox() {
  const q = useQuery({ queryKey: ['mailbox'], queryFn: () => get<{ enabled: boolean; messages: any[] }>('/auth/dev/mailbox'), refetchInterval: 5000 });
  return (
    <Frame title="Test inbox">
      <div className="stack-sm"><h1>Test inbox</h1><p className="muted">On a local copy, account emails appear here instead of being sent. Nothing here left this computer.</p></div>
      {q.isLoading ? <Loading /> : !q.data?.enabled ? <Empty icon={<InboxIcon />} title="The test inbox is off here">This server sends real email, or none.</Empty> : !q.data.messages.length ? <Empty icon={<InboxIcon />} title="No emails yet" /> : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {q.data.messages.map((m) => (
            <li key={m.id} className="card stack-sm">
              <div className="row-between"><strong>{m.subject}</strong><span className="small muted">{relTime(m.created_at)}</span></div>
              <div className="small muted">To {m.to_email}</div>
              <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'var(--font-body)' }}>{m.body}</pre>
              {m.link && <a href={m.link}>Open the link</a>}
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}
