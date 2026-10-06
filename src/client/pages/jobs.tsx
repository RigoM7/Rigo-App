import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, List, Columns3, CalendarDays, Search, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post } from '../lib/api';
import { LinkButton, Segmented, Field, Input, Select, LoadingBlock, ErrorState, Empty, JobStatus, Pill, Button, useToast } from '../components/ui';
import { fmtDateTime, fmtTime, toLocalInput } from '../lib/format';
import { addDays, zonedToUtc, localDate } from '../../shared/schedule';
import { BILLING_STATUSES } from '../../shared/jobs';
import { ApiError } from '../lib/api';

type View = 'list' | 'board' | 'schedule';

/** Inline assignment control: a select + button is the keyboard/touch alternative to dragging. */
export function QuickAssign({ job, onDone }: { job: any; onDone: () => void }) {
  const c = useCompany();
  const toast = useToast();
  const drivers = c.members.filter((m) => m.role_key === 'driver' || m.role_key === 'owner' || m.role_key === 'dispatcher');
  const [val, setVal] = useState<string>(job.assigned_user_id ?? '');
  const [busy, setBusy] = useState(false);
  if (!c.can('jobs.assign') || ['completed', 'partial', 'unsuccessful', 'cancelled'].includes(job.status)) return <span>{job.assignee_name ?? '—'}</span>;
  const save = async () => {
    setBusy(true);
    try {
      await post(`/c/${c.cid}/jobs/${job.id}/assign`, { userId: val || null, resourceIds: (job.resources ?? []).map((r: any) => r.id), version: job.version });
      toast(val ? 'Driver assigned' : 'Driver removed');
      onDone();
    } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(false); }
  };
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <select className="select" style={{ minHeight: 36, padding: '4px 8px', minWidth: 130 }} aria-label={`Driver for job #${job.number}`} value={val} onChange={(e) => setVal(e.target.value)}>
        <option value="">Unassigned</option>
        {drivers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      {val !== (job.assigned_user_id ?? '') && <Button size="sm" variant="primary" busy={busy} onClick={save}>Save</Button>}
    </span>
  );
}

