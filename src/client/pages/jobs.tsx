import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Plus, List, Columns3, GanttChartSquare, Search, AlertTriangle, X, ClipboardList, Truck, ArrowRightLeft } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, ApiError } from '../lib/api';
import { LinkButton, Segmented, Field, Input, Select, LoadingBlock, ErrorState, Empty, JobStatus, Pill, Button, PriorityPill, LatePill, useToast } from '../components/ui';
import { fmtDateTime, fmtTime, toLocalInput } from '../lib/format';
import { BILLING_STATUSES, isLate } from '../../shared/jobs';
import { useUnsavedGuard } from '../lib/unsaved';
import { DispatchTimeline } from '../components/timeline';
import { QuickAssign } from '../components/assign';
import { useDocumentTitle } from '../lib/title';

type View = 'list' | 'board' | 'schedule';
const FINISHED = ['completed', 'partial', 'unsuccessful', 'cancelled'];

export { QuickAssign };

const JOB_PAGE = 100;

export function Jobs() {
  const c = useCompany();
  useDocumentTitle('Jobs');
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const view = (sp.get('view') ?? 'list') as View;
  const status = sp.get('status') ?? 'active';
  const assignee = sp.get('assignee') ?? '';
  const sort = sp.get('sort') ?? 'schedule';
  const qtext = sp.get('q') ?? '';
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const priority = sp.get('priority') ?? '';
  const late = sp.get('late') === '1';
  const resource = sp.get('resource') ?? '';
  const oos = sp.get('oos') === '1';
  const params = new URLSearchParams({ status, sort, ...(assignee ? { assignee } : {}), ...(qtext ? { q: qtext } : {}), ...(sp.get('problem') ? { problem: '1' } : {}), ...(priority ? { priority } : {}), ...(late ? { late: '1' } : {}), ...(resource ? { resource } : {}), ...(oos ? { oos: '1' } : {}) });
  const resources = useQuery({ queryKey: [c.cid, 'resources'], queryFn: () => get(`/c/${c.cid}/resources`), enabled: c.can('resources.view') });
  const resourceName = resources.data?.resources.find((r: any) => r.id === resource)?.name;
  // 100 jobs at a time; "Show more" asks the server for the next ones (R17-m2).
  const q = useInfiniteQuery({
    queryKey: [c.cid, 'jobs', params.toString()], initialPageParam: 0, refetchInterval: 30_000, enabled: view !== 'schedule', placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => get(`/c/${c.cid}/jobs?${params}&limit=${JOB_PAGE}&offset=${pageParam}`),
    getNextPageParam: (last: any) => (last.hasMore ? last.offset + last.jobs.length : undefined),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: [c.cid] });
  const jobs: any[] = q.data?.pages.flatMap((pg: any) => pg.jobs) ?? [];
  const serverTime = q.data?.pages.at(-1)?.serverTime;
  const filtered = !!(qtext || assignee || status !== 'active' || sp.get('problem') || priority || late || resource || oos);
  return (
    <div className={`page${view === 'schedule' ? ' page-wide' : ''}`}>
      <div className="page-header">
        <div><h1>Jobs</h1><div className="sub">One set of jobs as a table, a status board or the day's timeline.</div></div>
        <div className="row">
          <Segmented label="View" value={view} onChange={(v) => set('view', v === 'list' ? '' : v)} options={[{ key: 'list', label: 'Table', icon: <List aria-hidden /> }, { key: 'board', label: 'Board', icon: <Columns3 aria-hidden /> }, { key: 'schedule', label: 'Timeline', icon: <GanttChartSquare aria-hidden /> }]} />
          {c.can('jobs.create') && <LinkButton variant="primary" to={c.to('jobs/new')} icon={<Plus aria-hidden />}>New job</LinkButton>}
        </div>
      </div>
      {view === 'schedule' ? <DispatchTimeline title="Timeline" allowFeed /> : <>
        <form className="card filters-card toolbar" role="search" onSubmit={(e) => e.preventDefault()}>
          <div className="search-field"><Field label="Search" id="f-q">{(p) => <div className="input-group"><Input {...p} type="search" placeholder="Customer, address, service or #" defaultValue={qtext} onChange={(e) => set('q', e.target.value)} /><span className="icon-btn" aria-hidden style={{ color: 'var(--text-2)' }}><Search /></span></div>}</Field></div>
          <Field label="Status" id="f-status">{(p) => <Select {...p} value={status} onChange={(e) => set('status', e.target.value)}>
            <option value="active">Active (draft, open, in progress)</option><option value="draft">Drafts</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="finished">Finished</option><option value="unbilled">Completed, not yet billed</option><option value="completed">Completed</option><option value="partial">Partial</option><option value="unsuccessful">Unsuccessful</option><option value="cancelled">Cancelled</option><option value="all">All</option>
          </Select>}</Field>
          <Field label="Priority" id="f-priority">{(p) => <Select {...p} value={priority} onChange={(e) => set('priority', e.target.value)}><option value="">Any priority</option><option value="high">Urgent or emergency</option><option value="emergency">Emergency only</option><option value="normal">Normal only</option></Select>}</Field>
          <Field label="Driver" id="f-assignee">{(p) => <Select {...p} value={assignee} onChange={(e) => set('assignee', e.target.value)}><option value="">Anyone</option><option value="none">Unassigned</option>{c.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>
          {view === 'list' && <Field label="Sort by" id="f-sort">{(p) => <Select {...p} value={sort} onChange={(e) => set('sort', e.target.value)}><option value="schedule">Scheduled time</option><option value="number">Newest job number</option><option value="updated">Recently updated</option><option value="customer">Customer</option></Select>}</Field>}
        </form>
        {sp.get('problem') && <div className="row"><Pill tone="danger" icon={<AlertTriangle aria-hidden />}>Showing jobs with problems</Pill><Button size="sm" variant="ghost" icon={<X aria-hidden />} onClick={() => set('problem', '')}>Clear</Button></div>}
        {late && <div className="row"><LatePill /><span className="small">Showing open jobs whose time window has ended without a start</span><Button size="sm" variant="ghost" icon={<X aria-hidden />} onClick={() => set('late', '')}>Clear</Button></div>}
        {(resource || oos) && <div className="row"><Pill tone="warning" icon={<Truck aria-hidden />}>{oos ? 'Jobs on an out-of-service truck' : `Jobs using ${resourceName ?? 'this truck'}`}</Pill><span className="small">Select jobs, then use "Swap truck".</span><Button size="sm" variant="ghost" icon={<X aria-hidden />} onClick={() => { const n = new URLSearchParams(sp); n.delete('resource'); n.delete('oos'); setSp(n, { replace: true }); }}>Clear</Button></div>}
        {q.isLoading ? <LoadingBlock rows={6} /> : q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : jobs.length === 0 ? (
          <div className="card"><Empty icon={<ClipboardList />} title={filtered ? 'No jobs match' : 'No active jobs'} action={c.can('jobs.create') ? <LinkButton variant="primary" to={c.to('jobs/new')} icon={<Plus aria-hidden />}>New job</LinkButton> : undefined}>{filtered ? 'Try a different filter or search.' : 'Create a job when a customer contacts you.'}</Empty></div>
        ) : view === 'list' ? <JobTable jobs={jobs} onChange={refresh} resources={resources.data?.resources ?? []} preferFrom={resource} /> : <Board jobs={jobs} />}
        {q.hasNextPage && <div><Button busy={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Show more jobs</Button></div>}
        {q.data && <p className="xsmall muted" aria-live="polite">{q.hasNextPage ? `First ${jobs.length} jobs` : `${jobs.length} job${jobs.length === 1 ? '' : 's'}`} · updated {fmtTime(serverTime, c.company.timezone)}</p>}
      </>}
    </div>
  );
}

function JobTable({ jobs, onChange, resources, preferFrom }: { jobs: any[]; onChange: () => void; resources: any[]; preferFrom: string }) {
  const c = useCompany();
  const toast = useToast();
  const canBulk = c.can('jobs.assign');
  const assignable = jobs.filter((j) => !FINISHED.includes(j.status));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDriver, setBulkDriver] = useState('');
  const [busy, setBusy] = useState(false);
  const [notMoved, setNotMoved] = useState<{ number: number; reason: string; overlap: boolean }[] | null>(null);
  const drivers = c.members.filter((m) => m.role_key === 'driver' || m.role_key === 'owner' || m.role_key === 'dispatcher');
  const sel = assignable.filter((j) => selected.has(j.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = assignable.length > 0 && sel.length === assignable.length;
  const guard = useUnsavedGuard(!!bulkDriver && sel.length > 0 && !busy, { message: 'You have unsaved driver changes. Save or discard?', onSave: async () => { await applyBulk(); return true; } });
  const now = Date.now();
  // Swap a truck on the selected jobs (R11-M1): from one of their trucks to one that is available.
  const onSelected = [...new Map(sel.flatMap((j) => j.resources ?? []).filter((r: any) => r.kind !== 'unit').map((r: any) => [r.id, r])).values()] as any[];
  const [swapFrom, setSwapFrom] = useState('');
  const [swapTo, setSwapTo] = useState('');
  const from = swapFrom || (onSelected.some((r) => r.id === preferFrom) ? preferFrom : onSelected.find((r) => r.status === 'out_of_service' || r.status === 'retired')?.id ?? '');
  const swapTargets = resources.filter((r) => r.kind !== 'unit' && r.id !== from && !['out_of_service', 'retired'].includes(r.status));
  const swap = async () => {
    setBusy(true);
    try {
      const r = await post<{ moved: number[]; failed: { number: number; reason: string }[]; to: string }>(`/c/${c.cid}/jobs/swap-resource`, { fromId: from, toId: swapTo, jobIds: sel.map((j) => j.id) });
      if (r.moved.length) toast(`${r.to} is now on job${r.moved.length === 1 ? '' : 's'} #${r.moved.join(', #')}`);
      if (r.failed.length) toast(`${r.failed.length} job${r.failed.length === 1 ? '' : 's'} not changed: ${r.failed.map((f) => `#${f.number}, ${f.reason}`).join('; ')}`, 'error');
      setSelected(new Set()); setSwapTo(''); setSwapFrom(''); onChange();
    } catch (e) { toast((e as ApiError).message, 'error'); } finally { setBusy(false); }
  };
  const applyBulk = async () => {
    setBusy(true);
    let ok = 0; const failed: { number: number; reason: string; overlap: boolean }[] = [];
    for (const j of sel) {
      try { await post(`/c/${c.cid}/jobs/${j.id}/assign`, { userId: bulkDriver === 'none' ? null : bulkDriver, resourceIds: (j.resources ?? []).map((r: any) => r.id), version: j.version }); ok++; }
      catch (e) { failed.push({ number: j.number, reason: (e as ApiError).message, overlap: !!(e as ApiError).details?.canOverride }); }
    }
    setBusy(false);
    if (ok) toast(`${ok} job${ok === 1 ? '' : 's'} ${bulkDriver === 'none' ? 'unassigned' : 'assigned'}`);
    // One short summary instead of a wall of messages (R11-m4); the details are in the list.
    if (failed.length) setNotMoved(failed);
    setSelected(new Set()); setBulkDriver('');
    onChange();
  };
  return (
    <>
      <div className="card card-flush"><div className="table-wrap">
        <table className="table responsive">
          <thead><tr>
            {canBulk && <th className="check-col"><input type="checkbox" aria-label="Select all open jobs" checked={allOn} disabled={!assignable.length} onChange={() => setSelected(allOn ? new Set() : new Set(assignable.map((j) => j.id)))} /></th>}
            <th>Job</th><th>Scheduled</th><th>Customer &amp; location</th><th>Driver</th><th>Status</th>{c.can('invoices.view') && <th>Billing</th>}
          </tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} aria-selected={selected.has(j.id) || undefined}>
                {canBulk && <td className="check-col">{FINISHED.includes(j.status) ? null : <input type="checkbox" aria-label={`Select job #${j.number}`} checked={selected.has(j.id)} onChange={() => toggle(j.id)} />}</td>}
                <td data-primary><Link className="row-link" to={c.to(`jobs/${j.id}`)}><span className="job-no">#{j.number}</span>{j.service_name ?? 'No service yet'}</Link>{j.resources?.length ? <div className="xsmall muted">{j.resources.map((r: any) => <span key={r.id} className={r.status === 'out_of_service' || r.status === 'retired' ? 'oos-name' : undefined}>{r.name}{r.status === 'out_of_service' ? ' (out of service)' : r.status === 'retired' ? ' (retired)' : ''}</span>).reduce((a: any[], x: any, i: number) => (i ? [...a, ', ', x] : [x]), [])}</div> : null}</td>
                <td data-label="Scheduled" className="num nowrap">{j.scheduled_start ? fmtDateTime(j.scheduled_start, c.company.timezone) : <span className="muted" style={{ fontFamily: 'var(--font-sans)' }}>Not scheduled</span>}</td>
                <td data-label="Customer">{j.customer_name ?? <span className="muted">No customer</span>}<div className="xsmall muted">{j.address}</div></td>
                <td data-label="Driver"><QuickAssign job={j} onDone={onChange} /></td>
                <td data-label="Status"><div className="row" style={{ gap: 6 }}><JobStatus status={j.status} /><PriorityPill priority={j.priority} />{isLate(j, now) ? <LatePill /> : null}{j.problem_open ? <Pill tone="danger" icon={<AlertTriangle aria-hidden />}>Problem</Pill> : null}</div></td>
                {c.can('invoices.view') && <td data-label="Billing" className="small muted">{(BILLING_STATUSES as any)[j.billing_status] ?? '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
      {canBulk && sel.length > 0 && (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <strong className="small">{sel.length} selected</strong>
          <label className="sr-only" htmlFor="bulk-driver">Driver for selected jobs</label>
          <select id="bulk-driver" className="select" value={bulkDriver} onChange={(e) => setBulkDriver(e.target.value)}>
            <option value="">Choose a driver…</option><option value="none">Unassigned</option>{drivers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <Button size="sm" variant="primary" busy={busy} disabled={!bulkDriver} onClick={applyBulk}>Assign {sel.length} job{sel.length === 1 ? '' : 's'}</Button>
          {bulkDriver ? <span className="small">Press Assign to apply</span> : null}
          {onSelected.length > 0 && <>
            <span className="bulk-sep" aria-hidden />
            <label className="sr-only" htmlFor="swap-from">Truck to replace</label>
            <select id="swap-from" className="select" value={from} onChange={(e) => setSwapFrom(e.target.value)}>
              <option value="">Swap which truck…</option>{onSelected.map((r) => <option key={r.id} value={r.id}>{r.name}{r.status === 'out_of_service' ? ' (out of service)' : ''}</option>)}
            </select>
            <label className="sr-only" htmlFor="swap-to">Replacement truck</label>
            <select id="swap-to" className="select" value={swapTo} onChange={(e) => setSwapTo(e.target.value)}>
              <option value="">For…</option>{swapTargets.map((r) => <option key={r.id} value={r.id}>{r.name}{r.capacity ? ` (${r.capacity})` : ''}</option>)}
            </select>
            <Button size="sm" icon={<ArrowRightLeft aria-hidden />} busy={busy} disabled={!from || !swapTo} onClick={swap}>Swap truck</Button>
          </>}
          <span className="spacer" />
          <Button size="sm" icon={<X aria-hidden />} onClick={() => setSelected(new Set())}>Clear selection</Button>
        </div>
      )}
      {notMoved && (
        <div className="banner banner-warning" role="alert">
          <AlertTriangle aria-hidden />
          <div className="stack-sm" style={{ flex: 1 }}>
            <strong>{notMoved.length} job{notMoved.length === 1 ? '' : 's'} not changed{notMoved.every((f) => f.overlap) ? ': they overlap other work at those times' : ''}.</strong>
            <details><summary>View list</summary><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{notMoved.map((f) => <li key={f.number}>#{f.number}: {f.reason}</li>)}</ul></details>
            <span className="small">Open a job to assign it anyway if the overlap is deliberate.</span>
          </div>
          <Button size="sm" variant="ghost" icon={<X aria-hidden />} aria-label="Dismiss" onClick={() => setNotMoved(null)} />
        </div>
      )}
      {guard}
    </>
  );
}

function Board({ jobs }: { jobs: any[] }) {
  const c = useCompany();
  const cols = useMemo(() => [
    { key: 'draft', title: 'Draft', test: (j: any) => j.status === 'draft' },
    { key: 'unassigned', title: 'Needs a driver', test: (j: any) => j.status === 'open' && !j.assigned_user_id },
    { key: 'scheduled', title: 'Assigned', test: (j: any) => j.status === 'open' && j.assigned_user_id },
    { key: 'progress', title: 'In progress', test: (j: any) => j.status === 'in_progress' },
    { key: 'done', title: 'Finished', test: (j: any) => FINISHED.includes(j.status) },
  ], []);
  return (
    <div className="board" role="list" aria-label="Status board">
      {cols.map((col) => {
        const items = jobs.filter(col.test);
        return (
          <section key={col.key} className="board-col" role="listitem" aria-labelledby={`col-${col.key}`}>
            <h3 id={`col-${col.key}`}><span>{col.title}</span><span className="num">{items.length}</span></h3>
            {items.map((j) => (
              <Link key={j.id} to={c.to(`jobs/${j.id}`)} className="job-card">
                <span className="row-between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><strong style={{ fontWeight: 550 }}><span className="num muted" style={{ marginRight: 6 }}>#{j.number}</span>{j.service_name ?? ''}</strong><JobStatus status={j.status} /></span>
                <span>{j.customer_name}</span>
                <span className="xsmall muted"><span className="num">{j.scheduled_start ? fmtDateTime(j.scheduled_start, c.company.timezone) : 'Not scheduled'}</span>{j.assignee_name ? ` · ${j.assignee_name}` : ''}</span>
                {j.priority !== 'normal' || isLate(j) || j.problem_open ? <span className="row" style={{ gap: 6 }}><PriorityPill priority={j.priority} />{isLate(j) ? <LatePill /> : null}{j.problem_open ? <Pill tone="danger" icon={<AlertTriangle aria-hidden />}>Problem reported</Pill> : null}</span> : null}
              </Link>
            ))}
            {items.length === 0 && <p className="xsmall muted" style={{ padding: 6, margin: 0 }}>None</p>}
          </section>
        );
      })}
    </div>
  );
}

export { toLocalInput };
