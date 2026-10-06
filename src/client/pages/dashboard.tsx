import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Hand, CheckCircle2, Plus, Zap, PauseCircle, ArrowRight, ClipboardList, Users, Wrench } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get } from '../lib/api';
import { LoadingBlock, ErrorState, LinkButton, Pill, Empty, TickNumber, LiveDot } from '../components/ui';
import { formatMoney } from '../lib/format';
import { DispatchTimeline } from '../components/timeline';
import { SetupChecklist } from './setup';
import { useDocumentTitle } from '../lib/title';

// The owner's command center. Today's timeline leads; "Needs you" and "What Rigo is doing" sit
// around it, compact. Every number comes from real records; empty companies get setup actions.

const NEED_ACTION: Record<string, string> = {
  approvals: 'Review', ready: 'Run steps', blocked: 'See why', held: 'Fix holds', problems: 'Open', unassigned: 'Assign', urgent: 'Assign', late: 'See late jobs', exceptions: 'Review', drafts: 'Complete',
};

function useClock(tz: string) {
  const fmt = () => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date());
  const [t, setT] = useState(fmt);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const i = setInterval(() => setT(fmt()), 15_000); return () => clearInterval(i); }, [tz]);
  return t;
}

export function Dashboard() {
  const c = useCompany();
  useDocumentTitle('Home');
  const q = useQuery({ queryKey: [c.cid, 'overview'], queryFn: () => get(`/c/${c.cid}/overview`), refetchInterval: 30_000 });
  const clock = useClock(c.company.timezone);
  if (q.isLoading) return <div className="page page-wide"><LoadingBlock rows={8} /></div>;
  if (q.error) return <div className="page page-wide"><ErrorState error={q.error} retry={() => q.refetch()} /></div>;
  const d = q.data;
  const date = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: c.company.timezone }).format(new Date());
  const r = d.rigo;
  const busy = r ? r.queued + r.running : 0;
  return (
    <div className="page page-wide">
      <div className="home-head">
        <div>
          <h1>Home</h1>
          <div className="when"><span>{date}</span><span aria-hidden>·</span><span className="clock" aria-label={`Local time ${clock}`}>{clock}</span><span aria-hidden>·</span><span>{c.company.name}</span></div>
        </div>
        {c.can('jobs.create') && <LinkButton variant="primary" to={c.to('jobs/new')} icon={<Plus aria-hidden />}>New job</LinkButton>}
      </div>

      <section aria-labelledby="att-h" className="needs-strip" data-guide-target="needs-you">
        <h2 id="att-h" className="needs-strip-label">Needs you</h2>
        {d.attention.length === 0 ? (
          <span className="all-clear"><CheckCircle2 aria-hidden />Nothing needs your attention right now.</span>
        ) : d.attention.map((a: any) => (
          <div key={a.key} className={`need tone-${a.tone}`}>
            {a.tone === 'warning' ? <AlertTriangle aria-hidden /> : <Hand aria-hidden />}
            <span className="n" aria-hidden>{a.count}</span>
            <span><span className="sr-only">{a.count} </span>{a.label}</span>
            <Link className={`btn btn-sm${a.key === 'approvals' ? ' btn-primary' : ''}`} to={c.to(a.link)} aria-label={`${NEED_ACTION[a.key] ?? 'Open'}: ${a.label}`}>{NEED_ACTION[a.key] ?? 'Open'}</Link>
          </div>
        ))}
      </section>

      {d.invoiceApprovals?.length > 0 && (
        <section className="card stack-sm" aria-labelledby="inv-ap-h">
          <div className="section-head"><h2 id="inv-ap-h">Invoices waiting for your approval</h2><Link to={c.to('inbox')} className="small">Open the inbox</Link></div>
          <ul className="list">
            {d.invoiceApprovals.map((a: any) => (
              <li key={a.id} className="row-between" style={{ padding: '8px 0', alignItems: 'center' }}>
                <span style={{ minWidth: 0 }}><strong>{a.summary?.customerName ?? 'Invoice'}</strong>{a.summary?.jobNumber ? <> · Job <span className="num">#{a.summary.jobNumber}</span></> : null}{a.summary?.serviceName ? ` · ${a.summary.serviceName}` : ''}
                  <div className="small muted">{a.summary?.lines?.map((l: any) => l.description).join(', ')}{a.summary?.quantityNote ? ` · ${a.summary.quantityNote}` : ''}</div></span>
                <span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                  {a.summary?.totalMinor !== undefined ? <span className="as-total">{a.summary.totalMinor === null ? 'Incomplete' : formatMoney(a.summary.totalMinor, a.summary.currency)}</span> : null}
                  <Link className="btn btn-sm" to={`${c.to('inbox')}#ap-${a.id}`} aria-label={`Review the invoice for ${a.summary?.customerName ?? 'this customer'}${a.summary?.jobNumber ? `, job #${a.summary.jobNumber}` : ''}`}>Review</Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.setup && !c.setup.ready && !c.demo && <SetupChecklist compact />}

      <div className="cc-grid">
        <div className="stack" style={{ minWidth: 0 }}>
          {d.today && (d.empty ? (
            <section className="card" aria-labelledby="first-h">
              <Empty icon={<ClipboardList />} title="No jobs yet"
                action={<div className="row" style={{ justifyContent: 'center' }}>
                  {c.can('jobs.create') && <LinkButton variant="primary" to={c.to('jobs/new')} icon={<Plus aria-hidden />}>Create the first job</LinkButton>}
                  {c.can('customers.edit') && <LinkButton to={c.to('customers')} icon={<Users aria-hidden />}>Add customers</LinkButton>}
                  {c.can('services.manage') && <LinkButton to={c.to('services')} icon={<Wrench aria-hidden />}>Check services and rates</LinkButton>}
                </div>}>
                <span id="first-h">Once jobs have a time, today's timeline shows each driver's day here, live. Add customers first, or create a job and a customer together.</span>
              </Empty>
            </section>
          ) : <DispatchTimeline />)}
        </div>

        <aside className="side-stack" aria-label="Status">
          {r && (
            <section className="card stack" aria-labelledby="rigo-h">
              <div className="section-head"><h2 id="rigo-h" className="row" style={{ gap: 8 }}><Zap aria-hidden style={{ width: 16 }} />What Rigo is doing</h2></div>
              <div className="row" style={{ gap: 6 }}>
                <Pill tone="brand">{r.mode === 'manual' ? 'Manual' : r.mode === 'assisted' ? 'Assisted' : 'Automatic'} mode</Pill>
                {r.paused ? <Pill tone="warning" icon={<PauseCircle aria-hidden />}>Paused</Pill> : null}
              </div>
              <p className="status-line" style={{ margin: 0 }}>
                {r.paused ? <><PauseCircle aria-hidden style={{ width: 16, color: 'var(--warning)' }} />Holding all queued work</> : busy ? <><LiveDot />Working on {busy} step{busy === 1 ? '' : 's'}</> : r.waiting_approval ? <><Hand aria-hidden style={{ width: 16, color: 'var(--primary-text)' }} />Waiting on your approval</> : <><CheckCircle2 aria-hidden style={{ width: 16, color: 'var(--success)' }} />Idle and up to date</>}
              </p>
              <dl className="metric-list">
                <dt>Waiting for approval</dt><dd><TickNumber value={r.waiting_approval} /></dd>
                <dt>Queued or running</dt><dd><TickNumber value={busy} /></dd>
                <dt>Done in the last 24 h</dt><dd><TickNumber value={r.done_today} /></dd>
                <dt>Active workflows</dt><dd><TickNumber value={r.activeWorkflows} /></dd>
              </dl>
              <Link to={c.to('automation')} className="small row" style={{ gap: 4 }}>Automation controls<ArrowRight aria-hidden style={{ width: 14 }} /></Link>
            </section>
          )}
          {d.business && (
            <section className="card stack" aria-labelledby="biz-h">
              <h2 id="biz-h">Last 30 days</h2>
              <dl className="metric-list">
                <dt>Jobs completed</dt><dd><TickNumber value={d.business.completed30} /></dd>
                <dt>Partial or unsuccessful</dt><dd><TickNumber value={d.business.exceptions30} /></dd>
                <dt>Customers</dt><dd><TickNumber value={d.business.customers} /></dd>
                {d.business.issued30Minor !== undefined && <><dt>Invoiced</dt><dd>{formatMoney(d.business.issued30Minor, d.business.currency)}</dd></>}
                {d.business.waitingMinor ? <><dt>Drafts waiting for approval</dt><dd>{formatMoney(d.business.waitingMinor, d.business.currency)}</dd></> : null}
                {d.business.outstandingMinor !== undefined && <><dt>Outstanding</dt><dd>{formatMoney(d.business.outstandingMinor, d.business.currency)}</dd></>}
              </dl>
              <p className="xsmall muted" style={{ margin: 0 }}>Calculated from your records. Payments are recorded by your team; Rigo does not process payments.</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
