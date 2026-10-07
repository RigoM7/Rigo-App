import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { MapPin, Clock, KeyRound, Phone, ChevronRight, ChevronLeft, CloudOff, CloudUpload, CheckCircle2, AlertTriangle, HardDrive, RefreshCw, Camera, Trash2, Play, Send, Copy, Truck, Eraser, Inbox, Pencil, UserRoundCog, Navigation, BellRing, Siren, Plus } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, newId, ApiError, OFFLINE } from '../lib/api';
import { cacheJobs, cachedJobs, getDraft, saveDraft, deleteDraft, listDrafts, syncDraft, syncPending, onDraftsChanged, isUnsent, needsAttention, WAITING_FOR_SIGNAL, type Draft, type DraftState, type JobSnapshot } from '../lib/offline';
import { newerDraft } from '../lib/draft-rev';
import { Button, Card, ErrorSummary, Field, Textarea, Input, Select, Checkbox, Dialog, Banner, LoadingBlock, Empty, JobStatus, PriorityPill, GuideTarget, useToast, useConfirm } from '../components/ui';
import { fmtTime, fmtDate, relTime, mapsUrl } from '../lib/format';
import { localDate } from '../../shared/schedule';
import { DynamicField } from './jobform';
import { OUTCOMES, REASON_CODES, completionProblems, outcomeReason, type ReasonCode } from '../../shared/jobs';
import { fieldApplies } from '../../shared/services';
import { quantityChecks } from '../../shared/billing';
import { lineProblems, meterQuantity, totalQuantity } from '../../shared/deliveries';
import { useDocumentTitle } from '../lib/title';
import { useT } from '../lib/i18n';
import type { MessageKey, T } from '../../shared/i18n';
import { changeText, type ChangeItem } from '../../shared/changes';

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

const SYNC_LABEL: Record<DraftState, [React.ReactNode, MessageKey, string]> = {
  local: [<HardDrive key="l" aria-hidden />, 'sync.local', 'var(--text-2)'],
  queued: [<CloudOff key="q" aria-hidden />, 'sync.queued', 'var(--info)'],
  pending: [<CloudUpload key="p" aria-hidden />, 'sync.pending', 'var(--info)'],
  failed: [<AlertTriangle key="f" aria-hidden />, 'sync.failed', 'var(--warning)'],
  accepted: [<CheckCircle2 key="a" aria-hidden />, 'sync.accepted', 'var(--success)'],
  conflict: [<AlertTriangle key="c" aria-hidden />, 'sync.conflict', 'var(--danger)'],
  held: [<Inbox key="h" aria-hidden />, 'sync.held', 'var(--info)'],
};

export function SyncState({ state, message }: { state: DraftState | null; message?: string }) {
  const t = useT();
  if (!state) return null;
  const [icon, label, color] = SYNC_LABEL[state] ?? SYNC_LABEL.local;
  return <span className="sync-state" style={{ color }} role="status">{icon}{t(label)}{message && state !== 'accepted' && message !== WAITING_FOR_SIGNAL ? <span className="sr-only">: {t.phrase(message)}</span> : null}</span>;
}

/** What the office changed, in the driver's language (older records only have English lines). */
function changeTexts(t: T, dc: { lines?: string[]; items?: ChangeItem[] } | null | undefined, tz: string): string[] {
  if (dc?.items?.length) return dc.items.filter((i) => i.k !== 'notice.newJob').map((i) => changeText(t.lang, tz, i));
  return (dc?.lines ?? []).filter((l) => l !== 'New job for you');
}

/** Summary of an automatic or manual send, in the driver's language. */
export function syncSummary(t: T, s: { sent: number; held: number; attention: number; waiting: number }) {
  return [s.sent && t.plural('sync.sentToOffice', s.sent), s.held && t.plural('sync.wentForReview', s.held), s.attention && t.plural('sync.needAttention', s.attention), s.waiting && t.plural('sync.stillWaiting', s.waiting)].filter(Boolean).join(' ');
}

