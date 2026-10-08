import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, List, Columns3, CalendarDays, GanttChart, ChevronLeft, ChevronRight, MapPin, Pencil, Clock, User, Wrench, FileText, History, Navigation, Search as SearchIcon, ArrowRight, Trash2 } from 'lucide-react';
import { get, post, patch, put } from '../lib/api';
import { useWorkspace } from '../lib/session';
import { useSubmit } from '../lib/form';
import { useTitle } from '../lib/title';
import { fmtDateTime, fmtTime, fmtDay, dayKey, minutesOfDay, toLocalInput, mapsUrl, relTime, plural } from '../lib/format';
import { PageHeader, Button, LinkButton, StageBadge, Empty, Loading, ErrorState, Segmented, TextField, TextArea, SelectField, FormError, Money, Dialog, Banner, useToast, Check, fieldErrors } from '../components/ui';
import { FieldInput, FieldValues } from '../components/fields';
import { zonedToUtc, addDays } from '../../shared/schedule';
import { formatRate, lineAmount, rateToInput, parseRate } from '../../shared/money';
import { isClosed, type Meaning } from '../../shared/workspace';

// Work and schedule: the main record in the workspace's own words, as a list, a board by stage, a
// calendar and a lane-per-person timeline. Assigning never needs dragging: selects and buttons only.

export interface WorkItem {
  id: string; number: number; title: string; notes: string; version: number; source: string; billing: string;
  startsAt: string | null; endsAt: string | null; createdAt: string; closedAt: string | null;
  stage: { id: string; key: string; name: string; meaning: Meaning };
  client: { id: string; name: string; phone?: string; email?: string } | null;
  place: { id: string; label: string; address: string; notes: string } | null;
  assignees: { id: string; name: string }[]; equipment: { id: string; name: string }[];
  fields: Record<string, unknown>;
}

export const workLabel = (w: WorkItem, one: string) => w.title || w.client?.name || `${one} #${w.number}`;

type View = 'list' | 'board' | 'calendar' | 'timeline';

export function WorkList() {
  const ws = useWorkspace();
  const [sp, setSp] = useSearchParams();
  const view = (sp.get('view') as View) || 'list';
  const W = ws.words.work;
  useTitle(W.many, ws.workspace.name);
  const setView = (v: View) => { const n = new URLSearchParams(sp); n.set('view', v); setSp(n, { replace: true }); };
  return (
    <div className="page">
      <PageHeader title={W.many}>
        {ws.can('work.create') && <LinkButton to={ws.to('work/new')} variant="primary" icon={<Plus size={18} aria-hidden="true" />}>New {W.one.toLowerCase()}</LinkButton>}
      </PageHeader>
      <Segmented<View> label="View" value={view} onChange={setView} options={[
        { value: 'list', label: <><List size={16} aria-hidden="true" />List</> },
        { value: 'board', label: <><Columns3 size={16} aria-hidden="true" />Stages</> },
        { value: 'calendar', label: <><CalendarDays size={16} aria-hidden="true" />Calendar</> },
        { value: 'timeline', label: <><GanttChart size={16} aria-hidden="true" />Day by person</> },
      ]} />
      {view === 'list' && <ListView />}
      {view === 'board' && <BoardView />}
      {view === 'calendar' && <CalendarView />}
      {view === 'timeline' && <TimelineView />}
    </div>
  );
}

