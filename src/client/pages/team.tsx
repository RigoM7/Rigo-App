import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Copy, RotateCw, Ban, Trash2, Mail, ShieldCheck, Save, KeyRound } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, patch, del } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Select, ErrorSummary, LoadingBlock, ErrorState, PageHeader, Tabs, Pill, Banner, Dialog, useToast, useConfirm, Checkbox } from '../components/ui';
import { EMAIL_MAX } from '../../shared/email';
import { fmtDate } from '../lib/format';
import { PERMISSIONS, PERMISSION_GROUPS, type Permission } from '../../shared/permissions';

function InviteCard({ roles, onDone }: { roles: any[]; onDone: () => void }) {
  const c = useCompany();
  const toast = useToast();
  const [v, setV] = useState({ email: '', role: 'driver' });
  const [result, setResult] = useState<any>(null);
  const s = useSubmit(async () => { const r = await post(`/c/${c.cid}/invitations`, v); setResult(r); setV({ ...v, email: '' }); onDone(); });
  const grantable = roles.filter((r) => c.role.isOwner || !r.is_owner);
  return (
    <Card id="invite" title={<h2 className="row"><UserPlus aria-hidden />Invite someone</h2>}>
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); s.run(); }}>
        <ErrorSummary error={s.error} />
        <div className="grid-2">
          <Field label="Their email" id="f-email" error={s.fieldError('email')} hint="They sign in or create an account with this exact address.">{(p) => <Input {...p} type="email" autoComplete="off" maxLength={EMAIL_MAX} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
          <Field label="Role" id="f-role" error={s.fieldError('role')}>{(p) => <Select {...p} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>{grantable.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</Select>}</Field>
        </div>
        <div><Button type="submit" variant="primary" busy={s.busy} icon={<Mail aria-hidden />}>Create invitation</Button></div>
      </form>
      {result && (
        <div className="stack-sm" style={{ marginTop: 16 }}>
          <Banner tone="success" title="Invitation created">
            {result.delivery?.simulated ? 'Email is simulated here: ' : 'No email service is configured: '}share this single-use link with them. It expires in 7 days.
          </Banner>
          <div className="row" style={{ flexWrap: 'nowrap' }}><Input readOnly value={result.link} aria-label="Invitation link" onFocus={(e) => e.target.select()} /><Button icon={<Copy aria-hidden />} onClick={() => navigator.clipboard?.writeText(result.link).then(() => toast('Link copied'), () => toast('Copy failed; select the link and copy it', 'error'))}>Copy</Button></div>
          <details><summary>Email preview (not sent)</summary><div className="card" style={{ marginTop: 8 }}><div className="small muted">To: {result.preview.to}</div><strong>{result.preview.subject}</strong><p className="pre small">{result.preview.body}</p></div></details>
        </div>
      )}
    </Card>
  );
}

function PermissionMatrix({ roles, onSaved }: { roles: any[]; onSaved: () => void }) {
  const c = useCompany();
  const toast = useToast();
  const editable = roles.filter((r) => !r.is_owner);
  const [sel, setSel] = useState(editable[0]?.key ?? '');
  const role = roles.find((r) => r.key === sel);
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
  useEffect(() => { setPerms(role?.permissions ?? []); }, [role]);
  const s = useSubmit(async () => { await patch(`/c/${c.cid}/roles/${sel}`, { permissions: perms }); toast(`${role.name} permissions saved`); onSaved(); });
  const canEdit = c.role.isOwner && c.can('roles.manage');
  return (
    <Card id="roles" title={<h2 className="row"><ShieldCheck aria-hidden />Role permissions</h2>}>
      <p className="muted">Permissions are enforced by the server for every request. Owners always have every permission.{canEdit ? '' : ' Only owners can change them.'}</p>
      <Field label="Role" id="f-roleSel">{(p) => <Select {...p} value={sel} onChange={(e) => setSel(e.target.value)}>{editable.map((r) => <option key={r.key} value={r.key}>{r.name} ({r.members} member{r.members === 1 ? '' : 's'})</option>)}</Select>}</Field>
      <ErrorSummary error={s.error} />
      <div className="grid-2" style={{ marginTop: 12 }}>
        {PERMISSION_GROUPS.map((g) => (
          <fieldset key={g.label} className="card" style={{ padding: 12 }} disabled={!canEdit}>
            <legend style={{ padding: '0 4px' }}>{g.label}</legend>
            {g.keys.map((k) => <Checkbox key={k} label={PERMISSIONS[k]} hint={k} checked={perms.includes(k)} onChange={(e) => setPerms(e.target.checked ? [...perms, k] : perms.filter((x) => x !== k))} />)}
          </fieldset>
        ))}
      </div>
      {canEdit && <div style={{ marginTop: 12 }}><Button variant="primary" icon={<Save aria-hidden />} busy={s.busy} onClick={() => s.run()}>Save {role?.name} permissions</Button></div>}
    </Card>
  );
}

