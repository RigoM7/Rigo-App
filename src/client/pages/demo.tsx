import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { X, ChevronRight, ChevronLeft, FlaskConical } from 'lucide-react';
import { useCompany } from '../lib/session';
import { post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Banner, PageHeader, Checkbox, IconButton } from '../components/ui';
import { CompanyBasicsForm } from './workspaces';
import { useState } from 'react';

const GUIDE = [
  { title: 'Welcome to the demo', body: 'This is Northwind, a fictional company that delivers fuel, rents portable toilets and pumps septic tanks. Everything here is made up, and nothing is sent or charged.', go: '' },
  { title: '1. See what needs you', body: 'Home lists what needs attention first: an invoice waiting for approval and one on hold because a rate is missing.', go: '' },
  { title: '2. Dispatch a job', body: 'In Jobs, open the unassigned fuel job and assign Dana Driver, or create a new job.', go: 'jobs' },
  { title: '3. Complete it as the driver', body: 'Use “View as” in the black bar and pick Driver. Open the job in My jobs, record the delivered quantity and submit.', go: '' },
  { title: '4. Approve the invoice', body: 'Switch back to Owner. Rigo prepared the invoice from the confirmed quantity. Approve it in the Inbox; issuing and the simulated email follow.', go: 'inbox' },
  { title: '5. Check messages', body: 'Messages shows the invoice email marked Simulated. In a real company without an email service it would stay Prepared for you to send.', go: 'messages' },
  { title: '6. Make it yours', body: '“Set up my company” creates a real company using this demo\'s structure only: services, fields and workflows. No fictional customers or jobs are copied.', go: 'setup-company' },
];

export function DemoGuide() {
  const c = useCompany();
  const nav = useNavigate();
  const qc = useQueryClient();
  const step = Math.min(c.demo?.guide.step ?? 0, GUIDE.length - 1);
  const set = async (patch: { step?: number; dismissed?: boolean }) => { await post(`/c/${c.cid}/demo/guide`, patch); qc.invalidateQueries({ queryKey: [c.cid, 'boot'] }); };
  const g = GUIDE[step];
  return (
    <aside className="guide card stack-sm" aria-label="Demo walkthrough" style={{ boxShadow: 'var(--shadow-2)' }}>
      <div className="row-between"><span className="row small muted" style={{ gap: 6 }}><FlaskConical aria-hidden style={{ width: 16 }} />Guided walkthrough · {step + 1}/{GUIDE.length}</span><IconButton label="Hide walkthrough (you can resume from the demo bar)" onClick={() => set({ dismissed: true })}><X aria-hidden /></IconButton></div>
      <h2 style={{ fontSize: '1.0625rem' }}>{g.title}</h2>
      <p style={{ margin: 0 }}>{g.body}</p>
      <div className="row-between">
        <Button size="sm" variant="ghost" icon={<ChevronLeft aria-hidden />} disabled={step === 0} onClick={() => set({ step: step - 1 })}>Back</Button>
        <span className="row">{g.go !== undefined && step > 0 && <Button size="sm" onClick={() => nav(c.to(g.go))}>Show me</Button>}
          {step < GUIDE.length - 1 ? <Button size="sm" variant="primary" onClick={() => set({ step: step + 1 })}>Next<ChevronRight aria-hidden /></Button> : <Button size="sm" variant="primary" onClick={() => set({ dismissed: true })}>Done</Button>}</span>
      </div>
    </aside>
  );
}

export function SetupFromDemo() {
  const c = useCompany();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [copy, setCopy] = useState(true);
  const s = useSubmit(async (v: any) => { const r = await post(`/c/${c.cid}/demo/convert`, { ...v, copyStructure: copy }); await qc.invalidateQueries({ queryKey: ['me'] }); window.location.href = `/c/${r.id}/setup`; });
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
