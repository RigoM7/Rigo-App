import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sun, CalendarDays, Users, Wallet, Settings as SettingsIcon, Inbox as InboxIcon, Search, ChevronsUpDown, Plus, LogOut, UserRound, Moon, Monitor, Check as CheckIcon, Briefcase, CheckCircle2, ListTodo, Clock, Eye, PauseCircle, Sparkles, WifiOff, CloudUpload } from 'lucide-react';
import { useMe, useWorkspace, signOutAndForget, workspaceMeta } from '../lib/session';
import { get, post, patch } from '../lib/api';
import { applyTheme, readThemePref, type ThemePref } from '../lib/theme';
import { initials } from '../lib/format';
import { BrandMark, Menu, Button, useToast } from './ui';
import { useAutoSync } from '../lib/autosync';
import { listDrafts, onDraftsChanged, isUnsent } from '../lib/offline';

// The frame around every workspace screen. Office: five places (Today, Work, Customers, Money,
// Settings) plus the inbox and search, in the workspace's words. Workers: Today, Upcoming, Done.

function WorkspaceSwitcher({ compact }: { compact?: boolean }) {
  const ws = useWorkspace();
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [theme, setTheme] = useState<ThemePref>(readThemePref());
  const others = (me.data?.companies ?? []).filter((c) => c.id !== ws.cid);
  const setPref = (t: ThemePref) => { setTheme(t); applyTheme(t); void patch('/auth/me', { theme: t }).catch(() => {}); };
  return (
    <Menu button={({ open, toggle, id }) => (
      <button className="ws-switch" onClick={toggle} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="true" style={compact ? { maxWidth: 'calc(100vw - 150px)' } : { width: '100%' }}>
        <span className="ws-avatar" aria-hidden="true">{initials(ws.workspace.name)}</span>
        <span style={{ display: 'grid', minWidth: 0, flex: 1 }}>
          <span className="ws-name">{ws.workspace.name}</span>
          <span className="ws-role">{ws.workspace.kind === 'demo' ? 'Demo' : ws.role.name}</span>
        </span>
        <ChevronsUpDown size={16} aria-hidden="true" />
      </button>
    )}>
      {(close) => (
        <>
          {others.length > 0 && <div className="menu-label">Switch workspace</div>}
          {others.slice(0, 6).map((c) => (
            <Link key={c.id} to={`/w/${c.id}`} onClick={close}>
              <span className="ws-avatar" aria-hidden="true" style={{ width: 28, height: 28, fontSize: '.8rem' }}>{initials(c.name)}</span>
              <span style={{ display: 'grid' }}><span>{c.name}</span><span className="tiny muted">{workspaceMeta(c)}</span></span>
            </Link>
          ))}
          <Link to="/start" onClick={close}><Plus size={18} aria-hidden="true" />New workspace</Link>
          {others.length > 5 && <Link to="/workspaces" onClick={close}><Briefcase size={18} aria-hidden="true" />All workspaces</Link>}
          <hr />
          <div className="menu-label">Theme</div>
          {([['light', 'Light', <Sun key="l" size={18} />], ['dark', 'Dark', <Moon key="d" size={18} />], ['system', 'Same as this device', <Monitor key="s" size={18} />]] as const).map(([v, label, icon]) => (
            <button key={v} onClick={() => setPref(v)} aria-pressed={theme === v}>{icon}{label}{theme === v && <CheckIcon size={16} style={{ marginLeft: 'auto' }} aria-hidden="true" />}</button>
          ))}
          <hr />
          <Link to="/account" onClick={close}><UserRound size={18} aria-hidden="true" />Your account</Link>
          <button onClick={async () => { close(); await signOutAndForget(qc); nav('/signin'); }}><LogOut size={18} aria-hidden="true" />Sign out</button>
        </>
      )}
    </Menu>
  );
}

// ---------------------------------------------------------------- search

interface SearchResult { work: any[]; customers: any[]; people: any[] }

function SearchDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 150); return () => clearTimeout(t); }, [q]);
  useEffect(() => { input.current?.focus(); }, []);
  const r = useQuery({ queryKey: [ws.cid, 'search', debounced], queryFn: () => get<SearchResult>(`/c/${ws.cid}/search?q=${encodeURIComponent(debounced)}`), enabled: debounced.length > 0 });
  const jump = useMemo(() => {
    const places = [
      { label: 'Today', to: ws.to() },
      { label: ws.words.work.many, to: ws.to('work'), perm: ws.can('work.view_all') },
      { label: `New ${ws.words.work.one.toLowerCase()}`, to: ws.to('work/new'), perm: ws.can('work.create') },
      { label: ws.words.customer.many, to: ws.to('customers'), perm: ws.can('customers.view') },
      { label: `New ${ws.words.customer.one.toLowerCase()}`, to: ws.to('customers/new'), perm: ws.can('customers.edit') },
      { label: 'Money', to: ws.to('money'), perm: ws.can('money.view') },
      { label: 'Inbox', to: ws.to('inbox') },
      { label: 'Settings', to: ws.to('settings') },
    ].filter((x) => x.perm !== false);
    return places.filter((p) => !q || p.label.toLowerCase().includes(q.toLowerCase()));
  }, [q, ws]);
  const items = [
    ...jump.map((j) => ({ key: `j-${j.to}`, group: 'Go to', label: j.label, sub: '', to: j.to })),
    ...(r.data?.work ?? []).map((w) => ({ key: `w-${w.id}`, group: ws.words.work.many, label: `#${w.number} ${w.title || w.client_name || ''}`, sub: [w.client_name, w.stage_name].filter(Boolean).join(' · '), to: ws.to(`work/${w.id}`) })),
    ...(r.data?.customers ?? []).map((c) => ({ key: `c-${c.id}`, group: ws.words.customer.many, label: c.name, sub: c.address ?? '', to: ws.to(`customers/${c.id}`) })),
    ...(r.data?.people ?? []).map((p) => ({ key: `p-${p.id}`, group: ws.words.person.many, label: p.name, sub: p.role_name, to: ws.to('settings/people') })),
  ];
  const go = (to: string) => { onClose(); nav(to); };
  let lastGroup = '';
  return (
    <div className="scrim sheet-top" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="search-box" role="dialog" aria-modal="true" aria-label="Search">
        <div className="search-input">
          <Search size={20} aria-hidden="true" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder={`Search ${ws.words.work.many.toLowerCase()}, ${ws.words.customer.many.toLowerCase()}, people`}
            aria-label="Search" role="combobox" aria-expanded="true" aria-controls="search-results" aria-activedescendant={items[sel] ? `sr-${items[sel].key}` : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              if (e.key === 'Enter' && items[sel]) go(items[sel].to);
            }} />
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="search-results" id="search-results" role="listbox" aria-label="Results">
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? <div className="menu-label" key={`g-${it.group}`}>{it.group}</div> : null;
            lastGroup = it.group;
            return [head, (
              <a key={it.key} id={`sr-${it.key}`} role="option" aria-selected={i === sel} href={it.to} onClick={(e) => { e.preventDefault(); go(it.to); }} onMouseEnter={() => setSel(i)}>
                <span style={{ display: 'grid', minWidth: 0 }}><span className="wrap-anywhere">{it.label}</span>{it.sub && <span className="tiny muted">{it.sub}</span>}</span>
              </a>
            )];
          })}
          {debounced && !r.isLoading && items.length === 0 && <p className="muted" style={{ padding: 12 }}>Nothing matches “{debounced}”.</p>}
        </div>
      </div>
    </div>
  );
}

function useSearchHotkey(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}

// ---------------------------------------------------------------- demo ribbon