function Delegations({ members }: { members: any[] }) {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: [c.cid, 'delegations'], queryFn: () => get(`/c/${c.cid}/delegations`) });
  const canDelegate = c.can('approvals.decide') || c.can('invoices.approve');
  const cand = useQuery({ queryKey: [c.cid, 'delegations', 'candidates'], queryFn: () => get(`/c/${c.cid}/delegations/candidates`), enabled: canDelegate });
  const [v, setV] = useState({ toUserId: '', endsAt: '' });
  const s = useSubmit(async () => { await post(`/c/${c.cid}/delegations`, { toUserId: v.toUserId, endsAt: v.endsAt ? new Date(`${v.endsAt}T23:59:00`).toISOString() : null }); toast('Approval authority delegated'); qc.invalidateQueries({ queryKey: [c.cid, 'delegations'] }); });
  const end = async (id: string) => { await del(`/c/${c.cid}/delegations/${id}`); qc.invalidateQueries({ queryKey: [c.cid, 'delegations'] }); };
  return (
    <Card id="deleg" title="Delegated approval authority">
      <p className="muted">While you are away, someone else can decide the approvals assigned to you. Only people whose role can approve are eligible.</p>
      {canDelegate && (
        <form className="grid-2" style={{ alignItems: 'end' }} noValidate onSubmit={(e) => { e.preventDefault(); s.run(); }}>
          <Field label="Delegate to" id="f-toUserId" error={s.fieldError('toUserId')} hint={cand.data && cand.data.candidates.length === 0 ? 'Nobody else can approve yet. Give a role "Approve invoices" in Roles first.' : 'Only people whose role can approve are listed.'}>{(p) => <Select {...p} value={v.toUserId} onChange={(e) => setV({ ...v, toUserId: e.target.value })}><option value="">Choose…</option>{(cand.data?.candidates ?? []).map((m: any) => <option key={m.user_id} value={m.user_id}>{m.name} ({m.role_name})</option>)}</Select>}</Field>
          <Field label="Until" optionalText id="f-endsAt">{(p) => <Input {...p} type="date" value={v.endsAt} onChange={(e) => setV({ ...v, endsAt: e.target.value })} />}</Field>
          <div><Button type="submit" busy={s.busy}>Delegate</Button></div>
          <div style={{ gridColumn: '1 / -1' }}><ErrorSummary error={s.error} /></div>
        </form>
      )}
      <ul className="list" style={{ marginTop: 12 }}>{q.data?.delegations.map((d: any) => <li key={d.id} className="row-between" style={{ padding: '8px 0' }}><span>{d.from_name} → {d.to_name}{d.ends_at ? ` until ${fmtDate(d.ends_at, c.company.timezone)}` : ''}</span><Button size="sm" variant="ghost" onClick={() => end(d.id)}>End</Button></li>)}</ul>
    </Card>
  );
}

