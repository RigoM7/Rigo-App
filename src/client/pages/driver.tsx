import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { MapPin, Clock, KeyRound, Phone, ChevronRight, ChevronLeft, CloudOff, CloudUpload, CheckCircle2, AlertTriangle, HardDrive, RefreshCw, Camera, Trash2, Play, Send, Copy, Truck, Eraser, Inbox, Pencil, UserRoundCog, Navigation, BellRing, Siren, Plus } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, newId, ApiError, OFFLINE } from '../lib/api';
import { cacheJobs, cachedJobs, getDraft, saveDraft, deleteDraft, listDrafts, syncDraft, syncPending, onDraftsChanged, isUnsent, needsAttention, WAITING_FOR_SIGNAL, type Draft, type DraftState, type JobSnapshot } from '../lib/offline';
import { syncSummaryText } from '../lib/autosync';
import { Button, Card, Field, Textarea, Input, Select, Checkbox, Dialog, Banner, LoadingBlock, Empty, JobStatus, PriorityPill, GuideTarget, useToast, useConfirm } from '../components/ui';
import { fmtTime, fmtDate, relTime, mapsUrl } from '../lib/format';
import { localDate } from '../../shared/schedule';
import { DynamicField } from './jobform';
import { OUTCOMES, REASON_CODES, completionProblems, outcomeReason, type ReasonCode } from '../../shared/jobs';
import { fieldApplies } from '../../shared/services';
import { quantityChecks } from '../../shared/billing';
import { lineProblems, meterQuantity, totalQuantity } from '../../shared/deliveries';
import { useDocumentTitle } from '../lib/title';

interface MyJobs { jobs: any[]; userId: string; companyId: string; fetchedAt: string }

/** Load assignments online, falling back to this user's cached copy for this company. */
function useMyJobs() {
  const c = useCompany();
  const [data, setData] = useState<MyJobs | null>(null);
  const [stale, setStale] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const uid = c.me.actingUserId;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await get<MyJobs>(`/c/${c.cid}/my/jobs`);
      setData(r); setStale(null); setError(null);
      await cacheJobs(uid, c.cid, r);
    } catch (e) {
      const cached = await cachedJobs<MyJobs>(uid, c.cid);
      if (cached && cached.payload.userId === uid && cached.payload.companyId === c.cid) { setData(cached.payload); setStale(cached.cachedAt); }
      setError(e as ApiError);
    } finally { setLoading(false); }
  }, [c.cid, uid]);
  useEffect(() => { load(); const on = () => load(); window.addEventListener('online', on); return () => window.removeEventListener('online', on); }, [load]);
  return { data, stale, error, loading, reload: load, uid };
}

/** The drafts on this phone for this person and company, kept current as background sync changes them. */
function useDrafts(uid: string, cid: string) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const refresh = useCallback(async () => setDrafts(Object.fromEntries((await listDrafts(uid, cid)).map((d) => [d.jobId, d]))), [uid, cid]);
  useEffect(() => { refresh(); return onDraftsChanged(() => { void refresh(); }); }, [refresh]);
  return drafts;
}

const finishedStatus = (s: string) => ['completed', 'partial', 'unsuccessful', 'cancelled'].includes(s);

const SYNC_LABEL: Record<DraftState, [React.ReactNode, string, string]> = {
  local: [<HardDrive key="l" aria-hidden />, 'Saved on this phone', 'var(--text-2)'],
  queued: [<CloudOff key="q" aria-hidden />, 'Waiting for signal — will send automatically', 'var(--info)'],
  pending: [<CloudUpload key="p" aria-hidden />, 'Sending…', 'var(--info)'],
  failed: [<AlertTriangle key="f" aria-hidden />, 'Not sent yet — will try again', 'var(--warning)'],
  accepted: [<CheckCircle2 key="a" aria-hidden />, 'Sent to the office', 'var(--success)'],
  conflict: [<AlertTriangle key="c" aria-hidden />, 'Needs your review', 'var(--danger)'],
  held: [<Inbox key="h" aria-hidden />, 'With the office for review', 'var(--info)'],
};

export function SyncState({ state, message }: { state: DraftState | null; message?: string }) {
  if (!state) return null;
  const [icon, label, color] = SYNC_LABEL[state] ?? SYNC_LABEL.local;
  return <span className="sync-state" style={{ color }} role="status">{icon}{label}{message && state !== 'accepted' && message !== WAITING_FOR_SIGNAL ? <span className="sr-only">: {message}</span> : null}</span>;
}