function DemoRibbon() {
  const ws = useWorkspace();
  const toast = useToast();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  if (ws.workspace.kind !== 'demo') return null;
  // Switching view opens that role's first screen.
  const view = async (role: string) => { await post(`/c/${ws.cid}/demo/view`, { role }); ws.refresh(); nav(ws.to()); };
  const workerRole = ws.roles.find((r) => r.app === 'worker');
  return (
    <div className="demo-ribbon" role="region" aria-label="Demo">
      <span><Eye size={16} aria-hidden="true" style={{ verticalAlign: '-3px' }} /> Demo<span className="ribbon-long">: nothing here is sent, charged or connected</span>.</span>
      {ws.role.simulated
        ? <button className="btn btn-sm" onClick={() => view('owner')}>Back to the owner’s view</button>
        : <>
          {workerRole && <button className="btn btn-sm" onClick={() => view(workerRole.key)}>See it as a {workerRole.name.toLowerCase()}</button>}
          {!ws.demo?.sample && <button className="btn btn-sm" disabled={busy} onClick={async () => {
            setBusy(true);
            try { const r = await post<{ already?: boolean }>(`/c/${ws.cid}/demo/sample`); toast(r.already ? 'Sample data is already here.' : 'Sample data added.'); ws.refresh(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
          }}><Sparkles size={16} aria-hidden="true" />Show sample data</button>}
        </>}
    </div>
  );
}

function PausedBanner() {
  const ws = useWorkspace();
  if (!ws.workspace.automation.paused) return null;
  return (
    <div className="banner banner-attn" style={{ borderRadius: 0 }} role="status">
      <PauseCircle aria-hidden="true" />
      <div className="grow"><strong>Rigo is paused.</strong> <span className="small">Nothing is prepared or sent on its own until it is resumed.</span></div>
      {ws.can('automation.control') && <Link className="btn btn-sm" to={ws.to('settings/automation')}>Resume</Link>}
    </div>
  );
}

// ---------------------------------------------------------------- office

export function OfficeShell({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const [searching, setSearching] = useState(false);
  useSearchHotkey(() => setSearching(true));
  const loc = useLocation();
  useEffect(() => { setSearching(false); }, [loc.pathname]);
  const inboxCount = useQuery({ queryKey: [ws.cid, 'inbox-count'], queryFn: async () => {
    const r = await get<any>(`/c/${ws.cid}/inbox`);
    return r.approvals.length + r.requests.length + r.held.length;
  }, refetchInterval: 60_000 });
  const n = inboxCount.data ?? 0;
  const places = [
    { to: ws.to(), label: 'Today', icon: <Sun />, end: true, show: true },
    { to: ws.to('work'), label: ws.words.work.many, icon: <CalendarDays />, show: ws.can('work.view_all') },
    { to: ws.to('customers'), label: ws.words.customer.many, icon: <Users />, show: ws.can('customers.view') },
    { to: ws.to('money'), label: 'Money', icon: <Wallet />, show: ws.can('money.view') },
    { to: ws.to('settings'), label: 'Settings', icon: <SettingsIcon />, show: true },
  ].filter((p) => p.show);
  return (
    <div className="app">
      <a href="#main" className="skip-link">Skip to content</a>
      <DemoRibbon />
      <div className="layout">
        <aside className="sidebar" aria-label="Workspace">
          <WorkspaceSwitcher />
          <button className="search-trigger" onClick={() => setSearching(true)}><Search size={18} aria-hidden="true" />Search<kbd aria-hidden="true">⌘K</kbd></button>
          <nav aria-label="Main">
            <ul className="nav">
              {places.map((p) => <li key={p.to}><NavLink to={p.to} end={p.end}>{p.icon}{p.label}</NavLink></li>)}
              <li><NavLink to={ws.to('inbox')}><InboxIcon />Inbox{n > 0 && <span className="count count-attn" aria-label={`${n} waiting`}>{n}</span>}</NavLink></li>
            </ul>
          </nav>
          <div className="spacer" />
          <div className="row tiny muted" style={{ padding: '0 12px' }}><BrandMark size={18} /> Rigo</div>
        </aside>
        <div style={{ minWidth: 0 }}>
          <header className="topbar app-topbar">
            <WorkspaceSwitcher compact />
            <span className="grow" />
            <button className="btn btn-ghost icon-btn" aria-label="Search" onClick={() => setSearching(true)}><Search size={20} /></button>
            <Link to={ws.to('inbox')} className="btn btn-ghost icon-btn" aria-label={n ? `Inbox, ${n} waiting` : 'Inbox'} style={{ position: 'relative' }}>
              <InboxIcon size={20} aria-hidden="true" />
              {n > 0 && <span className="count count-attn" style={{ position: 'absolute', top: 4, right: 2, transform: 'scale(.85)' }} aria-hidden="true">{n}</span>}
            </Link>
          </header>
          <PausedBanner />
          <main id="main" className="main" tabIndex={-1}>{children}</main>
        </div>
      </div>
      <nav className="bottombar office-bar" aria-label="Main">
        {places.map((p) => <NavLink key={p.to} to={p.to} end={p.end}>{p.icon}<span>{p.label}</span></NavLink>)}
      </nav>
      {searching && <SearchDialog onClose={() => setSearching(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- worker

function SyncStatus() {
  const ws = useWorkspace();
  const me = useMe();
  const uid = me.data?.user?.id ?? '';
  const [waiting, setWaiting] = useState(0);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const read = () => { void listDrafts(uid, ws.cid).then((ds) => setWaiting(ds.filter((d) => isUnsent(d) && d.state !== 'local').length)); };
    read();
    const stop = onDraftsChanged(read);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { stop(); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [uid, ws.cid]);
  if (!online) return <span className="sync-line" role="status"><WifiOff aria-hidden="true" />No signal{waiting ? ` · ${waiting} saved on this phone` : ''}</span>;
  if (waiting) return <span className="sync-line" role="status"><CloudUpload aria-hidden="true" />Sending {waiting}…</span>;
  return <span className="sync-line" role="status"><CheckCircle2 aria-hidden="true" />All sent</span>;
}

export function WorkerShell({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const me = useMe();
  useAutoSync(me.data?.user?.id ?? '', ws.cid, !!me.data?.user);
  return (
    <div className="app">
      <a href="#main" className="skip-link">Skip to content</a>
      <DemoRibbon />
      <header className="topbar">
        <WorkspaceSwitcher compact />
        <span className="grow" />
        <SyncStatus />
      </header>
      {ws.offlineSince && <div className="banner banner-attn" style={{ borderRadius: 0 }}><WifiOff aria-hidden="true" /><div className="grow small">No signal. Showing what was saved on this phone.</div></div>}
      <main id="main" className="worker-main" tabIndex={-1}>{children}</main>
      <nav className="bottombar" aria-label="Main">
        <NavLink to={ws.to()} end><ListTodo /><span>Today</span></NavLink>
        <NavLink to={ws.to('upcoming')}><Clock /><span>Upcoming</span></NavLink>
        <NavLink to={ws.to('done')}><CheckCircle2 /><span>Done</span></NavLink>
      </nav>
    </div>
  );
}

export { Button };
