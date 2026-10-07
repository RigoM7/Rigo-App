import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  Home, Inbox, ClipboardList, Users, Receipt, Wallet, Truck, Repeat, Workflow, Bot, MessageSquare, Wrench, Upload, LayoutTemplate, Settings, Bell as BellIcon, ChevronDown,
  Building2, Plus, LogOut, UserCircle2, Sun, Moon, Monitor, MoreHorizontal, CalendarCheck, WifiOff, FlaskConical, RotateCcw, Check, Zap, Search, PanelLeftClose, PanelLeftOpen,
  UserRound, Contact, FileText, CreditCard, PauseCircle, ArrowRight, Clock, UsersRound,
} from 'lucide-react';
import { refreshMe, signOutAndForget, useCompany, useMe } from '../lib/session';
import { useAutoSync } from '../lib/autosync';
import { get, patch, post } from '../lib/api';
import { applyTheme, readThemePref, type ThemePref } from '../lib/theme';
import { relTime } from '../lib/format';
import { Button, IconButton, Pill, Wordmark, useToast, useConfirm } from './ui';
import { DemoGuide, ResumeGuideButton } from '../pages/demo';
import type { Permission } from '../../shared/permissions';
import { accentVariants } from '../../shared/branding';
import { useDocumentTitle } from '../lib/title';

export interface NavItem { key: string; label: string; to: string; icon: ReactNode; perm?: Permission | Permission[]; count?: number; section: string }

// Sidebar groups, in order. Each role sees only the items its permissions allow.
const SECTIONS = ['Operations', 'People & places', 'Fleet', 'Money', 'Communication', 'Rigo', 'Setup'] as const;

export function useNavItems(): NavItem[] {
  const c = useCompany();
  const items: NavItem[] = [
    { key: 'home', label: 'Home', to: '', icon: <Home aria-hidden />, perm: ['jobs.view_all', 'reports.view'], section: 'Operations' },
    { key: 'today', label: 'My jobs', to: 'today', icon: <CalendarCheck aria-hidden />, perm: 'jobs.work', section: 'Operations' },
    { key: 'inbox', label: 'Inbox', to: 'inbox', icon: <Inbox aria-hidden />, count: c.attention.needs_action || undefined, section: 'Operations' },
    { key: 'jobs', label: 'Jobs', to: 'jobs', icon: <ClipboardList aria-hidden />, perm: 'jobs.view_all', section: 'Operations' },
    { key: 'recurring', label: 'Recurring & rentals', to: 'recurring', icon: <Repeat aria-hidden />, perm: 'jobs.view_all', section: 'Operations' },
    { key: 'customers', label: 'Customers', to: 'customers', icon: <Contact aria-hidden />, perm: 'customers.view', section: 'People & places' },
    { key: 'team', label: 'Team', to: 'team', icon: <UsersRound aria-hidden />, perm: 'members.view', section: 'People & places' },
    { key: 'resources', label: 'Trucks & equipment', to: 'resources', icon: <Truck aria-hidden />, perm: 'resources.view', section: 'Fleet' },
    { key: 'invoices', label: 'Invoices', to: 'invoices', icon: <Receipt aria-hidden />, perm: 'invoices.view', section: 'Money' },
    { key: 'collections', label: 'Collections', to: 'collections', icon: <Wallet aria-hidden />, perm: 'finance.view', section: 'Money' },
    { key: 'messages', label: 'Messages', to: 'messages', icon: <MessageSquare aria-hidden />, perm: 'messages.view', section: 'Communication' },
    { key: 'assistant', label: 'Assistant', to: 'assistant', icon: <Bot aria-hidden />, perm: 'assistant.use', section: 'Rigo' },
    { key: 'automation', label: 'Automation', to: 'automation', icon: <Zap aria-hidden />, perm: ['workflows.view', 'automation.control'], section: 'Rigo' },
    { key: 'workflows', label: 'Workflows', to: 'workflows', icon: <Workflow aria-hidden />, perm: 'workflows.view', section: 'Rigo' },
    { key: 'services', label: 'Services & pricing', to: 'services', icon: <Wrench aria-hidden />, perm: ['services.manage', 'jobs.create'], section: 'Setup' },
    { key: 'imports', label: 'Imports', to: 'imports', icon: <Upload aria-hidden />, perm: 'imports.run', section: 'Setup' },
    { key: 'templates', label: 'Templates', to: 'templates', icon: <LayoutTemplate aria-hidden />, perm: 'templates.manage', section: 'Setup' },
    { key: 'settings', label: 'Settings', to: 'settings', icon: <Settings aria-hidden />, perm: 'company.settings', section: 'Setup' },
  ];
  return items.filter((i) => !i.perm || (Array.isArray(i.perm) ? i.perm.some((p) => c.can(p)) : c.can(i.perm)));
}

