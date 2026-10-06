import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users, MapPin, Upload, Search, Pencil } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, patch, del, ApiError } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Select, Textarea, Checkbox, Pill, ErrorSummary, Banner, LoadingBlock, ErrorState, PageHeader, Empty, Dialog, JobStatus, InvoiceStatus, MessageStatus, LinkButton, useToast, useConfirm, Tabs } from '../components/ui';
import { formatMoney, fmtDate, fmtDateTime } from '../lib/format';
import { formatRate, parseRate, rateToInput } from '../../shared/billing';
import { termsLabel } from '../../shared/invoices';
import { PaymentPill } from './invoices';
import { CustomerAccount } from './customer-account';
import { DynamicField } from './jobform';
import { CustomerPicker, DuplicateNotice } from '../components/customer-picker';

function CustomerDialog({ open, onClose, existing, onSaved }: { open: boolean; onClose: () => void; existing?: any; onSaved: (id: string) => void }) {
  const c = useCompany();
  const defs = c.company.customFields?.customers ?? [];
  const bc = existing?.billingContact ?? {};
  const [v, setV] = useState<any>(() => existing ? { name: existing.name, email: existing.email ?? '', phone: existing.phone ?? '', billingAddress: existing.billingAddress ?? '', notes: existing.notes ?? '', custom: existing.custom ?? {}, address: '', access: '', taxExempt: !!existing.taxExempt, taxExemptNote: existing.taxExemptNote ?? '', terms: existing.paymentTermsDays === null || existing.paymentTermsDays === undefined ? '' : String(existing.paymentTermsDays), monthlyStatement: !!existing.monthlyStatement, bcName: bc.name ?? '', bcEmail: bc.email ?? '', bcPhone: bc.phone ?? '' } : { name: '', email: '', phone: '', billingAddress: '', notes: '', custom: {}, address: '', access: '', taxExempt: false, taxExemptNote: '', terms: '', monthlyStatement: false, bcName: '', bcEmail: '', bcPhone: '' });
  const [initial] = useState(() => JSON.stringify(v));
  const [dups, setDups] = useState<any[] | null>(null);
  const confirm = useConfirm();
  const billing = c.can('invoices.edit');
  const contact = c.can('customers.contact');
  const s = useSubmit(async (allowDuplicate?: boolean) => {
    const body: any = { name: v.name, notes: v.notes, custom: v.custom };
    if (contact) Object.assign(body, { email: v.email, phone: v.phone, billingAddress: v.billingAddress, billingContact: { name: v.bcName, email: v.bcEmail, phone: v.bcPhone } });
    if (billing) Object.assign(body, { taxExempt: v.taxExempt, taxExemptNote: v.taxExempt ? v.taxExemptNote : '', paymentTermsDays: v.terms === '' ? null : Number(v.terms), monthlyStatement: v.monthlyStatement });
    if (existing) {
      // A changed name, email or phone that now matches another customer is pointed out before saving (R5-M1).
      const changed = v.name !== existing.name || (contact && (v.email !== (existing.email ?? '') || v.phone !== (existing.phone ?? '')));
      if (changed && !allowDuplicate) {
        const r = await post(`/c/${c.cid}/customers/duplicates`, { name: v.name, email: contact ? v.email : '', phone: contact ? v.phone : '', exceptId: existing.id });
        if (r.candidates.length) { setDups(r.candidates); return; }
      }
      await patch(`/c/${c.cid}/customers/${existing.id}`, { ...body, version: existing.version }); onSaved(existing.id);
      return;
    }
    try {
      const r = await post(`/c/${c.cid}/customers`, { ...body, allowDuplicate: !!allowDuplicate, location: v.address ? { address: v.address, accessInstructions: v.access } : undefined });
      onSaved(r.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.details?.needsConfirm === 'duplicate') { setDups(e.details.candidates); return; }
      throw e;
    }
  });
  // Closing with something typed asks first, like leaving a page with unsaved changes.
  const close = async () => {
    if (JSON.stringify(v) !== initial && !(await confirm.ask({ title: 'Discard changes?', body: <p>{existing ? 'Your changes to this customer are not saved.' : 'This customer has not been added yet.'}</p>, confirm: 'Discard changes', danger: true }))) return;
    onClose();
  };
  const set = (p: any) => { setV({ ...v, ...p }); if (dups && ('name' in p || 'email' in p || 'phone' in p || 'address' in p)) setDups(null); };
  return (
    <Dialog open={open} onClose={close} title={existing ? 'Edit customer' : 'New customer'} footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" busy={s.busy} onClick={() => s.run(false)}>{existing ? 'Save' : 'Add customer'}</Button></>}>
      {confirm.node}
      <div className="stack">
        <ErrorSummary error={s.error} labels={{ 'location.address': 'f-address', 'billingContact.email': 'f-bcEmail' }} />
        {dups && <DuplicateNotice candidates={dups} busy={s.busy} continueLabel={existing ? 'Save anyway' : 'Create anyway'} onContinue={() => { setDups(null); void s.run(true); }} />}
        <Field label="Name" id="f-name" error={s.fieldError('name')}>{(p) => <Input {...p} maxLength={120} value={v.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
        {c.can('customers.contact') && <>
          <div className="grid-2">
            <Field label="Email" optionalText id="f-email" error={s.fieldError('email')} hint="Used for invoices and updates.">{(p) => <Input {...p} maxLength={254} type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} />}</Field>
            <Field label="Phone" optionalText id="f-phone">{(p) => <Input {...p} maxLength={40} type="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} />}</Field>
          </div>
          <Field label="Billing address" optionalText id="f-billingAddress">{(p) => <Input {...p} maxLength={300} value={v.billingAddress} onChange={(e) => setV({ ...v, billingAddress: e.target.value })} />}</Field>
          <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ marginBottom: 4 }}>Billing contact <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></legend>
            <p className="small muted" style={{ margin: 0 }}>Someone other than the main contact who handles invoices, such as accounts payable. Invoices are emailed here when set.</p>
            <div className="grid-3">
              <Field label="Name" id="f-bcName">{(p) => <Input {...p} maxLength={120} value={v.bcName} onChange={(e) => setV({ ...v, bcName: e.target.value })} />}</Field>
              <Field label="Email" id="f-bcEmail" error={s.fieldError('billingContact.email')}>{(p) => <Input {...p} maxLength={254} type="email" value={v.bcEmail} onChange={(e) => setV({ ...v, bcEmail: e.target.value })} />}</Field>
              <Field label="Phone" id="f-bcPhone">{(p) => <Input {...p} maxLength={40} type="tel" value={v.bcPhone} onChange={(e) => setV({ ...v, bcPhone: e.target.value })} />}</Field>
            </div>
          </fieldset>
        </>}
        {!existing && <>
          <Field label="First service address" optionalText id="f-address" error={s.fieldError('location.address')}>{(p) => <Input {...p} maxLength={300} value={v.address} onChange={(e) => set({ address: e.target.value })} />}</Field>
          {v.address && <Field label="Access instructions" optionalText id="f-access">{(p) => <Textarea {...p} maxLength={1000} value={v.access} onChange={(e) => setV({ ...v, access: e.target.value })} />}</Field>}
        </>}
        {billing && <>
          <Checkbox label="Tax exempt" hint="No tax is charged on this customer's invoices, whatever the service's tax rate." checked={v.taxExempt} onChange={(e) => setV({ ...v, taxExempt: e.target.checked })} />
          {v.taxExempt && <Field label="Exemption certificate" optionalText id="f-taxExemptNote" hint="For example: Farm exemption certificate F-1029, expires 12/2027">{(p) => <Input {...p} maxLength={200} value={v.taxExemptNote} onChange={(e) => setV({ ...v, taxExemptNote: e.target.value })} />}</Field>}
          <Field label="Payment terms" id="f-paymentTermsDays" hint="When their invoices are due. The company default is set in Settings.">{(p) => <Select {...p} value={v.terms} onChange={(e) => setV({ ...v, terms: e.target.value })}>
            <option value="">Company default ({termsLabel(c.company.invoiceDueDays)})</option>{[0, 7, 10, 15, 30, 45, 60, 90].map((n) => <option key={n} value={String(n)}>{termsLabel(n)}</option>)}</Select>}</Field>
          <Checkbox label="Send a monthly statement" hint="Prepared on the 1st of each month for review before it's sent." checked={v.monthlyStatement} onChange={(e) => setV({ ...v, monthlyStatement: e.target.checked })} />
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
  const archived = sp.get('archived') === '1';
  const [creating, setCreating] = useState(() => sp.get('new') === '1' && c.can('customers.edit'));
  const q = useQuery({ queryKey: [c.cid, 'customers', search, archived ? 'archived' : ''], queryFn: () => get(`/c/${c.cid}/customers?q=${encodeURIComponent(search)}${archived ? '&archived=1' : ''}`) });
  const setParam = (k: string, val: string) => { const n = new URLSearchParams(sp); if (val) n.set(k, val); else n.delete(k); setSp(n, { replace: true }); };
  return (
    <div className="page">
      <PageHeader title="Customers" sub="Customers and their service locations are shared by every service your company offers."
        actions={<>{c.can('imports.run') && <LinkButton to={c.to('imports')} icon={<Upload aria-hidden />}>Import</LinkButton>}{c.can('customers.edit') && <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setCreating(true)}>New customer</Button>}</>} />
      <form role="search" onSubmit={(e) => e.preventDefault()}><Field label="Search customers" id="f-search">{(p) => <div className="input-group"><Input {...p} type="search" placeholder="Name, email, phone or address" defaultValue={search} onChange={(e) => setParam('q', e.target.value)} /><span className="icon-btn" aria-hidden><Search /></span></div>}</Field></form>
      <Tabs label="Which customers" value={archived ? 'archived' : 'active'} onChange={(k) => setParam('archived', k === 'archived' ? '1' : '')} tabs={[{ key: 'active', label: 'Active' }, { key: 'archived', label: 'Archived' }]} />
      {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorState error={q.error} /> : q.data.customers.length === 0 ? (
        archived ? <Card><Empty icon={<Users aria-hidden />} title={search ? 'No archived customers match' : 'No archived customers'}>Archived customers are hidden from lists and pickers but keep their jobs and invoices.</Empty></Card> :
        <Card><Empty icon={<Users aria-hidden />} title={search ? 'No customers match' : 'No customers yet'} action={c.can('customers.edit') ? <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setCreating(true)}>Add a customer</Button> : undefined}>{search ? 'Try another search.' : 'Add customers one at a time or import a CSV file.'}</Empty></Card>
      ) : (
        <div className="card card-flush"><div className="table-wrap"><table className="table responsive">
          <thead><tr><th>Customer</th>{c.can('customers.contact') && <th>Contact</th>}<th className="right">Locations</th><th className="right">Open jobs</th></tr></thead>
          <tbody>{q.data.customers.map((cu: any) => (
            <tr key={cu.id}>
              <td data-primary><Link className="row-link" to={c.to(`customers/${cu.id}`)}>{cu.name}</Link>{cu.firstAddress && <div className="small muted">{cu.firstAddress}</div>}</td>
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
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [loc, setLoc] = useState<null | { id?: string; label: string; address: string; accessInstructions: string; siteContact: string; siteContactPhone: string; custom: Record<string, unknown>; openJobs?: number; updateOpenJobs?: boolean }>(null);
  const q = useQuery({ queryKey: [c.cid, 'customer', id], queryFn: () => get(`/c/${c.cid}/customers/${id}`) });
  const saveLoc = useSubmit(async () => {
    const { openJobs, ...body } = loc!;
    if (!c.can('customers.contact')) delete (body as any).siteContactPhone;
    const r = loc?.id ? await patch(`/c/${c.cid}/locations/${loc.id}`, body) : await post(`/c/${c.cid}/customers/${id}/locations`, body);
    setLoc(null); qc.invalidateQueries({ queryKey: [c.cid] }); toast(r?.updatedJobs ? `Location saved. ${r.updatedJobs} open job(s) updated and their drivers told.` : 'Location saved');
  });
  const act = useSubmit(async (what: 'archive' | 'unarchive' | 'delete' | 'undo', mergeId?: string) => {
    const name = q.data.customer.name;
    if (what === 'archive' && !(await confirm.ask({ title: `Archive ${name}?`, body: <p>They are hidden from customer lists and pickers. Their jobs, invoices and messages are kept, and you can restore them from the Archived list.</p>, confirm: 'Archive customer' }))) return;
    if (what === 'delete' && !(await confirm.ask({ title: `Delete ${name}?`, body: <p>The customer and their service locations are removed for good. This only works for a customer with no jobs, invoices or messages.</p>, confirm: 'Delete customer', danger: true }))) return;
    if (what === 'undo' && !(await confirm.ask({ title: 'Undo this merge?', body: <p>The other customer comes back, with exactly the locations, jobs, invoices and messages that moved. Anything added since stays here.</p>, confirm: 'Undo merge' }))) return;
    if (what === 'delete') { await del(`/c/${c.cid}/customers/${id}`); await qc.invalidateQueries({ queryKey: [c.cid, 'customers'] }); toast(`${name} deleted`); nav(c.to('customers')); return; }
    if (what === 'undo') await post(`/c/${c.cid}/customer-merges/${mergeId}/undo`, {});
    else await post(`/c/${c.cid}/customers/${id}/${what}`, {});
    await qc.invalidateQueries({ queryKey: [c.cid] });
    toast(what === 'archive' ? `${name} archived` : what === 'unarchive' ? `${name} restored` : 'Merge undone');
  });
  const nav = useNavigate();
  if (q.isLoading) return <div className="page"><LoadingBlock /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} /></div>;
  const { customer, locations, upcoming, past, summary, invoices, messages, mergedFrom, mergedInto } = q.data;
  const locDefs: any[] = q.data.customFields.locations ?? [];
  const archived = !!customer.archivedAt;
  const canMerge = c.role.isOwner || (c.can('customers.edit') && c.can('invoices.edit'));
  const next = summary.nextVisit;
  const jobRow = (j: any) => (
    <li key={j.id} className="row-between" style={{ padding: '8px 0', gap: 12 }}>
      <span style={{ minWidth: 0 }}><Link to={c.to(`jobs/${j.id}`)}>#{j.number} {j.service_name ?? 'Job'}</Link>{j.address && <div className="small muted">{j.address}</div>}</span>
      <span className="row" style={{ flexShrink: 0 }}><span className="small muted">{j.scheduled_start ? fmtDateTime(j.scheduled_start, c.company.timezone) : 'No time set'}</span><JobStatus status={j.status} /></span>
    </li>
  );
  return (
    <div className="page">
      {confirm.node}
      <PageHeader back={{ to: c.to('customers'), label: 'Customers' }} title={customer.name} actions={archived ? undefined : <>
        {c.can('customers.edit') && <Button icon={<Pencil aria-hidden />} onClick={() => setEditing(true)}>Edit</Button>}
        {c.can('jobs.create') && <LinkButton variant="primary" to={c.to(`jobs/new?customer=${customer.id}`)} icon={<Plus aria-hidden />}>New job</LinkButton>}
      </>} />
      <ErrorSummary error={act.error} />
      {mergedInto ? <Banner tone="info">This customer was merged into <Link to={c.to(`customers/${mergedInto.id}`)}>{mergedInto.name}</Link>. Their records are there now; the merge can be undone from that page for 30 days.</Banner>
        : archived ? <Banner tone="info" action={c.can('customers.edit') ? <Button size="sm" busy={act.busy} onClick={() => act.run('unarchive')}>Restore customer</Button> : undefined}>Archived {fmtDate(customer.archivedAt, c.company.timezone)}. Hidden from lists and pickers; jobs and invoices are kept.</Banner> : null}
      <section className="summary-strip" aria-label="At a glance">
        <div><span className="label">Next visit</span>
          {next ? <span><Link to={c.to(`jobs/${next.id}`)}>{fmtDateTime(next.scheduled_start, c.company.timezone)}</Link> · {next.service_name ?? 'Job'}{next.address ? ` · ${next.address}` : ''}</span> : <span className="muted">Nothing scheduled</span>}</div>
        {summary.owes && <div><span className="label">Owes</span>
          {summary.owes.unpaid > 0 ? <span><strong className="num">{formatMoney(summary.owes.balanceMinor, c.company.currency)}</strong> · {summary.owes.unpaid} unpaid{summary.owes.overdue ? <> · <Pill tone="danger">{summary.owes.overdue} overdue</Pill></> : null}</span> : <span className="muted">Nothing owed</span>}</div>}
      </section>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card id="info" title="Details">
            <dl className="kv">
              {customer.contactHidden ? <><dt>Contact</dt><dd className="muted">Hidden for your role</dd></> : <>
                <dt>Email</dt><dd>{customer.email ? <a href={`mailto:${customer.email}`}>{customer.email}</a> : '—'}</dd>
                <dt>Phone</dt><dd>{customer.phone ? <a href={`tel:${customer.phone}`}>{customer.phone}</a> : '—'}</dd>
                <dt>Billing address</dt><dd>{customer.billingAddress || '—'}</dd>
              </>}
              {(customer.billingContact?.name || customer.billingContact?.email || customer.billingContact?.phone) && <><dt>Billing contact</dt><dd>{customer.billingContact.name}
                {customer.billingContact.email && <div><a href={`mailto:${customer.billingContact.email}`}>{customer.billingContact.email}</a></div>}
                {customer.billingContact.phone && <div><a href={`tel:${customer.billingContact.phone}`}>{customer.billingContact.phone}</a></div>}
                {customer.billingContact.email && <div className="small muted">Invoices and statements are emailed here.</div>}</dd></>}
              {q.data.customFields.customers.map((f: any) => <div key={f.key} style={{ display: 'contents' }}><dt>{f.label}</dt><dd>{String(customer.custom?.[f.key] ?? '—')}</dd></div>)}
              {customer.paymentTermsDays !== undefined && <><dt>Payment terms</dt><dd>{customer.paymentTermsDays === null ? `Company default (${termsLabel(c.company.invoiceDueDays)})` : termsLabel(customer.paymentTermsDays)}{customer.monthlyStatement ? ' · monthly statement' : ''}</dd></>}
              <dt>Tax</dt><dd>{customer.taxExempt ? <><Pill tone="info">Tax exempt</Pill>{customer.taxExemptNote ? <div className="small muted">{customer.taxExemptNote}</div> : null}</> : 'Charged at each service\'s rate'}</dd>
              <dt>Notes</dt><dd className="pre">{customer.notes || '—'}</dd>
              <dt>Customer since</dt><dd>{fmtDate(customer.createdAt, c.company.timezone)}</dd>
            </dl>
          </Card>
          <Card id="locs" title={<h2 className="row"><MapPin aria-hidden />Service locations</h2>} actions={c.can('customers.edit') && !archived ? <Button size="sm" icon={<Plus aria-hidden />} onClick={() => setLoc({ label: '', address: '', accessInstructions: '', siteContact: '', siteContactPhone: '', custom: {} })}>Add location</Button> : undefined}>
            {locations.length === 0 ? <p className="muted">No locations yet. Jobs need a service location.</p> : (
              <ul className="list">{locations.map((l: any) => (
                <li key={l.id} style={{ padding: '10px 0' }} className="row-between">
                  <span style={{ minWidth: 0 }}><strong>{l.label || 'Location'}</strong><div>{l.address}</div>
                    {l.access_instructions && <div className="small muted">Access: {l.access_instructions}</div>}
                    {(l.site_contact || l.site_contact_phone) && <div className="small muted">Site contact: {[l.site_contact, l.site_contact_phone].filter(Boolean).join(', ')}</div>}
                    {locDefs.filter((f) => l.custom?.[f.key] !== undefined && l.custom?.[f.key] !== '').map((f) => <div key={f.key} className="small muted">{f.label}: {f.type === 'boolean' ? (l.custom[f.key] ? 'Yes' : 'No') : String(l.custom[f.key])}</div>)}</span>
                  {c.can('customers.edit') && !archived && <Button size="sm" variant="ghost" aria-label={`Edit location ${l.label || l.address}`} onClick={() => setLoc({ id: l.id, label: l.label, address: l.address, accessInstructions: l.access_instructions, siteContact: l.site_contact, siteContactPhone: l.site_contact_phone ?? '', custom: l.custom ?? {}, openJobs: l.open_jobs ?? 0, updateOpenJobs: false })}>Edit</Button>}
                </li>
              ))}</ul>
            )}
          </Card>
          {c.can('finance.view') && customer.priceOverrides && <CustomerPrices customer={customer} />}
        </div>
        <div className="stack">
          <Card id="upcoming" title={`Upcoming jobs${upcoming.length ? ` (${upcoming.length})` : ''}`}>{upcoming.length === 0 ? <p className="muted">Nothing scheduled.</p> : <ul className="list">{upcoming.map(jobRow)}</ul>}</Card>
          <Card id="past" title="Past jobs">{past.length === 0 ? <p className="muted">No finished jobs yet.</p> : <ul className="list">{past.map(jobRow)}</ul>}</Card>
          {c.can('finance.view') && c.can('invoices.view') && <CustomerAccount customerId={customer.id} />}
          {invoices && <Card id="invs" title="Invoices" actions={c.can('invoices.edit') && c.can('finance.view') && !archived ? <LinkButton size="sm" to={c.to(`invoices/new?customer=${customer.id}`)} icon={<Plus aria-hidden />}>New invoice</LinkButton> : undefined}>{invoices.length === 0 ? <p className="muted">No invoices yet.</p> : <ul className="list">{invoices.map((i: any) => <li key={i.id} className="row-between" style={{ padding: '8px 0' }}><Link to={c.to(`invoices/${i.id}`)}>{i.number ?? 'Draft'}</Link><span className="row">{i.total_minor !== null ? <span className="num">{formatMoney(i.total_minor, i.currency)}</span> : null}{i.status === 'issued' || i.status === 'void' ? <PaymentPill payment={i.payment} /> : <InvoiceStatus status={i.status} />}</span></li>)}</ul>}</Card>}
          {messages && <Card id="conv" title="Conversation">{messages.length === 0 ? <p className="muted">No messages yet.</p> : <ul className="list">{messages.map((m: any) => <li key={m.id} className="row-between" style={{ padding: '8px 0' }}><span>{m.subject}<div className="small muted">{fmtDateTime(m.created_at, c.company.timezone)}</div></span><MessageStatus status={m.status} /></li>)}</ul>}</Card>}
          {c.can('customers.edit') && !mergedInto && (
            <Card id="manage" title="Duplicates and archiving">
              <div className="stack">
                {mergedFrom.length > 0 && <div className="stack-sm"><span className="label">Merged into this customer</span><ul className="list">{mergedFrom.map((m: any) => (
                  <li key={m.id} className="row-between" style={{ padding: '8px 0' }}><span>{m.name}<div className="small muted">{fmtDateTime(m.created_at, c.company.timezone)}{m.undone_at ? ' · undone' : ''}</div></span>
                    {!m.undone_at && m.can_undo && canMerge && <Button size="sm" busy={act.busy} onClick={() => act.run('undo', m.id)}>Undo merge</Button>}</li>
                ))}</ul></div>}
                {!archived && canMerge && <div className="row-between" style={{ gap: 12 }}><span className="small muted">Same customer entered twice? Move the other one's locations, jobs, invoices and messages here. You can undo it for 30 days.</span><Button icon={<Users aria-hidden />} onClick={() => setMerging(true)}>Merge a duplicate</Button></div>}
                {!archived && <div className="row-between" style={{ gap: 12 }}><span className="small muted">No longer a customer? Archiving hides them and keeps their history.</span><Button busy={act.busy} onClick={() => act.run('archive')}>Archive</Button></div>}
                <div className="row-between" style={{ gap: 12 }}><span className="small muted">Added by mistake? Only a customer with no jobs, invoices or messages can be deleted.</span><Button variant="danger" busy={act.busy} onClick={() => act.run('delete')}>Delete</Button></div>
              </div>
            </Card>
          )}
        </div>
      </div>
      {editing && <CustomerDialog open existing={customer} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); qc.invalidateQueries({ queryKey: [c.cid] }); toast('Customer saved'); }} />}
      {merging && <MergeDialog keep={customer} onClose={() => setMerging(false)} />}
      <Dialog open={!!loc} onClose={() => setLoc(null)} title={loc?.id ? 'Edit location' : 'Add location'} footer={<><Button onClick={() => setLoc(null)}>Cancel</Button><Button variant="primary" busy={saveLoc.busy} onClick={() => saveLoc.run()}>Save location</Button></>}>
        {loc && <div className="stack">
          <ErrorSummary error={saveLoc.error} labels={Object.fromEntries(locDefs.map((f) => [`${'custom'}.${f.key}`, `f-loc-custom-${f.key}`]))} />
          <Field label="Address" id="f-address" error={saveLoc.fieldError('address')}>{(p) => <Input {...p} maxLength={300} value={loc.address} onChange={(e) => setLoc({ ...loc, address: e.target.value })} />}</Field>
          <Field label="Label" optionalText id="f-label" hint="For example: Main yard, North lot. Left empty, the street is used.">{(p) => <Input {...p} maxLength={80} value={loc.label} onChange={(e) => setLoc({ ...loc, label: e.target.value })} />}</Field>
          <Field label="Access instructions" optionalText id="f-accessInstructions">{(p) => <Textarea {...p} maxLength={1000} value={loc.accessInstructions} onChange={(e) => setLoc({ ...loc, accessInstructions: e.target.value })} />}</Field>
          <div className="grid-2">
            <Field label="Site contact" optionalText id="f-siteContact">{(p) => <Input {...p} maxLength={200} value={loc.siteContact} onChange={(e) => setLoc({ ...loc, siteContact: e.target.value })} />}</Field>
            {c.can('customers.contact') && <Field label="Site contact phone" optionalText id="f-siteContactPhone" hint="Drivers can call it from the stop.">{(p) => <Input {...p} maxLength={40} type="tel" value={loc.siteContactPhone} onChange={(e) => setLoc({ ...loc, siteContactPhone: e.target.value })} />}</Field>}
          </div>
          {locDefs.map((f) => <DynamicField key={f.key} f={f} idPrefix="loc-custom" value={loc.custom[f.key]} error={saveLoc.fieldError(`custom.${f.key}`)} onChange={(x) => setLoc({ ...loc, custom: { ...loc.custom, [f.key]: x } })} />)}
          {loc.id && <Banner tone="info">Changes apply to new jobs. Finished jobs and issued invoices keep the address they had.</Banner>}
          {loc.id && (loc.openJobs ?? 0) > 0 && <Checkbox label={`Also update the ${loc.openJobs} open job${loc.openJobs === 1 ? '' : 's'} at this location`} hint="Their drivers are told the address changed." checked={!!loc.updateOpenJobs} onChange={(e) => setLoc({ ...loc, updateOpenJobs: e.target.checked })} />}
          <p className="small muted">Addresses are stored as text. "Open in Maps" links are offered to drivers; nothing is geocoded.</p>
        </div>}
      </Dialog>
    </div>
  );
}

/** Merge another customer into this one (D14): pick it, see what moves, confirm. Undo is on the kept customer's page. */
function MergeDialog({ keep, onClose }: { keep: any; onClose: () => void }) {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const [other, setOther] = useState<{ id: string; name: string } | null>(null);
  const preview = useQuery({ queryKey: [c.cid, 'customer', other?.id], queryFn: () => get(`/c/${c.cid}/customers/${other!.id}`), enabled: !!other });
  const s = useSubmit(async () => {
    if (!other) throw Object.assign(new Error('Choose the duplicate to merge into this customer.'), { status: 400 });
    await post(`/c/${c.cid}/customers/${keep.id}/merge`, { mergedId: other.id });
    await qc.invalidateQueries({ queryKey: [c.cid] });
    toast(`${other.name} merged into ${keep.name}. You can undo it from this page for 30 days.`);
    onClose();
  });
  const p = preview.data;
  return (
    <Dialog open onClose={onClose} title={`Merge a duplicate into ${keep.name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={s.busy} disabled={!other || other.id === keep.id} onClick={() => s.run()}>{other ? `Merge ${other.name} into ${keep.name}` : 'Merge'}</Button></>}>
      <div className="stack">
        <ErrorSummary error={s.error} />
        <Field label="Duplicate customer" id="f-merge-other" hint={`${keep.name} is kept. The duplicate is archived and points here.`}>{(fp) => <CustomerPicker id={fp.id} describedBy={fp['aria-describedby']} value={other?.id ?? ''} name={other?.name ?? null} onChange={(cid, cu) => setOther(cid && cu ? { id: cid, name: cu.name } : null)} />}</Field>
        {other?.id === keep.id && <Banner tone="warning">That's this customer. Choose the duplicate.</Banner>}
        {other && other.id !== keep.id && (preview.isLoading ? <LoadingBlock rows={2} /> : p && (
          <div className="approval-summary">
            <strong>What moves to {keep.name}</strong>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>{p.locations.length} service location{p.locations.length === 1 ? '' : 's'}</li>
              <li>{p.jobs.length} job{p.jobs.length === 1 ? '' : 's'}</li>
              {p.invoices && <li>{p.invoices.length} invoice{p.invoices.length === 1 ? '' : 's'} (issued invoices keep the name printed on them)</li>}
              {p.messages && <li>{p.messages.length} message{p.messages.length === 1 ? '' : 's'}</li>}
              <li>Payments, credit and recurring plans</li>
            </ul>
            <span className="small muted">Empty email, phone, billing address and notes on {keep.name} are filled in from {other.name}.</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/**
 * Prices agreed with this customer, replacing the service's rate line by line. Lines left empty use
 * the standard rate. Only people who see finances and edit invoices can change them.
 */
function CustomerPrices({ customer }: { customer: any }) {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const svcs = useQuery({ queryKey: [c.cid, 'services'], queryFn: () => get(`/c/${c.cid}/services`) });
  const canEdit = c.can('invoices.edit') && c.can('customers.edit');
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const cur = c.company.currency;
  const services: any[] = (svcs.data?.services ?? []).filter((s: any) => s.active || customer.priceOverrides[s.id]);
  const custom = Object.values(customer.priceOverrides as Record<string, Record<string, number>>).reduce((n, o) => n + Object.keys(o).length, 0);
  const save = useSubmit(async () => {
    const out: Record<string, Record<string, number>> = {};
    for (const [k, raw] of Object.entries(edit ?? {})) {
      if (raw.trim() === '') continue;
      const rate = parseRate(raw);
      const [sid, lid] = k.split('|');
      const line = services.find((s) => s.id === sid)?.pricing.find((p: any) => p.id === lid);
      if (rate === null) throw Object.assign(new Error(`Enter the price for "${line?.label ?? lid}" like 3.75 or 3.8995, or leave it empty.`), { status: 400 });
      (out[sid] ??= {})[lid] = rate;
    }
    await patch(`/c/${c.cid}/customers/${customer.id}`, { priceOverrides: out, version: customer.version });
    setEdit(null);
    await qc.invalidateQueries({ queryKey: [c.cid, 'customer', customer.id] });
    toast('Customer prices saved. They apply to invoices prepared from now on.');
  });
  const start = () => setEdit(Object.fromEntries(services.flatMap((s) => s.pricing.map((p: any) => [`${s.id}|${p.id}`, rateToInput(customer.priceOverrides[s.id]?.[p.id])]))));
  return (
    <Card id="prices" title="Customer prices" actions={canEdit && !edit ? <Button size="sm" icon={<Pencil aria-hidden />} onClick={start} disabled={!svcs.data}>Edit prices</Button> : undefined}>
      {svcs.isLoading ? <LoadingBlock rows={2} /> : !edit ? (
        custom === 0 ? <p className="muted">Standard prices. Set a price for this customer to replace a service's rate on their invoices.</p> : (
          <ul className="list">{services.flatMap((s) => s.pricing.filter((p: any) => customer.priceOverrides[s.id]?.[p.id] !== undefined).map((p: any) => (
            <li key={`${s.id}|${p.id}`} className="row-between" style={{ padding: '8px 0' }}>
              <span>{p.label}<div className="small muted">{s.name} · standard {formatRate(p.rateE4, cur)}</div></span>
              <span className="num">{formatRate(customer.priceOverrides[s.id][p.id], cur)}{p.basis === 'per_quantity' && p.unit ? ` / ${p.unit}` : ''}</span>
            </li>
          )))}</ul>
        )
      ) : (
        <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); save.run(); }}>
          <ErrorSummary error={save.error} />
          <p className="small muted">Leave a price empty to use the standard rate.</p>
          {services.map((s) => (
            <fieldset key={s.id} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>{s.name}</legend>
              {s.pricing.map((p: any) => (
                <Field key={p.id} label={`${p.label}${p.basis === 'per_quantity' && p.unit ? ` (per ${p.unit})` : ''}`} optionalText id={`f-cp-${s.id}-${p.id}`} hint={`Standard: ${p.rateE4 === null ? 'not set' : formatRate(p.rateE4, cur)}`}>
                  {(pp) => <Input {...pp} inputMode="decimal" value={edit[`${s.id}|${p.id}`] ?? ''} onChange={(e) => setEdit({ ...edit, [`${s.id}|${p.id}`]: e.target.value })} />}
                </Field>
              ))}
            </fieldset>
          ))}
          <div className="form-actions"><Button type="submit" variant="primary" busy={save.busy}>Save prices</Button><Button onClick={() => setEdit(null)}>Cancel</Button></div>
        </form>
      )}
    </Card>
  );
}
