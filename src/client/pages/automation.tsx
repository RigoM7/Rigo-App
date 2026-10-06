import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PauseCircle, PlayCircle, Hand, Play, X, Plug, CheckCircle2, FlaskConical, Ban } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, patch, post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Tabs, LoadingBlock, ErrorState, Empty, ActionStatus, Dialog, ErrorSummary, Pill, useToast, useConfirm } from '../components/ui';
import { relTime } from '../lib/format';
import { MODE_HELP, type Mode } from '../../shared/workflows';

export function ModePicker({ value, onChange, disabled }: { value: Mode; onChange: (m: Mode) => void; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled}>
      <legend className="sr-only">Automation mode</legend>
      <div className="radio-cards">
        {(['manual', 'assisted', 'automatic'] as Mode[]).map((m) => (
          <label key={m} className="radio-card">
            <input type="radio" name="mode" checked={value === m} onChange={() => onChange(m)} />
            <span><strong>{m === 'manual' ? 'Manual' : m === 'assisted' ? 'Assisted' : 'Automatic'}</strong><br /><span className="small muted">{MODE_HELP[m]}</span></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function CapabilityList() {
  const c = useCompany();
  const labels: Record<string, string> = { email: 'Customer email', sms: 'Text messages', ai: 'AI assistant', payments: 'Payment processing', maps: 'Maps and routing', fileStorage: 'File storage' };
  return (
    <ul className="list">
      {Object.entries(c.capabilities).map(([k, cap]) => (
        <li key={k} className="list-item" style={{ paddingLeft: 0, paddingRight: 0 }}>
          {cap.state === 'available' ? <CheckCircle2 aria-hidden style={{ color: 'var(--success)', width: 20 }} /> : cap.state === 'simulated' ? <FlaskConical aria-hidden style={{ width: 20 }} /> : <Ban aria-hidden style={{ color: 'var(--text-3)', width: 20 }} />}
          <span style={{ flex: 1 }}><strong>{labels[k] ?? k}</strong><div className="small muted">{cap.reason}</div></span>
          <Pill tone={cap.state === 'available' ? 'success' : cap.state === 'simulated' ? 'demo' : 'neutral'}>{cap.state === 'available' ? 'Available' : cap.state === 'simulated' ? 'Simulated' : 'Not enabled'}</Pill>
        </li>
      ))}
    </ul>
  );
}

function subjectLink(c: ReturnType<typeof useCompany>, a: any) {
  if (a.subject_type === 'job') return c.can('jobs.view_all') ? c.to(`jobs/${a.subject_id}`) : null;
  if (a.subject_type === 'invoice') return c.can('invoices.view') ? c.to(`invoices/${a.subject_id}`) : null;
  if (a.subject_type === 'message') return c.can('messages.view') ? c.to('messages') : null;
  return null;
}

export function Automation() {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const { ask, node } = useConfirm();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') ?? 'queue') as 'queue' | 'runs' | 'history' | 'services';
  const [pauseOpen, setPauseOpen] = useState(false);
  const q = useQuery({ queryKey: [c.cid, 'automation'], queryFn: () => get(`/c/${c.cid}/automation`), refetchInterval: 10_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: [c.cid] });
  const setMode = useSubmit(async (mode: Mode) => { await patch(`/c/${c.cid}/automation`, { mode }); refresh(); toast(`Automation mode set to ${mode}. Approval rules still apply.`); });
  const pause = useSubmit(async (queued: 'hold' | 'cancel') => { const r = await patch(`/c/${c.cid}/automation`, { paused: true, queued }); setPauseOpen(false); refresh(); toast(queued === 'cancel' ? `Paused. ${r.cancelled} waiting step(s) cancelled.` : 'Paused. Queued steps are held.'); });
  const resume = useSubmit(async () => { await patch(`/c/${c.cid}/automation`, { paused: false }); refresh(); toast('Automation resumed. Held steps will continue.'); });
  const act = useSubmit(async (id: string, what: 'run' | 'dismiss') => { await post(`/c/${c.cid}/automation/actions/${id}/${what}`); refresh(); toast(what === 'run' ? 'Step started.' : 'Step dismissed; the workflow run stops.'); });
  const takeover = async (id: string) => {
    if (!(await ask({ title: 'Take over this run?', body: 'Rigo stops this run. Its waiting steps and approval requests are cancelled, and you finish the work yourself. Steps already completed stay completed.', confirm: 'Take over' }))) return;
    await post(`/c/${c.cid}/automation/runs/${id}/takeover`); refresh(); toast('You took over. Rigo will not continue this run.');
  };
  if (q.isLoading) return <div className="page"><LoadingBlock /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} retry={() => q.refetch()} /></div>;
  const d = q.data;
  const highlight = sp.get('action');
  return (
    <div className="page">
      <div className="page-header">
        <div><h1>Automation</h1><div className="sub">What Rigo is preparing, waiting on and doing, and the controls to change it.</div></div>
        {c.can('automation.control') && (d.paused
          ? <Button variant="primary" icon={<PlayCircle aria-hidden />} busy={resume.busy} onClick={() => resume.run()}>Resume automation</Button>
          : <Button icon={<PauseCircle aria-hidden />} onClick={() => setPauseOpen(true)}>Pause all automation</Button>)}
      </div>
      {d.paused && <div className="banner banner-warning"><PauseCircle aria-hidden /><span><strong>Paused {d.pausedAt ? relTime(d.pausedAt) : ''}.</strong> Nothing new runs. Queued steps are held until you resume. Pausing does not undo completed steps.</span></div>}
      <Card id="mode" title="How much Rigo automates">
        <ModePicker value={d.mode} onChange={(m) => setMode.run(m)} disabled={!c.can('company.settings') || setMode.busy} />
        <p className="small muted" style={{ marginTop: 12 }}>Workflows and individual steps can override this. Automatic never skips approvals and never turns on services that are not enabled.</p>
        <ErrorSummary error={setMode.error} />
      </Card>
      <Tabs label="Automation activity" value={tab} onChange={(k) => setSp({ tab: k })} tabs={[
        { key: 'queue', label: `Waiting and queued (${d.waiting.length})` }, { key: 'runs', label: `Active runs (${d.runs.length})` }, { key: 'history', label: 'History' }, { key: 'services', label: 'Connected services' },
      ]} />
      <ErrorSummary error={act.error} />
      {tab === 'queue' && (d.waiting.length === 0 ? <Card><Empty title="Nothing waiting">When a workflow prepares or proposes something, it appears here and in the inbox.</Empty></Card> : (
        <div className="card card-flush"><ul className="list">{d.waiting.map((a: any) => {
          const link = subjectLink(c, a);
          return (
            <li key={a.id} className="list-item" style={highlight === a.id ? { background: 'var(--primary-soft)' } : undefined}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div className="row"><strong>{a.label}</strong><ActionStatus status={a.status} held={d.paused || a.workflow_paused} /></div>
                <div className="small">{link ? <Link to={link}>{a.subject_label}</Link> : a.subject_label}{a.workflow_name ? ` · ${a.workflow_name}` : ''} · {a.mode} mode · {relTime(a.created_at)}</div>
                <div className="small muted">{a.explanation}</div>
                {['suggested', 'proposed'].includes(a.status) && (
                  <div className="row" style={{ marginTop: 6 }}>
                    <Button size="sm" variant="primary" icon={a.status === 'suggested' ? <Hand aria-hidden /> : <Play aria-hidden />} busy={act.busy} onClick={() => act.run(a.id, 'run')}>{a.status === 'suggested' ? 'Do it now' : 'Run it'}</Button>
                    <Button size="sm" variant="ghost" icon={<X aria-hidden />} onClick={() => act.run(a.id, 'dismiss')}>Dismiss</Button>
                  </div>
                )}
                {a.status === 'waiting_approval' && <Link className="small" to={c.to('inbox')}>Decide in the inbox</Link>}
              </span>
            </li>
          );
        })}</ul></div>
      ))}
      {tab === 'runs' && (d.runs.length === 0 ? <Card><Empty title="No active runs" /></Card> : (
        <div className="card card-flush"><ul className="list">{d.runs.map((r: any) => (
          <li key={r.id} className="list-item">
            <span style={{ flex: 1, minWidth: 0 }}><strong>{r.workflow_name}</strong><div className="small">{r.subject_label} · step {r.current_step + 1} · {relTime(r.created_at)}</div><div className="small muted">{r.summary}</div></span>
            {c.can('automation.control') && <Button size="sm" onClick={() => takeover(r.id)}>Take over</Button>}
          </li>
        ))}</ul></div>
      ))}
      {tab === 'history' && (d.history.length === 0 ? <Card><Empty title="No activity yet" /></Card> : (
        <div className="card card-flush"><ul className="list">{d.history.map((a: any) => {
          const link = subjectLink(c, a);
          return (
            <li key={a.id} className="list-item" style={highlight === a.id ? { background: 'var(--primary-soft)' } : undefined}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div className="row"><strong>{a.label}</strong><ActionStatus status={a.status} /></div>
                <div className="small">{link ? <Link to={link}>{a.subject_label}</Link> : a.subject_label}{a.workflow_name ? ` · ${a.workflow_name}` : ' · started by a person'} · {a.executed_by === 'rigo' ? 'run by Rigo' : 'run by a person'} · {relTime(a.updated_at)}</div>
                <div className="small muted">{a.explanation}{a.attempts > 1 ? ` (${a.attempts} attempts)` : ''}</div>
              </span>
            </li>
          );
        })}</ul></div>
      ))}
      {tab === 'services' && <Card id="caps" title="Connected services"><p className="muted">Automatic mode can only use what is available here. Disabled services make no external calls.</p><CapabilityList /></Card>}
      <Dialog open={pauseOpen} onClose={() => setPauseOpen(false)} title="Pause all automation?" footer={<>
        <Button onClick={() => setPauseOpen(false)}>Cancel</Button>
        <Button onClick={() => pause.run('cancel')} variant="danger" busy={pause.busy}>Pause and cancel waiting steps</Button>
        <Button variant="primary" onClick={() => pause.run('hold')} busy={pause.busy}>Pause and hold</Button>
      </>}>
        <div className="stack">
          <p>While paused, Rigo starts nothing new. Choose what happens to steps that are already queued or proposed:</p>
          <ul><li><strong>Hold</strong>: they wait and continue when you resume.</li><li><strong>Cancel</strong>: they are cancelled and their runs stop.</li></ul>
          <p className="muted">Pausing never reverses steps that already completed. Approvals already waiting stay in the inbox.</p>
          <ErrorSummary error={pause.error} />
        </div>
      </Dialog>
      {node}
    </div>
  );
}
