import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users, Pencil, MapPin, Phone, Mail, Navigation, CalendarClock, Wallet, Trash2, Archive, ArchiveRestore, ChevronRight } from 'lucide-react';
import { get, post, patch, del } from '../lib/api';
import { useWorkspace } from '../lib/session';
import { useSubmit } from '../lib/form';
import { useTitle } from '../lib/title';
import { fmtDateTime, fmtDate, mapsUrl } from '../lib/format';
import { PageHeader, Button, LinkButton, StageBadge, Empty, Loading, ErrorState, TextField, TextArea, FormError, Money, Dialog, Banner, Check, useToast, Badge, fieldErrors, Confirm } from '../components/ui';
import { FieldInput, FieldValues } from '../components/fields';
import type { Meaning } from '../../shared/workspace';

// Customers (in the workspace's words): contacts, places and history. Each customer's page leads with
// the next visit and what they owe. Contact details and amounts arrive only for roles allowed them.

export function Customers() {
  const ws = useWorkspace();
  const C = ws.words.customer;
  useTitle(C.many, ws.workspace.name);
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const archived = sp.get('archived') === '1';
  useEffect(() => { const t = setTimeout(() => { const n = new URLSearchParams(sp); if (q.trim()) n.set('q', q.trim()); else n.delete('q'); setSp(n, { replace: true }); }, 250); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = useQuery({ queryKey: [ws.cid, 'customers', sp.toString()], queryFn: () => get<{ customers: any[] }>(`/c/${ws.cid}/customers?${sp}`) });
  const money = ws.can('money.view');
  return (
    <div className="page">
      <PageHeader title={C.many}>
        {ws.can('customers.edit') && <LinkButton to={ws.to('customers/new')} variant="primary" icon={<Plus size={18} aria-hidden="true" />}>New {C.one.toLowerCase()}</LinkButton>}
      </PageHeader>
      <div className="row" style={{ alignItems: 'end' }}>
        <TextField className="grow" label="Search" type="search" placeholder={`Name or address${ws.can('customers.contact') ? ' or phone' : ''}`} value={q} onChange={(e) => setQ(e.target.value)} />
        <Check label="Show archived" checked={archived} onChange={(e) => { const n = new URLSearchParams(sp); if (e.target.checked) n.set('archived', '1'); else n.delete('archived'); setSp(n, { replace: true }); }} />
      </div>
      {r.isLoading ? <Loading /> : r.error ? <ErrorState error={r.error} retry={() => r.refetch()} /> : !r.data!.customers.length ? (
        <div className="card"><Empty icon={<Users />} title={q ? `No ${C.many.toLowerCase()} match “${q}”` : `No ${C.many.toLowerCase()} yet`}
          action={!q && ws.can('customers.edit') ? <LinkButton to={ws.to('customers/new')} variant="primary" icon={<Plus size={18} aria-hidden="true" />}>New {C.one.toLowerCase()}</LinkButton> : undefined}>
          {q ? 'Try part of the name or the street.' : `Add your first ${C.one.toLowerCase()}. Requests from your booking page add them too.`}</Empty></div>
      ) : (
        <div className="card card-flush"><ul className="divider-list">
          {r.data!.customers.map((c) => (
            <li key={c.id}><Link className="list-row" to={ws.to(`customers/${c.id}`)}>
              <span className="row-main">
                <span className="row-title">{c.name}</span>
                <span className="row-sub">{[c.address, c.next ? `Next: ${fmtDateTime(c.next.starts_at, ws.workspace.timezone)}` : null].filter(Boolean).join(' · ') || 'No places yet'}</span>
              </span>
              {money && <span className="row-end">{c.overdueMinor > 0 ? <Badge tone="attn">Overdue <Money minor={c.overdueMinor} currency={ws.workspace.currency} /></Badge> : c.owesMinor > 0 ? <span className="small">Owes <Money minor={c.owesMinor} currency={ws.workspace.currency} /></span> : null}</span>}
              <ChevronRight className="chev" aria-hidden="true" />
            </Link></li>
          ))}
        </ul></div>
      )}
    </div>
  );
}

export function CustomerDetail() {
  const ws = useWorkspace();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const C = ws.words.customer;
  const r = useQuery({ queryKey: [ws.cid, 'customer', id], queryFn: () => get<any>(`/c/${ws.cid}/customers/${id}`) });
  const [placeOpen, setPlaceOpen] = useState<any>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  useTitle(r.data?.customer.name ?? C.one, ws.workspace.name);
  const refresh = () => qc.invalidateQueries({ queryKey: [ws.cid] });
  if (r.isLoading) return <div className="page"><Loading /></div>;
  if (r.error) return <div className="page"><ErrorState error={r.error} retry={() => r.refetch()} /></div>;
  const d = r.data;
  const c = d.customer;
  const tz = ws.workspace.timezone;
  const money = ws.can('money.view');
  return (
    <div className="page">
      <PageHeader back={{ to: ws.to('customers'), label: C.many }} title={c.name} eyebrow={c.archived_at ? <Badge tone="cancelled">Archived</Badge> : undefined}>
        {ws.can('work.create') && !c.archived_at && <LinkButton to={ws.to(`work/new?customer=${id}`)} variant="primary" icon={<Plus size={18} aria-hidden="true" />}>New {ws.words.work.one.toLowerCase()}</LinkButton>}
        {ws.can('customers.edit') && <LinkButton to={ws.to(`customers/${id}/edit`)} icon={<Pencil size={18} aria-hidden="true" />}>Edit</LinkButton>}
      </PageHeader>

      <div className="facts">
        <div className="fact">
          <span className="label row"><CalendarClock size={16} aria-hidden="true" />Next {ws.words.work.one.toLowerCase()}</span>
          {d.next ? <><Link to={ws.to(`work/${d.next.id}`)} className="value" style={{ fontSize: '1.25rem' }}>{fmtDateTime(d.next.starts_at, tz)}</Link><span className="sub">{d.next.title || `#${d.next.number}`}</span></> : <span className="value muted" style={{ fontSize: '1.25rem' }}>Nothing booked</span>}
        </div>
        {money && (
          <div className="fact">
            <span className="label row"><Wallet size={16} aria-hidden="true" />Owes</span>
            <Money className="value mono" minor={d.owesMinor} currency={ws.workspace.currency} />
            <span className="sub">{d.overdueMinor > 0 ? <><Money minor={d.overdueMinor} currency={ws.workspace.currency} /> overdue</> : 'Nothing overdue'}</span>
          </div>
        )}
      </div>

      <div className="grid-2">
        <section className="card stack" aria-labelledby="c-contact">
          <div className="row-between"><h2 id="c-contact">Contact</h2>{ws.can('customers.edit') && ws.can('customers.contact') && <Button size="sm" onClick={() => setContactOpen(true)} icon={<Plus size={16} aria-hidden="true" />}>Add a person</Button>}</div>
          {ws.can('customers.contact') ? (
            <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {c.phone && <li className="row"><Phone size={16} aria-hidden="true" /><a href={`tel:${c.phone}`}>{c.phone}</a></li>}
              {c.email && <li className="row"><Mail size={16} aria-hidden="true" /><a href={`mailto:${c.email}`} className="wrap-anywhere">{c.email}</a></li>}
              {!c.phone && !c.email && <li className="muted small">No phone or email yet.</li>}
              {d.contacts.map((k: any) => (
                <li key={k.id} className="card soft row-between">
                  <span><strong>{k.name}</strong>{k.label && <span className="muted small"> · {k.label}</span>}<br /><span className="small">{[k.phone, k.email].filter(Boolean).join(' · ')}</span></span>
                  {ws.can('customers.edit') && <Button variant="ghost" className="icon-btn" aria-label={`Remove ${k.name}`} onClick={async () => { await del(`/c/${ws.cid}/customers/${id}/contacts/${k.id}`); void refresh(); }}><Trash2 size={18} /></Button>}
                </li>
              ))}
            </ul>
          ) : <p className="small muted">Your role doesn’t show contact details.</p>}
          {c.notes && <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</p>}
          <FieldValues defs={ws.fields.customer} values={c.fields} currency={ws.workspace.currency} />
          {money && c.taxExempt && <Badge tone="good">Tax exempt</Badge>}
        </section>
        <section className="card stack" aria-labelledby="c-places">
          <div className="row-between"><h2 id="c-places">{ws.words.location.many}</h2>{ws.can('customers.edit') && <Button size="sm" onClick={() => setPlaceOpen({})} icon={<Plus size={16} aria-hidden="true" />}>Add</Button>}</div>
          {!d.places.length ? <p className="muted small">No {ws.words.location.many.toLowerCase()} yet.</p> : (
            <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {d.places.map((p: any) => (
                <li key={p.id} className="card soft stack-sm">
                  <div className="row-between"><strong className="row"><MapPin size={16} aria-hidden="true" />{p.label || ws.words.location.one}</strong>{ws.can('customers.edit') && <Button size="sm" variant="ghost" onClick={() => setPlaceOpen(p)}>Edit</Button>}</div>
                  <span>{p.address}</span>
                  {p.notes && <span className="small muted">{p.notes}</span>}
                  <a href={mapsUrl(p.address)} target="_blank" rel="noreferrer" className="small"><Navigation size={14} aria-hidden="true" /> Open in Maps</a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {money && d.invoices?.length > 0 && (
        <section className="card card-flush" aria-labelledby="c-inv">
          <div className="card-head" style={{ padding: '16px 20px 0' }}><h2 id="c-inv">Invoices</h2></div>
          <ul className="divider-list">
            {d.invoices.map((i: any) => (
              <li key={i.id}><Link className="list-row" to={ws.to(`money/invoices/${i.id}`)}>
                <span className="row-main"><span className="row-title">{i.number ?? (i.status === 'held' ? 'Held invoice' : 'Draft invoice')}</span><span className="row-sub">{i.issued_on ? `Issued ${fmtDate(i.issued_on)} · due ${fmtDate(i.due_on)}` : 'Not issued'}</span></span>
                <span className="row-end"><Money minor={i.total_minor} currency={ws.workspace.currency} /></span>
              </Link></li>
            ))}
          </ul>
        </section>
      )}

      <section className="card card-flush" aria-labelledby="c-hist">
        <div className="card-head" style={{ padding: '16px 20px 0' }}><h2 id="c-hist">History</h2></div>
        {!d.history.length ? <p className="muted" style={{ padding: 20 }}>No {ws.words.work.many.toLowerCase()} yet.</p> : (
          <ul className="divider-list">
            {d.history.map((h: any) => (
              <li key={h.id}><Link className="list-row" to={ws.to(`work/${h.id}`)}>
                <span className="mono muted" style={{ width: 52 }}>#{h.number}</span>
                <span className="row-main"><span className="row-title">{h.title || ws.words.work.one}</span><span className="row-sub">{[h.starts_at ? fmtDateTime(h.starts_at, tz) : 'No time set', h.address].filter(Boolean).join(' · ')}</span></span>
                <StageBadge name={h.stage_name} meaning={h.meaning as Meaning} />
              </Link></li>
            ))}
          </ul>
        )}
      </section>

      {ws.can('customers.edit') && (
        <div>{c.archived_at
          ? <Button icon={<ArchiveRestore size={18} aria-hidden="true" />} onClick={async () => { await post(`/c/${ws.cid}/customers/${id}/unarchive`); toast('Restored.'); void refresh(); }}>Restore</Button>
          : <Button variant="ghost" icon={<Archive size={18} aria-hidden="true" />} onClick={() => setArchiving(true)}>Archive</Button>}</div>
      )}
      {archiving && <Confirm title={`Archive ${c.name}?`} body={`They leave the list and search. Their history and invoices stay, and you can restore them any time.`} confirm="Archive" onClose={() => setArchiving(false)}
        onConfirm={async () => { await post(`/c/${ws.cid}/customers/${id}/archive`); setArchiving(false); toast('Archived.'); void refresh(); }} />}
      {placeOpen && <PlaceDialog customerId={id} place={placeOpen.id ? placeOpen : null} onClose={() => setPlaceOpen(null)} onDone={() => { setPlaceOpen(null); void refresh(); }} />}
      {contactOpen && <ContactDialog customerId={id} onClose={() => setContactOpen(false)} onDone={() => { setContactOpen(false); void refresh(); }} />}
    </div>
  );
}

function PlaceDialog({ customerId, place, onClose, onDone }: { customerId: string; place: any | null; onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const [v, setV] = useState({ label: place?.label ?? '', address: place?.address ?? '', notes: place?.notes ?? '' });
  const save = useSubmit(async () => {
    if (place) await patch(`/c/${ws.cid}/customers/${customerId}/places/${place.id}`, v);
    else await post(`/c/${ws.cid}/customers/${customerId}/places`, v);
    onDone();
  });
  const remove = useSubmit(async () => { await del(`/c/${ws.cid}/customers/${customerId}/places/${place.id}`); onDone(); });
  return (
    <Dialog title={place ? `Edit ${ws.words.location.one.toLowerCase()}` : `Add a ${ws.words.location.one.toLowerCase()}`} onClose={onClose} actions={<>
      <Button variant="primary" busy={save.busy} onClick={() => void save.run()}>Save</Button>
      {place && <Button variant="danger" busy={remove.busy} onClick={() => void remove.run()}>Remove</Button>}
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
    </>}>
      <FormError error={save.error ?? remove.error} />
      <TextField label="Address" value={v.address} maxLength={300} onChange={(e) => setV({ ...v, address: e.target.value })} error={save.fieldError('address')} />
      <TextField label="Name" optional hint="For example, Main shop or Lake house." value={v.label} maxLength={60} onChange={(e) => setV({ ...v, label: e.target.value })} />
      <TextArea label="Notes for whoever goes there" optional hint="Gate codes, parking, pets." value={v.notes} maxLength={1000} rows={2} onChange={(e) => setV({ ...v, notes: e.target.value })} />
    </Dialog>
  );
}

function ContactDialog({ customerId, onClose, onDone }: { customerId: string; onClose: () => void; onDone: () => void }) {
  const ws = useWorkspace();
  const [v, setV] = useState({ name: '', label: '', email: '', phone: '' });
  const save = useSubmit(async () => { await post(`/c/${ws.cid}/customers/${customerId}/contacts`, v); onDone(); });
  return (
    <Dialog title="Add a person to reach" onClose={onClose} actions={<><Button variant="primary" busy={save.busy} onClick={() => void save.run()}>Add</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></>}>
      <FormError error={save.error} />
      <TextField label="Name" value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} error={save.fieldError('name')} />
      <TextField label="Who they are" optional hint="For example, Billing or Site manager." value={v.label} maxLength={40} onChange={(e) => setV({ ...v, label: e.target.value })} />
      <TextField label="Phone" optional type="tel" value={v.phone} maxLength={40} onChange={(e) => setV({ ...v, phone: e.target.value })} />
      <TextField label="Email" optional type="email" value={v.email} maxLength={254} onChange={(e) => setV({ ...v, email: e.target.value })} error={save.fieldError('email')} />
    </Dialog>
  );
}

export function CustomerForm() {
  const ws = useWorkspace();
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const C = ws.words.customer;
  useTitle(id ? `Edit ${C.one.toLowerCase()}` : `New ${C.one.toLowerCase()}`, ws.workspace.name);
  const existing = useQuery({ queryKey: [ws.cid, 'customer', id], queryFn: () => get<any>(`/c/${ws.cid}/customers/${id}`), enabled: !!id });
  const [v, setV] = useState({ name: '', email: '', phone: '', notes: '', taxExempt: false });
  const [place, setPlace] = useState({ label: '', address: '', notes: '' });
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [dups, setDups] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    const c = existing.data?.customer;
    if (c) { setV({ name: c.name, email: c.email ?? '', phone: c.phone ?? '', notes: c.notes ?? '', taxExempt: !!c.taxExempt }); setFields(c.fields ?? {}); }
  }, [existing.data]);
  const save = useSubmit(async (allowDuplicate?: boolean) => {
    if (id) {
      await patch(`/c/${ws.cid}/customers/${id}`, { ...v, fields, version: existing.data.customer.version });
      await qc.invalidateQueries({ queryKey: [ws.cid] });
      nav(ws.to(`customers/${id}`));
      return;
    }
    try {
      const r = await post<{ id: string }>(`/c/${ws.cid}/customers`, { ...v, fields, place: place.address.trim() ? place : undefined, allowDuplicate: !!allowDuplicate });
      await qc.invalidateQueries({ queryKey: [ws.cid] });
      nav(ws.to(`customers/${r.id}`));
    } catch (e: any) {
      if (e?.details?.needsConfirm === 'duplicate') { setDups(e.details.duplicates); return; }
      throw e;
    }
  });
  const errs = fieldErrors(save.error);
  if (id && existing.isLoading) return <div className="page"><Loading /></div>;
  return (
    <div className="page page-narrow">
      <PageHeader back={{ to: id ? ws.to(`customers/${id}`) : ws.to('customers'), label: id ? existing.data?.customer.name : C.many }} title={id ? `Edit ${C.one.toLowerCase()}` : `New ${C.one.toLowerCase()}`} />
      <form className="stack-lg" onSubmit={(e) => { e.preventDefault(); void save.run(); }} noValidate>
        <FormError error={save.error} />
        {dups && (
          <Banner tone="attn" title={`You may already have ${dups[0].name}`} action={<Button size="sm" onClick={() => { setDups(null); void save.run(true); }}>Add anyway</Button>}>
            {dups.map((d, i) => <span key={d.id}>{i ? ', ' : ''}<Link to={ws.to(`customers/${d.id}`)}>{d.name}</Link></span>)}
          </Banner>
        )}
        <section className="card stack">
          <TextField label="Name" value={v.name} maxLength={120} autoFocus onChange={(e) => setV({ ...v, name: e.target.value })} error={errs.name} />
          {ws.can('customers.contact') && (
            <div className="grid-2">
              <TextField label="Phone" optional type="tel" value={v.phone} maxLength={40} onChange={(e) => setV({ ...v, phone: e.target.value })} error={errs.phone} />
              <TextField label="Email" optional type="email" value={v.email} maxLength={254} onChange={(e) => setV({ ...v, email: e.target.value })} error={errs.email} />
            </div>
          )}
          {ws.can('money.view') && <Check label="Tax exempt" hint="Invoices for them never add tax." checked={v.taxExempt} onChange={(e) => setV({ ...v, taxExempt: e.target.checked })} />}
        </section>
        {!id && (
          <section className="card stack">
            <h2>{ws.words.location.one}</h2>
            <TextField label="Address" optional value={place.address} maxLength={300} onChange={(e) => setPlace({ ...place, address: e.target.value })} error={errs['place.address']} />
            <TextArea label="Notes for whoever goes there" optional hint="Gate codes, parking, pets." value={place.notes} maxLength={1000} rows={2} onChange={(e) => setPlace({ ...place, notes: e.target.value })} />
          </section>
        )}
        {ws.fields.customer.length > 0 && (
          <section className="card stack"><h2>Details</h2>
            {ws.fields.customer.filter((f) => ws.can('customers.contact') || (f.type !== 'phone' && f.type !== 'email')).map((f) => <FieldInput key={f.key} def={f} value={fields[f.key]} onChange={(x) => setFields({ ...fields, [f.key]: x })} error={errs[f.key]} />)}
          </section>
        )}
        <section className="card stack"><TextArea label="Notes" optional value={v.notes} maxLength={2000} rows={3} onChange={(e) => setV({ ...v, notes: e.target.value })} /></section>
        <div className="form-actions">
          <Button type="submit" variant="primary" size="lg" busy={save.busy}>{id ? 'Save changes' : `Add ${C.one.toLowerCase()}`}</Button>
          <LinkButton variant="ghost" to={id ? ws.to(`customers/${id}`) : ws.to('customers')}>Cancel</LinkButton>
        </div>
      </form>
    </div>
  );
}
