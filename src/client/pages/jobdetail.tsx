import { Fragment, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Send, Ban, AlertTriangle, CheckCircle2, Receipt, History, Wrench, MapPin, UserCheck, ShieldCheck } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Select, Textarea, ErrorSummary, LoadingBlock, ErrorState, PageHeader, JobStatus, InvoiceStatus, MessageStatus, Pill, Banner, Dialog, Checkbox, LinkButton, useToast } from '../components/ui';
import { fmtDateTime, formatMoney, toLocalInput, titleCase } from '../lib/format';
import { zonedToUtc } from '../../shared/schedule';
import { BILLING_STATUSES, OUTCOMES } from '../../shared/jobs';
import { DynamicField } from './jobform';

const EVENT_LABELS: Record<string, string> = {
  created: 'Created', edited: 'Edited', status: 'Status changed', assigned: 'Assigned', reassigned: 'Reassigned', unassigned: 'Unassigned', rescheduled: 'Rescheduled',
  started: 'Started by driver', completion: 'Outcome recorded', problem: 'Problem reported', problem_resolved: 'Problem resolved', note: 'Note', correction: 'Record corrected', invoice_prepared: 'Invoice prepared',
};

function eventText(e: any, members: Record<string, string>) {
  const d = e.data ?? {};
  switch (e.type) {
    case 'status': return `${titleCase(d.from ?? '')} → ${titleCase(d.to ?? '')}${d.reason ? `: ${d.reason}` : ''}`;
    case 'assigned': case 'reassigned': case 'unassigned': case 'rescheduled': return [d.to ? `Driver: ${members[d.to] ?? 'member'}` : d.from ? 'Driver removed' : '', d.resources?.length ? `Equipment: ${d.resources.join(', ')}` : '', d.reason ?? ''].filter(Boolean).join(' · ');
    case 'completion': return `${(OUTCOMES as any)[d.outcome] ?? d.outcome}${d.reason ? `: ${d.reason}` : ''}${d.photos ? ` · ${d.photos} photo(s)` : ''}${d.signed ? ' · signed' : ''}`;
    case 'problem': case 'note': return d.text;
    case 'problem_resolved': return d.note || '';
    case 'correction': return `Reason: ${d.reason}`;
    case 'invoice_prepared': return d.held ? `On hold: ${(d.reasons ?? []).join(' ')}` : 'Draft ready';
    case 'created': return d.followupOf ? `Follow-up to job #${d.followupOf}` : d.plan ? `From plan ${d.plan}` : '';
    default: return '';
  }
}

function AssignCard({ data, onDone }: { data: any; onDone: () => void }) {
  const c = useCompany();
  const toast = useToast();
  const j = data.job;
  const resources = useQuery({ queryKey: [c.cid, 'resources'], queryFn: () => get(`/c/${c.cid}/resources`), enabled: c.can('resources.view') });
  const [v, setV] = useState({ userId: j.assigned_user_id ?? '', resourceIds: data.resources.map((r: any) => r.id) as string[], start: toLocalInput(j.scheduled_start, c.company.timezone), end: toLocalInput(j.scheduled_end, c.company.timezone) });
  const toIso = (l: string) => (l ? zonedToUtc(l.slice(0, 10), l.slice(11, 16), c.company.timezone).toISOString() : null);
  const s = useSubmit(async () => { await post(`/c/${c.cid}/jobs/${j.id}/assign`, { userId: v.userId || null, resourceIds: v.resourceIds, scheduledStart: toIso(v.start), scheduledEnd: toIso(v.end), version: j.version }); toast('Assignment saved'); onDone(); });
  const drivers = c.members.filter((m) => ['driver', 'owner', 'dispatcher'].includes(m.role_key));
  return (
    <Card id="assign" title={<h2 className="row"><UserCheck aria-hidden />Schedule and assignment</h2>}>
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); s.run(); }}>
        <ErrorSummary error={s.error} />
        <div className="grid-2">
          <Field label="Start" id="f-scheduledStart" hint={c.company.timezone}>{(p) => <Input {...p} type="datetime-local" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} />}</Field>
          <Field label="End" id="f-scheduledEnd" error={s.fieldError('scheduledEnd')}>{(p) => <Input {...p} type="datetime-local" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} />}</Field>
        </div>
        <Field label="Driver" id="f-userId" error={s.fieldError('userId')}>{(p) => <Select {...p} value={v.userId} onChange={(e) => setV({ ...v, userId: e.target.value })}><option value="">Unassigned</option>{drivers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>
        {resources.data?.resources.length ? (
          <fieldset><legend>Trucks and equipment</legend>{resources.data.resources.filter((r: any) => r.status !== 'retired').map((r: any) => (
            <Checkbox key={r.id} label={`${r.name}${r.capacity ? ` (${r.capacity})` : ''}${r.status === 'out_of_service' ? ' — out of service' : ''}`} disabled={r.status === 'out_of_service' && !v.resourceIds.includes(r.id)} checked={v.resourceIds.includes(r.id)} onChange={(e) => setV({ ...v, resourceIds: e.target.checked ? [...v.resourceIds, r.id] : v.resourceIds.filter((x) => x !== r.id) })} />
          ))}</fieldset>
        ) : null}
        {j.status === 'in_progress' && v.userId !== (j.assigned_user_id ?? '') && <Banner tone="warning">This job is in progress. Reassigning tells the current driver it is no longer theirs; any unsynced draft on their device will be flagged as a conflict.</Banner>}
        <div><Button type="submit" variant="primary" busy={s.busy}>Save assignment</Button></div>
      </form>
    </Card>
  );
}

