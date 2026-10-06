import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  Home, Inbox, ClipboardList, Users, Receipt, Truck, Repeat, Workflow, Bot, MessageSquare, Wrench, Upload, LayoutTemplate, Settings, Bell as BellIcon, ChevronDown,
  Building2, Plus, LogOut, UserCircle2, Sun, Moon, Monitor, MoreHorizontal, Sparkles, CalendarCheck, PanelRightClose, PanelRightOpen, WifiOff, FlaskConical, RotateCcw, Check, Zap,
} from 'lucide-react';
import { useCompany, useMe } from '../lib/session';
import { get, patch, post } from '../lib/api';
import { applyTheme, readThemePref, type ThemePref } from '../lib/theme';
import { relTime } from '../lib/format';
import { Button, IconButton, Pill, useToast, useConfirm } from './ui';
import { AssistantChat } from '../pages/assistant';
import { DemoGuide, ResumeGuideButton } from '../pages/demo';
import type { Permission } from '../../shared/permissions';

export interface NavItem { key: string; label: string; to: string; icon: ReactNode; perm?: Permission | Permission[]; count?: number; section?: string }

export function useNavItems(): NavItem[] {
  const c = useCompany();
  const items: NavItem[] = [
    { key: 'home', label: 'Home', to: '', icon: <Home aria-hidden />, perm: ['jobs.view_all', 'reports.view'] },
    { key: 'today', label: 'My jobs', to: 'today', icon: <CalendarCheck aria-hidden />, perm: 'jobs.work' },
    { key: 'inbox', label: 'Inbox', to: 'inbox', icon: <Inbox aria-hidden />, count: c.attention.needs_action || undefined },
    { key: 'jobs', label: 'Jobs', to: 'jobs', icon: <ClipboardList aria-hidden />, perm: 'jobs.view_all', section: 'Operations' },
    { key: 'customers', label: 'Customers', to: 'customers', icon: <Users aria-hidden />, perm: 'customers.view', section: 'Operations' },
    { key: 'recurring', label: 'Recurring & rentals', to: 'recurring', icon: <Repeat aria-hidden />, perm: 'jobs.view_all', section: 'Operations' },
    { key: 'resources', label: 'Trucks & equipment', to: 'resources', icon: <Truck aria-hidden />, perm: 'resources.view', section: 'Operations' },
    { key: 'invoices', label: 'Invoices', to: 'invoices', icon: <Receipt aria-hidden />, perm: 'invoices.view', section: 'Billing' },
    { key: 'messages', label: 'Messages', to: 'messages', icon: <MessageSquare aria-hidden />, perm: 'messages.view', section: 'Billing' },
    { key: 'automation', label: 'Automation', to: 'automation', icon: <Zap aria-hidden />, perm: ['workflows.view', 'automation.control'], section: 'Rigo' },
    { key: 'workflows', label: 'Workflows', to: 'workflows', icon: <Workflow aria-hidden />, perm: 'workflows.view', section: 'Rigo' },
    { key: 'assistant', label: 'Assistant', to: 'assistant', icon: <Bot aria-hidden />, perm: 'assistant.use', section: 'Rigo' },
    { key: 'team', label: 'Team', to: 'team', icon: <Users aria-hidden />, perm: 'members.view', section: 'Company' },
    { key: 'services', label: 'Services & pricing', to: 'services', icon: <Wrench aria-hidden />, perm: ['services.manage', 'jobs.create'], section: 'Company' },
    { key: 'imports', label: 'Imports', to: 'imports', icon: <Upload aria-hidden />, perm: 'imports.run', section: 'Company' },
    { key: 'templates', label: 'Templates', to: 'templates', icon: <LayoutTemplate aria-hidden />, perm: 'templates.manage', section: 'Company' },
    { key: 'settings', label: 'Settings', to: 'settings', icon: <Settings aria-hidden />, perm: 'company.settings', section: 'Company' },
  ];
  return items.filter((i) => !i.perm || (Array.isArray(i.perm) ? i.perm.some((p) => c.can(p)) : c.can(i.perm)));
}

/** At most five bottom destinations; the rest live under More. */
export function bottomItems(items: NavItem[]) {
  const pref = ['home', 'today', 'jobs', 'invoices', 'inbox', 'assistant'];
  const picked = pref.map((k) => items.find((i) => i.key === k)).filter(Boolean).slice(0, 4) as NavItem[];
  return picked;
}

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onOut(); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [active, onOut, ref]);
}