/** A driver's first visit: three short cards on how a job works, dismissed for good once read (R9-m3). */
function FirstDayGuide({ uid }: { uid: string }) {
  const key = `rigo-driver-guide:${uid}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) !== 'done'; } catch { return false; } });
  const t = useT();
  if (!open) return null;
  const close = () => { try { localStorage.setItem(key, 'done'); } catch { /* ignore */ } setOpen(false); };
  return (
    <section className="first-day" aria-labelledby="fd-h">
      <div className="row-between"><h2 id="fd-h">{t('guide.title')}</h2><Button size="sm" variant="ghost" onClick={close}>{t('guide.hide')}</Button></div>
      <ol className="first-day-cards">
        <li><strong>{t('guide.step1.title')}</strong><span>{t('guide.step1.body')}</span></li>
        <li><strong>{t('guide.step2.title')}</strong><span>{t('guide.step2.body')}</span></li>
        <li><strong>{t('guide.step3.title')}</strong><span>{t('guide.step3.body')}</span></li>
      </ol>
    </section>
  );
}

export function Today() {
  const c = useCompany();
  const t = useT();
  const L = t.locale;
  useDocumentTitle(t('today.title'));
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
    if (s) toast(syncSummary(t, s) || t('sync.nothing'), s.attention ? 'error' : s.waiting ? 'info' : 'success');
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
  const ack = async (id: string) => { setAcking(id); try { await post(`/c/${c.cid}/jobs/${id}/seen-changes`); await reload(); } catch { toast(t('today.ackFailed'), 'error'); } finally { setAcking(''); } };
  const town = (a: string | null) => (a ?? '').split(',').slice(1).join(',').trim() || (a ?? '');
  const card = (j: any) => (
    <li key={j.id}>
      <Link to={c.to(`today/${j.id}`)} className={`driver-job${j.status === 'in_progress' ? ' is-live' : ''}${j.priority === 'emergency' ? ' is-emergency' : ''}`}>
        <div className="row-between">
          <span className="time">{j.scheduled_start ? fmtTime(j.scheduled_start, c.company.timezone, L) : t('today.anyTime')}</span>
          <span className="row" style={{ gap: 6 }}><PriorityPill priority={j.priority} /><JobStatus status={j.status} /></span>
        </div>
        {j.priority === 'emergency' && <div className="emergency-tag"><Siren aria-hidden />{t('today.emergency')}</div>}
        <div className="addr">{j.address ?? t('today.noAddress')}</div>
        {j.driver_changes?.lines?.length ? <div className="changed-tag">{j.driver_changes.isNew ? t('today.new') : t('today.changed')}</div> : null}
        <div className="small"><span className="num muted">#{j.number}</span> · {j.service_name} · {j.customer_name}</div>
        {(j.access_instructions || j.location_access) && <div className="small muted row" style={{ gap: 6, alignItems: 'flex-start', flexWrap: 'nowrap' }}><KeyRound aria-hidden style={{ width: 16, flex: 'none', marginTop: 3 }} /><span>{j.access_instructions || j.location_access}</span></div>}
        {drafts[j.id] && <div style={{ marginTop: 6 }}><SyncState state={drafts[j.id].state} /></div>}
        {j.nextAction && !['completed', 'partial', 'unsuccessful', 'cancelled'].includes(j.status) && !(drafts[j.id] && ['queued', 'pending', 'held', 'accepted'].includes(drafts[j.id].state)) && <div className="next-action">{j.status === 'open' || j.status === 'in_progress' ? t(`today.next.${j.status}` as MessageKey) : j.nextAction}<ChevronRight aria-hidden /></div>}
      </Link>
    </li>
  );
  // Records on this phone for jobs that are no longer on the list (reassigned, cancelled) stay reachable.
  const orphans = all.filter((d) => isUnsent(d) && !(data?.jobs ?? []).some((j) => j.id === d.jobId));
  return (
    <div className="driver-page">
      <div className="row-between"><div><h1>{t('today.title')}</h1><div className="muted small">{new Intl.DateTimeFormat(L, { weekday: 'long', month: 'long', day: 'numeric', timeZone: c.company.timezone }).format(new Date())}{data ? ` · ${t('today.countToday', { n: groups.today.length })}` : ''}</div></div>
        <Button icon={<RefreshCw aria-hidden />} onClick={reload} busy={loading}>{loading ? t('today.refreshing') : t('today.refresh')}</Button></div>
      {stale && <Banner tone="warning" title={t('today.staleTitle')}>{t('today.staleBody', { when: relTime(stale, L) })}</Banner>}
      {error && !stale && <Banner tone="danger" title={t('today.loadFailed')}>{error.code === OFFLINE ? t('today.noSignalNoCopy') : t.phrase(error.message)}</Banner>}
      {attention.length > 0 && (
        <Banner tone="danger" title={t.plural('today.attention', attention.length)}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{attention.map((d) => <li key={d.jobId}><Link to={c.to(`today/${d.jobId}`)}>{t('today.job', { number: d.jobNumber })}</Link>{d.message ? `: ${t.phrase(d.message)}` : ''}</li>)}</ul>
        </Banner>
      )}
      {waiting.length > 0 && <Banner tone="info" title={t.plural('today.waiting', waiting.length)} action={<Button size="sm" busy={syncing} onClick={sendNow}>{syncing ? t('sync.pending') : t('today.sendNow')}</Button>}>{t('sync.waitingForSignal')} {t('today.onlyWhenAccepted')}</Banner>}
      <FirstDayGuide uid={uid} />
      {changed.length > 0 && (
        <section className="banner banner-warning changes-banner" aria-labelledby="h-changes">
          <BellRing aria-hidden />
          <div className="stack-sm" style={{ flex: 1, minWidth: 0 }}>
            <strong id="h-changes">{t.plural('today.changedJobs', changed.length)}</strong>
            {changed.map((j) => (
              <div key={j.id} className="change-item">
                <div><Link to={c.to(`today/${j.id}`)}>{t('today.job', { number: j.number })}</Link>{j.scheduled_start ? `, ${fmtTime(j.scheduled_start, c.company.timezone, L)}` : ''}</div>
                <ul>{changeTexts(t, j.driver_changes, c.company.timezone).map((l: string) => <li key={l}>{l}</li>)}</ul>
                <Button size="sm" busy={acking === j.id} onClick={() => ack(j.id)}>{t('today.gotIt')}</Button>
              </div>
            ))}
          </div>
        </section>
      )}
      {loading && !data ? <LoadingBlock /> : data && (
        <>
          {groups.emergency.length > 0 && <section aria-labelledby="h-emergency" className="stack-sm"><h2 id="h-emergency" className="emergency-heading"><Siren aria-hidden />{t('today.emergency')}</h2><ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{groups.emergency.map(card)}</ul></section>}
          {groups.today.length > 1 && (
            <details className="next-stops">
              <summary>{t('today.stopsInOrder', { n: groups.today.length })}</summary>
              <ol>{groups.today.map((j) => <li key={j.id}><span className="num">{j.scheduled_start ? fmtTime(j.scheduled_start, c.company.timezone, L) : t('today.anyTime')}</span> {j.customer_name}{town(j.address) ? `, ${town(j.address)}` : ''}</li>)}</ol>
            </details>
          )}
          <section aria-labelledby="h-today" className="stack-sm"><h2 id="h-today">{t('today.today')}</h2>
            {groups.today.length ? <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{groups.today.map(card)}</ul> : <Card><Empty icon={<CheckCircle2 />} title={t('today.noneToday')}>{t('today.noneTodayBody')}</Empty></Card>}
          </section>
          {groups.upcoming.length > 0 && <section aria-labelledby="h-up" className="stack-sm"><h2 id="h-up">{t('today.upcoming')}</h2><ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{groups.upcoming.map(card)}</ul></section>}
          {groups.done.length > 0 && <section aria-labelledby="h-done" className="stack-sm"><h2 id="h-done">{t('today.done')}</h2><ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{groups.done.map(card)}</ul></section>}
          {orphans.length > 0 && <section aria-labelledby="h-orph" className="stack-sm"><h2 id="h-orph">{t('today.orphans')}</h2>
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
  const t = useT();
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
      <canvas ref={ref} className="sig-pad" style={{ background: '#FFFFFF' }} aria-label={t('job.signatureArea')}
        onPointerDown={(e) => { drawing.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); }}
        onPointerUp={() => { drawing.current = false; onChange(ref.current!.toDataURL('image/png')); }} />
      <div><Button size="sm" icon={<Eraser aria-hidden />} onClick={() => { const cv = ref.current!; const ctx = cv.getContext('2d')!; ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, cv.width, cv.height); onChange(null); }}>{t('job.clearSignature')}</Button></div>
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
function changesBetween(t: T, a: JobSnapshot, b: JobSnapshot, fields: any[], tz: string): Change[] {
  const when = (v: string | null) => (v ? `${fmtDate(v, tz, t.locale)}, ${fmtTime(v, tz, t.locale)}` : t('today.anyTime'));
  const out: Change[] = [];
  const add = (label: string, x: unknown, y: unknown) => { const before = x == null || x === '' ? '—' : String(x); const after = y == null || y === '' ? '—' : String(y); if (before !== after) out.push({ label, before, after }); };
  add(t('job.change.address'), a.address, b.address);
  add(t('job.change.time'), when(a.scheduled_start), when(b.scheduled_start));
  add(t('job.change.access'), a.access, b.access);
  add(t('job.change.contact'), a.contact, b.contact);
  add(t('job.change.notes'), a.notes, b.notes);
  add(t('job.change.trucks'), a.resources, b.resources);
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
  const t = useT();
  const L = t.locale;
  const job = data?.jobs.find((j) => j.id === jobId);
  useDocumentTitle(job ? t('job.title', { number: job.number }) : t('job.title', { number: '' }).replace(/\s*#?\s*$/, ''));
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
    const read = async () => { const stored = (await getDraft(uid, c.cid, jobId)) ?? null; setDraft((cur) => newerDraft(cur, stored)); };
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
    const base = ensureDraft();
    const next = { ...base, ...patch, rev: (base.rev ?? 0) + 1, state: (draft?.state === 'accepted' ? 'accepted' : 'local') as DraftState, message: undefined };
    setDraft(next);
    void saveDraft(next);
  };

  if (loading && !data) return <div className="driver-page"><LoadingBlock /></div>;
  if (!job) {
    // The job left this driver's list. A record made for it is still sent: the office reviews it (R9-M2).
    const unsent = draft && isUnsent(draft) && draft.outcome;
    return (
      <div className="driver-page">
        <Link className="back-link" to={c.to('today')}><ChevronLeft aria-hidden />{t('job.myJobs')}</Link>
        {draft?.state === 'held'
          ? <Banner tone="info" title={t('job.heldTitle', { number: draft.jobNumber })}>{t('job.heldBody')}</Banner>
          : <Banner tone="warning" title={t('job.notOnListTitle')}>{t('job.notOnListBody')} {unsent ? t('job.sendOrDiscard') : ''}</Banner>}
        {draft && unsent && draft.state !== 'held' ? (
          <div className="row">
            <Button variant="primary" icon={<Send aria-hidden />} busy={busy === 'send'} onClick={async () => { setBusy('send'); const r = await syncDraft({ ...draft, state: 'queued' }); setDraft(r); setBusy(''); toast(r.state === 'held' ? t('job.sentForReview') : r.state === 'accepted' ? t('job.sent') : r.message ? t.phrase(r.message) : t('job.notSentYet'), r.state === 'held' || r.state === 'accepted' ? 'success' : 'info'); }}>{busy === 'send' ? t('job.sending') : t('job.sendToOffice')}</Button>
            <Button variant="danger" icon={<Trash2 aria-hidden />} onClick={async () => { if (await ask({ title: t('job.discardTitle'), body: t('job.discardBody'), confirm: t('job.discard'), danger: true })) { await deleteDraft(uid, c.cid, jobId); nav(c.to('today')); } }}>{t('job.discard')}</Button>
          </div>
        ) : null}
        {draft && !unsent && draft.state !== 'held' && <div><Button variant="danger" icon={<Trash2 aria-hidden />} onClick={async () => { await deleteDraft(uid, c.cid, jobId); nav(c.to('today')); }}>{t('job.discardDraft')}</Button></div>}
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
      const label = tomorrow ? t('job.tomorrow') : new Intl.DateTimeFormat(L, { weekday: 'long', month: 'short', day: 'numeric', timeZone: c.company.timezone }).format(new Date(job.scheduled_start));
      if (!(await ask({ title: t('job.forDayTitle', { day: label }), body: <p>{t('job.forDayBody', { date: fmtDate(job.scheduled_start, c.company.timezone, L), time: fmtTime(job.scheduled_start, c.company.timezone, L) })}</p>, confirm: t('job.startAnyway') }))) return;
    }
    setBusy('start');
    try { await post(`/c/${c.cid}/jobs/${jobId}/start`, { version: job.version }); toast(t('job.started')); await reload(); qc.invalidateQueries({ queryKey: [c.cid] }); }
    catch (e) {
      const err = e as ApiError;
      if (err.code === OFFLINE) {
        // No signal: carry on. The start is sent with the outcome and history marks it as such.
        update({ startedOffline: true });
        toast(t('job.startedNoSignal'), 'info');
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
    if (unreadable) setPhotoError(t.plural('job.photoUnreadable', unreadable));
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
    return /^\d+(\.\d+)?$/.test(String(raw).trim()) ? undefined : t('job.mustBeNumber', { label: f.label });
  };
  const photoRequired = !!job.requires_photo && d.outcome === 'completed';
  const submit = async () => {
    const probs: Record<string, string> = {};
    if (!d.outcome) probs.outcome = t('job.chooseOutcome');
    else for (const [k, v] of Object.entries(completionProblems({ ...d, outcome: d.outcome, photoCount: d.photos.length, hasSignature }, { fields: job.fields ?? [], requires_photo: job.requires_photo, requires_signature: job.requires_signature }, job.details ?? {}))) probs[k] = t.phrase(v);
    if (typed && d.outcome === 'completed' && job.requires_signature && !d.signatureTyped) probs.signature = t('job.tickTyped');
    for (const f of compFields) { const e = numberError(f); if (e) probs[f.key] = e; }
    if (lineMode) {
      lines.forEach((l, i) => {
        if (!l.product) probs[`lines.${i}.product`] = t('job.lineChoose', { n: i + 1, what: (choiceField?.label ?? t('job.product')).toLowerCase() });
        for (const [k, v] of Object.entries(lineProblems(l, qtyField?.unit ?? '').errors)) { const tv = t.phrase(v); probs[`lines.${i}.${k}`] = t('job.linePrefix', { n: i + 1, problem: `${tv.charAt(0).toLowerCase()}${tv.slice(1)}` }); }
      });
      // The total comes from the lines: point at them rather than at a hidden field.
      if (probs[dl!.quantity] && Object.keys(probs).some((k) => k.startsWith('lines.'))) delete probs[dl!.quantity];
    }
    for (const q of unconfirmed) probs[q.field] ??= t('job.typeAgain', { message: t.phrase(q.message) });
    if (lineMode && probs[dl!.quantity]) {
      // The quantity field is hidden on fuel stops: link the message to the confirm box or the first line.
      const msg = probs[dl!.quantity]; delete probs[dl!.quantity];
      if (unconfirmed.some((q) => q.field === dl!.quantity)) probs[`confirm-${dl!.quantity}`] = msg; else probs['lines.0.quantity'] ??= msg;
    }
    if (d.collected) {
      if (!/^\d+(\.\d{1,2})?$/.test(d.collected.amount.trim()) || Number(d.collected.amount) <= 0) probs.collectedAmount = t('job.enterCollected');
      if (d.collected.method === 'check' && !d.collected.reference.trim()) probs.collectedReference = t('job.enterCheckNumber');
    }
    setLocalErrors(probs);
    if (Object.keys(probs).length) { setTimeout(() => summaryRef.current?.focus(), 0); return; }
    const isFinal = await ask({ title: d.outcome === 'completed' ? t('job.submitCompletedTitle') : t('job.submitOtherTitle', { outcome: t(`outcome.${d.outcome}` as MessageKey).toLowerCase() }), body: d.outcome === 'completed' ? t('job.submitCompletedBody') : t('job.submitOtherBody'), confirm: t('job.submit') });
    if (!isFinal) return;
    setBusy('submit');
    const r = await syncDraft({ ...d, state: 'queued' });
    setDraft(r); setBusy('');
    if (r.state === 'accepted') { toast(t('job.acceptedToast')); reload(); qc.invalidateQueries({ queryKey: [c.cid] }); }
    else if (r.state === 'held') { toast(t('job.sentForReview'), 'info'); reload(); }
    else if (r.state === 'queued') toast(t('job.queuedToast'), 'info');
    else if (r.state === 'local' && r.fields) { setLocalErrors(Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, t.phrase(v)]))); setTimeout(() => summaryRef.current?.focus(), 0); }
  };
  // Back to editing a record that hasn't gone yet; it sends again only when submitted again.
  const edit = async () => { const next = { ...d, state: 'local' as const, message: undefined }; setDraft(next); await saveDraft(next); };
  const reviewConflict = async () => {
    const fresh = (await get<MyJobs>(`/c/${c.cid}/my/jobs`).catch(() => null))?.jobs.find((j) => j.id === jobId);
    await reload();
    if (!fresh) { toast(t('job.noLongerOnList'), 'info'); return; }
    if (['completed', 'partial', 'unsuccessful', 'cancelled'].includes(fresh.status)) { toast(t('job.alreadyFinished'), 'info'); return; }
    const now = snapshot(fresh);
    setChanges(d.base ? changesBetween(t, d.base, now, fresh.fields ?? [], c.company.timezone) : []);
    const next = { ...d, baseVersion: fresh.version, base: now, state: 'local' as const, message: 'Check what changed, then submit again.' };
    setDraft(next); await saveDraft(next);
  };
  const errorEntries = Object.entries(localErrors);
  const reasonCode = d.reasonCode ?? null;
  const reasonRequired = d.outcome !== 'completed' && (!reasonCode || reasonCode === 'other');

  return (
    <div className="driver-page">
      <Link className="back-link" to={c.to('today')}><ChevronLeft aria-hidden />{t('job.myJobs')}</Link>
      <div className="stack-sm">
        <div className="row-between" style={{ alignItems: 'flex-start' }}><h1 style={{ fontSize: 'var(--fs-22)' }}><span className="num muted" style={{ fontSize: 'var(--fs-16)', display: 'block', fontWeight: 500 }}>#{job.number}</span>{job.service_name}</h1><span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}><PriorityPill priority={job.priority} /><JobStatus status={job.status} /></span></div>
        {stale && <Banner tone="warning">{t('job.staleBanner', { when: relTime(stale, L) })}</Banner>}
        {!acked && job.driver_changes?.lines?.some((l: string) => l !== 'New job for you') && (
          <Banner tone="warning" title={t('job.changedTitle')} action={<Button size="sm" onClick={async () => { setAcked(true); await post(`/c/${c.cid}/jobs/${job.id}/seen-changes`).catch(() => setAcked(false)); }}>{t('today.gotIt')}</Button>}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{changeTexts(t, job.driver_changes, c.company.timezone).map((l: string) => <li key={l}>{l}</li>)}</ul>
          </Banner>
        )}
        {job.priority === 'emergency' && !finishedStatus(job.status) && <Banner tone="danger" title={t('today.emergency')}>{t('job.emergencyBody')}</Banner>}
        {jobDay && jobDay > today && !finished && <Banner tone="info">{t('job.notToday', { date: fmtDate(job.scheduled_start, c.company.timezone, L) })}</Banner>}
      </div>
      <Card id="essentials">
        <div className="stack">
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}><MapPin aria-hidden style={{ flex: 'none', marginTop: 3 }} /><div style={{ flex: '1 1 180px', minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 'var(--fs-18)', letterSpacing: '-0.01em' }}>{job.address ?? t('today.noAddress')}</div><div className="muted">{job.customer_name}{job.location_label ? ` · ${job.location_label}` : ''}</div></div>
            {job.address && <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><a className="btn btn-sm" href={mapsUrl(job.address)} target="_blank" rel="noreferrer"><Navigation aria-hidden />{t('job.openInMaps')}</a><Button size="sm" icon={<Copy aria-hidden />} aria-label={t('job.copyAddress')} onClick={() => navigator.clipboard?.writeText(job.address).then(() => toast(t('job.addressCopied')), () => toast(t('job.copyFailed'), 'error'))}>{t('job.copy')}</Button></div>}</div>
          <div className="row"><Clock aria-hidden /><span className="num">{job.scheduled_start ? `${fmtDate(job.scheduled_start, c.company.timezone, L)}, ${fmtTime(job.scheduled_start, c.company.timezone, L)}` : t('today.anyTime')}</span></div>
          {access && <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><KeyRound aria-hidden style={{ flex: 'none', marginTop: 3 }} /><div><strong>{t('job.access')}</strong> {access}</div></div>}
          {(job.contact_name || job.site_contact || job.contact_phone || job.site_contact_phone) && <div className="row"><Phone aria-hidden /><span>{job.contact_name || job.site_contact || t('job.siteContact')}{(job.contact_phone || job.site_contact_phone) ? <> · <a href={`tel:${job.contact_phone || job.site_contact_phone}`}>{job.contact_phone || job.site_contact_phone}</a></> : null}</span></div>}
          {job.site_fields?.length > 0 && <dl className="kv">{job.site_fields.map((f: any) => <div key={f.label} style={{ display: 'contents' }}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>}
          {job.resources?.length ? <div className="row"><Truck aria-hidden /><span>{job.resources.map((r: any) => r.name).join(', ')}</span></div> : null}
          {Object.keys(job.details ?? {}).length > 0 && <dl className="kv">{(job.fields ?? []).filter((f: any) => f.stage !== 'completion' && job.details[f.key]).map((f: any) => <div key={f.key} style={{ display: 'contents' }}><dt>{f.label}</dt><dd>{f.type === 'boolean' ? (job.details[f.key] === true || job.details[f.key] === 'true' ? t('ui.yes') : t('ui.no')) : job.details[f.key]}{f.unit ? ` ${f.unit}` : ''}</dd></div>)}</dl>}
          {job.notes && <p className="pre" style={{ margin: 0 }}><strong>{t('job.notes')}</strong> {job.notes}</p>}
        </div>
      </Card>

      {finished ? (
        <Banner tone={job.status === 'completed' ? 'success' : 'warning'} title={t('job.recordedAs', { outcome: job.status in OUTCOMES ? t(`outcome.${job.status}` as MessageKey).toLowerCase() : t(`status.${job.status}` as MessageKey).toLowerCase() })}>{draft?.state === 'accepted' ? t('job.recordAccepted') : t('job.isFinished')} {t('job.contactOffice')}</Banner>
      ) : (
        <>
          {startErr && <Banner tone="danger">{t.phrase(startErr.message)}</Banner>}
          {d.startedOffline && job.status === 'open' && <Banner tone="info">{t('job.startedOffline')}</Banner>}
          {(draft && (d.state === 'conflict' || d.state === 'failed' || d.message)) || changes ? (
            <Card id="sync">
              <div className="stack-sm">
                <SyncState state={d.state} message={d.message} />
                {d.message && d.message !== WAITING_FOR_SIGNAL && <p style={{ margin: 0 }}>{t.phrase(d.message)}</p>}
                {changes && (changes.length ? (
                  <div className="stack-sm">
                    <strong>{t('job.whatChanged')}</strong>
                    <dl className="kv change-list">{changes.map((x) => <div key={x.label} style={{ display: 'contents' }}><dt>{x.label}</dt><dd><del>{x.before}</del> <ins>{x.after}</ins></dd></div>)}</dl>
                  </div>
                ) : <p className="small muted" style={{ margin: 0 }}>{t('job.nothingVisibleChanged')}</p>)}
                {d.state === 'conflict' && <div className="row"><Button variant="primary" onClick={reviewConflict}>{t('job.reviewChanges')}</Button><Button variant="danger" icon={<Trash2 aria-hidden />} onClick={async () => { if (await ask({ title: t('job.discardTitle'), body: t('job.discardBody'), confirm: t('job.discard'), danger: true })) { await deleteDraft(uid, c.cid, jobId); setDraft(null); setChanges(null); } }}>{t('job.discard')}</Button></div>}
              </div>
            </Card>
          ) : null}
          {sentOrSending ? (
            <Card id="saved">
              <div className="stack-sm">
                <SyncState state={d.state} />
                <p style={{ margin: 0 }}>{d.state === 'held' ? t('job.heldNote') : d.state === 'accepted' ? t('job.acceptedNote') : t('job.savedNote')}</p>
                {(d.state === 'queued' || d.state === 'failed') && <div><Button icon={<Pencil aria-hidden />} onClick={edit}>{t('job.editRecord')}</Button></div>}
              </div>
            </Card>
          ) : (
            <section className="card stack" aria-labelledby="checklist-h" data-guide-target="driver-record">
              <h2 id="checklist-h">{t('job.recordOutcome')}</h2>
              {errorEntries.length > 0 && (
                <div ref={summaryRef} tabIndex={-1} role="alert" className="banner banner-danger"><AlertTriangle aria-hidden /><div><strong>{t('job.checkThese')}</strong><ul style={{ margin: 0, paddingLeft: 18 }}>{errorEntries.map(([k, v]) => <li key={k}><a href={`#f-details-${k}`}>{v}</a></li>)}</ul></div></div>
              )}
              <fieldset id="f-details-outcome"><legend>{t('job.howDidItGo')}</legend>
                <div className="big-choice">
                  {(Object.keys(OUTCOMES) as (keyof typeof OUTCOMES)[]).map((o) => <label key={o}><input type="radio" name="outcome" checked={d.outcome === o} onChange={() => update({ outcome: o })} />{t(`outcome.${o}` as MessageKey)}</label>)}
                </div>
                {localErrors.outcome && <div className="field-error"><AlertTriangle aria-hidden />{localErrors.outcome}</div>}
              </fieldset>
              {d.outcome && d.outcome !== 'completed' && (
                <fieldset id="f-details-reasonCode" className="stack-sm"><legend>{t('job.whatHappened')}</legend>
                  <div className="chip-choice">
                    {(Object.keys(REASON_CODES) as ReasonCode[]).map((k) => <label key={k}><input type="radio" name="reasonCode" checked={reasonCode === k} onChange={() => update({ reasonCode: k })} />{t(`reason.${k}` as MessageKey)}</label>)}
                  </div>
                </fieldset>
              )}
              {d.outcome && d.outcome !== 'completed'
                ? <Field label={reasonRequired ? t('job.describe') : t('job.anythingToAdd')} optionalText={!reasonRequired} id="f-details-reason" error={localErrors.reason} hint={!reasonRequired ? t('job.officeSees', { text: reasonCode && !d.reason.trim() ? t(`reason.${reasonCode}` as MessageKey) : outcomeReason(reasonCode, d.reason) }) : undefined}>{(p) => <Textarea {...p} maxLength={2000} value={d.reason} onChange={(e) => update({ reason: e.target.value })} />}</Field>
                : null}
              {lineMode && (
                <fieldset className="stack-sm" id="f-details-lines"><legend>{t('job.whatDelivered')}</legend>
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
                        <div className="row-between"><strong id={`dl-${i}`}>{t('job.delivery', { n: i + 1 })}</strong>
                          {lines.length > 1 && <Button size="sm" variant="ghost" icon={<Trash2 aria-hidden />} aria-label={t('job.removeDelivery', { n: i + 1 })} onClick={() => setLines(lines.filter((_, n) => n !== i))}>{t('job.remove')}</Button>}</div>
                        <div className="grid-2">
                          <Field label={choiceField?.label ?? t('job.product')} id={`f-details-lines.${i}.product`} error={err('product')}>{(p) => <Select {...p} value={l.product} onChange={(e) => set({ product: e.target.value })}><option value="">{t('job.choose')}</option>{(choiceField?.options ?? []).map((o: string) => <option key={o}>{o}</option>)}</Select>}</Field>
                          <Field label={t('job.tank')} optionalText id={`f-details-lines.${i}.tank`}>{(p) => tanks.length
                            ? <Select {...p} value={l.tank} onChange={(e) => { const t = tanks.find((x) => x.name === e.target.value); set({ tank: e.target.value, ...(t?.product && choiceField?.options?.includes(t.product) ? { product: t.product } : {}) }); }}><option value="">{t('job.notListedTank')}</option>{tanks.map((t) => <option key={t.id} value={t.name}>{t.name}{t.size ? ` (${t.size})` : ''}{t.product ? ` · ${t.product}` : ''}</option>)}</Select>
                            : <Input {...p} maxLength={80} placeholder={t('job.tankPlaceholder')} value={l.tank} onChange={(e) => set({ tank: e.target.value })} />}</Field>
                        </div>
                        {tank?.notes && <p className="small muted" style={{ margin: 0 }}>{tank.notes}</p>}
                        <div className="grid-3">
                          <Field label={t('job.meterStart')} optionalText id={`f-details-lines.${i}.meterStart`} error={err('meterStart')}>{(p) => <Input {...p} className="input num-input" inputMode="decimal" value={l.meterStart} onChange={(e) => set({ meterStart: num(e.target.value) })} />}</Field>
                          <Field label={t('job.meterEnd')} optionalText id={`f-details-lines.${i}.meterEnd`} error={err('meterEnd')}>{(p) => <Input {...p} className="input num-input" inputMode="decimal" value={l.meterEnd} onChange={(e) => set({ meterEnd: num(e.target.value) })} />}</Field>
                          <Field label={`${t('job.quantity')}${unit ? ` (${unit.trim()})` : ''}`} id={`f-details-lines.${i}.quantity`} error={err('quantity')} hint={meterQ && !l.quantity ? t('job.fromMeter', { q: `${meterQ}${unit}` }) : undefined}>{(p) => <Input {...p} className="input num-input" inputMode="decimal" placeholder={meterQ ?? ''} value={l.quantity} onChange={(e) => set({ quantity: num(e.target.value) })} />}</Field>
                        </div>
                        <Field label={t('job.ticket')} optionalText id={`f-details-lines.${i}.ticket`}>{(p) => <Input {...p} maxLength={40} autoComplete="off" value={l.ticket} onChange={(e) => set({ ticket: e.target.value })} />}</Field>
                        {lp.warning && <p className="qty-confirm-msg" role="status"><AlertTriangle aria-hidden />{t.phrase(lp.warning)} {t('job.officeChecks')}</p>}
                      </div>
                    );
                  })}
                  <div><Button icon={<Plus aria-hidden />} onClick={() => setLines([...lines, blankLine()])}>{t('job.anotherLine')}</Button></div>
                  {lines.length > 1 && <p className="small" style={{ margin: 0 }}>{t('job.stopTotal', { q: `${totalQuantity(lines)}${qtyField?.unit ? ` ${qtyField.unit}` : ''}` })}</p>}
                  {(() => {
                    const check = checks.find((q) => q.field === dl!.quantity);
                    if (!check) return null;
                    return (
                      <div className="qty-confirm" role="group" aria-labelledby="qc-lines">
                        <p id="qc-lines" className="qty-confirm-msg"><AlertTriangle aria-hidden />{t.phrase(check.message)}</p>
                        <Field label={t('job.typeToConfirm', { value: `${d.values[dl!.quantity]}${qtyField?.unit ? ` ${qtyField.unit}` : ''}` })} id={`f-details-confirm-${dl!.quantity}`} hint={t('job.officeChecksInvoice')}>
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
                        <p id={`qc-${f.key}`} className="qty-confirm-msg"><AlertTriangle aria-hidden />{t.phrase(check.message)}</p>
                        <Field label={t('job.typeToConfirm', { value: `${d.values[f.key]}${f.unit ? ` ${f.unit}` : ''}` })} id={`f-details-confirm-${f.key}`} hint={t('job.officeChecksInvoice')}>
                          {(p) => <Input {...p} className="input num-input" inputMode="decimal" autoComplete="off" value={d.confirmQuantities?.[f.key] ?? ''} onChange={(e) => update({ confirmQuantities: { ...d.confirmQuantities, [f.key]: e.target.value.replace(',', '.') } })} />}
                        </Field>
                        {!unconfirmed.some((q) => q.field === f.key) && <p className="small" style={{ margin: 0 }}><CheckCircle2 aria-hidden className="qty-ok" /> {t('job.confirmed')}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
              {/* One notes field: "What happened?" replaces it when the job wasn't completed (R6-m5). */}
              {d.outcome !== 'partial' && d.outcome !== 'unsuccessful' && <Field label={t('job.notesField')} optionalText id="f-details-notes">{(p) => <Textarea {...p} maxLength={4000} value={d.notes} onChange={(e) => update({ notes: e.target.value })} />}</Field>}
              <div className="field" id="f-details-photos">
                <span className="label">{t('job.photos')} <span className="muted" style={{ fontWeight: 400 }}>{photoRequired ? t('job.photosRequired') : t('ui.optional')}</span></span>
                {d.photos.length > 0 && <div className="photo-grid">{d.photos.map((p, i) => <figure key={i}><img src={p} alt={t('job.photo', { n: i + 1 })} /><Button size="sm" variant="ghost" aria-label={t('job.removePhoto', { n: i + 1 })} onClick={() => update({ photos: d.photos.filter((_, x) => x !== i) })}><Trash2 aria-hidden /></Button></figure>)}</div>}
                {d.photos.length < 4 && <label className="btn" style={{ alignSelf: 'flex-start' }}><Camera aria-hidden />{t('job.addPhoto')}<input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => { void addPhotos(e.target.files); e.target.value = ''; }} /></label>}
                {(photoError || localErrors.photos) && <div className="field-error" role="alert"><AlertTriangle aria-hidden />{photoError || localErrors.photos}</div>}
              </div>
              {job.requires_signature && (
                <fieldset className="stack-sm" id="f-details-signature">
                  <legend>{t('job.signature')}{d.outcome && d.outcome !== 'completed' ? <span className="muted" style={{ fontWeight: 400 }}> {t('ui.optional')}</span> : null}</legend>
                  <div className="segmented" role="radiogroup" aria-label={t('job.howSigns')}>
                    <button type="button" role="radio" aria-checked={!typed} onClick={() => update({ signatureMode: 'draw' })}>{t('job.draw')}</button>
                    <button type="button" role="radio" aria-checked={typed} onClick={() => update({ signatureMode: 'type' })}>{t('job.typeInstead')}</button>
                  </div>
                  {typed
                    ? <Checkbox label={t('job.agreedTyped')} hint={t('job.recordedTyped')} checked={!!d.signatureTyped} onChange={(e) => update({ signatureTyped: e.target.checked })} />
                    : <SignaturePad value={d.signature} onChange={(v) => update({ signature: v })} />}
                  {localErrors.signature && <div className="field-error"><AlertTriangle aria-hidden />{localErrors.signature}</div>}
                  <Field label={typed ? t('job.typedName') : t('job.signerName')} id="f-details-signerName" error={localErrors.signerName}>{(p) => <Input {...p} maxLength={120} autoComplete="off" value={d.signerName} onChange={(e) => update({ signerName: e.target.value })} />}</Field>
                </fieldset>
              )}
              <fieldset className="stack-sm" id="f-details-collected">
                <legend>{t('job.collected')}</legend>
                <div className="big-choice">
                  {([['none', t('job.pay.none')], ['check', t('job.pay.check')], ['cash', t('job.pay.cash')], ['card_terminal', t('job.pay.card_terminal')]] as const).map(([k, label]) => (
                    <label key={k}><input type="radio" name="collected" checked={(d.collected?.method ?? 'none') === k} onChange={() => update({ collected: k === 'none' ? null : { method: k, amount: d.collected?.amount ?? '', reference: d.collected?.reference ?? '', photo: d.collected?.photo ?? null } })} />{label}</label>
                  ))}
                </div>
                {d.collected && <>
                  <Field label={t('job.amountCollected')} id="f-details-collectedAmount" error={localErrors.collectedAmount ?? localErrors['collected.amountMinor']}>{(p) => <Input {...p} className="input num-input" inputMode="decimal" value={d.collected!.amount} onChange={(e) => update({ collected: { ...d.collected!, amount: e.target.value.replace(',', '.') } })} />}</Field>
                  {d.collected.method !== 'cash' && <Field label={d.collected.method === 'check' ? t('job.checkNumber') : t('job.receiptNumber')} optionalText={d.collected.method !== 'check'} id="f-details-collectedReference" error={localErrors.collectedReference ?? localErrors['collected.reference']}>{(p) => <Input {...p} maxLength={80} value={d.collected!.reference} onChange={(e) => update({ collected: { ...d.collected!, reference: e.target.value } })} />}</Field>}
                  {d.collected.method === 'check' && (d.collected.photo
                    ? <div className="photo-grid"><figure><img src={d.collected.photo} alt={t('job.checkPhoto')} /><Button size="sm" variant="ghost" aria-label={t('job.removeCheckPhoto')} onClick={() => update({ collected: { ...d.collected!, photo: null } })}><Trash2 aria-hidden /></Button></figure></div>
                    : <label className="btn" style={{ alignSelf: 'flex-start' }}><Camera aria-hidden />{t('job.checkPhoto')} <span className="muted" style={{ fontWeight: 400 }}>{t('ui.optional')}</span><input type="file" accept="image/*" capture="environment" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { update({ collected: { ...d.collected!, photo: await downscale(f) } }); setPhotoError(''); } catch { setPhotoError(t.plural('job.photoUnreadable', 1)); } }} /></label>)}
                  <p className="hint" style={{ margin: 0 }}>{t('job.officeConfirms')}</p>
                </>}
              </fieldset>
              <Field label={t('job.problem')} optionalText id="f-details-problem" hint={t('job.problemHint')}>{(p) => <Textarea {...p} maxLength={2000} value={d.problem} onChange={(e) => update({ problem: e.target.value })} />}</Field>
              {!stale && <div><Button variant="ghost" icon={<UserRoundCog aria-hidden />} onClick={() => setHandover(true)}>{t('job.handOver')}</Button></div>}
            </section>
          )}
          {!sentOrSending && (
            <div className="sticky-actions stack-sm">
              <div className="row-between"><SyncState state={draft ? d.state : null} /><span className="small muted">{draft ? t('job.savedAgo', { when: relTime(d.updatedAt, L) }) : t('job.savesAsYouType')}</span></div>
              {/* One primary action at a time, never hidden under the bar (R9-M1). */}
              {!started && job.status === 'open' && <OnMyWay job={job} onDone={reload} />}
              {!started
                ? <GuideTarget id="driver-start" block><Button variant="primary" size="lg" block icon={<Play aria-hidden />} busy={busy === 'start'} onClick={start}>{busy === 'start' ? t('job.starting') : t('job.start')}</Button></GuideTarget>
                : <Button variant="primary" size="lg" block icon={<Send aria-hidden />} busy={busy === 'submit'} onClick={submit} disabled={d.state === 'conflict'}>{busy === 'submit' ? t('job.sending') : t('job.submitToOffice')}</Button>}
            </div>
          )}
        </>
      )}
      {handover && <HandoverDialog job={job} draft={draft} onClose={() => setHandover(false)} onDone={() => { setHandover(false); qc.invalidateQueries({ queryKey: [c.cid] }); nav(c.to('today')); }} />}
      {node}
    </div>
  );
}

