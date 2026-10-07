import { useEffect, useRef, useState } from 'react';
import { useCompany } from '../lib/session';
import { post, ApiError } from '../lib/api';
import { GuideTarget, useToast, useConfirm } from './ui';

// Keys that move through a closed native select. In some browsers each press changes the value (and
// fires "change"), so keyboard changes wait until the person settles, leaves the menu or presses Enter.
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
const KEYBOARD_SETTLE_MS = 1200;

/**
 * Inline driver assignment for tables and panels: choosing a driver saves right away, shows a busy
 * state on the row, and offers Undo. A refused change (stale version, double booking, truck out of
 * service) puts the menu back and shows the server's reason next to it.
 */
export function QuickAssign({ job, onDone }: { job: any; onDone: () => void }) {
  const c = useCompany();
  const toast = useToast();
  const confirm = useConfirm();
  const drivers = c.members.filter((m) => m.role_key === 'driver' || m.role_key === 'owner' || m.role_key === 'dispatcher');
  const saved = job.assigned_user_id ?? '';
  const [val, setVal] = useState<string>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The version we last saw; a save returns the new one so Undo can follow straight away.
  const version = useRef<number>(job.version);
  const current = useRef<string>(saved);
  const keyNav = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (!busy) { setVal(saved); current.current = saved; version.current = job.version; } }, [saved, job.version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!c.can('jobs.assign') || ['completed', 'partial', 'unsuccessful', 'cancelled'].includes(job.status)) return <span>{job.assignee_name ?? '—'}</span>;
  const nameOf = (id: string) => drivers.find((m) => m.id === id)?.name ?? 'the driver';

  const assign = async (to: string, opts: { undo?: boolean } = {}) => {
    const from = current.current;
    if (to === from) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setBusy(true); setError('');
    try {
      const flags = { confirmStarted: false, allowOverlap: false, openDraft: false };
      const send = () => post(`/c/${c.cid}/jobs/${job.id}/assign`, { userId: to || null, resourceIds: (job.resources ?? []).map((x: any) => x.id), version: version.current, ...flags });
      let r;
      for (;;) {
        try { r = await send(); break; }
        catch (e) {
          if (!(e instanceof ApiError)) throw e;
          let yes = false;
          if (e.details?.needsConfirm === 'started' && !flags.confirmStarted) {
            // A driver who already started the job is only replaced after a deliberate yes (R9-M2).
            yes = await confirm.ask({ title: e.message, body: <p>{e.details.driverName} is no longer assigned once you continue. Anything they record on their phone for this job goes to the office for review instead of being lost.</p>, confirm: 'Reassign anyway' });
            flags.confirmStarted = yes;
          } else if (e.details?.needsConfirm === 'draft' && !flags.openDraft) {
            // Drivers don't see drafts: assigning one opens it, after a yes (R3-M7).
            yes = await confirm.ask({ title: e.message, body: <p>Opening the job puts it on the driver's list. It must have a customer, location and service.</p>, confirm: 'Open and assign' });
            flags.openDraft = yes;
          } else if (e.details?.canOverride && !flags.allowOverlap) {
            // An overlap can be accepted on purpose; history records it (R11-m4).
            yes = await confirm.ask({ title: 'This overlaps other work', body: <div className="stack-sm"><ul style={{ margin: 0, paddingLeft: 18 }}>{(e.details.clashes as string[]).map((x) => <li key={x}>{x}</li>)}</ul><p className="small muted" style={{ margin: 0 }}>Assign anyway only if the overlap is deliberate. The job history records it.</p></div>, confirm: 'Assign anyway' });
            flags.allowOverlap = yes;
          } else throw e;
          if (!yes) { setVal(current.current); return; }
        }
      }
      version.current = r.version;
      current.current = to;
      setVal(to);
      const what = opts.undo ? `Change undone on job #${job.number}` : to ? `${nameOf(to)} assigned to job #${job.number}` : `Driver removed from job #${job.number}`;
      toast(what, 'success', opts.undo ? undefined : { label: 'Undo', onClick: () => { void assign(from, { undo: true }); } });
      onDone();
    } catch (e) {
      // Put the menu back to what is saved, and say why next to it.
      setVal(current.current);
      setError((e as ApiError).message);
    } finally { setBusy(false); }
  };

  const onChange = (to: string) => {
    // While a save is running the menu stays focused (not disabled) but ignores further changes.
    if (busy) return;
    setVal(to);
    setError('');
    if (keyNav.current) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { timer.current = null; void assign(to); }, KEYBOARD_SETTLE_MS);
    } else void assign(to);
  };
  const pending = val !== current.current && !busy;
  const errId = `qa-err-${job.id}`;
  return (
    <GuideTarget id={`assign-job-${job.number}`}>
      <span className="quick-assign" aria-busy={busy || undefined}>
        <select className="select" style={{ minHeight: 36, padding: '4px 32px 4px 10px', minWidth: 150, fontSize: 'var(--fs-14)' }} aria-label={`Driver for job #${job.number}`}
          aria-describedby={error ? errId : undefined} aria-invalid={error ? true : undefined} value={val}
          onKeyDown={(e) => {
            if (NAV_KEYS.has(e.key) || (e.key.length === 1 && !e.ctrlKey && !e.metaKey)) keyNav.current = true;
            if (e.key === 'Enter' && val !== current.current) { e.preventDefault(); void assign(val); }
          }}
          onPointerDown={() => { keyNav.current = false; }}
          onBlur={() => { if (timer.current && val !== current.current) void assign(val); keyNav.current = false; }}
          onChange={(e) => onChange(e.target.value)}>
          <option value="">Unassigned</option>
          {drivers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {busy ? <span className="qa-state" role="status"><span className="spinner" aria-hidden />Saving…</span> : pending ? <span className="qa-state">Not saved yet: saves when you leave the menu or press Enter</span> : null}
        {error ? <span id={errId} className="qa-error" role="alert">Not changed: {error}</span> : null}
      </span>
      {confirm.node}
    </GuideTarget>
  );
}