export function Jobs() {
  const c = useCompany();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const view = (sp.get('view') ?? 'list') as View;
  const status = sp.get('status') ?? 'active';
  const assignee = sp.get('assignee') ?? '';
  const sort = sp.get('sort') ?? 'schedule';
  const qtext = sp.get('q') ?? '';
  const today = localDate(new Date(), c.company.timezone);
  const day = sp.get('day') ?? today;
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const params = new URLSearchParams({ status: view === 'schedule' ? 'all' : status, sort, ...(assignee ? { assignee } : {}), ...(qtext ? { q: qtext } : {}), ...(sp.get('problem') ? { problem: '1' } : {}) });
  if (view === 'schedule') { params.set('from', zonedToUtc(day, '00:00', c.company.timezone).toISOString()); params.set('to', zonedToUtc(addDays(day, 1), '00:00', c.company.timezone).toISOString()); }
  const q = useQuery({ queryKey: [c.cid, 'jobs', params.toString()], queryFn: () => get(`/c/${c.cid}/jobs?${params}`), refetchInterval: 30_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: [c.cid] });
  const jobs: any[] = q.data?.jobs ?? [];
  return (
    <div className="page">
      <div className="page-header">
        <div><h1>Jobs</h1><div className="sub">The same jobs in a list, a status board or a daily schedule.</div></div>
        <div className="row">
          <Segmented label="View" value={view} onChange={(v) => set('view', v === 'list' ? '' : v)} options={[{ key: 'list', label: 'List', icon: <List aria-hidden /> }, { key: 'board', label: 'Board', icon: <Columns3 aria-hidden /> }, { key: 'schedule', label: 'Schedule', icon: <CalendarDays aria-hidden /> }]} />
          {c.can('jobs.create') && <LinkButton variant="primary" to={c.to('jobs/new')} icon={<Plus aria-hidden />}>New job</LinkButton>}
        </div>
      </div>
      <form className="card" role="search" onSubmit={(e) => e.preventDefault()} style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'end' }}>
        <Field label="Search" id="f-q">{(p) => <div className="input-group"><Input {...p} type="search" placeholder="Customer, address, service or #" defaultValue={qtext} onChange={(e) => set('q', e.target.value)} /><span className="icon-btn" aria-hidden><Search /></span></div>}</Field>
        {view !== 'schedule' && <Field label="Status" id="f-status">{(p) => <Select {...p} value={status} onChange={(e) => set('status', e.target.value)}>
          <option value="active">Active (draft, open, in progress)</option><option value="draft">Drafts</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="finished">Finished</option><option value="completed">Completed</option><option value="partial">Partial</option><option value="unsuccessful">Unsuccessful</option><option value="cancelled">Cancelled</option><option value="all">All</option>
        </Select>}</Field>}
        <Field label="Driver" id="f-assignee">{(p) => <Select {...p} value={assignee} onChange={(e) => set('assignee', e.target.value)}><option value="">Anyone</option><option value="none">Unassigned</option>{c.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>
        {view === 'list' && <Field label="Sort by" id="f-sort">{(p) => <Select {...p} value={sort} onChange={(e) => set('sort', e.target.value)}><option value="schedule">Scheduled time</option><option value="number">Newest job number</option><option value="updated">Recently updated</option><option value="customer">Customer</option></Select>}</Field>}
        {view === 'schedule' && (
          <div className="field"><span className="label" id="day-l">Day</span>
            <div className="row" style={{ flexWrap: 'nowrap' }} role="group" aria-labelledby="day-l">
              <Button size="sm" aria-label="Previous day" onClick={() => set('day', addDays(day, -1))}><ChevronLeft aria-hidden /></Button>
              <input className="input" type="date" aria-label="Choose day" value={day} onChange={(e) => set('day', e.target.value)} style={{ minWidth: 0 }} />
              <Button size="sm" aria-label="Next day" onClick={() => set('day', addDays(day, 1))}><ChevronRight aria-hidden /></Button>
            </div>
          </div>
        )}
      </form>
      {sp.get('problem') && <div className="row"><Pill tone="danger">Showing jobs with problems</Pill><Button size="sm" variant="ghost" onClick={() => set('problem', '')}>Clear</Button></div>}
      {q.isLoading ? <LoadingBlock rows={6} /> : q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : jobs.length === 0 ? (
        <div className="card"><Empty title={view === 'schedule' ? 'Nothing scheduled this day' : 'No jobs match'} action={c.can('jobs.create') ? <LinkButton variant="primary" to={c.to('jobs/new')} icon={<Plus aria-hidden />}>New job</LinkButton> : undefined}>{qtext || assignee || status !== 'active' ? 'Try a different filter.' : 'Create a job when a customer contacts you.'}</Empty></div>
      ) : view === 'list' ? <JobTable jobs={jobs} onChange={refresh} /> : view === 'board' ? <Board jobs={jobs} /> : <Schedule jobs={jobs} onChange={refresh} />}
      {q.data && <p className="small muted" aria-live="polite">{jobs.length} job(s). Updated {fmtTime(q.data.serverTime)}.</p>}
    </div>
  );
}

