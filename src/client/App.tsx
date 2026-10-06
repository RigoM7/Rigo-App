import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useMe, useCompanyBoot, CompanyProvider, useCompany, useApplyUserTheme, refreshMe, safeNext } from './lib/session';
import { useDocumentTitle } from './lib/title';
import { post } from './lib/api';
import { AppShell, MorePage } from './components/shell';
import { ToastProvider, LoadingBlock, ErrorState, LinkButton, Wordmark, Empty } from './components/ui';
import { Lock, SearchX, WifiOff } from 'lucide-react';
import { SignIn, SignUp, Forgot, Reset, ConfirmEmail } from './pages/auth';
import { Landing } from './pages/landing';
import { Workspaces, NewCompany } from './pages/workspaces';
import { InvitePage } from './pages/invite';
import { Account } from './pages/account';
import { DevMailbox } from './pages/devmailbox';
import { ApiError } from './lib/api';

const Dashboard = lazy(() => import('./pages/dashboard').then((m) => ({ default: m.Dashboard })));
const Jobs = lazy(() => import('./pages/jobs').then((m) => ({ default: m.Jobs })));
const JobForm = lazy(() => import('./pages/jobform').then((m) => ({ default: m.JobForm })));
const DriverRecords = lazy(() => import('./pages/driver-records').then((m) => ({ default: m.DriverRecords })));
const JobDetail = lazy(() => import('./pages/jobdetail').then((m) => ({ default: m.JobDetail })));
const Today = lazy(() => import('./pages/driver').then((m) => ({ default: m.Today })));
const DriverJob = lazy(() => import('./pages/driver').then((m) => ({ default: m.DriverJob })));
const Customers = lazy(() => import('./pages/customers').then((m) => ({ default: m.Customers })));
const CustomerDetail = lazy(() => import('./pages/customers').then((m) => ({ default: m.CustomerDetail })));
const Team = lazy(() => import('./pages/team').then((m) => ({ default: m.Team })));
const Resources = lazy(() => import('./pages/resources').then((m) => ({ default: m.Resources })));
const Services = lazy(() => import('./pages/services').then((m) => ({ default: m.Services })));
const ServiceEditor = lazy(() => import('./pages/services').then((m) => ({ default: m.ServiceEditor })));
const Invoices = lazy(() => import('./pages/invoices').then((m) => ({ default: m.Invoices })));
const InvoiceDetail = lazy(() => import('./pages/invoices').then((m) => ({ default: m.InvoiceDetail })));
const NewInvoice = lazy(() => import('./pages/invoices').then((m) => ({ default: m.NewInvoice })));
const Collections = lazy(() => import('./pages/collections').then((m) => ({ default: m.Collections })));
const StatementView = lazy(() => import('./pages/collections').then((m) => ({ default: m.StatementView })));
const PublicInvoice = lazy(() => import('./pages/invoice-view').then((m) => ({ default: m.PublicInvoice })));
const InboxPage = lazy(() => import('./pages/inbox').then((m) => ({ default: m.InboxPage })));
const Automation = lazy(() => import('./pages/automation').then((m) => ({ default: m.Automation })));
const Workflows = lazy(() => import('./pages/workflows').then((m) => ({ default: m.Workflows })));
const WorkflowEditor = lazy(() => import('./pages/workflows').then((m) => ({ default: m.WorkflowEditor })));
const Recurring = lazy(() => import('./pages/recurring').then((m) => ({ default: m.Recurring })));
const RecurringDetail = lazy(() => import('./pages/recurring').then((m) => ({ default: m.RecurringDetail })));
const RecurringNew = lazy(() => import('./pages/recurring').then((m) => ({ default: m.RecurringNew })));
const Imports = lazy(() => import('./pages/imports').then((m) => ({ default: m.Imports })));
const Templates = lazy(() => import('./pages/templates').then((m) => ({ default: m.Templates })));
const Messages = lazy(() => import('./pages/messages').then((m) => ({ default: m.Messages })));
const SettingsPage = lazy(() => import('./pages/settings').then((m) => ({ default: m.SettingsPage })));
const Setup = lazy(() => import('./pages/setup').then((m) => ({ default: m.Setup })));
const SetupFromDemo = lazy(() => import('./pages/demo').then((m) => ({ default: m.SetupFromDemo })));
const AssistantPage = lazy(() => import('./pages/assistant').then((m) => ({ default: m.AssistantPage })));

