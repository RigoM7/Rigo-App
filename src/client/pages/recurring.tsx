import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Repeat, PauseCircle, PlayCircle, CalendarX, AlertTriangle, Trash2, CalendarRange, PiggyBank, Package, Pencil } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, put, newId } from '../lib/api';
import { useSubmit } from '../lib/form';
import { BILLING_FREQUENCIES, localDate, addDays } from '../../shared/schedule';
import { tzLabel } from '../../shared/timezones';
import { parseRate, rateToInput } from '../../shared/billing';
import { describeRental, rentalLines, isPeriodic, PLAN_VISIT_LABEL } from '../../shared/rentals';
import { Button, Card, Field, Input, Select, ErrorSummary, LoadingBlock, ErrorState, PageHeader, Empty, Pill, Banner, Dialog, Checkbox, LinkButton, JobStatus, InvoiceStatus, useToast } from '../components/ui';
import { formatMoney, parseMoney, minorToInput, fmtDate } from '../lib/format';
import { PaymentPill } from './invoices';
import { DynamicField } from './jobform';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const describeRule = (r: any) => r.frequency === 'daily' ? `Every ${r.interval > 1 ? `${r.interval} days` : 'day'}` : r.frequency === 'weekly' ? `Every ${r.interval > 1 ? `${r.interval} weeks` : 'week'} on ${(r.weekdays ?? []).map((d: number) => DAYS[d]).join(', ') || 'no day chosen'}` : `Every ${r.interval > 1 ? `${r.interval} months` : 'month'} on day ${r.dayOfMonth ?? ''}`;
const describeBilling = (p: any, cur: string, fin: boolean) => {
  const b = p.billing_rule;
  if (b.frequency === 'none') return 'Not billed by the plan';
  if (b.frequency === 'per_visit') return 'Each visit billed with the service pricing';
  return describeRental(b, p.units, cur, fin && b.lines?.every((l: any) => l.rateE4 !== undefined));
};
// The billing menu offers "Every 4 weeks (28 days)" directly; other day counts use "Every N days".
const billingChoice = (b: any) => (b.frequency === 'every_n_days' ? ((b.everyDays ?? 28) === 28 ? 'four_weeks' : 'n_days') : b.frequency);
const toRate = (s: string) => (s.trim() === '' ? null : parseRate(s));

export function Recurring() {
  const c = useCompany();
  const q = useQuery({ queryKey: [c.cid, 'recurring'], queryFn: () => get(`/c/${c.cid}/recurring`) });
  const fin = c.can('finance.view');
  return (
    <div className="page">
      <PageHeader title="Recurring service & rentals" sub="Visit schedules and billing schedules are separate: rental units can be serviced weekly and billed every 4 weeks. Routine visits are covered by the rent." actions={c.can('jobs.create') ? <LinkButton variant="primary" to={c.to('recurring/new')} icon={<Plus aria-hidden />}>New plan</LinkButton> : undefined} />
      <Banner tone="info">Rigo adds each plan's visits to the schedule two weeks ahead, assigned to the plan's driver, using your company's time zone ({tzLabel(c.company.timezone)}), and prepares the rent invoice when each billing period starts. If Rigo was offline for a while, it fills in anything missed as soon as it is back.</Banner>
      {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorState error={q.error} /> : q.data.plans.length === 0 ? <Card><Empty icon={<Repeat aria-hidden />} title="No recurring plans">Create a plan for regular servicing or rentals. Each visit becomes a normal job.</Empty></Card> : (
        <div className="card card-flush"><ul className="list">{q.data.plans.map((p: any) => (
          <li key={p.id}><Link className="list-item" to={c.to(`recurring/${p.id}`)}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="row"><strong>{p.name}</strong><Pill tone={p.status === 'active' ? 'success' : p.status === 'paused' ? 'warning' : 'neutral'}>{p.status}</Pill><Pill>{p.billing_rule.frequency === 'event' ? 'Event rental' : p.kind === 'rental' ? 'Rental' : 'Service'}</Pill>{p.missed ? <Pill tone="danger" icon={<AlertTriangle aria-hidden />}>{p.missed} missed visit(s)</Pill> : null}{p.kind === 'rental' && !p.ratesSet ? <Pill tone="warning">Rates not set</Pill> : null}</span>
              <div className="small">{p.customer_name} · {p.service_name}</div>
              <div className="small muted">{describeRule(p.visit_rule)} · {describeBilling(p, c.company.currency, fin)}{p.next_visit ? ` · next visit ${fmtDate(p.next_visit)}` : ''}</div>
            </span>
          </Link></li>
        ))}</ul></div>
      )}
    </div>
  );
}

