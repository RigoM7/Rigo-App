import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Copy, KeyRound, Trash2, RefreshCw, X, Plus, History, ShieldCheck } from 'lucide-react';
import { get, post, patch, del } from '../lib/api';
import { useWorkspace } from '../lib/session';
import { useSubmit } from '../lib/form';
import { useTitle } from '../lib/title';
import { fmtDate, fmtDateTime, relTime } from '../lib/format';
import { PageHeader, Button, Loading, ErrorState, TextField, TextArea, SelectField, FormError, Banner, Badge, Check, useToast, Dialog, Segmented } from '../components/ui';
import { PERMISSIONS, PERMISSION_GROUPS, PERMISSION_PRESETS, type Permission } from '../../shared/permissions';
import { effectivePermissions } from '../../shared/workspace';

// The team and its roles, kept from the earlier app: invitations by email (or a link to share),
// owners protected, one-time reset links, the activity log. Roles are now built by the owner.

const HOW: Record<string, string> = { emailed: 'Emailed', mailbox: 'In the test inbox', not_sent: 'Not emailed: share the link', demo: 'Demo: not sent' };

export function SettingsPeople() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const P = ws.words.person;
  useTitle(P.many, ws.workspace.name);
  const r = useQuery({ queryKey: [ws.cid, 'members'], queryFn: () => get<{ members: any[]; invitations: any[] }>(`/c/${ws.cid}/members`) });
  const roles = useQuery({ queryKey: [ws.cid, 'roles'], queryFn: () => get<{ roles: any[] }>(`/c/${ws.cid}/roles`) });
  const [inv, setInv] = useState({ emails: '', role: '' });
  const [confirmOwner, setConfirmOwner] = useState<{ member: any; role: string } | null>(null);
  const [typed, setTyped] = useState('');
  const [resetFor, setResetFor] = useState<{ name: string; link: string; simulated: boolean } | null>(null);
  const [removing, setRemoving] = useState<any>(null);
  const [showLog, setShowLog] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: [ws.cid] });
  const roleKey = inv.role || roles.data?.roles.find((x) => !x.is_owner)?.key || 'owner';
  const invite = useSubmit(async () => {
    const res = await post<{ results: any[] }>(`/c/${ws.cid}/invitations/bulk`, { emails: inv.emails, role: roleKey });
    const bad = res.results.filter((x) => !x.ok);
    toast(`${res.results.length - bad.length} invitation${res.results.length - bad.length === 1 ? '' : 's'} ready.${bad.length ? ` ${bad.map((b) => `${b.email}: ${b.message}`).join(' ')}` : ''}`, bad.length ? 'error' : 'success');
    setInv({ emails: '', role: inv.role });
    void refresh();
  });
  const changeRole = useSubmit(async (m: any, role: string, ok = false) => {
    try { await patch(`/c/${ws.cid}/members/${m.id}`, { role, confirmOwner: ok }); toast('Role changed.'); setConfirmOwner(null); void refresh(); }
    catch (e: any) { if (e?.details?.needsConfirm === 'owner') { setConfirmOwner({ member: m, role }); setTyped(''); return; } throw e; }
  });
  const reset = useSubmit(async (m: any) => { const x = await post<any>(`/c/${ws.cid}/members/${m.id}/reset-link`); setResetFor(x); });
  const remove = useSubmit(async () => { await del(`/c/${ws.cid}/members/${removing.id}`); toast(`${removing.name} was removed.`); setRemoving(null); void refresh(); });
  const copy = (link: string) => { void navigator.clipboard?.writeText(link); toast('Link copied.'); };
  if (r.isLoading) return <div className="page"><Loading /></div>;
  if (r.error) return <div className="page"><ErrorState error={r.error} retry={() => r.refetch()} /></div>;
  const pending = r.data!.invitations.filter((i) => i.status === 'pending' || i.status === 'expired');
  return (
    <div className="page page-narrow">
      <PageHeader back={{ to: ws.to('settings'), label: 'Settings' }} title={P.many} sub={`${r.data!.members.length} in ${ws.workspace.name}.`}>
        {ws.role.isOwner && <Button variant="ghost" icon={<History size={18} aria-hidden="true" />} onClick={() => setShowLog(true)}>Activity</Button>}
      </PageHeader>
      <FormError error={changeRole.error ?? reset.error} />
      {ws.can('members.invite') && (
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); void invite.run(); }} noValidate>
          <h2 className="row"><UserPlus size={20} aria-hidden="true" />Invite people</h2>
          <FormError error={invite.error} />
          <TextArea label="Email addresses" hint="Separate them with commas or new lines. They join with the email you use here." rows={2} value={inv.emails} onChange={(e) => setInv({ ...inv, emails: e.target.value })} error={invite.fieldError('emails')} />
          <SelectField label="Role" value={roleKey} onChange={(e) => setInv({ ...inv, role: e.target.value })}>
            {(roles.data?.roles ?? []).filter((x) => !x.is_owner || ws.role.isOwner).map((x) => <option key={x.key} value={x.key}>{x.name}{x.app === 'worker' ? ' (phone)' : ''}</option>)}
          </SelectField>
          <div><Button type="submit" variant="primary" busy={invite.busy} disabled={!inv.emails.trim()}>Send invitations</Button></div>
        </form>
      )}
      {pending.length > 0 && (
        <section className="card stack" aria-labelledby="pend">
          <h2 id="pend">Invitations</h2>
          <ul className="divider-list">{pending.map((i) => (
            <li key={i.id} className="list-row" style={{ paddingInline: 0, flexWrap: 'wrap' }}>
              <span className="row-main"><span className="row-title wrap-anywhere">{i.email}</span><span className="row-sub">{i.role_name} · {i.status === 'expired' ? 'Expired' : `${HOW[i.delivery] ?? 'Created'} · until ${fmtDate(i.expires_at)}`}</span></span>
              <span className="row">
                {i.link && <Button size="sm" icon={<Copy size={16} aria-hidden="true" />} onClick={() => copy(i.link)}>Copy link</Button>}
                <Button size="sm" variant="ghost" icon={<RefreshCw size={16} aria-hidden="true" />} onClick={async () => { try { await post(`/c/${ws.cid}/invitations/${i.id}/resend`); toast('A new invitation replaced the old one.'); void refresh(); } catch (e) { toast((e as Error).message, 'error'); } }}>New link</Button>
                {i.status === 'pending' && <Button size="sm" variant="ghost" icon={<X size={16} aria-hidden="true" />} onClick={async () => { try { await post(`/c/${ws.cid}/invitations/${i.id}/revoke`); toast('Invitation taken back.'); void refresh(); } catch (e) { toast((e as Error).message, 'error'); } }}>Take back</Button>}
              </span>
            </li>
          ))}</ul>
        </section>
      )}
      <section className="card card-flush" aria-label="Members">
        <ul className="divider-list">{r.data!.members.map((m) => (
          <li key={m.id} className="list-row" style={{ flexWrap: 'wrap' }}>
            <span className="row-main"><span className="row-title">{m.name}{m.user_id === ws.me.id && <span className="muted"> (you)</span>}{m.is_fictional && <Badge tone="demo">Fictional</Badge>}</span>
              <span className="row-sub wrap-anywhere">{[m.email, m.open_work ? `${m.open_work} open` : null].filter(Boolean).join(' · ')}</span></span>
            {ws.can('members.manage') && m.user_id !== ws.me.id ? (
              <span className="row">
                <label className="sr-only" htmlFor={`role-${m.id}`}>Role for {m.name}</label>
                <select id={`role-${m.id}`} className="select" style={{ width: 'auto', minWidth: 160 }} value={m.role_key} onChange={(e) => void changeRole.run(m, e.target.value)}>
                  {(roles.data?.roles ?? []).filter((x) => !x.is_owner || ws.role.isOwner || m.is_owner).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
                </select>
                {!m.is_fictional && <Button size="sm" variant="ghost" icon={<KeyRound size={16} aria-hidden="true" />} onClick={() => void reset.run(m)}>Reset link</Button>}
                <Button size="sm" variant="ghost" className="icon-btn" aria-label={`Remove ${m.name}`} onClick={() => setRemoving(m)}><Trash2 size={16} /></Button>
              </span>
            ) : <Badge tone={m.is_owner ? 'good' : 'open'}>{m.role_name}</Badge>}
          </li>
        ))}</ul>
      </section>

      {confirmOwner && (
        <Dialog title="Change who is an owner?" onClose={() => setConfirmOwner(null)} actions={<>
          <Button variant="primary" disabled={typed.trim().toLowerCase() !== confirmOwner.member.name.trim().toLowerCase()} busy={changeRole.busy} onClick={() => void changeRole.run(confirmOwner.member, confirmOwner.role, true)}>Confirm</Button>
          <Button variant="ghost" onClick={() => setConfirmOwner(null)}>Cancel</Button>
        </>}>
          <p className="muted">Owners can do everything, including removing other owners and changing billing. Type {confirmOwner.member.name} to confirm.</p>
          <TextField label="Name" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Dialog>
      )}
      {resetFor && (
        <Dialog title={`Reset link for ${resetFor.name}`} onClose={() => setResetFor(null)} actions={<><Button variant="primary" icon={<Copy size={16} aria-hidden="true" />} onClick={() => copy(resetFor.link)}>Copy link</Button><Button variant="ghost" onClick={() => setResetFor(null)}>Done</Button></>}>
          {resetFor.simulated && <Banner tone="attn" title="Demo">This link is an example and doesn’t work.</Banner>}
          <p className="muted">Give it to {resetFor.name.split(' ')[0]} yourself, for example by text. It works once, for 24 hours, and signs them out everywhere else.</p>
          <code className="card soft wrap-anywhere small" style={{ display: 'block' }}>{resetFor.link}</code>
        </Dialog>
      )}
      {removing && (
        <Dialog title={`Remove ${removing.name}?`} onClose={() => setRemoving(null)} actions={<><Button variant="danger" busy={remove.busy} onClick={() => void remove.run()}>Remove</Button><Button variant="ghost" onClick={() => setRemoving(null)}>Keep</Button></>}>
          <p className="muted">They lose access right away. {removing.open_work ? `Their ${removing.open_work} open ${removing.open_work === 1 ? ws.words.work.one.toLowerCase() : ws.words.work.many.toLowerCase()} go back to unassigned.` : ''} Their past work stays in history.</p>
          <FormError error={remove.error} />
        </Dialog>
      )}
      {showLog && <ActivityLog onClose={() => setShowLog(false)} />}
    </div>
  );
}