function RequireUser({ children }: { children: ReactNode }) {
  const me = useMe();
  const loc = useLocation();
  useApplyUserTheme(me.data?.user?.theme);
  if (me.isLoading) return <div className="auth-wrap"><LoadingBlock /></div>;
  if (me.error) return <div className="auth-wrap"><ErrorState error={me.error} retry={() => me.refetch()} /></div>;
  if (!me.data?.user) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

/** Signed out, "/" explains what Rigo is; signed in, it goes straight to the workspaces. */
function Home() {
  const me = useMe();
  if (me.isLoading) return <div className="auth-wrap"><LoadingBlock /></div>;
  if (me.data?.user) return <Navigate to="/workspaces" replace />;
  return <Landing />;
}

/** Sign-in and sign-up are for people who aren't signed in; everyone else continues where they were going. */
function SignedOutOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  const [sp] = useSearchParams();
  if (me.isLoading) return <div className="auth-wrap"><LoadingBlock /></div>;
  if (me.data?.user) return <Navigate to={safeNext(sp.get('next'))} replace />;
  return <>{children}</>;
}

/** "Try the demo" from the landing page: after signing up, open the person's demo (creating it if needed). */
function StartDemo() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [error, setError] = useState<unknown>(null);
  useDocumentTitle('Opening the demo');
  const start = useCallback(async () => {
    setError(null);
    try {
      // Always ask the server: it returns the existing demo and starts it in the Owner view.
      const { id } = await post('/demo');
      await qc.invalidateQueries({ queryKey: [id] });
      await refreshMe(qc);
      nav(`/c/${id}`, { replace: true });
    } catch (e) { setError(e); }
  }, [me.data, qc, nav]);
  useEffect(() => { if (me.data?.user) start(); }, [me.data?.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="auth-wrap"><main className="auth-card" id="main">
      <Wordmark to="/workspaces" />
      <div className="auth-panel stack">
        <h1>Opening the demo</h1>
        {error ? <><ErrorState error={error} retry={start} /><LinkButton to="/workspaces">Go to my workspaces</LinkButton></> : <LoadingBlock rows={2} />}
      </div>
    </main></div>
  );
}

function CompanyRoot() {
  const { cid = '' } = useParams();
  const me = useMe();
  const uid = me.data?.user?.id;
  const qc = useQueryClient();
  const boot = useCompanyBoot(cid, uid);
  useDocumentTitle(boot.error ? 'No access' : null);
  useEffect(() => { try { localStorage.setItem('rigo-last-company', cid); } catch { /* ignore */ } }, [cid]);
  // Back online after starting from the device copy: check again straight away.
  useEffect(() => {
    const on = () => { qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: [cid, 'boot'] }); };
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [cid, qc]);
  if (boot.isLoading) return <div className="auth-wrap"><LoadingBlock /></div>;
  if (boot.error) {
    const e = boot.error as ApiError;
    if (e.code === 'not_member' && uid) return <NoLongerMember cid={cid} uid={uid} until={e.details?.lateRecordsUntil ?? null} />;
    return (
      <div className="auth-wrap"><main className="auth-card" id="main">
        <Wordmark to="/workspaces" />
        <div className="auth-panel stack">
          {e.status === 404 ? <>
            <span className="empty-icon" aria-hidden><Lock /></span>
            <h1>You don't have access to this company</h1>
            <p className="muted" style={{ margin: 0 }}>You are not a member of this company, or it no longer exists. Being signed in does not give access to a company; you need an invitation.</p>
          </> : <ErrorState error={e} retry={() => boot.refetch()} />}
          <LinkButton variant="primary" to="/workspaces">Go to my workspaces</LinkButton>
        </div>
      </main></div>
    );
  }
  return (
    // key={cid} remounts everything when switching companies so no state carries across.
    <CompanyProvider key={cid} cid={cid} boot={boot.data!}>
      <AppShell>
        <Suspense fallback={<LoadingBlock />}>
          {boot.data!.offlineSince ? <OfflineRoutes /> : <CompanyRoutes />}
        </Suspense>
      </AppShell>
    </CompanyProvider>
  );
}

/**
 * Removed from the company (R12-M1): records still on this phone go to the office for review (for
 * 7 days, D12), then everything this phone kept for that company is deleted.
 */
