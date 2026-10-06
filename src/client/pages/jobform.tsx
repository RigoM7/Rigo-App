import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Send } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, patch, newId, ApiError } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Select, Textarea, ErrorSummary, LoadingBlock, PageHeader, Dialog, Checkbox, Banner, useToast } from '../components/ui';
import { toLocalInput, shiftEnd } from '../lib/format';
import { zonedToUtc } from '../../shared/schedule';
import { tzLabel } from '../../shared/timezones';
import { fieldApplies, type FieldDef } from '../../shared/services';
import { TruckPicker } from '../components/trucks';
import { useUnsavedGuard } from '../lib/unsaved';
import { CustomerPicker } from '../components/customer-picker';

export function DynamicField({ f, value, onChange, error, idPrefix = 'details' }: { f: { key: string; label: string; type: string; unit?: string; options?: string[]; required?: boolean; help?: string }; value: any; onChange: (v: any) => void; error?: string; idPrefix?: string }) {
  const id = `f-${idPrefix}-${f.key}`;
  const label = <>{f.label}{f.unit ? ` (${f.unit})` : ''}{f.required ? '' : <span className="muted" style={{ fontWeight: 400 }}> (optional)</span>}</>;
  if (f.type === 'boolean') return <Checkbox id={id} label={f.label} checked={value === true || value === 'true'} onChange={(e) => onChange(e.target.checked)} />;
  return (
    <Field label={label} id={id} hint={f.help || undefined} error={error}>
      {(p) => f.type === 'select' ? <Select {...p} value={value ?? ''} onChange={(e) => onChange(e.target.value)}><option value="">Choose…</option>{f.options?.map((o) => <option key={o}>{o}</option>)}</Select>
        : f.type === 'longtext' ? <Textarea {...p} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
        : f.type === 'number' ? <Input {...p} className="input num-input" inputMode="decimal" value={value ?? ''} onChange={(e) => onChange(e.target.value.replace(',', '.'))} />
        : f.type === 'date' ? <Input {...p} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
        : <Input {...p} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

function NewCustomerDialog({ open, onClose, onCreated, onPick }: { open: boolean; onClose: () => void; onCreated: (id: string, name: string) => void; onPick: (id: string, name: string) => void }) {
  const c = useCompany();
  const [v, setV] = useState({ name: '', email: '', phone: '', address: '', accessInstructions: '' });
  const [dups, setDups] = useState<any[] | null>(null);
  const s = useSubmit(async (allowDuplicate?: boolean) => {
    try {
      const r = await post(`/c/${c.cid}/customers`, { name: v.name, email: v.email, phone: v.phone, allowDuplicate: !!allowDuplicate, location: v.address ? { address: v.address, accessInstructions: v.accessInstructions } : undefined });
      onCreated(r.id, v.name);
      setV({ name: '', email: '', phone: '', address: '', accessInstructions: '' });
      setDups(null);
    } catch (e) {
      // Probably someone already on file (R5-M1): offer them first.
      if (e instanceof ApiError && e.status === 409 && e.details?.needsConfirm === 'duplicate') { setDups(e.details.candidates); return; }
      throw e;
    }
  });
  return (
    <Dialog open={open} onClose={onClose} title="New customer" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={s.busy} onClick={() => s.run(false)}>Add customer</Button></>}>
      <div className="stack">
        <ErrorSummary error={s.error} labels={{ 'location.address': 'f-nc-address' }} />
        {dups && <section className="card dup-card stack-sm" role="alert" aria-labelledby="nc-dup-h">
          <h3 id="nc-dup-h" style={{ margin: 0 }}>This looks like a customer you already have</h3>
          <ul className="list">{dups.map((d) => (
            <li key={d.id} className="row-between" style={{ padding: '8px 0', gap: 12 }}>
              <span style={{ minWidth: 0 }}><strong>{d.name}</strong><div className="small muted">{[d.firstAddress, d.phone, d.email].filter(Boolean).join(' · ') || 'No address yet'}</div><div className="small">{d.reasons.join(' · ')}</div></span>
              <Button size="sm" onClick={() => { setDups(null); onPick(d.id, d.name); }}>Use this customer</Button>
            </li>
          ))}</ul>
          <div className="row"><Button busy={s.busy} onClick={() => { setDups(null); void s.run(true); }}>Create anyway</Button></div>
        </section>}
        <Field label="Customer name" id="f-name" error={s.fieldError('name')}>{(p) => <Input {...p} maxLength={120} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <div className="grid-2">
          <Field label="Email" optionalText id="f-email" error={s.fieldError('email')}>{(p) => <Input {...p} maxLength={254} type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
          <Field label="Phone" optionalText id="f-phone">{(p) => <Input {...p} maxLength={40} type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />}</Field>
        </div>
        <Field label="Service address" id="f-nc-address" hint="Creates the first service location." error={s.fieldError('location.address')}>{(p) => <Input {...p} maxLength={300} autoComplete="street-address" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />}</Field>
        <Field label="Access instructions" optionalText id="f-nc-access">{(p) => <Textarea {...p} maxLength={1000} value={v.accessInstructions} onChange={(e) => setV({ ...v, accessInstructions: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

const MERGE_FIELDS: [string, string][] = [['customerId', 'Customer'], ['billToCustomerId', 'Who pays'], ['locationId', 'Location'], ['serviceId', 'Service'], ['start', 'Start'], ['end', 'Window ends'],
  ['contactName', 'On-site contact'], ['contactPhone', 'Contact phone'], ['accessInstructions', 'Access instructions'], ['notes', 'Notes'], ['priority', 'Priority'], ['details', 'Service details']];

export function JobForm() {
  const c = useCompany();
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const requestId = useRef(newId('job'));
  const [sp] = useSearchParams();
  const [newCust, setNewCust] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const services = useQuery({ queryKey: [c.cid, 'services'], queryFn: () => get(`/c/${c.cid}/services`) });
  const resources = useQuery({ queryKey: [c.cid, 'resources'], queryFn: () => get(`/c/${c.cid}/resources`), enabled: c.can('resources.view') });
  const existing = useQuery({ queryKey: [c.cid, 'job', id], queryFn: () => get(`/c/${c.cid}/jobs/${id}`), enabled: editing });
  const [v, setV] = useState<any>({ customerId: editing ? '' : sp.get('customer') ?? '', billToCustomerId: '', locationId: '', serviceId: '', start: '', end: '', contactName: '', contactPhone: '', accessInstructions: '', notes: '', details: {}, custom: {}, assignee: '', resourceIds: [] as string[], priority: 'normal' });
  // What the saved job looked like when the form opened: the base for "unsaved changes" and for merging
  // with someone else's edit (R11-m1).
  const fromJob = (j: any) => ({ customerId: j.customer_id ?? '', billToCustomerId: j.bill_to_customer_id ?? '', locationId: j.location_id ?? '', serviceId: j.service_id ?? '', start: toLocalInput(j.scheduled_start, c.company.timezone), end: toLocalInput(j.scheduled_end, c.company.timezone), contactName: j.contact_name ?? '', contactPhone: j.contact_phone ?? '', accessInstructions: j.access_instructions ?? '', notes: j.notes ?? '', details: j.details ?? {}, priority: j.priority ?? 'normal' });
  const [base, setBase] = useState<any>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [merge, setMerge] = useState<null | { theirs: any; fields: { key: string; label: string; mine: string; theirs: string; pick: 'mine' | 'theirs' }[]; version: number }>(null);
  useEffect(() => {
    const j = existing.data?.job;
    if (j && base === null) { const b = fromJob(j); setBase(b); setVersion(j.version); setV((x: any) => ({ ...x, ...b })); }
  }, [existing.data, c.company.timezone]); // eslint-disable-line react-hooks/exhaustive-deps
  const custDetail = useQuery({ queryKey: [c.cid, 'customer', v.customerId], queryFn: () => get(`/c/${c.cid}/customers/${v.customerId}`), enabled: !!v.customerId && c.can('customers.view') });
  const locations: any[] = custDetail.data?.locations ?? [];
  useEffect(() => { if (locations.length === 1 && !v.locationId) setV((x: any) => ({ ...x, locationId: locations[0].id })); }, [locations, v.locationId]);
  const svc = useMemo(() => services.data?.services.find((s: any) => s.id === v.serviceId), [services.data, v.serviceId]);
  const requestFields: FieldDef[] = (svc?.fields ?? []).filter((f: FieldDef) => f.stage !== 'completion' && fieldApplies(f, v.details));
  const toIso = (local: string) => (local ? zonedToUtc(local.slice(0, 10), local.slice(11, 16), c.company.timezone).toISOString() : null);
  const payloadOf = (x: any) => ({
    customerId: x.customerId || null, billToCustomerId: x.billToCustomerId || null, locationId: x.locationId || null, serviceId: x.serviceId || null, scheduledStart: toIso(x.start), scheduledEnd: toIso(x.end),
    contactName: x.contactName, contactPhone: x.contactPhone, accessInstructions: x.accessInstructions, notes: x.notes, details: x.details, custom: x.custom, priority: x.priority,
  });
  const payload = () => payloadOf(v);
  const show = (key: string, val: any) => {
    if (val === '' || val === null || val === undefined) return '(empty)';
    if (key === 'customerId' || key === 'billToCustomerId') return names[val] ?? 'another customer';
    if (key === 'serviceId') return services.data?.services.find((x: any) => x.id === val)?.name ?? 'another service';
    if (key === 'locationId') return locations.find((l) => l.id === val)?.address ?? 'another location';
    if (key === 'start' || key === 'end') return String(val).replace('T', ' ');
    if (key === 'details') return Object.entries(val).filter(([k]) => !k.startsWith('_')).map(([k, x]) => `${k}: ${x}`).join(', ') || '(empty)';
    return String(val);
  };
  const applyMerge = () => {
    if (!merge) return;
    const next = { ...v };
    for (const f of merge.fields) if (f.pick === 'theirs') next[f.key] = merge.theirs[f.key];
    setV(next);
    void s.run('open', next);
  };
  // Leaving with unsaved changes asks first (R11-m2).
  const dirty = editing ? base !== null && JSON.stringify(payloadOf(v)) !== JSON.stringify(payloadOf({ ...v, ...base })) : !!((v.customerId && v.customerId !== sp.get('customer')) || v.billToCustomerId || v.serviceId || v.notes || v.start);
  const s = useSubmit(async (intent: 'draft' | 'open', override?: any) => {
    const cur = override ?? v;
    if (editing) {
      try { await patch(`/c/${c.cid}/jobs/${id}`, { ...payloadOf(cur), version: merge?.version ?? version ?? existing.data.job.version }); }
      catch (e) {
        if (!(e instanceof ApiError) || e.status !== 409 || e.details?.serverVersion === undefined) throw e;
        // Someone else saved first. Keep what was typed: their changes to fields left alone are taken,
        // and fields both changed are listed side by side to choose (R11-m1).
        const fresh = (await get(`/c/${c.cid}/jobs/${id}`)).job;
        const theirs: any = fromJob(fresh);
        const next: any = { ...cur };
        const fields: { key: string; label: string; mine: string; theirs: string; pick: 'mine' | 'theirs' }[] = [];
        for (const [key, label] of MERGE_FIELDS) {
          const b = JSON.stringify(base?.[key] ?? ''), m = JSON.stringify(cur[key] ?? ''), t = JSON.stringify(theirs[key] ?? '');
          if (t === b) continue;
          if (m === b) next[key] = theirs[key];
          else if (m !== t) fields.push({ key, label, mine: show(key, cur[key]), theirs: show(key, theirs[key]), pick: 'mine' });
        }
        setV(next); setBase(theirs); setVersion(fresh.version);
        if (fields.length) { setMerge({ theirs, fields, version: fresh.version }); return; }
        await patch(`/c/${c.cid}/jobs/${id}`, { ...payloadOf(next), version: fresh.version });
      }
      setMerge(null);
      await qc.invalidateQueries({ queryKey: [c.cid] });
      toast('Job saved');
      setBase(null);
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
  const guard = useUnsavedGuard(dirty && !s.busy, { message: 'This job has changes that are not saved. Save or discard?', onSave: async () => !!(await s.run(editing ? 'open' : 'draft')) });
  if (editing && existing.isLoading) return <div className="page"><LoadingBlock /></div>;
  const fe = (k: string) => s.fieldError(k);
  const isDraft = !editing || existing.data?.job.status === 'draft';
  const drivers = c.members.filter((m) => ['driver', 'owner', 'dispatcher'].includes(m.role_key));
  return (
    <div className="page page-narrow">
      <PageHeader title={editing ? `Edit job #${existing.data?.job.number}` : 'New job'} back={{ to: editing ? c.to(`jobs/${id}`) : c.to('jobs'), label: editing ? 'Job' : 'Jobs' }} sub={editing ? undefined : 'Record what the customer asked for. You can save a draft and finish it later.'} />
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); s.run('open'); }}>
        <ErrorSummary error={s.error} />
        {merge && merge.fields.length > 0 && (
          <section className="card stack merge-card" aria-labelledby="merge-h" role="alert">
            <h2 id="merge-h">Someone else saved this job while you were editing</h2>
            <p style={{ margin: 0 }}>Your typing is kept. Their other changes were taken in. Choose which version to keep where you both changed the same thing:</p>
            {merge.fields.map((f, i) => (
              <fieldset key={f.key} className="merge-field">
                <legend>{f.label}</legend>
                <label><input type="radio" name={`merge-${f.key}`} checked={f.pick === 'mine'} onChange={() => setMerge({ ...merge, fields: merge.fields.map((x, n) => (n === i ? { ...x, pick: 'mine' } : x)) })} /> Keep mine: <strong>{f.mine}</strong></label>
                <label><input type="radio" name={`merge-${f.key}`} checked={f.pick === 'theirs'} onChange={() => setMerge({ ...merge, fields: merge.fields.map((x, n) => (n === i ? { ...x, pick: 'theirs' } : x)) })} /> Use theirs: <strong>{f.theirs}</strong></label>
              </fieldset>
            ))}
            <div className="row"><Button variant="primary" busy={s.busy} onClick={applyMerge}>Save with these choices</Button></div>
          </section>
        )}
        <Card title="Customer and location" id="cust">
          <div className="stack">
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 220 }}><Field label="Customer" id="f-customerId" hint="Type part of a name, phone number or address." error={fe('customerId')}>{(p) => <CustomerPicker id={p.id} invalid={p['aria-invalid']} describedBy={p['aria-describedby']} value={v.customerId} name={v.customerId ? names[v.customerId] : null}
                onChange={(cid, cu) => { if (cu) setNames((n) => ({ ...n, [cid]: cu.name })); setV({ ...v, customerId: cid, locationId: '' }); }} />}</Field></div>
              {c.can('customers.edit') && <Button icon={<Plus aria-hidden />} onClick={() => setNewCust(true)}>New customer</Button>}
            </div>
            <Field label="Service location" id="f-locationId" error={fe('locationId')} hint={v.customerId && !locations.length && !custDetail.isLoading ? 'This customer has no locations yet. Add one on the customer page.' : undefined}>{(p) => <Select {...p} value={v.locationId} disabled={!v.customerId} onChange={(e) => {
              const loc = locations.find((l) => l.id === e.target.value);
              setV({ ...v, locationId: e.target.value, accessInstructions: v.accessInstructions || loc?.access_instructions || '' });
            }}><option value="">{v.customerId ? 'Choose a location…' : 'Choose a customer first'}</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.label ? `${l.label}: ` : ''}{l.address}</option>)}</Select>}</Field>
            <details className="advanced" open={!!v.billToCustomerId || undefined}>
              <summary>Someone else pays for this job</summary>
              <div className="stack" style={{ paddingTop: 8 }}>
                <Field label="Who pays" optionalText id="f-billToCustomerId" hint="The invoice goes to this customer, at their prices. The work is still listed under the customer above." error={fe('billToCustomerId')}>{(p) => <CustomerPicker id={p.id} invalid={p['aria-invalid']} describedBy={p['aria-describedby']} value={v.billToCustomerId} name={v.billToCustomerId ? names[v.billToCustomerId] : null}
                  placeholder="Leave empty when the customer pays" onChange={(cid, cu) => { if (cu) setNames((n) => ({ ...n, [cid]: cu.name })); setV({ ...v, billToCustomerId: cid }); }} />}</Field>
              </div>
            </details>
            <div className="grid-2">
              <Field label="On-site contact" optionalText id="f-contactName">{(p) => <Input {...p} maxLength={120} value={v.contactName} onChange={(e) => setV({ ...v, contactName: e.target.value })} />}</Field>
              <Field label="Contact phone" optionalText id="f-contactPhone">{(p) => <Input {...p} maxLength={40} type="tel" value={v.contactPhone} onChange={(e) => setV({ ...v, contactPhone: e.target.value })} />}</Field>
            </div>
            <Field label="Access instructions" optionalText id="f-accessInstructions" hint="Shown to the driver on site.">{(p) => <Textarea {...p} maxLength={2000} value={v.accessInstructions} onChange={(e) => setV({ ...v, accessInstructions: e.target.value })} />}</Field>
          </div>
        </Card>
        <Card title="Service" id="svc">
          <div className="stack">
            <Field label="Service" id="f-serviceId" error={fe('serviceId')}>{(p) => <Select {...p} value={v.serviceId} onChange={(e) => setV({ ...v, serviceId: e.target.value, details: {} })}><option value="">Choose a service…</option>{services.data?.services.filter((s: any) => s.active).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field>
            {services.data && services.data.services.length === 0 && <Banner tone="warning">No services are set up yet. {c.can('services.manage') ? 'Add one in Services & pricing.' : 'Ask an owner to add one.'}</Banner>}
            {requestFields.length > 0 && <div className="grid-2">{requestFields.map((f) => <DynamicField key={f.key} f={f} value={v.details[f.key]} error={fe(`details.${f.key}`)} onChange={(x) => setV({ ...v, details: { ...v.details, [f.key]: x } })} />)}</div>}
            {c.company.customFields?.jobs?.length > 0 && !editing && <div className="grid-2">{c.company.customFields.jobs.map((f: any) => <DynamicField key={f.key} f={f} idPrefix="custom" value={v.custom[f.key]} error={fe(`custom.${f.key}`)} onChange={(x) => setV({ ...v, custom: { ...v.custom, [f.key]: x } })} />)}</div>}
            <Field label="Notes" optionalText id="f-notes">{(p) => <Textarea {...p} maxLength={4000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />}</Field>
          </div>
        </Card>
        <Card title="When" id="when">
          <div className="stack">
          <Field label="Priority" id="f-priority" hint="Urgent and emergency jobs are listed first for their day and marked on the timeline, the job list and the driver's phone." error={fe('priority')}>{(p) => <Select {...p} value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}><option value="normal">Normal</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></Select>}</Field>
          <div className="grid-2">
            <Field label="Requested start" optionalText id="f-scheduledStart" hint={`In ${tzLabel(c.company.timezone)}`} error={fe('scheduledStart')}>{(p) => <Input {...p} type="datetime-local" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value, end: shiftEnd(v.start, v.end, e.target.value) })} />}</Field>
            <Field label="Window ends" optionalText id="f-scheduledEnd" hint="Defaults to one hour after the start. Jobs not started by then are marked Late." error={fe('scheduledEnd')}>{(p) => <Input {...p} type="datetime-local" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} />}</Field>
          </div>
          </div>
        </Card>
        {!editing && c.can('jobs.assign') && (
          <Card title="Assign now (optional)" id="assign">
            <div className="stack">
              <Field label="Driver" optionalText id="f-assignee">{(p) => <Select {...p} value={v.assignee} onChange={(e) => setV({ ...v, assignee: e.target.value })}><option value="">Leave unassigned</option>{drivers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>
              <TruckPicker resources={resources.data?.resources ?? []} selected={v.resourceIds} onChange={(ids) => setV({ ...v, resourceIds: ids })} category={svc?.category ?? null} />
            </div>
          </Card>
        )}
        {guard}
        <div className="form-actions form-bar">
          {editing ? <Button type="submit" variant="primary" size="lg" icon={<Save aria-hidden />} busy={s.busy}>Save changes</Button> : <>
            <Button type="submit" variant="primary" size="lg" icon={<Send aria-hidden />} busy={s.busy}>Create job</Button>
            {isDraft && <Button size="lg" icon={<Save aria-hidden />} busy={s.busy} onClick={() => s.run('draft')}>Save as draft</Button>}
          </>}
        </div>
      </form>
      <NewCustomerDialog open={newCust} onClose={() => setNewCust(false)}
        onCreated={async (cid, name) => { setNewCust(false); setNames((n) => ({ ...n, [cid]: name })); await qc.invalidateQueries({ queryKey: [c.cid, 'customers'] }); setV((x: any) => ({ ...x, customerId: cid, locationId: '' })); toast('Customer added'); }}
        onPick={(cid, name) => { setNewCust(false); setNames((n) => ({ ...n, [cid]: name })); setV((x: any) => ({ ...x, customerId: cid, locationId: '' })); }} />
    </div>
  );
}