function ActivityLog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const [group, setGroup] = useState('');
  const r = useQuery({ queryKey: [ws.cid, 'activity', group], queryFn: () => get<{ entries: any[] }>(`/c/${ws.cid}/activity${group ? `?group=${group}` : ''}`) });
  return (
    <Dialog wide title="Activity" onClose={onClose}>
      <Segmented label="Show" value={group} onChange={setGroup} options={[{ value: '', label: 'All' }, { value: 'people', label: 'People' }, { value: 'work', label: 'Work' }, { value: 'money', label: 'Money' }, { value: 'settings', label: 'Settings' }, { value: 'automation', label: 'Automation' }]} />
      {r.isLoading ? <Loading rows={3} /> : (
        <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '50vh', overflow: 'auto' }}>
          {r.data!.entries.map((e) => <li key={e.id} className="small"><span className="muted">{fmtDateTime(e.created_at, ws.workspace.timezone)}</span> · <strong>{e.actor}</strong> · {e.action.replace(/[._]/g, ' ')}</li>)}
          {!r.data!.entries.length && <li className="muted">Nothing recorded yet.</li>}
        </ul>
      )}
    </Dialog>
  );
}

export function SettingsRoles() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  useTitle('Roles', ws.workspace.name);
  const r = useQuery({ queryKey: [ws.cid, 'roles'], queryFn: () => get<{ roles: any[] }>(`/c/${ws.cid}/roles`), enabled: ws.can('members.view') || ws.role.isOwner });
  const [edit, setEdit] = useState<any>(null);
  const save = useSubmit(async () => {
    const body = { name: edit.name, description: edit.description ?? '', app: edit.app, permissions: edit.permissions };
    if (edit.key) await patch(`/c/${ws.cid}/roles/${edit.key}`, edit.is_owner ? { name: edit.name, description: edit.description } : body);
    else await post(`/c/${ws.cid}/roles`, body);
    toast('Role saved.'); setEdit(null); await qc.invalidateQueries({ queryKey: [ws.cid] });
  });
  const remove = useSubmit(async () => { await del(`/c/${ws.cid}/roles/${edit.key}`); toast('Role removed.'); setEdit(null); await qc.invalidateQueries({ queryKey: [ws.cid] }); });
  if (!ws.role.isOwner) return <div className="page"><ErrorState error={{ status: 403, message: 'Only owners change roles.' }} /></div>;
  const toggle = (p: Permission) => setEdit({ ...edit, permissions: edit.permissions.includes(p) ? edit.permissions.filter((x: string) => x !== p) : [...edit.permissions, p] });
  const W = ws.words;
  const say = (t: string) => t.replace(/\bwork\b/g, W.work.many.toLowerCase()).replace(/\bcustomers\b/g, W.customer.many.toLowerCase()).replace(/\bcustomer\b/g, W.customer.one.toLowerCase());
  return (
    <div className="page page-narrow">
      <PageHeader back={{ to: ws.to('settings'), label: 'Settings' }} title="Roles" sub="Add, rename and change roles. The Owner role always exists and can do everything.">
        <Button variant="primary" icon={<Plus size={18} aria-hidden="true" />} onClick={() => setEdit({ name: '', description: '', app: 'office', permissions: PERMISSION_PRESETS.scheduler })}>Add a role</Button>
      </PageHeader>
      {r.isLoading ? <Loading /> : (
        <div className="card card-flush"><ul className="divider-list">{r.data!.roles.map((x) => (
          <li key={x.key}><button className="list-row" onClick={() => setEdit({ ...x })}>
            <ShieldCheck aria-hidden="true" style={{ color: 'var(--primary-text)' }} />
            <span className="row-main"><span className="row-title">{x.name}</span><span className="row-sub">{[x.app === 'worker' ? 'Phone app' : 'Office screens', `${x.members} ${x.members === 1 ? 'person' : 'people'}`, x.description].filter(Boolean).join(' · ')}</span></span>
          </button></li>
        ))}</ul></div>
      )}
      {edit && (
        <Dialog wide title={edit.key ? edit.name || 'Role' : 'Add a role'} onClose={() => setEdit(null)} actions={<>
          <Button variant="primary" busy={save.busy} onClick={() => void save.run()}>Save</Button>
          {edit.key && !edit.is_owner && <Button variant="danger" busy={remove.busy} onClick={() => void remove.run()}>Remove role</Button>}
          <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
        </>}>
          <FormError error={save.error ?? remove.error} />
          <TextField label="Name" value={edit.name} maxLength={40} onChange={(e) => setEdit({ ...edit, name: e.target.value })} error={save.fieldError('name')} />
          <TextField label="What they do" optional value={edit.description ?? ''} maxLength={200} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          {edit.is_owner ? <Banner tone="info">Owners can always do everything.</Banner> : (
            <>
              <div className="choices">
                <button type="button" className="choice" aria-pressed={edit.app === 'office'} onClick={() => setEdit({ ...edit, app: 'office' })}><strong>Office screens</strong><span className="small muted">Today, {W.work.many}, {W.customer.many}, Money and Settings, as allowed below.</span></button>
                <button type="button" className="choice" aria-pressed={edit.app === 'worker'} onClick={() => setEdit({ ...edit, app: 'worker', permissions: effectivePermissions('worker', edit.permissions.length ? edit.permissions : PERMISSION_PRESETS.worker) })}><strong>Phone app</strong><span className="small muted">Today, Upcoming and Done: only their own {W.work.many.toLowerCase()}.</span></button>
              </div>
              {PERMISSION_GROUPS.map((g) => {
                const keys = edit.app === 'worker' ? g.keys.filter((k) => effectivePermissions('worker', [k]).length) : g.keys;
                if (!keys.length) return null;
                return (
                  <fieldset key={g.label}><legend>{g.label === 'Work' ? W.work.many : g.label === 'Customers' ? W.customer.many : g.label}</legend>
                    {keys.map((k) => <Check key={k} label={say(PERMISSIONS[k])} checked={edit.permissions.includes(k)} onChange={() => toggle(k)} />)}
                  </fieldset>
                );
              })}
            </>
          )}
        </Dialog>
      )}
      <p className="small muted">Changes apply right away. People see only what their role allows; amounts and contact details are removed on the server, not just hidden.</p>
      <span hidden>{relTime(new Date().toISOString())}</span>
    </div>
  );
}