/** At most five bottom destinations: four plus More. */
export function bottomItems(items: NavItem[]) {
  const pref = ['home', 'today', 'jobs', 'invoices', 'inbox', 'assistant'];
  return pref.map((k) => items.find((i) => i.key === k)).filter(Boolean).slice(0, 4) as NavItem[];
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

const initial = (name: string) => (name.replace(/[^A-Za-z0-9]/g, '').charAt(0) || '?').toUpperCase();

/** Company chip: the company's logo, or its initial on its accent color (the variant that keeps white text readable). */
export function CompanyChip({ cid, name, logo, accent }: { cid: string; name: string; logo?: string | null; accent?: string | null }) {
  return logo ? <img className="company-logo" src={`/api/c/${cid}/branding/logo?v=${logo}`} alt="" /> : <span className="company-chip" aria-hidden data-initial={initial(name)} style={{ background: accentVariants(accent).light }} />;
}

function CompanySwitcher() {
  const c = useCompany();
  const me = useMe();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 'min(112px, 30vw)', flex: '0 1 auto', maxWidth: 'min(42vw, 360px)' }}>
      <button className="company-switch" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CompanyChip cid={c.cid} name={c.company.name} logo={c.company.branding?.logoFileId} accent={c.company.branding?.accent} />
        <span className="name"><span className="sr-only">Current company: </span>{c.company.name}</span>
        <ChevronDown aria-hidden />
      </button>
      {open && (
        <div className="menu" style={{ top: 'calc(100% + 8px)', left: 0 }}>
          <div className="menu-label">Signed in as {me.data?.user?.email}</div>
          {me.data?.companies.map((co) => (
            <a key={co.id} href={`/c/${co.id}`} aria-current={co.id === c.cid ? 'true' : undefined}>
              {co.id === c.cid ? <Check aria-hidden /> : co.kind === 'demo' ? <FlaskConical aria-hidden /> : <Building2 aria-hidden />}
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{co.name}</span>
              <span className="xsmall muted">{co.kind === 'demo' ? 'Demo' : co.role_name}</span>
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
    await signOutAndForget(qc);
    nav('/signin');
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <IconButton label="Account and theme" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}><UserCircle2 aria-hidden /></IconButton>
      {open && (
        <div className="menu" style={{ top: 'calc(100% + 8px)', right: 0 }}>
          <div style={{ padding: '6px 10px' }}><strong className="small">{me.data?.user?.name}</strong><div className="xsmall muted">{me.data?.user?.email}</div></div>
          <hr />
          <div className="menu-label" id="theme-label">Theme</div>
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

/**
 * The bell keeps what needs action apart from updates (R14-m5), and folds "X joined the company"
 * into one line when several people joined.
 */
function bellGroups(list: any[]) {
  const top = list.slice(0, 12);
  const action = top.filter((n) => n.category === 'needs_action');
  let updates = top.filter((n) => n.category !== 'needs_action');
  const joins = updates.filter((n) => / joined /.test(n.title));
  if (joins.length > 1) {
    const names = joins.map((n) => n.title.split(' joined ')[0]);
    updates = [{ ...joins[0], id: `joins-${joins[0].id}`, title: `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''} joined the company`, read_at: joins.every((n) => n.read_at) ? joins[0].read_at : null, link: 'team' },
      ...updates.filter((n) => !joins.includes(n))];
  }
  return [{ key: 'action', label: 'Needs action', items: action }, { key: 'updates', label: 'Updates', items: updates }];
}

/** "Automation paused by Dana at 2:10 PM · Resume", on every page for people who see automation (R14-m4). */
function PausedBanner() {
  const c = useCompany();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!c.company.paused || !(c.can('workflows.view') || c.can('automation.control'))) return null;
  const who = c.members.find((m) => m.id === c.company.paused_by)?.name;
  const when = c.company.paused_at ? new Intl.DateTimeFormat(undefined, { timeStyle: 'short', dateStyle: 'medium', timeZone: c.company.timezone }).format(new Date(c.company.paused_at)) : null;
  const resume = async () => { setBusy(true); try { await patch(`/c/${c.cid}/automation`, { paused: false }); await refreshMe(qc); qc.invalidateQueries({ queryKey: [c.cid] }); toast('Automation resumed. Held steps continue.'); } finally { setBusy(false); } };
  return (
    <div className="banner banner-warning paused-banner" role="status">
      <PauseCircle aria-hidden />
      <div className="row-between" style={{ flex: 1, gap: 12 }}>
        <span><strong>Automation is paused</strong>{who || when ? ` by ${who ?? 'someone'}${when ? ` since ${when}` : ''}` : ''}. Nothing new runs; held steps wait.</span>
        <span className="row">{c.can('automation.control') ? <Button size="sm" busy={busy} onClick={resume}>Resume</Button> : null}<Link className="small" to={c.to('automation')}>Automation</Link></span>
      </div>
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
        <div className="menu" style={{ top: 'calc(100% + 8px)', right: 0, width: 360 }}>
          <div className="row-between" style={{ padding: '4px 4px 4px 10px' }}><strong className="small">Notifications</strong>{unread ? <Button size="sm" variant="ghost" onClick={() => markAll.mutate()}>Mark all read</Button> : null}</div>
          {q.isLoading ? <div style={{ padding: 12 }} className="small muted">Loading…</div> : null}
          {q.data ? bellGroups(q.data.notifications).map((g) => g.items.length ? (
            <div key={g.key} role="group" aria-label={g.label}>
              <div className="bell-group xsmall muted">{g.label}</div>
              {g.items.map((n: any) => (
                <Link key={n.id} to={n.link ? c.to(n.link) : c.to('inbox')} onClick={() => setOpen(false)} style={{ alignItems: 'flex-start', paddingTop: 8, paddingBottom: 8 }}>
                  <span aria-hidden style={{ width: 7, height: 7, borderRadius: 4, marginTop: 7, background: n.read_at ? 'transparent' : 'var(--primary)', flex: 'none' }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: n.read_at ? 500 : 650 }}>{n.title}{n.read_at ? '' : <span className="sr-only"> (unread)</span>}</span>
                    <span className="xsmall muted">{n.body ? `${n.body.slice(0, 80)}${n.body.length > 80 ? '…' : ''} · ` : ''}{relTime(n.created_at)}</span>
                  </span>
                </Link>
              ))}
            </div>
          ) : null) : null}
          {q.data && !q.data.notifications.length ? <div style={{ padding: 12 }} className="small muted">No notifications yet.</div> : null}
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
    toast(role === 'owner' ? 'Now viewing as Owner' : `Now viewing as ${role === 'office' ? 'Office / billing' : role.charAt(0).toUpperCase() + role.slice(1)} (simulated)`, 'info');
    nav(c.to(role === 'driver' ? 'today' : ''));
  };
  const reset = async () => {
    if (!(await ask({ title: 'Reset the demo?', body: 'Everything you changed in this demo is replaced with fresh fictional data. Your real companies are not affected.', confirm: 'Reset demo', danger: true }))) return;
    const r = await post(`/c/${c.cid}/demo/reset`);
    qc.clear();
    await refreshMe(qc);
    nav(`/c/${r.id}`);
  };
  return (
    <div className="banner banner-demo" role="region" aria-label="Demo workspace">
      <FlaskConical aria-hidden />
      <strong className="nowrap"><span className="hide-mobile">Demo workspace</span><span className="hide-desktop">Demo</span></strong>
      {/* The safety line stays visible on phones, shortened. */}
      <span className="muted-chrome demo-note"><span className="hide-mobile">Fictional data. Nothing is sent, charged or connected.</span><span className="hide-desktop">Fictional. Nothing is sent or charged.</span></span>
      <span className="spacer" />
      <button className="btn btn-sm demo-reset" onClick={reset}><RotateCcw aria-hidden />Reset<span className="sr-only"> demo</span></button>
      <span className="demo-break" aria-hidden />
      <label className="row small demo-role" style={{ gap: 8, minWidth: 0, maxWidth: '100%', flexWrap: 'nowrap' }}>
        <span className="muted-chrome nowrap">View as</span>
        <select className="select" style={{ minHeight: 34, padding: '2px 32px 2px 10px', width: 'auto', maxWidth: '100%', minWidth: 0, fontSize: 'var(--fs-14)' }} value={c.demo.simRole} onChange={(e) => setRole(e.target.value)} aria-label="Simulated role">
          <option value="owner">Owner</option><option value="dispatcher">Dispatcher</option><option value="driver">Driver</option><option value="office">Office / billing</option>
        </select>
      </label>
      <ResumeGuideButton />
      <Link className="btn btn-sm btn-invert demo-setup" to={c.to('setup-company')}>Set up my company</Link>
      {node}
    </div>
  );
}

// ------------------------------------------------------------ command menu (Ctrl/Cmd+K)

interface Cmd { id: string; group: string; label: string; meta?: string; icon: ReactNode; to: string }

function recentKey(cid: string) { return `rigo-recent-${cid}`; }
function readRecent(cid: string): Cmd[] {
  try { return (JSON.parse(localStorage.getItem(recentKey(cid)) ?? '[]') as Omit<Cmd, 'icon'>[]).slice(0, 5).map((r) => ({ ...r, group: 'Recent', icon: <Clock aria-hidden /> })); } catch { return []; }
}
function pushRecent(cid: string, cmd: Cmd) {
  try {
    const list = (JSON.parse(localStorage.getItem(recentKey(cid)) ?? '[]') as Omit<Cmd, 'icon'>[]).filter((r) => r.to !== cmd.to);
    list.unshift({ id: cmd.id, group: 'Recent', label: cmd.label, meta: cmd.meta, to: cmd.to });
    localStorage.setItem(recentKey(cid), JSON.stringify(list.slice(0, 8)));
  } catch { /* storage unavailable */ }
}

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function CommandMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const c = useCompany();
  const nav = useNavigate();
  const items = useNavItems();
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [sel, setSel] = useState(0);
  const q = useDebounced(text.trim(), 160);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); setText(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 0); }
    if (!open && d.open) d.close();
  }, [open]);

  // Searches only run for what this role may see; the server checks again.
  const jobs = useQuery({ queryKey: [c.cid, 'cmdk-jobs', q], queryFn: () => get(`/c/${c.cid}/jobs?status=all&sort=updated&q=${encodeURIComponent(q)}`), enabled: open && q.length > 0 && (c.can('jobs.view_all') || c.can('jobs.view_assigned')) });
  // Drivers search their own jobs (the server keeps it to them) and open them on the driver screen (R12-m3).
  const ownJobsOnly = !c.can('jobs.view_all');
  const customers = useQuery({ queryKey: [c.cid, 'cmdk-customers', q], queryFn: () => get(`/c/${c.cid}/customers?q=${encodeURIComponent(q)}`), enabled: open && q.length > 0 && c.can('customers.view') });
  const invoices = useQuery({ queryKey: [c.cid, 'cmdk-invoices'], queryFn: () => get(`/c/${c.cid}/invoices?status=all`), enabled: open && q.length > 0 && c.can('invoices.view'), staleTime: 30_000 });

  const actions: Cmd[] = useMemo(() => {
    const a: Cmd[] = [];
    if (c.can('jobs.create')) a.push({ id: 'a-job', group: 'Actions', label: 'New job', icon: <Plus aria-hidden />, to: 'jobs/new' });
    if (c.can('customers.edit')) a.push({ id: 'a-cust', group: 'Actions', label: 'New customer', icon: <UserRound aria-hidden />, to: 'customers?new=1' });
    if (c.can('payments.record')) a.push({ id: 'a-pay', group: 'Actions', label: 'Record payment', meta: 'Issued and unpaid invoices', icon: <CreditCard aria-hidden />, to: 'invoices?status=unpaid' });
    if (c.can('automation.control')) a.push({ id: 'a-pause', group: 'Actions', label: c.company.paused ? 'Resume automation' : 'Pause automation', icon: <PauseCircle aria-hidden />, to: 'automation' });
    if (c.can('members.invite')) a.push({ id: 'a-invite', group: 'Actions', label: 'Invite a team member', icon: <Users aria-hidden />, to: 'team' });
    if (c.can('assistant.use')) a.push({ id: 'a-ask', group: 'Actions', label: 'Ask Rigo', meta: 'Open the assistant', icon: <Bot aria-hidden />, to: 'assistant' });
    return a;
  }, [c]);

  const typed = text.trim().toLowerCase();
  const all: Cmd[] = useMemo(() => {
    // Pages and actions filter as you type; record searches use the debounced text.
    const needle = typed;
    const remote = q.toLowerCase();
    const match = (s: string) => !needle || s.toLowerCase().includes(needle);
    const pages: Cmd[] = items.map((i) => ({ id: `p-${i.key}`, group: 'Go to', label: i.label, icon: i.icon, to: i.to }));
    const list: Cmd[] = [];
    if (!needle) list.push(...readRecent(c.cid));
    list.push(...actions.filter((a) => match(a.label)));
    list.push(...pages.filter((p) => match(p.label)));
    if (needle && remote) {
      for (const j of (jobs.data?.jobs ?? []).slice(0, 6)) list.push({ id: `j-${j.id}`, group: 'Jobs', label: `#${j.number} ${j.service_name ?? 'Job'}`, meta: j.customer_name ?? undefined, icon: <ClipboardList aria-hidden />, to: ownJobsOnly ? `today/${j.id}` : `jobs/${j.id}` });
      for (const cu of (customers.data?.customers ?? []).slice(0, 5)) list.push({ id: `c-${cu.id}`, group: 'Customers', label: cu.name, meta: cu.firstAddress ?? (cu.location_count ? `${cu.location_count} location(s)` : undefined), icon: <Contact aria-hidden />, to: `customers/${cu.id}` });
      const inv = (invoices.data?.invoices ?? []).filter((i: any) => [i.number, i.customerName, i.jobNumber && `#${i.jobNumber}`, i.jobNumber].filter(Boolean).some((v: any) => String(v).toLowerCase().includes(remote))).slice(0, 5);
      for (const i of inv) list.push({ id: `i-${i.id}`, group: 'Invoices', label: i.number ?? `Draft for job #${i.jobNumber ?? i.job_number ?? '?'}`, meta: i.customerName ?? i.customer_name ?? undefined, icon: <FileText aria-hidden />, to: `invoices/${i.id}` });
    }
    return list;
  }, [typed, q, items, actions, jobs.data, customers.data, invoices.data, c.cid]);

  useEffect(() => { setSel(0); }, [typed]);
  const go = useCallback((cmd: Cmd) => {
    if (cmd.group !== 'Recent' && cmd.group !== 'Go to' && cmd.group !== 'Actions') pushRecent(c.cid, cmd);
    onClose();
    nav(c.to(cmd.to));
  }, [c, nav, onClose]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(all.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (all[sel]) go(all[sel]); }
  };
  useEffect(() => { document.getElementById(`cmdk-${sel}`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  const searching = q.length > 0 && (jobs.isFetching || customers.isFetching || invoices.isFetching);
  let lastGroup = '';
  return (
    <dialog ref={ref} className="cmdk" aria-label="Command menu" onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && <>
        <div className="cmdk-input">
          <Search aria-hidden />
          <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder={searchHint(c)} aria-label="Search or run a command"
            role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={all[sel] ? `cmdk-${sel}` : undefined} autoComplete="off" />
          {searching ? <span className="spinner" aria-hidden /> : null}
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox" aria-label="Results">
          {all.map((cmd, i) => {
            const head = cmd.group !== lastGroup ? cmd.group : null;
            lastGroup = cmd.group;
            return (
              <div key={cmd.id + i} role="presentation">
                {head ? <div className="cmdk-group" role="presentation">{head}</div> : null}
                <div id={`cmdk-${i}`} role="option" aria-selected={i === sel} className="cmdk-item" onMouseMove={() => setSel(i)} onClick={() => go(cmd)}>
                  {cmd.icon}<span>{cmd.label}</span>{cmd.meta ? <span className="meta">{cmd.meta}</span> : null}
                  {i === sel ? <ArrowRight aria-hidden style={{ marginLeft: cmd.meta ? 0 : 'auto' }} /> : null}
                </div>
              </div>
            );
          })}
          {all.length === 0 && !searching ? <div className="cmdk-empty">No matches for “{text}”. Try a job number, a customer name or a page.</div> : null}
        </div>
        <div className="cmdk-foot" aria-hidden><span><kbd>↑</kbd><kbd>↓</kbd>Move</span><span><kbd>↵</kbd>Open</span><span><kbd>Esc</kbd>Close</span></div>
        <div className="sr-only" role="status">{q ? `${all.length} result${all.length === 1 ? '' : 's'}` : ''}</div>
      </>}
    </dialog>
  );
}

// ------------------------------------------------------------ shell

export function AppShell({ children }: { children: ReactNode }) {
  const c = useCompany();
  useAutoSync(c.me.actingUserId, c.cid, c.can('jobs.work'));
  const items = useNavItems();
  const online = useOnline();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('rigo-nav') === 'collapsed'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('rigo-nav', collapsed ? 'collapsed' : 'open'); } catch { /* ignore */ } }, [collapsed]);
  const [cmdk, setCmdk] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdk((o) => !o); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const bottom = bottomItems(items);
  const more = items.filter((i) => !bottom.includes(i));
  const isActive = (to: string) => (to === '' ? loc.pathname === c.to('') || loc.pathname === c.to('') + '/' : loc.pathname.startsWith(c.to(to)));
  const canAssistant = c.can('assistant.use');
  return (
    <div className={`shell${collapsed ? ' nav-collapsed' : ''}`}>
      <a href="#main" className="skip-link">Skip to content</a>
      <DemoBar />
      <header className="topbar">
        <Wordmark to={c.to('')} label="Rigo home" hideText />
        <span className="hide-mobile" aria-hidden style={{ fontWeight: 600, letterSpacing: '-0.03em', marginLeft: -2 }}>Rigo</span>
        <span className="topbar-sep hide-mobile" aria-hidden />
        <CompanySwitcher />
        {/* On phones the demo bar's "View as" menu already shows the simulated role, so the pill is desktop-only. */}
        {c.role.simulated ? <span className="hide-mobile topbar-role"><Pill tone="demo">{c.role.name} view</Pill></span> : <span className="hide-mobile"><Pill tone="neutral" icon={<UserRound aria-hidden />}>{c.role.name}</Pill></span>}
        <span className="spacer" />
        <button type="button" className="cmd-trigger" onClick={() => setCmdk(true)} aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}>
          <Search aria-hidden /><span>Search or jump to…</span><span aria-hidden style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}><kbd>{mac ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd></span>
        </button>
        <span className="hide-desktop"><IconButton label="Search and commands" onClick={() => setCmdk(true)}><Search aria-hidden /></IconButton></span>
        {canAssistant && <span className="hide-mobile"><Link className="icon-btn" to={c.to('assistant')} aria-label="Assistant" title="Assistant" aria-current={isActive('assistant') ? 'page' : undefined}><Bot aria-hidden /></Link></span>}
        <NotificationBell />
        <AccountMenu />
      </header>
      {!online || c.offlineSince ? <div className="banner banner-warning banner-flat" role="status"><WifiOff aria-hidden /><span><strong>No signal.</strong> {c.can('jobs.work') ? 'Your jobs and records are saved on this phone; records you submit send automatically when you have signal.' : 'Changes need a connection. Pages may show out-of-date information.'}</span></div> : null}
      {c.company.paused && c.can('workflows.view') && <div className="banner banner-warning banner-flat" role="status"><PauseCircle aria-hidden /><span><strong>Automation is paused.</strong> Queued steps are held; nothing new runs until it is resumed. <Link to={c.to('automation')}>Automation controls</Link></span></div>}
      <div className="layout">
        <nav className="sidebar" aria-label="Main">
          {SECTIONS.map((s) => {
            const group = items.filter((i) => i.section === s);
            if (!group.length) return null;
            return (
              <div key={s} role="group" aria-label={s}>
                <div className="nav-section" aria-hidden>{s}</div>
                {group.map((i) => (
                  <NavLink key={i.key} to={c.to(i.to)} end={i.to === ''} className={() => `nav-link${isActive(i.to) ? ' active' : ''}`} aria-current={isActive(i.to) ? 'page' : undefined} title={collapsed ? i.label : undefined}>
                    {i.icon}<span className="label">{i.label}</span>{i.count ? <span className="count" aria-label={`${i.count} need action`}>{i.count}</span> : null}
                  </NavLink>
                ))}
              </div>
            );
          })}
          <div className="sidebar-foot">
            <button type="button" className="sidebar-toggle" aria-pressed={collapsed} onClick={() => setCollapsed((v) => !v)} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}<span className="label">{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
            </button>
          </div>
        </nav>
        <main id="main" className="main" tabIndex={-1}><PausedBanner />{c.demo && !c.demo.guide.dismissed && <DemoGuide />}{children}</main>
      </div>
      <nav className="bottom-nav" aria-label="Main">
        {bottom.map((i) => (
          <NavLink key={i.key} to={c.to(i.to)} end={i.to === ''} className={() => (isActive(i.to) ? 'active' : '')} aria-current={isActive(i.to) ? 'page' : undefined}>
            {i.icon}<span>{i.label}</span>{i.count ? <span className="nav-dot" aria-label={`${i.count} need action`}>{i.count}</span> : null}
          </NavLink>
        ))}
        {more.length > 0 && <NavLink to={c.to('more')} className={() => (isActive('more') ? 'active' : '')} aria-current={isActive('more') ? 'page' : undefined}><MoreHorizontal aria-hidden /><span>More</span></NavLink>}
      </nav>
      <CommandMenu open={cmdk} onClose={() => setCmdk(false)} />
    </div>
  );
}