/** "On my way" (R15-M2): tells the office, and the customer once a text or email service is set up. */
function OnMyWay({ job, onDone }: { job: any; onDone: () => Promise<unknown> | void }) {
  const c = useCompany();
  const t = useT();
  const toast = useToast();
  const [eta, setEta] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      await post(`/c/${c.cid}/jobs/${job.id}/en-route`, { etaMinutes: eta ? Number(eta) : null });
      toast(job.en_route_at ? t('onway.toastUpdate') : t('onway.toastFirst'));
      await onDone();
    } catch (e) { const a = e as ApiError; setErr(a.code === OFFLINE ? new ApiError(0, OFFLINE, t('onway.noSignal')) : a); }
    finally { setBusy(false); }
  };
  return (
    <div className="stack-sm">
      <ErrorSummary error={err} />
      {job.en_route_at ? <p className="small" style={{ margin: 0 }}><Truck aria-hidden style={{ width: 16, verticalAlign: 'middle' }} /> {t('onway.since', { time: fmtTime(job.en_route_at, c.company.timezone, t.locale) })}{job.en_route_eta_minutes ? t('onway.about', { n: job.en_route_eta_minutes }) : ''}.</p> : null}
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }}>
        <Field label={t('onway.arrivingIn')} optionalText id={`eta-${job.id}`}>{(p) => <Select {...p} value={eta} onChange={(e) => setEta(e.target.value)}><option value="">{t('onway.noEstimate')}</option>{[5, 10, 15, 20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{t('onway.minutes', { n: m })}</option>)}</Select>}</Field>
        <Button size="lg" icon={<Truck aria-hidden />} busy={busy} onClick={go}>{job.en_route_at ? t('onway.update') : t('onway.button')}</Button>
      </div>
    </div>
  );
}

