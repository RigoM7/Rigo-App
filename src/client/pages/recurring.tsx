import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Repeat, PauseCircle, PlayCircle, CalendarX, AlertTriangle } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Select, ErrorSummary, LoadingBlock, ErrorState, PageHeader, Empty, Pill, Banner, Dialog, Checkbox, LinkButton, JobStatus, InvoiceStatus, useToast } from '../components/ui';
import { formatMoney, parseMoney, fmtDate } from '../lib/format';
import { DynamicField } from './jobform';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const describeRule = (r: any) => r.frequency === 'daily' ? `Every ${r.interval > 1 ? `${r.interval} days` : 'day'}` : r.frequency === 'weekly' ? `Every ${r.interval > 1 ? `${r.interval} weeks` : 'week'} on ${(r.weekdays ?? []).map((d: number) => DAYS[d]).join(', ')}` : `Every ${r.interval > 1 ? `${r.interval} months` : 'month'} on day ${r.dayOfMonth ?? ''}`;
const describeBilling = (b: any, cur: string) => b.frequency === 'none' ? 'No separate billing' : b.frequency === 'per_visit' ? 'Billed per visit (service pricing)' : `${b.description}: ${b.rateMinor === undefined ? 'rate hidden' : b.rateMinor === null ? 'rate not set' : formatMoney(b.rateMinor, cur)} per unit, ${b.frequency}`;

export function Recurring() {
  const c = useCompany();
  const q = useQuery({ queryKey: [c.cid, 'recurring'], queryFn: () => get(`/c/${c.cid}/recurring`) });
  return (
    <div className="page">
      <PageHeader title="Recurring service & rentals" sub="Visit schedules and billing schedules are separate: a rental can be serviced weekly and billed monthly." actions={c.can('jobs.create') ? <LinkButton variant="primary" to={c.to('recurring/new')} icon={<Plus aria-hidden />}>New plan</LinkButton> : undefined} />
      <Banner tone="info">Visits are scheduled {14} days ahead while Rigo is running, in your company time zone ({c.company.timezone}). If the server was stopped, it catches up when it starts again; nothing runs while every Rigo process is closed.</Banner>
      {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorState error={q.error} /> : q.data.plans.length === 0 ? <Card><Empty icon={<Repeat aria-hidden />} title="No recurring plans">Create a plan for regular servicing or rentals. Each visit becomes a normal job.</Empty></Card> : (
        <div className="card card-flush"><ul className="list">{q.data.plans.map((p: any) => (
          <li key={p.id}><Link className="list-item" to={c.to(`recurring/${p.id}`)}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="row"><strong>{p.name}</strong><Pill tone={p.status === 'active' ? 'success' : p.status === 'paused' ? 'warning' : 'neutral'}>{p.status}</Pill><Pill>{p.kind === 'rental' ? 'Rental' : 'Service'}</Pill>{p.missed ? <Pill tone="danger" icon={<AlertTriangle aria-hidden />}>{p.missed} missed visit(s)</Pill> : null}</span>
              <div className="small">{p.customer_name} · {p.service_name} · {p.units} unit(s)</div>
              <div className="small muted">{describeRule(p.visit_rule)} · {describeBilling(p.billing_rule, c.company.currency)}{p.next_visit ? ` · next ${fmtDate(p.next_visit)}` : ''}</div>
            </span>
          </Link></li>
        ))}</ul></div>
      )}
    </div>
  );
}

