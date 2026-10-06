import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Zap, Filter, FileText, Mail, Bell, Send, Copy, ShieldCheck, Trash2, ArrowUp, ArrowDown, FlaskConical, Play, PauseCircle, PlayCircle, Save, Bot, CheckCircle2, AlertTriangle, ListChecks, Workflow as WorkflowIcon } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, put, patch } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Select, ErrorSummary, LoadingBlock, ErrorState, PageHeader, Empty, Pill, Banner, Checkbox, Segmented, Dialog, LinkButton, useToast, useConfirm } from '../components/ui';
import { relTime, fmtDateTime } from '../lib/format';
import { ACTIONS, TRIGGERS, CONDITION_FIELDS, OPERATORS, type Definition, type Step, type Condition } from '../../shared/workflows';

const VERSION_TONE: Record<string, any> = { draft: 'neutral', tested: 'info', active: 'success', retired: 'neutral', proposal: 'demo' };
const actionIcon = (a: string) => a.startsWith('invoice') ? <FileText aria-hidden /> : a === 'message.send' ? <Send aria-hidden /> : a.startsWith('message') ? <Mail aria-hidden /> : a === 'notify' ? <Bell aria-hidden /> : <Copy aria-hidden />;

export function Workflows() {
  const c = useCompany();
  const nav = useNavigate();
  const q = useQuery({ queryKey: [c.cid, 'workflows'], queryFn: () => get(`/c/${c.cid}/workflows`) });
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const create = useSubmit(async () => { const r = await post(`/c/${c.cid}/workflows`, { name }); nav(c.to(`workflows/${r.id}`)); });
  if (q.isLoading) return <div className="page"><LoadingBlock /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} /></div>;
  const wfs = q.data.workflows;
  const proposals = wfs.filter((w: any) => !w.latest_id);
  const regular = wfs.filter((w: any) => w.latest_id);
  return (
    <div className="page">
      <PageHeader title="Workflows" sub="What Rigo does when something happens. Edit with forms, the visual builder or the assistant; all three change the same versioned draft."
        actions={<>{c.can('assistant.use') && c.can('workflows.edit') && <LinkButton to={c.to('assistant')} icon={<Bot aria-hidden />}>Describe one to the assistant</LinkButton>}{c.can('workflows.edit') && <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setOpen(true)}>New workflow</Button>}</>} />
      {regular.length === 0 && proposals.length === 0 ? <Card><Empty icon={<WorkflowIcon aria-hidden />} title="No workflows yet">Workflows prepare invoices, notify your team and more. Start one here, ask the assistant, or apply a template.</Empty></Card> : (
        <div className="card card-flush"><ul className="list">{regular.map((w: any) => (
          <li key={w.id}><Link className="list-item" to={c.to(`workflows/${w.id}`)}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="row"><strong>{w.name}</strong>{w.active_version_id ? <Pill tone="success">Active v{w.active_version}</Pill> : <Pill tone="neutral">Not active</Pill>}{w.latest_version !== w.active_version && <Pill tone={VERSION_TONE[w.latest_status]}>v{w.latest_version} {w.latest_status}</Pill>}{w.paused ? <Pill tone="warning" icon={<PauseCircle aria-hidden />}>Paused</Pill> : null}{w.mode_override ? <Pill tone="brand">Always {w.mode_override}</Pill> : null}</span>
              <div className="small muted">{w.description}</div>
              {w.active_explanation && <div className="small" style={{ marginTop: 4 }}>{w.active_explanation[0]}</div>}
            </span>
            {w.open_runs ? <span className="small muted">{w.open_runs} open run(s)</span> : null}
          </Link></li>
        ))}</ul></div>
      )}
      {proposals.length > 0 && (
        <Card id="props" title="Proposals from the assistant">
          <p className="muted">Proposals are not part of your configuration until you accept them as drafts.</p>
          <ul className="list">{proposals.map((w: any) => <li key={w.id}><Link className="list-item" style={{ paddingLeft: 0 }} to={c.to(`workflows/${w.id}`)}><span style={{ flex: 1 }}><strong>{w.name}</strong><div className="small muted">{w.description}</div></span><Pill tone="demo">Proposed</Pill></Link></li>)}</ul>
        </Card>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="New workflow" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" busy={create.busy} onClick={() => create.run()}>Create draft</Button></>}>
        <div className="stack"><ErrorSummary error={create.error} /><Field label="Name" id="f-name" error={create.fieldError('name')}>{(p) => <Input {...p} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}</Field><p className="muted small">It starts as a draft with one example step. Nothing runs until you test and activate it.</p></div>
      </Dialog>
    </div>
  );
}

