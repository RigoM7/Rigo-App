import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Hand, CheckCircle2, ChevronRight, Plus, Zap, PauseCircle } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get } from '../lib/api';
import { Card, LoadingBlock, ErrorState, JobStatus, LinkButton, Pill, Empty } from '../components/ui';
import { formatMoney, fmtTime } from '../lib/format';
import { SetupChecklist } from './setup';

export function Dashboard() {
  const c = useCompany();
  const q = useQuery({ queryKey: [c.cid, 'overview'], queryFn: () => get(`/c/${c.cid}/overview`), refetchInterval: 30_000 });
  if (q.isLoading) return <div className="page"><LoadingBlock rows={8} /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} retry={() => q.refetch()} /></div>;
  const d = q.data;
  return (
    <div className="page">
      <div className="page-header">
        <div><h1>Home</h1><div className="sub">{c.company.name} · {new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: c.company.timezone }).format(new Date())}</div></div>
        {c.can('jobs.create') && <LinkButton variant="primary" to={c.to('jobs/new')} icon={<Plus aria-hidden />}>New job</LinkButton>}
      </div>

      {c.setup && !c.setup.ready && !c.demo && <SetupChecklist compact />}

      <section aria-labelledby="att-h" className="stack-sm">
        <h2 id="att-h">Needs you</h2>
        {d.attention.length === 0 ? (
          <div className="card row"><CheckCircle2 aria-hidden style={{ color: 'var(--success)' }} /><span>Nothing needs your attention right now.</span></div>
        ) : (
          <div className="grid-2">
            {d.attention.map((a: any) => (
              <Link key={a.key} to={c.to(a.link)} className="attention-item">
                {a.tone === 'warning' ? <AlertTriangle aria-hidden style={{ color: 'var(--warning)' }} /> : <Hand aria-hidden style={{ color: 'var(--primary-text)' }} />}
                <span className="count">{a.count}</span>
                <span style={{ flex: 1 }}>{a.label}</span>
                <ChevronRight aria-hidden />
              </Link>
            ))}
          </div>
        )}
      </section>

      {d.today && (
        <Card id="today" title="Today's operations" actions={<Link to={c.to('jobs?view=schedule')}>Open schedule</Link>}>
          {d.empty ? (
            <Empty title="No jobs yet" action={c.can('jobs.create') ? <LinkButton variant="primary" to={c.to('jobs/new')} icon={<Plus aria-hidden />}>Create the first job</LinkButton> : undefined}>Jobs you create appear here with their driver and status. Add customers first, or create a job and a customer together.</Empty>
          ) : (
            <div className="stack">
              <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
                <div className="stat"><span className="value">{d.today.total}</span><span className="label">Scheduled today</span></div>
                <div className="stat"><span className="value">{d.today.inProgress}</span><span className="label">In progress</span></div>
                <div className="stat"><span className="value">{d.today.done}</span><span className="label">Completed</span></div>
                <div className="stat"><span className="value">{d.today.unassigned}</span><span className="label">Without a driver</span></div>
                <div className="stat"><span className="value">{d.today.exceptions}</span><span className="label">Partial / unsuccessful</span></div>
              </div>
              {d.today.jobs.length > 0 ? (
                <div className="table-wrap"><table className="table responsive">
                  <thead><tr><th>Time</th><th>Job</th><th>Driver</th><th>Status</th></tr></thead>
                  <tbody>{d.today.jobs.map((j: any) => (
                    <tr key={j.id}>
                      <td data-label="Time" className="num nowrap">{fmtTime(j.scheduled_start, c.company.timezone)}</td>
                      <td data-primary><Link className="row-link" to={c.to(`jobs/${j.id}`)}>#{j.number} {j.service_name ?? 'Service'}</Link><div className="small muted">{j.customer_name} · {j.address}</div></td>
                      <td data-label="Driver">{j.assignee_name ?? <Pill tone="warning">Unassigned</Pill>}</td>
                      <td data-label="Status"><JobStatus status={j.status} />{j.problem_open ? <> <Pill tone="danger">Problem</Pill></> : null}</td>
                    </tr>))}
                  </tbody>
                </table></div>
              ) : <p className="muted">Nothing is scheduled for today.</p>}
            </div>
          )}
        </Card>
      )}

      {d.rigo && (
        <Card id="rigo" title={<h2 className="row"><Zap aria-hidden />What Rigo is doing</h2>} actions={<Link to={c.to('automation')}>Automation</Link>}>
          <div className="row" style={{ marginBottom: 12 }}>
            <Pill tone="brand">{d.rigo.mode === 'manual' ? 'Manual' : d.rigo.mode === 'assisted' ? 'Assisted' : 'Automatic'} mode</Pill>
            {d.rigo.paused ? <Pill tone="warning" icon={<PauseCircle aria-hidden />}>Paused</Pill> : null}
            <span className="muted small">{d.rigo.activeWorkflows} active workflow(s)</span>
          </div>
          <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
            <div className="stat"><span className="value">{d.rigo.waiting_approval}</span><span className="label">Waiting for approval</span></div>
            <div className="stat"><span className="value">{d.rigo.queued + d.rigo.running}</span><span className="label">Queued or running</span></div>
            <div className="stat"><span className="value">{d.rigo.done_today}</span><span className="label">Done in the last 24 h</span></div>
          </div>
        </Card>
      )}

      {d.business && (
        <Card id="biz" title="Business overview (last 30 days)">
          <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            <div className="stat"><span className="value">{d.business.completed30}</span><span className="label">Jobs completed</span></div>
            <div className="stat"><span className="value">{d.business.exceptions30}</span><span className="label">Partial or unsuccessful</span></div>
            <div className="stat"><span className="value">{d.business.customers}</span><span className="label">Customers</span></div>
            {d.business.issued30Minor !== undefined && <div className="stat"><span className="value">{formatMoney(d.business.issued30Minor, d.business.currency)}</span><span className="label">Invoiced</span></div>}
            {d.business.outstandingMinor !== undefined && <div className="stat"><span className="value">{formatMoney(d.business.outstandingMinor, d.business.currency)}</span><span className="label">Outstanding</span></div>}
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>Calculated from your records. Payments are recorded by your team; Rigo does not process payments.</p>
        </Card>
      )}
    </div>
  );
}