function JobTable({ jobs, onChange }: { jobs: any[]; onChange: () => void }) {
  const c = useCompany();
  return (
    <div className="card card-flush"><div className="table-wrap">
      <table className="table responsive">
        <thead><tr><th>Job</th><th>Scheduled</th><th>Customer &amp; location</th><th>Driver</th><th>Status</th>{c.can('invoices.view') && <th>Billing</th>}</tr></thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td data-primary><Link className="row-link" to={c.to(`jobs/${j.id}`)}>#{j.number} {j.service_name ?? 'No service yet'}</Link>{j.resources?.length ? <div className="small muted">{j.resources.map((r: any) => r.name).join(', ')}</div> : null}</td>
              <td data-label="Scheduled" className="num">{j.scheduled_start ? fmtDateTime(j.scheduled_start, c.company.timezone) : <span className="muted">Not scheduled</span>}</td>
              <td data-label="Customer">{j.customer_name ?? <span className="muted">No customer</span>}<div className="small muted">{j.address}</div></td>
              <td data-label="Driver"><QuickAssign job={j} onDone={onChange} /></td>
              <td data-label="Status"><div className="row" style={{ gap: 6 }}><JobStatus status={j.status} />{j.problem_open ? <Pill tone="danger" icon={<AlertTriangle aria-hidden />}>Problem</Pill> : null}</div></td>
              {c.can('invoices.view') && <td data-label="Billing" className="small">{(BILLING_STATUSES as any)[j.billing_status] ?? '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div></div>
  );
}

function Board({ jobs }: { jobs: any[] }) {
  const c = useCompany();
  const cols = useMemo(() => [
    { key: 'draft', title: 'Draft', test: (j: any) => j.status === 'draft' },
    { key: 'unassigned', title: 'Needs a driver', test: (j: any) => j.status === 'open' && !j.assigned_user_id },
    { key: 'scheduled', title: 'Assigned', test: (j: any) => j.status === 'open' && j.assigned_user_id },
    { key: 'progress', title: 'In progress', test: (j: any) => j.status === 'in_progress' },
    { key: 'done', title: 'Finished', test: (j: any) => ['completed', 'partial', 'unsuccessful', 'cancelled'].includes(j.status) },
  ], []);
  return (
    <div className="board" role="list" aria-label="Status board">
      {cols.map((col) => {
        const items = jobs.filter(col.test);
        return (
          <section key={col.key} className="board-col" role="listitem" aria-labelledby={`col-${col.key}`}>
            <h3 id={`col-${col.key}`}><span>{col.title}</span><span className="muted num">{items.length}</span></h3>
            {items.map((j) => (
              <Link key={j.id} to={c.to(`jobs/${j.id}`)} className="job-card">
                <span className="row-between"><strong>#{j.number} {j.service_name ?? ''}</strong><JobStatus status={j.status} /></span>
                <span className="small">{j.customer_name}</span>
                <span className="small muted">{j.scheduled_start ? fmtDateTime(j.scheduled_start, c.company.timezone) : 'Not scheduled'}{j.assignee_name ? ` · ${j.assignee_name}` : ''}</span>
                {j.problem_open ? <Pill tone="danger">Problem reported</Pill> : null}
              </Link>
            ))}
            {items.length === 0 && <p className="small muted" style={{ padding: 4 }}>None</p>}
          </section>
        );
      })}
    </div>
  );
}

function Schedule({ jobs, onChange }: { jobs: any[]; onChange: () => void }) {
  const c = useCompany();
  const lanes = [{ id: '', name: 'Unassigned' }, ...c.members.filter((m) => jobs.some((j) => j.assigned_user_id === m.id) || m.role_key === 'driver')];
  return (
    <div className="schedule">
      {lanes.map((lane) => {
        const items = jobs.filter((j) => (j.assigned_user_id ?? '') === lane.id && j.status !== 'cancelled');
        if (lane.id && items.length === 0 && lane.name) return (
          <section key={lane.id} className="schedule-lane" aria-label={lane.name}><header><span>{lane.name}</span><span className="muted small">No jobs</span></header></section>
        );
        if (!lane.id && items.length === 0) return null;
        return (
          <section key={lane.id || 'none'} className="schedule-lane" aria-label={lane.name}>
            <header><span>{lane.name}</span><span className="muted small">{items.length} job(s)</span></header>
            <ul className="list">
              {items.map((j) => (
                <li key={j.id} className="list-item" style={{ alignItems: 'center' }}>
                  <span className="timeline-time">{fmtTime(j.scheduled_start, c.company.timezone)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}><Link to={c.to(`jobs/${j.id}`)}><strong>#{j.number} {j.service_name}</strong></Link><div className="small muted">{j.customer_name} · {j.address}</div></span>
                  <JobStatus status={j.status} />
                  <QuickAssign job={j} onDone={onChange} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export { toLocalInput };
