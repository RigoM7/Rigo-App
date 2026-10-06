import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, GanttChartSquare, ListOrdered, AlertTriangle, CircleDot, Clock, CheckCircle2, XCircle, PlayCircle, UserX, Truck, MapPin, ArrowUpRight, Pencil } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get } from '../lib/api';
import { fmtTime } from '../lib/format';
import { addDays, zonedToUtc, localDate } from '../../shared/schedule';
import { Segmented, Button, Drawer, JobStatus, Pill, LoadingBlock, ErrorState, Empty, LinkButton, TickNumber, LiveDot } from './ui';
import { QuickAssign } from './assign';

// The live dispatch timeline: one lane per driver across the day in the company's time zone,
// an Unassigned lane on top, and a red "now" line moving across. Also a feed view of the same
// jobs in time order. Day, view and filters live in the URL.

type Job = any;
const STATUS_ICON: Record<string, ReactElement> = {
  draft: <CircleDot aria-hidden />, open: <Clock aria-hidden />, in_progress: <PlayCircle aria-hidden />, completed: <CheckCircle2 aria-hidden />,
  partial: <AlertTriangle aria-hidden />, unsuccessful: <XCircle aria-hidden />,
};
const STATUS_LABEL: Record<string, string> = { draft: 'Draft', open: 'Open', in_progress: 'In progress', completed: 'Completed', partial: 'Partial', unsuccessful: 'Unsuccessful' };

/** Minutes since local midnight of `day` in the company time zone. */
function minutesInDay(iso: string, day: string, tz: string) {
  const start = zonedToUtc(day, '00:00', tz).getTime();
  return (new Date(iso).getTime() - start) / 60000;
}
function dayLabel(day: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
}
function hourLabel(h: number) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2020, 0, 1, h % 24)));
}
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

/** Lay jobs into rows so overlapping jobs in one lane never cover each other. */
function packRows(items: { job: Job; s: number; e: number }[]) {
  const rows: number[] = [];
  return items.map((it) => {
    let r = rows.findIndex((end) => end <= it.s);
    if (r === -1) { r = rows.length; rows.push(it.e); } else rows[r] = it.e;
    return { ...it, row: r };
  });
}