/** Shows a just-created password reset link once. It is never shown again or put in a URL. */
function ResetLinkDialog({ result, onClose }: { result: null | { name: string; link: string; simulated: boolean; expiresInHours: number }; onClose: () => void }) {
  const toast = useToast();
  const first = result?.name.split(' ')[0] ?? '';
  return (
    <Dialog open={!!result} onClose={onClose} title={`Password reset link for ${first}`}
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      {result && (
        <div className="stack">
          {result.simulated ? <Banner tone="info" title="Simulated in the demo">This example link doesn't work, and nothing was sent.</Banner> : null}
          <p style={{ margin: 0 }}>Text this link to {first}. It works once and expires in {result.expiresInHours} hours. When {first} uses it to choose a new password, they're signed out on their other devices.</p>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Input readOnly value={result.link} aria-label={`Password reset link for ${result.name}`} onFocus={(e) => e.target.select()} />
            <Button icon={<Copy aria-hidden />} onClick={() => navigator.clipboard?.writeText(result.link).then(() => toast('Link copied'), () => toast('Copy failed; select the link and copy it', 'error'))}>Copy</Button>
          </div>
          <p className="hint" style={{ margin: 0 }}>This link is shown only now. If it's lost, create a new one; the old one stops working.</p>
        </div>
      )}
    </Dialog>
  );
}

export function Team() {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const { ask, node } = useConfirm();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') ?? 'members') as 'members' | 'roles' | 'approvals';
  const q = useQuery({ queryKey: [c.cid, 'members'], queryFn: () => get(`/c/${c.cid}/members`) });
  const roles = useQuery({ queryKey: [c.cid, 'roles'], queryFn: () => get(`/c/${c.cid}/roles`) });
  const [err, setErr] = useState<any>(null);
  const [resetLink, setResetLink] = useState<null | { name: string; link: string; simulated: boolean; expiresInHours: number }>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: [c.cid] });
  const createResetLink = async (m: any) => {
    setErr(null);
    try { setResetLink(await post(`/c/${c.cid}/members/${m.id}/reset-link`)); } catch (e) { setErr(e); }
  };
  const changeRole = async (m: any, role: string) => {
    setErr(null);
    try { await patch(`/c/${c.cid}/members/${m.id}`, { role }); toast(`${m.name} is now ${roles.data.roles.find((r: any) => r.key === role)?.name}`); refresh(); } catch (e) { setErr(e); }
  };
  const remove = async (m: any) => {
    if (!(await ask({ title: `Remove ${m.name}?`, body: <>They lose access to {c.company.name} immediately. {m.open_jobs ? `Their ${m.open_jobs} open job(s) return to the unassigned list.` : ''} Their past work stays in history.</>, confirm: 'Remove member', danger: true }))) return;
    setErr(null);
    try { await del(`/c/${c.cid}/members/${m.id}`); toast(`${m.name} was removed`); refresh(); } catch (e) { setErr(e); }
  };
  const invAction = async (id: string, what: 'resend' | 'revoke') => {
    if (what === 'revoke' && !(await ask({ title: 'Revoke this invitation?', body: 'The link stops working at once. You can send a new invitation later.', confirm: 'Revoke invitation', danger: true }))) return;
    setErr(null);
    try {
      const r = await post(`/c/${c.cid}/invitations/${id}/${what}`);
      if (what === 'resend') { await navigator.clipboard?.writeText(r.link).catch(() => {}); toast('A new link was created and copied. The old link no longer works.'); } else toast('Invitation revoked');
      refresh();
    } catch (e) { setErr(e); }
  };
  if (q.isLoading || roles.isLoading) return <div className="page"><LoadingBlock /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} /></div>;
  const owners = q.data.members.filter((m: any) => m.is_owner).length;
  return (
    <div className="page">
      <PageHeader title="Team" sub="People in this company, their roles, and pending invitations." />
      <Tabs label="Team sections" value={tab} onChange={(k) => setSp({ tab: k })} tabs={[{ key: 'members', label: 'Members & invitations' }, { key: 'roles', label: 'Roles & permissions' }, { key: 'approvals', label: 'Approval delegation' }]} />
      <ErrorSummary error={err} />
      {tab === 'members' && <>
        {c.can('members.invite') && <InviteCard roles={roles.data.roles} onDone={refresh} />}
        <Card id="members" title={`Members (${q.data.members.length})`} flush>
          <div className="table-wrap"><table className="table responsive">
            <thead><tr><th>Name</th><th>Role</th><th className="right">Open jobs</th>{c.can('members.manage') && <th><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody>{q.data.members.map((m: any) => {
              const lastOwner = m.is_owner && owners <= 1;
              const canChange = c.can('members.manage') && (c.role.isOwner || !m.is_owner) && !m.is_fictional;
              return (
                <tr key={m.id}>
                  <td data-primary><strong>{m.name}</strong>{m.user_id === c.me.id ? <span className="muted"> (you)</span> : null}{m.is_fictional ? <> <Pill tone="demo">Fictional</Pill></> : null}{m.email ? <div className="small muted">{m.email}</div> : null}</td>
                  <td data-label="Role">{canChange ? (
                    <select className="select" style={{ minHeight: 36, padding: '4px 8px', width: 'auto' }} aria-label={`Role for ${m.name}`} value={m.role_key} disabled={lastOwner} onChange={(e) => changeRole(m, e.target.value)}>
                      {roles.data.roles.filter((r: any) => c.role.isOwner || !r.is_owner).map((r: any) => <option key={r.key} value={r.key}>{r.name}</option>)}
                    </select>
                  ) : m.role_name}{lastOwner ? <div className="small muted">Last owner: add another owner before changing.</div> : null}</td>
                  <td data-label="Open jobs" className="right num">{m.open_jobs}</td>
                  {c.can('members.manage') && <td data-label=""><span className="row">
                    {m.user_id !== c.me.id && (c.role.isOwner || !m.is_owner) ? <Button size="sm" icon={<KeyRound aria-hidden />} onClick={() => createResetLink(m)} aria-label={`Create password reset link for ${m.name}`}>Reset link</Button> : null}
                    {canChange && !lastOwner && m.user_id !== c.me.id ? <Button size="sm" variant="danger" icon={<Trash2 aria-hidden />} onClick={() => remove(m)}>Remove</Button> : null}
                  </span></td>}
                </tr>
              );
            })}</tbody>
          </table></div>
        </Card>
        {c.can('members.invite') && q.data.invitations.length > 0 && (
          <Card id="invs" title="Invitations" flush>
            <div className="table-wrap"><table className="table responsive">
              <thead><tr><th>Email</th><th>Role</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{q.data.invitations.map((i: any) => (
                <tr key={i.id}>
                  <td data-primary className="wrap-anywhere">{i.email}<div className="small muted">Sent {fmtDate(i.created_at, c.company.timezone)}</div></td>
                  <td data-label="Role">{i.role_name}</td>
                  <td data-label="Status"><Pill tone={i.status === 'accepted' ? 'success' : i.status === 'pending' ? 'info' : 'neutral'}>{i.status === 'pending' ? `Pending until ${fmtDate(i.expires_at, c.company.timezone)}` : i.status === 'accepted' ? 'Accepted' : i.status === 'expired' ? 'Expired' : 'Revoked'}</Pill></td>
                  <td data-label="">{['pending', 'expired', 'revoked'].includes(i.status) && <span className="row"><Button size="sm" icon={<RotateCw aria-hidden />} onClick={() => invAction(i.id, 'resend')}>New link</Button>{i.status === 'pending' && <Button size="sm" variant="ghost" icon={<Ban aria-hidden />} onClick={() => invAction(i.id, 'revoke')}>Revoke</Button>}</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </Card>
        )}
      </>}
      {tab === 'roles' && <PermissionMatrix roles={roles.data.roles} onSaved={refresh} />}
      {tab === 'approvals' && <Delegations members={q.data.members} />}
      <ResetLinkDialog result={resetLink} onClose={() => setResetLink(null)} />
      {node}
    </div>
  );
}
