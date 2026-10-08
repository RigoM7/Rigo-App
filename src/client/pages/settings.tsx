import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, MessageSquareText, Layers, ListPlus, Users, ShieldCheck, Bot, Globe, LayoutTemplate, Wrench, UserRound, ChevronRight, Plus, Trash2, ArrowUp, ArrowDown, Copy, ExternalLink, Wallet } from 'lucide-react';
import { get, post, put, patch, del } from '../lib/api';
import { useWorkspace, refreshMe } from '../lib/session';
import { useSubmit } from '../lib/form';
import { useTitle } from '../lib/title';
import { PageHeader, Button, LinkButton, Loading, ErrorState, TextField, TextArea, SelectField, FormError, Banner, Badge, Check, useToast, Dialog, Empty, StageBadge } from '../components/ui';
import { WORD_KEYS, WORD_HINTS, MEANINGS, MEANING_KEYS, FIELD_TYPES, fieldKey, stageProblems, type Vocabulary, type StageDef, type FieldDef, type RecordKind, type Meaning, type FieldType } from '../../shared/workspace';
import { CURRENCIES } from '../../shared/money';
import { COMMON_TIMEZONES, TIMEZONE_NAMES } from '../../shared/timezones';
import { DAY_NAMES } from '../../shared/hours';

// Settings: everything an owner configures, as validated data. Each section shows only to roles that
// can change it.

export function Settings() {
  const ws = useWorkspace();
  useTitle('Settings', ws.workspace.name);
  const owner = ws.role.isOwner;
  const sections = [
    { to: 'settings/workspace', icon: <Building2 />, title: 'Workspace', sub: 'Name, time zone, currency', show: ws.can('workspace.settings') },
    { to: 'settings/words', icon: <MessageSquareText />, title: 'Your words', sub: `${ws.words.work.many}, ${ws.words.customer.many}, ${ws.words.person.many}`, show: ws.can('workspace.settings') },
    { to: 'settings/stages', icon: <Layers />, title: 'Stages', sub: ws.stages.map((s) => s.name).join(' → '), show: ws.can('workspace.settings') },
    { to: 'settings/fields', icon: <ListPlus />, title: 'Fields', sub: 'The extra information you keep', show: ws.can('workspace.settings') },
    { to: 'settings/people', icon: <Users />, title: ws.words.person.many, sub: 'Invite people, change roles', show: ws.can('members.view') },
    { to: 'settings/roles', icon: <ShieldCheck />, title: 'Roles', sub: 'What each role sees and does', show: owner },
    { to: 'settings/automation', icon: <Bot />, title: 'Automation', sub: 'How much Rigo does on its own; pause', show: ws.can('automation.manage') || ws.can('automation.control') },
    { to: 'money/prices', icon: <Wallet />, title: 'Prices and invoices', sub: 'Price list, tax, numbering', show: ws.can('catalog.manage') },
    { to: 'settings/booking', icon: <Globe />, title: 'Booking page', sub: 'Let customers ask for work or book a time', show: ws.can('requests.manage') },
    { to: 'settings/equipment', icon: <Wrench />, title: ws.words.equipment.many, sub: 'What you assign to work', show: ws.equipment && ws.can('equipment.manage') },
    { to: 'settings/templates', icon: <LayoutTemplate />, title: 'Templates', sub: 'Share your setup with other businesses', show: ws.can('templates.manage') && ws.workspace.kind === 'real' },
  ].filter((s) => s.show);
  return (
    <div className="page page-narrow">
      <PageHeader title="Settings" sub={`You are ${owner ? 'an owner' : ws.role.name} in ${ws.workspace.name}.`} />
      <div className="card card-flush"><ul className="divider-list">
        {sections.map((s) => (
          <li key={s.to}><Link className="list-row" to={ws.to(s.to)}>
            <span aria-hidden="true" style={{ color: 'var(--primary-text)' }}>{s.icon}</span>
            <span className="row-main"><span className="row-title">{s.title}</span><span className="row-sub">{s.sub}</span></span>
            <ChevronRight className="chev" aria-hidden="true" />
          </Link></li>
        ))}
        <li><Link className="list-row" to="/account"><span aria-hidden="true" style={{ color: 'var(--primary-text)' }}><UserRound /></span><span className="row-main"><span className="row-title">Your account</span><span className="row-sub">Name, password, email, theme</span></span><ChevronRight className="chev" aria-hidden="true" /></Link></li>
      </ul></div>
    </div>
  );
}

