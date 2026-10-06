import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Truck, Upload, Pencil, Trash2 } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, patch, del, ApiError } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Select, Textarea, ErrorSummary, LoadingBlock, ErrorState, PageHeader, Empty, Dialog, Pill, LinkButton, Checkbox, useToast, useConfirm } from '../components/ui';
import { fmtDate, fmtDateTime } from '../lib/format';

const CATEGORY: Record<string, string> = { fuel: 'Fuel delivery', portable_toilet: 'Portable toilets', septic: 'Septic' };
const STATUS: Record<string, [any, string]> = { available: ['success', 'Available'], in_service: ['info', 'In service'], out_of_service: ['warning', 'Out of service'], retired: ['neutral', 'Retired'] };

export function Resources() {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: [c.cid, 'resources'], queryFn: () => get(`/c/${c.cid}/resources`) });
  const [edit, setEdit] = useState<any>(null);
  const { ask, node } = useConfirm();
  const nav = useNavigate();
  const s = useSubmit(async () => {
    const body = { kind: edit.kind, name: edit.name, identifier: edit.identifier, capacity: edit.capacity, status: edit.status, notes: edit.notes, categories: edit.categories ?? [], outOfServiceUntil: edit.status === 'out_of_service' ? edit.out_of_service_until || null : null };
    if (!edit.id) { await post(`/c/${c.cid}/resources`, body); }
    else {
      try { await patch(`/c/${c.cid}/resources/${edit.id}`, body); }
      catch (e) {
        // Taking a truck with open jobs out of service names those jobs first (R11-M1).
        if (!(e instanceof ApiError) || e.details?.needsConfirm !== 'jobs') throw e;
        const jobs = e.details.jobs as { id: string; number: number; scheduledStart: string | null }[];
        const yes = await ask({ title: e.message, body: <div className="stack-sm"><p style={{ margin: 0 }}>Dispatch is told so they can swap the truck. These jobs keep it until then:</p><ul style={{ margin: 0, paddingLeft: 18 }}>{jobs.slice(0, 8).map((j) => <li key={j.id}><Link to={c.to(`jobs/${j.id}`)}>Job #{j.number}</Link>{j.scheduledStart ? `, ${fmtDateTime(j.scheduledStart, c.company.timezone)}` : ''}</li>)}{jobs.length > 8 ? <li>and {jobs.length - 8} more</li> : null}</ul></div>, confirm: edit.status === 'retired' ? 'Retire anyway' : 'Mark out of service' });
        if (!yes) return;
        await patch(`/c/${c.cid}/resources/${edit.id}`, { ...body, confirmJobs: true });
        const id = edit.id;
        setEdit(null); qc.invalidateQueries({ queryKey: [c.cid] });
        toast(`Saved. ${jobs.length} job${jobs.length === 1 ? '' : 's'} need another truck.`, 'info', { label: 'Show jobs', onClick: () => nav(c.to(`jobs?resource=${id}`)) });
        return;
      }
    }
    setEdit(null); qc.invalidateQueries({ queryKey: [c.cid] }); toast('Saved');
  });
  const remove = async (r: any) => {
    if (!(await ask({ title: `Delete ${r.name}?`, body: 'It was never used on a job, so nothing else changes.', confirm: 'Delete', danger: true }))) return;
    try { await del(`/c/${c.cid}/resources/${r.id}`); toast(`${r.name} deleted`); qc.invalidateQueries({ queryKey: [c.cid] }); } catch (e) { toast((e as ApiError).message, 'error'); }
  };
  return (
    <div className="page">
      <PageHeader title="Trucks & equipment" sub="Shared across all your services. Out-of-service items cannot be assigned."
        actions={c.can('resources.edit') ? <>{c.can('imports.run') && <LinkButton to={c.to('imports')} icon={<Upload aria-hidden />}>Import</LinkButton>}<Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setEdit({ kind: 'truck', name: '', identifier: '', capacity: '', status: 'available', notes: '' })}>Add</Button></> : undefined} />
      {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorState error={q.error} /> : q.data.resources.length === 0 ? (
        <Card><Empty icon={<Truck aria-hidden />} title="No trucks or equipment yet">Add the trucks, trailers and equipment your drivers use, so jobs can be assigned to them without double-booking.</Empty></Card>
      ) : (
        <div className="card card-flush"><div className="table-wrap"><table className="table responsive">
          <thead><tr><th>Name</th><th>Type</th><th>Identifier</th><th>Capacity</th><th>Status</th><th className="right">Open jobs</th>{c.can('resources.edit') && <th><span className="sr-only">Actions</span></th>}</tr></thead>
          <tbody>{q.data.resources.map((r: any) => (
            <tr key={r.id}>
              <td data-primary><strong>{r.name}</strong>{r.notes ? <div className="small muted">{r.notes}</div> : null}</td>
              <td data-label="Type">{r.kind === 'truck' ? 'Truck' : r.kind === 'unit' ? <>Rental unit<div className="small muted">{r.placement === 'on_site' ? <>On site{r.plan_name ? <> · <Link to={c.to(`recurring/${r.plan_id}`)}>{r.plan_name}</Link></> : null}</> : r.placement === 'missing' ? 'Missing' : 'In the yard'}</div></> : 'Equipment'}</td>
              <td data-label="Identifier">{r.identifier || '—'}</td>
              <td data-label="Capacity">{r.capacity || '—'}</td>
              <td data-label="Status"><Pill tone={STATUS[r.status][0]}>{STATUS[r.status][1]}</Pill>{r.status === 'out_of_service' && r.out_of_service_until ? <div className="xsmall muted">Back {fmtDate(`${r.out_of_service_until}T12:00:00Z`, 'UTC')}</div> : null}</td>
              <td data-label="Open jobs" className="right num">{r.open_jobs ? <Link to={c.to(`jobs?resource=${r.id}`)}>{r.open_jobs}</Link> : 0}</td>
              {c.can('resources.edit') && <td data-label=""><div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><Button size="sm" variant="ghost" icon={<Pencil aria-hidden />} onClick={() => setEdit({ ...r, out_of_service_until: r.out_of_service_until ?? '' })}>Edit</Button>{!r.used ? <Button size="sm" variant="ghost" icon={<Trash2 aria-hidden />} aria-label={`Delete ${r.name}`} onClick={() => remove(r)}>Delete</Button> : null}</div></td>}
            </tr>
          ))}</tbody>
        </table></div></div>
      )}
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.name}` : 'Add truck or equipment'} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" busy={s.busy} onClick={() => s.run()}>Save</Button></>}>
        {edit && <div className="stack">
          <ErrorSummary error={s.error} />
          <div className="grid-2">
            <Field label="Type" id="f-kind">{(p) => <Select {...p} value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}><option value="truck">Truck</option><option value="equipment">Equipment</option><option value="unit">Rental unit</option></Select>}</Field>
            <Field label="Status" id="f-status">{(p) => <Select {...p} value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
          </div>
          {edit.status === 'out_of_service' && <Field label="Back in service on" optionalText id="f-until" hint="It shows as available again from this day.">{(p) => <Input {...p} type="date" value={edit.out_of_service_until ?? ''} onChange={(e) => setEdit({ ...edit, out_of_service_until: e.target.value })} />}</Field>}
          <Field label="Name" id="f-name" error={s.fieldError('name')}>{(p) => <Input {...p} maxLength={80} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />}</Field>
          <div className="grid-2">
            <Field label="Identifier or plate" optionalText id="f-identifier">{(p) => <Input {...p} maxLength={60} value={edit.identifier} onChange={(e) => setEdit({ ...edit, identifier: e.target.value })} />}</Field>
            <Field label="Capacity" optionalText id="f-capacity" hint="A number and unit, like 3,000 gal. Rigo asks the driver to confirm any delivery larger than this.">{(p) => <Input {...p} maxLength={60} value={edit.capacity} onChange={(e) => setEdit({ ...edit, capacity: e.target.value })} />}</Field>
          </div>
          {edit.kind !== 'unit' && c.company.service_categories.length > 1 && (
            <fieldset><legend>Used for <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></legend>
              <p className="hint" style={{ margin: '0 0 6px' }}>Jobs list the trucks for their kind of work first. Leave all unticked for any work.</p>
              <div className="row">{c.company.service_categories.map((k: string) => <Checkbox key={k} label={CATEGORY[k] ?? k} checked={(edit.categories ?? []).includes(k)} onChange={(e) => setEdit({ ...edit, categories: e.target.checked ? [...(edit.categories ?? []), k] : (edit.categories ?? []).filter((x: string) => x !== k) })} />)}</div>
            </fieldset>
          )}
          <Field label="Notes" optionalText id="f-notes">{(p) => <Textarea {...p} maxLength={1000} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />}</Field>
        </div>}
      </Dialog>
      {node}
    </div>
  );
}