function CompanySwitcher() {
  const c = useCompany();
  const me = useMe();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  const logo = c.company.branding?.logoFileId;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="company-switch" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={`Current company: ${c.company.name}. Switch company`}>
        {logo ? <img className="company-logo" src={`/api/c/${c.cid}/branding/logo?v=${logo}`} alt="" /> : <span className="company-dot" aria-hidden />}
        <span className="name">{c.company.name}</span>
        <ChevronDown aria-hidden />
      </button>
      {open && (
        <div className="menu" style={{ top: 'calc(100% + 6px)', left: 0 }}>
          <div className="small muted" style={{ padding: '6px 12px' }}>Signed in as {me.data?.user?.email}</div>
          {me.data?.companies.map((co) => (
            <a key={co.id} href={`/c/${co.id}`} aria-current={co.id === c.cid ? 'true' : undefined}>
              {co.id === c.cid ? <Check aria-hidden /> : co.kind === 'demo' ? <FlaskConical aria-hidden /> : <Building2 aria-hidden />}
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{co.name}</span>
              <span className="small muted">{co.kind === 'demo' ? 'Demo' : co.role_name}</span>
            </a>
          ))}
          <hr />
          <Link to="/workspaces" onClick={() => setOpen(false)}><Building2 aria-hidden />All workspaces</Link>
          <Link to="/workspaces/new" onClick={() => setOpen(false)}><Plus aria-hidden />Create a company</Link>
        </div>
      )}
    </div>
  );
}

function AccountMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const nav = useNavigate();
  const me = useMe();
  const [pref, setPref] = useState<ThemePref>(readThemePref());
  useClickOutside(ref, () => setOpen(false), open);
  const setTheme = async (t: ThemePref) => { setPref(t); applyTheme(t); await patch('/auth/me', { theme: t }).catch(() => {}); qc.invalidateQueries({ queryKey: ['me'] }); };
  const signOut = async () => {
    const { hasUnsynced, clearUserData } = await import('../lib/offline');
    const uid = me.data?.user?.id;
    if (uid && (await hasUnsynced(uid))) {
      setOpen(false);
      nav('/account?signout=1');
      return;
    }
    if (uid) await clearUserData(uid);
    await post('/auth/signout');
    qc.clear();
    nav('/signin');
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <IconButton label="Account and theme" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}><UserCircle2 aria-hidden /></IconButton>
      {open && (
        <div className="menu" style={{ top: 'calc(100% + 6px)', right: 0 }}>
          <div style={{ padding: '6px 12px' }}><strong>{me.data?.user?.name}</strong><div className="small muted">{me.data?.user?.email}</div></div>
          <hr />
          <div className="small muted" style={{ padding: '4px 12px' }} id="theme-label">Theme</div>
          <div role="radiogroup" aria-labelledby="theme-label">
            {([['light', 'Light', <Sun key="l" aria-hidden />], ['dark', 'Dark', <Moon key="d" aria-hidden />], ['system', 'System', <Monitor key="s" aria-hidden />]] as const).map(([k, label, icon]) => (
              <button key={k} role="radio" aria-checked={pref === k} className="menu-item" onClick={() => setTheme(k)}>{icon}<span style={{ flex: 1 }}>{label}</span>{pref === k ? <Check aria-hidden /> : null}</button>
            ))}
          </div>
          <hr />
          <Link to="/account" onClick={() => setOpen(false)}><UserCircle2 aria-hidden />Account</Link>
          <button className="menu-item" onClick={signOut}><LogOut aria-hidden />Sign out</button>
        </div>
      )}
    </div>
  );
}