/** Give the job to another driver, e.g. on a shared phone or at a shift change (R4-M4). */
function HandoverDialog({ job, draft, onClose, onDone }: { job: any; draft: Draft | null; onClose: () => void; onDone: () => void }) {
  const c = useCompany();
  const t = useT();
  const toast = useToast();
  const [drivers, setDrivers] = useState<{ id: string; name: string }[] | null>(null);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [leave, setLeave] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { get<{ drivers: { id: string; name: string }[] }>(`/c/${c.cid}/jobs/${job.id}/handover`).then((r) => setDrivers(r.drivers), (e) => setError((e as ApiError).message)); }, [c.cid, job.id]);
  const name = drivers?.find((x) => x.id === to)?.name ?? t('handover.them');
  const go = async () => {
    if (!to) { setError(t('handover.choose')); return; }
    setBusy(true); setError('');
    try {
      const r = await post<{ version: number; to: string }>(`/c/${c.cid}/jobs/${job.id}/handover`, { toUserId: to, version: job.version, note });
      // What was recorded so far stays on this phone for the next driver, under their name.
      if (draft && leave && isUnsent(draft) && draft.state === 'local') {
        await saveDraft({ ...draft, userId: to, baseVersion: r.version, submissionId: newId('sub'), state: 'local', message: t('job.previousDriver') });
        await deleteDraft(draft.userId, c.cid, job.id);
      }
      toast(t('handover.done', { number: job.number, name: r.to }));
      onDone();
    } catch (e) { setError((e as ApiError).message); setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title={t('handover.title', { number: job.number })}
      footer={<><Button onClick={onClose}>{t('ui.cancel')}</Button><Button variant="primary" busy={busy} onClick={go}>{busy ? t('handover.going') : t('handover.go')}</Button></>}>
      <div className="stack">
        {!drivers && !error ? <LoadingBlock rows={1} /> : null}
        {drivers && (drivers.length ? (
          <Field label={t('handover.who')} id="f-handover-to" error={error && !to ? error : undefined}>{(p) => <Select {...p} value={to} onChange={(e) => setTo(e.target.value)}><option value="">{t('handover.chooseDriver')}</option>{drivers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        ) : <p style={{ margin: 0 }}>{t('handover.nobody')}</p>)}
        <Field label={t('handover.note')} optionalText id="f-handover-note">{(p) => <Textarea {...p} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {draft && isUnsent(draft) && draft.state === 'local' && <Checkbox label={t('handover.leave', { name })} hint={t('handover.leaveHint')} checked={leave} onChange={(e) => setLeave(e.target.checked)} />}
        {error && to ? <Banner tone="danger">{t.phrase(error)}</Banner> : null}
        <p className="small muted" style={{ margin: 0 }}>{t('handover.officeTold')}</p>
      </div>
    </Dialog>
  );
}
