import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useLocation, useParams, useRouteError } from 'react-router-dom';
import { useMe, useWorkspaceBoot, WorkspaceProvider, useApplyUserTheme } from './lib/session';
import { ToastProvider, Loading, ErrorState, Empty, LinkButton } from './components/ui';
import { SearchX } from 'lucide-react';

// Every screen loads with its own script: the first visit downloads only what it shows.
const lazyPage = <T extends Record<string, any>>(load: () => Promise<T>, name: keyof T) => lazy(() => load().then((m) => ({ default: m[name] as ComponentType<any> })));

const Landing = lazyPage(() => import('./pages/landing'), 'Landing');
const SignIn = lazyPage(() => import('./pages/auth'), 'SignIn');
const SignUp = lazyPage(() => import('./pages/auth'), 'SignUp');
const Forgot = lazyPage(() => import('./pages/auth'), 'Forgot');
const Reset = lazyPage(() => import('./pages/auth'), 'Reset');
const ConfirmEmail = lazyPage(() => import('./pages/auth'), 'ConfirmEmail');
const InvitePage = lazyPage(() => import('./pages/invite'), 'InvitePage');
const Home = lazyPage(() => import('./pages/workspaces'), 'Home');
const Workspaces = lazyPage(() => import('./pages/workspaces'), 'Workspaces');
const Start = lazyPage(() => import('./pages/start'), 'Start');
const DemoPicker = lazyPage(() => import('./pages/start'), 'DemoPicker');
const Library = lazyPage(() => import('./pages/start'), 'Library');
const Account = lazyPage(() => import('./pages/account'), 'Account');
const DevMailbox = lazyPage(() => import('./pages/account'), 'DevMailbox');
const BookingPage = lazyPage(() => import('./pages/booking-public'), 'BookingPage');

const OfficeShell = lazyPage(() => import('./components/shell'), 'OfficeShell');
const WorkerShell = lazyPage(() => import('./components/shell'), 'WorkerShell');
const Today = lazyPage(() => import('./pages/today'), 'Today');
const Inbox = lazyPage(() => import('./pages/inbox'), 'Inbox');
const WorkList = lazyPage(() => import('./pages/work'), 'WorkList');
const WorkDetail = lazyPage(() => import('./pages/work'), 'WorkDetail');
const WorkForm = lazyPage(() => import('./pages/work'), 'WorkForm');
const Customers = lazyPage(() => import('./pages/customers'), 'Customers');
const CustomerDetail = lazyPage(() => import('./pages/customers'), 'CustomerDetail');
const CustomerForm = lazyPage(() => import('./pages/customers'), 'CustomerForm');
const MoneyHome = lazyPage(() => import('./pages/money'), 'MoneyHome');
const Invoices = lazyPage(() => import('./pages/money'), 'Invoices');
const InvoiceDetail = lazyPage(() => import('./pages/money'), 'InvoiceDetail');
const Prices = lazyPage(() => import('./pages/money'), 'Prices');
const Settings = lazyPage(() => import('./pages/settings'), 'Settings');
const SettingsWorkspace = lazyPage(() => import('./pages/settings'), 'SettingsWorkspace');
const SettingsWords = lazyPage(() => import('./pages/settings'), 'SettingsWords');
const SettingsStages = lazyPage(() => import('./pages/settings'), 'SettingsStages');
const SettingsFields = lazyPage(() => import('./pages/settings'), 'SettingsFields');
const SettingsPeople = lazyPage(() => import('./pages/people'), 'SettingsPeople');
const SettingsRoles = lazyPage(() => import('./pages/people'), 'SettingsRoles');
const SettingsAutomation = lazyPage(() => import('./pages/automation'), 'SettingsAutomation');
const SettingsBooking = lazyPage(() => import('./pages/settings'), 'SettingsBooking');
const SettingsTemplates = lazyPage(() => import('./pages/settings'), 'SettingsTemplates');
const SettingsEquipment = lazyPage(() => import('./pages/settings'), 'SettingsEquipment');
const WorkerList = lazyPage(() => import('./pages/worker'), 'WorkerList');
const WorkerItem = lazyPage(() => import('./pages/worker'), 'WorkerItem');

function Page({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="main"><div className="page"><Loading /></div></div>}>{children}</Suspense>;
}

/** Signed-in pages: anyone else goes to sign in and comes back. */
function RequireUser() {
  const me = useMe();
  const loc = useLocation();
  if (me.isLoading) return <div className="main"><div className="page"><Loading /></div></div>;
  if (me.error) return <div className="main"><div className="page"><ErrorState error={me.error} retry={() => me.refetch()} /></div></div>;
  if (!me.data?.user) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <Outlet />;
}