function RuleFields({ rule, setRule, idp }: { rule: any; setRule: (r: any) => void; idp: string }) {
  return (
    <div className="stack">
      <div className="grid-2">
        <Field label="Repeats" id={`${idp}-freq`}>{(p) => <Select {...p} value={rule.frequency} onChange={(e) => setRule({ ...rule, frequency: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></Select>}</Field>
        <Field label="Every" id={`${idp}-int`} hint={rule.frequency === 'daily' ? 'days' : rule.frequency === 'weekly' ? 'weeks' : 'months'}>{(p) => <Input {...p} inputMode="numeric" value={rule.interval} onChange={(e) => setRule({ ...rule, interval: Math.max(1, Number(e.target.value) || 1) })} />}</Field>
        <Field label="Visit time" id={`${idp}-time`}>{(p) => <Input {...p} type="time" value={rule.time} onChange={(e) => setRule({ ...rule, time: e.target.value })} />}</Field>
        {rule.frequency === 'monthly' && <Field label="Day of month" id={`${idp}-dom`} hint="Short months use their last day.">{(p) => <Input {...p} inputMode="numeric" value={rule.dayOfMonth ?? 1} onChange={(e) => setRule({ ...rule, dayOfMonth: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />}</Field>}
      </div>
      {rule.frequency === 'weekly' && <fieldset id="f-visitRule-weekdays"><legend>Days</legend><div className="row">{DAYS.map((d, i) => <Checkbox key={d} label={d} checked={rule.weekdays.includes(i)} onChange={(e) => setRule({ ...rule, weekdays: e.target.checked ? [...rule.weekdays, i].sort() : rule.weekdays.filter((x: number) => x !== i) })} />)}</div></fieldset>}
    </div>
  );
}

export function RecurringNew() {
  const c = useCompany();
  const nav = useNavigate();
  const customers = useQuery({ queryKey: [c.cid, 'customers', ''], queryFn: () => get(`/c/${c.cid}/customers`) });
  const services = useQuery({ queryKey: [c.cid, 'services'], queryFn: () => get(`/c/${c.cid}/services`) });
  const today = new Date().toISOString().slice(0, 10);
  const [v, setV] = useState<any>({ name: '', kind: 'rental', customerId: '', locationId: '', serviceId: '', units: 1, startsOn: today, endsOn: '', details: {}, rate: '' });
  const [rule, setRule] = useState<any>({ frequency: 'weekly', interval: 1, weekdays: [1], time: '08:00', durationMinutes: 60 });
  const [billing, setBilling] = useState<any>({ frequency: 'monthly', description: 'Unit rental' });
  const cust = useQuery({ queryKey: [c.cid, 'customer', v.customerId], queryFn: () => get(`/c/${c.cid}/customers/${v.customerId}`), enabled: !!v.customerId });
  const svc = services.data?.services.find((s: any) => s.id === v.serviceId);
  const s = useSubmit(async () => {
    const rateMinor = v.rate.trim() === '' ? null : parseMoney(v.rate);
    if (v.rate.trim() !== '' && rateMinor === null) throw new Error('Enter the rate like 125.00 or leave it empty.');
    const r = await post(`/c/${c.cid}/recurring`, { name: v.name, kind: v.kind, customerId: v.customerId, locationId: v.locationId || null, serviceId: v.serviceId, units: Number(v.units) || 1, startsOn: v.startsOn, endsOn: v.endsOn || null, details: v.details, visitRule: rule, billingRule: { ...billing, rateMinor: billing.frequency === 'weekly' || billing.frequency === 'monthly' ? rateMinor : null } });
    nav(c.to(`recurring/${r.id}`));
  });
  return (
    <div className="page page-narrow">
      <PageHeader back={{ to: c.to('recurring'), label: 'Recurring' }} title="New recurring plan" />
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); s.run(); }}>
        <ErrorSummary error={s.error} />
        <Card id="b" title="What and where"><div className="stack">
          <Field label="Plan name" id="f-name" error={s.fieldError('name')}>{(p) => <Input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
          <Field label="Type" id="f-kind">{(p) => <Select {...p} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option value="rental">Rental (units on site, serviced and billed on a schedule)</option><option value="service">Recurring service</option></Select>}</Field>
          <Field label="Customer" id="f-customerId" error={s.fieldError('customerId')}>{(p) => <Select {...p} value={v.customerId} onChange={(e) => setV({ ...v, customerId: e.target.value, locationId: '' })}><option value="">Choose…</option>{customers.data?.customers.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
          <Field label="Location" id="f-locationId">{(p) => <Select {...p} value={v.locationId} disabled={!v.customerId} onChange={(e) => setV({ ...v, locationId: e.target.value })}><option value="">Choose…</option>{cust.data?.locations.map((l: any) => <option key={l.id} value={l.id}>{l.address}</option>)}</Select>}</Field>
          <Field label="Service for each visit" id="f-serviceId" error={s.fieldError('serviceId')}>{(p) => <Select {...p} value={v.serviceId} onChange={(e) => setV({ ...v, serviceId: e.target.value, details: {} })}><option value="">Choose…</option>{services.data?.services.filter((x: any) => x.active).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
          {svc?.fields.filter((f: any) => f.stage !== 'completion' && f.key !== 'units').map((f: any) => <DynamicField key={f.key} f={f} value={v.details[f.key]} onChange={(x) => setV({ ...v, details: { ...v.details, [f.key]: x } })} />)}
          <Field label="Units" id="f-units">{(p) => <Input {...p} inputMode="numeric" value={v.units} onChange={(e) => setV({ ...v, units: e.target.value })} />}</Field>
        </div></Card>
        <Card id="v" title="Visit schedule"><div className="stack">
          <RuleFields rule={rule} setRule={setRule} idp="f-visit" />
          <div className="grid-2">
            <Field label="Starts on" id="f-startsOn">{(p) => <Input {...p} type="date" value={v.startsOn} onChange={(e) => setV({ ...v, startsOn: e.target.value })} />}</Field>
            <Field label="Ends on" optionalText id="f-endsOn" error={s.fieldError('endsOn')}>{(p) => <Input {...p} type="date" value={v.endsOn} onChange={(e) => setV({ ...v, endsOn: e.target.value })} />}</Field>
          </div>
        </div></Card>
        <Card id="bill" title="Billing schedule"><div className="stack">
          <Field label="Bill" id="f-bfreq">{(p) => <Select {...p} value={billing.frequency} onChange={(e) => setBilling({ ...billing, frequency: e.target.value })}><option value="monthly">Monthly, per unit</option><option value="weekly">Weekly, per unit</option><option value="per_visit">Per visit, using the service pricing</option><option value="none">Not billed by this plan</option></Select>}</Field>
          {(billing.frequency === 'monthly' || billing.frequency === 'weekly') && c.can('finance.view') && <div className="grid-2">
            <Field label="Line description" id="f-bdesc">{(p) => <Input {...p} value={billing.description} onChange={(e) => setBilling({ ...billing, description: e.target.value })} />}</Field>
            <Field label={`Rate per unit (${c.company.currency})`} optionalText id="f-rate" hint="Empty means invoices are held until you set it.">{(p) => <Input {...p} inputMode="decimal" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} />}</Field>
          </div>}
        </div></Card>
        <div className="form-actions"><Button type="submit" variant="primary" size="lg" busy={s.busy}>Create plan</Button></div>
      </form>
    </div>
  );
}

export function RecurringDetail() {
  const c = useCompany();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: [c.cid, 'plan', id], queryFn: () => get(`/c/${c.cid}/recurring/${id}`) });
  const [dlg, setDlg] = useState<null | 'pause' | 'end' | 'change'>(null);
  const [dates, setDates] = useState({ from: new Date().toISOString().slice(0, 10), until: '' });
  const [rule, setRule] = useState<any>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: [c.cid] });
  const pause = useSubmit(async () => { const r = await post(`/c/${c.cid}/recurring/${id}/pause`, { from: dates.from, until: dates.until || null }); setDlg(null); toast(`Paused. ${r.cancelledVisits} unstarted visit(s) in that period were cancelled.`); refresh(); });
  const resume = useSubmit(async () => { await post(`/c/${c.cid}/recurring/${id}/resume`); toast('Resumed'); refresh(); });
  const end = useSubmit(async () => { const r = await post(`/c/${c.cid}/recurring/${id}/end`, { endsOn: dates.from }); setDlg(null); toast(`Plan ends ${dates.from}. ${r.cancelledVisits} later visit(s) cancelled.`); refresh(); });
  const change = useSubmit(async () => { const r = await post(`/c/${c.cid}/recurring/${id}/change`, { effectiveFrom: dates.from, visitRule: rule }); setDlg(null); toast(`Schedule changed. ${r.replacedVisits} visit(s) replaced. ${r.note}`); refresh(); });
  if (q.isLoading) return <div className="page"><LoadingBlock /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} /></div>;
  const { plan, occurrences, invoices, preview, today } = q.data;
  const missed = occurrences.filter((o: any) => o.occurrence_date < today && o.job_id && ['draft', 'open', 'in_progress'].includes(o.status));
  return (
    <div className="page">
      <PageHeader back={{ to: c.to('recurring'), label: 'Recurring' }} docTitle={plan.name} title={<span className="row">{plan.name}<Pill tone={plan.status === 'active' ? 'success' : 'warning'}>{plan.status}</Pill></span>} sub={`${describeRule(plan.visit_rule)} at ${plan.visit_rule.time} · ${describeBilling(plan.billing_rule, c.company.currency)}`}
        actions={c.can('jobs.edit') && plan.status !== 'ended' ? <>
          {plan.status === 'paused' ? <Button icon={<PlayCircle aria-hidden />} busy={resume.busy} onClick={() => resume.run()}>Resume</Button> : <Button icon={<PauseCircle aria-hidden />} onClick={() => setDlg('pause')}>Pause</Button>}
          <Button onClick={() => { setRule(structuredClone(plan.visit_rule)); setDlg('change'); }}>Change schedule</Button>
          <Button variant="danger" icon={<CalendarX aria-hidden />} onClick={() => setDlg('end')}>End plan</Button>
        </> : undefined} />
      {missed.length > 0 && <Banner tone="warning" title={`${missed.length} missed visit(s)`}>These visits are past their date and not finished. Reschedule or cancel them from the job.</Banner>}
      {plan.paused_from && <Banner tone="info">Paused from {fmtDate(plan.paused_from)}{plan.paused_until ? ` until ${fmtDate(plan.paused_until)}` : ' until resumed'}. No visits or rental charges are created for that period.</Banner>}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card id="occ" title="Visits"><ul className="list">{occurrences.map((o: any) => <li key={o.occurrence_date} className="row-between" style={{ padding: '8px 0' }}><span>{fmtDate(o.occurrence_date)}{o.job_id ? <> · <Link to={c.to(`jobs/${o.job_id}`)}>Job #{o.number}</Link></> : null}</span>{o.state !== 'scheduled' ? <Pill>{o.state === 'skipped_paused' ? 'Skipped (paused)' : 'Cancelled'}</Pill> : o.status ? <JobStatus status={o.status} /> : null}</li>)}</ul>
          <p className="small muted">Next 30 days by rule: {preview.slice(0, 8).map((d: string) => fmtDate(d)).join(', ')}{preview.length > 8 ? '…' : ''}</p></Card>
        <Card id="bill" title="Billing">{invoices.length === 0 ? <p className="muted">No invoices from this plan yet.</p> : <ul className="list">{invoices.map((i: any) => <li key={i.id} className="row-between" style={{ padding: '8px 0' }}><Link to={c.to(`invoices/${i.id}`)}>{i.number ?? 'Draft'} · {i.billable_key.split(':')[2]}</Link><span className="row">{i.total_minor !== null && i.total_minor !== undefined ? <span className="num">{formatMoney(i.total_minor, c.company.currency)}</span> : null}<InvoiceStatus status={i.status} /></span></li>)}</ul>}</Card>
      </div>
      <Dialog open={dlg === 'pause'} onClose={() => setDlg(null)} title="Pause this plan" footer={<><Button onClick={() => setDlg(null)}>Cancel</Button><Button variant="primary" busy={pause.busy} onClick={() => pause.run()}>Pause</Button></>}>
        <div className="stack"><p>Unstarted visits in this period are cancelled with a note. Visits already assigned and started are not touched. Past invoices are unchanged.</p><ErrorSummary error={pause.error} />
          <div className="grid-2"><Field label="From" id="f-from">{(p) => <Input {...p} type="date" value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} />}</Field><Field label="Until" optionalText id="f-until" hint="Empty: until you resume.">{(p) => <Input {...p} type="date" value={dates.until} onChange={(e) => setDates({ ...dates, until: e.target.value })} />}</Field></div></div>
      </Dialog>
      <Dialog open={dlg === 'end'} onClose={() => setDlg(null)} title="End this plan" footer={<><Button onClick={() => setDlg(null)}>Cancel</Button><Button variant="danger" busy={end.busy} onClick={() => end.run()}>End plan</Button></>}>
        <div className="stack"><p>Unstarted visits after the end date are cancelled. Create a pickup job separately if units must be collected.</p><ErrorSummary error={end.error} /><Field label="Last day" id="f-endsOn">{(p) => <Input {...p} type="date" value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} />}</Field></div>
      </Dialog>
      <Dialog open={dlg === 'change'} onClose={() => setDlg(null)} title="Change the visit schedule" footer={<><Button onClick={() => setDlg(null)}>Cancel</Button><Button variant="primary" busy={change.busy} onClick={() => change.run()}>Apply from this date</Button></>}>
        {rule && <div className="stack"><p>Unassigned, unstarted visits from this date are replaced using the new schedule. Assigned or started visits stay as they are.</p><ErrorSummary error={change.error} />
          <Field label="Effective from" id="f-eff">{(p) => <Input {...p} type="date" value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} />}</Field>
          <RuleFields rule={rule} setRule={setRule} idp="f-chg" /></div>}
      </Dialog>
    </div>
  );
}
