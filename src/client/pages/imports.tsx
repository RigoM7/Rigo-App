import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, CheckCircle2, AlertTriangle, XCircle, FileSpreadsheet } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Select, ErrorSummary, LoadingBlock, PageHeader, Pill, Banner, Checkbox, useToast } from '../components/ui';
import { fmtDateTime } from '../lib/format';

export function Imports() {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: [c.cid, 'imports'], queryFn: () => get(`/c/${c.cid}/imports`) });
  const [kind, setKind] = useState<'customers' | 'resources'>('customers');
  const [up, setUp] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [review, setReview] = useState<any>(null);
  const [overrides, setOverrides] = useState<Record<string, 'create' | 'skip'>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<any>(null);
  const upload = useSubmit(async (file: File) => {
    if (file.size > (list.data?.limits.maxBytes ?? 1e6)) throw new Error('The file is larger than 1 MB. Split it into smaller files.');
    const text = await file.text();
    const r = await post(`/c/${c.cid}/imports`, { kind, fileName: file.name, text });
    setUp(r); setMapping(r.mapping); setReview(null); setResult(null); setConfirmed(false); setOverrides({});
  });
  const doReview = useSubmit(async () => { const r = await post(`/c/${c.cid}/imports/${up.id}/review`, { mapping }); setReview(r); setConfirmed(false); });
  const commit = useSubmit(async () => { const r = await post(`/c/${c.cid}/imports/${up.id}/commit`, { confirm: true, overrides }); setResult(r.result); qc.invalidateQueries({ queryKey: [c.cid] }); toast('Import saved'); });
  const discard = async () => { if (up) await post(`/c/${c.cid}/imports/${up.id}/discard`); setUp(null); setReview(null); setResult(null); qc.invalidateQueries({ queryKey: [c.cid, 'imports'] }); };
  const fields = list.data?.fields?.[up ? (up.kind ?? kind) : kind] ?? [];
  return (
    <div className="page">
      <PageHeader title="Imports" sub="Bring in customers or equipment from a CSV file. You review everything before anything is saved." />
      <Banner tone="info">Imports never activate workflows or invent missing details. Limits: CSV only (save spreadsheets as CSV first), up to {list.data?.limits.maxRows ?? 2000} rows and 1 MB.</Banner>
      {!up && (
        <Card id="up" title="1. Choose a file">
          <div className="stack">
            <ErrorSummary error={upload.error} />
            <Field label="What are you importing?" id="f-kind">{(p) => <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as any)}><option value="customers">Customers and service addresses</option><option value="resources">Trucks and equipment</option></Select>}</Field>
            <label className="btn btn-primary" style={{ alignSelf: 'flex-start' }}><Upload aria-hidden />{upload.busy ? 'Reading…' : 'Choose CSV file'}<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && upload.run(e.target.files[0])} /></label>
          </div>
        </Card>
      )}
      {up && !result && (
        <Card id="map" title={`2. Match columns — ${up.rowCount} row(s) in ${list.data?.imports?.find((i: any) => i.id === up.id)?.file_name ?? 'file'}`}>
          <div className="stack">
            {up.parseErrors?.length ? <Banner tone="warning" title="Some rows could not be read cleanly"><ul>{up.parseErrors.map((e: string) => <li key={e}>{e}</li>)}</ul></Banner> : null}
            <div className="grid-2">{fields.map((f: any) => <Field key={f.key} label={`${f.label}${f.required ? '' : ' (optional)'}`} id={`f-${f.key}`} error={doReview.fieldError(f.key)}>{(p) => <Select {...p} value={mapping[f.key] ?? ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}><option value="">Not in file</option>{up.headers.map((h: string) => <option key={h}>{h}</option>)}</Select>}</Field>)}</div>
            <details><summary>Preview first rows</summary><div className="table-wrap"><table className="table"><thead><tr>{up.headers.map((h: string) => <th key={h}>{h}</th>)}</tr></thead><tbody>{up.sample.map((r: any, i: number) => <tr key={i}>{up.headers.map((h: string) => <td key={h}>{r[h]}</td>)}</tr>)}</tbody></table></div></details>
            <ErrorSummary error={doReview.error} />
            <div className="form-actions"><Button variant="primary" busy={doReview.busy} onClick={() => doReview.run()}>Review rows</Button><Button onClick={discard}>Discard</Button></div>
          </div>
        </Card>
      )}
      {review && !result && (
        <Card id="rev" title="3. Review and confirm">
          <div className="stack">
            <div className="row"><Pill tone="success">{review.summary.create} new</Pill>{review.summary.addLocation ? <Pill tone="info">{review.summary.addLocation} extra location(s)</Pill> : null}<Pill>{review.summary.skip} skipped</Pill>{review.summary.errors ? <Pill tone="danger">{review.summary.errors} with errors</Pill> : null}{review.summary.warnings ? <Pill tone="warning">{review.summary.warnings} with warnings</Pill> : null}</div>
            <p className="muted small">Rows matching existing records are skipped by default; Rigo does not merge records for you. You can choose to create them anyway.</p>
            <div className="table-wrap"><table className="table responsive">
              <thead><tr><th>Row</th><th>Values</th><th>Notes</th><th>Action</th></tr></thead>
              <tbody>{review.rows.map((r: any) => {
                const action = r.errors.length ? 'skip' : overrides[r.index] ?? r.action;
                return (
                  <tr key={r.index}>
                    <td data-label="Row" className="num">{r.index + 2}</td>
                    <td data-primary className="small">{Object.entries(r.values).filter(([, v]) => v).map(([k, v]) => <div key={k}><span className="muted">{k}:</span> {String(v)}</div>)}</td>
                    <td data-label="Notes" className="small">{r.errors.map((e: string) => <div key={e} className="row" style={{ gap: 4, color: 'var(--danger)' }}><XCircle aria-hidden style={{ width: 14 }} />{e}</div>)}{r.warnings.map((w: string) => <div key={w} className="row" style={{ gap: 4 }}><AlertTriangle aria-hidden style={{ width: 14, color: 'var(--warning)' }} />{w}</div>)}{!r.errors.length && !r.warnings.length ? <span className="row" style={{ gap: 4 }}><CheckCircle2 aria-hidden style={{ width: 14, color: 'var(--success)' }} />OK</span> : null}</td>
                    <td data-label="Action">{r.errors.length ? 'Skipped (error)' : r.action === 'add_location' ? 'Add as another location' : (
                      <select className="select" style={{ minHeight: 36, padding: '4px 8px', width: 'auto' }} aria-label={`Action for row ${r.index + 2}`} value={action} onChange={(e) => setOverrides({ ...overrides, [r.index]: e.target.value as any })}><option value="create">Create</option><option value="skip">Skip</option></select>
                    )}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
            <Checkbox label={`I reviewed these rows. Save the ${kind === 'customers' ? 'customers and locations' : 'items'} marked Create.`} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <ErrorSummary error={commit.error} />
            <div className="form-actions"><Button variant="primary" disabled={!confirmed} busy={commit.busy} onClick={() => commit.run()}>Save import</Button><Button onClick={discard}>Discard</Button></div>
          </div>
        </Card>
      )}
      {result && (
        <Banner tone="success" title="Import saved" action={<Button size="sm" onClick={() => { setUp(null); setReview(null); setResult(null); }}>Import another file</Button>}>
          {result.customers ? `${result.customers} customer(s), ${result.locations} location(s). ` : ''}{result.resources ? `${result.resources} item(s). ` : ''}{result.skipped} row(s) skipped. {result.customers ? <Link to={c.to('customers')}>View customers</Link> : <Link to={c.to('resources')}>View equipment</Link>}
        </Banner>
      )}
      <Card id="hist" title="Previous imports">{list.isLoading ? <LoadingBlock /> : list.data.imports.length === 0 ? <p className="muted">None yet.</p> : <ul className="list">{list.data.imports.map((i: any) => <li key={i.id} className="row-between" style={{ padding: '8px 0' }}><span className="row"><FileSpreadsheet aria-hidden style={{ width: 18 }} />{i.file_name} · {i.kind}<span className="small muted">{fmtDateTime(i.created_at)}</span></span><Pill tone={i.status === 'committed' ? 'success' : i.status === 'failed' ? 'danger' : 'neutral'}>{i.status}</Pill></li>)}</ul>}</Card>
    </div>
  );
}