/** A driver's first visit: three short cards on how a job works, dismissed for good once read (R9-m3). */
function FirstDayGuide({ uid }: { uid: string }) {
  const key = `rigo-driver-guide:${uid}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) !== 'done'; } catch { return false; } });
  if (!open) return null;
  const close = () => { try { localStorage.setItem(key, 'done'); } catch { /* ignore */ } setOpen(false); };
  return (
    <section className="first-day" aria-labelledby="fd-h">
      <div className="row-between"><h2 id="fd-h">How a job works</h2><Button size="sm" variant="ghost" onClick={close}>Got it, hide this</Button></div>
      <ol className="first-day-cards">
        <li><strong>1. Open it and start</strong><span>Tap a job below, check the address and access notes, then tap <b>Start job</b> when you begin.</span></li>
        <li><strong>2. Record what you did</strong><span>Choose how it went, enter quantities, and add photos or a signature if the job asks for them.</span></li>
        <li><strong>3. Submit to the office</strong><span>Tap <b>Submit to office</b>. No signal? It's saved on this phone and sends by itself later.</span></li>
      </ol>
    </section>
  );
}

export function Today() {
  const c = useCompany();
  useDocumentTitle('My jobs');
  const { data, stale, error, loading, reload, uid } = useMyJobs();
  const drafts = useDrafts(uid, c.cid);
  const [syncing, setSyncing] = useState(false);
  const toast = useToast();
  const all = Object.values(drafts);
  const waiting = all.filter((d) => d.state === 'queued' || d.state === 'failed' || d.state === 'pending');
  const attention = all.filter(needsAttention);
  const sendNow = async () => {
    setSyncing(true);
    const s = await syncPending(uid, c.cid).catch(() => null);
    setSyncing(false); reload();
    if (s) toast(syncSummaryText(s) || 'Nothing to send.', s.attention ? 'error' : s.waiting ? 'info' : 'success');
  };
  const today = localDate(new Date(), c.company.timezone);
  const groups = useMemo(() => {
    const jobs = data?.jobs ?? [];
    const active = jobs.filter((j) => ['open', 'in_progress'].includes(j.status));
    const isToday = (j: any) => !j.scheduled_start || localDate(new Date(j.scheduled_start), c.company.timezone) <= today;
    // Emergencies come first, whatever their day (R6-M1, D15).
    const emergency = active.filter((j) => j.priority === 'emergency');
    const rest = active.filter((j) => j.priority !== 'emergency');
    return { emergency, today: rest.filter(isToday), upcoming: rest.filter((j) => !isToday(j)), done: jobs.filter((j) => !['open', 'in_progress'].includes(j.status)) };
  }, [data, today, c.company.timezone]);
  const changed = (data?.jobs ?? []).filter((j) => j.driver_changes?.lines?.length && !j.driver_changes.isNew && ['open', 'in_progress'].includes(j.status));
  const [acking, setAcking] = useState('');
  const ack = async (id: string) => { setAcking(id); try { await post(`/c/${c.cid}/jobs/${id}/seen-changes`); await reload(); } catch { toast('Could not save that. Try again when you have signal.', 'error'); } finally { setAcking(''); } };
  const town = (a: string | null) => (a ?? '').split(',').slice(1).join(',').trim() || (a ?? '');
  const card = (j: any) => (
    <li key={j.id}>
      <Link to={c.to(`today/${j.id}`)} className={`driver-job${j.status === 'in_progress' ? ' is-live' : ''}${j.priority === 'emergency' ? ' is-emergency' : ''}`}>
        <div className="row-between">
          <span className="time">{j.scheduled_start ? fmtTime(j.scheduled_start, c.company.timezone) : 'Any time'}</span>
          <span className="row" style={{ gap: 6 }}><PriorityPill priority={j.priority} /><JobStatus status={j.status} /></span>
        </div>
        {j.priority === 'emergency' && <div className="emergency-tag"><Siren aria-hidden />Emergency</div>}
        <div className="addr">{j.address ?? 'No address'}</div>
        {j.driver_changes?.lines?.length ? <div className="changed-tag">{j.driver_changes.isNew ? 'New' : 'Changed'}</div> : null}
        <div className="small"><span className="num muted">#{j.number}</span> · {j.service_name} · {j.customer_name}</div>
        {(j.access_instructions || j.location_access) && <div className="small muted row" style={{ gap: 6, alignItems: 'flex-start', flexWrap: 'nowrap' }}><KeyRound aria-hidden style={{ width: 16, flex: 'none', marginTop: 3 }} /><span>{j.access_instructions || j.location_access}</span></div>}
        {drafts[j.id] && <div style={{ marginTop: 6 }}><SyncState state={drafts[j.id].state} /></div>}
        {j.nextAction && !['completed', 'partial', 'unsuccessful', 'cancelled'].includes(j.status) && !(drafts[j.id] && ['queued', 'pending', 'held', 'accepted'].includes(drafts[j.id].state)) && <div className="next-action">{j.nextAction}<ChevronRight aria-hidden /></div>}
      </Link>
    </li>
  );
  // Records on this phone for jobs that are no longer on the list (reassigned, cancelled) stay reachable.
  const orphans = all.filter((d) => isUnsent(d) && !(data?.jobs ?? []).some((j) => j.id === d.jobId));
  return (
    <div className="driver-page">
      <div className="row-between"><div><h1>My jobs</h1><div className="muted small">{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: c.company.timezone }).format(new Date())}{data ? ` · ${groups.today.length} today` : ''}</div></div>
        <Button icon={<RefreshCw aria-hidden />} onClick={reload} busy={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Button></div>
      {stale && <Banner tone="warning" title="No signal: showing the copy saved on this phone">Last updated {relTime(stale)}. Jobs may have changed. You can still record outcomes; they send automatically when you have signal.</Banner>}
      {error && !stale && <Banner tone="danger" title="Could not load your jobs">{error.code === OFFLINE ? 'No signal, and this phone has no saved copy of your jobs yet. They load as soon as you have signal.' : error.message}</Banner>}
      {attention.length > 0 && (
        <Banner tone="danger" title={`${attention.length} record${attention.length === 1 ? ' needs' : 's need'} your attention`}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{attention.map((d) => <li key={d.jobId}><Link to={c.to(`today/${d.jobId}`)}>Job #{d.jobNumber}</Link>{d.message ? `: ${d.message}` : ''}</li>)}</ul>
        </Banner>
      )}
      {waiting.length > 0 && <Banner tone="info" title={`${waiting.length} record${waiting.length === 1 ? '' : 's'} waiting to send`} action={<Button size="sm" busy={syncing} onClick={sendNow}>{syncing ? 'Sending…' : 'Send now'}</Button>}>{WAITING_FOR_SIGNAL} Jobs are only completed once the office's system accepts them.</Banner>}
      <FirstDayGuide uid={uid} />
      {changed.length > 0 && (
        <section className="banner banner-warning changes-banner" aria-labelledby="h-changes">
          <BellRing aria-hidden />
          <div className="stack-sm" style={{ flex: 1, minWidth: 0 }}>
            <strong id="h-changes">The office changed {changed.length === 1 ? 'a job' : `${changed.length} jobs`}</strong>
            {changed.map((j) => (
              <div key={j.id} className="change-item">
                <div><Link to={c.to(`today/${j.id}`)}>Job #{j.number}</Link>{j.scheduled_start ? `, ${fmtTime(j.scheduled_start, c.company.timezone)}` : ''}</div>
                <ul>{j.driver_changes.lines.filter((l: string) => l !== 'New job for you').map((l: string) => <li key={l}>{l}</li>)}</ul>
                <Button size="sm" busy={acking === j.id} onClick={() => ack(j.id)}>Got it</Button>
              </div>
            ))}
          </div>
        </section>
      )}
      {loading && !data ? <LoadingBlock /> : data && (
        <>
          {groups.emergency.length > 0 && <section aria-labelledby="h-emergency" className="stack-sm"><h2 id="h-emergency" className="emergency-heading"><Siren aria-hidden />Emergency</h2><ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{groups.emergency.map(card)}</ul></section>}
          {groups.today.length > 1 && (
            <details className="next-stops">
              <summary>Today's stops in order ({groups.today.length})</summary>
              <ol>{groups.today.map((j) => <li key={j.id}><span className="num">{j.scheduled_start ? fmtTime(j.scheduled_start, c.company.timezone) : 'Any time'}</span> {j.customer_name}{town(j.address) ? `, ${town(j.address)}` : ''}</li>)}</ol>
            </details>
          )}
          <section aria-labelledby="h-today" className="stack-sm"><h2 id="h-today">Today</h2>
            {groups.today.length ? <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{groups.today.map(card)}</ul> : <Card><Empty icon={<CheckCircle2 />} title="No jobs for today">New assignments appear here. Tap Refresh to check.</Empty></Card>}
          </section>
          {groups.upcoming.length > 0 && <section aria-labelledby="h-up" className="stack-sm"><h2 id="h-up">Upcoming</h2><ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{groups.upcoming.map(card)}</ul></section>}
          {groups.done.length > 0 && <section aria-labelledby="h-done" className="stack-sm"><h2 id="h-done">Finished recently</h2><ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{groups.done.map(card)}</ul></section>}
          {orphans.length > 0 && <section aria-labelledby="h-orph" className="stack-sm"><h2 id="h-orph">Records for jobs no longer on your list</h2>
            <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{orphans.map((d) => <li key={d.jobId}><Link className="driver-job" to={c.to(`today/${d.jobId}`)}><div className="small"><span className="num muted">#{d.jobNumber}</span></div><div style={{ marginTop: 6 }}><SyncState state={d.state} /></div></Link></li>)}</ul>
          </section>}
        </>
      )}
    </div>
  );
}

async function downscale(file: File, max = 1280): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally { URL.revokeObjectURL(url); }
}

function SignaturePad({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const cv = ref.current!;
    const r = cv.getBoundingClientRect();
    cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio;
    const ctx = cv.getContext('2d')!;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#111111';
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, r.width, r.height);
    if (value) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, r.width, r.height); img.src = value; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  return (
    <div className="stack-sm">
      <canvas ref={ref} className="sig-pad" style={{ background: '#FFFFFF' }} aria-label="Signature area. Draw the signature with a finger or mouse."
        onPointerDown={(e) => { drawing.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); }}
        onPointerUp={() => { drawing.current = false; onChange(ref.current!.toDataURL('image/png')); }} />
      <div><Button size="sm" icon={<Eraser aria-hidden />} onClick={() => { const cv = ref.current!; const ctx = cv.getContext('2d')!; ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, cv.width, cv.height); onChange(null); }}>Clear signature</Button></div>
    </div>
  );
}

/** What the driver sees about a job, kept with a draft so a later conflict can show what changed. */
function snapshot(job: any): JobSnapshot {
  return {
    address: job.address ?? null, scheduled_start: job.scheduled_start ?? null, access: job.access_instructions || job.location_access || null, notes: job.notes || null,
    contact: [job.contact_name || job.site_contact, job.contact_phone || job.site_contact_phone].filter(Boolean).join(' · ') || null, details: job.details ?? {}, resources: (job.resources ?? []).map((r: any) => r.name).join(', '),
  };
}
interface Change { label: string; before: string; after: string }
function changesBetween(a: JobSnapshot, b: JobSnapshot, fields: any[], tz: string): Change[] {
  const when = (v: string | null) => (v ? `${fmtDate(v, tz)}, ${fmtTime(v, tz)}` : 'Any time');
  const out: Change[] = [];
  const add = (label: string, x: unknown, y: unknown) => { const before = x == null || x === '' ? '—' : String(x); const after = y == null || y === '' ? '—' : String(y); if (before !== after) out.push({ label, before, after }); };
  add('Address', a.address, b.address);
  add('Time', when(a.scheduled_start), when(b.scheduled_start));
  add('Access', a.access, b.access);
  add('Contact', a.contact, b.contact);
  add('Notes', a.notes, b.notes);
  add('Trucks', a.resources, b.resources);
  for (const f of fields.filter((x: any) => x.stage !== 'completion')) add(f.label, a.details?.[f.key], b.details?.[f.key]);
  return out;
}

export function DriverJob() {
  const c = useCompany();
  const { jobId = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { ask, node } = useConfirm();
  const { data, stale, loading, reload, uid } = useMyJobs();
  const job = data?.jobs.find((j) => j.id === jobId);
  useDocumentTitle(job ? `Job #${job.number}` : 'Job');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [startErr, setStartErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<'' | 'start' | 'submit' | 'send'>('');
  const [photoError, setPhotoError] = useState('');
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [handover, setHandover] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  // Opening a new job is seeing it: the "New" mark goes (changes stay until "Got it").
  useEffect(() => {
    if (job?.driver_changes?.isNew && job.driver_changes.lines.every((l: string) => l === 'New job for you') && !stale) void post(`/c/${c.cid}/jobs/${job.id}/seen-changes`).catch(() => {});
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [acked, setAcked] = useState(false);
  useEffect(() => {
    const read = async () => setDraft((await getDraft(uid, c.cid, jobId)) ?? null);
    void read();
    return onDraftsChanged(() => { void read(); });
  }, [uid, c.cid, jobId]);

  // Fields dispatch already filled and the driver confirms (like Units) start from the booked value (R8-m2).
  const prefill = () => Object.fromEntries((job?.fields ?? []).filter((f: any) => f.stage === 'both' && job.details?.[f.key] !== undefined && job.details[f.key] !== '').map((f: any) => [f.key, String(job.details[f.key])]));
  const ensureDraft = (): Draft => draft ?? {
    userId: uid, companyId: c.cid, jobId, jobNumber: job.number, baseVersion: job.version, submissionId: newId('sub'), base: snapshot(job),
    outcome: null, values: prefill(), notes: '', reason: '', reasonCode: null, problem: '', photos: [], signature: null, signerName: '', state: 'local', updatedAt: new Date().toISOString(),
  };
  const update = (patch: Partial<Draft>) => {
    const next = { ...ensureDraft(), ...patch, state: (draft?.state === 'accepted' ? 'accepted' : 'local') as DraftState, message: undefined };
    setDraft(next);
    void saveDraft(next);
  };

  if (loading && !data) return <div className="driver-page"><LoadingBlock /></div>;
  if (!job) {
    // The job left this driver's list. A record made for it is still sent: the office reviews it (R9-M2).
    const unsent = draft && isUnsent(draft) && draft.outcome;
    return (
      <div className="driver-page">
        <Link className="back-link" to={c.to('today')}><ChevronLeft aria-hidden />My jobs</Link>
        {draft?.state === 'held'
          ? <Banner tone="info" title={`Your record for job #${draft.jobNumber} is with the office`}>The job was given to someone else or finished before your record arrived. The office reviews it and decides whether it is used.</Banner>
          : <Banner tone="warning" title="This job is not on your list">It may have been given to someone else or cancelled. {unsent ? 'Send your record to the office so they can review it, or discard it.' : ''}</Banner>}
        {draft && unsent && draft.state !== 'held' ? (
          <div className="row">
            <Button variant="primary" icon={<Send aria-hidden />} busy={busy === 'send'} onClick={async () => { setBusy('send'); const r = await syncDraft({ ...draft, state: 'queued' }); setDraft(r); setBusy(''); toast(r.state === 'held' ? 'Sent to the office for review.' : r.state === 'accepted' ? 'Sent to the office.' : r.message ?? 'Not sent yet.', r.state === 'held' || r.state === 'accepted' ? 'success' : 'info'); }}>{busy === 'send' ? 'Sending…' : 'Send to the office'}</Button>
            <Button variant="danger" icon={<Trash2 aria-hidden />} onClick={async () => { if (await ask({ title: 'Discard this record?', body: 'It is deleted from this phone. The office never sees it.', confirm: 'Discard record', danger: true })) { await deleteDraft(uid, c.cid, jobId); nav(c.to('today')); } }}>Discard record</Button>
          </div>
        ) : null}
        {draft && !unsent && draft.state !== 'held' && <div><Button variant="danger" icon={<Trash2 aria-hidden />} onClick={async () => { await deleteDraft(uid, c.cid, jobId); nav(c.to('today')); }}>Discard my draft</Button></div>}
        {node}
      </div>
    );
  }
  const finished = ['completed', 'partial', 'unsuccessful', 'cancelled'].includes(job.status);
  const d = draft ?? ensureDraft();
  const compFields = (job.fields ?? []).filter((f: any) => f.stage !== 'request' && fieldApplies(f, { ...job.details, ...d?.values }));
  // Fuel stops: one line per product or tank (R7-M1); their total is the delivered quantity.
  const dl: { choice: string; quantity: string } | null = job.delivery_lines ?? null;
  const lineMode = !!dl && d.outcome !== 'unsuccessful';
  const qtyField = dl ? (job.fields ?? []).find((f: any) => f.key === dl.quantity) : null;
  const choiceField = dl ? (job.fields ?? []).find((f: any) => f.key === dl.choice) : null;
  const tanks: any[] = job.location_tanks ?? [];
  const blankLine = () => ({ product: String(job.details?.[dl?.choice ?? ''] ?? ''), tank: '', quantity: '', meterStart: '', meterEnd: '', ticket: '' });
  const lines = d.lines?.length ? d.lines : dl ? [blankLine()] : [];
  const setLines = (next: typeof lines) => { const t = totalQuantity(next); update({ lines: next, values: { ...d.values, [dl!.quantity]: t === '0' ? '' : t } }); };
  const access = job.access_instructions || job.location_access;
  const started = job.status === 'in_progress' || !!d.startedOffline;
  // Once submitted, the record is out of the driver's hands until it sends (R13-m3).
  const sentOrSending = ['queued', 'pending', 'failed', 'held', 'accepted'].includes(d.state) && !!draft;
  const today = localDate(new Date(), c.company.timezone);
  const jobDay = job.scheduled_start ? localDate(new Date(job.scheduled_start), c.company.timezone) : null;

  const start = async () => {
    setStartErr(null);
    // Starting a job meant for another day needs a yes (R6-m4).
    if (jobDay && jobDay > today) {
      const tomorrow = localDate(new Date(Date.now() + 86_400_000), c.company.timezone) === jobDay;
      const label = tomorrow ? 'tomorrow' : new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: c.company.timezone }).format(new Date(job.scheduled_start));
      if (!(await ask({ title: `This job is for ${label}. Start anyway?`, body: <p>It is scheduled for {fmtDate(job.scheduled_start, c.company.timezone)}, {fmtTime(job.scheduled_start, c.company.timezone)}. Start it only if the office asked you to do it early.</p>, confirm: 'Start anyway' }))) return;
    }
    setBusy('start');
    try { await post(`/c/${c.cid}/jobs/${jobId}/start`, { version: job.version }); toast('Job started'); await reload(); qc.invalidateQueries({ queryKey: [c.cid] }); }
    catch (e) {
      const err = e as ApiError;
      if (err.code === OFFLINE) {
        // No signal: carry on. The start is sent with the outcome and history marks it as such.
        update({ startedOffline: true });
        toast('No signal. Record the outcome; it is sent with the start when you have signal.', 'info');
      } else setStartErr(err);
    } finally { setBusy(''); }
  };
  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    setPhotoError('');
    const urls = [...d.photos];
    let unreadable = 0;
    for (const f of [...files].slice(0, 4 - urls.length)) {
      try { urls.push(await downscale(f)); } catch { unreadable++; }
    }
    if (unreadable) setPhotoError(unreadable === 1 ? "That photo couldn't be read. Try another or take a new one." : `${unreadable} photos couldn't be read. Try others or take new ones.`);
    update({ photos: urls });
  };
  const typed = d.signatureMode === 'type';
  const hasSignature = typed ? !!d.signatureTyped && !!d.signerName.trim() : !!d.signature;
  // Unusual quantities (more than the truck holds, or 3× the request) need typing a second time.
  const checks = d.outcome === 'completed' ? quantityChecks(compFields, d.values, job.details ?? {}, job.resources ?? []) : [];
  const unconfirmed = checks.filter((q) => (d.confirmQuantities?.[q.field] ?? '').trim().replace(',', '.') !== String(d.values[q.field]));
  const numberError = (f: any) => {
    const raw = d.values[f.key];
    if (f.type !== 'number' || raw === undefined || raw === '') return undefined;
    return /^\d+(\.\d+)?$/.test(String(raw).trim()) ? undefined : `${f.label} must be a number of zero or more, like 250 or 12.5`;
  };
  const photoRequired = !!job.requires_photo && d.outcome === 'completed';
  const submit = async () => {
    const probs: Record<string, string> = {};
    if (!d.outcome) probs.outcome = 'Choose how the job went';
    else Object.assign(probs, completionProblems({ ...d, outcome: d.outcome, photoCount: d.photos.length, hasSignature }, { fields: job.fields ?? [], requires_photo: job.requires_photo, requires_signature: job.requires_signature }, job.details ?? {}));
    if (typed && d.outcome === 'completed' && job.requires_signature && !d.signatureTyped) probs.signature = 'Tick the box to confirm the customer agreed to a typed signature';
    for (const f of compFields) { const e = numberError(f); if (e) probs[f.key] = e; }
    if (lineMode) {
      lines.forEach((l, i) => {
        if (!l.product) probs[`lines.${i}.product`] = `Delivery ${i + 1}: choose the ${(choiceField?.label ?? 'product').toLowerCase()}`;
        for (const [k, v] of Object.entries(lineProblems(l, qtyField?.unit ?? '').errors)) probs[`lines.${i}.${k}`] = `Delivery ${i + 1}: ${v.charAt(0).toLowerCase()}${v.slice(1)}`;
      });
      // The total comes from the lines: point at them rather than at a hidden field.
      if (probs[dl!.quantity] && Object.keys(probs).some((k) => k.startsWith('lines.'))) delete probs[dl!.quantity];
    }
    for (const q of unconfirmed) probs[q.field] ??= `${q.message} Type it again to confirm, or correct it.`;
    if (lineMode && probs[dl!.quantity]) {
      // The quantity field is hidden on fuel stops: link the message to the confirm box or the first line.
      const msg = probs[dl!.quantity]; delete probs[dl!.quantity];
      if (unconfirmed.some((q) => q.field === dl!.quantity)) probs[`confirm-${dl!.quantity}`] = msg; else probs['lines.0.quantity'] ??= msg;
    }
    if (d.collected) {
      if (!/^\d+(\.\d{1,2})?$/.test(d.collected.amount.trim()) || Number(d.collected.amount) <= 0) probs.collectedAmount = 'Enter the amount collected, like 250.00';
      if (d.collected.method === 'check' && !d.collected.reference.trim()) probs.collectedReference = 'Enter the check number';
    }
    setLocalErrors(probs);
    if (Object.keys(probs).length) { setTimeout(() => summaryRef.current?.focus(), 0); return; }
    const isFinal = await ask({ title: d.outcome === 'completed' ? 'Submit as completed?' : `Submit as ${OUTCOMES[d.outcome!].toLowerCase()}?`, body: d.outcome === 'completed' ? 'The office will see this job as completed and billing can start once it is accepted.' : 'The office is told so they can follow up. This visit will not be billed automatically as a successful job.', confirm: 'Submit' });
    if (!isFinal) return;
    setBusy('submit');
    const r = await syncDraft({ ...d, state: 'queued' });
    setDraft(r); setBusy('');
    if (r.state === 'accepted') { toast('Sent. The office has your record.'); reload(); qc.invalidateQueries({ queryKey: [c.cid] }); }
    else if (r.state === 'held') { toast('Sent to the office for review.', 'info'); reload(); }
    else if (r.state === 'queued') toast('Saved on this phone. It sends automatically when you have signal.', 'info');
    else if (r.state === 'local' && r.fields) { setLocalErrors(r.fields); setTimeout(() => summaryRef.current?.focus(), 0); }
  };
  // Back to editing a record that hasn't gone yet; it sends again only when submitted again.
  const edit = async () => { const next = { ...d, state: 'local' as const, message: undefined }; setDraft(next); await saveDraft(next); };
  const reviewConflict = async () => {
    const fresh = (await get<MyJobs>(`/c/${c.cid}/my/jobs`).catch(() => null))?.jobs.find((j) => j.id === jobId);
    await reload();
    if (!fresh) { toast('This job is no longer on your list. Send your record to the office for review.', 'info'); return; }
    if (['completed', 'partial', 'unsuccessful', 'cancelled'].includes(fresh.status)) { toast('This job is already finished. Send your record to the office for review.', 'info'); return; }
    const now = snapshot(fresh);
    setChanges(d.base ? changesBetween(d.base, now, fresh.fields ?? [], c.company.timezone) : []);
    const next = { ...d, baseVersion: fresh.version, base: now, state: 'local' as const, message: 'Check what changed, then submit again.' };
    setDraft(next); await saveDraft(next);
  };
  const errorEntries = Object.entries(localErrors);
  const reasonCode = d.reasonCode ?? null;
  const reasonRequired = d.outcome !== 'completed' && (!reasonCode || reasonCode === 'other');

  return (
    <div className="driver-page">
      <Link className="back-link" to={c.to('today')}><ChevronLeft aria-hidden />My jobs</Link>
      <div className="stack-sm">
        <div className="row-between" style={{ alignItems: 'flex-start' }}><h1 style={{ fontSize: 'var(--fs-22)' }}><span className="num muted" style={{ fontSize: 'var(--fs-16)', display: 'block', fontWeight: 500 }}>#{job.number}</span>{job.service_name}</h1><span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}><PriorityPill priority={job.priority} /><JobStatus status={job.status} /></span></div>
        {stale && <Banner tone="warning">No signal: this is the copy saved on this phone {relTime(stale)}. Details may have changed.</Banner>}
        {!acked && job.driver_changes?.lines?.some((l: string) => l !== 'New job for you') && (
          <Banner tone="warning" title="The office changed this job" action={<Button size="sm" onClick={async () => { setAcked(true); await post(`/c/${c.cid}/jobs/${job.id}/seen-changes`).catch(() => setAcked(false)); }}>Got it</Button>}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{job.driver_changes.lines.filter((l: string) => l !== 'New job for you').map((l: string) => <li key={l}>{l}</li>)}</ul>
          </Banner>
        )}
        {job.priority === 'emergency' && !finishedStatus(job.status) && <Banner tone="danger" title="Emergency">Go as soon as you can. Call the office if you can't.</Banner>}
        {jobDay && jobDay > today && !finished && <Banner tone="info">Scheduled for {fmtDate(job.scheduled_start, c.company.timezone)}, not today.</Banner>}
      </div>
      <Card id="essentials">
        <div className="stack">
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><MapPin aria-hidden style={{ flex: 'none', marginTop: 3 }} /><div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 'var(--fs-18)', letterSpacing: '-0.01em' }}>{job.address ?? 'No address'}</div><div className="muted">{job.customer_name}{job.location_label ? ` · ${job.location_label}` : ''}</div></div>
            {job.address && <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><a className="btn btn-sm" href={mapsUrl(job.address)} target="_blank" rel="noreferrer"><Navigation aria-hidden />Open in Maps</a><Button size="sm" icon={<Copy aria-hidden />} aria-label="Copy address" onClick={() => navigator.clipboard?.writeText(job.address).then(() => toast('Address copied'), () => toast('Could not copy', 'error'))}>Copy</Button></div>}</div>
          <div className="row"><Clock aria-hidden /><span className="num">{job.scheduled_start ? `${fmtDate(job.scheduled_start, c.company.timezone)}, ${fmtTime(job.scheduled_start, c.company.timezone)}` : 'Any time'}</span></div>
          {access && <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><KeyRound aria-hidden style={{ flex: 'none', marginTop: 3 }} /><div><strong>Access:</strong> {access}</div></div>}
          {(job.contact_name || job.site_contact || job.contact_phone || job.site_contact_phone) && <div className="row"><Phone aria-hidden /><span>{job.contact_name || job.site_contact || 'Site contact'}{(job.contact_phone || job.site_contact_phone) ? <> · <a href={`tel:${job.contact_phone || job.site_contact_phone}`}>{job.contact_phone || job.site_contact_phone}</a></> : null}</span></div>}
          {job.site_fields?.length > 0 && <dl className="kv">{job.site_fields.map((f: any) => <div key={f.label} style={{ display: 'contents' }}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>}
          {job.resources?.length ? <div className="row"><Truck aria-hidden /><span>{job.resources.map((r: any) => r.name).join(', ')}</span></div> : null}
          {Object.keys(job.details ?? {}).length > 0 && <dl className="kv">{(job.fields ?? []).filter((f: any) => f.stage !== 'completion' && job.details[f.key]).map((f: any) => <div key={f.key} style={{ display: 'contents' }}><dt>{f.label}</dt><dd>{f.type === 'boolean' ? (job.details[f.key] === true || job.details[f.key] === 'true' ? 'Yes' : 'No') : job.details[f.key]}{f.unit ? ` ${f.unit}` : ''}</dd></div>)}</dl>}
          {job.notes && <p className="pre" style={{ margin: 0 }}><strong>Notes:</strong> {job.notes}</p>}
        </div>
      </Card>

      {finished ? (
        <Banner tone={job.status === 'completed' ? 'success' : 'warning'} title={`Recorded as ${OUTCOMES[job.status as keyof typeof OUTCOMES]?.toLowerCase() ?? job.status}`}>{draft?.state === 'accepted' ? 'Your record was accepted.' : 'This job is finished.'} Contact the office if something needs correcting.</Banner>
      ) : (
        <>
          {startErr && <Banner tone="danger">{startErr.message}</Banner>}
          {d.startedOffline && job.status === 'open' && <Banner tone="info">Started on this phone with no signal. The office sees the start when your record is sent.</Banner>}
          {(draft && (d.state === 'conflict' || d.state === 'failed' || d.message)) || changes ? (
            <Card id="sync">
              <div className="stack-sm">
                <SyncState state={d.state} message={d.message} />
                {d.message && d.message !== WAITING_FOR_SIGNAL && <p style={{ margin: 0 }}>{d.message}</p>}
                {changes && (changes.length ? (
                  <div className="stack-sm">
                    <strong>What the office changed</strong>
                    <dl className="kv change-list">{changes.map((x) => <div key={x.label} style={{ display: 'contents' }}><dt>{x.label}</dt><dd><del>{x.before}</del> <ins>{x.after}</ins></dd></div>)}</dl>
                  </div>
                ) : <p className="small muted" style={{ margin: 0 }}>Nothing you can see on this job changed; the office's edit was elsewhere. You can submit again.</p>)}
                {d.state === 'conflict' && <div className="row"><Button variant="primary" onClick={reviewConflict}>Review what changed</Button><Button variant="danger" icon={<Trash2 aria-hidden />} onClick={async () => { if (await ask({ title: 'Discard this record?', body: 'It is deleted from this phone. The office never sees it.', confirm: 'Discard record', danger: true })) { await deleteDraft(uid, c.cid, jobId); setDraft(null); setChanges(null); } }}>Discard record</Button></div>}
              </div>
            </Card>
          ) : null}
          {sentOrSending ? (
            <Card id="saved">
              <div className="stack-sm">
                <SyncState state={d.state} />
                <p style={{ margin: 0 }}>{d.state === 'held' ? 'The office reviews it and decides whether it is used.' : d.state === 'accepted' ? 'The office has your record.' : 'Saved on this phone. It sends automatically when you have signal; you can close the app.'}</p>
                {(d.state === 'queued' || d.state === 'failed') && <div><Button icon={<Pencil aria-hidden />} onClick={edit}>Edit record</Button></div>}
              </div>
            </Card>
          ) : (
            <section className="card stack" aria-labelledby="checklist-h" data-guide-target="driver-record">
              <h2 id="checklist-h">Record the outcome</h2>
              {errorEntries.length > 0 && (
                <div ref={summaryRef} tabIndex={-1} role="alert" className="banner banner-danger"><AlertTriangle aria-hidden /><div><strong>Check these before submitting</strong><ul style={{ margin: 0, paddingLeft: 18 }}>{errorEntries.map(([k, v]) => <li key={k}><a href={`#f-details-${k}`}>{v}</a></li>)}</ul></div></div>
              )}
              <fieldset id="f-details-outcome"><legend>How did it go?</legend>
                <div className="big-choice">
                  {(Object.keys(OUTCOMES) as (keyof typeof OUTCOMES)[]).map((o) => <label key={o}><input type="radio" name="outcome" checked={d.outcome === o} onChange={() => update({ outcome: o })} />{OUTCOMES[o]}</label>)}
                </div>
                {localErrors.outcome && <div className="field-error"><AlertTriangle aria-hidden />{localErrors.outcome}</div>}
              </fieldset>
              {d.outcome && d.outcome !== 'completed' && (
                <fieldset id="f-details-reasonCode" className="stack-sm"><legend>What happened?</legend>
                  <div className="chip-choice">
                    {(Object.keys(REASON_CODES) as ReasonCode[]).map((k) => <label key={k}><input type="radio" name="reasonCode" checked={reasonCode === k} onChange={() => update({ reasonCode: k })} />{REASON_CODES[k]}</label>)}
                  </div>
                </fieldset>
              )}
              {d.outcome && d.outcome !== 'completed'
                ? <Field label={reasonRequired ? 'Describe what happened' : 'Anything to add'} optionalText={!reasonRequired} id="f-details-reason" error={localErrors.reason} hint={!reasonRequired ? `The office sees "${outcomeReason(reasonCode, d.reason)}".` : undefined}>{(p) => <Textarea {...p} maxLength={2000} value={d.reason} onChange={(e) => update({ reason: e.target.value })} />}</Field>
                : null}
              {lineMode && (
                <fieldset className="stack-sm" id="f-details-lines"><legend>What was delivered</legend>
                  {lines.map((l, i) => {
                    const lp = lineProblems(l, qtyField?.unit ?? '');
                    const meterQ = meterQuantity(l.meterStart, l.meterEnd);
                    const unit = qtyField?.unit ? ` ${qtyField.unit}` : '';
                    const set = (patch: Partial<typeof l>) => setLines(lines.map((x, n) => (n === i ? { ...x, ...patch } : x)));
                    const err = (k: string) => localErrors[`lines.${i}.${k}`];
                    const num = (v: string) => v.replace(',', '.').trim();
                    const tank = tanks.find((t) => t.name === l.tank);
                    return (
                      <div key={i} className="delivery-line stack-sm" role="group" aria-labelledby={`dl-${i}`}>
                        <div className="row-between"><strong id={`dl-${i}`}>Delivery {i + 1}</strong>
                          {lines.length > 1 && <Button size="sm" variant="ghost" icon={<Trash2 aria-hidden />} aria-label={`Remove delivery ${i + 1}`} onClick={() => setLines(lines.filter((_, n) => n !== i))}>Remove</Button>}</div>
                        <div className="grid-2">
                          <Field label={choiceField?.label ?? 'Product'} id={`f-details-lines.${i}.product`} error={err('product')}>{(p) => <Select {...p} value={l.product} onChange={(e) => set({ product: e.target.value })}><option value="">Choose…</option>{(choiceField?.options ?? []).map((o: string) => <option key={o}>{o}</option>)}</Select>}</Field>
                          <Field label="Tank or machine" optionalText id={`f-details-lines.${i}.tank`}>{(p) => tanks.length
                            ? <Select {...p} value={l.tank} onChange={(e) => { const t = tanks.find((x) => x.name === e.target.value); set({ tank: e.target.value, ...(t?.product && choiceField?.options?.includes(t.product) ? { product: t.product } : {}) }); }}><option value="">Not a listed tank</option>{tanks.map((t) => <option key={t.id} value={t.name}>{t.name}{t.size ? ` (${t.size})` : ''}{t.product ? ` · ${t.product}` : ''}</option>)}</Select>
                            : <Input {...p} maxLength={80} placeholder="For example: Generator day tank" value={l.tank} onChange={(e) => set({ tank: e.target.value })} />}</Field>
                        </div>
                        {tank?.notes && <p className="small muted" style={{ margin: 0 }}>{tank.notes}</p>}
                        <div className="grid-3">
                          <Field label="Meter start" optionalText id={`f-details-lines.${i}.meterStart`} error={err('meterStart')}>{(p) => <Input {...p} className="input num-input" inputMode="decimal" value={l.meterStart} onChange={(e) => set({ meterStart: num(e.target.value) })} />}</Field>
                          <Field label="Meter end" optionalText id={`f-details-lines.${i}.meterEnd`} error={err('meterEnd')}>{(p) => <Input {...p} className="input num-input" inputMode="decimal" value={l.meterEnd} onChange={(e) => set({ meterEnd: num(e.target.value) })} />}</Field>
                          <Field label={`Quantity${unit ? ` (${unit.trim()})` : ''}`} id={`f-details-lines.${i}.quantity`} error={err('quantity')} hint={meterQ && !l.quantity ? `From the meter: ${meterQ}${unit}` : undefined}>{(p) => <Input {...p} className="input num-input" inputMode="decimal" placeholder={meterQ ?? ''} value={l.quantity} onChange={(e) => set({ quantity: num(e.target.value) })} />}</Field>
                        </div>
                        <Field label="Ticket number" optionalText id={`f-details-lines.${i}.ticket`}>{(p) => <Input {...p} maxLength={40} autoComplete="off" value={l.ticket} onChange={(e) => set({ ticket: e.target.value })} />}</Field>
                        {lp.warning && <p className="qty-confirm-msg" role="status"><AlertTriangle aria-hidden />{lp.warning} The office checks it before invoicing.</p>}
                      </div>
                    );
                  })}
                  <div><Button icon={<Plus aria-hidden />} onClick={() => setLines([...lines, blankLine()])}>Another tank or product</Button></div>
                  {lines.length > 1 && <p className="small" style={{ margin: 0 }}>Total {totalQuantity(lines)}{qtyField?.unit ? ` ${qtyField.unit}` : ''} at this stop · one delivery fee</p>}
                  {(() => {
                    const check = checks.find((q) => q.field === dl!.quantity);
                    if (!check) return null;
                    return (
                      <div className="qty-confirm" role="group" aria-labelledby="qc-lines">
                        <p id="qc-lines" className="qty-confirm-msg"><AlertTriangle aria-hidden />{check.message}</p>
                        <Field label={`Type ${d.values[dl!.quantity]}${qtyField?.unit ? ` ${qtyField.unit}` : ''} again to confirm`} id={`f-details-confirm-${dl!.quantity}`} hint="The office checks it before the invoice goes out.">
                          {(p) => <Input {...p} className="input num-input" inputMode="decimal" autoComplete="off" value={d.confirmQuantities?.[dl!.quantity] ?? ''} onChange={(e) => update({ confirmQuantities: { ...d.confirmQuantities, [dl!.quantity]: e.target.value.replace(',', '.') } })} />}
                        </Field>
                      </div>
                    );
                  })()}
                </fieldset>
              )}
              {compFields.filter((f: any) => !(lineMode && f.key === dl?.quantity)).map((f: any) => {
                const check = checks.find((q) => q.field === f.key);
                const fieldError = numberError(f) ?? localErrors[f.key];
                return (
                  <div key={f.key} className="stack-sm">
                    <DynamicField f={{ ...f, required: f.required && d.outcome === 'completed' }} value={d.values[f.key]} error={fieldError} onChange={(x) => update({ values: { ...d.values, [f.key]: x } })} />
                    {check && !numberError(f) && (
                      <div className="qty-confirm" role="group" aria-labelledby={`qc-${f.key}`}>
                        <p id={`qc-${f.key}`} className="qty-confirm-msg"><AlertTriangle aria-hidden />{check.message}</p>
                        <Field label={`Type ${d.values[f.key]}${f.unit ? ` ${f.unit}` : ''} again to confirm`} id={`f-details-confirm-${f.key}`} hint="The office checks it before the invoice goes out.">
                          {(p) => <Input {...p} className="input num-input" inputMode="decimal" autoComplete="off" value={d.confirmQuantities?.[f.key] ?? ''} onChange={(e) => update({ confirmQuantities: { ...d.confirmQuantities, [f.key]: e.target.value.replace(',', '.') } })} />}
                        </Field>
                        {!unconfirmed.some((q) => q.field === f.key) && <p className="small" style={{ margin: 0 }}><CheckCircle2 aria-hidden className="qty-ok" /> Confirmed</p>}
                      </div>
                    )}
                  </div>
                );
              })}
              {/* One notes field: "What happened?" replaces it when the job wasn't completed (R6-m5). */}
              {d.outcome !== 'partial' && d.outcome !== 'unsuccessful' && <Field label="Notes" optionalText id="f-details-notes">{(p) => <Textarea {...p} maxLength={4000} value={d.notes} onChange={(e) => update({ notes: e.target.value })} />}</Field>}
              <div className="field" id="f-details-photos">
                <span className="label">Photos <span className="muted" style={{ fontWeight: 400 }}>{photoRequired ? '(at least 1 required)' : '(optional)'}</span></span>
                {d.photos.length > 0 && <div className="photo-grid">{d.photos.map((p, i) => <figure key={i}><img src={p} alt={`Photo ${i + 1}`} /><Button size="sm" variant="ghost" aria-label={`Remove photo ${i + 1}`} onClick={() => update({ photos: d.photos.filter((_, x) => x !== i) })}><Trash2 aria-hidden /></Button></figure>)}</div>}
                {d.photos.length < 4 && <label className="btn" style={{ alignSelf: 'flex-start' }}><Camera aria-hidden />Add photo<input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => { void addPhotos(e.target.files); e.target.value = ''; }} /></label>}
                {(photoError || localErrors.photos) && <div className="field-error" role="alert"><AlertTriangle aria-hidden />{photoError || localErrors.photos}</div>}
              </div>
              {job.requires_signature && (
                <fieldset className="stack-sm" id="f-details-signature">
                  <legend>Customer signature{d.outcome && d.outcome !== 'completed' ? <span className="muted" style={{ fontWeight: 400 }}> (optional)</span> : null}</legend>
                  <div className="segmented" role="radiogroup" aria-label="How the customer signs">
                    <button type="button" role="radio" aria-checked={!typed} onClick={() => update({ signatureMode: 'draw' })}>Draw</button>
                    <button type="button" role="radio" aria-checked={typed} onClick={() => update({ signatureMode: 'type' })}>Type name instead</button>
                  </div>
                  {typed
                    ? <Checkbox label="The customer agreed to sign by typing their name" hint="Recorded as a typed signature." checked={!!d.signatureTyped} onChange={(e) => update({ signatureTyped: e.target.checked })} />
                    : <SignaturePad value={d.signature} onChange={(v) => update({ signature: v })} />}
                  {localErrors.signature && <div className="field-error"><AlertTriangle aria-hidden />{localErrors.signature}</div>}
                  <Field label={typed ? 'Customer name (typed signature)' : 'Name of person signing'} id="f-details-signerName" error={localErrors.signerName}>{(p) => <Input {...p} maxLength={120} autoComplete="off" value={d.signerName} onChange={(e) => update({ signerName: e.target.value })} />}</Field>
                </fieldset>
              )}
              <fieldset className="stack-sm" id="f-details-collected">
                <legend>Payment collected</legend>
                <div className="big-choice">
                  {([['none', 'No payment'], ['check', 'Check'], ['cash', 'Cash'], ['card_terminal', 'Card on the terminal']] as const).map(([k, label]) => (
                    <label key={k}><input type="radio" name="collected" checked={(d.collected?.method ?? 'none') === k} onChange={() => update({ collected: k === 'none' ? null : { method: k, amount: d.collected?.amount ?? '', reference: d.collected?.reference ?? '', photo: d.collected?.photo ?? null } })} />{label}</label>
                  ))}
                </div>
                {d.collected && <>
                  <Field label="Amount collected" id="f-details-collectedAmount" error={localErrors.collectedAmount ?? localErrors['collected.amountMinor']}>{(p) => <Input {...p} className="input num-input" inputMode="decimal" value={d.collected!.amount} onChange={(e) => update({ collected: { ...d.collected!, amount: e.target.value.replace(',', '.') } })} />}</Field>
                  {d.collected.method !== 'cash' && <Field label={d.collected.method === 'check' ? 'Check number' : 'Terminal receipt number'} optionalText={d.collected.method !== 'check'} id="f-details-collectedReference" error={localErrors.collectedReference ?? localErrors['collected.reference']}>{(p) => <Input {...p} maxLength={80} value={d.collected!.reference} onChange={(e) => update({ collected: { ...d.collected!, reference: e.target.value } })} />}</Field>}
                  {d.collected.method === 'check' && (d.collected.photo
                    ? <div className="photo-grid"><figure><img src={d.collected.photo} alt="Photo of the check" /><Button size="sm" variant="ghost" aria-label="Remove the check photo" onClick={() => update({ collected: { ...d.collected!, photo: null } })}><Trash2 aria-hidden /></Button></figure></div>
                    : <label className="btn" style={{ alignSelf: 'flex-start' }}><Camera aria-hidden />Photo of the check <span className="muted" style={{ fontWeight: 400 }}>(optional)</span><input type="file" accept="image/*" capture="environment" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { update({ collected: { ...d.collected!, photo: await downscale(f) } }); setPhotoError(''); } catch { setPhotoError("That photo couldn't be read. Try another or take a new one."); } }} /></label>)}
                  <p className="hint" style={{ margin: 0 }}>The office confirms it. Rigo doesn't charge cards.</p>
                </>}
              </fieldset>
              <Field label="Problem to report" optionalText id="f-details-problem" hint="Dispatch is alerted when you submit.">{(p) => <Textarea {...p} maxLength={2000} value={d.problem} onChange={(e) => update({ problem: e.target.value })} />}</Field>
              {!stale && <div><Button variant="ghost" icon={<UserRoundCog aria-hidden />} onClick={() => setHandover(true)}>Give this job to another driver</Button></div>}
            </section>
          )}
          {!sentOrSending && (
            <div className="sticky-actions stack-sm">
              <div className="row-between"><SyncState state={draft ? d.state : null} /><span className="small muted">{draft ? `Saved ${relTime(d.updatedAt)}` : 'Changes save on this phone as you type'}</span></div>
              {/* One primary action at a time, never hidden under the bar (R9-M1). */}
              {!started
                ? <GuideTarget id="driver-start" block><Button variant="primary" size="lg" block icon={<Play aria-hidden />} busy={busy === 'start'} onClick={start}>{busy === 'start' ? 'Starting…' : 'Start job'}</Button></GuideTarget>
                : <Button variant="primary" size="lg" block icon={<Send aria-hidden />} busy={busy === 'submit'} onClick={submit} disabled={d.state === 'conflict'}>{busy === 'submit' ? 'Sending…' : 'Submit to office'}</Button>}
            </div>
          )}
        </>
      )}
      {handover && <HandoverDialog job={job} draft={draft} onClose={() => setHandover(false)} onDone={() => { setHandover(false); qc.invalidateQueries({ queryKey: [c.cid] }); nav(c.to('today')); }} />}
      {node}
    </div>
  );
}

