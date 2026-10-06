import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useMe, useCompanyBoot, CompanyProvider, useCompany, useApplyUserTheme } from './lib/session';
import { AppShell, MorePage } from './components/shell';
import { ToastProvider, LoadingBlock, ErrorState, LinkButton } from './components/ui';
import { SignIn, SignUp, Forgot, Reset } from './pages/auth';
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

function Home() {
  const me = useMe();
  if (me.isLoading) return <div className="auth-wrap"><LoadingBlock /></div>;
  if (!me.data?.user) return <Navigate to="/signin" replace />;
  return <Navigate to="/workspaces" replace />;
}

function CompanyRoot() {
  const { cid = '' } = useParams();
  const boot = useCompanyBoot(cid);
  useEffect(() => { try { localStorage.setItem('rigo-last-company', cid); } catch { /* ignore */ } }, [cid]);
  if (boot.isLoading) return <div className="auth-wrap"><LoadingBlock /></div>;
  if (boot.error) {
    const e = boot.error as ApiError;
    return (
      <div className="auth-wrap"><div className="auth-card stack">
        <ErrorState error={e} retry={() => boot.refetch()} />
        {e.status === 404 && <p className="muted">You are not a member of this company, or it no longer exists. Being signed in does not give access to a company; you need an invitation.</p>}
        <LinkButton to="/workspaces">Go to my workspaces</LinkButton>
      </div></div>
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
      <Route path="*" element={<div className="page"><ErrorState error={{ status: 404, message: 'This page does not exist.' }} /></div>} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/forgot" element={<Forgot />} />
          <Route path="/reset/:token" element={<Reset />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/dev/mailbox" element={<DevMailbox />} />
          <Route path="/workspaces" element={<RequireUser><Workspaces /></RequireUser>} />
          <Route path="/workspaces/new" element={<RequireUser><NewCompany /></RequireUser>} />
          <Route path="/account" element={<RequireUser><Account /></RequireUser>} />
          <Route path="/c/:cid/*" element={<RequireUser><CompanyRoot /></RequireUser>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