function OnlyIf({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const ws = useWorkspace();
  if (!ok) return <div className="page"><ErrorState error={{ status: 403, message: `Your role (${ws.role.name}) can't change this.` }} /></div>;
  return <>{children}</>;
}

export function SettingsWorkspace() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  useTitle('Workspace', ws.workspace.name);
  const w = ws.workspace;
  const [v, setV] = useState({ name: w.name, description: w.description, timezone: w.timezone, currency: w.currency });
  const [danger, setDanger] = useState<null | 'archive' | 'delete'>(null);
  const [typed, setTyped] = useState('');
  const save = useSubmit(async () => { await patch(`/c/${ws.cid}/settings`, v); toast('Saved.'); ws.refresh(); await refreshMe(qc); });
  const act = useSubmit(async () => {
    await post(`/c/${ws.cid}/${danger}`, { confirmName: typed });
    await refreshMe(qc);
    toast(danger === 'archive' ? 'Archived. Restore it from here any time.' : 'Deleted.');
    if (danger === 'delete') nav('/workspaces'); else { setDanger(null); ws.refresh(); }
  });
  return (
    <OnlyIf ok={ws.can('workspace.settings')}>
      <div className="page page-narrow">
        <PageHeader back={{ to: ws.to('settings'), label: 'Settings' }} title="Workspace" />
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); void save.run(); }} noValidate>
          <FormError error={save.error} />
          <TextField label="Name" value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} error={save.fieldError('name')} />
          <TextArea label="What the business does" optional value={v.description} maxLength={300} rows={2} onChange={(e) => setV({ ...v, description: e.target.value })} />
          <div className="grid-2">
            <SelectField label="Time zone" hint="Every time in Rigo is shown in it." value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>
              {[...new Set([v.timezone, ...COMMON_TIMEZONES])].map((z) => <option key={z} value={z}>{TIMEZONE_NAMES[z] ?? z}</option>)}
            </SelectField>
            <SelectField label="Currency" value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</SelectField>
          </div>
          <div><Button type="submit" variant="primary" busy={save.busy}>Save</Button></div>
        </form>
        {ws.role.isOwner && w.kind === 'real' && (
          <section className="card stack" aria-labelledby="dz">
            <h2 id="dz">Archive or delete</h2>
            {w.archivedAt ? (
              <><p>This workspace is archived.</p><div><Button onClick={async () => { await post(`/c/${ws.cid}/unarchive`); ws.refresh(); toast('Restored.'); }}>Restore it</Button></div></>
            ) : (
              <>
                <p className="muted">Archiving keeps everything but stops sending. Deleting is only for a workspace you tried out: anything with issued invoices or payments is kept.</p>
                <div className="row"><Button onClick={() => { setDanger('archive'); setTyped(''); }}>Archive</Button><Button variant="danger" onClick={() => { setDanger('delete'); setTyped(''); }}>Delete</Button></div>
              </>
            )}
          </section>
        )}
        {danger && (
          <Dialog title={danger === 'archive' ? `Archive ${w.name}?` : `Delete ${w.name}?`} onClose={() => setDanger(null)} actions={<>
            <Button variant="danger" busy={act.busy} onClick={() => void act.run()}>{danger === 'archive' ? 'Archive' : 'Delete for good'}</Button>
            <Button variant="ghost" onClick={() => setDanger(null)}>Keep it</Button>
          </>}>
            <p className="muted">{danger === 'delete' ? 'Everything in it is removed. This can’t be undone.' : 'Nothing is lost. You can restore it later.'}</p>
            <FormError error={act.error} />
            <TextField label={`Type ${w.name} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} error={act.fieldError('confirmName')} />
          </Dialog>
        )}
      </div>
    </OnlyIf>
  );
}

const WORD_LABELS: Record<string, string> = { work: 'Main record', customer: 'Customers', person: 'Team', equipment: 'Equipment', location: 'Places' };

export function SettingsWords() {
  const ws = useWorkspace();
  const toast = useToast();
  useTitle('Your words', ws.workspace.name);
  const [v, setV] = useState<Vocabulary>(JSON.parse(JSON.stringify(ws.words)));
  const save = useSubmit(async () => { await put(`/c/${ws.cid}/words`, { words: v }); toast('Saved. Every screen uses the new words.'); ws.refresh(); });
  return (
    <OnlyIf ok={ws.can('workspace.settings')}>
      <div className="page page-narrow">
        <PageHeader back={{ to: ws.to('settings'), label: 'Settings' }} title="Your words" sub="The names your business uses. Menus, buttons and messages follow them." />
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); void save.run(); }} noValidate>
          <FormError error={save.error} />
          {WORD_KEYS.map((k) => (
            <fieldset key={k} className="stack-sm">
              <legend>{WORD_LABELS[k]} <span className="small muted" style={{ fontWeight: 400 }}>· {WORD_HINTS[k]}</span></legend>
              <div className="input-group">
                <TextField label="One" value={v[k].one} maxLength={30} onChange={(e) => setV({ ...v, [k]: { ...v[k], one: e.target.value } })} error={save.fieldError(`words.${k}.one`)} />
                <TextField label="Many" value={v[k].many} maxLength={30} onChange={(e) => setV({ ...v, [k]: { ...v[k], many: e.target.value } })} error={save.fieldError(`words.${k}.many`)} />
              </div>
            </fieldset>
          ))}
          <div><Button type="submit" variant="primary" busy={save.busy}>Save words</Button></div>
        </form>
      </div>
    </OnlyIf>
  );
}

export function SettingsStages() {
  const ws = useWorkspace();
  const toast = useToast();
  useTitle('Stages', ws.workspace.name);
  const counts = useQuery({ queryKey: [ws.cid, 'stages'], queryFn: () => get<{ stages: any[] }>(`/c/${ws.cid}/stages`) });
  const [list, setList] = useState<(StageDef & { inUse?: number })[]>(ws.stages.map((s) => ({ key: s.key, name: s.name, meaning: s.meaning, requires: s.requires, ...(s.next ? { next: s.next } : {}) })));
  const save = useSubmit(async () => { await put(`/c/${ws.cid}/stages`, { stages: list.map(({ inUse, ...s }) => s) }); toast('Stages saved.'); ws.refresh(); void counts.refetch(); });
  const problems = stageProblems(list, ws.fields.work);
  const up = (i: number, p: Partial<StageDef>) => setList(list.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: number) => { const n = [...list]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setList(n); };
  const inUse = (key: string) => counts.data?.stages.find((s) => s.key === key)?.inUse ?? 0;
  return (
    <OnlyIf ok={ws.can('workspace.settings')}>
      <div className="page page-narrow">
        <PageHeader back={{ to: ws.to('settings'), label: 'Settings' }} title="Stages" sub={`The steps a ${ws.words.work.one.toLowerCase()} goes through. Each says what it means, so Rigo knows what is open, being done, finished (billable), cancelled or failed.`} />
        <FormError error={save.error} />
        <ol className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {list.map((s, i) => (
            <li key={s.key} className="card stack-sm">
              <div className="row-between"><StageBadge name={s.name || 'Unnamed'} meaning={s.meaning} />
                <div className="row">
                  <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${s.name} up`}><ArrowUp size={16} /></Button>
                  <Button size="sm" variant="ghost" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${s.name} down`}><ArrowDown size={16} /></Button>
                  <Button size="sm" variant="ghost" disabled={inUse(s.key) > 0} title={inUse(s.key) ? 'Move its work to another stage first' : undefined} onClick={() => setList(list.filter((_, j) => j !== i).map((x) => (x.next ? { ...x, next: x.next.filter((k) => k !== s.key) } : x)))} aria-label={`Remove ${s.name}`}><Trash2 size={16} /></Button>
                </div>
              </div>
              <div className="input-group" style={{ flexWrap: 'wrap' }}>
                <TextField label="Name" value={s.name} maxLength={40} onChange={(e) => up(i, { name: e.target.value })} />
                <SelectField label="Means" value={s.meaning} onChange={(e) => up(i, { meaning: e.target.value as Meaning })}>
                  {MEANING_KEYS.map((m) => <option key={m} value={m}>{MEANINGS[m].label}: {MEANINGS[m].hint}</option>)}
                </SelectField>
              </div>
              {ws.fields.work.length > 0 && (
                <SelectField label="Needs this filled in first" optional value={s.requires?.[0] ?? ''} onChange={(e) => up(i, { requires: e.target.value ? [e.target.value] : [] })}>
                  <option value="">Nothing</option>
                  {ws.fields.work.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </SelectField>
              )}
              <Check label="Work here can move to any stage" hint="Untick to choose which stages come next." checked={!s.next} onChange={(e) => up(i, { next: e.target.checked ? undefined : list.filter((x) => x.key !== s.key).map((x) => x.key) })} />
              {s.next && (
                <fieldset className="row" style={{ gap: 4 }}><legend className="small">Can move to</legend>
                  {list.filter((x) => x.key !== s.key).map((x) => <Check key={x.key} label={x.name} checked={s.next!.includes(x.key)} onChange={(e) => up(i, { next: e.target.checked ? [...s.next!, x.key] : s.next!.filter((k) => k !== x.key) })} />)}
                </fieldset>
              )}
              {inUse(s.key) > 0 && <span className="tiny muted">{inUse(s.key)} {inUse(s.key) === 1 ? ws.words.work.one.toLowerCase() : ws.words.work.many.toLowerCase()} here now</span>}
            </li>
          ))}
        </ol>
        <div><Button icon={<Plus size={18} aria-hidden="true" />} onClick={() => setList([...list, { key: fieldKey('New stage', list.map((x) => x.key)), name: 'New stage', meaning: 'open' }])}>Add a stage</Button></div>
        {problems.length > 0 && <Banner tone="attn" title="Before you save">{problems[0]}</Banner>}
        <div className="form-actions"><Button variant="primary" size="lg" busy={save.busy} disabled={problems.length > 0} onClick={() => void save.run()}>Save stages</Button></div>
      </div>
    </OnlyIf>
  );
}

export function SettingsFields() {
  const ws = useWorkspace();
  const toast = useToast();
  useTitle('Fields', ws.workspace.name);
  const [kind, setKind] = useState<RecordKind>('work');
  const [list, setList] = useState<FieldDef[]>(ws.fields[kind]);
  useEffect(() => { setList(ws.fields[kind]); }, [kind, ws.fields]);
  const save = useSubmit(async () => { await put(`/c/${ws.cid}/fields/${kind}`, { fields: list }); toast('Fields saved.'); ws.refresh(); });
  const up = (i: number, p: Partial<FieldDef>) => setList(list.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const name = { work: ws.words.work.many, customer: ws.words.customer.many, equipment: ws.words.equipment.many };
  return (
    <OnlyIf ok={ws.can('workspace.settings')}>
      <div className="page page-narrow">
        <PageHeader back={{ to: ws.to('settings'), label: 'Settings' }} title="Fields" sub="Extra information you keep. Phone and email fields are hidden from roles without contact access; amounts from roles without money access." />
        <div className="segmented" role="group" aria-label="Which record">
          {(['work', 'customer', ...(ws.equipment ? ['equipment'] : [])] as RecordKind[]).map((k) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{name[k]}</button>)}
        </div>
        <FormError error={save.error} />
        {!list.length && <div className="card"><Empty icon={<ListPlus />} title="No extra fields yet">Add one for anything you always need to know.</Empty></div>}
        {list.map((f, i) => (
          <div key={i} className="card stack-sm">
            <div className="input-group" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
              <TextField label="Label" value={f.label} maxLength={60} onChange={(e) => up(i, { label: e.target.value })} />
              <SelectField label="Kind" value={f.type} onChange={(e) => up(i, { type: e.target.value as FieldType })}>
                {Object.entries(FIELD_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </SelectField>
              <Button variant="ghost" className="icon-btn" aria-label={`Remove ${f.label}`} onClick={() => setList(list.filter((_, j) => j !== i))} style={{ flex: '0 0 auto' }}><Trash2 size={18} /></Button>
            </div>
            {f.type === 'choice' && <TextField label="Choices" hint="Separate them with commas." value={(f.options ?? []).join(', ')} onChange={(e) => up(i, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />}
            {f.type === 'number' && <TextField label="Unit" optional value={f.unit ?? ''} maxLength={20} onChange={(e) => up(i, { unit: e.target.value })} />}
            <div className="row">
              <Check label="Required" checked={!!f.required} onChange={(e) => up(i, { required: e.target.checked })} />
              {kind === 'work' && <Check label="Shown on the phone app" checked={!!f.forWorkers} onChange={(e) => up(i, { forWorkers: e.target.checked })} />}
            </div>
          </div>
        ))}
        <div className="row">
          <Button icon={<Plus size={18} aria-hidden="true" />} onClick={() => setList([...list, { key: fieldKey('New field', list.map((x) => x.key)), label: 'New field', type: 'text' }])}>Add a field</Button>
          <Button variant="primary" busy={save.busy} onClick={() => void save.run()}>Save fields</Button>
        </div>
        {kind === 'equipment' && <Check label={`We assign ${ws.words.equipment.many.toLowerCase()} to work`} checked={ws.equipment} onChange={async (e) => { await put(`/c/${ws.cid}/fields/equipment`, { fields: list, enabled: e.target.checked }); ws.refresh(); }} />}
        {kind !== 'equipment' && !ws.equipment && <p className="small muted">Do you assign vehicles, tools or rooms? <button className="link-btn" onClick={async () => { await put(`/c/${ws.cid}/fields/equipment`, { fields: ws.fields.equipment, enabled: true }); ws.refresh(); }}>Turn on {ws.words.equipment.many.toLowerCase()}</button>.</p>}
      </div>
    </OnlyIf>
  );
}

export function SettingsEquipment() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  useTitle(ws.words.equipment.many, ws.workspace.name);
  const r = useQuery({ queryKey: [ws.cid, 'equipment'], queryFn: () => get<{ equipment: any[] }>(`/c/${ws.cid}/equipment`) });
  const [edit, setEdit] = useState<any>(null);
  const save = useSubmit(async () => {
    const body = { name: edit.name, identifier: edit.identifier ?? '', status: edit.status ?? 'available' };
    if (edit.id) await patch(`/c/${ws.cid}/equipment/${edit.id}`, body); else await post(`/c/${ws.cid}/equipment`, body);
    setEdit(null); toast('Saved.'); await qc.invalidateQueries({ queryKey: [ws.cid] });
  });
  const E = ws.words.equipment;
  return (
    <OnlyIf ok={ws.can('equipment.manage')}>
      <div className="page page-narrow">
        <PageHeader back={{ to: ws.to('settings'), label: 'Settings' }} title={E.many}><Button variant="primary" icon={<Plus size={18} aria-hidden="true" />} onClick={() => setEdit({ name: '' })}>Add</Button></PageHeader>
        {r.isLoading ? <Loading /> : !r.data?.equipment.length ? <div className="card"><Empty icon={<Wrench />} title={`No ${E.many.toLowerCase()} yet`}>Add what you assign to work.</Empty></div> : (
          <div className="card card-flush"><ul className="divider-list">{r.data.equipment.map((e) => (
            <li key={e.id}><button className="list-row" onClick={() => setEdit(e)}><span className="row-main"><span className="row-title">{e.name}</span><span className="row-sub">{[e.identifier, e.openWork ? `${e.openWork} open` : null].filter(Boolean).join(' · ')}</span></span>
              {e.status !== 'available' && <Badge tone={e.status === 'retired' ? 'cancelled' : 'attn'}>{e.status === 'retired' ? 'Retired' : 'Out of service'}</Badge>}</button></li>
          ))}</ul></div>
        )}
        {edit && (
          <Dialog title={edit.id ? edit.name : `Add ${E.one.toLowerCase()}`} onClose={() => setEdit(null)} actions={<><Button variant="primary" busy={save.busy} onClick={() => void save.run()}>Save</Button><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></>}>
            <FormError error={save.error} />
            <TextField label="Name" value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} error={save.fieldError('name')} />
            <TextField label="Number or plate" optional value={edit.identifier ?? ''} maxLength={60} onChange={(e) => setEdit({ ...edit, identifier: e.target.value })} />
            <SelectField label="State" value={edit.status ?? 'available'} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
              <option value="available">Available</option><option value="out_of_service">Out of service</option><option value="retired">Retired</option>
            </SelectField>
          </Dialog>
        )}
      </div>
    </OnlyIf>
  );
}

export function SettingsBooking() {
  const ws = useWorkspace();
  const toast = useToast();
  useTitle('Booking page', ws.workspace.name);
  const r = useQuery({ queryKey: [ws.cid, 'booking'], queryFn: () => get<any>(`/c/${ws.cid}/booking`) });
  const cat = useQuery({ queryKey: [ws.cid, 'catalog'], queryFn: () => get<{ items: any[] }>(`/c/${ws.cid}/catalog`) });
  const [v, setV] = useState<any>(null);
  useEffect(() => {
    if (!r.data) return;
    setV(r.data.page ?? { slug: r.data.suggestedSlug, enabled: false, mode: 'request', headline: '', intro: '', catalogIds: [], hours: null, slotMinutes: 60 });
  }, [r.data]);
  const save = useSubmit(async () => { await put(`/c/${ws.cid}/booking`, v); toast(v.enabled ? 'Saved. Your page is live.' : 'Saved. Your page is off.'); void r.refetch(); });
  if (!ws.can('requests.manage')) return <OnlyIf ok={false}>{null}</OnlyIf>;
  if (!v) return <div className="page"><Loading /></div>;
  const url = `${location.origin}/book/${v.slug}`;
  const hours = v.hours ?? { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' };
  return (
    <div className="page page-narrow">
      <PageHeader back={{ to: ws.to('settings'), label: 'Settings' }} title="Booking page" sub={`A public page where ${ws.words.customer.many.toLowerCase()} ask for work or pick a time. Nothing is booked until a person accepts it in the inbox.`} />
      {ws.workspace.kind === 'demo' && <Banner tone="attn" title="This is a demo">The page works, but requests stay in this demo.</Banner>}
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); void save.run(); }} noValidate>
        <FormError error={save.error} />
        <Check label="The page is on" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} />
        <TextField label="Address" hint={url} value={v.slug} maxLength={40} onChange={(e) => setV({ ...v, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} error={save.fieldError('slug')} />
        {r.data.page?.enabled && <div className="row"><Button size="sm" icon={<Copy size={16} aria-hidden="true" />} onClick={() => { void navigator.clipboard?.writeText(url); toast('Link copied.'); }}>Copy link</Button><a className="btn btn-sm" href={url} target="_blank" rel="noreferrer"><ExternalLink size={16} aria-hidden="true" />Open it</a></div>}
        <fieldset className="stack-sm"><legend>People can</legend>
          <div className="choices">
            <button type="button" className="choice" aria-pressed={v.mode === 'request'} onClick={() => setV({ ...v, mode: 'request' })}><strong>Ask for work</strong><span className="small muted">They say what they need; you set the time.</span></button>
            <button type="button" className="choice" aria-pressed={v.mode === 'book'} onClick={() => setV({ ...v, mode: 'book', hours })}><strong>Pick a time</strong><span className="small muted">They choose from your free times.</span></button>
          </div>
        </fieldset>
        <TextField label="Headline" optional value={v.headline} maxLength={120} placeholder={`Book with ${ws.workspace.name}`} onChange={(e) => setV({ ...v, headline: e.target.value })} />
        <TextArea label="A few words for visitors" optional value={v.intro} maxLength={600} rows={2} onChange={(e) => setV({ ...v, intro: e.target.value })} />
        <fieldset><legend>What they can ask for</legend>
          {(cat.data?.items ?? []).filter((i) => i.active).map((i) => <Check key={i.id} label={i.name} checked={v.catalogIds.includes(i.id)} onChange={(e) => setV({ ...v, catalogIds: e.target.checked ? [...v.catalogIds, i.id] : v.catalogIds.filter((x: string) => x !== i.id) })} />)}
          <p className="small muted">Prices are never shown on the page.</p>
        </fieldset>
        {v.mode === 'book' && (
          <fieldset className="stack-sm"><legend>Bookable times</legend>
            <div className="row" style={{ gap: 4 }}>{DAY_NAMES.map((d, i) => <Check key={d} label={d.slice(0, 3)} checked={hours.days.includes(i)} onChange={(e) => setV({ ...v, hours: { ...hours, days: e.target.checked ? [...hours.days, i].sort() : hours.days.filter((x: number) => x !== i) } })} />)}</div>
            <div className="grid-3">
              <TextField label="From" type="time" value={hours.start} onChange={(e) => setV({ ...v, hours: { ...hours, start: e.target.value } })} />
              <TextField label="Until" type="time" value={hours.end} onChange={(e) => setV({ ...v, hours: { ...hours, end: e.target.value } })} error={save.fieldError('hours.end')} />
              <SelectField label="Each booking" value={String(v.slotMinutes)} onChange={(e) => setV({ ...v, slotMinutes: Number(e.target.value) })}>
                {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`}</option>)}
              </SelectField>
            </div>
          </fieldset>
        )}
        <div><Button type="submit" variant="primary" busy={save.busy}>Save</Button></div>
      </form>
    </div>
  );
}

