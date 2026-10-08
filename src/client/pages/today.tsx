import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, CheckCircle2, Circle, ChevronRight, Inbox as InboxIcon, CalendarDays, UserX, X } from 'lucide-react';
import { get, post } from '../lib/api';
import { useWorkspace } from '../lib/session';
import { useTitle } from '../lib/title';
import { fmtTime, fmtDay, dayKey } from '../lib/format';
import { LinkButton, StageBadge, Empty, Loading, ErrorState, Money, Button } from '../components/ui';

/** Today for the office: what needs a person first, then the day's work, then money at a glance. */
export function Today() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  useTitle('Today', ws.workspace.name);
  const today = dayKey(new Date(), ws.workspace.timezone);
  const work = useQuery({ queryKey: [ws.cid, 'work', 'today', today], queryFn: () => get<{ items: any[] }>(`/c/${ws.cid}/work?from=${today}&to=${today}`), enabled: ws.can('work.view_all') });
  const unassigned = useQuery({ queryKey: [ws.cid, 'work', 'unassigned'], queryFn: () => get<{ items: any[] }>(`/c/${ws.cid}/work?assignee=none&meaning=open,active`), enabled: ws.can('work.view_all') });
  const inbox = useQuery({ queryKey: [ws.cid, 'inbox'], queryFn: () => get<any>(`/c/${ws.cid}/inbox`) });
  const money = useQuery({ queryKey: [ws.cid, 'money', 'summary'], queryFn: () => get<any>(`/c/${ws.cid}/money/summary`), enabled: ws.can('money.view') });
  const setup = ws.setup;
  const waiting = inbox.data ? inbox.data.approvals.length + inbox.data.requests.length + inbox.data.held.length : 0;
  const W = ws.words.work;
  return (
    <div className="page">
      <div className="page-head">
        <div className="head-text"><div className="eyebrow">{fmtDay(new Date().toISOString(), ws.workspace.timezone)}</div><h1>Today</h1></div>
        {ws.can('work.create') && <LinkButton to={ws.to('work/new')} variant="primary" icon={<Plus size={18} aria-hidden="true" />}>New {W.one.toLowerCase()}</LinkButton>}
      </div>

      {setup && !setup.dismissed && setup.done < setup.total && (
        <section className="card card-lg stack tint" aria-labelledby="setup-h">
          <div className="row-between">
            <div className="stack-sm"><h2 id="setup-h">Finish setting up</h2><p className="small muted">{setup.done} of {setup.total} done</p></div>
            <Button variant="ghost" size="sm" icon={<X size={16} aria-hidden="true" />} onClick={async () => { await post(`/c/${ws.cid}/setup`, { mark: 'dismissed' }); ws.refresh(); }}>Hide</Button>
          </div>
          <ul className="divider-list">
            {setup.items.map((i) => (
              <li key={i.key}>
                <Link to={ws.to(i.link)} className="list-row" style={{ paddingInline: 0 }}>
                  {i.done ? <CheckCircle2 aria-hidden="true" style={{ color: 'var(--primary-text)' }} /> : <Circle aria-hidden="true" style={{ color: 'var(--text-2)' }} />}
                  <span className="row-main"><span className="row-title" style={i.done ? { textDecoration: 'line-through', color: 'var(--text-2)' } : undefined}>{i.label}</span>{i.note && <span className="row-sub">{i.note}</span>}</span>
                  {!i.done && <ChevronRight className="chev" aria-hidden="true" />}
                  <span className="sr-only">{i.done ? 'Done' : 'Not done yet'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {waiting > 0 && (
        <Link to={ws.to('inbox')} className="card attention-card row-between" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="row"><InboxIcon className="icon-attn" aria-hidden="true" /><span><strong>{waiting} waiting for you</strong><br />
            <span className="small">{[inbox.data.approvals.length && `${inbox.data.approvals.length} to approve`, inbox.data.requests.length && `${inbox.data.requests.length} new request${inbox.data.requests.length === 1 ? '' : 's'}`, inbox.data.held.length && `${inbox.data.held.length} held invoice${inbox.data.held.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span></span></span>
          <span className="btn btn-sm">Open inbox</span>
        </Link>
      )}

      {ws.can('work.view_all') && (
        <section className="stack" aria-labelledby="today-work">
          <div className="row-between">
            <h2 id="today-work">{W.many} today</h2>
            <LinkButton to={ws.to('work?view=timeline')} variant="ghost" size="sm" icon={<CalendarDays size={16} aria-hidden="true" />}>Open the schedule</LinkButton>
          </div>
          {work.isLoading ? <Loading rows={3} /> : work.error ? <ErrorState error={work.error} retry={() => work.refetch()} /> : !work.data?.items.length ? (
            <div className="card"><Empty icon={<CalendarDays />} title={`No ${W.many.toLowerCase()} today`} action={ws.can('work.create') ? <LinkButton to={ws.to('work/new')} icon={<Plus size={18} aria-hidden="true" />}>New {W.one.toLowerCase()}</LinkButton> : undefined}>
              Anything scheduled for today shows here, in order.</Empty></div>
          ) : (
            <div className="card card-flush"><ul className="divider-list">
              {work.data.items.map((w) => (
                <li key={w.id}>
                  <Link className="list-row" to={ws.to(`work/${w.id}`)}>
                    <span className="time" style={{ width: 72, flex: 'none', fontWeight: 600 }}>{fmtTime(w.startsAt, ws.workspace.timezone)}</span>
                    <span className="row-main">
                      <span className="row-title">{w.title || w.client?.name || `${W.one} #${w.number}`}</span>
                      <span className="row-sub">{[w.client?.name !== w.title && w.client?.name, w.place?.address, w.assignees.map((a: any) => a.name).join(', ') || 'Not assigned'].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="row-end"><StageBadge name={w.stage.name} meaning={w.stage.meaning} /></span>
                  </Link>
                </li>
              ))}
            </ul></div>
          )}
          {(unassigned.data?.items.length ?? 0) > 0 && (
            <Link to={ws.to('work?assignee=none')} className="banner banner-attn" style={{ textDecoration: 'none', color: 'inherit' }}>
              <UserX aria-hidden="true" /><div className="grow"><strong>{unassigned.data!.items.length} open {unassigned.data!.items.length === 1 ? W.one.toLowerCase() : W.many.toLowerCase()} with nobody assigned</strong></div><ChevronRight aria-hidden="true" />
            </Link>
          )}
        </section>
      )}

      {ws.can('money.view') && money.data && (
        <section className="stack" aria-labelledby="today-money">
          <div className="row-between"><h2 id="today-money">Money</h2><LinkButton to={ws.to('money')} variant="ghost" size="sm">Open Money</LinkButton></div>
          <div className="facts">
            <div className="fact"><span className="label">Owed to you</span><Money className="value mono" minor={money.data.owedMinor} currency={money.data.currency} /></div>
            <div className="fact"><span className="label">Overdue</span><Money className="value mono" minor={money.data.owedMinor - money.data.aging[0].minor} currency={money.data.currency} /></div>
            <div className="fact"><span className="label">Ready to bill</span><span className="value">{money.data.ready}</span><span className="sub">finished, not invoiced</span></div>
          </div>
        </section>
      )}
      {!ws.can('work.view_all') && !ws.can('money.view') && <Empty icon={<InboxIcon />} title="Nothing for your role here yet">Your inbox has what is waiting for you.</Empty>}
      <span hidden>{qc ? '' : ''}</span>
    </div>
  );
}
