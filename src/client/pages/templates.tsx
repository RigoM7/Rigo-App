import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Download, Share2, Trash2, RefreshCw, EyeOff } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, patch, del } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Checkbox, Textarea, ErrorSummary, LoadingBlock, ErrorState, PageHeader, Pill, Banner, Dialog, useToast, useConfirm } from '../components/ui';
import { fmtDate } from '../lib/format';

const VISIBILITY: Record<string, string> = { system: 'Rigo starter', private: 'Private', shared: 'Shared', public: 'Published' };

export function Templates() {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const { ask, node } = useConfirm();
  const q = useQuery({ queryKey: [c.cid, 'templates'], queryFn: () => get(`/c/${c.cid}/templates`) });
  const [create, setCreate] = useState<null | { id?: string; name: string; description: string; visibility: string; shareWith: string; includeTestedDrafts?: boolean }>(null);
  const [applying, setApplying] = useState<any>(null);
  const [duplicates, setDuplicates] = useState<'skip' | 'copy'>('skip');
  const plan = useQuery({ queryKey: [c.cid, 'template-plan', applying?.id, duplicates], queryFn: () => get(`/c/${c.cid}/templates/${applying.id}/plan?duplicates=${duplicates}`), enabled: !!applying });
  const refresh = () => qc.invalidateQueries({ queryKey: [c.cid] });
  const save = useSubmit(async () => {
    const body = { name: create!.name, description: create!.description, visibility: create!.visibility, shareWith: create!.shareWith.split(/[\s,;]+/).filter(Boolean), ...(create!.id ? {} : { includeTestedDrafts: create!.visibility !== 'public' && !!create!.includeTestedDrafts }) };
    if (create!.id) await patch(`/c/${c.cid}/templates/${create!.id}`, body); else await post(`/c/${c.cid}/templates`, body);
    setCreate(null); toast('Template saved'); refresh();
  });
  // Applying shows its plan first: what is added, and what this company already has (R16-M4).
  const apply = useSubmit(async () => {
    const r = await post(`/c/${c.cid}/templates/${applying.id}/apply`, { confirm: true, duplicates });
    const added = r.summary.services + r.summary.workflows + r.summary.customFields;
    toast(added ? `Added ${r.summary.services} service(s), ${r.summary.workflows} draft workflow(s) and ${r.summary.customFields} field(s).` : 'Nothing to add: this company already has everything in the template.', added ? 'success' : 'info');
    setApplying(null); refresh();
  });
  const publish = useSubmit(async (t: any, visibility: 'public' | 'private') => {
    if (visibility === 'private' && !(await ask({ title: `Unpublish “${t.name}”?`, body: <p>Other Rigo users can no longer find or apply it. Companies that already applied it keep their copy.</p>, confirm: 'Unpublish' }))) return;
    await patch(`/c/${c.cid}/templates/${t.id}`, { visibility });
    toast(visibility === 'public' ? 'Published a blank copy' : 'Unpublished'); refresh();
  });
  if (q.isLoading) return <div className="page"><LoadingBlock /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} /></div>;
  const tile = (t: any, mine = false) => (
    <article key={t.id} className="card stack-sm">
      <div className="row-between"><h3>{t.name}</h3><Pill tone={t.visibility === 'system' ? 'brand' : t.visibility === 'public' ? 'info' : 'neutral'}>{VISIBILITY[t.visibility] ?? t.visibility}</Pill></div>
      <p className="small muted" style={{ margin: 0 }}>{t.description}</p>
      <p className="small" style={{ margin: 0 }}>Services: {t.summary.services.join(', ') || 'none'}<br />Workflows: {t.summary.workflows.join(', ') || 'none'}{mine && t.summary.draftWorkflows?.length ? ` (tested, not switched on: ${t.summary.draftWorkflows.join(', ')}; never in the published copy)` : ''}</p>
      {t.madeBy ? <p className="small muted" style={{ margin: 0 }}>{t.madeBy}</p> : t.owner_name && !mine ? <p className="small muted" style={{ margin: 0 }}>Shared by {t.owner_name}</p> : null}
      <div className="row">
        {c.can('workflows.edit') && c.can('services.manage') && <Button size="sm" variant="primary" icon={<Download aria-hidden />} onClick={() => { setDuplicates('skip'); setApplying(t); }}>Apply</Button>}
        {mine && <>
          {t.visibility === 'public'
            ? <Button size="sm" icon={<EyeOff aria-hidden />} busy={publish.busy} onClick={() => publish.run(t, 'private')}>Unpublish</Button>
            : <Button size="sm" icon={<Share2 aria-hidden />} onClick={() => setCreate({ id: t.id, name: t.name, description: t.description, visibility: t.visibility, shareWith: (t.shared_with ?? []).join(', ') })}>Sharing</Button>}
          <Button size="sm" icon={<RefreshCw aria-hidden />} onClick={async () => { await patch(`/c/${c.cid}/templates/${t.id}`, { refreshFromCompany: true }); toast('Template updated from this company. Companies that already applied it are not changed.'); refresh(); }}>Update from this company</Button>
          <Button size="sm" variant="danger" icon={<Trash2 aria-hidden />} onClick={async () => { if (await ask({ title: 'Delete template?', body: 'Companies that applied it keep their copies.', confirm: 'Delete', danger: true })) { await del(`/c/${c.cid}/templates/${t.id}`); refresh(); } }}>Delete</Button>
        </>}
      </div>
      {mine && t.updated_at ? <span className="small muted">Version {t.version}, updated {fmtDate(t.updated_at, c.company.timezone)}</span> : null}
    </article>
  );
  const mine = q.data.templates.filter((t: any) => t.mine);
  const shared = q.data.templates.filter((t: any) => !t.mine && t.visibility !== 'public');
  const published = q.data.templates.filter((t: any) => !t.mine && t.visibility === 'public');
  const p = plan.data?.plan;
  const ACTION: Record<string, string> = { add: 'Added', skip: 'Skipped: you already have it', copy: 'Added as a copy', same: 'Already the same', keep: 'Kept as you set it', missing: 'Not in this company' };
  return (
    <div className="page">
      <PageHeader title="Templates" sub="Reusable structure: services, fields, roles and workflows. Never customers, people, jobs, invoices, files or credentials."
        actions={!c.demo ? <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setCreate({ name: '', description: '', visibility: 'private', shareWith: '' })}>Save this company as a template</Button> : undefined} />
      <ErrorSummary error={publish.error} />
      <section className="stack-sm"><h2>Rigo starters</h2><div className="grid-2">{q.data.system.map((t: any) => tile(t))}</div></section>
      {mine.length > 0 && <section className="stack-sm"><h2>Your templates</h2><div className="grid-2">{mine.map((t: any) => tile(t, true))}</div></section>}
      {shared.length > 0 && <section className="stack-sm"><h2>Shared with you</h2><div className="grid-2">{shared.map((t: any) => tile(t))}</div></section>}
      {published.length > 0 && <section className="stack-sm"><h2>Published by other Rigo users</h2><p className="small muted" style={{ margin: 0 }}>Blank copies: structure only, with rates empty. Rigo doesn't check them; review what they add before you test anything.</p><div className="grid-2">{published.map((t: any) => tile(t))}</div></section>}
      <Dialog open={!!applying} onClose={() => setApplying(null)} title={applying ? `Apply “${applying.name}”?` : ''} footer={<><Button onClick={() => setApplying(null)}>Cancel</Button><Button variant="primary" busy={apply.busy} disabled={!p} onClick={() => apply.run()}>Apply template</Button></>}>
        {applying && <div className="stack">
          <p style={{ margin: 0 }}>This copies the template into {c.company.name} as your own configuration. Workflows arrive as drafts and don't run until you test and switch them on. Rates are not copied. Later changes to the template don't change your company.</p>
          <ErrorSummary error={apply.error ?? (plan.error as any)} />
          <fieldset><legend>Services and workflows you already have (same name)</legend>
            <label className="row" style={{ gap: 6 }}><input type="radio" name="dups" checked={duplicates === 'skip'} onChange={() => setDuplicates('skip')} />Skip them</label>
            <label className="row" style={{ gap: 6 }}><input type="radio" name="dups" checked={duplicates === 'copy'} onChange={() => setDuplicates('copy')} />Add them as copies, named “… (2)”</label>
          </fieldset>
          {!p ? <LoadingBlock /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Item</th><th>What happens</th></tr></thead>
              <tbody>
                {p.services.map((x: any, i: number) => <tr key={`s${i}`}><td>Service: {x.name}</td><td>{ACTION[x.action]}{x.as ? ` “${x.as}”` : ''}</td></tr>)}
                {p.workflows.map((x: any, i: number) => <tr key={`w${i}`}><td>Workflow: {x.name}</td><td>{x.action === 'skip' ? ACTION.skip : `${ACTION[x.action]}${x.as ? ` “${x.as}”` : ''}, as a draft`}</td></tr>)}
                {p.roles.map((x: any, i: number) => <tr key={`r${i}`}><td>Role: {x.name}</td><td>{ACTION[x.action]}</td></tr>)}
                {p.customFields.map((x: any, i: number) => <tr key={`f${i}`}><td>Field: {x.label}</td><td>{x.action === 'add' ? 'Added' : ACTION.skip}</td></tr>)}
              </tbody>
            </table></div>
          )}
        </div>}
      </Dialog>
      {q.data.applied.length > 0 && <Card id="applied" title="Applied to this company"><ul className="list">{q.data.applied.map((a: any, i: number) => <li key={i} style={{ padding: '6px 0' }}>{a.template_name} (version {a.template_version}) · {fmtDate(a.applied_at, c.company.timezone)}</li>)}</ul></Card>}
      <Dialog open={!!create} onClose={() => setCreate(null)} title={create?.id ? 'Template sharing' : 'Save as template'} footer={<><Button onClick={() => setCreate(null)}>Cancel</Button><Button variant="primary" busy={save.busy} onClick={() => save.run()}>Save</Button></>}>
        {create && <div className="stack">
          <Banner tone="info">Rates, approvers, customers and all records stay private. Only structure is saved: services, fields, roles and the workflows that are switched on.</Banner>
          <ErrorSummary error={save.error} />
          <Field label="Name" id="f-name" error={save.fieldError('name')}>{(p) => <Input {...p} maxLength={80} value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} />}</Field>
          <Field label="Description" optionalText id="f-description">{(p) => <Textarea {...p} maxLength={400} value={create.description} onChange={(e) => setCreate({ ...create, description: e.target.value })} />}</Field>
          <fieldset><legend>Who can use it</legend>
            <div className="radio-cards">
              <label className="radio-card"><input type="radio" name="tvis" checked={create.visibility === 'private'} onChange={() => setCreate({ ...create, visibility: 'private' })} /><span><strong>Keep private</strong><br /><span className="small muted">Only you, in your other companies.</span></span></label>
              <label className="radio-card"><input type="radio" name="tvis" checked={create.visibility === 'public'} onChange={() => setCreate({ ...create, visibility: 'public' })} /><span><strong>Publish a blank copy</strong><br /><span className="small muted">Any Rigo user can apply it. They get services, fields, price structure with rates empty, roles and switched-on workflows. Never your company name, rates, people, customers, records or drafts. Shown as “Made by another Rigo user”. You can unpublish any time.</span></span></label>
              <label className="radio-card"><input type="radio" name="tvis" checked={create.visibility === 'shared'} onChange={() => setCreate({ ...create, visibility: 'shared' })} /><span><strong>Share with people I choose</strong><br /><span className="small muted">By email address.</span></span></label>
            </div>
          </fieldset>
          {!create.id && create.visibility !== 'public' && <Checkbox label="Also include workflows I tested but haven't switched on" checked={!!create.includeTestedDrafts} onChange={(e) => setCreate({ ...create, includeTestedDrafts: e.target.checked })} />}
          {create.visibility === 'shared' && <Field label="Share with (emails)" id="f-shareWith" hint="Separate with commas." error={save.fieldError('shareWith')}>{(p) => <Textarea {...p} value={create.shareWith} onChange={(e) => setCreate({ ...create, shareWith: e.target.value })} />}</Field>}
        </div>}
      </Dialog>
      {node}
    </div>
  );
}