export function SettingsTemplates() {
  const ws = useWorkspace();
  const toast = useToast();
  useTitle('Templates', ws.workspace.name);
  const mine = useQuery({ queryKey: [ws.cid, 'library', 'mine'], queryFn: () => get<{ templates: any[] }>(`/c/${ws.cid}/library/mine`) });
  const [v, setV] = useState({ name: ws.workspace.name, blurb: ws.workspace.description, examples: '' });
  const publish = useSubmit(async () => { await post(`/c/${ws.cid}/library`, { name: v.name, blurb: v.blurb, examples: v.examples.split(',').map((x) => x.trim()).filter(Boolean) }); toast('Published to the template library.'); void mine.refetch(); });
  return (
    <OnlyIf ok={ws.can('templates.manage')}>
      <div className="page page-narrow">
        <PageHeader back={{ to: ws.to('settings'), label: 'Settings' }} title="Templates" sub="Share how you set up Rigo with other businesses: your words, stages, roles, fields and the names of what you sell." />
        <Banner tone="info" title="Never shared">Prices, people, customers and records stay in your workspace.</Banner>
        {ws.role.isOwner ? (
          <form className="card stack" onSubmit={(e) => { e.preventDefault(); void publish.run(); }} noValidate>
            <h2>Publish your setup</h2>
            <FormError error={publish.error} />
            <TextField label="Template name" value={v.name} maxLength={60} onChange={(e) => setV({ ...v, name: e.target.value })} error={publish.fieldError('name')} />
            <TextArea label="Who it’s for" optional value={v.blurb} maxLength={200} rows={2} onChange={(e) => setV({ ...v, blurb: e.target.value })} />
            <TextField label="Kinds of business" optional hint="Separate with commas." value={v.examples} onChange={(e) => setV({ ...v, examples: e.target.value })} />
            <div><Button type="submit" variant="primary" busy={publish.busy}>Publish</Button></div>
          </form>
        ) : <p className="muted">Only owners publish templates.</p>}
        {(mine.data?.templates.length ?? 0) > 0 && (
          <section className="card card-flush"><ul className="divider-list">{mine.data!.templates.map((t) => (
            <li key={t.id} className="list-row"><span className="row-main"><span className="row-title">{t.name}</span><span className="row-sub">Used {t.uses} time{t.uses === 1 ? '' : 's'}</span></span>
              <Button size="sm" variant="ghost" onClick={async () => { await del(`/c/${ws.cid}/library/${t.id}`); toast('Taken out of the library. Workspaces made from it keep their copy.'); void mine.refetch(); }}>Unpublish</Button></li>
          ))}</ul></section>
        )}
        <LinkButton to="/templates" variant="ghost">Browse the library</LinkButton>
      </div>
    </OnlyIf>
  );
}