/** A workspace: loads its settings, then the office places or the worker's phone screens. */
function WorkspaceGate() {
  const { cid = '' } = useParams();
  const me = useMe();
  const boot = useWorkspaceBoot(cid, me.data?.user?.id);
  if (boot.isLoading) return <div className="main"><div className="page"><Loading /></div></div>;
  if (boot.error || !boot.data) return <div className="main"><div className="page"><ErrorState error={boot.error} retry={() => boot.refetch()} /></div></div>;
  return (
    <WorkspaceProvider cid={cid} boot={boot.data}>
      <Suspense fallback={<div className="main"><div className="page"><Loading /></div></div>}>
        {boot.data.role.app === 'worker' ? <WorkerShell><Outlet /></WorkerShell> : <OfficeShell><Outlet /></OfficeShell>}
      </Suspense>
    </WorkspaceProvider>
  );
}

function RoleSwitch({ office, worker }: { office: ReactNode; worker: ReactNode }) {
  const { cid = '' } = useParams();
  const me = useMe();
  const boot = useWorkspaceBoot(cid, me.data?.user?.id);
  return <>{boot.data?.role.app === 'worker' ? worker : office}</>;
}

/** The signed-in person's theme on every page, public ones included. */
function AccountTheme() {
  const me = useMe();
  useApplyUserTheme(me.data?.user?.theme);
  return <Outlet />;
}

function NotFound() {
  return <div className="main"><div className="page page-narrow"><Empty icon={<SearchX />} title="This page doesn't exist" action={<LinkButton to="/home" variant="primary">Go to your workspace</LinkButton>}>The link may be old or mistyped.</Empty></div></div>;
}

function RouteError() {
  const err = useRouteError();
  return <div className="main"><div className="page page-narrow"><ErrorState error={err} retry={() => window.location.reload()} /></div></div>;
}

const p = (el: ReactNode) => <Page>{el}</Page>;

const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    element: <AccountTheme />,
    children: [
      { path: '/', element: p(<Landing />) },
      { path: '/signin', element: p(<SignIn />) },
      { path: '/signup', element: p(<SignUp />) },
      { path: '/forgot', element: p(<Forgot />) },
      { path: '/reset/:token', element: p(<Reset />) },
      { path: '/confirm-email/:token', element: p(<ConfirmEmail />) },
      { path: '/invite/:token', element: p(<InvitePage />) },
      { path: '/book/:slug', element: p(<BookingPage />) },
      { path: '/templates', element: p(<Library />) },
      { path: '/dev/mailbox', element: p(<DevMailbox />) },
      {
        element: <RequireUser />,
        children: [
          { path: '/home', element: p(<Home />) },
          { path: '/workspaces', element: p(<Workspaces />) },
          { path: '/start', element: p(<Start />) },
          { path: '/demo', element: p(<DemoPicker />) },
          { path: '/account', element: p(<Account />) },
          {
            path: '/w/:cid', element: <WorkspaceGate />,
            children: [
              { index: true, element: <RoleSwitch office={p(<Today />)} worker={p(<WorkerList list="today" />)} /> },
              { path: 'upcoming', element: p(<WorkerList list="upcoming" />) },
              { path: 'done', element: p(<WorkerList list="done" />) },
              { path: 'inbox', element: p(<Inbox />) },
              { path: 'work', element: p(<WorkList />) },
              { path: 'work/new', element: p(<WorkForm />) },
              { path: 'work/:id', element: <RoleSwitch office={p(<WorkDetail />)} worker={p(<WorkerItem />)} /> },
              { path: 'work/:id/edit', element: p(<WorkForm />) },
              { path: 'customers', element: p(<Customers />) },
              { path: 'customers/new', element: p(<CustomerForm />) },
              { path: 'customers/:id', element: p(<CustomerDetail />) },
              { path: 'customers/:id/edit', element: p(<CustomerForm />) },
              { path: 'money', element: p(<MoneyHome />) },
              { path: 'money/invoices', element: p(<Invoices />) },
              { path: 'money/invoices/:id', element: p(<InvoiceDetail />) },
              { path: 'money/prices', element: p(<Prices />) },
              { path: 'settings', element: p(<Settings />) },
              { path: 'settings/workspace', element: p(<SettingsWorkspace />) },
              { path: 'settings/words', element: p(<SettingsWords />) },
              { path: 'settings/stages', element: p(<SettingsStages />) },
              { path: 'settings/fields', element: p(<SettingsFields />) },
              { path: 'settings/people', element: p(<SettingsPeople />) },
              { path: 'settings/roles', element: p(<SettingsRoles />) },
              { path: 'settings/automation', element: p(<SettingsAutomation />) },
              { path: 'settings/booking', element: p(<SettingsBooking />) },
              { path: 'settings/templates', element: p(<SettingsTemplates />) },
              { path: 'settings/equipment', element: p(<SettingsEquipment />) },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export function App() {
  return <ToastProvider><RouterProvider router={router} /></ToastProvider>;
}
