import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { X, ChevronRight, ChevronLeft, FlaskConical, CheckCircle2, ChevronUp, ChevronDown, Info, ArrowRight } from 'lucide-react';
import { refreshMe, useCompany } from '../lib/session';
import { post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Banner, PageHeader, Checkbox, IconButton, useToast } from '../components/ui';
import { CompanyBasicsForm } from './workspaces';
import { GUIDE_STEPS, type GuideProgress, type GuideRole } from '../../shared/demo';

// The demo walkthrough. Each step knows which simulated role does it, where it happens and which
// control to point at. "Show me" switches the role if needed, opens the page, scrolls to the control
// and outlines it. A step shows "Done" once the records show the action happened (read from boot,
// which refreshes after every change; nothing polls).

interface Step {
  title: string;
  body: (p: GuideProgress) => ReactNode;
  go?: (p: GuideProgress) => string;
  /** data-guide-target ids, in order of preference: the first one on the page is outlined. */
  targets?: { id: string; label: string }[];
  /** Words after "Switch to Owner to …". */
  verb: string;
  done?: (p: GuideProgress) => boolean;
  doneText?: (p: GuideProgress) => string;
  /** Something earlier has to happen first: say what, and offer to go back to that step. */
  needs?: (p: GuideProgress) => { text: string; step: number } | null;
  note?: (p: GuideProgress) => string | null;
}

const driverName = (p: GuideProgress) => p.demoDriverName?.replace(/\s*\(fictional\)$/, '') ?? 'Dana Driver';

export const GUIDE: Step[] = [
  { title: 'Welcome to the demo', verb: 'start', body: () => 'This is Northwind, a fictional company that delivers fuel, rents portable toilets and pumps septic tanks. Everything here is made up, and nothing is sent or charged. Follow the steps, or explore on your own.' },
  { title: 'See what needs you', verb: 'see what needs you', go: () => '', targets: [{ id: 'needs-you', label: 'Needs you' }],
    body: () => 'Home lists what needs attention first: invoices waiting for approval, one on hold because a rate is missing, jobs running late, and an urgent job without a driver.' },
  { title: 'Dispatch a job', verb: 'assign a driver', go: () => 'jobs', targets: [{ id: 'assign-job-3', label: 'Choose a driver here' }],
    body: (p) => `Job #3 is an urgent gasoline delivery with no driver. In Jobs, choose ${driverName(p)} in its Driver menu. It saves right away, and you can undo.`,
    done: (p) => p.assignedToDemoDriver, doneText: (p) => `Job #3 is assigned to ${driverName(p)}.`,
    note: (p) => (p.assigned && !p.assignedToDemoDriver && !p.completed ? `Job #3 is assigned to ${p.assigneeName}. The Driver view in this demo shows ${driverName(p)}'s jobs, so choose ${driverName(p)} to continue.` : null) },
  { title: 'Complete it as the driver', verb: 'complete the job', go: (p) => (p.jobId ? `today/${p.jobId}` : 'today'),
    targets: [{ id: 'driver-start', label: 'Start the job' }, { id: 'driver-record', label: 'Choose how it went, enter the quantity, then submit' }],
    body: () => 'This is what the driver sees on their phone. Start job #3, choose "Completed successfully", enter the delivered quantity (try 187.4 gallons), then submit it to the office.',
    done: (p) => p.completed, doneText: () => 'The office has the driver\'s record, and Rigo prepared the invoice from it.',
    needs: (p) => (!p.completed && !p.assignedToDemoDriver ? { text: `Job #3 first needs ${driverName(p)} as its driver.`, step: 2 } : null) },
  { title: 'Approve the invoice', verb: 'approve', go: () => 'inbox', targets: [{ id: 'approve-job-3', label: 'Check the total, then approve' }],
    body: () => 'Rigo prepared the invoice from the confirmed quantity. Check the lines and total on the approval card, then approve it. Approving issues the invoice with the next number.',
    done: (p) => p.approved, doneText: () => 'The invoice for job #3 is approved and issued.',
    needs: (p) => (!p.completed ? { text: 'Job #3 is not completed yet, so there is no invoice to approve.', step: 3 } : null) },
  { title: 'Send the invoice email', verb: 'send the email', go: (p) => (p.messageId ? `messages?open=${p.messageId}` : 'messages'), targets: [{ id: 'send-simulated', label: 'Press Send (simulated)' }],
    body: () => 'Rigo prepared the customer email with the invoice lines, the due date and how to pay. Press Send (simulated) to see what the customer would receive.',
    done: (p) => p.sent, doneText: () => 'Sent as Simulated. In a real company with email set up, the customer would get it.',
    needs: (p) => (!p.approved ? { text: 'Approve the invoice for job #3 first.', step: 4 } : null),
    note: (p) => (p.approved && !p.messageId ? 'Rigo is preparing the email. Open Messages in a moment.' : null) },
  { title: 'Make it yours', verb: 'set up your company', go: () => 'setup-company',
    body: () => '“Set up my company” creates a real company using this demo\'s structure only: services, fields and workflows. No fictional customers, jobs or prices are copied.' },
];

