import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { MapPin, Clock, KeyRound, Phone, ChevronRight, ChevronLeft, CloudOff, CloudUpload, CheckCircle2, AlertTriangle, HardDrive, RefreshCw, Camera, Trash2, Play, Send, Copy, Truck, Eraser } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, newId, ApiError } from '../lib/api';
import { cacheJobs, cachedJobs, getDraft, saveDraft, deleteDraft, listDrafts, syncDraft, type Draft, type DraftState } from '../lib/offline';
import { Button, Card, Field, Textarea, Input, Banner, LoadingBlock, Empty, JobStatus, Pill, ErrorSummary, useToast, useConfirm } from '../components/ui';
import { fmtTime, fmtDate, relTime } from '../lib/format';
import { localDate } from '../../shared/schedule';
import { DynamicField } from './jobform';
import { OUTCOMES, completionProblems } from '../../shared/jobs';
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

export function SyncState({ state, message }: { state: DraftState | null; message?: string }) {
  if (!state) return null;
  const map: Record<DraftState, [React.ReactNode, string, string]> = {
    local: [<HardDrive key="l" aria-hidden />, 'Saved on this device', 'var(--text-2)'],
    pending: [<CloudUpload key="p" aria-hidden />, 'Waiting to sync', 'var(--info)'],
    failed: [<CloudOff key="f" aria-hidden />, 'Sync failed — will retry', 'var(--warning)'],
    accepted: [<CheckCircle2 key="a" aria-hidden />, 'Accepted by the server', 'var(--success)'],
    conflict: [<AlertTriangle key="c" aria-hidden />, 'Conflict — needs review', 'var(--danger)'],
  };
  const [icon, label, color] = map[state];
  return <span className="sync-state" style={{ color }} role="status">{icon}{label}{message && state !== 'accepted' ? <span className="sr-only">: {message}</span> : null}</span>;
}