const blankApproval = { required: 'never' as const, conditions: [], approverRoles: [], approverUserIds: [], backupUserIds: [], escalateAfterHours: null };

function ConditionRow({ cnd, onChange, onRemove, idp }: { cnd: Condition; onChange: (c: Condition) => void; onRemove: () => void; idp: string }) {
  const f = CONDITION_FIELDS[cnd.field] as any;
  return (
    <div className="row" style={{ alignItems: 'flex-end' }}>
      <Field label="Field" id={`${idp}-f`}>{(p) => <Select {...p} value={cnd.field} onChange={(e) => onChange({ ...cnd, field: e.target.value as any, value: '' })}>{Object.entries(CONDITION_FIELDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>}</Field>
      <Field label="Comparison" id={`${idp}-o`}>{(p) => <Select {...p} value={cnd.op} onChange={(e) => onChange({ ...cnd, op: e.target.value as any })}>{Object.entries(OPERATORS).filter(([k]) => f.type === 'number' || ['eq', 'neq', 'contains'].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
      <Field label="Value" id={`${idp}-v`}>{(p) => f.type === 'select' ? <Select {...p} value={String(cnd.value)} onChange={(e) => onChange({ ...cnd, value: e.target.value })}><option value="">Choose…</option>{f.options.map((o: string) => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}</Select>
        : f.type === 'boolean' ? <Select {...p} value={String(cnd.value)} onChange={(e) => onChange({ ...cnd, value: e.target.value === 'true' })}><option value="true">Yes</option><option value="false">No</option></Select>
        : <Input {...p} inputMode={f.type === 'number' ? 'numeric' : undefined} value={String(cnd.value)} onChange={(e) => onChange({ ...cnd, value: f.type === 'number' ? Number(e.target.value) || 0 : e.target.value })} />}</Field>
      <Button size="sm" variant="ghost" aria-label="Remove condition" onClick={onRemove}><Trash2 aria-hidden /></Button>
    </div>
  );
}

function RoleChecks({ value, onChange, legend, roles }: { value: string[]; onChange: (v: string[]) => void; legend: string; roles: { key: string; name: string }[] }) {
  return (
    <fieldset><legend className="small">{legend}</legend><div className="row">{roles.map((r) => <Checkbox key={r.key} label={r.name} checked={value.includes(r.key)} onChange={(e) => onChange(e.target.checked ? [...value, r.key] : value.filter((x) => x !== r.key))} />)}</div></fieldset>
  );
}

function StepEditor({ step, index, onChange }: { step: Step; index: number; onChange: (s: Step) => void }) {
  const c = useCompany();
  const meta = ACTIONS[step.action];
  const approvers = c.members.filter((m) => ['owner', 'office', 'dispatcher'].includes(m.role_key));
  const idp = `f-step-${index}`;
  return (
    <div className="stack">
      <Field label="Action" id={`${idp}-action`}>{(p) => <Select {...p} value={step.action} onChange={(e) => onChange({ ...step, action: e.target.value, params: e.target.value === 'notify' ? { roles: ['owner'], text: 'Update from Rigo' } : {} })}>{Object.entries(ACTIONS).map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}</Select>}</Field>
      <p className="small muted" style={{ margin: 0 }}>{meta.description} <strong>{meta.kind === 'commit' ? 'Commits a change.' : 'Prepares only.'}</strong></p>
      {step.action === 'notify' && <>
        <RoleChecks legend="Notify roles" roles={c.roles} value={step.params.roles ?? []} onChange={(roles) => onChange({ ...step, params: { ...step.params, roles } })} />
        <Checkbox label="Notify the assigned driver" checked={!!step.params.assignee} onChange={(e) => onChange({ ...step, params: { ...step.params, assignee: e.target.checked } })} />
        <Field label="Message" id={`${idp}-text`}>{(p) => <Input {...p} maxLength={300} value={step.params.text ?? ''} onChange={(e) => onChange({ ...step, params: { ...step.params, text: e.target.value } })} />}</Field>
      </>}
      <Field label="Automation mode for this step" id={`${idp}-mode`} hint="Inherit uses the workflow or company setting.">{(p) => <Select {...p} value={step.mode ?? ''} onChange={(e) => onChange({ ...step, mode: (e.target.value || null) as any })}><option value="">Inherit</option><option value="manual">Always manual</option><option value="assisted">Always assisted</option><option value="automatic">Always automatic</option></Select>}</Field>
      <fieldset className="card" style={{ padding: 12 }}>
        <legend className="row" style={{ padding: '0 4px' }}><ShieldCheck aria-hidden style={{ width: 16 }} />Approval</legend>
        <Field label="Needs approval" id={`${idp}-req`}>{(p) => <Select {...p} value={step.approval.required} onChange={(e) => onChange({ ...step, approval: { ...step.approval, required: e.target.value as any } })}><option value="never">Never</option><option value="always">Always</option><option value="conditional">Only when…</option></Select>}</Field>
        {step.approval.required === 'conditional' && (
          <div className="stack-sm" style={{ marginTop: 8 }}>
            {step.approval.conditions.map((cnd, ci) => <ConditionRow key={ci} idp={`${idp}-ac-${ci}`} cnd={cnd} onChange={(n) => onChange({ ...step, approval: { ...step.approval, conditions: step.approval.conditions.map((x, y) => (y === ci ? n : x)) } })} onRemove={() => onChange({ ...step, approval: { ...step.approval, conditions: step.approval.conditions.filter((_, y) => y !== ci) } })} />)}
            <div><Button size="sm" icon={<Plus aria-hidden />} onClick={() => onChange({ ...step, approval: { ...step.approval, conditions: [...step.approval.conditions, { field: 'invoice.total_minor', op: 'gt', value: 50000 }] } })}>Add condition</Button></div>
          </div>
        )}
        {step.approval.required !== 'never' && <div className="stack-sm" style={{ marginTop: 8 }}>
          <RoleChecks legend="Approver roles" roles={c.roles} value={step.approval.approverRoles} onChange={(approverRoles) => onChange({ ...step, approval: { ...step.approval, approverRoles } })} />
          <fieldset><legend className="small">Named approvers</legend><div className="row">{approvers.map((m) => <Checkbox key={m.id} label={m.name} checked={step.approval.approverUserIds.includes(m.id)} onChange={(e) => onChange({ ...step, approval: { ...step.approval, approverUserIds: e.target.checked ? [...step.approval.approverUserIds, m.id] : step.approval.approverUserIds.filter((x) => x !== m.id) } })} />)}</div></fieldset>
          <fieldset><legend className="small">Backup approvers (after escalation)</legend><div className="row">{approvers.map((m) => <Checkbox key={m.id} label={m.name} checked={step.approval.backupUserIds.includes(m.id)} onChange={(e) => onChange({ ...step, approval: { ...step.approval, backupUserIds: e.target.checked ? [...step.approval.backupUserIds, m.id] : step.approval.backupUserIds.filter((x) => x !== m.id) } })} />)}</div></fieldset>
          <Field label="Escalate after (hours)" optionalText id={`${idp}-esc`} hint="Escalation alerts backups and owners. It never approves anything.">{(p) => <Input {...p} inputMode="numeric" value={step.approval.escalateAfterHours ?? ''} onChange={(e) => onChange({ ...step, approval: { ...step.approval, escalateAfterHours: e.target.value ? Math.max(1, Number(e.target.value) || 1) : null } })} />}</Field>
        </div>}
      </fieldset>
      <fieldset className="card" style={{ padding: 12 }}>
        <legend style={{ padding: '0 4px' }}>If this step cannot finish</legend>
        <RoleChecks legend="Notify" roles={c.roles} value={step.onException.notifyRoles} onChange={(notifyRoles) => onChange({ ...step, onException: { ...step.onException, notifyRoles } })} />
        <Field label="Then" id={`${idp}-stop`}>{(p) => <Select {...p} value={step.onException.stop ? 'stop' : 'continue'} onChange={(e) => onChange({ ...step, onException: { ...step.onException, stop: e.target.value === 'stop' } })}><option value="stop">Stop the workflow</option><option value="continue">Continue with the next step</option></Select>}</Field>
      </fieldset>
    </div>
  );
}

export function WorkflowEditor() {
  const c = useCompany();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { ask, node } = useConfirm();
  const [sp, setSp] = useSearchParams();
  const view = (sp.get('view') ?? 'visual') as 'visual' | 'form' | 'versions';
  const q = useQuery({ queryKey: [c.cid, 'workflow', id], queryFn: () => get(`/c/${c.cid}/workflows/${id}`) });
  const working = useMemo(() => q.data?.versions.find((v: any) => ['draft', 'tested', 'active'].includes(v.status)), [q.data]);
  const [def, setDef] = useState<Definition | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<string>('trigger');
  useEffect(() => { if (working) { setDef(structuredClone(working.definition)); setDirty(false); } }, [working?.id, working?.definition]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => qc.invalidateQueries({ queryKey: [c.cid] });
  const edit = (d: Definition) => { setDef(d); setDirty(true); };
  const save = useSubmit(async () => {
    const r = await put(`/c/${c.cid}/workflows/${id}/draft`, { definition: def, baseVersionId: working.id, source: view === 'visual' ? 'visual' : 'form' });
    toast(r.newVersion ? `Saved as new draft v${r.version}. Test it before activating.` : 'Draft saved. Test it before activating.');
    setDirty(false); refresh();
  });
  const test = useSubmit(async () => { const r = await post(`/c/${c.cid}/workflows/${id}/versions/${working.id}/test`, {}); toast(r.ok ? 'Test finished. Review the results.' : 'Validation failed. Fix the errors and test again.', r.ok ? 'success' : 'error'); refresh(); });
  const activate = useSubmit(async () => {
    const runs = q.data.runs.filter((r: any) => ['running', 'waiting'].includes(r.status)).length;
    if (!(await ask({ title: `Activate version ${working.version}?`, body: <>It will start responding to “{TRIGGERS[def!.trigger.event].label.toLowerCase()}”. {runs ? `${runs} run(s) of the previous version are still open; their remaining steps will be blocked and you can finish them by hand.` : ''} Rigo acts on your behalf and rechecks your permissions every time.</>, confirm: 'Activate' }))) return;
    await post(`/c/${c.cid}/workflows/${id}/versions/${working.id}/activate`); toast('Workflow activated'); refresh();
  });
  const deactivate = useSubmit(async () => { await post(`/c/${c.cid}/workflows/${id}/deactivate`); toast('Workflow deactivated. Nothing new will start.'); refresh(); });
  const setWf = useSubmit(async (body: any) => { await patch(`/c/${c.cid}/workflows/${id}`, body); refresh(); });
  const accept = useSubmit(async () => { await post(`/c/${c.cid}/workflows/proposals/${proposal.id}/accept`); toast('Accepted as a draft. Test it, then activate when ready.'); refresh(); });
  if (q.isLoading) return <div className="page"><LoadingBlock /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} /></div>;
  const wf = q.data.workflow;
  const proposal = q.data.versions.find((v: any) => v.status === 'proposal');
  if (!working && proposal) {
    return (
      <div className="page page-narrow">
        <PageHeader back={{ to: c.to('workflows'), label: 'Workflows' }} title={wf.name} sub={wf.description} />
        <Banner tone="info" title="This is a proposal">It is not part of your configuration. Accepting makes it a draft that you then test and activate yourself.</Banner>
        <Card id="exp" title="What it would do"><ol className="stack-sm" style={{ paddingLeft: 18, margin: 0 }}>{proposal.explanation.map((l: string, i: number) => <li key={i} style={{ listStyle: i === 0 ? 'none' : undefined, marginLeft: i === 0 ? -18 : 0 }}>{l}</li>)}</ol></Card>
        <Validation v={proposal.validation} />
        <ErrorSummary error={accept.error} />
        {c.can('workflows.edit') && <div><Button variant="primary" busy={accept.busy} onClick={() => accept.run()}>Accept as draft</Button></div>}
      </div>
    );
  }
  if (!def || !working) return <div className="page"><LoadingBlock /></div>;
  const canEdit = c.can('workflows.edit');
  const active = q.data.versions.find((v: any) => v.status === 'active');
  const setStep = (i: number, s: Step) => edit({ ...def, steps: def.steps.map((x, y) => (y === i ? s : x)) });
  const addStep = (at: number) => {
    const sid = `step${Date.now().toString(36).slice(-5)}`;
    const steps = [...def.steps]; steps.splice(at, 0, { id: sid, action: 'notify', params: { roles: ['owner'], text: 'Update from Rigo' }, mode: null, approval: { ...blankApproval }, onException: { notifyRoles: ['owner'], stop: true } });
    edit({ ...def, steps }); setSel(sid);
  };
  const moveStep = (i: number, d: number) => { const s = [...def.steps]; const j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; edit({ ...def, steps: s }); };
  const removeStep = (i: number) => { edit({ ...def, steps: def.steps.filter((_, y) => y !== i) }); setSel('trigger'); };
  const selIndex = def.steps.findIndex((s) => s.id === sel);
  const triggerEditor = (
    <div className="stack">
      <Field label="When" id="f-trigger">{(p) => <Select {...p} value={def.trigger.event} onChange={(e) => edit({ ...def, trigger: { event: e.target.value as any } })}>{Object.entries(TRIGGERS).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</Select>}</Field>
      <div className="stack-sm"><span className="label">Only if (all must match)</span>
        {def.conditions.map((cnd, i) => <ConditionRow key={i} idp={`f-cond-${i}`} cnd={cnd} onChange={(n) => edit({ ...def, conditions: def.conditions.map((x, y) => (y === i ? n : x)) })} onRemove={() => edit({ ...def, conditions: def.conditions.filter((_, y) => y !== i) })} />)}
        <div><Button size="sm" icon={<Plus aria-hidden />} onClick={() => edit({ ...def, conditions: [...def.conditions, { field: 'job.service_category', op: 'eq', value: 'fuel' }] })}>Add condition</Button></div>
      </div>
    </div>
  );
  const stepPanel = (i: number) => (
    <div className="stack">
      <div className="row-between"><h3>Step {i + 1}</h3><span className="row">
        <Button size="sm" variant="ghost" aria-label="Move step up" disabled={i === 0} onClick={() => moveStep(i, -1)}><ArrowUp aria-hidden /></Button>
        <Button size="sm" variant="ghost" aria-label="Move step down" disabled={i === def.steps.length - 1} onClick={() => moveStep(i, 1)}><ArrowDown aria-hidden /></Button>
        <Button size="sm" variant="danger" icon={<Trash2 aria-hidden />} disabled={def.steps.length === 1} onClick={() => removeStep(i)}>Remove</Button></span></div>
      <StepEditor step={def.steps[i]} index={i} onChange={(s) => setStep(i, s)} />
    </div>
  );
  return (
    <div className="page">
      <PageHeader back={{ to: c.to('workflows'), label: 'Workflows' }} docTitle={wf.name} title={<span className="row">{wf.name}<Pill tone={VERSION_TONE[working.status]}>v{working.version} {working.status}</Pill>{dirty ? <Pill tone="warning">Unsaved changes</Pill> : null}</span>}
        sub={active ? `Active: v${active.version}, activated ${relTime(active.activatedAt)}${active.activatedByName ? ` by ${active.activatedByName}` : ''}` : 'Not active'}
        actions={<>
          {c.can('automation.control') && (wf.paused ? <Button icon={<PlayCircle aria-hidden />} onClick={() => setWf.run({ paused: false })}>Resume workflow</Button> : <Button icon={<PauseCircle aria-hidden />} onClick={() => setWf.run({ paused: true })}>Pause workflow</Button>)}
          {c.can('workflows.activate') && wf.active_version_id && <Button variant="danger" busy={deactivate.busy} onClick={() => deactivate.run()}>Deactivate</Button>}
        </>} />
      {wf.paused && <Banner tone="warning">This workflow is paused. Its queued steps are held and nothing new starts until you resume it.</Banner>}
      <ErrorSummary error={save.error ?? test.error ?? activate.error ?? setWf.error} />
      <Segmented label="Editor view" value={view} onChange={(k) => setSp({ view: k })} options={[{ key: 'visual', label: 'Visual builder', icon: <WorkflowIcon aria-hidden /> }, { key: 'form', label: 'Form', icon: <ListChecks aria-hidden /> }, { key: 'versions', label: 'Versions & runs' }]} />
      <div className="grid-2" style={{ alignItems: 'start', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
        <fieldset disabled={!canEdit} style={{ minWidth: 0 }}>
          {view === 'visual' && (
            <div className="grid-2" style={{ alignItems: 'start' }}>
              <div className="flow" role="list" aria-label="Workflow steps">
                <div role="listitem"><button type="button" className="flow-node trigger" aria-current={sel === 'trigger'} onClick={() => setSel('trigger')}><span className="icon"><Zap aria-hidden /></span><span><span className="kind">Trigger</span><br /><strong>{TRIGGERS[def.trigger.event].label}</strong>{def.conditions.length ? <div className="small muted row" style={{ gap: 4 }}><Filter aria-hidden style={{ width: 14 }} />{def.conditions.length} condition(s)</div> : null}</span></button></div>
                {def.steps.map((s, i) => (
                  <div key={s.id} role="listitem">
                    <div className="flow-connector" aria-hidden />
                    {canEdit && <Button size="sm" variant="ghost" className="flow-add" icon={<Plus aria-hidden />} onClick={() => addStep(i)}>Add step here</Button>}
                    <div className="flow-connector" aria-hidden />
                    <button type="button" className="flow-node" aria-current={sel === s.id} onClick={() => setSel(s.id)}>
                      <span className="icon">{actionIcon(s.action)}</span>
                      <span><span className="kind">Step {i + 1}{s.mode ? ` · always ${s.mode}` : ''}</span><br /><strong>{ACTIONS[s.action].label}</strong>
                        {s.approval.required !== 'never' && <div className="flow-approval"><ShieldCheck aria-hidden style={{ width: 14 }} />{s.approval.required === 'always' ? 'Needs approval' : 'Approval when conditions match'}</div>}</span>
                    </button>
                  </div>
                ))}
                {canEdit && <><div className="flow-connector" aria-hidden /><Button size="sm" className="flow-add" icon={<Plus aria-hidden />} onClick={() => addStep(def.steps.length)}>Add step at end</Button></>}
              </div>
              <div className="card" aria-live="polite">{sel === 'trigger' ? triggerEditor : selIndex >= 0 ? stepPanel(selIndex) : triggerEditor}</div>
            </div>
          )}
          {view === 'form' && (
            <div className="stack">
              <Card id="trig" title="Trigger and conditions">{triggerEditor}</Card>
              {def.steps.map((_, i) => <Card key={def.steps[i].id} id={`s${i}`}>{stepPanel(i)}</Card>)}
              {canEdit && <div><Button icon={<Plus aria-hidden />} onClick={() => addStep(def.steps.length)}>Add step</Button></div>}
            </div>
          )}
          {view === 'versions' && (
            <div className="stack">
              <Card id="vers" title="Versions"><ul className="list">{q.data.versions.map((v: any) => <li key={v.id} style={{ padding: '8px 0' }} className="row-between"><span>v{v.version} · {v.source}<div className="small muted">Created {fmtDateTime(v.createdAt)}{v.createdByName ? ` by ${v.createdByName}` : ''}{v.testedAt ? ` · tested ${relTime(v.testedAt)}` : ''}</div></span><Pill tone={VERSION_TONE[v.status]}>{v.status}</Pill></li>)}</ul></Card>
              <Card id="runs" title="Recent runs">{q.data.runs.length === 0 ? <p className="muted">No runs yet.</p> : <ul className="list">{q.data.runs.map((r: any) => <li key={r.id} style={{ padding: '8px 0' }}><div className="row-between"><span>v{r.version} · {relTime(r.created_at)}</span><Pill tone={r.status === 'completed' ? 'success' : r.status === 'failed' ? 'danger' : r.status === 'blocked' ? 'warning' : 'neutral'}>{r.status.replace('_', ' ')}</Pill></div><div className="small muted">{r.summary}</div></li>)}</ul>}</Card>
            </div>
          )}
        </fieldset>
        <div className="stack">
          <Card id="explain" title="In plain language">
            <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }} className="stack-sm">{(dirty ? null : working.explanation)?.map((l: string, i: number) => <li key={i} className="pre">{l}</li>) ?? <li className="muted">Save the draft to refresh the explanation and validation.</li>}</ol>
          </Card>
          {!dirty && <Validation v={working.validation} />}
          <Card id="test" title="Test and activate">
            <div className="stack-sm">
              <ol className="stepper" aria-label="Lifecycle"><li className={working.status !== 'draft' || !dirty ? 'done' : ''} aria-current={dirty ? 'step' : undefined}>1. Save draft</li><li className={working.testedCurrent ? 'done' : ''} aria-current={!dirty && !working.testedCurrent ? 'step' : undefined}>2. Test</li><li className={working.status === 'active' ? 'done' : ''} aria-current={!dirty && working.testedCurrent && working.status !== 'active' ? 'step' : undefined}>3. Activate</li></ol>
              {canEdit && <Button variant={dirty ? 'primary' : 'default'} icon={<Save aria-hidden />} busy={save.busy} disabled={!dirty} onClick={() => save.run()}>{['tested', 'active'].includes(working.status) ? 'Save as new draft version' : 'Save draft'}</Button>}
              {canEdit && <Button icon={<FlaskConical aria-hidden />} busy={test.busy} disabled={dirty} onClick={() => test.run()}>Test with sample data</Button>}
              {c.can('workflows.activate') && working.status !== 'active' && <Button variant="primary" icon={<Play aria-hidden />} busy={activate.busy} disabled={dirty || !working.testedCurrent || !working.validation.ok} onClick={() => activate.run()}>Activate v{working.version}</Button>}
              {dirty && <p className="small muted">Save before testing. Editing a tested version creates a new draft that must be tested again.</p>}
              {c.can('workflows.activate') && (
                <Field label="Automation mode for this workflow" id="f-override" hint="Overrides the company mode for every step without its own setting.">{(p) => <Select {...p} value={wf.mode_override ?? ''} onChange={(e) => setWf.run({ modeOverride: e.target.value || null })}><option value="">Use company mode ({c.company.automation_mode})</option><option value="manual">Manual</option><option value="assisted">Assisted</option><option value="automatic">Automatic</option></Select>}</Field>
              )}
            </div>
          </Card>
          {working.testResult?.modes && !dirty && (
            <Card id="results" title="Test results">
              <p className="small muted">{working.testResult.note} Sample: {working.testResult.sample?.serviceName ?? 'no matching service'}{working.testResult.sample?.['invoice.held'] ? ' (rates missing)' : ''}.</p>
              {working.testResult.modes.map((m: any) => (
                <details key={m.mode} open={m.mode === working.testResult.currentMode}>
                  <summary><strong>{m.mode[0].toUpperCase() + m.mode.slice(1)} mode</strong>{m.mode === working.testResult.currentMode ? ' (current)' : ''}</summary>
                  <p className="small">{m.summary}</p>
                  <ol className="small">{m.steps.map((s: any) => <li key={s.step}>{s.label}: {s.outcome}</li>)}</ol>
                </details>
              ))}
            </Card>
          )}
        </div>
      </div>
      {node}
    </div>
  );
}

function Validation({ v }: { v: any }) {
  if (!v || (!v.errors?.length && !v.warnings?.length && v.ok === undefined)) return null;
  return (
    <Card id="valid" title="Validation">
      {v.ok && !v.warnings?.length ? <p className="row" style={{ margin: 0 }}><CheckCircle2 aria-hidden style={{ color: 'var(--success)' }} />No problems found.</p> : null}
      {v.errors?.length ? <Banner tone="danger" title="Errors (must fix)"><ul style={{ margin: 0 }}>{v.errors.map((e: string) => <li key={e}>{e}</li>)}</ul></Banner> : null}
      {v.warnings?.length ? <div style={{ marginTop: 8 }}><Banner tone="warning" title="Warnings"><ul style={{ margin: 0 }}>{v.warnings.map((e: string) => <li key={e}>{e}</li>)}</ul></Banner></div> : null}
    </Card>
  );
}