function ListView() {
  const ws = useWorkspace();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const stage = sp.get('stage') ?? '';
  const assignee = sp.get('assignee') ?? '';
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  useEffect(() => { const t = setTimeout(() => set('q', q.trim()), 250); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const params = new URLSearchParams({ order: 'recent' });
  for (const k of ['q', 'stage', 'assignee']) if (sp.get(k)) params.set(k, sp.get(k)!);
  const r = useQuery({ queryKey: [ws.cid, 'work', 'list', params.toString()], queryFn: () => get<{ items: WorkItem[] }>(`/c/${ws.cid}/work?${params}`) });
  const W = ws.words.work;
  return (
    <div className="stack">
      <div className="grid-3">
        <TextField label="Search" type="search" placeholder={`Number, ${ws.words.customer.one.toLowerCase()} or address`} value={q} onChange={(e) => setQ(e.target.value)} />
        <SelectField label="Stage" value={stage} onChange={(e) => set('stage', e.target.value)}>
          <option value="">All stages</option>
          {ws.stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
        </SelectField>
        <SelectField label="Assigned to" value={assignee} onChange={(e) => set('assignee', e.target.value)}>
          <option value="">Anyone</option>
          <option value="none">Nobody yet</option>
          {ws.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </SelectField>
      </div>
      {r.isLoading ? <Loading /> : r.error ? <ErrorState error={r.error} retry={() => r.refetch()} /> : !r.data!.items.length ? (
        <div className="card"><Empty icon={<SearchIcon />} title={sp.toString().replace(/view=\w+&?/, '') ? `No ${W.many.toLowerCase()} match` : `No ${W.many.toLowerCase()} yet`}
          action={ws.can('work.create') ? <LinkButton to={ws.to('work/new')} variant="primary" icon={<Plus size={18} aria-hidden="true" />}>New {W.one.toLowerCase()}</LinkButton> : undefined}>
          {sp.toString().replace(/view=\w+&?/, '') ? 'Try fewer filters.' : `Add your first ${W.one.toLowerCase()}, or accept a request from your booking page.`}</Empty></div>
      ) : (
        <div className="card card-flush"><ul className="divider-list">
          {r.data!.items.map((w) => (
            <li key={w.id}><Link className="list-row" to={ws.to(`work/${w.id}`)}>
              <span className="mono muted" style={{ width: 52, flex: 'none' }}>#{w.number}</span>
              <span className="row-main">
                <span className="row-title">{workLabel(w, W.one)}</span>
                <span className="row-sub">{[w.startsAt ? fmtDateTime(w.startsAt, ws.workspace.timezone) : 'No time set', w.client?.name !== workLabel(w, W.one) ? w.client?.name : null, w.assignees.map((a) => a.name).join(', ') || 'Nobody assigned'].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="row-end"><StageBadge name={w.stage.name} meaning={w.stage.meaning} /></span>
            </Link></li>
          ))}
        </ul></div>
      )}
    </div>
  );
}

function BoardView() {
  const ws = useWorkspace();
  const r = useQuery({ queryKey: [ws.cid, 'work', 'board'], queryFn: () => get<{ items: WorkItem[] }>(`/c/${ws.cid}/work?order=recent`) });
  if (r.isLoading) return <Loading />;
  if (r.error) return <ErrorState error={r.error} retry={() => r.refetch()} />;
  return (
    <div className="stage-board" role="list" aria-label="Stages">
      {ws.stages.map((s) => {
        const all = r.data!.items.filter((w) => w.stage.id === s.id);
        const items = isClosed(s.meaning) ? all.slice(0, 10) : all;
        return (
          <section key={s.id} className="stage-col" role="listitem" aria-label={s.name}>
            <h3><StageBadge name={s.name} meaning={s.meaning} /><span className="mono small muted">{all.length}</span></h3>
            {items.map((w) => (
              <Link key={w.id} to={ws.to(`work/${w.id}`)} className="work-card">
                <span className="title">{workLabel(w, ws.words.work.one)}</span>
                <span className="small muted">{w.startsAt ? fmtDateTime(w.startsAt, ws.workspace.timezone) : 'No time set'}</span>
                <span className="small muted">{w.assignees.map((a) => a.name).join(', ') || 'Nobody assigned'}</span>
              </Link>
            ))}
            {all.length > items.length && <Link to={ws.to(`work?view=list&stage=${s.key}`)} className="small">All {all.length}</Link>}
            {!all.length && <p className="small muted">Nothing here.</p>}
          </section>
        );
      })}
    </div>
  );
}

function monthGrid(month: string) {
  const first = `${month}-01`;
  const startDow = new Date(`${first}T12:00:00Z`).getUTCDay();
  const gridStart = addDays(first, -((startDow + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

function CalendarView() {
  const ws = useWorkspace();
  const tz = ws.workspace.timezone;
  const today = dayKey(new Date(), tz);
  const [month, setMonth] = useState(today.slice(0, 7));
  const days = monthGrid(month);
  const r = useQuery({ queryKey: [ws.cid, 'schedule', days[0], days[41]], queryFn: () => get<{ items: WorkItem[]; unscheduled: WorkItem[] }>(`/c/${ws.cid}/schedule?from=${days[0]}&to=${days[41]}`) });
  const byDay = useMemo(() => {
    const m = new Map<string, WorkItem[]>();
    for (const w of r.data?.items ?? []) { const k = dayKey(w.startsAt!, tz); m.set(k, [...(m.get(k) ?? []), w]); }
    return m;
  }, [r.data, tz]);
  const shift = (n: number) => { const [y, mo] = month.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
  const label = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-15T12:00:00Z`));
  const agendaDays = days.filter((d) => d.startsWith(month) && (byDay.get(d)?.length ?? 0) > 0);
  return (
    <div className="stack">
      <div className="row-between">
        <h2>{label}</h2>
        <div className="row"><Button size="sm" onClick={() => shift(-1)} icon={<ChevronLeft size={16} aria-hidden="true" />}>Previous</Button><Button size="sm" onClick={() => setMonth(today.slice(0, 7))}>This month</Button><Button size="sm" onClick={() => shift(1)}>Next<ChevronRight size={16} aria-hidden="true" /></Button></div>
      </div>
      {r.isLoading ? <Loading /> : r.error ? <ErrorState error={r.error} retry={() => r.refetch()} /> : (
        <>
          <div className="cal" aria-label={label} role="region">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cal-head" aria-hidden="true">{d}</div>)}
            {days.map((d) => {
              const items = byDay.get(d) ?? [];
              return (
                <div key={d} className={`cal-day ${d.startsWith(month) ? '' : 'out'} ${d === today ? 'today' : ''}`}>
                  <span className="daynum"><b aria-hidden="true">{Number(d.slice(8))}</b><span className="sr-only">{fmtDay(`${d}T12:00:00Z`, 'UTC')}{d === today ? ', today' : ''}, {plural(items.length, ws.words.work.one.toLowerCase(), ws.words.work.many.toLowerCase())}</span></span>
                  {items.slice(0, 4).map((w) => <Link key={w.id} to={ws.to(`work/${w.id}`)} className={`cal-item m-${w.stage.meaning}`} title={`${fmtTime(w.startsAt, tz)} ${workLabel(w, ws.words.work.one)} (${w.stage.name})`}><span className="time">{fmtTime(w.startsAt, tz)}</span> {workLabel(w, ws.words.work.one)}</Link>)}
                  {items.length > 4 && <span className="tiny muted">+{items.length - 4} more</span>}
                </div>
              );
            })}
          </div>
          <div className="agenda">
            {!agendaDays.length && <div className="card"><Empty icon={<CalendarDays />} title={`Nothing scheduled in ${label}`} /></div>}
            {agendaDays.map((d) => (
              <section key={d} className="stack-sm">
                <h3>{fmtDay(`${d}T12:00:00Z`, 'UTC')}</h3>
                <div className="card card-flush"><ul className="divider-list">
                  {byDay.get(d)!.map((w) => <li key={w.id}><Link className="list-row" to={ws.to(`work/${w.id}`)}><span className="time" style={{ width: 64 }}>{fmtTime(w.startsAt, tz)}</span><span className="row-main"><span className="row-title">{workLabel(w, ws.words.work.one)}</span><span className="row-sub">{w.assignees.map((a) => a.name).join(', ') || 'Nobody assigned'}</span></span><StageBadge name={w.stage.name} meaning={w.stage.meaning} /></Link></li>)}
                </ul></div>
              </section>
            ))}
          </div>
          {(r.data?.unscheduled.length ?? 0) > 0 && <Banner tone="plain" title={`${r.data!.unscheduled.length} open without a time`} action={<LinkButton size="sm" to={ws.to('work?view=list')}>See them</LinkButton>} />}
        </>
      )}
    </div>
  );
}

function TimelineView() {
  const ws = useWorkspace();
  const tz = ws.workspace.timezone;
  const today = dayKey(new Date(), tz);
  const [day, setDay] = useState(today);
  const [lanes, setLanes] = useState<'people' | 'equipment'>('people');
  const r = useQuery({ queryKey: [ws.cid, 'schedule', day, day], queryFn: () => get<{ items: WorkItem[]; unscheduled: WorkItem[]; people: any[]; equipment: any[] }>(`/c/${ws.cid}/schedule?from=${day}&to=${day}`) });
  const items = r.data?.items ?? [];
  let startH = 7, endH = 19;
  for (const w of items) {
    const s = minutesOfDay(w.startsAt!, tz) / 60;
    const e = w.endsAt ? minutesOfDay(w.endsAt, tz) / 60 : s + 1;
    startH = Math.min(startH, Math.floor(s)); endH = Math.max(endH, Math.ceil(e > s ? e : s + 1));
  }
  endH = Math.min(24, endH);
  const span = (endH - startH) * 60;
  const pos = (w: WorkItem) => {
    const s = minutesOfDay(w.startsAt!, tz) - startH * 60;
    let e = w.endsAt ? minutesOfDay(w.endsAt, tz) - startH * 60 : s + 60;
    if (e <= s) e = s + 60;
    return { left: `${Math.max(0, (s / span) * 100)}%`, width: `${Math.max(2.5, ((Math.min(e, span) - s) / span) * 100)}%` };
  };
  const nowMin = minutesOfDay(new Date().toISOString(), tz) - startH * 60;
  const laneList = lanes === 'people'
    ? [{ id: 'none', name: 'Nobody assigned', sub: '', items: items.filter((w) => !w.assignees.length) }, ...(r.data?.people ?? []).map((p) => ({ id: p.id, name: p.name, sub: p.role_name, items: items.filter((w) => w.assignees.some((a) => a.id === p.id)) }))]
    : [{ id: 'none', name: `No ${ws.words.equipment.one.toLowerCase()}`, sub: '', items: items.filter((w) => !w.equipment.length) }, ...(r.data?.equipment ?? []).map((e) => ({ id: e.id, name: e.name, sub: e.status === 'out_of_service' ? 'Out of service' : '', items: items.filter((w) => w.equipment.some((x) => x.id === e.id)) }))];
  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i);
  return (
    <div className="stack">
      <div className="row-between">
        <h2>{fmtDay(`${day}T12:00:00Z`, 'UTC')}</h2>
        <div className="row">
          <Button size="sm" onClick={() => setDay(addDays(day, -1))} icon={<ChevronLeft size={16} aria-hidden="true" />}>Previous day</Button>
          <Button size="sm" onClick={() => setDay(today)}>Today</Button>
          <Button size="sm" onClick={() => setDay(addDays(day, 1))}>Next day<ChevronRight size={16} aria-hidden="true" /></Button>
        </div>
      </div>
      {ws.equipment && <Segmented label="Lanes" value={lanes} onChange={setLanes} options={[{ value: 'people', label: ws.words.person.many }, { value: 'equipment', label: ws.words.equipment.many }]} />}
      {r.isLoading ? <Loading /> : r.error ? <ErrorState error={r.error} retry={() => r.refetch()} /> : (
        <>
          <div className="timeline" role="region" aria-label="Schedule by lane" tabIndex={0}>
            <div className="tl-grid">
              <div className="tl-lane-name" style={{ minHeight: 0, padding: '6px 12px' }}><span className="tiny muted">{lanes === 'people' ? ws.words.person.many : ws.words.equipment.many}</span></div>
              <div className="tl-hours">{hours.map((h) => <span key={h}>{new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2030, 0, 1, h)))}</span>)}</div>
              {laneList.filter((l) => l.id !== 'none' || l.items.length).map((l) => (
                <div key={l.id} style={{ display: 'contents' }} className={l.id === 'none' ? 'tl-unassigned' : ''}>
                  <div className="tl-lane-name"><span className="who">{l.name}</span>{l.sub && <span className="tiny muted">{l.sub}</span>}<span className="tiny muted">{plural(l.items.length, ws.words.work.one.toLowerCase(), ws.words.work.many.toLowerCase())}</span></div>
                  <div className="tl-lane" style={{ ['--hours' as any]: hours.length }}>
                    {day === today && nowMin > 0 && nowMin < span && <span className="tl-now" style={{ left: `${(nowMin / span) * 100}%` }} aria-hidden="true" />}
                    {l.items.map((w) => (
                      <Link key={w.id} to={ws.to(`work/${w.id}`)} className={`tl-block m-${w.stage.meaning}`} style={pos(w)} title={`${fmtTime(w.startsAt, tz)} ${workLabel(w, ws.words.work.one)} (${w.stage.name})`}>
                        <span className="t">{workLabel(w, ws.words.work.one)}</span>
                        <span className="s">{fmtTime(w.startsAt, tz)} · {w.stage.name}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {!items.length && <p className="muted">Nothing scheduled this day.</p>}
          {(r.data?.unscheduled.length ?? 0) > 0 && (
            <section className="stack-sm"><h3>Open, no time yet</h3>
              <div className="card card-flush"><ul className="divider-list">{r.data!.unscheduled.slice(0, 20).map((w) => <li key={w.id}><Link className="list-row" to={ws.to(`work/${w.id}`)}><span className="row-main"><span className="row-title">{workLabel(w, ws.words.work.one)}</span><span className="row-sub">{w.assignees.map((a) => a.name).join(', ') || 'Nobody assigned'}</span></span><StageBadge name={w.stage.name} meaning={w.stage.meaning} /></Link></li>)}</ul></div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- one item

interface Line { id?: string; catalogId: string | null; description: string; quantity: string; unit: string; rateE4?: number | null; amountMinor?: number | null; taxable: boolean; priced?: boolean; /** The price as typed. */ rateText?: string }

export function WorkDetail() {
  const ws = useWorkspace();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const r = useQuery({ queryKey: [ws.cid, 'work', id], queryFn: () => get<{ item: WorkItem; lines: Line[]; history: any[]; invoice?: any; next: { key: string; name: string; meaning: Meaning }[] }>(`/c/${ws.cid}/work/${id}`) });
  const [moving, setMoving] = useState<{ key: string; name: string } | null>(null);
  const [moveFields, setMoveFields] = useState<Record<string, unknown>>({});
  const [assigning, setAssigning] = useState(false);
  const [editingLines, setEditingLines] = useState(false);
  const W = ws.words.work;
  const item = r.data?.item;
  useTitle(item ? `#${item.number} ${workLabel(item, W.one)}` : W.one, ws.workspace.name);
  const refresh = () => qc.invalidateQueries({ queryKey: [ws.cid] });
  const move = useSubmit(async (to: string, fields?: Record<string, unknown>) => {
    const res = await post<any>(`/c/${ws.cid}/work/${id}/move`, { to, version: item!.version, ...(fields ? { fields } : {}) });
    toast(`Moved to ${res.stage.name}.`);
    setMoving(null);
    await refresh();
  });
  const bill = useSubmit(async () => { const res = await post<{ id: string }>(`/c/${ws.cid}/invoices`, { workIds: [id] }); await refresh(); nav(ws.to(`money/invoices/${res.id}`)); });
  if (r.isLoading) return <div className="page"><Loading /></div>;
  if (r.error || !item) return <div className="page"><ErrorState error={r.error} retry={() => r.refetch()} /></div>;
  const tz = ws.workspace.timezone;
  const stage = ws.stage(item.stage.id);
  const next = r.data!.next;
  const forward = next.find((s) => (ws.stage(ws.stages.find((x) => x.key === s.key)!.id)?.position ?? 0) > (stage?.position ?? 0) && s.meaning !== 'cancelled' && s.meaning !== 'failed') ?? null;
  const others = next.filter((s) => s.key !== forward?.key);
  const startMove = (s: { key: string; name: string }) => {
    const target = ws.stages.find((x) => x.key === s.key);
    const missing = (target?.requires ?? []).filter((k) => item.fields[k] === undefined || item.fields[k] === '');
    if (missing.length) { setMoveFields({}); setMoving(s); } else void move.run(s.key);
  };
  const money = ws.can('money.view');
  const total = r.data!.lines.reduce((sum, l) => (sum === null || l.amountMinor === null || l.amountMinor === undefined ? null : sum + l.amountMinor), 0 as number | null);
  return (
    <div className="page">
      <PageHeader back={{ to: ws.to('work'), label: W.many }} eyebrow={<span className="mono">#{item.number}</span>} title={workLabel(item, W.one)}>
        {ws.can('work.edit') && <LinkButton to={ws.to(`work/${id}/edit`)} icon={<Pencil size={18} aria-hidden="true" />}>Edit</LinkButton>}
      </PageHeader>

      <section className="card card-lg stack" aria-label="Stage">
        <div className="row-between">
          <div className="row"><span className="small muted">Stage</span><StageBadge name={item.stage.name} meaning={item.stage.meaning} /></div>
          {item.closedAt && <span className="small muted">Closed {relTime(item.closedAt)}</span>}
        </div>
        <FormError error={move.error} />
        {next.length > 0 && (
          <div className="form-actions">
            {forward && <Button variant="primary" size="lg" busy={move.busy} onClick={() => startMove(forward)} icon={<ArrowRight size={18} aria-hidden="true" />}>Move to {forward.name}</Button>}
            {others.length > 0 && (
              <SelectField label="Or move to" value="" onChange={(e) => { const s = others.find((x) => x.key === e.target.value); if (s) startMove(s); }} className="grow" style={{ minWidth: 200 }}>
                <option value="">Choose a stage…</option>
                {others.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
              </SelectField>
            )}
          </div>
        )}
      </section>

      <div className="grid-2">
        <section className="card stack" aria-labelledby="w-when">
          <h2 id="w-when" className="row"><Clock size={20} aria-hidden="true" />When and where</h2>
          <dl className="details">
            <div><dt>Starts</dt><dd>{item.startsAt ? fmtDateTime(item.startsAt, tz) : 'No time set'}</dd></div>
            {item.endsAt && <div><dt>Ends</dt><dd>{fmtDateTime(item.endsAt, tz)}</dd></div>}
            <div><dt>{ws.words.customer.one}</dt><dd>{item.client ? (ws.can('customers.view') ? <Link to={ws.to(`customers/${item.client.id}`)}>{item.client.name}</Link> : item.client.name) : '—'}</dd></div>
            {item.client?.phone && <div><dt>Phone</dt><dd><a href={`tel:${item.client.phone}`}>{item.client.phone}</a></dd></div>}
            <div style={{ gridColumn: '1 / -1' }}><dt>{ws.words.location.one}</dt><dd>{item.place ? <>{item.place.address} <a href={mapsUrl(item.place.address)} target="_blank" rel="noreferrer" className="small"><Navigation size={14} aria-hidden="true" /> Open in Maps</a>{item.place.notes && <div className="small muted">{item.place.notes}</div>}</> : '—'}</dd></div>
          </dl>
        </section>
        <section className="card stack" aria-labelledby="w-who">
          <div className="row-between"><h2 id="w-who" className="row"><User size={20} aria-hidden="true" />Assigned</h2>{ws.can('work.assign') && <Button size="sm" onClick={() => setAssigning(true)}>Change</Button>}</div>
          <p>{item.assignees.length ? item.assignees.map((a) => a.name).join(', ') : <span className="muted">Nobody yet</span>}</p>
          {ws.equipment && <><h3 className="row small"><Wrench size={16} aria-hidden="true" />{ws.words.equipment.many}</h3><p>{item.equipment.length ? item.equipment.map((e) => e.name).join(', ') : <span className="muted">None</span>}</p></>}
        </section>
      </div>

      {(ws.fields.work.length > 0 || item.notes) && (
        <section className="card stack" aria-labelledby="w-details">
          <h2 id="w-details">Details</h2>
          <FieldValues defs={ws.fields.work} values={item.fields} currency={ws.workspace.currency} />
          {item.notes && <div><div className="small muted" style={{ fontWeight: 600 }}>Notes</div><p style={{ whiteSpace: 'pre-wrap' }}>{item.notes}</p></div>}
        </section>
      )}

      <section className="card stack" aria-labelledby="w-lines">
        <div className="row-between"><h2 id="w-lines" className="row"><FileText size={20} aria-hidden="true" />What it charges for</h2>
          {ws.can('work.edit') && item.billing !== 'invoiced' && <Button size="sm" onClick={() => setEditingLines(true)}>Change</Button>}</div>
        {!r.data!.lines.length ? <p className="muted">Nothing yet. Add what you’ll charge for, from your price list.</p> : (
          <table className="table stackable">
            <thead><tr><th>Item</th><th className="r">Quantity</th>{money && <th className="r">Price</th>}{money && <th className="r">Amount</th>}</tr></thead>
            <tbody>{r.data!.lines.map((l, i) => (
              <tr key={l.id ?? i}>
                <td data-label="Item">{l.description}{l.taxable && <span className="tiny muted"> · taxable</span>}</td>
                <td data-label="Quantity" className="r mono">{l.quantity}{l.unit ? ` ${l.unit}` : ''}</td>
                {money && <td data-label="Price" className="r">{l.rateE4 === null ? <span className="badge badge-attn">No price yet</span> : <span className="money">{formatRate(l.rateE4, ws.workspace.currency)}</span>}</td>}
                {money && <td data-label="Amount" className="r"><Money minor={l.amountMinor} currency={ws.workspace.currency} /></td>}
              </tr>
            ))}</tbody>
          </table>
        )}
        {money && r.data!.lines.length > 0 && <div className="row-between"><span className="muted small">Before tax</span>{total === null ? <span className="badge badge-attn">Held until every price is set</span> : <Money minor={total} currency={ws.workspace.currency} className="money-lg" />}</div>}
        {money && (
          <div className="row">
            {r.data!.invoice ? <LinkButton to={ws.to(`money/invoices/${r.data!.invoice.id}`)} icon={<FileText size={18} aria-hidden="true" />}>{r.data!.invoice.number ? `Invoice ${r.data!.invoice.number}` : 'Open the invoice'}</LinkButton>
              : item.billing === 'ready' && ws.can('invoices.manage') ? <><FormError error={bill.error} /><Button variant="primary" busy={bill.busy} onClick={() => void bill.run()}>Prepare the invoice</Button></>
              : item.billing === 'not_billable' ? <span className="muted small">Marked as not billed.</span> : null}
          </div>
        )}
      </section>

      <section className="card stack" aria-labelledby="w-hist">
        <h2 id="w-hist" className="row"><History size={20} aria-hidden="true" />History</h2>
        <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {r.data!.history.map((h) => <li key={h.id} className="small"><span className="muted">{fmtDateTime(h.created_at, tz)}</span> · <strong>{h.actor}</strong> {historyText(h, W.one)}</li>)}
        </ul>
      </section>

      {moving && (
        <Dialog title={`Move to ${moving.name}`} onClose={() => setMoving(null)} actions={<>
          <Button variant="primary" busy={move.busy} onClick={() => void move.run(moving.key, moveFields)}>Move to {moving.name}</Button>
          <Button variant="ghost" onClick={() => setMoving(null)}>Cancel</Button>
        </>}>
          <p className="muted">{moving.name} needs this first.</p>
          <FormError error={move.error} />
          {(ws.stages.find((x) => x.key === moving.key)?.requires ?? []).map((k) => { const def = ws.fields.work.find((f) => f.key === k); return def ? <FieldInput key={k} def={{ ...def, required: true }} value={moveFields[k] ?? item.fields[k]} onChange={(v) => setMoveFields({ ...moveFields, [k]: v })} error={fieldErrors(move.error)[k]} /> : null; })}
        </Dialog>
      )}
      {assigning && <AssignDialog item={item} onClose={() => setAssigning(false)} onDone={() => { setAssigning(false); void refresh(); }} />}
      {editingLines && <LinesDialog workId={id} lines={r.data!.lines} onClose={() => setEditingLines(false)} onDone={() => { setEditingLines(false); void refresh(); }} />}
    </div>
  );
}

function historyText(h: any, one: string) {
  const d = h.data ?? {};
  switch (h.type) {
    case 'created': return `added it in ${d.stage}.`;
    case 'moved': return `moved it from ${d.from} to ${d.to}.${d.note ? ` “${d.note}”` : ''}`;
    case 'assigned': return 'changed who is assigned.';
    case 'unassigned': return `unassigned someone: ${d.reason ?? ''}`;
    case 'rescheduled': return 'moved it to a new time.';
    case 'edited': return 'edited it.';
    case 'lines': return 'changed what it charges for.';
    case 'equipment': return 'changed the equipment.';
    case 'invoiced': return d.by === 'rigo' ? 'prepared the invoice.' : 'added it to an invoice.';
    case 'invoice_voided': return `voided its invoice: ${d.reason}`;
    case 'not_billable': return 'marked it as not billed.';
    case 'billable': return 'marked it as billable.';
    default: return `updated this ${one.toLowerCase()}.`;
  }
}

function AssignDialog({ item, onClose, onDone }: { item: WorkItem; onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const toast = useToast();
  const [people, setPeople] = useState<string[]>(item.assignees.map((a) => a.id));
  const [equip, setEquip] = useState<string[]>(item.equipment.map((e) => e.id));
  const eq = useQuery({ queryKey: [ws.cid, 'equipment'], queryFn: () => get<{ equipment: any[] }>(`/c/${ws.cid}/equipment`), enabled: ws.equipment });
  const save = useSubmit(async () => {
    await put(`/c/${ws.cid}/work/${item.id}/assignees`, { userIds: people });
    if (ws.equipment) await put(`/c/${ws.cid}/work/${item.id}/equipment`, { equipmentIds: equip });
    toast('Saved. Anyone newly assigned was told.');
    onDone();
  });
  const toggle = (list: string[], set: (l: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <Dialog title="Assign" onClose={onClose} actions={<><Button variant="primary" busy={save.busy} onClick={() => void save.run()}>Save</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></>}>
      <FormError error={save.error} />
      <fieldset><legend>{ws.words.person.many}</legend>
        {[...ws.members].sort((a, b) => (a.app === b.app ? a.name.localeCompare(b.name) : a.app === 'worker' ? -1 : 1)).map((m) => <Check key={m.id} label={m.name} hint={ws.roles.find((r) => r.key === m.role_key)?.name} checked={people.includes(m.id)} onChange={() => toggle(people, setPeople, m.id)} />)}
      </fieldset>
      {ws.equipment && <fieldset><legend>{ws.words.equipment.many}</legend>
        {(eq.data?.equipment ?? []).filter((e) => e.status !== 'retired').map((e) => <Check key={e.id} label={e.name} hint={e.status === 'out_of_service' ? 'Out of service' : undefined} checked={equip.includes(e.id)} onChange={() => toggle(equip, setEquip, e.id)} />)}
        {eq.data && !eq.data.equipment.length && <p className="small muted">No {ws.words.equipment.many.toLowerCase()} yet. Add them in Settings.</p>}
      </fieldset>}
    </Dialog>
  );
}

/** Editing what work charges for: items from the price list, quantities, and prices for those who see money. */
export function LinesEditor({ lines, setLines, errors }: { lines: Line[]; setLines: (l: Line[]) => void; errors?: Record<string, string> }) {
  const ws = useWorkspace();
  const cat = useQuery({ queryKey: [ws.cid, 'catalog'], queryFn: () => get<{ items: any[] }>(`/c/${ws.cid}/catalog`) });
  const money = ws.can('money.view');
  const set = (i: number, patchLine: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patchLine } : l)));
  return (
    <div className="stack">
      {lines.map((l, i) => (
        <div key={i} className="card soft stack-sm">
          <div className="input-group" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
            <TextField label="Item" value={l.description} maxLength={200} onChange={(e) => set(i, { description: e.target.value })} style={{ minWidth: 160 }} />
            <TextField label={`Quantity${l.unit ? ` (${l.unit})` : ''}`} inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value.replace(/[^\d.]/g, '') })} />
            {money && <TextField label="Price" inputMode="decimal" placeholder="No price yet" value={priceText(l)} onChange={(e) => set(i, { rateText: e.target.value.replace(/[^\d.]/g, '') })} />}
            <Button variant="ghost" className="icon-btn" aria-label={`Remove ${l.description || 'line'}`} onClick={() => setLines(lines.filter((_, j) => j !== i))} style={{ flex: '0 0 auto' }}><Trash2 size={18} /></Button>
          </div>
          {money && parseRate(priceText(l)) !== null && /^\d+(\.\d+)?$/.test(l.quantity) && <span className="small muted">Amount <Money minor={lineAmount(l.quantity, parseRate(priceText(l)))} currency={ws.workspace.currency} /></span>}
        </div>
      ))}
      {errors?.lines && <p className="field-error">{errors.lines}</p>}
      <SelectField label="Add from your price list" value="" onChange={(e) => {
        const it = cat.data?.items.find((x) => x.id === e.target.value);
        if (it) setLines([...lines, { catalogId: it.id, description: it.name, quantity: '1', unit: it.unit, rateE4: money ? it.rateE4 : undefined, taxable: it.taxable }]);
        else if (e.target.value === '_custom') setLines([...lines, { catalogId: null, description: '', quantity: '1', unit: '', rateE4: money ? null : undefined, taxable: false }]);
      }}>
        <option value="">Choose…</option>
        {(cat.data?.items ?? []).filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}{!x.priced ? ' (no price yet)' : ''}</option>)}
        <option value="_custom">Something not on the list</option>
      </SelectField>
    </div>
  );
}

const priceText = (l: Line) => l.rateText ?? (l.rateE4 === null || l.rateE4 === undefined ? '' : rateToInput(l.rateE4));
const lineBody = (l: Line, money: boolean) => ({
  catalogId: l.catalogId, description: l.description, quantity: l.quantity || '1', unit: l.unit, taxable: l.taxable,
  ...(money ? { rate: priceText(l) || null } : {}),
});

function LinesDialog({ workId, lines: initial, onClose, onDone }: { workId: string; lines: Line[]; onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const [lines, setLines] = useState<Line[]>(initial.map((l) => ({ ...l })));
  const save = useSubmit(async () => { await put(`/c/${ws.cid}/work/${workId}/lines`, { lines: lines.map((l) => lineBody(l, ws.can('money.view'))) }); onDone(); });
  return (
    <Dialog wide title="What it charges for" onClose={onClose} actions={<><Button variant="primary" busy={save.busy} onClick={() => void save.run()}>Save</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></>}>
      <FormError error={save.error} />
      <LinesEditor lines={lines} setLines={setLines} errors={fieldErrors(save.error)} />
    </Dialog>
  );
}

// ---------------------------------------------------------------- the form

/** datetime-local value (workspace time) to ISO. */
const fromLocal = (v: string, tz: string) => (v ? zonedToUtc(v.slice(0, 10), v.slice(11, 16), tz).toISOString() : null);

export function WorkForm() {
  const ws = useWorkspace();
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const tz = ws.workspace.timezone;
  const W = ws.words.work;
  const existing = useQuery({ queryKey: [ws.cid, 'work', id], queryFn: () => get<any>(`/c/${ws.cid}/work/${id}`), enabled: !!id });
  const customers = useQuery({ queryKey: [ws.cid, 'customers', 'all'], queryFn: () => get<{ customers: any[] }>(`/c/${ws.cid}/customers`), enabled: ws.can('customers.view') });
  const [v, setV] = useState({ title: '', clientId: sp.get('customer') ?? '', placeId: '', stageKey: ws.stages.find((s) => s.meaning === 'open')?.key ?? '', startsAt: '', endsAt: '', notes: '' });
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [assignees, setAssignees] = useState<string[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  useTitle(id ? `Edit ${W.one.toLowerCase()}` : `New ${W.one.toLowerCase()}`, ws.workspace.name);
  useEffect(() => {
    const it = existing.data?.item as WorkItem | undefined;
    if (!it) return;
    setV({ title: it.title, clientId: it.client?.id ?? '', placeId: it.place?.id ?? '', stageKey: it.stage.key, startsAt: toLocalInput(it.startsAt, tz), endsAt: toLocalInput(it.endsAt, tz), notes: it.notes });
    setFields(it.fields);
  }, [existing.data, tz]);
  const places = useQuery({ queryKey: [ws.cid, 'customer', v.clientId], queryFn: () => get<any>(`/c/${ws.cid}/customers/${v.clientId}`), enabled: !!v.clientId && ws.can('customers.view') });
  useEffect(() => { if (!id && places.data?.places?.length === 1 && !v.placeId) setV((x) => ({ ...x, placeId: places.data.places[0].id })); }, [places.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useSubmit(async () => {
    const body: any = { title: v.title, clientId: v.clientId || null, placeId: v.placeId || null, startsAt: fromLocal(v.startsAt, tz), endsAt: fromLocal(v.endsAt, tz), notes: v.notes, fields };
    if (id) {
      await patch(`/c/${ws.cid}/work/${id}`, { ...body, version: existing.data.item.version });
      await qc.invalidateQueries({ queryKey: [ws.cid] });
      nav(ws.to(`work/${id}`));
    } else {
      const r = await post<{ id: string }>(`/c/${ws.cid}/work`, { ...body, stageKey: v.stageKey, assignees, lines: lines.map((l) => lineBody(l, ws.can('money.view'))) });
      await qc.invalidateQueries({ queryKey: [ws.cid] });
      nav(ws.to(`work/${r.id}`));
    }
  });
  const errs = fieldErrors(save.error);
  if (id && existing.isLoading) return <div className="page"><Loading /></div>;
  return (
    <div className="page page-narrow">
      <PageHeader back={{ to: id ? ws.to(`work/${id}`) : ws.to('work'), label: id ? `#${existing.data?.item.number}` : W.many }} title={id ? `Edit ${W.one.toLowerCase()}` : `New ${W.one.toLowerCase()}`} />
      <form className="stack-lg" onSubmit={(e) => { e.preventDefault(); void save.run(); }} noValidate>
        <FormError error={save.error} />
        <section className="card stack">
          <TextField label="What is it?" optional hint={`A few words, like “${ws.words.work.one === 'Appointment' ? 'Haircut' : 'Pump-out'}”.`} value={v.title} maxLength={160} onChange={(e) => setV({ ...v, title: e.target.value })} error={errs.title} />
          {ws.can('customers.view') && (
            <div className="grid-2">
              <SelectField label={ws.words.customer.one} optional value={v.clientId} onChange={(e) => setV({ ...v, clientId: e.target.value, placeId: '' })} error={errs.clientId}>
                <option value="">None</option>
                {(customers.data?.customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </SelectField>
              <SelectField label={ws.words.location.one} optional value={v.placeId} onChange={(e) => setV({ ...v, placeId: e.target.value })} disabled={!v.clientId} error={errs.placeId}>
                <option value="">None</option>
                {(places.data?.places ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.label ? `${p.label}: ` : ''}{p.address}</option>)}
              </SelectField>
            </div>
          )}
          {ws.can('customers.edit') && <p className="small"><Link to={ws.to('customers/new')}>Add a new {ws.words.customer.one.toLowerCase()}</Link> first if they aren’t in the list.</p>}
          <div className="grid-2">
            <TextField label="Starts" optional type="datetime-local" value={v.startsAt} onChange={(e) => setV({ ...v, startsAt: e.target.value })} error={errs.startsAt} />
            <TextField label="Ends" optional type="datetime-local" value={v.endsAt} min={v.startsAt || undefined} onChange={(e) => setV({ ...v, endsAt: e.target.value })} error={errs.endsAt} />
          </div>
          {!id && (
            <SelectField label="Stage" value={v.stageKey} onChange={(e) => setV({ ...v, stageKey: e.target.value })} error={errs.stageKey}>
              {ws.stages.filter((s) => s.meaning === 'open' || s.meaning === 'active').map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </SelectField>
          )}
        </section>
        {!id && ws.can('work.assign') && ws.members.length > 0 && (
          <section className="card stack">
            <h2>Assign</h2>
            <fieldset><legend className="sr-only">{ws.words.person.many}</legend>
              {[...ws.members].sort((a, b) => (a.app === b.app ? a.name.localeCompare(b.name) : a.app === 'worker' ? -1 : 1)).map((m) => (
                <Check key={m.id} label={m.name} hint={ws.roles.find((r) => r.key === m.role_key)?.name} checked={assignees.includes(m.id)} onChange={() => setAssignees(assignees.includes(m.id) ? assignees.filter((x) => x !== m.id) : [...assignees, m.id])} />
              ))}
            </fieldset>
          </section>
        )}
        {ws.fields.work.length > 0 && (
          <section className="card stack">
            <h2>Details</h2>
            {ws.fields.work.map((f) => <FieldInput key={f.key} def={f} value={fields[f.key]} onChange={(x) => setFields({ ...fields, [f.key]: x })} error={errs[f.key]} />)}
          </section>
        )}
        {!id && (
          <section className="card stack"><h2>What it charges for</h2><LinesEditor lines={lines} setLines={setLines} errors={errs} /></section>
        )}
        <section className="card stack"><TextArea label="Notes" optional value={v.notes} maxLength={4000} rows={3} onChange={(e) => setV({ ...v, notes: e.target.value })} /></section>
        <div className="form-actions">
          <Button type="submit" variant="primary" size="lg" busy={save.busy}>{id ? 'Save changes' : `Add ${W.one.toLowerCase()}`}</Button>
          <LinkButton variant="ghost" to={id ? ws.to(`work/${id}`) : ws.to('work')}>Cancel</LinkButton>
        </div>
      </form>
    </div>
  );
}

export { MapPin };
