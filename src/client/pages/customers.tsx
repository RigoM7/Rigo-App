import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users, MapPin, Upload, Search, Pencil } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, patch } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Textarea, ErrorSummary, LoadingBlock, ErrorState, PageHeader, Empty, Dialog, JobStatus, InvoiceStatus, MessageStatus, LinkButton, useToast } from '../components/ui';
import { formatMoney, fmtDate, fmtDateTime } from '../lib/format';
import { DynamicField } from './jobform';

function CustomerDialog({ open, onClose, existing, onSaved }: { open: boolean; onClose: () => void; existing?: any; onSaved: (id: string) => void }) {
  const c = useCompany();
  const defs = c.company.customFields?.customers ?? [];
  const [v, setV] = useState<any>(() => existing ? { name: existing.name, email: existing.email ?? '', phone: existing.phone ?? '', billingAddress: existing.billingAddress ?? '', notes: existing.notes ?? '', custom: existing.custom ?? {}, address: '', access: '' } : { name: '', email: '', phone: '', billingAddress: '', notes: '', custom: {}, address: '', access: '' });
  const s = useSubmit(async () => {
    const body: any = { name: v.name, notes: v.notes, custom: v.custom };
    if (c.can('customers.contact')) Object.assign(body, { email: v.email, phone: v.phone, billingAddress: v.billingAddress });
    if (existing) { await patch(`/c/${c.cid}/customers/${existing.id}`, { ...body, version: existing.version }); onSaved(existing.id); }
    else { const r = await post(`/c/${c.cid}/customers`, { ...body, location: v.address ? { address: v.address, accessInstructions: v.access } : undefined }); onSaved(r.id); }
  });
  return (
    <Dialog open={open} onClose={onClose} title={existing ? 'Edit customer' : 'New customer'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={s.busy} onClick={() => s.run()}>{existing ? 'Save' : 'Add customer'}</Button></>}>
      <div className="stack">
        <ErrorSummary error={s.error} labels={{ 'location.address': 'f-address' }} />
        <Field label="Name" id="f-name" error={s.fieldError('name')}>{(p) => <Input {...p} maxLength={120} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        {c.can('customers.contact') && <>
          <div className="grid-2">
            <Field label="Email" optionalText id="f-email" error={s.fieldError('email')} hint="Used for invoices and updates.">{(p) => <Input {...p} maxLength={254} type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
            <Field label="Phone" optionalText id="f-phone">{(p) => <Input {...p} maxLength={40} type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />}</Field>
          </div>
          <Field label="Billing address" optionalText id="f-billingAddress">{(p) => <Input {...p} maxLength={300} value={v.billingAddress} onChange={(e) => setV({ ...v, billingAddress: e.target.value })} />}</Field>
        </>}
        {!existing && <>
          <Field label="First service address" optionalText id="f-address" error={s.fieldError('location.address')}>{(p) => <Input {...p} maxLength={300} value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />}</Field>
          {v.address && <Field label="Access instructions" optionalText id="f-access">{(p) => <Textarea {...p} maxLength={1000} value={v.access} onChange={(e) => setV({ ...v, access: e.target.value })} />}</Field>}
        </>}
        {defs.map((f: any) => <DynamicField key={f.key} f={f} idPrefix="custom" value={v.custom[f.key]} error={s.fieldError(`custom.${f.key}`)} onChange={(x) => setV({ ...v, custom: { ...v.custom, [f.key]: x } })} />)}
        <Field label="Notes" optionalText id="f-notes">{(p) => <Textarea {...p} maxLength={2000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

export function Customers() {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const search = sp.get('q') ?? '';
  const [creating, setCreating] = useState(() => sp.get('new') === '1' && c.can('customers.edit'));
  const q = useQuery({ queryKey: [c.cid, 'customers', search], queryFn: () => get(`/c/${c.cid}/customers?q=${encodeURIComponent(search)}`) });
  return (
    <div className="page">
      <PageHeader title="Customers" sub="Customers and their service locations are shared by every service your company offers."
        actions={<>{c.can('imports.run') && <LinkButton to={c.to('imports')} icon={<Upload aria-hidden />}>Import</LinkButton>}{c.can('customers.edit') && <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setCreating(true)}>New customer</Button>}</>} />
      <form role="search" onSubmit={(e) => e.preventDefault()}><Field label="Search customers" id="f-search">{(p) => <div className="input-group"><Input {...p} type="search" placeholder="Name, email, phone or address" defaultValue={search} onChange={(e) => setSp(e.target.value ? { q: e.target.value } : {}, { replace: true })} /><span className="icon-btn" aria-hidden><Search /></span></div>}</Field></form>
      {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorState error={q.error} /> : q.data.customers.length === 0 ? (
        <Card><Empty icon={<Users aria-hidden />} title={search ? 'No customers match' : 'No customers yet'} action={c.can('customers.edit') ? <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setCreating(true)}>Add a customer</Button> : undefined}>{search ? 'Try another search.' : 'Add customers one at a time or import a CSV file.'}</Empty></Card>
      ) : (
        <div className="card card-flush"><div className="table-wrap"><table className="table responsive">
          <thead><tr><th>Customer</th>{c.can('customers.contact') && <th>Contact</th>}<th className="right">Locations</th><th className="right">Open jobs</th></tr></thead>
          <tbody>{q.data.customers.map((cu: any) => (
            <tr key={cu.id}>
              <td data-primary><Link className="row-link" to={c.to(`customers/${cu.id}`)}>{cu.name}</Link></td>
              {c.can('customers.contact') && <td data-label="Contact">{cu.email || cu.phone ? <>{cu.email}<div className="small muted">{cu.phone}</div></> : <span className="muted">—</span>}</td>}
              <td data-label="Locations" className="right num">{cu.locationCount}</td>
              <td data-label="Open jobs" className="right num">{cu.openJobs}</td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}
      {creating && <CustomerDialog open onClose={() => { setCreating(false); if (sp.get('new')) { const n = new URLSearchParams(sp); n.delete('new'); setSp(n, { replace: true }); } }} onSaved={() => { setCreating(false); qc.invalidateQueries({ queryKey: [c.cid, 'customers'] }); toast('Customer added'); }} />}
    </div>
  );
}

export function CustomerDetail() {
  const c = useCompany();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [loc, setLoc] = useState<null | { id?: string; label: string; address: string; accessInstructions: string; siteContact: string }>(null);
  const q = useQuery({ queryKey: [c.cid, 'customer', id], queryFn: () => get(`/c/${c.cid}/customers/${id}`) });
  const saveLoc = useSubmit(async () => {
    if (loc?.id) await patch(`/c/${c.cid}/locations/${loc.id}`, loc); else await post(`/c/${c.cid}/customers/${id}/locations`, loc);
    setLoc(null); qc.invalidateQueries({ queryKey: [c.cid] }); toast('Location saved');
  });
  if (q.isLoading) return <div className="page"><LoadingBlock /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} /></div>;
  const { customer, locations, jobs, invoices, messages } = q.data;
  return (
    <div className="page">
      <PageHeader back={{ to: c.to('customers'), label: 'Customers' }} title={customer.name} actions={<>
        {c.can('customers.edit') && <Button icon={<Pencil aria-hidden />} onClick={() => setEditing(true)}>Edit</Button>}
        {c.can('jobs.create') && <LinkButton variant="primary" to={c.to('jobs/new')} icon={<Plus aria-hidden />}>New job</LinkButton>}
      </>} />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card id="info" title="Details">
            <dl className="kv">
              {customer.contactHidden ? <><dt>Contact</dt><dd className="muted">Hidden for your role</dd></> : <>
                <dt>Email</dt><dd>{customer.email ? <a href={`mailto:${customer.email}`}>{customer.email}</a> : '—'}</dd>
                <dt>Phone</dt><dd>{customer.phone ? <a href={`tel:${customer.phone}`}>{customer.phone}</a> : '—'}</dd>
                <dt>Billing address</dt><dd>{customer.billingAddress || '—'}</dd>
              </>}
              {q.data.customFields.customers.map((f: any) => <div key={f.key} style={{ display: 'contents' }}><dt>{f.label}</dt><dd>{String(customer.custom?.[f.key] ?? '—')}</dd></div>)}
              <dt>Notes</dt><dd className="pre">{customer.notes || '—'}</dd>
              <dt>Customer since</dt><dd>{fmtDate(customer.createdAt)}</dd>
            </dl>
          </Card>
          <Card id="locs" title={<h2 className="row"><MapPin aria-hidden />Service locations</h2>} actions={c.can('customers.edit') ? <Button size="sm" icon={<Plus aria-hidden />} onClick={() => setLoc({ label: '', address: '', accessInstructions: '', siteContact: '' })}>Add location</Button> : undefined}>
            {locations.length === 0 ? <p className="muted">No locations yet. Jobs need a service location.</p> : (
              <ul className="list">{locations.map((l: any) => (
                <li key={l.id} style={{ padding: '10px 0' }} className="row-between">
                  <span style={{ minWidth: 0 }}><strong>{l.label || 'Location'}</strong><div>{l.address}</div>{l.access_instructions && <div className="small muted">Access: {l.access_instructions}</div>}{l.site_contact && <div className="small muted">Contact: {l.site_contact}</div>}</span>
                  {c.can('customers.edit') && <Button size="sm" variant="ghost" onClick={() => setLoc({ id: l.id, label: l.label, address: l.address, accessInstructions: l.access_instructions, siteContact: l.site_contact })}>Edit</Button>}
                </li>
              ))}</ul>
            )}
          </Card>
        </div>
        <div className="stack">
          <Card id="jobs" title="Jobs">{jobs.length === 0 ? <p className="muted">No jobs yet.</p> : <ul className="list">{jobs.map((j: any) => <li key={j.id} className="row-between" style={{ padding: '8px 0' }}><Link to={c.to(`jobs/${j.id}`)}>#{j.number} {j.service_name}</Link><span className="row"><span className="small muted">{fmtDateTime(j.scheduled_start, c.company.timezone)}</span><JobStatus status={j.status} /></span></li>)}</ul>}</Card>
          {invoices && <Card id="invs" title="Invoices">{invoices.length === 0 ? <p className="muted">No invoices yet.</p> : <ul className="list">{invoices.map((i: any) => <li key={i.id} className="row-between" style={{ padding: '8px 0' }}><Link to={c.to(`invoices/${i.id}`)}>{i.number ?? 'Draft'}</Link><span className="row">{i.total_minor !== null ? <span className="num">{formatMoney(i.total_minor, i.currency)}</span> : null}<InvoiceStatus status={i.status} /></span></li>)}</ul>}</Card>}
          {messages && <Card id="conv" title="Conversation">{messages.length === 0 ? <p className="muted">No messages yet.</p> : <ul className="list">{messages.map((m: any) => <li key={m.id} className="row-between" style={{ padding: '8px 0' }}><span>{m.subject}<div className="small muted">{fmtDateTime(m.created_at)}</div></span><MessageStatus status={m.status} /></li>)}</ul>}</Card>}
        </div>
      </div>
      {editing && <CustomerDialog open existing={customer} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); qc.invalidateQueries({ queryKey: [c.cid] }); toast('Customer saved'); }} />}
      <Dialog open={!!loc} onClose={() => setLoc(null)} title={loc?.id ? 'Edit location' : 'Add location'} footer={<><Button onClick={() => setLoc(null)}>Cancel</Button><Button variant="primary" busy={saveLoc.busy} onClick={() => saveLoc.run()}>Save location</Button></>}>
        {loc && <div className="stack">
          <ErrorSummary error={saveLoc.error} />
          <Field label="Label" optionalText id="f-label" hint="For example: Main yard, North lot">{(p) => <Input {...p} maxLength={80} value={loc.label} onChange={(e) => setLoc({ ...loc, label: e.target.value })} />}</Field>
          <Field label="Address" id="f-address" error={saveLoc.fieldError('address')}>{(p) => <Input {...p} maxLength={300} value={loc.address} onChange={(e) => setLoc({ ...loc, address: e.target.value })} />}</Field>
          <Field label="Access instructions" optionalText id="f-accessInstructions">{(p) => <Textarea {...p} maxLength={1000} value={loc.accessInstructions} onChange={(e) => setLoc({ ...loc, accessInstructions: e.target.value })} />}</Field>
          <Field label="Site contact" optionalText id="f-siteContact">{(p) => <Input {...p} maxLength={200} value={loc.siteContact} onChange={(e) => setLoc({ ...loc, siteContact: e.target.value })} />}</Field>
          <p className="small muted">Addresses are stored as text. Maps and geocoding are not connected.</p>
        </div>}
      </Dialog>
    </div>
  );
}