const ROLE_NAME: Record<string, string> = { owner: 'Owner', driver: 'Driver', dispatcher: 'Dispatcher', office: 'Office / billing' };
const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), input:not([disabled]), a[href], textarea:not([disabled])';

function readCollapsed() { try { return localStorage.getItem('rigo-guide-collapsed') === '1'; } catch { return false; } }

/** Outline the step's control wherever it appears; when asked, scroll to it and focus it. */
function useGuideHighlight(targets: Step['targets'] | undefined, stepLabel: string, focusRequest: number) {
  const handled = useRef(0);
  const key = targets?.map((t) => t.id).join('|') ?? '';
  useEffect(() => {
    if (!targets?.length) return;
    // A new "Show me" press asks for one scroll-and-focus once the control is on the page.
    const pending = { current: focusRequest > handled.current ? focusRequest : 0 };
    let current: Element | null = null;
    const clear = () => { current?.removeAttribute('data-guide-active'); current?.removeAttribute('data-guide-label'); };
    const apply = () => {
      let found: { el: Element; label: string } | null = null;
      for (const t of targets) { const el = document.querySelector(`[data-guide-target="${t.id}"]`); if (el) { found = { el, label: t.label }; break; } }
      if (found?.el !== current) {
        clear();
        current = found?.el ?? null;
        if (found) { found.el.setAttribute('data-guide-active', ''); found.el.setAttribute('data-guide-label', `${stepLabel}: ${found.label}`); }
      }
      if (current && pending.current) {
        handled.current = pending.current;
        pending.current = 0;
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        current.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
        const f = (current.matches(FOCUSABLE) ? current : current.querySelector(FOCUSABLE)) as HTMLElement | null;
        f?.focus({ preventScroll: true });
      }
    };
    apply();
    // New pages and dialogs render after navigation; watch the DOM instead of polling for the control.
    const mo = new MutationObserver(apply);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { mo.disconnect(); clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stepLabel, focusRequest]);
}

export function DemoGuide() {
  const c = useCompany();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const demo = c.demo!;
  const step = Math.min(Math.max(demo.guide.step ?? 0, 0), GUIDE.length - 1);
  const g = GUIDE[step];
  const p = demo.progress;
  const role: GuideRole = GUIDE_STEPS[step].role;
  const wrongRole = demo.simRole !== role && step > 0;
  const done = !!g.done?.(p);
  const needs = done ? null : g.needs?.(p) ?? null;
  const note = done ? null : g.note?.(p) ?? null;
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [busy, setBusy] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const stepLabel = `Step ${step + 1}`;
  useGuideHighlight(done || needs ? undefined : g.targets, stepLabel, focusRequest);
  // When the visitor finishes the step it shows "Done" for a moment, then moves on by itself (R2-M1).
  // Coming back to a step that was already done doesn't move on.
  const seen = useRef({ step, done });
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const was = seen.current;
    seen.current = { step, done };
    if (!(was.step === step && !was.done && done && step < GUIDE.length - 1)) return;
    setMoving(true);
    const t = setTimeout(() => { setMoving(false); void set({ step: step + 1 }); }, 2500);
    return () => { clearTimeout(t); setMoving(false); };
  }, [step, done]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () => { const n = !collapsed; setCollapsed(n); try { localStorage.setItem('rigo-guide-collapsed', n ? '1' : '0'); } catch { /* ignore */ } };
  const set = async (patch: { step?: number; dismissed?: boolean }) => { await post(`/c/${c.cid}/demo/guide`, patch); await qc.invalidateQueries({ queryKey: [c.cid, 'boot'] }); };
  const showMe = async () => {
    setBusy(true);
    try {
      if (demo.simRole !== role) {
        await post(`/c/${c.cid}/demo/role`, { role });
        // Permissions change with the role: refresh everything for this company before opening the page.
        await qc.invalidateQueries({ queryKey: [c.cid] });
        toast(role === 'owner' ? 'Now viewing as Owner' : `Now viewing as ${ROLE_NAME[role]} (simulated)`, 'info');
      }
      // Read the latest progress (for example the prepared email's id) before choosing where to go.
      await qc.invalidateQueries({ queryKey: [c.cid, 'boot'] });
      const fresh = qc.getQueryData<{ demo: { progress: GuideProgress } | null }>([c.cid, 'boot'])?.demo?.progress ?? p;
      setFocusRequest(Date.now());
      if (g.go) nav(c.to(g.go(fresh)));
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const showLabel = wrongRole ? `Switch to ${ROLE_NAME[role]} to ${g.verb}` : 'Show me';
  const canShow = step > 0 && !!g.go && !needs;
  if (collapsed) {
    return (
      <aside className="guide guide-collapsed card" aria-label="Demo walkthrough">
        <FlaskConical aria-hidden className="guide-icon" />
        <span className="guide-line"><span className="sr-only">Step {step + 1} of {GUIDE.length}: </span><span aria-hidden>{step + 1}/{GUIDE.length} · </span>{g.title}{done ? <span className="guide-done-inline"> · <CheckCircle2 aria-hidden />Done</span> : null}</span>
        {canShow && !done ? <Button size="sm" busy={busy} onClick={showMe}>{wrongRole ? `Switch to ${ROLE_NAME[role]}` : 'Show me'}</Button> : null}
        {done && step < GUIDE.length - 1 ? <Button size="sm" variant="primary" onClick={() => set({ step: step + 1 })}>Next<ChevronRight aria-hidden /></Button> : null}
        <IconButton label="Expand the walkthrough" aria-expanded={false} onClick={toggle}><ChevronDown aria-hidden /></IconButton>
      </aside>
    );
  }
  return (
    <aside className="guide card stack-sm" aria-label="Demo walkthrough">
      <div className="guide-head">
        <h2><FlaskConical aria-hidden className="guide-icon" />{g.title}</h2>
        <span className="row" style={{ gap: 2, flexWrap: 'nowrap', marginLeft: 'auto' }}>
          <span className="guide-count">Step {step + 1} of {GUIDE.length}</span>
          <IconButton label="Collapse the walkthrough to one line" aria-expanded onClick={toggle}><ChevronUp aria-hidden /></IconButton>
          <IconButton label="Hide walkthrough (you can resume from the demo bar)" onClick={() => set({ dismissed: true })}><X aria-hidden /></IconButton>
        </span>
      </div>
      <p className="small" style={{ margin: 0, maxWidth: '75ch' }}>{g.body(p)}</p>
      <div role="status" className="stack-sm">
        {done ? <p className="guide-done"><CheckCircle2 aria-hidden />Done. {g.doneText?.(p)}{moving ? ' Next step in a moment…' : ''}</p> : null}
        {needs ? <p className="guide-note"><Info aria-hidden /><span>{needs.text}</span></p> : null}
        {note ? <p className="guide-note"><Info aria-hidden /><span>{note}</span></p> : null}
        {wrongRole && !done && !needs ? <p className="guide-note"><Info aria-hidden /><span>This step is done as the {ROLE_NAME[role]}. You are viewing as {ROLE_NAME[demo.simRole] ?? demo.simRole}.</span></p> : null}
      </div>
      <div className="row-between">
        <Button size="sm" variant="ghost" icon={<ChevronLeft aria-hidden />} disabled={step === 0} onClick={() => set({ step: step - 1 })}>Back</Button>
        <span className="row">
          {needs ? <Button size="sm" onClick={() => set({ step: needs.step })}>Go to step {needs.step + 1}<ArrowRight aria-hidden /></Button> : null}
          {canShow && !done ? <Button size="sm" variant={wrongRole ? 'primary' : undefined} busy={busy} onClick={showMe}>{showLabel}</Button> : null}
          {step < GUIDE.length - 1
            ? <Button size="sm" variant={wrongRole && !done ? undefined : 'primary'} onClick={() => set({ step: step + 1 })}>{done ? 'Next step' : 'Next'}<ChevronRight aria-hidden /></Button>
            : <><Button size="sm" onClick={showMe} busy={busy}>Show me</Button><Button size="sm" variant="primary" onClick={() => set({ dismissed: true })}>Done</Button></>}
        </span>
      </div>
    </aside>
  );
}

export function SetupFromDemo() {
  const c = useCompany();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [copy, setCopy] = useState(true);
  const s = useSubmit(async (v: any) => { const r = await post(`/c/${c.cid}/demo/convert`, { ...v, copyStructure: copy }); await refreshMe(qc); window.location.href = `/c/${r.id}/setup`; });
  if (!c.demo) return <div className="page"><Banner tone="info">This page is for the demo workspace. To create another company, use <a href="/workspaces/new">Create a company</a>.</Banner></div>;
  return (
    <div className="page page-narrow">
      <PageHeader title="Set up my company" sub="Creating a real company is free. You become its owner." />
      <Banner tone="info" title="What is copied">
        <Checkbox label="Copy the demo's structure: services and their fields, role permissions, and workflows (as drafts to test and activate)." checked={copy} onChange={(e) => setCopy(e.target.checked)} />
        Never copied: fictional customers, jobs, invoices, messages, people, prices or files. Your new company starts empty.
      </Banner>
      <div className="card"><CompanyBasicsForm key={String(copy)} onSubmit={(v) => s.run(v)} busy={s.busy} error={s.error} submitLabel="Create my company" initial={{ hideStart: copy, start: copy ? "blank" : "starter" }} /></div>
      <Button variant="ghost" onClick={() => nav(c.to(''))}>Back to the demo</Button>
    </div>
  );
}

export function ResumeGuideButton() {
  const c = useCompany();
  const qc = useQueryClient();
  if (!c.demo?.guide.dismissed) return null;
  return <Button size="sm" variant="ghost" onClick={async () => { await post(`/c/${c.cid}/demo/guide`, { dismissed: false }); qc.invalidateQueries({ queryKey: [c.cid, 'boot'] }); }}>Resume walkthrough</Button>;
}