export function JobDetail() {
  const c = useCompany();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: [c.cid, 'job', id], queryFn: () => get(`/c/${c.cid}/jobs/${id}`) });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [problemOpen, setProblemOpen] = useState(false);
  const [problem, setProblem] = useState('');
  const [correctOpen, setCorrectOpen] = useState(false);
  const [corr, setCorr] = useState<any>({ values: {}, notes: '', reason: '' });
  const refresh = () => qc.invalidateQueries({ queryKey: [c.cid] });
  const status = useSubmit(async (to: string, r?: string) => { await post(`/c/${c.cid}/jobs/${id}/status`, { to, version: q.data.job.version, reason: r }); setCancelOpen(false); toast(to === 'open' ? 'Job opened for scheduling' : to === 'cancelled' ? 'Job cancelled' : 'Moved back to draft'); refresh(); });
  const report = useSubmit(async () => { await post(`/c/${c.cid}/jobs/${id}/problem`, { text: problem }); setProblemOpen(false); setProblem(''); toast('Problem reported to dispatch'); refresh(); });
  const resolve = useSubmit(async () => { await post(`/c/${c.cid}/jobs/${id}/problem/resolve`, { note: '' }); toast('Problem marked resolved'); refresh(); });
  const prep = useSubmit(async () => { const r = await post(`/c/${c.cid}/jobs/${id}/invoice`); toast(r.held ? 'Invoice prepared on hold. See the reasons on the invoice.' : 'Invoice draft prepared'); refresh(); });
  const correct = useSubmit(async () => { const r = await post(`/c/${c.cid}/jobs/${id}/correct`, { ...corr, version: q.data.job.version }); setCorrectOpen(false); toast(r.invoiceNote || 'Correction saved with history'); refresh(); });
  if (q.isLoading) return <div className="page"><LoadingBlock rows={8} /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} retry={() => q.refetch()} /></div>;
  const { job, service, customer, location, resources, events, files, invoice, messages, can } = q.data;
  const members = Object.fromEntries(c.members.map((m) => [m.id, m.name]));
  const reqFields = (service?.fields ?? []).filter((f: any) => f.stage !== 'completion');
  const compFields = (service?.fields ?? []).filter((f: any) => f.stage !== 'request');
  const finished = ['completed', 'partial', 'unsuccessful', 'cancelled'].includes(job.status);
  return (
    <div className="page">
      <PageHeader back={{ to: c.to('jobs'), label: 'Jobs' }} title={<span className="row">Job #{job.number}<JobStatus status={job.status} />{job.problem_open ? <Pill tone="danger" icon={<AlertTriangle aria-hidden />}>Problem</Pill> : null}</span>}
        sub={<>{service?.name ?? 'No service'} · {customer?.name ?? 'No customer'}{job.billing_status ? <> · Billing: {(BILLING_STATUSES as any)[job.billing_status]}</> : null}</>}
        actions={<>
          {can.edit && <LinkButton to={c.to(`jobs/${id}/edit`)} icon={<Pencil aria-hidden />}>Edit</LinkButton>}
          {can.edit && job.status === 'draft' && <Button variant="primary" icon={<Send aria-hidden />} busy={status.busy} onClick={() => status.run('open')}>Open for scheduling</Button>}
          {can.work && <LinkButton variant="primary" to={c.to(`today/${id}`)}>Open driver view</LinkButton>}
          {can.reportProblem && !finished && <Button icon={<AlertTriangle aria-hidden />} onClick={() => setProblemOpen(true)}>Report problem</Button>}
          {can.edit && !finished && <Button variant="danger" icon={<Ban aria-hidden />} onClick={() => setCancelOpen(true)}>Cancel job</Button>}
        </>} />
      <ErrorSummary error={status.error ?? prep.error ?? resolve.error} />
      {job.status === 'draft' && job.missing?.length > 0 && <Banner tone="warning" title="This draft still needs information before it can be scheduled">{<ul style={{ margin: 0 }}>{job.missing.map((m: string) => <li key={m}>{m}</li>)}</ul>}</Banner>}
      {job.problem_open && (
        <Banner tone="danger" title="A problem was reported" action={c.can('jobs.edit') ? <Button size="sm" busy={resolve.busy} onClick={() => resolve.run()}>Mark resolved</Button> : undefined}>
          {[...events].reverse().find((e: any) => e.type === 'problem')?.data?.text}
        </Banner>
      )}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card id="where" title={<h2 className="row"><MapPin aria-hidden />Where and who</h2>}>
            <dl className="kv">
              <dt>Customer</dt><dd>{customer ? (c.can('customers.view') ? <Link to={c.to(`customers/${customer.id}`)}>{customer.name}</Link> : customer.name) : '—'}</dd>
              {customer?.phone ? <><dt>Customer phone</dt><dd><a href={`tel:${customer.phone}`}>{customer.phone}</a></dd></> : null}
              <dt>Address</dt><dd>{location?.address ?? '—'}</dd>
              <dt>Access</dt><dd className="pre">{job.access_instructions || location?.access_instructions || '—'}</dd>
              <dt>On-site contact</dt><dd>{job.contact_name || location?.site_contact || '—'}{job.contact_phone ? <> · <a href={`tel:${job.contact_phone}`}>{job.contact_phone}</a></> : null}</dd>
              <dt>Scheduled</dt><dd>{fmtDateTime(job.scheduled_start, c.company.timezone)}</dd>
              <dt>Driver</dt><dd>{job.assignee_name ?? <Pill tone="warning">Unassigned</Pill>}</dd>
              <dt>Equipment</dt><dd>{resources.length ? resources.map((r: any) => r.name).join(', ') : '—'}</dd>
            </dl>
          </Card>
          <Card id="svc" title={<h2 className="row"><Wrench aria-hidden />Service requested</h2>}>
            <dl className="kv">
              <dt>Service</dt><dd>{service?.name ?? '—'}</dd>
              {reqFields.map((f: any) => <Fragment key={f.key}><dt>{f.label}</dt><dd>{job.details?.[f.key] !== undefined && job.details[f.key] !== '' ? `${job.details[f.key]}${f.unit ? ` ${f.unit}` : ''}` : '—'}</dd></Fragment>)}
              <dt>Notes</dt><dd className="pre">{job.notes || '—'}</dd>
            </dl>
          </Card>
          {job.completion && (
            <Card id="done" title={<h2 className="row"><CheckCircle2 aria-hidden />Recorded on site</h2>} actions={can.correct ? <Button size="sm" icon={<Pencil aria-hidden />} onClick={() => { setCorr({ values: { ...job.completion.values }, notes: job.completion.notes ?? '', reason: '' }); setCorrectOpen(true); }}>Correct record</Button> : undefined}>
              <dl className="kv">
                <dt>Outcome</dt><dd><strong>{(OUTCOMES as any)[job.completion.outcome]}</strong></dd>
                {job.completion.reason ? <><dt>What happened</dt><dd className="pre">{job.completion.reason}</dd></> : null}
                {compFields.map((f: any) => <Fragment key={f.key}><dt>{f.label}</dt><dd className="num">{job.completion.values?.[f.key] ?? '—'}{job.completion.values?.[f.key] && f.unit ? ` ${f.unit}` : ''}</dd></Fragment>)}
                <dt>Notes</dt><dd className="pre">{job.completion.notes || '—'}</dd>
                {job.completion.signerName ? <><dt>Signed by</dt><dd>{job.completion.signerName}</dd></> : null}
                <dt>Submitted</dt><dd>{fmtDateTime(job.completion.submittedAt ?? job.completed_at, c.company.timezone)}</dd>
              </dl>
              {files.length > 0 && <div className="photo-grid" style={{ marginTop: 12 }}>{files.map((f: any) => <figure key={f.id}><a href={`/api/c/${c.cid}/jobs/${id}/files/${f.id}`} target="_blank" rel="noreferrer"><img src={`/api/c/${c.cid}/jobs/${id}/files/${f.id}`} alt={f.name.startsWith('signature') ? 'Customer signature' : `Job photo ${f.name}`} loading="lazy" /></a></figure>)}</div>}
            </Card>
          )}
        </div>
        <div className="stack">
          {can.assign && <AssignCard key={job.version} data={q.data} onDone={refresh} />}
          {(invoice || can.prepareInvoice) && (
            <Card id="inv" title={<h2 className="row"><Receipt aria-hidden />Invoice</h2>}>
              {invoice ? (
                <div className="stack-sm">
                  <div className="row"><InvoiceStatus status={invoice.status} />{invoice.number ? <strong>{invoice.number}</strong> : null}{invoice.total_minor !== null ? <span className="num">{formatMoney(invoice.total_minor, invoice.currency)}</span> : null}</div>
                  {invoice.hold_reasons?.length ? <Banner tone="warning" title="On hold">{invoice.hold_reasons.join(' ')}</Banner> : null}
                  <Link to={c.to(`invoices/${invoice.id}`)}>Open invoice</Link>
                </div>
              ) : job.status === 'unsuccessful' ? <p className="muted">Unsuccessful visits are not billed automatically.</p> : (
                <div className="stack-sm"><p className="muted">No invoice yet.</p><div><Button variant="primary" busy={prep.busy} onClick={() => prep.run()}>Prepare invoice</Button></div></div>
              )}
            </Card>
          )}
          {messages && messages.length > 0 && (
            <Card id="msgs" title="Customer messages"><ul className="list">{messages.map((m: any) => <li key={m.id} className="row-between" style={{ padding: '8px 0' }}><span>{m.subject}</span><MessageStatus status={m.status} /></li>)}</ul></Card>
          )}
          <Card id="hist" title={<h2 className="row"><History aria-hidden />History</h2>}>
            <ol className="list">
              {events.map((e: any) => (
                <li key={e.id} style={{ padding: '8px 0' }}>
                  <div className="row-between"><strong>{EVENT_LABELS[e.type] ?? titleCase(e.type)}</strong><span className="small muted">{fmtDateTime(e.created_at, c.company.timezone)}</span></div>
                  <div className="small">{eventText(e, members)}</div>
                  <div className="small muted">{e.actor_label || e.actor_name || 'Rigo'}</div>
                  {e.type === 'correction' && <details className="small"><summary>Before and after</summary><pre className="pre" style={{ fontSize: 12 }}>{JSON.stringify({ before: e.data.before, after: e.data.after }, null, 2)}</pre></details>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} title={`Cancel job #${job.number}?`} footer={<><Button onClick={() => setCancelOpen(false)}>Keep job</Button><Button variant="danger" busy={status.busy} onClick={() => status.run('cancelled', reason)}>Cancel job</Button></>}>
        <div className="stack"><p>The job is marked cancelled and will not be billed. {job.assigned_user_id ? 'The assigned driver is notified.' : ''} This cannot be undone; create a new job if plans change.</p>
          <ErrorSummary error={status.error} />
          <Field label="Reason" id="f-reason" error={status.fieldError('reason')}>{(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field></div>
      </Dialog>
      <Dialog open={problemOpen} onClose={() => setProblemOpen(false)} title="Report a problem" footer={<><Button onClick={() => setProblemOpen(false)}>Cancel</Button><Button variant="primary" busy={report.busy} onClick={() => report.run()}>Send to dispatch</Button></>}>
        <div className="stack"><ErrorSummary error={report.error} /><Field label="What is the problem?" id="f-text" error={report.fieldError('text')}>{(p) => <Textarea {...p} value={problem} onChange={(e) => setProblem(e.target.value)} />}</Field></div>
      </Dialog>
      <Dialog open={correctOpen} onClose={() => setCorrectOpen(false)} title="Correct the recorded information" footer={<><Button onClick={() => setCorrectOpen(false)}>Cancel</Button><Button variant="primary" icon={<ShieldCheck aria-hidden />} busy={correct.busy} onClick={() => correct.run()}>Save correction</Button></>}>
        <div className="stack">
          <p className="muted">The original values stay in the job history. A draft invoice is rebuilt and needs approval again; an issued invoice is not changed.</p>
          <ErrorSummary error={correct.error} />
          {compFields.map((f: any) => <DynamicField key={f.key} f={f} value={corr.values[f.key]} error={correct.fieldError(f.key)} onChange={(x) => setCorr({ ...corr, values: { ...corr.values, [f.key]: x } })} />)}
          <Field label="Notes" optionalText id="f-cnotes">{(p) => <Textarea {...p} value={corr.notes} onChange={(e) => setCorr({ ...corr, notes: e.target.value })} />}</Field>
          <Field label="Reason for the correction" id="f-reason" error={correct.fieldError('reason')}>{(p) => <Input {...p} value={corr.reason} onChange={(e) => setCorr({ ...corr, reason: e.target.value })} />}</Field>
        </div>
      </Dialog>
    </div>
  );
}
