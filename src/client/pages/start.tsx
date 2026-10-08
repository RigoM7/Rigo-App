import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Plus, Trash2, Sparkles, Eye, Users, Layers, MessageSquareText, Smartphone, Building2 } from 'lucide-react';
import { get, post } from '../lib/api';
import { refreshMe, useMe } from '../lib/session';
import { useSubmit } from '../lib/form';
import { useTitle } from '../lib/title';
import { Button, LinkButton, TextField, TextArea, SelectField, FormError, Banner, Wordmark, Badge, Loading, useToast } from '../components/ui';
import { TEMPLATES, matchTemplates, templateByKey, structureOf, type Template } from '../../shared/templates';
import { WORD_KEYS, WORD_HINTS, MEANINGS, MEANING_KEYS, fieldKey, roleKey, structureProblems, type Structure, type Meaning } from '../../shared/workspace';
import { PERMISSION_PRESETS } from '../../shared/permissions';
import { CURRENCIES } from '../../shared/money';
import { COMMON_TIMEZONES, TIMEZONE_NAMES } from '../../shared/timezones';

// The first five minutes: name the workspace and say what the business does (or pick a type), see
// the closest template and what it brings, adjust words, stages and roles on one screen, invite the
// team or skip, and land on Today. Suggestions use plain word matching, never AI.

const WORD_LABELS: Record<string, string> = { work: 'Main record', customer: 'Customers', person: 'Team', equipment: 'Equipment', location: 'Places' };

function deviceTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; } catch { return 'America/New_York'; }
}

interface LibItem { key: string; name: string; blurb: string; examples: string[]; structure: Structure; from?: string }

function Steps({ step }: { step: number }) {
  const names = ['Your business', 'Template', 'Review', 'Your team'];
  return (
    <ol className="stage-steps" aria-label="Steps">
      {names.map((n, i) => <li key={n} className={i < step ? 'past' : ''} aria-current={i === step ? 'step' : undefined}><span className="pip" aria-hidden="true" />{n}</li>)}
    </ol>
  );
}

function Brings({ s }: { s: Structure }) {
  return (
    <div className="grid-2">
      <div className="stack-sm"><h3 className="row"><MessageSquareText size={18} aria-hidden="true" />Its words</h3>
        <p className="small">{s.words.work.many} for {s.words.customer.many.toLowerCase()}, done by your {s.words.person.many.toLowerCase()}{s.equipment ? `, with ${s.words.equipment.many.toLowerCase()}` : ''}.</p></div>
      <div className="stack-sm"><h3 className="row"><Layers size={18} aria-hidden="true" />Stages</h3>
        <p className="small">{s.stages.map((x) => x.name).join(' → ')}</p></div>
      <div className="stack-sm"><h3 className="row"><Users size={18} aria-hidden="true" />Roles</h3>
        <p className="small">Owner{s.roles.map((r) => `, ${r.name}${r.app === 'worker' ? ' (phone)' : ''}`).join('')}</p></div>
      <div className="stack-sm"><h3 className="row"><Building2 size={18} aria-hidden="true" />What you sell</h3>
        <p className="small">{s.catalog.length ? s.catalog.map((c) => c.name).join(', ') : 'Add your own'}. No prices: you set those.</p></div>
    </div>
  );
}