function NotificationBell() {
  const c = useCompany();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  useClickOutside(ref, () => setOpen(false), open);
  const q = useQuery({ queryKey: [c.cid, 'bell'], queryFn: () => get(`/c/${c.cid}/notifications?state=all`), enabled: open });
  const markAll = useMutation({ mutationFn: () => post(`/c/${c.cid}/notifications/read`, { all: true }), onSuccess: () => { qc.invalidateQueries({ queryKey: [c.cid] }); } });
  const unread = c.attention.unread;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <IconButton label="Notifications" badge={unread} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}><BellIcon aria-hidden /></IconButton>
      {open && (
        <div className="menu" style={{ top: 'calc(100% + 6px)', right: 0, width: 360 }}>
          <div className="row-between" style={{ padding: '6px 8px 6px 12px' }}><strong>Updates</strong>{unread ? <Button size="sm" variant="ghost" onClick={() => markAll.mutate()}>Mark all read</Button> : null}</div>
          {q.isLoading ? <div style={{ padding: 12 }} className="muted">Loading…</div> : null}
          {q.data?.notifications.slice(0, 8).map((n: any) => (
            <Link key={n.id} to={n.link ? c.to(n.link) : c.to('inbox')} onClick={() => setOpen(false)} style={{ alignItems: 'flex-start', paddingTop: 8, paddingBottom: 8 }}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, marginTop: 8, background: n.read_at ? 'transparent' : 'var(--primary)', flex: 'none' }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: n.read_at ? 500 : 700 }}>{n.title}{n.read_at ? '' : <span className="sr-only"> (unread)</span>}</span>
                <span className="small muted">{n.category === 'needs_action' ? 'Needs action' : n.category === 'warning' ? 'Warning' : 'Update'} · {relTime(n.created_at)}</span>
              </span>
            </Link>
          ))}
          {q.data && !q.data.notifications.length ? <div style={{ padding: 12 }} className="muted">No notifications yet.</div> : null}
          <hr />
          <Link to={c.to('inbox')} onClick={() => setOpen(false)}><Inbox aria-hidden />Open action inbox</Link>
        </div>
      )}
    </div>
  );
}