function NoLongerMember({ cid, uid, until }: { cid: string; uid: string; until: string | null }) {
  const qc = useQueryClient();
  const [done, setDone] = useState<null | { name: string | null; sent: number; removed: number; waiting: number }>(null);
  useDocumentTitle('No longer a member');
  useEffect(() => {
    let alive = true;
    (async () => {
      const off = await import('./lib/offline');
      const name = ((await off.cachedBoot<any>(uid, cid))?.boot?.company?.name as string | undefined) ?? null;
      const open = !!until && new Date(until) > new Date();
      let sent = 0, removed = 0, waiting = 0;
      for (const d of (await off.listDrafts(uid, cid)).filter(off.isUnsent)) {
        if (!open || !d.outcome) { removed++; continue; }
        const r = await off.sendLateRecord(d);
        if (r.state === 'held') sent++;
        else if (r.state === 'queued') { waiting++; await off.saveDraft(r); }
        else removed++;
      }
      // Drafts that couldn't go yet for lack of signal stay until the next try; everything else goes.
      await off.clearUserData(uid, { companyId: cid, keepDrafts: waiting > 0 });
      try { if (localStorage.getItem('rigo-last-company') === cid) localStorage.removeItem('rigo-last-company'); } catch { /* ignore */ }
      qc.removeQueries({ queryKey: [cid], predicate: (q) => q.queryKey[1] !== 'boot' });
      if (alive) setDone({ name, sent, removed, waiting });
    })();
    return () => { alive = false; };
  }, [cid, uid, until, qc]);
  return (
    <div className="auth-wrap"><main className="auth-card" id="main">
      <Wordmark to="/workspaces" />
      <div className="auth-panel stack">
        <span className="empty-icon" aria-hidden><Lock /></span>
        <h1>You're no longer a member{done?.name ? ` of ${done.name}` : ' of this company'}</h1>
        {!done ? <LoadingBlock rows={1} /> : <>
          {done.sent > 0 && <p style={{ margin: 0 }}>{done.sent === 1 ? 'Your record was' : `${done.sent} records were`} sent to the office for review.</p>}
          {done.waiting > 0 && <p style={{ margin: 0 }}>{done.waiting === 1 ? 'One record' : `${done.waiting} records`} couldn't be sent yet. Open this page again when you have signal.</p>}
          {done.removed > 0 && <p style={{ margin: 0 }}>{done.removed === 1 ? 'One unfinished record' : `${done.removed} unfinished records`} could not be sent and {done.removed === 1 ? 'was' : 'were'} removed from this phone.</p>}
          <p className="muted" style={{ margin: 0 }}>This company's jobs and details were removed from this phone. Ask the company if you think this is a mistake.</p>
        </>}
        <LinkButton variant="primary" to="/workspaces">Go to my workspaces</LinkButton>
      </div>
    </main></div>
  );
}

/** With no signal the app runs from what this phone saved: a driver's jobs and records, nothing else. */
function OfflineRoutes() {
  return (
    <Routes>
      <Route index element={<OfflineHome />} />
      <Route path="today" element={<Today />} />
      <Route path="today/:jobId" element={<DriverJob />} />
      <Route path="*" element={<NeedsConnection />} />
    </Routes>
  );
}
function OfflineHome() {
  const c = useCompany();
  return c.can('jobs.work') ? <Navigate to={c.to('today')} replace /> : <NeedsConnection />;
}
function NeedsConnection() {
  const c = useCompany();
  useDocumentTitle('Needs a connection');
  return (
    <div className="page page-narrow">
      <div className="card"><Empty icon={<WifiOff />} title="This page needs a connection" action={c.can('jobs.work') ? <div className="row" style={{ justifyContent: 'center' }}><LinkButton variant="primary" to={c.to('today')}>Go to my jobs</LinkButton></div> : undefined}>It opens again as soon as you have signal.{c.can('jobs.work') ? ' Your jobs and records work without it.' : ''}</Empty></div>
    </div>
  );
}

/** Where the installed app opens (R13-m4): straight into the person's only company, or their last one. */
function OpenApp() {
  const me = useMe();
  if (me.isLoading) return <div className="auth-wrap"><LoadingBlock /></div>;
  const list = me.data?.companies ?? [];
  let last: string | null = null;
  try { last = localStorage.getItem('rigo-last-company'); } catch { /* ignore */ }
  const real = list.filter((x) => x.kind === 'real');
  const target = real.length === 1 ? real[0].id : list.some((x) => x.id === last) ? last : list.length === 1 ? list[0].id : null;
  return <Navigate to={target ? `/c/${target}` : '/workspaces'} replace />;
}

function NotFound() {
  const c = useCompany();
  useDocumentTitle('Page not found');
  return (
    <div className="page page-narrow">
      <h1 className="sr-only">Page not found</h1>
      <div className="card"><Empty icon={<SearchX />} title="This page does not exist" action={<div className="row" style={{ justifyContent: 'center' }}><LinkButton variant="primary" to={c.to('')}>Go home</LinkButton></div>}>The link may be old, or the page moved. Use the menu or press <kbd>Ctrl</kbd> <kbd>K</kbd> to search.</Empty></div>
    </div>
  );
}

function RoleHome() {
  const c = useCompany();
  if (!c.can('jobs.view_all') && c.can('jobs.work')) return <Navigate to={c.to('today')} replace />;
  if (!c.can('jobs.view_all') && !c.can('reports.view')) return <Navigate to={c.to('inbox')} replace />;
  return <Dashboard />;
}

function CompanyRoutes() {
  return (
    <Routes>
      <Route index element={<RoleHome />} />
      <Route path="today" element={<Today />} />
      <Route path="today/:jobId" element={<DriverJob />} />
      <Route path="jobs" element={<Jobs />} />
      <Route path="jobs/new" element={<JobForm />} />
      <Route path="jobs/records" element={<DriverRecords />} />
      <Route path="jobs/:id" element={<JobDetail />} />
      <Route path="jobs/:id/edit" element={<JobForm />} />
      <Route path="customers" element={<Customers />} />
      <Route path="customers/:id" element={<CustomerDetail />} />
      <Route path="team" element={<Team />} />
      <Route path="resources" element={<Resources />} />
      <Route path="services" element={<Services />} />
      <Route path="services/:id" element={<ServiceEditor />} />
      <Route path="invoices" element={<Invoices />} />
      <Route path="invoices/new" element={<NewInvoice />} />
      <Route path="invoices/:id" element={<InvoiceDetail />} />
      <Route path="collections" element={<Collections />} />
      <Route path="statements/:id" element={<StatementView />} />
      <Route path="inbox" element={<InboxPage />} />
      <Route path="automation" element={<Automation />} />
      <Route path="workflows" element={<Workflows />} />
      <Route path="workflows/:id" element={<WorkflowEditor />} />
      <Route path="recurring" element={<Recurring />} />
      <Route path="recurring/new" element={<RecurringNew />} />
      <Route path="recurring/:id" element={<RecurringDetail />} />
      <Route path="imports" element={<Imports />} />
      <Route path="templates" element={<Templates />} />
      <Route path="messages" element={<Messages />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="setup" element={<Setup />} />
      <Route path="setup-company" element={<SetupFromDemo />} />
      <Route path="assistant" element={<AssistantPage />} />
      <Route path="more" element={<MorePage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function AppRoutes() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/signin" element={<SignedOutOnly><SignIn /></SignedOutOnly>} />
        <Route path="/signup" element={<SignedOutOnly><SignUp /></SignedOutOnly>} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/reset/:token" element={<Reset />} />
        <Route path="/confirm-email/:token" element={<ConfirmEmail />} />
        <Route path="/start-demo" element={<RequireUser><StartDemo /></RequireUser>} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/i/:token" element={<PublicInvoice />} />
        <Route path="/dev/mailbox" element={<DevMailbox />} />
        <Route path="/open" element={<RequireUser><OpenApp /></RequireUser>} />
        <Route path="/workspaces" element={<RequireUser><Workspaces /></RequireUser>} />
        <Route path="/workspaces/new" element={<RequireUser><NewCompany /></RequireUser>} />
        <Route path="/account" element={<RequireUser><Account /></RequireUser>} />
        <Route path="/c/:cid/*" element={<RequireUser><CompanyRoot /></RequireUser>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}

// A data router (rather than <BrowserRouter>) so screens can warn before leaving unsaved changes (useBlocker).
const router = createBrowserRouter([{ path: '*', element: <AppRoutes /> }]);

export function App() {
  return <RouterProvider router={router} />;
}