export function Start() {
  useTitle('New workspace');
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [tz, setTz] = useState(deviceTz());
  const [currency, setCurrency] = useState<string>('USD');
  const [picked, setPicked] = useState<string | null>(sp.get('template'));
  const [structure, setStructure] = useState<Structure | null>(null);
  const [cid, setCid] = useState<string | null>(null);
  const [emails, setEmails] = useState('');
  const [inviteRole, setInviteRole] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const lib = useQuery({ queryKey: ['library'], queryFn: () => get<{ builtIn: LibItem[]; shared: LibItem[] }>('/library'), staleTime: 60_000 });

  const matches = useMemo(() => matchTemplates(desc), [desc]);
  const suggested = templateByKey(matches[0].key)!;
  const chosenKey = picked ?? suggested.key;
  const chosen: LibItem | Template | undefined = templateByKey(chosenKey) ?? lib.data?.shared.find((x) => x.key === chosenKey);

  useEffect(() => { if (chosen && step === 1) setStructure(JSON.parse(JSON.stringify(chosen.structure))); }, [chosenKey, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = useSubmit(async (allowDuplicateName?: boolean) => {
    const r = await post<{ id: string }>('/companies', { name, description: desc, templateKey: chosenKey, structure, timezone: tz, currency, allowDuplicateName: !!allowDuplicateName });
    setCid(r.id);
    await refreshMe(qc);
    setInviteRole(structure?.roles[0]?.key ?? '');
    setStep(3);
  });
  const invite = useSubmit(async () => {
    const r = await post<{ results: { email: string; ok: boolean; message: string }[] }>(`/c/${cid}/invitations/bulk`, { emails, role: inviteRole });
    const ok = r.results.filter((x) => x.ok).length;
    const bad = r.results.filter((x) => !x.ok);
    if (bad.length) throw Object.assign(new Error(`${bad.map((b) => `${b.email}: ${b.message}`).join('. ')}`), { status: 400, fields: {} });
    toast(`${ok} invitation${ok === 1 ? '' : 's'} ready. Copy the links from Settings, People if they weren't emailed.`);
    nav(`/w/${cid}`);
  });
  const skip = async () => { await post(`/c/${cid}/setup`, { mark: 'teamSkipped' }).catch(() => {}); nav(`/w/${cid}`); };
  const problems = structure ? structureProblems(structure) : [];

  const up = (fn: (s: Structure) => void) => setStructure((s) => { if (!s) return s; const c = JSON.parse(JSON.stringify(s)) as Structure; fn(c); return c; });

  return (
    <div className="public">
      <header className="public-top"><Wordmark to={me.data?.companies.length ? '/home' : '/'} /><Steps step={step} /></header>
      <main id="main" className="main" style={{ paddingBottom: 64 }}>
        <div className="page page-narrow">
          {step === 0 && (
            <form className="stack-lg" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) { setNameError('Name your workspace'); return; } setStep(1); }} noValidate>
              <div className="stack-sm"><h1>Let’s set up your workspace</h1><p className="muted">It takes a few minutes. You can change everything later.</p></div>
              <div className="card card-lg stack">
                <TextField label="Business name" value={name} maxLength={80} autoFocus onChange={(e) => { setName(e.target.value); setNameError(null); }} error={nameError} placeholder="For example, Maple Street Bakery" />
                <TextArea label="What does your business do?" optional hint="One sentence is enough. Rigo uses it to suggest a starting point." value={desc} maxLength={300} rows={2}
                  onChange={(e) => setDesc(e.target.value)} placeholder="We clean homes and small offices around town." />
                {desc.trim().length > 3 && (
                  <div className="banner banner-info" role="status" aria-live="polite">
                    <Sparkles aria-hidden="true" />
                    <div className="grow small">{matches[0].score > 0 ? <>Sounds like <strong>{suggested.name}</strong>{matches[0].matched.length ? ` (from “${matches[0].matched.slice(0, 3).join('”, “')}”)` : ''}.</> : 'No close match yet. You can pick a type on the next step.'}</div>
                  </div>
                )}
                <div className="grid-2">
                  <SelectField label="Time zone" value={tz} onChange={(e) => setTz(e.target.value)}>
                    {[...new Set([tz, ...COMMON_TIMEZONES])].map((z) => <option key={z} value={z}>{TIMEZONE_NAMES[z] ?? z}</option>)}
                  </SelectField>
                  <SelectField label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </SelectField>
                </div>
              </div>
              <div className="form-actions"><Button type="submit" variant="primary" size="lg" icon={<ArrowRight size={18} aria-hidden="true" />}>Continue</Button></div>
            </form>
          )}

          {step === 1 && (
            <div className="stack-lg">
              <div className="stack-sm"><h1>{picked ? 'Your starting point' : 'Here’s the closest fit'}</h1><p className="muted">A template brings words, stages and roles. Never prices, people or records.</p></div>
              {chosen && (
                <div className="card card-lg stack tint">
                  <div className="row-between"><h2>{chosen.name}</h2>{!picked && matches[0].score > 0 && <Badge tone="good" icon={<Sparkles aria-hidden="true" />}>Suggested</Badge>}</div>
                  <p>{chosen.blurb}</p>
                  {structure && <Brings s={structure} />}
                </div>
              )}
              <fieldset className="stack">
                <legend>Or pick another type</legend>
                <div className="choices">
                  {[...TEMPLATES, ...(lib.data?.shared ?? []).slice(0, 6)].map((t: any) => (
                    <button key={t.key} type="button" className="choice" aria-pressed={chosenKey === t.key} onClick={() => setPicked(t.key)}>
                      <strong>{t.name}</strong>
                      <span className="small muted">{t.examples.slice(0, 3).join(', ')}{t.from ? ` · shared by ${t.from}` : ''}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="form-actions">
                <Button variant="primary" size="lg" onClick={() => setStep(2)} icon={<ArrowRight size={18} aria-hidden="true" />}>Use {chosen?.name ?? 'this'}</Button>
                <Button variant="ghost" onClick={() => setStep(0)} icon={<ArrowLeft size={18} aria-hidden="true" />}>Back</Button>
              </div>
            </div>
          )}

          {step === 2 && structure && (
            <div className="stack-lg">
              <div className="stack-sm"><h1>Make it yours</h1><p className="muted">Rename anything, drop what you don’t need, add what’s missing. You can change all of it later in Settings.</p></div>
              <section className="card card-lg stack" aria-labelledby="r-words">
                <div className="stack-sm"><h2 id="r-words">Your words</h2><p className="small muted">Every screen and message uses them.</p></div>
                {WORD_KEYS.filter((k) => k !== 'equipment' || structure.equipment).map((k) => (
                  <fieldset key={k} className="stack-sm">
                    <legend>{WORD_LABELS[k]} <span className="small muted" style={{ fontWeight: 400 }}>· {WORD_HINTS[k]}</span></legend>
                    <div className="input-group">
                      <TextField label="One" value={structure.words[k].one} maxLength={30} onChange={(e) => up((s) => { s.words[k].one = e.target.value; })} />
                      <TextField label="Many" value={structure.words[k].many} maxLength={30} onChange={(e) => up((s) => { s.words[k].many = e.target.value; })} />
                    </div>
                  </fieldset>
                ))}
                <label className="check"><input type="checkbox" checked={structure.equipment} onChange={(e) => up((s) => { s.equipment = e.target.checked; })} /><span className="check-text"><span>We assign equipment to work</span><span className="hint">Vehicles, tools, chairs or rooms.</span></span></label>
              </section>

              <section className="card card-lg stack" aria-labelledby="r-stages">
                <div className="stack-sm"><h2 id="r-stages">Stages of a {structure.words.work.one.toLowerCase()}</h2><p className="small muted">Each stage says what it means, so Rigo knows when work is finished and can be billed.</p></div>
                <ol className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {structure.stages.map((st, i) => (
                    <li key={st.key} className="input-group" style={{ alignItems: 'end' }}>
                      <TextField label={`Stage ${i + 1}`} value={st.name} maxLength={40} onChange={(e) => up((s) => { s.stages[i].name = e.target.value; })} />
                      <SelectField label="Means" value={st.meaning} onChange={(e) => up((s) => { s.stages[i].meaning = e.target.value as Meaning; })}>
                        {MEANING_KEYS.map((m) => <option key={m} value={m}>{MEANINGS[m].label}: {MEANINGS[m].hint}</option>)}
                      </SelectField>
                      <Button variant="ghost" className="icon-btn" aria-label={`Remove ${st.name}`} style={{ flex: '0 0 auto' }} onClick={() => up((s) => { s.stages.splice(i, 1); s.stages.forEach((x) => { if (x.next) x.next = x.next.filter((k) => k !== st.key); }); })}><Trash2 size={18} /></Button>
                    </li>
                  ))}
                </ol>
                <div><Button icon={<Plus size={18} aria-hidden="true" />} onClick={() => up((s) => { s.stages.push({ key: fieldKey('New stage', s.stages.map((x) => x.key)), name: 'New stage', meaning: 'open' }); })}>Add a stage</Button></div>
              </section>

              <section className="card card-lg stack" aria-labelledby="r-roles">
                <div className="stack-sm"><h2 id="r-roles">Roles</h2><p className="small muted">You’re the Owner and can do everything. Phone roles see only their own work.</p></div>
                {structure.roles.map((r, i) => (
                  <div key={r.key} className="input-group" style={{ alignItems: 'end' }}>
                    <TextField label={`Role ${i + 1}`} value={r.name} maxLength={40} onChange={(e) => up((s) => { s.roles[i].name = e.target.value; })} />
                    <SelectField label="Uses" value={r.app} onChange={(e) => up((s) => { s.roles[i].app = e.target.value as 'office' | 'worker'; s.roles[i].permissions = e.target.value === 'worker' ? PERMISSION_PRESETS.worker : PERMISSION_PRESETS.manager; })}>
                      <option value="office">The office screens</option>
                      <option value="worker">The phone app for their own work</option>
                    </SelectField>
                    <Button variant="ghost" className="icon-btn" aria-label={`Remove ${r.name}`} style={{ flex: '0 0 auto' }} onClick={() => up((s) => { s.roles.splice(i, 1); })}><Trash2 size={18} /></Button>
                  </div>
                ))}
                <div><Button icon={<Plus size={18} aria-hidden="true" />} onClick={() => up((s) => { s.roles.push({ key: roleKey('Team member', s.roles.map((x) => x.key)), name: 'Team member', description: '', app: 'worker', permissions: PERMISSION_PRESETS.worker }); })}>Add a role</Button></div>
              </section>

              {problems.length > 0 && <Banner tone="attn" title="Before you continue">{problems[0]}</Banner>}
              <FormError error={create.error && create.error.details?.needsConfirm !== 'duplicateName' ? create.error : null} />
              {create.error?.details?.needsConfirm === 'duplicateName' && (
                <Banner tone="attn" title={create.error.message} action={<Button size="sm" onClick={() => void create.run(true)}>Create another</Button>} />
              )}
              <div className="form-actions">
                <Button variant="primary" size="lg" busy={create.busy} disabled={problems.length > 0} onClick={() => void create.run()} icon={<Check size={18} aria-hidden="true" />}>Create {name || 'workspace'}</Button>
                <Button variant="ghost" onClick={() => setStep(1)} icon={<ArrowLeft size={18} aria-hidden="true" />}>Back</Button>
              </div>
            </div>
          )}

          {step === 3 && cid && structure && (
            <form className="stack-lg" onSubmit={(e) => { e.preventDefault(); void invite.run(); }} noValidate>
              <div className="stack-sm"><h1>Invite your {structure.words.person.many.toLowerCase()}</h1><p className="muted">They get a link to join. You can do this later from Settings, People.</p></div>
              <div className="card card-lg stack">
                <FormError error={invite.error} />
                <TextArea label="Email addresses" hint="Separate them with commas or new lines. Up to 25." value={emails} onChange={(e) => setEmails(e.target.value)} rows={3} />
                <SelectField label="Their role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                  {structure.roles.map((r) => <option key={r.key} value={r.key}>{r.name}{r.app === 'worker' ? ' (phone)' : ''}</option>)}
                  <option value="owner">Owner</option>
                </SelectField>
                <p className="small muted row"><Smartphone size={16} aria-hidden="true" />Phone roles open Rigo on their phone and see only their own work.</p>
              </div>
              <div className="form-actions">
                <Button type="submit" variant="primary" size="lg" busy={invite.busy} disabled={!emails.trim()}>Send invitations</Button>
                <Button variant="ghost" onClick={() => void skip()}>Skip for now</Button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

/** Open any template as a demo: it starts empty, and "Show sample data" fills it. */
export function DemoPicker() {
  useTitle('Try a demo');
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const open = useSubmit(async (key: string) => { const r = await post<{ id: string }>('/demo', { templateKey: key }); await refreshMe(qc); nav(`/w/${r.id}`); });
  const pre = sp.get('template');
  useEffect(() => { if (pre && templateByKey(pre)) void open.run(pre); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="public">
      <header className="public-top"><Wordmark to="/home" /></header>
      <main id="main" className="main"><div className="page page-narrow">
        <div className="stack-sm"><h1>Try a demo</h1><p className="muted">Pick a kind of business. The demo starts empty; press “Show sample data” to fill it. Demos never send, charge or connect anything.</p></div>
        <FormError error={open.error} />
        {pre && open.busy ? <Loading rows={2} label="Opening the demo" /> : (
          <div className="choices">
            {TEMPLATES.map((t) => (
              <button key={t.key} className="choice" onClick={() => void open.run(t.key)} disabled={open.busy}>
                <strong>{t.name}</strong>
                <span className="small muted">{t.blurb}</span>
                <span className="small row" style={{ color: 'var(--primary-text)', fontWeight: 600 }}><Eye size={16} aria-hidden="true" />Open the demo</span>
              </button>
            ))}
          </div>
        )}
      </div></main>
    </div>
  );
}

/** The template library: Rigo's templates and the ones owners shared. */
export function Library() {
  useTitle('Templates');
  const me = useMe();
  const lib = useQuery({ queryKey: ['library'], queryFn: () => get<{ builtIn: LibItem[]; shared: LibItem[] }>('/library') });
  const signedIn = !!me.data?.user;
  const start = (key: string) => (signedIn ? `/start?template=${encodeURIComponent(key)}` : `/signup?next=${encodeURIComponent(`/start?template=${key}`)}`);
  const demo = (key: string) => (signedIn ? `/demo?template=${encodeURIComponent(key)}` : `/signup?next=${encodeURIComponent(`/demo?template=${key}`)}`);
  const card = (t: LibItem) => (
    <li key={t.key} className="card stack">
      <div className="stack-sm"><h3>{t.name}</h3><p className="small muted">{t.blurb}</p>{t.from && <p className="tiny muted">Shared by {t.from}</p>}</div>
      <Brings s={t.structure} />
      <div className="row"><LinkButton to={start(t.key)} variant="primary" size="sm">Start with this</LinkButton>{templateByKey(t.key) && <LinkButton to={demo(t.key)} size="sm">Try the demo</LinkButton>}</div>
    </li>
  );
  return (
    <div className="public">
      <header className="public-top"><Wordmark /><div className="row">{signedIn ? <LinkButton to="/home">Open Rigo</LinkButton> : <LinkButton to="/signin" variant="ghost">Sign in</LinkButton>}</div></header>
      <main id="main" className="main"><div className="page">
        <div className="stack-sm"><h1>Templates</h1><p className="muted prose">A template is a starting structure: words, stages, roles and the names of what you sell. Never prices, people or records. Using one copies it; it never changes your workspace later.</p></div>
        {lib.isLoading ? <Loading /> : (
          <>
            <ul className="grid-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{(lib.data?.builtIn ?? []).map(card)}</ul>
            {(lib.data?.shared.length ?? 0) > 0 && <><h2>Shared by other businesses</h2><ul className="grid-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{lib.data!.shared.map(card)}</ul></>}
          </>
        )}
        <p className="small muted"><Link to="/">Back to the front page</Link></p>
      </div></main>
    </div>
  );
}

export { structureOf };
