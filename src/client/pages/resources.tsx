import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Truck, Upload, Pencil } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, patch } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Select, Textarea, ErrorSummary, LoadingBlock, ErrorState, PageHeader, Empty, Dialog, Pill, LinkButton, useToast } from '../components/ui';

const STATUS: Record<string, [any, string]> = { available: ['success', 'Available'], in_service: ['info', 'In service'], out_of_service: ['warning', 'Out of service'], retired: ['neutral', 'Retired'] };

export function Resources() {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: [c.cid, 'resources'], queryFn: () => get(`/c/${c.cid}/resources`) });
  const [edit, setEdit] = useState<any>(null);
  const s = useSubmit(async () => {
    const body = { kind: edit.kind, name: edit.name, identifier: edit.identifier, capacity: edit.capacity, status: edit.status, notes: edit.notes };
    if (edit.id) await patch(`/c/${c.cid}/resources/${edit.id}`, body); else await post(`/c/${c.cid}/resources`, body);
    setEdit(null); qc.invalidateQueries({ queryKey: [c.cid] }); toast('Saved');
  });
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
              <td data-label="Type">{r.kind === 'truck' ? 'Truck' : r.kind === 'unit' ? 'Rental unit' : 'Equipment'}</td>
              <td data-label="Identifier">{r.identifier || '—'}</td>
              <td data-label="Capacity">{r.capacity || '—'}</td>
              <td data-label="Status"><Pill tone={STATUS[r.status][0]}>{STATUS[r.status][1]}</Pill></td>
              <td data-label="Open jobs" className="right num">{r.open_jobs}</td>
              {c.can('resources.edit') && <td data-label=""><Button size="sm" variant="ghost" icon={<Pencil aria-hidden />} onClick={() => setEdit({ ...r })}>Edit</Button></td>}
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
          <Field label="Name" id="f-name" error={s.fieldError('name')}>{(p) => <Input {...p} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />}</Field>
          <div className="grid-2">
            <Field label="Identifier or plate" optionalText id="f-identifier">{(p) => <Input {...p} value={edit.identifier} onChange={(e) => setEdit({ ...edit, identifier: e.target.value })} />}</Field>
            <Field label="Capacity" optionalText id="f-capacity" hint="For example: 3,000 gal">{(p) => <Input {...p} value={edit.capacity} onChange={(e) => setEdit({ ...edit, capacity: e.target.value })} />}</Field>
          </div>
          <Field label="Notes" optionalText id="f-notes">{(p) => <Textarea {...p} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />}</Field>
        </div>}
      </Dialog>
    </div>
  );
}
