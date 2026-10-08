import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigation, Phone, CheckCircle2, Clock, ListTodo, WifiOff, AlertTriangle, ChevronLeft, CloudUpload } from 'lucide-react';
import { get, ApiError, OFFLINE } from '../lib/api';
import { useMe, useWorkspace } from '../lib/session';
import { useTitle } from '../lib/title';
import { fmtTime, fmtDay, fmtDateTime, mapsUrl, relTime } from '../lib/format';
import { cacheList, cachedList, getDraft, saveDraft, syncDraft, deleteDraft, listDrafts, onDraftsChanged, type Draft } from '../lib/offline';
import { newerDraft } from '../lib/draft-rev';
import { Button, StageBadge, Empty, Loading, ErrorState, TextArea, Banner, useToast } from '../components/ui';
import { FieldInput, FieldValues } from '../components/fields';
import type { WorkItem } from './work';
import type { FieldDef, Meaning } from '../../shared/workspace';

// The worker's phone: Today, Upcoming and Done. The address first, big buttons, one main action at
// the bottom. Works offline: lists are kept on the phone and updates send when signal returns. Only
// the server's acceptance moves the work.

interface MyItem extends WorkItem { next: { key: string; name: string; meaning: Meaning; requires: string[] }[] }
interface MyWork { today: MyItem[]; upcoming: MyItem[]; done: MyItem[]; fields: FieldDef[]; date: string; offlineSince?: string }

const isOffline = (e: unknown) => e instanceof ApiError && (e.code === OFFLINE || e.status === 0);

function useMyWork() {
  const ws = useWorkspace();
  const me = useMe();
  const uid = me.data?.user?.id ?? '';
  return useQuery({
    queryKey: [ws.cid, 'my-work'], networkMode: 'always', refetchInterval: 60_000,
    queryFn: async (): Promise<MyWork> => {
      try {
        const r = await get<MyWork>(`/c/${ws.cid}/my/work`);
        void cacheList(uid, ws.cid, r);
        return r;
      } catch (e) {
        if (!isOffline(e)) throw e;
        const c = await cachedList<MyWork>(uid, ws.cid);
        if (!c) throw e;
        return { ...c.payload, offlineSince: c.cachedAt };
      }
    },
  });
}

function useDrafts() {
  const ws = useWorkspace();
  const me = useMe();
  const uid = me.data?.user?.id ?? '';
  const [drafts, setDrafts] = useState<Draft[]>([]);
  useEffect(() => {
    const read = () => { void listDrafts(uid, ws.cid).then(setDrafts); };
    read();
    return onDraftsChanged(read);
  }, [uid, ws.cid]);
  return drafts;
}

/**
 * The one main action: start open work (its first Active stage), finish active work (its first
 * Finished stage), otherwise the next stage further along that isn't a failure.
 */
export function forwardStep<T extends { key: string; meaning: Meaning }>(current: { key: string; meaning: Meaning }, next: T[], stages: { key: string; position: number }[]): T | null {
  const want = current.meaning === 'open' ? 'active' : current.meaning === 'active' ? 'finished' : null;
  const pos = stages.find((s) => s.key === current.key)?.position ?? 0;
  return next.find((n) => n.meaning === want)
    ?? next.find((n) => (stages.find((s) => s.key === n.key)?.position ?? 0) > pos && n.meaning !== 'failed' && n.meaning !== 'cancelled') ?? null;
}

const DRAFT_TEXT: Record<string, string> = { queued: 'Saved on this phone, sends with signal', pending: 'Sending…', failed: 'Will try sending again', conflict: 'Needs your look', local: 'Not sent yet' };