export function MorePage() {
  const c = useCompany();
  useDocumentTitle('More');
  const items = useNavItems();
  const bottom = bottomItems(items);
  const more = items.filter((i) => !bottom.includes(i));
  return (
    <div className="page page-narrow">
      <h1>More</h1>
      {SECTIONS.map((s) => {
        const group = more.filter((i) => i.section === s);
        if (!group.length) return null;
        return (
          <section key={s} className="stack-sm" aria-label={s}>
            <h2 className="small muted" style={{ fontWeight: 500 }}>{s}</h2>
            <div className="card card-flush">
              <ul className="list">
                {group.map((i) => <li key={i.key}><Link className="list-item" to={c.to(i.to)} style={{ alignItems: 'center' }}>{i.icon}<span style={{ flex: 1 }}>{i.label}</span>{i.count ? <Pill tone="brand">{i.count}</Pill> : null}</Link></li>)}
              </ul>
            </div>
          </section>
        );
      })}
      <div className="card card-flush">
        <ul className="list">
          <li><Link className="list-item" to="/workspaces" style={{ alignItems: 'center' }}><Building2 aria-hidden /><span>All workspaces</span></Link></li>
          <li><Link className="list-item" to="/account" style={{ alignItems: 'center' }}><UserCircle2 aria-hidden /><span>Account and theme</span></Link></li>
        </ul>
      </div>
    </div>
  );
}

/** The search box names only what this role can search (R12-m3). */
function searchHint(c: { can: (p: any) => boolean }) {
  const what = [c.can('jobs.view_all') ? 'jobs' : c.can('jobs.view_assigned') ? 'your jobs' : null, c.can('customers.view') ? 'customers' : null, c.can('invoices.view') ? 'invoices' : null].filter(Boolean) as string[];
  if (!what.length) return 'Jump to a page…';
  const list = what.length > 1 ? `${what.slice(0, -1).join(', ')}${what.length > 2 ? ',' : ''} and ${what[what.length - 1]}` : what[0];
  return `Search ${list}, or jump to a page…`;
}