export function Today() {
  const c = useCompany();
  useDocumentTitle('My jobs');
  const { data, stale, error, loading, reload, uid } = useMyJobs();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [syncing, setSyncing] = useState(false);
  const toast = useToast();
  const refreshDrafts = useCallback(async () => setDrafts(Object.fromEntries((await listDrafts(uid, c.cid)).map((d) => [d.jobId, d]))), [uid, c.cid]);
  useEffect(() => { refreshDrafts(); }, [refreshDrafts, data]);
  const unsynced = Object.values(drafts).filter((d) => d.state === 'failed' || d.state === 'pending');
  const syncAll = async () => {
    setSyncing(true);
    for (const d of unsynced) await syncDraft(d);
    setSyncing(false); await refreshDrafts(); reload();
    toast('Sync finished. Check each job for its status.', 'info');
  };
  const today = localDate(new Date(), c.company.timezone);
  const groups = useMemo(() => {
    const jobs = data?.jobs ?? [];
    const active = jobs.filter((j) => ['open', 'in_progress'].includes(j.status));
    const isToday = (j: any) => !j.scheduled_start || localDate(new Date(j.scheduled_start), c.company.timezone) <= today;
    return { today: active.filter(isToday), upcoming: active.filter((j) => !isToday(j)), done: jobs.filter((j) => !['open', 'in_progress'].includes(j.status)) };
  }, [data, today, c.company.timezone]);
  const card = (j: any) => (
    <li key={j.id}>
      <Link to={c.to(`today/${j.id}`)} className={`driver-job${j.status === 'in_progress' ? ' is-live' : ''}`}>
        <div className="row-between">
          <span className="time">{j.scheduled_start ? fmtTime(j.scheduled_start, c.company.timezone) : 'Any time'}</span>
          <JobStatus status={j.status} />
        </div>
        <div className="addr">{j.address ?? 'No address'}</div>
        <div className="small"><span className="num muted">#{j.number}</span> · {j.service_name} · {j.customer_name}</div>
        {(j.access_instructions || j.location_access) && <div className="small muted row" style={{ gap: 6, alignItems: 'flex-start', flexWrap: 'nowrap' }}><KeyRound aria-hidden style={{ width: 16, flex: 'none', marginTop: 3 }} /><span>{j.access_instructions || j.location_access}</span></div>}
        {drafts[j.id] && <div style={{ marginTop: 6 }}><SyncState state={drafts[j.id].state} /></div>}
        {j.nextAction && !['completed', 'partial', 'unsuccessful', 'cancelled'].includes(j.status) && <div className="next-action">{j.nextAction}<ChevronRight aria-hidden /></div>}
      </Link>
    </li>
  );
  return (
    <div className="driver-page">
      <div className="row-between"><div><h1>My jobs</h1><div className="muted small">{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: c.company.timezone }).format(new Date())}{data ? ` · ${groups.today.length} today` : ''}</div></div>
        <Button icon={<RefreshCw aria-hidden />} onClick={reload} busy={loading}>Refresh</Button></div>
      {stale && <Banner tone="warning" title="Offline: showing your saved copy">Last updated {relTime(stale)}. Jobs may have changed. You can still save drafts; they sync when you reconnect.</Banner>}
      {error && !stale && <Banner tone="danger" title="Could not load your jobs">{error.message}</Banner>}
      {unsynced.length > 0 && <Banner tone="info" title={`${unsynced.length} draft(s) waiting to sync`} action={<Button size="sm" variant="primary" busy={syncing} onClick={syncAll}>Sync now</Button>}>They are saved on this device. Jobs are only completed once the server accepts them.</Banner>}
      {loading && !data ? <LoadingBlock /> : data && (
        <>
          <section aria-labelledby="h-today" className="stack-sm"><h2 id="h-today">Today</h2>
            {groups.today.length ? <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{groups.today.map(card)}</ul> : <Card><Empty icon={<CheckCircle2 />} title="No jobs for today">New assignments appear here. Pull to refresh or tap Refresh.</Empty></Card>}
          </section>
          {groups.upcoming.length > 0 && <section aria-labelledby="h-up" className="stack-sm"><h2 id="h-up">Upcoming</h2><ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{groups.upcoming.map(card)}</ul></section>}
          {groups.done.length > 0 && <section aria-labelledby="h-done" className="stack-sm"><h2 id="h-done">Finished recently</h2><ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{groups.done.map(card)}</ul></section>}
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
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => { (async () => { if (job) setDraft((await getDraft(uid, c.cid, jobId)) ?? null); })(); }, [job?.id, uid, c.cid, jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ensureDraft = (): Draft => draft ?? {
    userId: uid, companyId: c.cid, jobId, jobNumber: job.number, baseVersion: job.version, submissionId: newId('sub'),
    outcome: 'completed', values: {}, notes: '', reason: '', problem: '', photos: [], signature: null, signerName: '', state: 'local', updatedAt: new Date().toISOString(),
  };
  const update = (patch: Partial<Draft>) => {
    const next = { ...ensureDraft(), ...patch, state: (draft?.state === 'accepted' ? 'accepted' : 'local') as DraftState, message: undefined };
    setDraft(next);
    saveDraft(next);
  };

  if (loading && !data) return <div className="driver-page"><LoadingBlock /></div>;
  if (!job) {
    return (
      <div className="driver-page">
        <Link className="back-link" to={c.to('today')}><ChevronLeft aria-hidden />My jobs</Link>
        <Banner tone="warning" title="This job is not on your list">It may have been reassigned or cancelled. {draft ? 'Your saved draft is kept on this device for review.' : ''}</Banner>
        {draft && draft.state !== 'accepted' && <Button variant="danger" icon={<Trash2 aria-hidden />} onClick={async () => { await deleteDraft(uid, c.cid, jobId); nav(c.to('today')); }}>Discard my draft</Button>}
      </div>
    );
  }
  const finished = ['completed', 'partial', 'unsuccessful', 'cancelled'].includes(job.status);
  const compFields = (job.fields ?? []).filter((f: any) => f.stage !== 'request');
  const d = draft ?? ensureDraft();
  const access = job.access_instructions || job.location_access;

  const start = async () => {
    setStartErr(null);
    try { await post(`/c/${c.cid}/jobs/${jobId}/start`, { version: job.version }); toast('Job started'); await reload(); qc.invalidateQueries({ queryKey: [c.cid] }); }
    catch (e) { setStartErr(e as ApiError); }
  };
  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const urls = [...d.photos];
    for (const f of [...files].slice(0, 4 - urls.length)) urls.push(await downscale(f));
    update({ photos: urls });
  };
  const submit = async () => {
    const probs = completionProblems({ ...d, photoCount: d.photos.length, hasSignature: !!d.signature }, { fields: job.fields ?? [], requires_photo: job.requires_photo, requires_signature: job.requires_signature });
    setLocalErrors(probs);
    if (Object.keys(probs).length) { setTimeout(() => summaryRef.current?.focus(), 0); return; }
    const isFinal = await ask({ title: d.outcome === 'completed' ? 'Submit as completed?' : `Submit as ${OUTCOMES[d.outcome].toLowerCase()}?`, body: d.outcome === 'completed' ? 'The office will see this job as completed and billing can start once the server accepts it.' : 'The office is told so they can follow up. This visit will not be billed automatically as a successful job.', confirm: 'Submit' });
    if (!isFinal) return;
    setBusy(true);
    const r = await syncDraft({ ...d, state: 'pending' });
    setDraft(r); setBusy(false);
    if (r.state === 'accepted') { toast('Accepted. The office has your record.'); reload(); qc.invalidateQueries({ queryKey: [c.cid] }); }
    else if (r.state === 'local' && r.fields) { setLocalErrors(r.fields); setTimeout(() => summaryRef.current?.focus(), 0); }
  };
  const reviewConflict = async () => {
    await reload();
    const fresh = (await get<MyJobs>(`/c/${c.cid}/my/jobs`).catch(() => null))?.jobs.find((j) => j.id === jobId);
    if (fresh && !['completed', 'partial', 'unsuccessful', 'cancelled'].includes(fresh.status)) {
      const next = { ...d, baseVersion: fresh.version, state: 'local' as const, message: 'Updated to the latest job details. Check them, then submit again.' };
      setDraft(next); await saveDraft(next);
    }
  };
  const errorEntries = Object.entries(localErrors);

  return (
    <div className="driver-page">
      <Link className="back-link" to={c.to('today')}><ChevronLeft aria-hidden />My jobs</Link>
      <div className="stack-sm">
        <div className="row-between" style={{ alignItems: 'flex-start' }}><h1 style={{ fontSize: 'var(--fs-22)' }}><span className="num muted" style={{ fontSize: 'var(--fs-16)', display: 'block', fontWeight: 500 }}>#{job.number}</span>{job.service_name}</h1><JobStatus status={job.status} /></div>
        {stale && <Banner tone="warning">Offline copy from {relTime(stale)}. Details may have changed.</Banner>}
      </div>
      <Card id="essentials">
        <div className="stack">
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><MapPin aria-hidden style={{ flex: 'none', marginTop: 3 }} /><div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 'var(--fs-18)', letterSpacing: '-0.01em' }}>{job.address ?? 'No address'}</div><div className="muted">{job.customer_name}{job.location_label ? ` · ${job.location_label}` : ''}</div></div>
            {job.address && <Button size="sm" icon={<Copy aria-hidden />} onClick={() => navigator.clipboard?.writeText(job.address).then(() => toast('Address copied'), () => toast('Could not copy', 'error'))}>Copy</Button>}</div>
          <div className="row"><Clock aria-hidden /><span className="num">{job.scheduled_start ? `${fmtDate(job.scheduled_start, c.company.timezone)}, ${fmtTime(job.scheduled_start, c.company.timezone)}` : 'Any time'}</span></div>
          {access && <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><KeyRound aria-hidden style={{ flex: 'none', marginTop: 3 }} /><div><strong>Access:</strong> {access}</div></div>}
          {(job.contact_name || job.site_contact || job.contact_phone) && <div className="row"><Phone aria-hidden /><span>{job.contact_name || job.site_contact}{job.contact_phone ? <> · <a href={`tel:${job.contact_phone}`}>{job.contact_phone}</a></> : null}</span></div>}
          {job.resources?.length ? <div className="row"><Truck aria-hidden /><span>{job.resources.map((r: any) => r.name).join(', ')}</span></div> : null}
          {Object.keys(job.details ?? {}).length > 0 && <dl className="kv">{(job.fields ?? []).filter((f: any) => f.stage !== 'completion' && job.details[f.key]).map((f: any) => <div key={f.key} style={{ display: 'contents' }}><dt>{f.label}</dt><dd>{job.details[f.key]}{f.unit ? ` ${f.unit}` : ''}</dd></div>)}</dl>}
          {job.notes && <p className="pre" style={{ margin: 0 }}><strong>Notes:</strong> {job.notes}</p>}
        </div>
      </Card>

      {finished ? (
        <Banner tone={job.status === 'completed' ? 'success' : 'warning'} title={`Recorded as ${OUTCOMES[job.status as keyof typeof OUTCOMES]?.toLowerCase() ?? job.status}`}>{draft?.state === 'accepted' ? 'Accepted by the server.' : 'This job is finished.'} Contact the office if something needs correcting.</Banner>
      ) : (
        <>
          {job.status === 'open' && (
            <div className="stack-sm">
              <Button variant="primary" size="lg" block icon={<Play aria-hidden />} onClick={start}>Start job</Button>
              {startErr && <Banner tone={startErr.code === 'offline' ? 'warning' : 'danger'}>{startErr.code === 'offline' ? 'Starting needs a connection. You can still record the outcome below; it syncs later.' : startErr.message}</Banner>}
            </div>
          )}
          {draft && draft.state !== 'local' || draft?.message ? (
            <Card id="sync">
              <div className="stack-sm">
                <SyncState state={d.state} message={d.message} />
                {d.message && <p style={{ margin: 0 }}>{d.message}</p>}
                {d.state === 'failed' && <div><Button variant="primary" busy={busy} onClick={async () => { setBusy(true); setDraft(await syncDraft(d)); setBusy(false); reload(); }}>Try sync again</Button></div>}
                {d.state === 'conflict' && <div className="row"><Button variant="primary" onClick={reviewConflict}>Review latest details</Button><Button variant="danger" icon={<Trash2 aria-hidden />} onClick={async () => { await deleteDraft(uid, c.cid, jobId); setDraft(null); }}>Discard my draft</Button></div>}
              </div>
            </Card>
          ) : null}
          <section className="card stack" aria-labelledby="checklist-h">
            <h2 id="checklist-h">Record the outcome</h2>
            {errorEntries.length > 0 && (
              <div ref={summaryRef} tabIndex={-1} role="alert" className="banner banner-danger"><AlertTriangle aria-hidden /><div><strong>Some required information is missing</strong><ul style={{ margin: 0, paddingLeft: 18 }}>{errorEntries.map(([k, v]) => <li key={k}><a href={`#f-details-${k}`}>{v}</a></li>)}</ul></div></div>
            )}
            <fieldset><legend>How did it go?</legend>
              <div className="big-choice">
                {(Object.keys(OUTCOMES) as (keyof typeof OUTCOMES)[]).map((o) => <label key={o}><input type="radio" name="outcome" checked={d.outcome === o} onChange={() => update({ outcome: o })} />{OUTCOMES[o]}</label>)}
              </div>
            </fieldset>
            {d.outcome !== 'completed' && <Field label="What happened?" id="f-details-reason" error={localErrors.reason}>{(p) => <Textarea {...p} value={d.reason} onChange={(e) => update({ reason: e.target.value })} />}</Field>}
            {compFields.map((f: any) => <DynamicField key={f.key} f={{ ...f, required: f.required && d.outcome === 'completed' }} value={d.values[f.key]} error={localErrors[f.key]} onChange={(x) => update({ values: { ...d.values, [f.key]: x } })} />)}
            <Field label="Notes" optionalText id="f-details-notes">{(p) => <Textarea {...p} value={d.notes} onChange={(e) => update({ notes: e.target.value })} />}</Field>
            <div className="field" id="f-details-photos">
              <span className="label">Photos{job.requires_photo && d.outcome === 'completed' ? '' : <span className="muted" style={{ fontWeight: 400 }}> (optional)</span>}</span>
              {job.requires_photo && <span className="hint">At least one photo is required for this service.</span>}
              {d.photos.length > 0 && <div className="photo-grid">{d.photos.map((p, i) => <figure key={i}><img src={p} alt={`Photo ${i + 1}`} /><Button size="sm" variant="ghost" aria-label={`Remove photo ${i + 1}`} onClick={() => update({ photos: d.photos.filter((_, x) => x !== i) })}><Trash2 aria-hidden /></Button></figure>)}</div>}
              {d.photos.length < 4 && <label className="btn" style={{ alignSelf: 'flex-start' }}><Camera aria-hidden />Add photo<input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => addPhotos(e.target.files)} /></label>}
              {localErrors.photos && <div className="field-error"><AlertTriangle aria-hidden />{localErrors.photos}</div>}
            </div>
            {job.requires_signature && (
              <div className="field" id="f-details-signature">
                <span className="label">Customer signature</span>
                <SignaturePad value={d.signature} onChange={(v) => update({ signature: v })} />
                {localErrors.signature && <div className="field-error"><AlertTriangle aria-hidden />{localErrors.signature}</div>}
                <Field label="Name of person signing" id="f-details-signerName" error={localErrors.signerName}>{(p) => <Input {...p} value={d.signerName} onChange={(e) => update({ signerName: e.target.value })} />}</Field>
              </div>
            )}
            <Field label="Problem to report" optionalText id="f-details-problem" hint="Dispatch is alerted when you submit.">{(p) => <Textarea {...p} value={d.problem} onChange={(e) => update({ problem: e.target.value })} />}</Field>
          </section>
          <div className="sticky-actions stack-sm">
            <div className="row-between"><SyncState state={draft ? d.state : null} /><span className="small muted">{draft ? `Saved ${relTime(d.updatedAt)}` : 'Changes save on this device as you type'}</span></div>
            <Button variant="primary" size="lg" block icon={<Send aria-hidden />} busy={busy} onClick={submit} disabled={d.state === 'conflict'}>Submit to office</Button>
          </div>
        </>
      )}
      {node}
    </div>
  );
}