function useNowTick(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function useScrollToNow(ref: React.RefObject<HTMLDivElement | null>, frac: number | null, key: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el || frac === null || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = Math.max(0, frac * el.scrollWidth - el.clientWidth / 3);
    // Only on first render of a day/view; later ticks never steal the scroll position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export function DispatchTimeline({ title = "Today's timeline", allowFeed = true }: { title?: string; allowFeed?: boolean }) {
  const c = useCompany();
  const qc = useQueryClient();
  const tz = c.company.timezone;
  const [sp, setSp] = useSearchParams();
  const today = localDate(new Date(), tz);
  const day = sp.get('day') ?? today;
  const view = allowFeed && sp.get('tl') === 'feed' ? 'feed' : 'lanes';
  const svc = sp.get('svc') ?? '';
  const drv = sp.get('drv') ?? '';
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const params = new URLSearchParams({ status: 'all', sort: 'schedule', from: zonedToUtc(day, '00:00', tz).toISOString(), to: zonedToUtc(addDays(day, 1), '00:00', tz).toISOString() });
  const q = useQuery({ queryKey: [c.cid, 'jobs', 'timeline', params.toString()], queryFn: () => get(`/c/${c.cid}/jobs?${params}`), refetchInterval: 30_000 });
  const now = useNowTick();
  const [openJob, setOpenJob] = useState<Job | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: [c.cid] });

  const all: Job[] = useMemo(() => (q.data?.jobs ?? []).filter((j: Job) => j.status !== 'cancelled' && j.scheduled_start), [q.data]);
  const services = useMemo(() => [...new Set(all.map((j) => j.service_name).filter(Boolean))].sort() as string[], [all]);
  const jobs = all.filter((j) => (!svc || j.service_name === svc) && (!drv || (drv === 'none' ? !j.assigned_user_id : j.assigned_user_id === drv)));
  // Keep the open job in the panel fresh after a refetch (for example after reassigning).
  const current = openJob ? (all.find((j) => j.id === openJob.id) ?? openJob) : null;

  const isToday = day === today;
  const nowMin = isToday ? minutesInDay(new Date(now).toISOString(), day, tz) : null;

  const spans = jobs.map((j) => { const s = minutesInDay(j.scheduled_start, day, tz); const e = j.scheduled_end ? minutesInDay(j.scheduled_end, day, tz) : s + 60; return { job: j, s, e: Math.max(e, s + 30) }; });
  // Visible hours: an hour either side of the day's jobs and the current time, at least 8 hours.
  let lo = Infinity, hi = -Infinity;
  for (const x of spans) { lo = Math.min(lo, x.s); hi = Math.max(hi, x.e); }
  if (nowMin !== null && nowMin >= 0 && nowMin < 1440) { lo = Math.min(lo, nowMin); hi = Math.max(hi, nowMin); }
  if (!Number.isFinite(lo)) { lo = 7 * 60; hi = 17 * 60; }
  let h0 = Math.max(0, Math.floor(lo / 60) - 1), h1 = Math.min(24, Math.ceil(hi / 60) + 1);
  if (h1 - h0 < 8) { h1 = Math.min(24, h0 + 8); h0 = Math.max(0, h1 - 8); }
  const hours = h1 - h0;
  const pct = (min: number) => Math.max(0, Math.min(100, ((min - h0 * 60) / (hours * 60)) * 100));
  const x = (min: number) => `${pct(min).toFixed(3)}%`;

  const memberLanes = c.members.filter((m) => m.role_key === 'driver' || jobs.some((j) => j.assigned_user_id === m.id));
  const lanes = [
    { id: '', name: 'Unassigned' },
    ...memberLanes.filter((m) => !drv || drv === m.id).map((m) => ({ id: m.id, name: m.name })),
  ].filter((l) => !(drv && drv !== 'none' && l.id === '') && !(drv === 'none' && l.id !== ''));

  const count = (st: string[]) => jobs.filter((j) => st.includes(j.status)).length;
  const summary = { total: jobs.length, live: count(['in_progress']), done: count(['completed']), unassigned: jobs.filter((j) => !j.assigned_user_id && ['open', 'draft'].includes(j.status)).length, exceptions: count(['partial', 'unsuccessful']) };

  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollToNow(scrollRef, nowMin === null ? null : pct(nowMin) / 100, `${day}-${view}-${q.isSuccess}`);
  const label = (j: Job) => `#${j.number} ${j.service_name ?? 'Job'}, ${j.customer_name ?? 'no customer'}, ${fmtTime(j.scheduled_start, tz)}${j.scheduled_end ? ` to ${fmtTime(j.scheduled_end, tz)}` : ''}, ${STATUS_LABEL[j.status] ?? j.status}${j.assigned_user_id ? `, ${j.assignee_name}` : ', no driver'}${j.problem_open ? ', problem reported' : ''}`;

  return (
    <section className="card tl-card" aria-labelledby="tl-title">
      <div className="tl-toolbar">
        <h2 id="tl-title">{isToday ? <LiveDot /> : null}{isToday ? title : 'Timeline'}</h2>
        <span className="spacer" />
        <div className="tl-day" role="group" aria-label="Day">
          <Button size="sm" variant="ghost" aria-label="Previous day" onClick={() => set('day', addDays(day, -1))}><ChevronLeft aria-hidden /></Button>
          <span className="day-label" aria-live="polite">{isToday ? `Today · ${dayLabel(day)}` : dayLabel(day)}</span>
          <Button size="sm" variant="ghost" aria-label="Next day" onClick={() => set('day', addDays(day, 1))}><ChevronRight aria-hidden /></Button>
          {!isToday && <Button size="sm" onClick={() => set('day', '')}>Today</Button>}
        </div>
        <label className="sr-only" htmlFor="tl-svc">Service</label>
        <select id="tl-svc" className="select" value={svc} onChange={(e) => set('svc', e.target.value)}>
          <option value="">All services</option>{services.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="sr-only" htmlFor="tl-drv">Driver</label>
        <select id="tl-drv" className="select" value={drv} onChange={(e) => set('drv', e.target.value)}>
          <option value="">All drivers</option><option value="none">Unassigned</option>{memberLanes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {allowFeed && <Segmented label="Timeline view" value={view} onChange={(v) => set('tl', v === 'lanes' ? '' : v)} options={[{ key: 'lanes', label: 'Lanes', icon: <GanttChartSquare aria-hidden /> }, { key: 'feed', label: 'Feed', icon: <ListOrdered aria-hidden /> }]} />}
      </div>
      {q.isLoading ? <div style={{ padding: 16 }}><LoadingBlock rows={5} /></div> : q.error ? <div style={{ padding: 16 }}><ErrorState error={q.error} retry={() => q.refetch()} /></div> : (
        <>
          <div className="tl-summary" role="status" aria-live="polite" aria-atomic="true">
            <span><b><TickNumber value={summary.total} /></b>scheduled</span>
            <span className="row" style={{ gap: 6 }}>{summary.live ? <LiveDot /> : null}<b><TickNumber value={summary.live} /></b>in progress</span>
            <span><b><TickNumber value={summary.done} /></b>completed</span>
            <span><b><TickNumber value={summary.unassigned} /></b>without a driver</span>
            <span><b><TickNumber value={summary.exceptions} /></b>partial or unsuccessful</span>
            {nowMin !== null && <span className="hide-mobile" style={{ marginLeft: 'auto' }}>Times in {tz.replace(/_/g, ' ')}</span>}
          </div>
          {jobs.length === 0 ? (
            <Empty icon={<GanttChartSquare />} title={svc || drv ? 'No jobs match these filters' : isToday ? 'Nothing scheduled today' : 'Nothing scheduled this day'}
              action={svc || drv ? <Button size="sm" onClick={() => { const n = new URLSearchParams(sp); n.delete('svc'); n.delete('drv'); setSp(n, { replace: true }); }}>Clear filters</Button> : c.can('jobs.create') ? <LinkButton variant="primary" to={c.to('jobs/new')}>New job</LinkButton> : undefined}>
              {svc || drv ? 'Try another service or driver.' : 'Scheduled jobs appear here in driver lanes as soon as they have a time.'}
            </Empty>
          ) : view === 'lanes' ? (
            <div className="tl-scroll" ref={scrollRef}>
              <div className="tl-grid" style={{ '--tl-hours': hours } as CSSProperties}>
                <div className="tl-hours" aria-hidden><span />{Array.from({ length: hours }, (_, i) => <span key={i}>{hourLabel(h0 + i)}</span>)}</div>
                {lanes.map((lane) => {
                  const items = packRows(spans.filter((s) => (s.job.assigned_user_id ?? '') === lane.id).sort((a, b) => a.s - b.s));
                  const rowsN = Math.max(1, ...items.map((i) => i.row + 1));
                  const trucks = [...new Set(items.flatMap((i) => (i.job.resources ?? []).filter((r: any) => r.kind === 'truck').map((r: any) => r.name)))];
                  const unassigned = lane.id === '';
                  return (
                    <div key={lane.id || 'none'} className={`tl-lane${unassigned ? ' unassigned' : ''}`} style={{ minHeight: 16 + rowsN * 64 }}>
                      <div className="tl-lane-head">
                        <span className="who">{unassigned ? <UserX aria-hidden /> : <span className="tl-avatar" aria-hidden>{initials(lane.name)}</span>}<span>{lane.name}</span></span>
                        <span className="what">{unassigned ? (items.length ? `${items.length} job${items.length === 1 ? ' needs' : 's need'} a driver` : 'Every job has a driver') : trucks.length ? trucks.join(', ') : items.length ? 'No truck on these jobs' : 'No jobs this day'}</span>
                      </div>
                      <div className="tl-track">
                        {nowMin !== null && <div className="past" style={{ width: x(nowMin) }} />}
                        <ul className="list" aria-label={`${lane.name}: ${items.length} job${items.length === 1 ? '' : 's'}`} style={{ position: 'absolute', inset: 0 }}>
                          {items.map(({ job: j, s, e, row }) => (
                            <li key={j.id} style={{ border: 0 }}>
                              <button type="button" className={`tl-block st-${j.status}${j.problem_open ? ' problem' : ''}${(e - s) / (hours * 60) < 0.045 ? ' compact' : ''}`}
                                style={{ left: x(s), width: `calc(${(pct(e) - pct(s)).toFixed(3)}% - 4px)`, top: 8 + row * 64 }}
                                title={label(j)} onClick={() => setOpenJob(j)}>
                                <span className="t">{j.status === 'in_progress' ? <LiveDot /> : null}{fmtTime(j.scheduled_start, tz)}<span aria-hidden>·</span>#{j.number}</span>
                                <span className="c">{j.customer_name ?? j.service_name ?? 'Job'}</span>
                                <span className="s">{j.problem_open ? <AlertTriangle aria-hidden style={{ color: 'var(--danger)' }} /> : STATUS_ICON[j.status]}{j.problem_open ? 'Problem' : STATUS_LABEL[j.status]} · {j.service_name ?? ''}</span>
                                <span className="sr-only">{j.scheduled_end ? `, until ${fmtTime(j.scheduled_end, tz)}` : ''}{j.assigned_user_id ? `, ${j.assignee_name}` : ', no driver'}{j.problem_open ? `, ${STATUS_LABEL[j.status]}` : ''}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                        {items.length === 0 && !unassigned ? <span className="tl-empty-lane" aria-hidden>Free</span> : null}
                      </div>
                    </div>
                  );
                })}
                {nowMin !== null && nowMin >= h0 * 60 && nowMin <= h1 * 60 && (
                  <div className="tl-now" style={{ left: `calc(var(--tl-label-w) + (100% - var(--tl-label-w)) * ${(pct(nowMin) / 100).toFixed(5)})` }} aria-hidden>
                    <span className="tl-now-label">{fmtTime(new Date(now).toISOString(), tz)}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <Feed jobs={jobs} nowMin={nowMin} day={day} tz={tz} now={now} onOpen={setOpenJob} />
          )}
          <div className="tl-legend" aria-label="Legend">
            {(['open', 'in_progress', 'completed', 'partial', 'unsuccessful', 'draft'] as const).map((st) => <span key={st} className={`st-${st}`}><i aria-hidden style={{ background: `var(--tl-tone)` }} className={`tl-block-swatch st-${st}`} />{STATUS_LABEL[st]}</span>)}
          </div>
        </>
      )}
      <JobPanel job={current} onClose={() => setOpenJob(null)} onChange={refresh} />
    </section>
  );
}

function Feed({ jobs, nowMin, day, tz, now, onOpen }: { jobs: Job[]; nowMin: number | null; day: string; tz: string; now: number; onOpen: (j: Job) => void }) {
  const sorted = [...jobs].sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
  const nowIdx = nowMin === null ? -1 : sorted.findIndex((j) => minutesInDay(j.scheduled_start, day, tz) > nowMin);
  const rows: ReactElement[] = [];
  sorted.forEach((j, i) => {
    if (i === nowIdx) rows.push(<NowRow key="now" now={now} tz={tz} />);
    rows.push(
      <li key={j.id} className={`st-${j.status}`}>
        <span className="ft">{fmtTime(j.scheduled_start, tz)}</span>
        <span className={`fdot${j.status === 'in_progress' ? ' live' : ''}`} aria-hidden />
        <div className="fbody">
          <div className="fmain">
            <button type="button" className="linkish" onClick={() => onOpen(j)}>#{j.number} {j.service_name ?? 'Job'} · {j.customer_name ?? 'No customer'}</button>
            <div className="small muted">{j.address ?? 'No location'} · {j.assignee_name ?? 'No driver yet'}{j.scheduled_end ? ` · until ${fmtTime(j.scheduled_end, tz)}` : ''}</div>
          </div>
          <span className="row" style={{ gap: 6 }}><JobStatus status={j.status} />{j.problem_open ? <Pill tone="danger" icon={<AlertTriangle aria-hidden />}>Problem</Pill> : null}{!j.assigned_user_id && ['open', 'draft'].includes(j.status) ? <Pill tone="warning" icon={<UserX aria-hidden />}>No driver</Pill> : null}</span>
        </div>
      </li>,
    );
  });
  if (nowMin !== null && nowIdx === -1) rows.push(<NowRow key="now" now={now} tz={tz} />);
  return <ol className="feed" aria-label="Jobs in time order">{rows}</ol>;
}

function NowRow({ now, tz }: { now: number; tz: string }) {
  return <li className="now-row" aria-label={`Now, ${fmtTime(new Date(now).toISOString(), tz)}`}><span className="ft">{fmtTime(new Date(now).toISOString(), tz)}</span><span className="fdot" aria-hidden /><div className="fbody">Now</div></li>;
}

/** Job side panel: the job's essentials and its key actions, without leaving the timeline. */
export function JobPanel({ job, onClose, onChange }: { job: Job | null; onClose: () => void; onChange: () => void }) {
  const c = useCompany();
  const tz = c.company.timezone;
  const j = job;
  return (
    <Drawer open={!!j} onClose={onClose} title={j ? <span className="row" style={{ gap: 8 }}><span className="num muted">#{j.number}</span>{j.service_name ?? 'Job'}</span> : ''}
      sub={j ? <span className="row" style={{ gap: 6 }}><JobStatus status={j.status} />{j.problem_open ? <Pill tone="danger" icon={<AlertTriangle aria-hidden />}>Problem reported</Pill> : null}</span> : null}
      footer={j ? <><LinkButton variant="primary" to={c.to(`jobs/${j.id}`)} icon={<ArrowUpRight aria-hidden />}>Open job</LinkButton>{c.can('jobs.edit') && !['completed', 'partial', 'unsuccessful', 'cancelled'].includes(j.status) ? <LinkButton to={c.to(`jobs/${j.id}/edit`)} icon={<Pencil aria-hidden />}>Edit</LinkButton> : null}</> : null}>
      {j && <>
        <dl className="kv">
          <dt>When</dt><dd className="num">{fmtTime(j.scheduled_start, tz)}{j.scheduled_end ? ` – ${fmtTime(j.scheduled_end, tz)}` : ''}</dd>
          <dt>Customer</dt><dd>{j.customer_name ?? <span className="muted">No customer</span>}</dd>
          <dt>Where</dt><dd className="row" style={{ gap: 6, alignItems: 'flex-start', flexWrap: 'nowrap' }}><MapPin aria-hidden style={{ width: 15, flex: 'none', marginTop: 3 }} />{j.address ?? <span className="muted">No location</span>}</dd>
          <dt>Truck &amp; equipment</dt><dd className="row" style={{ gap: 6 }}>{j.resources?.length ? <><Truck aria-hidden style={{ width: 15 }} />{j.resources.map((r: any) => r.name).join(', ')}</> : <span className="muted">None assigned</span>}</dd>
        </dl>
        <div className="stack-sm">
          <span className="label">Driver</span>
          <QuickAssign job={j} onDone={onChange} />
          {c.can('jobs.assign') ? <span className="hint">Choose a driver, then Save. Conflicting assignments are refused with an explanation.</span> : null}
        </div>
        {j.nextAction ? <div className="banner"><Clock aria-hidden /><span><strong>Next:</strong> {j.nextAction}</span></div> : null}
        <Link to={c.to(`jobs?view=board`)} className="small">See every job on the status board</Link>
      </>}
    </Drawer>
  );
}
