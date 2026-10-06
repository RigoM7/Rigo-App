import { timezoneOptions } from '../../shared/timezones';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Plus, MailOpen, ChevronRight, LogOut, UserCircle2, ChevronLeft } from 'lucide-react';
import { refreshMe, signOutAndForget, useMe } from '../lib/session';
import { useDocumentTitle } from '../lib/title';
import { ConfirmEmailNotice } from './account';
import { post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Select, ErrorSummary, Pill, Banner, LoadingBlock, Checkbox, Wordmark, useToast } from '../components/ui';
import { CompanyChip } from '../components/shell';
import { SERVICE_CATEGORIES } from '../../shared/services';
import { CURRENCIES } from '../../shared/billing';

export function TopBar() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const me = useMe();
  const signOut = async () => {
    const { hasUnsynced, clearUserData } = await import('../lib/offline');
    const uid = me.data?.user?.id;
    if (uid && (await hasUnsynced(uid))) { nav('/account?signout=1'); return; }
    if (uid) await clearUserData(uid);
    await signOutAndForget(qc);
    nav('/signin');
  };
  return (
    <header className="plain-top">
      <Wordmark to="/workspaces" />
      <span className="spacer" />
      <Link to="/account" className="btn btn-sm"><UserCircle2 aria-hidden />Account</Link>
      <Button size="sm" icon={<LogOut aria-hidden />} onClick={signOut}>Sign out</Button>
    </header>
  );
}

export function Workspaces() {
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  // "Open my demo" also goes through the server so a returning visitor starts in the Owner view.
  const demo = useSubmit(async () => { const r = await post('/demo'); await qc.invalidateQueries({ queryKey: [r.id] }); await refreshMe(qc); nav(`/c/${r.id}`); });
  const accept = useSubmit(async (id: string) => { const r = await post(`/me/invitations/${id}/accept`); await refreshMe(qc); toast('Invitation accepted'); nav(`/c/${r.companyId}`); });
  useDocumentTitle('Workspaces');
  if (me.isLoading || !me.data) return <div className="auth-wrap"><LoadingBlock /></div>;
  const real = me.data.companies.filter((c) => c.kind === 'real');
  const demoCo = me.data.companies.find((c) => c.kind === 'demo');
  return (
    <div className="shell">
      <TopBar />
      <main className="plain-main" id="main">
        <div className="page page-narrow">
          <div><h1 className="wrap-anywhere">Hello, {me.data.user?.name.split(' ')[0]}</h1><p className="muted" style={{ marginTop: 8 }}>Open a company to get to work. Each company is separate, and what you see depends on your role there.</p></div>
          {me.data.user && !me.data.user.emailVerified && me.data.emailChannel !== 'none' ? <ConfirmEmailNotice email={me.data.user.email} /> : null}
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
          <section className="stack-sm" aria-labelledby="cos-h">
            <div className="section-head"><h2 id="cos-h">Your companies</h2><Link to="/workspaces/new" className="btn btn-primary"><Plus aria-hidden />Create a company</Link></div>
            {real.length === 0 ? (
              <div className="card"><p className="muted" style={{ margin: 0 }}>You don't belong to a company yet. Create one (it's free), or ask your employer to invite you by email.</p></div>
            ) : (
              <ul className="workspace-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {real.map((c) => (
                  <li key={c.id} style={{ minWidth: 0 }}>
                    <Link to={`/c/${c.id}`} className="workspace">
                      <CompanyChip cid={c.id} name={c.name} logo={c.branding?.logoFileId} accent={c.branding?.accent} />
                      <span style={{ minWidth: 0 }}><span className="wname" style={{ display: 'block' }}>{c.name}</span><span className="small muted">{c.role_name}{c.setup_completed_at ? '' : ' · setup in progress'}</span></span>
                      <ChevronRight aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <Card title={<h2 className="row" style={{ gap: 8 }}><FlaskConical aria-hidden style={{ width: 18 }} />Free demo</h2>}>
            <p>{real.length ? '' : 'Not sure yet? Try a sample company first; nothing is sent or charged. '}A fictional fuel, portable toilet and septic company where you can dispatch a job, finish it as a driver and approve the invoice.</p>
            <ErrorSummary error={demo.error} />
            <div className="row">
              <Button busy={demo.busy} icon={<FlaskConical aria-hidden />} onClick={() => demo.run()}>{demoCo ? 'Open my demo' : 'Explore the demo'}</Button>
              {demoCo ? <Pill tone="demo">Demo workspace</Pill> : null}
            </div>
          </Card>
          {me.data.devMailbox && <p className="small muted">On this local copy, invitation and password emails appear in the <Link to="/dev/mailbox">simulated mailbox</Link>.</p>}
        </div>
      </main>
    </div>
  );
}

/** Time zone picker with friendly names; the device's zone is offered even when it is not a common one. */
export function TimezoneSelect({ value, onChange, ...p }: { value: string; onChange: (tz: string) => void; id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) {
  const device = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })();
  return <Select {...p} value={value} onChange={(e) => onChange(e.target.value)}>{timezoneOptions(value, device).map((t) => <option key={t.id} value={t.id}>{t.label}{t.id === device && device !== value ? ' (this device)' : ''}</option>)}</Select>;
}

export function CompanyBasicsForm({ onSubmit, busy, error, submitLabel, initial }: { onSubmit: (v: any) => void; busy: boolean; error: any; submitLabel: string; initial?: any }) {
  const guessTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; } catch { return 'America/New_York'; } })();
  const [v, setV] = useState({ name: '', timezone: guessTz, currency: 'USD', categories: [] as string[], start: 'starter', ...(initial ?? {}) });
  const toggle = (c: string) => setV({ ...v, categories: v.categories.includes(c) ? v.categories.filter((x: string) => x !== c) : [...v.categories, c] });
  return (
    <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
      <ErrorSummary error={error} />
      <Field label="Company name" id="f-name" error={error?.fields?.name}>{(p) => <Input {...p} maxLength={80} autoComplete="organization" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
      <div className="grid-2">
        <Field label="Time zone" id="f-timezone" hint="Schedules and recurring visits use this." error={error?.fields?.timezone}>{(p) => <TimezoneSelect {...p} value={v.timezone} onChange={(tz) => setV({ ...v, timezone: tz })} />}</Field>
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
  const s = useSubmit(async (v: any) => { const r = await post('/companies', v); await refreshMe(qc); nav(`/c/${r.id}/setup`); });
  useDocumentTitle('Create a company');
  return (
    <div className="shell">
      <TopBar />
      <main className="plain-main" id="main">
        <div className="page page-narrow">
          <div><Link className="back-link" to="/workspaces"><ChevronLeft aria-hidden />Workspaces</Link><h1 style={{ marginTop: 8 }}>Create a company</h1><p className="muted" style={{ marginTop: 6 }}>You become its owner. Creating a company is free. You can finish setup over several visits.</p></div>
          <Banner tone="info">A new company starts empty: no sample customers, jobs or invoices. Use the demo to try Rigo with fictional data.</Banner>
          <div className="card"><CompanyBasicsForm onSubmit={(v) => s.run(v)} busy={s.busy} error={s.error} submitLabel="Create company" /></div>
        </div>
      </main>
    </div>
  );
}
