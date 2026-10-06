import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Send } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, patch, newId, ApiError } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Select, Textarea, ErrorSummary, LoadingBlock, PageHeader, Dialog, Checkbox, Banner, useToast } from '../components/ui';
import { toLocalInput } from '../lib/format';
import { zonedToUtc } from '../../shared/schedule';
import type { FieldDef } from '../../shared/services';

export function DynamicField({ f, value, onChange, error, idPrefix = 'details' }: { f: { key: string; label: string; type: string; unit?: string; options?: string[]; required?: boolean; help?: string }; value: any; onChange: (v: any) => void; error?: string; idPrefix?: string }) {
  const id = `f-${idPrefix}-${f.key}`;
  const label = <>{f.label}{f.unit ? ` (${f.unit})` : ''}{f.required ? '' : <span className="muted" style={{ fontWeight: 400 }}> (optional)</span>}</>;
  if (f.type === 'boolean') return <Checkbox id={id} label={f.label} checked={value === true || value === 'true'} onChange={(e) => onChange(e.target.checked)} />;
  return (
    <Field label={label} id={id} hint={f.help || undefined} error={error}>
      {(p) => f.type === 'select' ? <Select {...p} value={value ?? ''} onChange={(e) => onChange(e.target.value)}><option value="">Choose…</option>{f.options?.map((o) => <option key={o}>{o}</option>)}</Select>
        : f.type === 'longtext' ? <Textarea {...p} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
        : f.type === 'number' ? <Input {...p} inputMode="decimal" value={value ?? ''} onChange={(e) => onChange(e.target.value.replace(',', '.'))} />
        : f.type === 'date' ? <Input {...p} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
        : <Input {...p} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

function NewCustomerDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const c = useCompany();
  const [v, setV] = useState({ name: '', email: '', phone: '', address: '', accessInstructions: '' });
  const s = useSubmit(async () => {
    const r = await post(`/c/${c.cid}/customers`, { name: v.name, email: v.email, phone: v.phone, location: v.address ? { address: v.address, accessInstructions: v.accessInstructions } : undefined });
    onCreated(r.id);
    setV({ name: '', email: '', phone: '', address: '', accessInstructions: '' });
  });
  return (
    <Dialog open={open} onClose={onClose} title="New customer" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={s.busy} onClick={() => s.run()}>Add customer</Button></>}>
      <div className="stack">
        <ErrorSummary error={s.error} labels={{ 'location.address': 'f-nc-address' }} />
        <Field label="Customer name" id="f-name" error={s.fieldError('name')}>{(p) => <Input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <div className="grid-2">
          <Field label="Email" optionalText id="f-email" error={s.fieldError('email')}>{(p) => <Input {...p} type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
          <Field label="Phone" optionalText id="f-phone">{(p) => <Input {...p} type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />}</Field>
        </div>
        <Field label="Service address" id="f-nc-address" hint="Creates the first service location." error={s.fieldError('location.address')}>{(p) => <Input {...p} autoComplete="street-address" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />}</Field>
        <Field label="Access instructions" optionalText id="f-nc-access">{(p) => <Textarea {...p} value={v.accessInstructions} onChange={(e) => setV({ ...v, accessInstructions: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

export function JobForm() {
  const c = useCompany();
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const requestId = useRef(newId('job'));
  const [newCust, setNewCust] = useState(false);
  const customers = useQuery({ queryKey: [c.cid, 'customers', ''], queryFn: () => get(`/c/${c.cid}/customers`), enabled: c.can('customers.view') });
  const services = useQuery({ queryKey: [c.cid, 'services'], queryFn: () => get(`/c/${c.cid}/services`) });
  const resources = useQuery({ queryKey: [c.cid, 'resources'], queryFn: () => get(`/c/${c.cid}/resources`), enabled: c.can('resources.view') });
  const existing = useQuery({ queryKey: [c.cid, 'job', id], queryFn: () => get(`/c/${c.cid}/jobs/${id}`), enabled: editing });
  const [v, setV] = useState<any>({ customerId: '', locationId: '', serviceId: '', start: '', end: '', contactName: '', contactPhone: '', accessInstructions: '', notes: '', details: {}, custom: {}, assignee: '', resourceIds: [] as string[] });
  useEffect(() => {
    const j = existing.data?.job;
    if (j) setV((x: any) => ({ ...x, customerId: j.customer_id ?? '', locationId: j.location_id ?? '', serviceId: j.service_id ?? '', start: toLocalInput(j.scheduled_start, c.company.timezone), end: toLocalInput(j.scheduled_end, c.company.timezone), contactName: j.contact_name, contactPhone: j.contact_phone, accessInstructions: j.access_instructions, notes: j.notes, details: j.details ?? {} }));
  }, [existing.data, c.company.timezone]);
  const custDetail = useQuery({ queryKey: [c.cid, 'customer', v.customerId], queryFn: () => get(`/c/${c.cid}/customers/${v.customerId}`), enabled: !!v.customerId && c.can('customers.view') });
  const locations: any[] = custDetail.data?.locations ?? [];
  useEffect(() => { if (locations.length === 1 && !v.locationId) setV((x: any) => ({ ...x, locationId: locations[0].id })); }, [locations, v.locationId]);
  const svc = useMemo(() => services.data?.services.find((s: any) => s.id === v.serviceId), [services.data, v.serviceId]);
  const requestFields: FieldDef[] = (svc?.fields ?? []).filter((f: FieldDef) => f.stage !== 'completion');
  const toIso = (local: string) => (local ? zonedToUtc(local.slice(0, 10), local.slice(11, 16), c.company.timezone).toISOString() : null);
  const payload = () => ({
    customerId: v.customerId || null, locationId: v.locationId || null, serviceId: v.serviceId || null, scheduledStart: toIso(v.start), scheduledEnd: toIso(v.end),
    contactName: v.contactName, contactPhone: v.contactPhone, accessInstructions: v.accessInstructions, notes: v.notes, details: v.details, custom: v.custom,
  });
  const s = useSubmit(async (intent: 'draft' | 'open') => {
    if (editing) {
      await patch(`/c/${c.cid}/jobs/${id}`, { ...payload(), version: existing.data.job.version });
      await qc.invalidateQueries({ queryKey: [c.cid] });
      toast('Job saved');
      nav(c.to(`jobs/${id}`));
      return;
    }
    const r = await post(`/c/${c.cid}/jobs`, { ...payload(), intent, clientRequestId: requestId.current });
    if ((v.assignee || v.resourceIds.length) && intent === 'open') {
      try {
        const j = await get(`/c/${c.cid}/jobs/${r.id}`);
        await post(`/c/${c.cid}/jobs/${r.id}/assign`, { userId: v.assignee || null, resourceIds: v.resourceIds, version: j.job.version });
      } catch (e) {
        toast(`Job #${r.number} was created, but assignment failed: ${(e as ApiError).message}`, 'error');
      }
    }
    await qc.invalidateQueries({ queryKey: [c.cid] });
    toast(intent === 'draft' ? `Draft job #${r.number} saved${r.missing?.length ? `; still needs: ${r.missing.join(', ').toLowerCase()}` : ''}` : `Job #${r.number} created`);
    nav(c.to(`jobs/${r.id}`));
  });
  if (editing && existing.isLoading) return <div className="page"><LoadingBlock /></div>;
  const fe = (k: string) => s.fieldError(k);
  const isDraft = !editing || existing.data?.job.status === 'draft';
  const drivers = c.members.filter((m) => ['driver', 'owner', 'dispatcher'].includes(m.role_key));
  return (
    <div className="page page-narrow">
      <PageHeader title={editing ? `Edit job #${existing.data?.job.number}` : 'New job'} back={{ to: editing ? c.to(`jobs/${id}`) : c.to('jobs'), label: editing ? 'Job' : 'Jobs' }} sub={editing ? undefined : 'Record what the customer asked for. You can save a draft and finish it later.'} />
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); s.run('open'); }}>
        <ErrorSummary error={s.error} />
        <Card title="Customer and location" id="cust">
          <div className="stack">
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 220 }}><Field label="Customer" id="f-customerId" error={fe('customerId')}>{(p) => <Select {...p} value={v.customerId} onChange={(e) => setV({ ...v, customerId: e.target.value, locationId: '' })}><option value="">Choose a customer…</option>{customers.data?.customers.map((cu: any) => <option key={cu.id} value={cu.id}>{cu.name}</option>)}</Select>}</Field></div>
              {c.can('customers.edit') && <Button icon={<Plus aria-hidden />} onClick={() => setNewCust(true)}>New customer</Button>}
            </div>
            <Field label="Service location" id="f-locationId" error={fe('locationId')} hint={v.customerId && !locations.length && !custDetail.isLoading ? 'This customer has no locations yet. Add one on the customer page.' : undefined}>{(p) => <Select {...p} value={v.locationId} disabled={!v.customerId} onChange={(e) => {
              const loc = locations.find((l) => l.id === e.target.value);
              setV({ ...v, locationId: e.target.value, accessInstructions: v.accessInstructions || loc?.access_instructions || '' });
            }}><option value="">{v.customerId ? 'Choose a location…' : 'Choose a customer first'}</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.label ? `${l.label}: ` : ''}{l.address}</option>)}</Select>}</Field>
            <div className="grid-2">
              <Field label="On-site contact" optionalText id="f-contactName">{(p) => <Input {...p} value={v.contactName} onChange={(e) => setV({ ...v, contactName: e.target.value })} />}</Field>
              <Field label="Contact phone" optionalText id="f-contactPhone">{(p) => <Input {...p} type="tel" value={v.contactPhone} onChange={(e) => setV({ ...v, contactPhone: e.target.value })} />}</Field>
            </div>
            <Field label="Access instructions" optionalText id="f-accessInstructions" hint="Shown to the driver on site.">{(p) => <Textarea {...p} value={v.accessInstructions} onChange={(e) => setV({ ...v, accessInstructions: e.target.value })} />}</Field>
          </div>
        </Card>
        <Card title="Service" id="svc">
          <div className="stack">
            <Field label="Service" id="f-serviceId" error={fe('serviceId')}>{(p) => <Select {...p} value={v.serviceId} onChange={(e) => setV({ ...v, serviceId: e.target.value, details: {} })}><option value="">Choose a service…</option>{services.data?.services.filter((s: any) => s.active).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field>
            {services.data && services.data.services.length === 0 && <Banner tone="warning">No services are set up yet. {c.can('services.manage') ? 'Add one in Services & pricing.' : 'Ask an owner to add one.'}</Banner>}
            {requestFields.length > 0 && <div className="grid-2">{requestFields.map((f) => <DynamicField key={f.key} f={f} value={v.details[f.key]} error={fe(`details.${f.key}`)} onChange={(x) => setV({ ...v, details: { ...v.details, [f.key]: x } })} />)}</div>}
            {c.company.customFields?.jobs?.length > 0 && !editing && <div className="grid-2">{c.company.customFields.jobs.map((f: any) => <DynamicField key={f.key} f={f} idPrefix="custom" value={v.custom[f.key]} error={fe(`custom.${f.key}`)} onChange={(x) => setV({ ...v, custom: { ...v.custom, [f.key]: x } })} />)}</div>}
            <Field label="Notes" optionalText id="f-notes">{(p) => <Textarea {...p} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />}</Field>
          </div>
        </Card>
        <Card title="When" id="when">
          <div className="grid-2">
            <Field label="Requested start" optionalText id="f-scheduledStart" hint={`Company time zone: ${c.company.timezone}`} error={fe('scheduledStart')}>{(p) => <Input {...p} type="datetime-local" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} />}</Field>
            <Field label="Window ends" optionalText id="f-scheduledEnd" hint="Defaults to one hour after the start." error={fe('scheduledEnd')}>{(p) => <Input {...p} type="datetime-local" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} />}</Field>
          </div>
        </Card>
        {!editing && c.can('jobs.assign') && (
          <Card title="Assign now (optional)" id="assign">
            <div className="stack">
              <Field label="Driver" optionalText id="f-assignee">{(p) => <Select {...p} value={v.assignee} onChange={(e) => setV({ ...v, assignee: e.target.value })}><option value="">Leave unassigned</option>{drivers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>
              {resources.data?.resources.length ? (
                <fieldset><legend>Trucks and equipment</legend>{resources.data.resources.filter((r: any) => r.status !== 'retired').map((r: any) => (
                  <Checkbox key={r.id} label={`${r.name}${r.status === 'out_of_service' ? ' (out of service)' : ''}`} disabled={r.status === 'out_of_service'} checked={v.resourceIds.includes(r.id)} onChange={(e) => setV({ ...v, resourceIds: e.target.checked ? [...v.resourceIds, r.id] : v.resourceIds.filter((x: string) => x !== r.id) })} />
                ))}</fieldset>
              ) : null}
            </div>
          </Card>
        )}
        <div className="form-actions">
          {editing ? <Button type="submit" variant="primary" size="lg" icon={<Save aria-hidden />} busy={s.busy}>Save changes</Button> : <>
            <Button type="submit" variant="primary" size="lg" icon={<Send aria-hidden />} busy={s.busy}>Create job</Button>
            {isDraft && <Button size="lg" icon={<Save aria-hidden />} busy={s.busy} onClick={() => s.run('draft')}>Save as draft</Button>}
          </>}
        </div>
      </form>
      <NewCustomerDialog open={newCust} onClose={() => setNewCust(false)} onCreated={async (cid) => { setNewCust(false); await qc.invalidateQueries({ queryKey: [c.cid, 'customers'] }); setV((x: any) => ({ ...x, customerId: cid, locationId: '' })); toast('Customer added'); }} />
    </div>
  );
}