/** Give the job to another driver, e.g. on a shared phone or at a shift change (R4-M4). */
function HandoverDialog({ job, draft, onClose, onDone }: { job: any; draft: Draft | null; onClose: () => void; onDone: () => void }) {
  const c = useCompany();
  const toast = useToast();
  const [drivers, setDrivers] = useState<{ id: string; name: string }[] | null>(null);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [leave, setLeave] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { get<{ drivers: { id: string; name: string }[] }>(`/c/${c.cid}/jobs/${job.id}/handover`).then((r) => setDrivers(r.drivers), (e) => setError((e as ApiError).message)); }, [c.cid, job.id]);
  const name = drivers?.find((x) => x.id === to)?.name ?? 'them';
  const go = async () => {
    if (!to) { setError('Choose who takes the job'); return; }
    setBusy(true); setError('');
    try {
      const r = await post<{ version: number; to: string }>(`/c/${c.cid}/jobs/${job.id}/handover`, { toUserId: to, version: job.version, note });
      // What was recorded so far stays on this phone for the next driver, under their name.
      if (draft && leave && isUnsent(draft) && draft.state === 'local') {
        await saveDraft({ ...draft, userId: to, baseVersion: r.version, submissionId: newId('sub'), state: 'local', message: 'Recorded by the previous driver on this phone. Check it before you submit.' });
        await deleteDraft(draft.userId, c.cid, job.id);
      }
      toast(`Job #${job.number} is now ${r.to}'s.`);
      onDone();
    } catch (e) { setError((e as ApiError).message); setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title={`Give job #${job.number} to another driver`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={go}>{busy ? 'Handing over…' : 'Hand over'}</Button></>}>
      <div className="stack">
        {!drivers && !error ? <LoadingBlock rows={1} /> : null}
        {drivers && (drivers.length ? (
          <Field label="Who takes it?" id="f-handover-to" error={error && !to ? error : undefined}>{(p) => <Select {...p} value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose a driver</option>{drivers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        ) : <p style={{ margin: 0 }}>There is no other driver to give it to. Ask the office.</p>)}
        <Field label="Note for them" optionalText id="f-handover-note">{(p) => <Textarea {...p} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {draft && isUnsent(draft) && draft.state === 'local' && <Checkbox label={`Leave what I recorded on this phone for ${name}`} hint="Useful on a shared phone. Otherwise it is deleted from this phone." checked={leave} onChange={(e) => setLeave(e.target.checked)} />}
        {error && to ? <Banner tone="danger">{error}</Banner> : null}
        <p className="small muted" style={{ margin: 0 }}>The office is told, and the job's history shows the hand-over.</p>
      </div>
    </Dialog>
  );
}