function DemoBar() {
  const c = useCompany();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const { ask, node } = useConfirm();
  if (!c.demo) return null;
  const setRole = async (role: string) => {
    await post(`/c/${c.cid}/demo/role`, { role });
    await qc.invalidateQueries({ queryKey: [c.cid] });
    toast(`Now viewing as ${role === 'office' ? 'Office / billing' : role} (simulated)`, 'info');
    nav(c.to(role === 'driver' ? 'today' : ''));
  };
  const reset = async () => {
    if (!(await ask({ title: 'Reset the demo?', body: 'Everything you changed in this demo is replaced with fresh fictional data. Your real companies are not affected.', confirm: 'Reset demo', danger: true }))) return;
    const r = await post(`/c/${c.cid}/demo/reset`);
    qc.clear();
    nav(`/c/${r.id}`);
  };
  return (
    <div className="banner banner-demo" role="region" aria-label="Demo workspace">
      <FlaskConical aria-hidden />
      <strong className="nowrap">Demo workspace</strong>
      <span className="hide-mobile small">Fictional data. Nothing is sent, charged or connected.</span>
      <span className="spacer" />
      <label className="row small" style={{ gap: 6, minWidth: 0, maxWidth: '100%', flexWrap: 'nowrap' }}>
        <span className="hide-mobile">View as</span>
        <select className="select" style={{ minHeight: 36, padding: '4px 8px', width: 'auto', maxWidth: '100%', minWidth: 0 }} value={c.demo.simRole} onChange={(e) => setRole(e.target.value)} aria-label="Simulated role">
          <option value="owner">Owner</option><option value="dispatcher">Dispatcher (simulated)</option><option value="driver">Driver (simulated)</option><option value="office">Office (simulated)</option>
        </select>
      </label>
      <span className="hide-mobile"><ResumeGuideButton /></span>
      <button className="btn btn-sm btn-ghost" onClick={reset}><RotateCcw aria-hidden />Reset</button>
      <Link className="btn btn-sm" style={{ background: 'var(--canvas)', color: 'var(--text)' }} to={c.to('setup-company')}>Set up my company</Link>
      {node}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const c = useCompany();
  const items = useNavItems();
  const online = useOnline();
  const loc = useLocation();
  const [assistantOpen, setAssistantOpen] = useState(() => { try { return localStorage.getItem('rigo-assistant') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('rigo-assistant', assistantOpen ? '1' : '0'); } catch { /* ignore */ } }, [assistantOpen]);
  const bottom = bottomItems(items);
  const more = items.filter((i) => !bottom.includes(i));
  const sections = [...new Set(items.map((i) => i.section ?? ''))];
  const isActive = (to: string) => (to === '' ? loc.pathname === c.to('') || loc.pathname === c.to('') + '/' : loc.pathname.startsWith(c.to(to)));
  const canAssistant = c.can('assistant.use');
  return (
    <div className="shell">
      <a href="#main" className="skip-link">Skip to content</a>
      <DemoBar />
      <header className="topbar">
        <Link to={c.to('')} className="brand"><span className="brand-mark" aria-hidden>R</span><span className="hide-mobile">Rigo</span><span className="sr-only hide-desktop">Rigo</span><span className="sr-only"> home</span></Link>
        <CompanySwitcher />
        {c.role.simulated ? <Pill tone="demo">{c.role.name} view</Pill> : <span className="hide-mobile"><Pill tone="neutral">{c.role.name}</Pill></span>}
        <span className="spacer" />
        {canAssistant && (
          <span className="hide-mobile">
            <IconButton label={assistantOpen ? 'Close assistant panel' : 'Open assistant panel'} aria-pressed={assistantOpen} onClick={() => setAssistantOpen((o) => !o)}>{assistantOpen ? <PanelRightClose aria-hidden /> : <PanelRightOpen aria-hidden />}</IconButton>
          </span>
        )}
        <NotificationBell />
        <AccountMenu />
      </header>
      {!online && <div className="banner banner-warning" style={{ borderRadius: 0 }} role="status"><WifiOff aria-hidden /><span><strong>You are offline.</strong> Saved job drafts stay on this device until you reconnect. Other pages may show out-of-date information.</span></div>}
      {c.company.paused && c.can('workflows.view') && <div className="banner banner-warning" style={{ borderRadius: 0 }} role="status"><Zap aria-hidden /><span><strong>Automation is paused.</strong> Queued steps are held; nothing new runs until it is resumed. <Link to={c.to('automation')}>Automation controls</Link></span></div>}
      <div className="layout">
        <nav className="sidebar" aria-label="Main">
          {sections.map((s) => (
            <div key={s || 'top'}>
              {s ? <div className="nav-section">{s}</div> : null}
              {items.filter((i) => (i.section ?? '') === s).map((i) => (
                <NavLink key={i.key} to={c.to(i.to)} end={i.to === ''} className={() => `nav-link${isActive(i.to) ? ' active' : ''}`} aria-current={isActive(i.to) ? 'page' : undefined}>
                  {i.icon}<span>{i.label}</span>{i.count ? <span className="count" aria-label={`${i.count} need action`}>{i.count}</span> : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <main id="main" className="main" tabIndex={-1}>{c.demo && !c.demo.guide.dismissed && <DemoGuide />}{children}</main>
        {canAssistant && assistantOpen && (
          <aside className="assistant-panel open" aria-label="Assistant">
            <div className="row-between" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}><h2 className="row" style={{ fontSize: '1rem' }}><Sparkles aria-hidden style={{ width: 18 }} />Assistant</h2><IconButton label="Close assistant panel" onClick={() => setAssistantOpen(false)}><PanelRightClose aria-hidden /></IconButton></div>
            <AssistantChat compact />
          </aside>
        )}
      </div>
      <nav className="bottom-nav" aria-label="Main">
        {bottom.map((i) => (
          <NavLink key={i.key} to={c.to(i.to)} end={i.to === ''} className={() => (isActive(i.to) ? 'active' : '')} aria-current={isActive(i.to) ? 'page' : undefined}>
            {i.icon}<span>{i.label}</span>{i.count ? <span className="nav-dot" aria-label={`${i.count} need action`}>{i.count}</span> : null}
          </NavLink>
        ))}
        {more.length > 0 && <NavLink to={c.to('more')} className={() => (isActive('more') ? 'active' : '')}><MoreHorizontal aria-hidden /><span>More</span></NavLink>}
      </nav>
    </div>
  );
}

export function MorePage() {
  const c = useCompany();
  const items = useNavItems();
  const bottom = bottomItems(items);
  const more = items.filter((i) => !bottom.includes(i));
  return (
    <div className="page page-narrow">
      <h1>More</h1>
      <div className="card card-flush">
        <ul className="list">
          {more.map((i) => <li key={i.key}><Link className="list-item" to={c.to(i.to)} style={{ alignItems: 'center' }}>{i.icon}<span style={{ flex: 1 }}>{i.label}</span>{i.count ? <Pill tone="brand">{i.count}</Pill> : null}</Link></li>)}
          <li><Link className="list-item" to="/workspaces" style={{ alignItems: 'center' }}><Building2 aria-hidden /><span>All workspaces</span></Link></li>
          <li><Link className="list-item" to="/account" style={{ alignItems: 'center' }}><UserCircle2 aria-hidden /><span>Account and theme</span></Link></li>
        </ul>
      </div>
    </div>
  );
}
