import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, ChevronRight, Truck, UserPlus, FlaskConical, Zap, Wrench, Building2 } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, patch } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Select, ErrorSummary, PageHeader, Banner, LinkButton, useToast } from '../components/ui';
import { ModePicker } from './automation';
import { SERVICE_CATEGORIES, starterService } from '../../shared/services';

export function SetupChecklist({ compact }: { compact?: boolean }) {
  const c = useCompany();
  if (!c.setup) return null;
  const s = c.setup;
  const pct = Math.round((s.done / s.total) * 100);
  return (
    <Card id="setup" title={compact ? 'Finish setting up' : 'Readiness checklist'} actions={compact ? <Link to={c.to('setup')}>Open setup</Link> : undefined}>
      <div className="stack-sm">
        <div className="row-between"><span>{s.done} of {s.total} done{s.ready ? ' · ready to run jobs' : ''}</span><span className="small muted">{pct}%</span></div>
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress"><span style={{ width: `${pct}%` }} /></div>
        <ul className="checklist">
          {s.items.filter((i) => !compact || !i.done).slice(0, compact ? 4 : 20).map((i) => (
            <li key={i.key} className={i.done ? 'done' : ''}>
              <Link to={c.to(i.link)}>{i.done ? <CheckCircle2 aria-hidden /> : <Circle aria-hidden />}<span style={{ flex: 1 }}>{i.label}{i.required ? '' : <span className="muted small"> (optional)</span>}{i.note ? <div className="small muted">{i.note}</div> : null}<span className="sr-only">{i.done ? ' (done)' : ' (to do)'}</span></span><ChevronRight aria-hidden /></Link>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

const STEPS = [
  { key: 'services', label: 'Services', icon: <Wrench aria-hidden /> },
  { key: 'automation', label: 'Automation', icon: <Zap aria-hidden /> },
  { key: 'resources', label: 'Trucks', icon: <Truck aria-hidden /> },
  { key: 'team', label: 'Team', icon: <UserPlus aria-hidden /> },
  { key: 'test', label: 'Test job', icon: <FlaskConical aria-hidden /> },
] as const;

export function Setup() {
  const c = useCompany();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const step = sp.get('step') ?? (c.setup?.step && STEPS.some((s) => s.key === c.setup!.step) ? c.setup.step : 'services');
  const idx = STEPS.findIndex((s) => s.key === step);
  const refresh = () => qc.invalidateQueries({ queryKey: [c.cid] });
  const go = async (k: string) => { setSp({ step: k }); await post(`/c/${c.cid}/setup`, { step: k }).catch(() => {}); };
  const mark = async (m: string) => { await post(`/c/${c.cid}/setup`, { mark: m }); refresh(); };
  const next = () => (idx < STEPS.length - 1 ? go(STEPS[idx + 1].key) : nav(c.to('')));
  const services = useQuery({ queryKey: [c.cid, 'services'], queryFn: () => get(`/c/${c.cid}/services`) });
  const workflows = useQuery({ queryKey: [c.cid, 'workflows'], queryFn: () => get(`/c/${c.cid}/workflows`), enabled: step === 'automation' });
  const [mode, setMode] = useState(c.company.automation_mode);
  const [truck, setTruck] = useState({ name: '', identifier: '', capacity: '' });
  const [inv, setInv] = useState({ email: '', role: 'driver' });
  const [invLink, setInvLink] = useState('');
  const addSvc = useSubmit(async (cat: string) => { await post(`/c/${c.cid}/services`, starterService(cat as any)); refresh(); toast(`${SERVICE_CATEGORIES[cat as keyof typeof SERVICE_CATEGORIES]} service added. Set its rates in Services when you are ready.`); });
  const saveMode = useSubmit(async () => { await patch(`/c/${c.cid}/automation`, { mode }); refresh(); toast('Automation mode saved'); });
  const activateAll = useSubmit(async () => {
    let n = 0;
    for (const w of workflows.data.workflows.filter((x: any) => x.latest_id && !x.active_version_id)) {
      const t = await post(`/c/${c.cid}/workflows/${w.id}/versions/${w.latest_id}/test`, {});
      if (t.ok) { await post(`/c/${c.cid}/workflows/${w.id}/versions/${w.latest_id}/activate`); n++; }
    }
    refresh(); toast(`${n} workflow(s) tested and activated. You can change or pause them any time.`);
  });
  const addTruck = useSubmit(async () => { await post(`/c/${c.cid}/resources`, { kind: 'truck', ...truck }); setTruck({ name: '', identifier: '', capacity: '' }); refresh(); toast('Truck added'); });
  const invite = useSubmit(async () => { const r = await post(`/c/${c.cid}/invitations`, inv); setInvLink(r.link); setInv({ ...inv, email: '' }); refresh(); });
  const testJob = useSubmit(async () => {
    const svc = services.data?.services.find((s: any) => s.active);
    const cust = await post(`/c/${c.cid}/customers`, { name: 'Test customer (setup check)', notes: 'Created during setup to try a job. Safe to cancel.', location: { address: 'Test address — replace or cancel' } });
    const r = await post(`/c/${c.cid}/jobs`, { customerId: cust.id, serviceId: svc?.id ?? null, notes: 'Setup test job. Cancel it when you are done.', intent: 'draft', clientRequestId: `setup-${c.cid}` });
    refresh(); nav(c.to(`jobs/${r.id}`));
  });
  if (!c.can('company.settings')) return <div className="page"><Banner tone="warning">Only owners can change company setup.</Banner></div>;
  const have = new Set((services.data?.services ?? []).map((s: any) => s.category));
  return (
    <div className="page page-narrow">
      <PageHeader title="Set up your company" sub="Do as much as you like now. Progress is saved; come back any time from Home." actions={<LinkButton to={c.to('')}>Finish later</LinkButton>} />
      <ol className="stepper" aria-label="Setup steps">{STEPS.map((s, i) => <li key={s.key} aria-current={s.key === step ? 'step' : undefined}><button type="button" onClick={() => go(s.key)} style={{ border: 0, background: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer', padding: 0 }}>{i + 1}. {s.label}</button></li>)}</ol>
      {step === 'services' && (
        <Card id="s1" title="Which services do you offer?">
          <div className="stack">
            <p className="muted">Each service has its own job form and pricing, and they all share your customers, drivers and trucks. These are editable starting points, not rules.</p>
            <ErrorSummary error={addSvc.error} />
            <ul className="list">{(['fuel', 'portable_toilet', 'septic', 'other'] as const).map((k) => (
              <li key={k} className="row-between" style={{ padding: '10px 0' }}><span>{SERVICE_CATEGORIES[k]}</span>{have.has(k) ? <span className="row small"><CheckCircle2 aria-hidden style={{ color: 'var(--success)', width: 18 }} />Added</span> : <Button size="sm" busy={addSvc.busy} onClick={() => addSvc.run(k)}>Add</Button>}</li>
            ))}</ul>
            <p className="small muted">Set prices later in <Link to={c.to('services')}>Services &amp; pricing</Link>. Invoices are held, not priced at zero, until rates are set.</p>
            <div className="form-actions"><Button variant="primary" onClick={next}>Continue</Button></div>
          </div>
        </Card>
      )}
      {step === 'automation' && (
        <Card id="s2" title="How much should Rigo do for you?">
          <div className="stack">
            <ModePicker value={mode} onChange={setMode} />
            <ErrorSummary error={saveMode.error ?? activateAll.error} />
            <div><Button variant="primary" busy={saveMode.busy} onClick={() => saveMode.run()}>Save mode</Button></div>
            <hr className="divider" />
            <h3>Recommended workflows</h3>
            {workflows.data?.workflows.length ? <ul className="list">{workflows.data.workflows.filter((w: any) => w.latest_id).map((w: any) => <li key={w.id} className="row-between" style={{ padding: '8px 0' }}><span>{w.name}<div className="small muted">{w.description}</div></span>{w.active_version_id ? <span className="small row"><CheckCircle2 aria-hidden style={{ color: 'var(--success)', width: 18 }} />Active</span> : <span className="small muted">Draft</span>}</li>)}</ul> : <p className="muted">No workflows yet. You can add them from Workflows or a template.</p>}
            {workflows.data?.workflows.some((w: any) => w.latest_id && !w.active_version_id) && <div className="stack-sm"><Button busy={activateAll.busy} onClick={() => activateAll.run()}>Test and activate these</Button><span className="small muted">Each one is checked with sample data first. Invoices still need approval before they are issued.</span></div>}
            <div className="form-actions"><Button variant="primary" onClick={() => { mark('automation'); next(); }}>Continue</Button></div>
          </div>
        </Card>
      )}
      {step === 'resources' && (
        <Card id="s3" title="Add a truck or equipment (optional)">
          <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); addTruck.run(); }}>
            <ErrorSummary error={addTruck.error} />
            <div className="grid-2">
              <Field label="Name" id="f-name" error={addTruck.fieldError('name')}>{(p) => <Input {...p} value={truck.name} onChange={(e) => setTruck({ ...truck, name: e.target.value })} />}</Field>
              <Field label="Plate or identifier" optionalText id="f-identifier">{(p) => <Input {...p} value={truck.identifier} onChange={(e) => setTruck({ ...truck, identifier: e.target.value })} />}</Field>
            </div>
            <div className="form-actions"><Button type="submit" busy={addTruck.busy}>Add truck</Button><Button variant="primary" onClick={next}>Continue</Button><Button variant="ghost" onClick={() => { mark('resourcesSkipped'); next(); }}>Skip for now</Button></div>
          </form>
        </Card>
      )}
      {step === 'team' && (
        <Card id="s4" title="Invite your team (optional)">
          <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); invite.run(); }}>
            <p className="muted">Employees join with their own account through a single-use link. They don't create a company or go through the demo.</p>
            <ErrorSummary error={invite.error} />
            <div className="grid-2">
              <Field label="Email" id="f-email" error={invite.fieldError('email')}>{(p) => <Input {...p} type="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} />}</Field>
              <Field label="Role" id="f-role">{(p) => <Select {...p} value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>{c.roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</Select>}</Field>
            </div>
            {invLink && <Banner tone="success" title="Invitation created">Share this link: <span className="wrap-anywhere">{invLink}</span></Banner>}
            <div className="form-actions"><Button type="submit" busy={invite.busy}>Create invitation</Button><Button variant="primary" onClick={next}>Continue</Button><Button variant="ghost" onClick={() => { mark('teamSkipped'); next(); }}>Skip for now</Button></div>
          </form>
        </Card>
      )}
      {step === 'test' && (
        <Card id="s5" title="Try a test job (optional)">
          <div className="stack">
            <p>Creates a clearly labeled test customer and a draft job so you can try assigning, completing and invoicing. Cancel it afterwards. If you'd rather practice with fictional data, use the demo instead.</p>
            <ErrorSummary error={testJob.error} />
            <div className="form-actions"><Button variant="primary" busy={testJob.busy} onClick={() => testJob.run()}>Create a test job</Button><Button variant="ghost" onClick={async () => { await mark('testJobSkipped'); await mark('completed'); nav(c.to('')); }}>Skip and finish</Button></div>
          </div>
        </Card>
      )}
      <SetupChecklist />
      <p className="small muted row"><Building2 aria-hidden style={{ width: 16 }} />Company basics, branding and custom fields are in <Link to={c.to('settings')}>Settings</Link>. A logo is optional.</p>
    </div>
  );
}