export function WorkerList({ list }: { list: 'today' | 'upcoming' | 'done' }) {
  const ws = useWorkspace();
  const W = ws.words.work;
  const titles = { today: 'Today', upcoming: 'Upcoming', done: 'Done' };
  useTitle(titles[list], ws.workspace.name);
  const r = useMyWork();
  const drafts = useDrafts();
  const tz = ws.workspace.timezone;
  if (r.isLoading) return <Loading />;
  if (r.error) return <ErrorState error={r.error} retry={() => r.refetch()} />;
  const items = r.data![list];
  return (
    <div className="stack">
      <div className="stack-sm">
        <h1>{titles[list]}</h1>
        {list === 'today' && <p className="muted">{fmtDay(new Date().toISOString(), tz)} · {items.length ? `${items.length} ${items.length === 1 ? W.one.toLowerCase() : W.many.toLowerCase()}` : 'nothing yet'}</p>}
      </div>
      {r.data!.offlineSince && <Banner tone="attn" title="No signal">Showing what this phone saved {relTime(r.data!.offlineSince)}.</Banner>}
      {!items.length ? (
        <div className="card"><Empty icon={list === 'done' ? <CheckCircle2 /> : list === 'upcoming' ? <Clock /> : <ListTodo />}
          title={list === 'today' ? `No ${W.many.toLowerCase()} for you today` : list === 'upcoming' ? 'Nothing coming up' : 'Nothing finished in the last two weeks'}>
          {list === 'today' ? 'When the office gives you work, it shows here.' : undefined}</Empty></div>
      ) : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((w) => {
            const d = drafts.find((x) => x.workId === w.id && x.state !== 'accepted');
            return (
              <li key={w.id}>
                <Link to={ws.to(`work/${w.id}`)} className={`worker-card ${w.stage.meaning === 'active' ? 'is-active' : ''}`}>
                  <div className="row-between"><span className="when">{w.startsAt ? (list === 'today' ? fmtTime(w.startsAt, tz) : fmtDateTime(w.startsAt, tz)) : 'Any time'}</span><StageBadge name={w.stage.name} meaning={w.stage.meaning} /></div>
                  <span className="addr">{w.place?.address ?? w.client?.name ?? (w.title || `${W.one} #${w.number}`)}</span>
                  <span className="muted">{[w.title, w.client?.name].filter(Boolean).join(' · ')}</span>
                  {d && <span className="badge badge-attn"><CloudUpload aria-hidden="true" />{DRAFT_TEXT[d.state]}: {d.toName}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function WorkerItem() {
  const ws = useWorkspace();
  const { id = '' } = useParams();
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const uid = me.data?.user?.id ?? '';
  const r = useMyWork();
  const item = useMemo(() => r.data ? [...r.data.today, ...r.data.upcoming, ...r.data.done].find((w) => w.id === id) : undefined, [r.data, id]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useTitle(item ? (item.title || item.place?.address || `#${item.number}`) : ws.words.work.one, ws.workspace.name);
  useEffect(() => {
    const read = () => { void getDraft(uid, ws.cid, id).then((d) => setDraft((cur) => newerDraft(cur, d ?? null))); };
    read();
    return onDraftsChanged(read);
  }, [uid, ws.cid, id]);
  if (r.isLoading) return <Loading />;
  if (r.error) return <ErrorState error={r.error} retry={() => r.refetch()} />;
  if (!item) return <Empty icon={<AlertTriangle />} title="Not on your list" action={<Button onClick={() => nav(ws.to())}>Back to Today</Button>}>It may have been given to someone else, or it was finished a while ago.</Empty>;
  const tz = ws.workspace.timezone;
  const fwd = forwardStep(item.stage, item.next, ws.stages);
  const fail = item.next.find((n) => n.meaning === 'failed');
  const fieldsFor = (stageKey: string) => {
    const req = item.next.find((n) => n.key === stageKey)?.requires ?? [];
    return r.data!.fields.filter((f) => req.includes(f.key));
  };
  const needed = fwd ? fieldsFor(fwd.key) : [];
  const pendingDraft = draft && draft.state !== 'accepted' ? draft : null;

  const send = async (to: { key: string; name: string }) => {
    setBusy(true);
    const d: Draft = {
      userId: uid, companyId: ws.cid, workId: item.id, number: item.number, title: item.title, baseVersion: item.version,
      submissionId: `sub-${crypto.randomUUID()}`, to: to.key, toName: to.name, fields: { ...fields }, note, state: 'local',
      rev: (draft?.rev ?? 0) + 1, updatedAt: new Date().toISOString(),
    };
    await saveDraft(d);
    const res = await syncDraft(d);
    setDraft(res);
    setBusy(false);
    if (res.state === 'accepted') {
      toast(`${to.name}. Sent.`);
      await deleteDraft(uid, ws.cid, item.id);
      setNote(''); setFields({});
      await qc.invalidateQueries({ queryKey: [ws.cid, 'my-work'] });
      if (to.key !== fwd?.key || !item.next.length) nav(ws.to());
    } else if (res.state === 'queued') toast('Saved on this phone. It sends by itself when there is signal.', 'info');
    else if (res.state === 'conflict' || res.state === 'local') toast(res.message ?? 'Check this.', 'error');
  };
  const discard = async () => { await deleteDraft(uid, ws.cid, item.id); setDraft(null); await qc.invalidateQueries({ queryKey: [ws.cid, 'my-work'] }); };

  return (
    <div className="stack">
      <button className="back-link link-btn" style={{ textDecoration: 'none', color: 'var(--text-2)' }} onClick={() => nav(-1)}><ChevronLeft size={18} aria-hidden="true" />Back</button>
      <div className="stack-sm">
        <div className="row-between"><span className="mono" style={{ fontSize: '1.25rem', fontWeight: 600 }}>{item.startsAt ? fmtDateTime(item.startsAt, tz) : 'Any time'}</span><StageBadge name={item.stage.name} meaning={item.stage.meaning} /></div>
        <h1 className="wrap-anywhere">{item.place?.address ?? item.client?.name ?? (item.title || `#${item.number}`)}</h1>
        <p className="muted">{[item.title, item.client?.name].filter(Boolean).join(' · ')}</p>
      </div>
      <div className="row">
        {item.place && <a className="btn btn-lg" href={mapsUrl(item.place.address)} target="_blank" rel="noreferrer"><Navigation aria-hidden="true" />Directions</a>}
        {item.client?.phone && <a className="btn btn-lg" href={`tel:${item.client.phone}`}><Phone aria-hidden="true" />Call</a>}
      </div>
      {item.place?.notes && <Banner tone="info" title="Getting in">{item.place.notes}</Banner>}
      {(item.notes || Object.keys(item.fields).length > 0) && (
        <section className="card stack-sm">
          {item.notes && <p style={{ whiteSpace: 'pre-wrap' }}>{item.notes}</p>}
          <FieldValues defs={r.data!.fields} values={item.fields} currency={ws.workspace.currency} />
        </section>
      )}
      {pendingDraft && (
        <Banner tone={pendingDraft.state === 'conflict' || pendingDraft.state === 'local' ? 'error' : 'attn'} title={`${DRAFT_TEXT[pendingDraft.state]}: ${pendingDraft.toName}`}
          action={(pendingDraft.state === 'conflict' || pendingDraft.state === 'local') ? <Button size="sm" onClick={() => void discard()}>Discard</Button> : undefined}>
          {pendingDraft.message}
        </Banner>
      )}
      {item.next.length > 0 && !(pendingDraft && ['queued', 'pending', 'failed'].includes(pendingDraft.state)) && (
        <section className="card stack">
          {needed.map((f) => <FieldInput key={f.key} def={{ ...f, required: true }} value={fields[f.key] ?? item.fields[f.key]} onChange={(v) => setFields({ ...fields, [f.key]: v })} error={pendingDraft?.errors?.[`fields.${f.key}`] ?? pendingDraft?.errors?.[f.key]} />)}
          <TextArea label="Note for the office" optional rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          {fail && <Button variant="ghost" onClick={() => void send(fail)} disabled={busy}>{fail.name}</Button>}
        </section>
      )}
      {r.data!.offlineSince && <p className="small muted row"><WifiOff size={16} aria-hidden="true" />No signal. Updates are saved on this phone and send by themselves.</p>}
      {fwd && !(pendingDraft && ['queued', 'pending', 'failed'].includes(pendingDraft.state)) && (
        <div className="action-bar"><div className="inner">
          <Button variant="primary" size="lg" block busy={busy} onClick={() => void send(fwd)}>{fwd.meaning === 'finished' ? `Finish: ${fwd.name}` : fwd.meaning === 'active' ? `Start: ${fwd.name}` : `Move to ${fwd.name}`}</Button>
        </div></div>
      )}
    </div>
  );
}
