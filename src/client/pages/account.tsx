import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Sun, Moon, Monitor, AlertTriangle } from 'lucide-react';
import { useMe } from '../lib/session';
import { patch, post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { applyTheme, readThemePref, type ThemePref } from '../lib/theme';
import { Button, Card, Field, Input, PasswordInput, ErrorSummary, Banner, useToast, useConfirm, LoadingBlock } from '../components/ui';
import type { Draft } from '../lib/offline';

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
  const saveName = useSubmit(async () => { await patch('/auth/me', { name }); qc.invalidateQueries({ queryKey: ['me'] }); toast('Name saved'); });
  const savePw = useSubmit(async () => { await post('/auth/me/password', pw); setPw({ current: '', password: '' }); toast('Password changed. Other devices were signed out.'); });
  const setTheme = async (t: ThemePref) => { setPref(t); applyTheme(t); await patch('/auth/me', { theme: t }).catch(() => {}); };
  const signOut = async (discard: boolean) => {
    const uid = me.data?.user?.id;
    if (unsynced?.length && !discard) return;
    if (discard && unsynced?.length && !(await ask({ title: 'Discard unsynced drafts?', body: `${unsynced.length} job draft(s) on this device have not been accepted by the server. Signing out deletes them from this device. The jobs stay as they are on the server.`, confirm: 'Discard and sign out', danger: true }))) return;
    const { clearUserData } = await import('../lib/offline');
    if (uid) await clearUserData(uid);
    await post('/auth/signout'); qc.clear(); nav('/signin');
  };
  if (!me.data?.user) return <LoadingBlock />;
  return (
    <div className="shell">
      <header className="topbar"><Link to="/workspaces" className="brand"><span className="brand-mark" aria-hidden>R</span>Rigo</Link></header>
      <main className="main" id="main"><div className="page page-narrow">
        <div><Link className="back-link" to="/workspaces">← Workspaces</Link><h1 style={{ marginTop: 8 }}>Account</h1><p className="muted">{me.data.user.email}</p></div>
        {(sp.get('signout') || (unsynced && unsynced.length > 0)) && unsynced && unsynced.length > 0 && (
          <Banner tone="warning" title={`${unsynced.length} job draft(s) are not synced yet`}>
            They are saved only on this device. Open them and sync before signing out, or discard them.
            <ul>{unsynced.map((d) => <li key={d.jobId}><Link to={`/c/${d.companyId}/today/${d.jobId}`}>Job #{d.jobNumber}</Link>: {d.state === 'conflict' ? 'conflict needs review' : d.state === 'failed' ? 'waiting to sync' : 'saved on this device'}</li>)}</ul>
          </Banner>
        )}
        <Card title="Theme" id="theme">
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {([['light', 'Light', <Sun key="l" aria-hidden />], ['dark', 'Dark', <Moon key="d" aria-hidden />], ['system', 'System', <Monitor key="s" aria-hidden />]] as const).map(([k, l, i]) => <button key={k} role="radio" aria-checked={pref === k} aria-pressed={pref === k} onClick={() => setTheme(k)}>{i}{l}</button>)}
          </div>
          <p className="hint" style={{ marginTop: 8 }}>Saved to your account and this device. System follows your device setting.</p>
        </Card>
        <Card title="Profile" id="profile">
          <form className="stack" onSubmit={(e) => { e.preventDefault(); saveName.run(); }} noValidate>
            <ErrorSummary error={saveName.error} />
            <Field label="Name" id="f-name" error={saveName.fieldError('name')}>{(p) => <Input {...p} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <div><Button type="submit" busy={saveName.busy}>Save name</Button></div>
          </form>
        </Card>
        <Card title="Password" id="pw">
          <form className="stack" onSubmit={(e) => { e.preventDefault(); savePw.run(); }} noValidate>
            <ErrorSummary error={savePw.error} />
            <input type="text" autoComplete="username" value={me.data.user.email} readOnly hidden />
            <Field label="Current password" id="f-current" error={savePw.fieldError('current')}>{(p) => <PasswordInput {...p} autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />}</Field>
            <Field label="New password" id="f-password" hint="At least 10 characters." error={savePw.fieldError('password')}>{(p) => <PasswordInput {...p} autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} />}</Field>
            <div><Button type="submit" busy={savePw.busy}>Change password</Button></div>
          </form>
        </Card>
        <Card title="Sign out" id="so">
          {unsynced && unsynced.length > 0 ? (
            <div className="row"><Button variant="danger" icon={<AlertTriangle aria-hidden />} onClick={() => signOut(true)}>Discard drafts and sign out</Button></div>
          ) : <Button onClick={() => signOut(false)}>Sign out</Button>}
        </Card>
        {node}
      </div></main>
    </div>
  );
}
