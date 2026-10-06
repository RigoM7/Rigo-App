import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Download, Share2, Trash2, RefreshCw } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, patch, del } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Select, Textarea, ErrorSummary, LoadingBlock, ErrorState, PageHeader, Pill, Banner, Dialog, useToast, useConfirm } from '../components/ui';
import { fmtDate } from '../lib/format';

export function Templates() {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const { ask, node } = useConfirm();
  const q = useQuery({ queryKey: [c.cid, 'templates'], queryFn: () => get(`/c/${c.cid}/templates`) });
  const [create, setCreate] = useState<null | { id?: string; name: string; description: string; visibility: string; shareWith: string }>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: [c.cid] });
  const save = useSubmit(async () => {
    const body = { name: create!.name, description: create!.description, visibility: create!.visibility, shareWith: create!.shareWith.split(/[\s,;]+/).filter(Boolean) };
    if (create!.id) await patch(`/c/${c.cid}/templates/${create!.id}`, body); else await post(`/c/${c.cid}/templates`, body);
    setCreate(null); toast('Template saved'); refresh();
  });
  const apply = useSubmit(async (t: any) => {
    if (!(await ask({ title: `Apply “${t.name}”?`, body: <>This copies {t.summary.services.length} service(s) and {t.summary.workflows.length} workflow(s) into {c.company.name} as your own configuration. Workflows arrive as drafts and do not run until you test and activate them. Rates are not copied. Later changes to the template do not change your company.</>, confirm: 'Apply template' }))) return;
    const r = await post(`/c/${c.cid}/templates/${t.id}/apply`, { confirm: true });
    toast(`Added ${r.summary.services} service(s) and ${r.summary.workflows} draft workflow(s).${r.summary.skipped.length ? ` ${r.summary.skipped.length} item(s) skipped.` : ''}`); refresh();
  });
  if (q.isLoading) return <div className="page"><LoadingBlock /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} /></div>;
  const tile = (t: any, mine = false) => (
    <article key={t.id} className="card stack-sm">
      <div className="row-between"><h3>{t.name}</h3><Pill tone={t.visibility === 'system' ? 'brand' : t.visibility === 'public' ? 'info' : 'neutral'}>{t.visibility === 'system' ? 'Rigo starter' : t.visibility}</Pill></div>
      <p className="small muted" style={{ margin: 0 }}>{t.description}</p>
      <p className="small" style={{ margin: 0 }}>Services: {t.summary.services.join(', ') || 'none'}<br />Workflows: {t.summary.workflows.join(', ') || 'none'}</p>
      {t.owner_name && !mine ? <p className="small muted" style={{ margin: 0 }}>Shared by {t.owner_name}</p> : null}
      <div className="row">
        {c.can('workflows.edit') && c.can('services.manage') && <Button size="sm" variant="primary" icon={<Download aria-hidden />} busy={apply.busy} onClick={() => apply.run(t)}>Apply</Button>}
        {mine && <>
          <Button size="sm" icon={<Share2 aria-hidden />} onClick={() => setCreate({ id: t.id, name: t.name, description: t.description, visibility: t.visibility, shareWith: (t.shared_with ?? []).join(', ') })}>Sharing</Button>
          <Button size="sm" icon={<RefreshCw aria-hidden />} onClick={async () => { await patch(`/c/${c.cid}/templates/${t.id}`, { refreshFromCompany: true }); toast('Template updated from this company. Companies that already applied it are not changed.'); refresh(); }}>Update from this company</Button>
          <Button size="sm" variant="danger" icon={<Trash2 aria-hidden />} onClick={async () => { if (await ask({ title: 'Delete template?', body: 'Companies that applied it keep their copies.', confirm: 'Delete', danger: true })) { await del(`/c/${c.cid}/templates/${t.id}`); refresh(); } }}>Delete</Button>
        </>}
      </div>
      {mine && t.updated_at ? <span className="small muted">Version {t.version}, updated {fmtDate(t.updated_at)}</span> : null}
    </article>
  );
  const mine = q.data.templates.filter((t: any) => t.mine);
  const others = q.data.templates.filter((t: any) => !t.mine);
  return (
    <div className="page">
      <PageHeader title="Templates" sub="Reusable structure: services, fields, roles and workflows. Never customers, people, jobs, invoices, files or credentials."
        actions={!c.demo ? <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setCreate({ name: '', description: '', visibility: 'private', shareWith: '' })}>Save this company as a template</Button> : undefined} />
      <ErrorSummary error={apply.error} />
      <section className="stack-sm"><h2>Rigo starters</h2><div className="grid-2">{q.data.system.map((t: any) => tile(t))}</div></section>
      {mine.length > 0 && <section className="stack-sm"><h2>Your templates</h2><div className="grid-2">{mine.map((t: any) => tile(t, true))}</div></section>}
      {others.length > 0 && <section className="stack-sm"><h2>Shared with you and public</h2><div className="grid-2">{others.map((t: any) => tile(t))}</div></section>}
      {q.data.applied.length > 0 && <Card id="applied" title="Applied to this company"><ul className="list">{q.data.applied.map((a: any, i: number) => <li key={i} style={{ padding: '6px 0' }}>{a.template_name} (version {a.template_version}) · {fmtDate(a.applied_at)}</li>)}</ul></Card>}
      <Dialog open={!!create} onClose={() => setCreate(null)} title={create?.id ? 'Template sharing' : 'Save as template'} footer={<><Button onClick={() => setCreate(null)}>Cancel</Button><Button variant="primary" busy={save.busy} onClick={() => save.run()}>Save</Button></>}>
        {create && <div className="stack">
          <Banner tone="info">Rates, approver names, customers and all records stay private. Only structure is shared.</Banner>
          <ErrorSummary error={save.error} />
          <Field label="Name" id="f-name" error={save.fieldError('name')}>{(p) => <Input {...p} value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} />}</Field>
          <Field label="Description" optionalText id="f-description">{(p) => <Textarea {...p} value={create.description} onChange={(e) => setCreate({ ...create, description: e.target.value })} />}</Field>
          <Field label="Who can use it" id="f-visibility">{(p) => <Select {...p} value={create.visibility} onChange={(e) => setCreate({ ...create, visibility: e.target.value })}><option value="private">Only me</option><option value="shared">People I choose</option><option value="public">Anyone with a Rigo account</option></Select>}</Field>
          {create.visibility === 'shared' && <Field label="Share with (emails)" id="f-shareWith" hint="Separate with commas." error={save.fieldError('shareWith')}>{(p) => <Textarea {...p} value={create.shareWith} onChange={(e) => setCreate({ ...create, shareWith: e.target.value })} />}</Field>}
        </div>}
      </Dialog>
      {node}
    </div>
  );
}
