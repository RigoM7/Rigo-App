import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useMe, useCompanyBoot, CompanyProvider, useCompany, useApplyUserTheme, refreshMe, safeNext } from './lib/session';
import { useDocumentTitle } from './lib/title';
import { post } from './lib/api';
import { AppShell, MorePage } from './components/shell';
import { ToastProvider, LoadingBlock, ErrorState, LinkButton, Wordmark, Empty } from './components/ui';
import { Lock, SearchX } from 'lucide-react';
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
  const boot = useCompanyBoot(cid);
  useDocumentTitle(boot.error ? 'No access' : null);
  useEffect(() => { try { localStorage.setItem('rigo-last-company', cid); } catch { /* ignore */ } }, [cid]);
  if (boot.isLoading) return <div className="auth-wrap"><LoadingBlock /></div>;
  if (boot.error) {
    const e = boot.error as ApiError;
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
          <CompanyRoutes />
        </Suspense>
      </AppShell>
    </CompanyProvider>
  );
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
      <Route path="jobs/:id" element={<JobDetail />} />
      <Route path="jobs/:id/edit" element={<JobForm />} />
      <Route path="customers" element={<Customers />} />
      <Route path="customers/:id" element={<CustomerDetail />} />
      <Route path="team" element={<Team />} />
      <Route path="resources" element={<Resources />} />
      <Route path="services" element={<Services />} />
      <Route path="services/:id" element={<ServiceEditor />} />
      <Route path="invoices" element={<Invoices />} />
      <Route path="invoices/:id" element={<InvoiceDetail />} />
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
        <Route path="/dev/mailbox" element={<DevMailbox />} />
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
