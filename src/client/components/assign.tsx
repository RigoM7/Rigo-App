import { useState } from 'react';
import { useCompany } from '../lib/session';
import { post, ApiError } from '../lib/api';
import { Button, useToast } from './ui';

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
      <select className="select" style={{ minHeight: 36, padding: '4px 32px 4px 10px', minWidth: 150, fontSize: 'var(--fs-14)' }} aria-label={`Driver for job #${job.number}`} value={val} onChange={(e) => setVal(e.target.value)}>
        <option value="">Unassigned</option>
        {drivers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      {val !== (job.assigned_user_id ?? '') && <Button size="sm" variant="primary" busy={busy} onClick={save}>Save</Button>}
    </span>
  );
}

