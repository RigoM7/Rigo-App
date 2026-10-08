import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PauseCircle, PlayCircle, Bot, ShieldAlert } from 'lucide-react';
import { get, patch, put } from '../lib/api';
import { useWorkspace } from '../lib/session';
import { useSubmit } from '../lib/form';
import { useTitle } from '../lib/title';
import { relTime } from '../lib/format';
import { PageHeader, Button, Loading, ErrorState, FormError, Banner, Badge, useToast, Dialog, Segmented } from '../components/ui';
import { LEVELS, ACTION_STATUS, type Level, type RuleLevel } from '../../shared/automation';

// You stay in charge: Manual, Assisted (the default) or Automatic for the workspace and for each
// automation, a pause for everything, and a log of what Rigo prepared and what people decided.

export function SettingsAutomation() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  useTitle('Automation', ws.workspace.name);
  const r = useQuery({ queryKey: [ws.cid, 'automation'], queryFn: () => get<any>(`/c/${ws.cid}/automation`) });
  const [moneyConfirm, setMoneyConfirm] = useState<string | null>(null);
  const [resume, setResume] = useState(false);
  const refresh = () => { ws.refresh(); void qc.invalidateQueries({ queryKey: [ws.cid] }); };
  const setMode = useSubmit(async (mode: Level) => { await patch(`/c/${ws.cid}/automation`, { mode }); toast(`Rigo is ${LEVELS[mode].label} now.`); refresh(); });
  const setRule = useSubmit(async (key: string, level: RuleLevel, confirmMoney = false) => {
    try { await put(`/c/${ws.cid}/automation/rules/${key}`, { level, confirmMoney }); setMoneyConfirm(null); toast('Saved.'); refresh(); }
    catch (e: any) { if (e?.details?.needsConfirm === 'money') { setMoneyConfirm(key); return; } throw e; }
  });
  const pause = useSubmit(async (paused: boolean, held?: 'run' | 'cancel') => {
    const x = await patch<any>(`/c/${ws.cid}/automation`, { paused, held });
    toast(paused ? 'Rigo is paused. Nothing is prepared or sent on its own.' : `Rigo is running again.${x.ran ? ` ${x.ran} held item${x.ran === 1 ? '' : 's'} ran.` : ''}${x.cancelled ? ` ${x.cancelled} cancelled.` : ''}`);
    setResume(false); refresh();
  });
  if (r.isLoading) return <div className="page"><Loading /></div>;
  if (r.error) return <div className="page"><ErrorState error={r.error} retry={() => r.refetch()} /></div>;
  const d = r.data;
  const words = (t: string) => t.replace('{work}', ws.words.work.one.toLowerCase()).replace('{customer}', ws.words.customer.one.toLowerCase());
  return (
    <div className="page page-narrow">
      <PageHeader back={{ to: ws.to('settings'), label: 'Settings' }} title="Automation" sub="How much Rigo does on its own. Whatever you choose, nothing approves itself and you can pause at any time." />
      <FormError error={setMode.error ?? setRule.error ?? pause.error} />
      {ws.can('automation.control') && (
        <section className={`card stack ${d.paused ? 'attention-card' : ''}`} aria-labelledby="pause-h">
          <div className="row-between">
            <div className="row">{d.paused ? <PauseCircle className="icon-attn" aria-hidden="true" /> : <Bot aria-hidden="true" />}<h2 id="pause-h">{d.paused ? 'Rigo is paused' : 'Rigo is running'}</h2></div>
            {d.paused ? <Button variant="primary" onClick={() => (d.held ? setResume(true) : void pause.run(false))} busy={pause.busy} icon={<PlayCircle size={18} aria-hidden="true" />}>Resume</Button>
              : <Button onClick={() => void pause.run(true)} busy={pause.busy} icon={<PauseCircle size={18} aria-hidden="true" />}>Pause everything</Button>}
          </div>
          <p className="small">{d.paused ? `Nothing is prepared or sent on its own. ${d.held ? `${d.held} item${d.held === 1 ? ' is' : 's are'} waiting for you to resume.` : ''}` : 'Pause stops Rigo preparing or sending anything until you resume. Work, invoices and payments you do yourself are not affected.'}</p>
        </section>
      )}
      {ws.can('automation.manage') && (
        <section className="card stack" aria-labelledby="lvl-h">
          <h2 id="lvl-h">For the whole workspace</h2>
          <div className="choices">
            {(Object.keys(LEVELS) as Level[]).map((l) => (
              <button key={l} type="button" className="choice" aria-pressed={d.mode === l} onClick={() => void setMode.run(l)}>
                <strong>{LEVELS[l].label}{l === 'assisted' && <span className="small muted" style={{ fontWeight: 400 }}> · recommended</span>}</strong>
                <span className="small muted">{LEVELS[l].hint}</span>
              </button>
            ))}
          </div>
          <p className="small muted">Each automation below can be set lower, never higher, than this: the safest level wins.</p>
        </section>
      )}
      <section className="stack" aria-labelledby="rules-h">
        <h2 id="rules-h">What Rigo prepares</h2>
        {d.rules.map((rule: any) => (
          <article key={rule.key} className="card stack-sm">
            <div className="row-between"><h3>{rule.name}</h3>{rule.effective !== rule.level && rule.level !== 'off' && <Badge tone="open">Runs as {LEVELS[rule.effective as Level]?.label ?? 'Off'}</Badge>}</div>
            <p className="small muted">{words(rule.when)}: {words(rule.effective === 'automatic' ? rule.automatic : rule.assisted)}</p>
            {rule.money && <p className="small row"><ShieldAlert size={16} aria-hidden="true" />Moves money: Automatic needs an owner and a clear yes.</p>}
            {ws.can('automation.manage') && (
              <Segmented<RuleLevel> label={rule.name} value={rule.level} onChange={(v) => void setRule.run(rule.key, v)} options={[{ value: 'off', label: 'Off' }, { value: 'manual', label: 'Manual' }, { value: 'assisted', label: 'Assisted' }, { value: 'automatic', label: 'Automatic' }]} />
            )}
          </article>
        ))}
      </section>
      <Banner tone="info" title="What is connected">{['email', 'sms'].map((k) => d.capabilities[k].reason).join(' ')}</Banner>
      <section className="card stack" aria-labelledby="log-h">
        <div className="row-between"><h2 id="log-h">What Rigo did</h2>{d.waiting > 0 && <Link to={ws.to('inbox')}>{d.waiting} waiting in the inbox</Link>}</div>
        {!d.activity.length ? <p className="muted">Nothing yet. When Rigo prepares something, it shows here with what people decided.</p> : (
          <ul className="divider-list">{d.activity.map((a: any) => (
            <li key={a.id} className="list-row" style={{ paddingInline: 0 }}>
              <span className="row-main"><span className="row-title">{a.title}</span><span className="row-sub">{[ACTION_STATUS[a.status as keyof typeof ACTION_STATUS], a.decided_by && `by ${a.decided_by}`, relTime(a.created_at), a.summary].filter(Boolean).join(' · ')}</span></span>
            </li>
          ))}</ul>
        )}
      </section>
      {moneyConfirm && (
        <Dialog title="Let Rigo act on money?" onClose={() => setMoneyConfirm(null)} actions={<>
          <Button variant="danger" busy={setRule.busy} onClick={() => void setRule.run(moneyConfirm, 'automatic', true)}>Yes, set it to Automatic</Button>
          <Button variant="ghost" onClick={() => setMoneyConfirm(null)}>Keep it Assisted</Button>
        </>}>
          <p className="muted">Rigo would issue invoices on its own once they are approved, or straight away if your invoices don’t need approval. Invoices with a missing price are still held.</p>
        </Dialog>
      )}
      {resume && (
        <Dialog title="Resume Rigo?" onClose={() => setResume(false)} actions={<>
          <Button variant="primary" busy={pause.busy} onClick={() => void pause.run(false, 'run')}>Resume and run them</Button>
          <Button busy={pause.busy} onClick={() => void pause.run(false, 'cancel')}>Resume and cancel them</Button>
          <Button variant="ghost" onClick={() => setResume(false)}>Stay paused</Button>
        </>}>
          <p className="muted">{d.held} item{d.held === 1 ? ' was' : 's were'} held while Rigo was paused. Running them prepares them now, for approval as usual.</p>
        </Dialog>
      )}
    </div>
  );
}