function RuleFields({ rule, setRule, idp, error }: { rule: any; setRule: (r: any) => void; idp: string; error?: string }) {
  return (
    <div className="stack">
      <div className="grid-2">
        <Field label="Repeats" id={`${idp}-freq`}>{(p) => <Select {...p} value={rule.frequency} onChange={(e) => setRule({ ...rule, frequency: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></Select>}</Field>
        <Field label="Every" id={`${idp}-int`} hint={rule.frequency === 'daily' ? 'days' : rule.frequency === 'weekly' ? 'weeks' : 'months'}>{(p) => <Input {...p} inputMode="numeric" value={rule.interval} onChange={(e) => setRule({ ...rule, interval: Math.max(1, Number(e.target.value) || 1) })} />}</Field>
        <Field label="Visit time" id={`${idp}-time`}>{(p) => <Input {...p} type="time" value={rule.time} onChange={(e) => setRule({ ...rule, time: e.target.value })} />}</Field>
        {rule.frequency === 'monthly' && <Field label="Day of month" id={`${idp}-dom`} hint="Short months use their last day.">{(p) => <Input {...p} inputMode="numeric" value={rule.dayOfMonth ?? 1} onChange={(e) => setRule({ ...rule, dayOfMonth: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />}</Field>}
      </div>
      {rule.frequency === 'weekly' && <fieldset id="f-visitRule-weekdays"><legend>Days</legend><div className="row">{DAYS.map((d, i) => <Checkbox key={d} label={d} checked={rule.weekdays.includes(i)} onChange={(e) => setRule({ ...rule, weekdays: e.target.checked ? [...rule.weekdays, i].sort() : rule.weekdays.filter((x: number) => x !== i) })} />)}</div>{error ? <p className="field-error" style={{ margin: 0 }}>{error}</p> : null}</fieldset>}
    </div>
  );
}

type LineEdit = { id: string; label: string; quantity: string; rate: string };
const blankLine = (n: number): LineEdit => ({ id: `line${n}`, label: n === 1 ? 'Standard unit' : n === 2 ? 'ADA unit' : n === 3 ? 'Hand-wash station' : 'Unit', quantity: '1', rate: '' });

/** Unit lines (R8-M1): a type, how many, and (for billing) the rate per period. */
function UnitLines({ lines, setLines, fin, currency }: { lines: LineEdit[]; setLines: (l: LineEdit[]) => void; fin: boolean; currency: string }) {
  const set = (i: number, p: Partial<LineEdit>) => setLines(lines.map((l, x) => (x === i ? { ...l, ...p } : l)));
  return (
    <div className="stack-sm">
      {lines.map((l, i) => (
        <div key={l.id} className="unit-line">
          <Field label="Unit type" id={`f-ul-${i}-label`}>{(p) => <Input {...p} maxLength={80} value={l.label} onChange={(e) => set(i, { label: e.target.value })} />}</Field>
          <Field label="How many" id={`f-ul-${i}-qty`}>{(p) => <Input {...p} className="input num-input" inputMode="numeric" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value.replace(/\D/g, '') })} />}</Field>
          {fin && <Field label={`Rate per unit (${currency})`} optionalText id={`f-ul-${i}-rate`}>{(p) => <Input {...p} className="input num-input" inputMode="decimal" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} />}</Field>}
          <Button size="sm" variant="ghost" aria-label={`Remove ${l.label}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, x) => x !== i))}><Trash2 aria-hidden /></Button>
        </div>
      ))}
      <div><Button size="sm" icon={<Plus aria-hidden />} onClick={() => setLines([...lines, blankLine(lines.length + 1)])}>Add unit type</Button></div>
    </div>
  );
}

function readUnitLines(lines: LineEdit[], fin: boolean) {
  let bad: string | null = null;
  const out = lines.map((l, i) => {
    const rateE4 = fin ? toRate(l.rate) : null;
    if (fin && l.rate.trim() !== '' && rateE4 === null) bad ??= `Enter the rate for "${l.label}" like 125.00.`;
    if (!l.label.trim()) bad ??= `Name unit type ${i + 1}.`;
    return { id: l.id, label: l.label.trim(), quantity: Number(l.quantity) || 0, rateE4 };
  });
  return { lines: out, bad };
}

export function RecurringNew() {
  const c = useCompany();
  const nav = useNavigate();
  const fin = c.can('finance.view');
  const customers = useQuery({ queryKey: [c.cid, 'customers', ''], queryFn: () => get(`/c/${c.cid}/customers`) });
  const services = useQuery({ queryKey: [c.cid, 'services'], queryFn: () => get(`/c/${c.cid}/services`) });
  const resources = useQuery({ queryKey: [c.cid, 'resources'], queryFn: () => get(`/c/${c.cid}/resources`), enabled: c.can('resources.view') });
  const today = localDate(new Date(), c.company.timezone);
  const [v, setV] = useState<any>({ name: '', kind: 'rental', customerId: '', locationId: '', serviceId: '', units: '1', startsOn: today, endsOn: '', details: {}, defaultUserId: '', truckId: '', createDelivery: true });
  // No day is pre-chosen (R7-m2): the person picks the visit days.
  const [rule, setRule] = useState<any>({ frequency: 'weekly', interval: 1, weekdays: [], time: '08:00', durationMinutes: 60 });
  const [billing, setBilling] = useState<any>({ frequency: 'every_n_days', everyDays: 28 });
  const [lines, setLines] = useState<LineEdit[]>([blankLine(1)]);
  const [prices, setPrices] = useState({ delivery: '', pickup: '', extra: '' });
  const [deposit, setDeposit] = useState({ type: 'none', amount: '', percent: '' });
  const cust = useQuery({ queryKey: [c.cid, 'customer', v.customerId], queryFn: () => get(`/c/${c.cid}/customers/${v.customerId}`), enabled: !!v.customerId });
  const svc = services.data?.services.find((s: any) => s.id === v.serviceId);
  const rental = v.kind === 'rental';
  const periodic = isPeriodic(billing.frequency);
  // Units only make sense for portable toilet service or rentals; fuel and septic plans don't show it (R7-m2).
  const showUnits = !rental && svc?.category === 'portable_toilet';
  const drivers = c.members.filter((m) => ['driver', 'owner', 'dispatcher'].includes(m.role_key));
  const trucks = (resources.data?.resources ?? []).filter((r: any) => r.kind === 'truck' && r.status !== 'retired');
  const office = c.members.find((m) => m.role_key === 'office')?.name;
  const s = useSubmit(async () => {
    const ul = readUnitLines(lines, fin);
    if (rental && periodic && ul.bad) throw new Error(ul.bad);
    const bad = Object.entries(prices).find(([, x]) => x.trim() !== '' && toRate(x) === null);
    if (bad) throw new Error(`Enter the ${bad[0]} price like 45.00, or leave it empty.`);
    const dep = deposit.type === 'fixed' ? { type: 'fixed', amountMinor: parseMoney(deposit.amount), percentBp: null } : deposit.type === 'percent' ? { type: 'percent', amountMinor: null, percentBp: Math.round(Number(deposit.percent) * 100) || null } : null;
    const billingRule = { ...billing, description: 'Unit rental', lines: rental && periodic ? ul.lines : [],
      visitPrices: fin && rental ? Object.fromEntries(Object.entries(prices).filter(([, x]) => x.trim() !== '').map(([k, x]) => [k, toRate(x)])) : {}, deposit: fin && rental ? dep : null };
    const r = await post(`/c/${c.cid}/recurring`, { name: v.name, kind: v.kind, customerId: v.customerId, locationId: v.locationId || null, serviceId: v.serviceId, units: Number(v.units) || 1,
      startsOn: v.startsOn, endsOn: v.endsOn || null, details: v.details, visitRule: rule, billingRule, defaultUserId: v.defaultUserId || null, defaultResourceIds: v.truckId ? [v.truckId] : [], createDelivery: rental && v.createDelivery });
    nav(c.to(`recurring/${r.id}`));
  });
  return (
    <div className="page page-narrow">
      <PageHeader back={{ to: c.to('recurring'), label: 'Recurring' }} title="New recurring plan" />
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); s.run(); }}>
        <ErrorSummary error={s.error} />
        <Card id="b" title="What and where"><div className="stack">
          <Field label="Plan name" id="f-name" error={s.fieldError('name')}>{(p) => <Input {...p} maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
          <Field label="Type" id="f-kind">{(p) => <Select {...p} value={v.kind} onChange={(e) => { setV({ ...v, kind: e.target.value }); setBilling(e.target.value === 'rental' ? { frequency: 'every_n_days', everyDays: 28 } : { frequency: 'per_visit', everyDays: 28 }); }}><option value="rental">Rental (units on site, serviced and billed on a schedule)</option><option value="service">Recurring service (each visit billed)</option></Select>}</Field>
          <Field label="Customer" id="f-customerId" error={s.fieldError('customerId')}>{(p) => <Select {...p} value={v.customerId} onChange={(e) => setV({ ...v, customerId: e.target.value, locationId: '' })}><option value="">Choose…</option>{customers.data?.customers.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
          <Field label="Location" id="f-locationId">{(p) => <Select {...p} value={v.locationId} disabled={!v.customerId} onChange={(e) => setV({ ...v, locationId: e.target.value })}><option value="">Choose…</option>{cust.data?.locations.map((l: any) => <option key={l.id} value={l.id}>{l.label ? `${l.label}: ` : ''}{l.address}</option>)}</Select>}</Field>
          <Field label="Service for each visit" id="f-serviceId" error={s.fieldError('serviceId')}>{(p) => <Select {...p} value={v.serviceId} onChange={(e) => setV({ ...v, serviceId: e.target.value, details: {} })}><option value="">Choose…</option>{services.data?.services.filter((x: any) => x.active).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
          {svc?.fields.filter((f: any) => f.stage !== 'completion' && f.key !== 'units' && f.key !== 'visit_type').map((f: any) => <DynamicField key={f.key} f={{ ...f, required: false }} value={v.details[f.key]} onChange={(x) => setV({ ...v, details: { ...v.details, [f.key]: x } })} />)}
          {showUnits && <Field label="Units" id="f-units">{(p) => <Input {...p} inputMode="numeric" value={v.units} onChange={(e) => setV({ ...v, units: e.target.value.replace(/\D/g, '') })} />}</Field>}
        </div></Card>
        <Card id="v" title="Visit schedule"><div className="stack">
          <RuleFields rule={rule} setRule={setRule} idp="f-visit" error={s.fieldError('visitRule.weekdays')} />
          <div className="grid-2">
            <Field label={rental ? 'Delivery day' : 'Starts on'} id="f-startsOn">{(p) => <Input {...p} type="date" value={v.startsOn} onChange={(e) => setV({ ...v, startsOn: e.target.value })} />}</Field>
            <Field label={billing.frequency === 'event' ? 'Pickup day' : 'Ends on'} optionalText={billing.frequency !== 'event'} id="f-endsOn" error={s.fieldError('endsOn')}>{(p) => <Input {...p} type="date" value={v.endsOn} onChange={(e) => setV({ ...v, endsOn: e.target.value })} />}</Field>
            <Field label="Driver for these visits" optionalText id="f-defaultUserId" hint="Visits arrive assigned to them.">{(p) => <Select {...p} value={v.defaultUserId} onChange={(e) => setV({ ...v, defaultUserId: e.target.value })}><option value="">Leave unassigned</option>{drivers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>
            <Field label="Truck" optionalText id="f-truck">{(p) => <Select {...p} value={v.truckId} onChange={(e) => setV({ ...v, truckId: e.target.value })}><option value="">None</option>{trucks.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>
          </div>
          {rental && <Checkbox label="Create the delivery job on the delivery day" checked={v.createDelivery} onChange={(e) => setV({ ...v, createDelivery: e.target.checked })} />}
        </div></Card>
        <Card id="bill" title="Billing"><div className="stack">
          <Field label="Bill" id="f-bfreq" hint={periodic ? 'Periods count from the delivery day, in your company time zone. Routine service visits are covered by the rent.' : undefined}>{(p) => <Select {...p} value={billingChoice(billing)} onChange={(e) => {
            const x = e.target.value;
            setBilling(x === 'four_weeks' ? { ...billing, frequency: 'every_n_days', everyDays: 28 } : x === 'n_days' ? { ...billing, frequency: 'every_n_days', everyDays: billing.everyDays && billing.everyDays !== 28 ? billing.everyDays : 14 } : { ...billing, frequency: x });
          }}>
            {rental ? <><option value="four_weeks">Every 4 weeks (28 days)</option><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="event">{BILLING_FREQUENCIES.event()}</option><option value="n_days">Every few days (choose how many)</option></> : null}
            <option value="per_visit">Each visit, using the service pricing</option><option value="none">Not billed by this plan</option>
          </Select>}</Field>
          {billingChoice(billing) === 'n_days' && <Field label="Bill every" id="f-bdays" hint="days" error={s.fieldError('billingRule.everyDays')}>{(p) => <Input {...p} inputMode="numeric" value={billing.everyDays} onChange={(e) => setBilling({ ...billing, everyDays: Math.min(365, Math.max(1, Number(e.target.value) || 1)) })} />}</Field>}
          {rental && periodic && <UnitLines lines={lines} setLines={setLines} fin={fin} currency={c.company.currency} />}
          {rental && periodic && !fin && <Banner tone="info">Rates for this plan are set by billing. {office ? `${office} will` : 'Billing will'} be asked to add them; rent invoices wait until then.</Banner>}
          {rental && fin && <>
            <fieldset className="stack-sm"><legend>Visits the rent doesn't cover</legend>
              <div className="grid-3">
                {(['delivery', 'pickup', 'extra'] as const).map((k) => <Field key={k} label={`${PLAN_VISIT_LABEL[k]} (${c.company.currency})`} optionalText id={`f-vp-${k}`} hint={k === 'extra' ? 'Empty: the service pricing' : 'Empty: free'}>{(p) => <Input {...p} inputMode="decimal" value={prices[k]} onChange={(e) => setPrices({ ...prices, [k]: e.target.value })} />}</Field>)}
              </div>
            </fieldset>
            <fieldset className="stack-sm"><legend>Deposit when booking</legend>
              <div className="grid-3">
                <Field label="Deposit" id="f-dep-type">{(p) => <Select {...p} value={deposit.type} onChange={(e) => setDeposit({ ...deposit, type: e.target.value })}><option value="none">No deposit</option><option value="fixed">Fixed amount</option><option value="percent">Percent of one period</option></Select>}</Field>
                {deposit.type === 'fixed' && <Field label={`Amount (${c.company.currency})`} id="f-dep-amount">{(p) => <Input {...p} inputMode="decimal" value={deposit.amount} onChange={(e) => setDeposit({ ...deposit, amount: e.target.value })} />}</Field>}
                {deposit.type === 'percent' && <Field label="Percent" id="f-dep-pct">{(p) => <Input {...p} inputMode="decimal" value={deposit.percent} onChange={(e) => setDeposit({ ...deposit, percent: e.target.value })} />}</Field>}
              </div>
            </fieldset>
          </>}
        </div></Card>
        <div className="form-actions"><Button type="submit" variant="primary" size="lg" busy={s.busy}>Create plan</Button></div>
      </form>
    </div>
  );
}

/** Billing sets the plan's prices after it was created (or changes them); draft rent invoices are rebuilt. */
function BillingDialog({ plan, open, onClose, onDone }: { plan: any; open: boolean; onClose: () => void; onDone: () => void }) {
  const c = useCompany();
  const b = plan.billing_rule;
  const [lines, setLines] = useState<LineEdit[]>(() => rentalLines(b, plan.units).map((l: any) => ({ id: l.id, label: l.label, quantity: String(l.quantity), rate: rateToInput(l.rateE4) })));
  const [prices, setPrices] = useState({ delivery: rateToInput(b.visitPrices?.delivery), pickup: rateToInput(b.visitPrices?.pickup), extra: rateToInput(b.visitPrices?.extra) });
  const s = useSubmit(async () => {
    const ul = readUnitLines(lines, true);
    if (ul.bad) throw new Error(ul.bad);
    const r = await put(`/c/${c.cid}/recurring/${plan.id}/billing`, { version: plan.version, billingRule: { ...b, rateMinor: null, lines: ul.lines, visitPrices: Object.fromEntries(Object.entries(prices).filter(([, x]) => x.trim() !== '').map(([k, x]) => [k, toRate(x)])) } });
    onDone(); return r;
  });
  return (
    <Dialog open={open} onClose={onClose} title="Rental prices" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={s.busy} onClick={() => s.run()}>Save prices</Button></>}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>Draft and held rent invoices are rebuilt with these prices. Issued invoices don't change.</p>
        <ErrorSummary error={s.error} />
        <UnitLines lines={lines} setLines={setLines} fin currency={c.company.currency} />
        <div className="grid-3">{(['delivery', 'pickup', 'extra'] as const).map((k) => <Field key={k} label={`${PLAN_VISIT_LABEL[k]} (${c.company.currency})`} optionalText id={`f-bvp-${k}`}>{(p) => <Input {...p} inputMode="decimal" value={prices[k]} onChange={(e) => setPrices({ ...prices, [k]: e.target.value })} />}</Field>)}</div>
      </div>
    </Dialog>
  );
}

export function RecurringDetail() {
  const c = useCompany();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: [c.cid, 'plan', id], queryFn: () => get(`/c/${c.cid}/recurring/${id}`) });
  const today = localDate(new Date(), c.company.timezone);
  const [dlg, setDlg] = useState<null | 'pause' | 'end' | 'change' | 'move' | 'billing' | 'deposit' | 'extra'>(null);
  const [dates, setDates] = useState({ from: today, until: '', pickup: true });
  const [rule, setRule] = useState<any>(null);
  const [dep, setDep] = useState({ amount: '', method: 'card', reference: '', key: newId('dep') });
  const refresh = () => qc.invalidateQueries({ queryKey: [c.cid] });
  const money = (n: number) => formatMoney(n, c.company.currency);
  const pause = useSubmit(async () => { const r = await post(`/c/${c.cid}/recurring/${id}/pause`, { from: dates.from, until: dates.until || null }); setDlg(null); toast(`Paused. ${r.cancelledVisits} unstarted visit(s) cancelled${r.creditMinor ? `; ${money(r.creditMinor)} credit goes on the next rent invoice` : ''}${r.rebuiltInvoices ? `; ${r.rebuiltInvoices} draft rent invoice(s) prorated` : ''}.`); refresh(); });
  const resume = useSubmit(async () => { await post(`/c/${c.cid}/recurring/${id}/resume`); toast('Resumed'); refresh(); });
  const end = useSubmit(async () => { const r = await post(`/c/${c.cid}/recurring/${id}/end`, { endsOn: dates.from, createPickup: dates.pickup }); setDlg(null); toast(`Plan ends ${fmtDate(dates.from)}. ${r.cancelledVisits} later visit(s) cancelled${r.creditMinor ? `; ${money(r.creditMinor)} of rent credited` : ''}${r.pickupJob ? `; pickup job #${r.pickupJob.number} created` : ''}.`); refresh(); });
  const change = useSubmit(async () => { const r = await post(`/c/${c.cid}/recurring/${id}/change`, { effectiveFrom: dates.from, visitRule: rule }); setDlg(null); toast(`Schedule changed. ${r.replacedVisits} visit(s) replaced. ${r.note}`); refresh(); });
  const move = useSubmit(async () => { const r = await post(`/c/${c.cid}/recurring/${id}/move`, { startsOn: dates.from }); setDlg(null); toast(`Event moved. ${r.movedJobs} job(s) moved with it.`); refresh(); });
  const extra = useSubmit(async () => { const r = await post(`/c/${c.cid}/recurring/${id}/extra`, { day: dates.from }); setDlg(null); toast(`Extra visit job #${r.number} created.`); refresh(); });
  const deposit = useSubmit(async () => { const m = parseMoney(dep.amount); if (!m) throw new Error('Enter the deposit amount.'); await post(`/c/${c.cid}/recurring/${id}/deposit`, { amountMinor: m, method: dep.method, reference: dep.reference, idempotencyKey: dep.key }); setDlg(null); toast('Deposit recorded. It pays the rent invoices as they are issued.'); refresh(); });
  const place = useSubmit(async (resourceId: string, placement: string) => { await post(`/c/${c.cid}/recurring/${id}/units`, { resourceId, placement }); refresh(); });
  if (q.isLoading) return <div className="page"><LoadingBlock /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} /></div>;
  const { plan, occurrences, otherJobs, invoices, preview, units, yard } = q.data;
  const fin = c.can('finance.view');
  const missed = occurrences.filter((o: any) => o.occurrence_date < today && o.job_id && ['draft', 'open', 'in_progress'].includes(o.status));
  const isEvent = plan.billing_rule.frequency === 'event';
  const rental = plan.kind === 'rental';
  const open = (k: typeof dlg, from = today) => { setDates({ from, until: '', pickup: rental }); setDlg(k); };
  return (
    <div className="page">
      <PageHeader back={{ to: c.to('recurring'), label: 'Recurring' }} docTitle={plan.name} title={<span className="row">{plan.name}<Pill tone={plan.status === 'active' ? 'success' : 'warning'}>{plan.status}</Pill></span>}
        sub={`${describeRule(plan.visit_rule)} at ${plan.visit_rule.time}${plan.default_user_name ? ` · ${plan.default_user_name}` : ''} · ${describeBilling(plan, c.company.currency, fin)}`}
        actions={c.can('jobs.edit') && plan.status !== 'ended' ? <>
          {plan.status === 'paused' ? <Button icon={<PlayCircle aria-hidden />} busy={resume.busy} onClick={() => resume.run()}>Resume</Button> : <Button icon={<PauseCircle aria-hidden />} onClick={() => open('pause')}>Pause</Button>}
          {isEvent ? <Button icon={<CalendarRange aria-hidden />} onClick={() => open('move', plan.starts_on)}>Move event</Button> : <Button onClick={() => { setRule(structuredClone(plan.visit_rule)); open('change'); }}>Change schedule</Button>}
          {rental && c.can('jobs.create') && <Button icon={<Plus aria-hidden />} onClick={() => open('extra')}>Extra visit</Button>}
          <Button variant="danger" icon={<CalendarX aria-hidden />} onClick={() => open('end', plan.ends_on ?? today)}>End plan</Button>
        </> : undefined} />
      {missed.length > 0 && <Banner tone="warning" title={`${missed.length} missed visit(s)`}>These visits are past their date and not finished. Reschedule or cancel them from the job.</Banner>}
      {plan.paused_from && <Banner tone="info">Paused from {fmtDate(plan.paused_from)}{plan.paused_until ? ` until ${fmtDate(plan.paused_until)}` : ' until resumed'}. Visits in that time are cancelled, and rent for those days is taken off by the day: draft rent invoices are reduced, and rent already invoiced is credited on the next rent invoice.</Banner>}
      {rental && !plan.ratesSet && <Banner tone="warning" title="Rental rates not set">{fin && c.can('invoices.edit') ? <>Rent invoices are held until the rates are set. <Button size="sm" onClick={() => setDlg('billing')}>Set rates</Button></> : 'Billing has been asked to set them; rent invoices wait until then.'}</Banner>}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card id="occ" title="Visits">
            {otherJobs.length > 0 && <ul className="list">{otherJobs.map((j: any) => <li key={j.id} className="row-between" style={{ padding: '8px 0' }}><span>{PLAN_VISIT_LABEL[j.visit as keyof typeof PLAN_VISIT_LABEL] ?? j.visit} · {fmtDate(j.scheduled_start, c.company.timezone)} · <Link to={c.to(`jobs/${j.id}`)}>Job #{j.number}</Link></span><JobStatus status={j.status} /></li>)}</ul>}
            <ul className="list">{occurrences.map((o: any) => <li key={o.occurrence_date} className="row-between" style={{ padding: '8px 0' }}><span>{fmtDate(o.occurrence_date)}{o.job_id ? <> · <Link to={c.to(`jobs/${o.job_id}`)}>Job #{o.number}</Link></> : null}</span>{o.state !== 'scheduled' ? <Pill>{o.state === 'skipped_paused' ? 'Skipped (paused)' : 'Cancelled'}</Pill> : o.status ? <JobStatus status={o.status} /> : null}</li>)}</ul>
            <p className="small muted">{preview.length ? <>Coming visits (next 30 days): {preview.slice(0, 8).map((d: string) => fmtDate(d)).join(', ')}{preview.length > 8 ? '…' : '.'}</> : 'No visits in the next 30 days.'}{rental ? ' Routine visits are covered by the rent.' : ''}</p>
          </Card>
          {rental && (
            <Card id="units" title={<h2 className="row"><Package aria-hidden />Units on site</h2>}>
              <ErrorSummary error={place.error} />
              {units.length === 0 ? <p className="muted">No units recorded at this site yet.</p> : <ul className="list">{units.map((u: any) => (
                <li key={u.id} className="row-between" style={{ padding: '8px 0' }}><span>{u.name}<div className="small muted">{u.placement === 'missing' ? 'Missing' : 'On site'}{u.placed_at ? ` since ${fmtDate(u.placed_at, c.company.timezone)}` : ''}</div></span>
                  {c.can('resources.edit') && <span className="row"><Button size="sm" onClick={() => place.run(u.id, 'yard')}>Back in the yard</Button>{u.placement !== 'missing' && <Button size="sm" variant="ghost" onClick={() => place.run(u.id, 'missing')}>Missing</Button>}</span>}</li>
              ))}</ul>}
              {c.can('resources.edit') && yard.length > 0 && <div style={{ marginTop: 8, maxWidth: 280 }}><Field label="Place a unit from the yard" id="f-place">{(p) => <Select {...p} value="" onChange={(e) => e.target.value && place.run(e.target.value, 'on_site')}><option value="">Choose a unit…</option>{yard.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}</Field></div>}
            </Card>
          )}
        </div>
        <div className="stack">
          <Card id="bill" title="Billing" actions={fin && c.can('invoices.edit') && rental && isPeriodic(plan.billing_rule.frequency) ? <Button size="sm" icon={<Pencil aria-hidden />} onClick={() => setDlg('billing')}>Prices</Button> : undefined}>
            {invoices.length === 0 ? <p className="muted">No invoices from this plan yet.</p> : <ul className="list">{invoices.map((i: any) => <li key={i.id} className="row-between" style={{ padding: '8px 0' }}><Link to={c.to(`invoices/${i.id}`)}>{i.number ?? 'Draft'}{i.period_start ? ` · ${fmtDate(i.period_start)} to ${fmtDate(i.period_end)}` : ''}</Link><span className="row">{i.total_minor !== null && i.total_minor !== undefined ? <span className="num">{money(i.total_minor)}</span> : null}{i.status === 'issued' ? <PaymentPill payment={{ key: i.payment_status === 'paid' ? 'paid' : 'unpaid', label: i.payment_status === 'paid' ? 'Paid' : i.payment_status === 'partially_paid' ? 'Partly paid' : 'Unpaid', tone: i.payment_status === 'paid' ? 'success' : 'neutral' }} /> : <InvoiceStatus status={i.status} />}</span></li>)}</ul>}
            {fin && plan.pending_credits?.length ? <p className="small muted">Credit waiting for the next rent invoice: {money(plan.pending_credits.reduce((s: number, x: any) => s + x.amountMinor, 0))}</p> : null}
            {fin && plan.depositDueMinor > 0 && <div className="row-between" style={{ marginTop: 8 }}><span className="small">Deposit: {money(plan.deposit_received_minor)} of {money(plan.depositDueMinor)} received</span>{plan.deposit_received_minor < plan.depositDueMinor && c.can('payments.record') && <Button size="sm" icon={<PiggyBank aria-hidden />} onClick={() => { setDep({ amount: minorToInput(plan.depositDueMinor - plan.deposit_received_minor), method: 'card', reference: '', key: newId('dep') }); setDlg('deposit'); }}>Record deposit</Button>}</div>}
          </Card>
        </div>
      </div>
      <Dialog open={dlg === 'pause'} onClose={() => setDlg(null)} title="Pause this plan" footer={<><Button onClick={() => setDlg(null)}>Cancel</Button><Button variant="primary" busy={pause.busy} onClick={() => pause.run()}>Pause</Button></>}>
        <div className="stack"><p style={{ margin: 0 }}>Unstarted visits in this period are cancelled with a note; started visits aren't touched. {rental ? 'Rent for the paused days is taken off by the day: draft rent invoices are reduced, and rent already invoiced is credited on the next rent invoice.' : ''}</p><ErrorSummary error={pause.error} />
          <div className="grid-2"><Field label="From" id="f-from">{(p) => <Input {...p} type="date" value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} />}</Field><Field label="Until" optionalText id="f-until" hint="Empty: until you resume.">{(p) => <Input {...p} type="date" value={dates.until} onChange={(e) => setDates({ ...dates, until: e.target.value })} />}</Field></div></div>
      </Dialog>
      <Dialog open={dlg === 'end'} onClose={() => setDlg(null)} title="End this plan" footer={<><Button onClick={() => setDlg(null)}>Cancel</Button><Button variant="danger" busy={end.busy} onClick={() => end.run()}>End plan</Button></>}>
        <div className="stack"><p style={{ margin: 0 }}>Unstarted visits after the last day are cancelled. {rental ? 'Rent after the last day is credited by the day.' : ''}</p><ErrorSummary error={end.error} />
          <Field label="Last day" id="f-endsOn" error={end.fieldError('endsOn')}>{(p) => <Input {...p} type="date" value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} />}</Field>
          {rental && <Checkbox label={`Create the pickup job for ${dates.from ? fmtDate(dates.from) : 'the last day'}`} hint="Assigned to the plan's driver." checked={dates.pickup} onChange={(e) => setDates({ ...dates, pickup: e.target.checked })} />}</div>
      </Dialog>
      <Dialog open={dlg === 'change'} onClose={() => setDlg(null)} title="Change the visit schedule" footer={<><Button onClick={() => setDlg(null)}>Cancel</Button><Button variant="primary" busy={change.busy} onClick={() => change.run()}>Apply from this date</Button></>}>
        {rule && <div className="stack"><p style={{ margin: 0 }}>Unstarted visits from this date are replaced using the new schedule. Visits someone else was assigned to, or already started, stay as they are.</p><ErrorSummary error={change.error} />
          <Field label="Effective from" id="f-eff">{(p) => <Input {...p} type="date" value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} />}</Field>
          <RuleFields rule={rule} setRule={setRule} idp="f-chg" /></div>}
      </Dialog>
      <Dialog open={dlg === 'move'} onClose={() => setDlg(null)} title="Move this event" footer={<><Button onClick={() => setDlg(null)}>Cancel</Button><Button variant="primary" busy={move.busy} onClick={() => move.run()}>Move event</Button></>}>
        <div className="stack"><p style={{ margin: 0 }}>Delivery, pickup and the visits between move together, keeping their times.</p><ErrorSummary error={move.error} />
          <Field label="New delivery day" id="f-move">{(p) => <Input {...p} type="date" value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} />}</Field>
          {plan.ends_on && dates.from ? <p className="small muted" style={{ margin: 0 }}>Pickup moves to {fmtDate(addDays(plan.ends_on, Math.round((Date.parse(dates.from) - Date.parse(plan.starts_on)) / 86400_000)))}.</p> : null}</div>
      </Dialog>
      <Dialog open={dlg === 'extra'} onClose={() => setDlg(null)} title="Add an extra visit" footer={<><Button onClick={() => setDlg(null)}>Cancel</Button><Button variant="primary" busy={extra.busy} onClick={() => extra.run()}>Create job</Button></>}>
        <div className="stack"><p style={{ margin: 0 }}>An extra visit isn't covered by the rent: it's billed at the plan's extra-visit price, or the service's pricing.</p><ErrorSummary error={extra.error} />
          <Field label="Day" id="f-extra">{(p) => <Input {...p} type="date" value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} />}</Field></div>
      </Dialog>
      <Dialog open={dlg === 'deposit'} onClose={() => setDlg(null)} title="Record the deposit" footer={<><Button onClick={() => setDlg(null)}>Cancel</Button><Button variant="primary" busy={deposit.busy} onClick={() => deposit.run()}>Record deposit</Button></>}>
        <div className="stack"><p style={{ margin: 0 }}>It becomes credit for this customer and pays the rent invoices as they are issued.</p><ErrorSummary error={deposit.error} />
          <div className="grid-2"><Field label={`Amount (${c.company.currency})`} id="f-dep">{(p) => <Input {...p} inputMode="decimal" value={dep.amount} onChange={(e) => setDep({ ...dep, amount: e.target.value })} />}</Field>
            <Field label="Method" id="f-dep-method">{(p) => <Select {...p} value={dep.method} onChange={(e) => setDep({ ...dep, method: e.target.value })}><option value="card">Card</option><option value="check">Check</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></Select>}</Field></div></div>
      </Dialog>
      {dlg === 'billing' && <BillingDialog plan={plan} open onClose={() => setDlg(null)} onDone={() => { setDlg(null); toast('Prices saved. Draft rent invoices were rebuilt.'); refresh(); }} />}
    </div>
  );
}
