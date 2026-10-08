import { Navigate, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Eye, MailOpen, ChevronRight, LogOut } from 'lucide-react';
import { post } from '../lib/api';
import { useMe, refreshMe, workspaceMeta, signOutAndForget } from '../lib/session';
import { useSubmit } from '../lib/form';
import { useTitle } from '../lib/title';
import { initials } from '../lib/format';
import { Button, LinkButton, Wordmark, FormError, Banner, Loading } from '../components/ui';

/** After signing in: straight into the only workspace, or the list; brand-new accounts start setup. */
export function Home() {
  const me = useMe();
  if (me.isLoading || !me.data) return <Loading />;
  const real = me.data.companies.filter((c) => c.kind === 'real' && !c.archived_at);
  let last: string | null = null;
  try { last = localStorage.getItem('rigo-last-workspace'); } catch { /* storage off */ }
  if (last && me.data.companies.some((c) => c.id === last)) return <Navigate to={`/w/${last}`} replace />;
  if (real.length === 1 && !me.data.invitations.length) return <Navigate to={`/w/${real[0].id}`} replace />;
  if (!me.data.companies.length && !me.data.invitations.length) return <Navigate to="/start" replace />;
  return <Navigate to="/workspaces" replace />;
}

export function Workspaces() {
  const me = useMe();
  const qc = useQueryClient();
  useTitle('Your workspaces');
  const join = useSubmit(async (id: string) => { await post(`/me/invitations/${id}/accept`); await refreshMe(qc); });
  const d = me.data;
  if (!d) return <Loading />;
  return (
    <div className="public">
      <header className="public-top"><Wordmark to="/home" />
        <Button variant="ghost" icon={<LogOut size={18} aria-hidden="true" />} onClick={async () => { await signOutAndForget(qc); location.assign('/signin'); }}>Sign out</Button>
      </header>
      <main id="main" className="main" style={{ paddingBottom: 48 }}>
        <div className="page page-narrow">
          <div className="stack-sm"><h1>Hi {d.user?.name.split(' ')[0]}</h1><p className="muted">Choose a workspace, start a new one, or try a demo.</p></div>
          {d.invitations.length > 0 && (
            <section className="stack" aria-labelledby="inv">
              <h2 id="inv">Invitations</h2>
              <FormError error={join.error} />
              {d.invitations.map((i) => (
                <div key={i.id} className="card row-between">
                  <div className="row"><span className="ws-avatar" aria-hidden="true"><MailOpen size={18} /></span><div><strong>{i.company_name}</strong><div className="small muted">as {i.role_name}</div></div></div>
                  {i.needsLink ? <span className="small muted">Open the link in your invitation email to join.</span> : <Button variant="primary" busy={join.busy} onClick={() => void join.run(i.id)}>Join</Button>}
                </div>
              ))}
            </section>
          )}
          <section className="card card-flush" aria-label="Workspaces">
            <ul className="divider-list">
              {d.companies.map((c) => (
                <li key={c.id}>
                  <Link to={`/w/${c.id}`} className="list-row">
                    <span className="ws-avatar" aria-hidden="true">{initials(c.name)}</span>
                    <span className="row-main"><span className="row-title">{c.name}</span><span className="row-sub">{workspaceMeta(c)}</span></span>
                    <ChevronRight className="chev" aria-hidden="true" />
                  </Link>
                </li>
              ))}
              {!d.companies.length && <li className="list-row muted">You’re not in a workspace yet.</li>}
            </ul>
          </section>
          <div className="row">
            <LinkButton to="/start" variant="primary" icon={<Plus size={18} aria-hidden="true" />}>New workspace</LinkButton>
            <LinkButton to="/demo" icon={<Eye size={18} aria-hidden="true" />}>Try a demo</LinkButton>
          </div>
          {d.offlineSince && <Banner tone="attn" title="No signal">Showing what was saved on this device.</Banner>}
        </div>
      </main>
    </div>
  );
}
