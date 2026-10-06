import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, FlaskConical, Plus, MailOpen, ChevronRight, LogOut } from 'lucide-react';
import { useMe } from '../lib/session';
import { post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Select, ErrorSummary, Pill, Banner, LoadingBlock, Checkbox, useToast } from '../components/ui';
import { SERVICE_CATEGORIES } from '../../shared/services';
import { CURRENCIES } from '../../shared/billing';

function TopBar() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const me = useMe();
  const signOut = async () => {
    const { hasUnsynced, clearUserData } = await import('../lib/offline');
    const uid = me.data?.user?.id;
    if (uid && (await hasUnsynced(uid))) { nav('/account?signout=1'); return; }
    if (uid) await clearUserData(uid);
    await post('/auth/signout'); qc.clear(); nav('/signin');
  };
  return (
    <header className="topbar">
      <Link to="/workspaces" className="brand"><span className="brand-mark" aria-hidden>R</span>Rigo</Link>
      <span className="spacer" />
      <Link to="/account" className="btn btn-ghost btn-sm">Account</Link>
      <Button size="sm" variant="ghost" icon={<LogOut aria-hidden />} onClick={signOut}>Sign out</Button>
    </header>
  );
}

export function Workspaces() {
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const demo = useSubmit(async () => { const r = await post('/demo'); await qc.invalidateQueries({ queryKey: ['me'] }); nav(`/c/${r.id}`); });
  const accept = useSubmit(async (id: string) => { const r = await post(`/me/invitations/${id}/accept`); await qc.invalidateQueries({ queryKey: ['me'] }); toast('Invitation accepted'); nav(`/c/${r.companyId}`); });
  if (me.isLoading || !me.data) return <LoadingBlock />;
  const real = me.data.companies.filter((c) => c.kind === 'real');
  const demoCo = me.data.companies.find((c) => c.kind === 'demo');
  return (
    <div className="shell">
      <TopBar />
      <main className="main" id="main" style={{ paddingBottom: 48 }}>
        <div className="page page-narrow">
          <div><h1>Hello, {me.data.user?.name.split(' ')[0]}</h1><p className="muted" style={{ marginTop: 6 }}>Choose a workspace. Each company is separate: what you can see depends on your role there.</p></div>
          {me.data.invitations.length > 0 && (
            <Card title="Invitations for you" id="inv">
              <ErrorSummary error={accept.error} />
              <ul className="list">
                {me.data.invitations.map((i) => (
                  <li key={i.id} className="row-between" style={{ padding: '12px 0' }}>
                    <span className="row"><MailOpen aria-hidden /><span><strong>{i.company_name}</strong><br /><span className="muted small">Join as {i.role_name}</span></span></span>
                    <Button variant="primary" busy={accept.busy} onClick={() => accept.run(i.id)}>Accept and open</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Your companies" id="cos" actions={<Link to="/workspaces/new" className="btn btn-primary"><Plus aria-hidden />Create a company</Link>}>
            {real.length === 0 ? (
              <p className="muted">You don't belong to a company yet. Create one (it's free), or ask your employer to invite you by email.</p>
            ) : (
              <ul className="list">
                {real.map((c) => (
                  <li key={c.id}>
                    <Link to={`/c/${c.id}`} className="list-item" style={{ alignItems: 'center', paddingLeft: 0, paddingRight: 0 }}>
                      <Building2 aria-hidden />
                      <span style={{ flex: 1, minWidth: 0 }}><strong>{c.name}</strong><br /><span className="small muted">{c.role_name}</span></span>
                      <ChevronRight aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={<h2 className="row"><FlaskConical aria-hidden />Free demo</h2>}>
            <p>Explore a fictional fuel, portable toilet and septic company. Try dispatching a job, completing it as a driver and approving the invoice. Nothing is sent, charged or connected.</p>
            <ErrorSummary error={demo.error} />
            <div className="row">
              <Button variant={real.length ? 'default' : 'primary'} busy={demo.busy} icon={<FlaskConical aria-hidden />} onClick={() => (demoCo ? nav(`/c/${demoCo.id}`) : demo.run())}>{demoCo ? 'Open my demo' : 'Explore the demo'}</Button>
              {demoCo ? <Pill tone="demo">Demo workspace</Pill> : null}
            </div>
          </Card>
          {me.data.devMailbox && <p className="small muted">Local installation: simulated emails (invitations, password resets) appear in the <Link to="/dev/mailbox">simulated mailbox</Link>.</p>}
        </div>
      </main>
    </div>
  );
}

const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto', 'America/Vancouver', 'America/Mexico_City', 'Europe/London', 'Europe/Berlin', 'Australia/Sydney'];

export function CompanyBasicsForm({ onSubmit, busy, error, submitLabel, initial }: { onSubmit: (v: any) => void; busy: boolean; error: any; submitLabel: string; initial?: any }) {
  const guessTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [v, setV] = useState({ name: '', timezone: TIMEZONES.includes(guessTz) ? guessTz : 'America/New_York', currency: 'USD', categories: [] as string[], start: 'starter', ...(initial ?? {}) });
  const toggle = (c: string) => setV({ ...v, categories: v.categories.includes(c) ? v.categories.filter((x: string) => x !== c) : [...v.categories, c] });
  return (
    <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
      <ErrorSummary error={error} />
      <Field label="Company name" id="f-name" error={error?.fields?.name}>{(p) => <Input {...p} autoComplete="organization" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
      <div className="grid-2">
        <Field label="Time zone" id="f-timezone" hint="Schedules and recurring visits use this." error={error?.fields?.timezone}>{(p) => <Select {...p} value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>{[...new Set([v.timezone, ...TIMEZONES])].map((t) => <option key={t}>{t}</option>)}</Select>}</Field>
        <Field label="Currency" id="f-currency">{(p) => <Select {...p} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
      </div>
      <fieldset>
        <legend>Services you offer</legend>
        <p className="hint">Choose any that apply. They share your customers, drivers and trucks. You can change this later.</p>
        {(['fuel', 'portable_toilet', 'septic', 'other'] as const).map((c) => <Checkbox key={c} label={SERVICE_CATEGORIES[c]} checked={v.categories.includes(c)} onChange={() => toggle(c)} />)}
      </fieldset>
      {initial?.hideStart ? null : (
        <fieldset>
          <legend>How to start</legend>
          <div className="radio-cards">
            <label className="radio-card"><input type="radio" name="start" checked={v.start === 'starter'} onChange={() => setV({ ...v, start: 'starter' })} /><span><strong>Starter setup</strong><br /><span className="small muted">Editable service forms for the services above and recommended workflows as drafts. No sample customers or jobs.</span></span></label>
            <label className="radio-card"><input type="radio" name="start" checked={v.start === 'blank'} onChange={() => setV({ ...v, start: 'blank' })} /><span><strong>Start blank</strong><br /><span className="small muted">Build your own services and workflows from scratch.</span></span></label>
          </div>
        </fieldset>
      )}
      <Button type="submit" variant="primary" size="lg" busy={busy}>{submitLabel}</Button>
    </form>
  );
}

export function NewCompany() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const s = useSubmit(async (v: any) => { const r = await post('/companies', v); await qc.invalidateQueries({ queryKey: ['me'] }); nav(`/c/${r.id}/setup`); });
  return (
    <div className="shell">
      <TopBar />
      <main className="main" id="main">
        <div className="page page-narrow">
          <div><Link className="back-link" to="/workspaces">← Workspaces</Link><h1 style={{ marginTop: 8 }}>Create a company</h1><p className="muted" style={{ marginTop: 6 }}>You become its owner. Creating a company is free. You can finish setup over several visits.</p></div>
          <Banner tone="info">A new company starts empty: no sample customers, jobs or invoices. Use the demo to try Rigo with fictional data.</Banner>
          <div className="card"><CompanyBasicsForm onSubmit={(v) => s.run(v)} busy={s.busy} error={s.error} submitLabel="Create company" /></div>
        </div>
      </main>
    </div>
  );
}
