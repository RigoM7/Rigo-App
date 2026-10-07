import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, CheckCircle2, AlertTriangle, XCircle, FileSpreadsheet, Info } from 'lucide-react';
import { decodeBytes } from '../../shared/imports';
import { useCompany } from '../lib/session';
import { get, post } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Select, ErrorSummary, LoadingBlock, PageHeader, Pill, Banner, Checkbox, useToast } from '../components/ui';
import { fmtDateTime } from '../lib/format';

const ENCODINGS = { auto: 'Automatic', 'utf-8': 'UTF-8', 'windows-1252': 'Windows (Excel)' } as const;

export function Imports() {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: [c.cid, 'imports'], queryFn: () => get(`/c/${c.cid}/imports`) });
  const [kind, setKind] = useState<'customers' | 'resources'>('customers');
  const [file, setFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState<keyof typeof ENCODINGS>('auto');
  const [up, setUp] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [notesColumns, setNotesColumns] = useState<string[]>([]);
  const [flipNames, setFlipNames] = useState(false);
  const [review, setReview] = useState<any>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<any>(null);
  const reset = () => { setUp(null); setReview(null); setResult(null); setConfirmed(false); setOverrides({}); setNotesColumns([]); setFlipNames(false); };
  const upload = useSubmit(async (f: File, enc: keyof typeof ENCODINGS = encoding) => {
    if (f.size > (list.data?.limits.maxBytes ?? 1e6)) throw new Error('The file is larger than 1 MB. Split it into smaller files.');
    // The browser reads the bytes, so a Windows/Excel file keeps its accents (R16-M1).
    const decoded = decodeBytes(new Uint8Array(await f.arrayBuffer()), enc);
    if (up) await post(`/c/${c.cid}/imports/${up.id}/discard`).catch(() => undefined);
    const r = await post(`/c/${c.cid}/imports`, { kind, fileName: f.name, text: decoded.text, encoding: decoded.encoding });
    reset(); setFile(f); setUp({ ...r, encoding: decoded.encoding }); setMapping(r.mapping);
    qc.invalidateQueries({ queryKey: [c.cid, 'imports'] });
  });
  const resume = useSubmit(async (id: string) => {
    const r = await get(`/c/${c.cid}/imports/${id}`);
    reset(); setFile(null); setKind(r.import.kind); setUp({ ...r.import, parseErrors: [], warnings: [] }); setMapping(r.import.mapping ?? {});
    if (r.review) { setReview(r.review); setNotesColumns(r.review.notesColumns ?? []); setFlipNames(!!r.review.flipNames); }
  });
  const doReview = useSubmit(async (opts?: { flip?: boolean }) => {
    const flip = opts?.flip ?? flipNames;
    const r = await post(`/c/${c.cid}/imports/${up.id}/review`, { mapping, notesColumns, flipNames: flip });
    setReview(r); setFlipNames(flip); setConfirmed(false); setOverrides({});
  });
  const commit = useSubmit(async () => { const r = await post(`/c/${c.cid}/imports/${up.id}/commit`, { confirm: true, overrides }); setResult(r.result); qc.invalidateQueries({ queryKey: [c.cid] }); toast('Import saved'); });
  const discard = async (id = up?.id) => { if (id) await post(`/c/${c.cid}/imports/${id}/discard`); if (id === up?.id) { reset(); setFile(null); } qc.invalidateQueries({ queryKey: [c.cid, 'imports'] }); };
  const upKind = up ? (up.kind ?? kind) : kind;
  const fields = list.data?.fields?.[upKind] ?? [];
  const label = (k: string) => fields.find((f: any) => f.key === k)?.label.replace(/ \(.*\)$/, '') ?? k;
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  const unmapped: string[] = up ? up.headers.filter((h: string) => !mapped.has(h)) : [];
  const leftovers = (list.data?.imports ?? []).filter((i: any) => ['uploaded', 'reviewed'].includes(i.status) && i.id !== up?.id);
  return (
    <div className="page">
      <PageHeader title="Imports" sub="Bring in customers or equipment from a CSV file. You review everything before anything is saved." />
      <Banner tone="info">Imports never activate workflows or invent missing details. Limits: CSV only (save spreadsheets as CSV first), up to {list.data?.limits.maxRows ?? 2000} rows and 1 MB.</Banner>
      {!up && leftovers.length > 0 && (
        <Banner tone="warning" title={`${leftovers.length === 1 ? 'An import was' : `${leftovers.length} imports were`} left unfinished`}>
          <ul className="list">{leftovers.map((i: any) => <li key={i.id} className="row-between" style={{ padding: '6px 0' }}><span>{i.file_name} · {i.row_count} row(s) · {fmtDateTime(i.created_at, c.company.timezone)}</span><span className="row"><Button size="sm" busy={resume.busy} onClick={() => resume.run(i.id)}>Resume</Button><Button size="sm" onClick={() => discard(i.id)}>Discard</Button></span></li>)}</ul>
        </Banner>
      )}
      {!up && (
        <Card id="up" title="1. Choose a file">
          <div className="stack">
            <ErrorSummary error={upload.error ?? resume.error} />
            <Field label="What are you importing?" id="f-import-kind">{(p) => <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as any)}><option value="customers">Customers and service addresses</option><option value="resources">Trucks and equipment</option></Select>}</Field>
            <label className="btn btn-primary" style={{ alignSelf: 'flex-start' }}><Upload aria-hidden />{upload.busy ? 'Reading…' : 'Choose CSV file'}<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && upload.run(e.target.files[0], 'auto')} /></label>
          </div>
        </Card>
      )}
      {up && !result && (
        <Card id="map" title={`2. Match columns: ${up.rowCount} row(s) in ${up.fileName ?? 'file'}`}>
          <div className="stack">
            <ErrorSummary error={upload.error} />
            {up.parseErrors?.length ? <Banner tone="warning" title="Some rows could not be read cleanly"><ul>{up.parseErrors.map((e: string) => <li key={e}>{e}</li>)}</ul></Banner> : null}
            {up.warnings?.length ? <Banner tone="warning"><ul style={{ margin: 0 }}>{up.warnings.map((e: string) => <li key={e}>{e}</li>)}</ul></Banner> : null}
            {file && (
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <Field label="Read the file as" id="f-encoding" hint={`Read as ${ENCODINGS[up.encoding as keyof typeof ENCODINGS] ?? 'UTF-8'}. If names look wrong (N��ez), try the other one.`}>{(p) => <Select {...p} value={encoding} onChange={(e) => { const enc = e.target.value as keyof typeof ENCODINGS; setEncoding(enc); upload.run(file, enc); }}>{Object.entries(ENCODINGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
              </div>
            )}
            {up.accented?.length ? <p className="small" style={{ margin: 0 }}>Accented names as read: {up.accented.join(' · ')}</p> : null}
            <div className="grid-2">{fields.map((f: any) => <Field key={f.key} label={`${f.label}${f.required ? '' : ' (optional)'}`} id={`f-map-${f.key}`} error={doReview.fieldError(f.key)}>{(p) => <Select {...p} value={mapping[f.key] ?? ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}><option value="">Not in file</option>{up.headers.map((h: string) => <option key={h}>{h}</option>)}</Select>}</Field>)}</div>
            {unmapped.length > 0 && (
              <fieldset>
                <legend>Columns that won't be imported</legend>
                {upKind === 'customers' ? <p className="hint">Tick a column to keep its values in the customer's notes.</p> : null}
                {unmapped.map((h) => upKind === 'customers'
                  ? <Checkbox key={h} label={`${h}: add to notes`} checked={notesColumns.includes(h)} onChange={(e) => setNotesColumns(e.target.checked ? [...notesColumns, h] : notesColumns.filter((x) => x !== h))} />
                  : <div key={h} className="small">{h}</div>)}
              </fieldset>
            )}
            <details><summary>Preview first rows</summary><div className="table-wrap"><table className="table"><thead><tr>{up.headers.map((h: string) => <th key={h}>{h}</th>)}</tr></thead><tbody>{up.sample.map((r: any, i: number) => <tr key={i}>{up.headers.map((h: string) => <td key={h}>{r[h]}</td>)}</tr>)}</tbody></table></div></details>
            <ErrorSummary error={doReview.error} />
            <div className="form-actions"><Button variant="primary" busy={doReview.busy} onClick={() => doReview.run()}>Review rows</Button><Button onClick={() => discard()}>Discard</Button></div>
          </div>
        </Card>
      )}
      {review && !result && (
        <Card id="rev" title="3. Review and confirm">
          <div className="stack">
            <div className="row"><Pill tone="success">{review.summary.create} new</Pill>{review.summary.addLocation ? <Pill tone="info">{review.summary.addLocation} added as locations</Pill> : null}<Pill>{review.summary.skip} skipped</Pill>{review.summary.errors ? <Pill tone="danger">{review.summary.errors} with errors</Pill> : null}{review.summary.warnings ? <Pill tone="warning">{review.summary.warnings} with warnings</Pill> : null}{review.summary.openingBalances ? <Pill tone="info">{review.summary.openingBalances} opening balance(s)</Pill> : null}</div>
            {review.summary.lastFirst > 0 && <Checkbox label={`Turn ${review.summary.lastFirst} "Last, First" name(s) around to "First Last"`} checked={flipNames} disabled={doReview.busy} onChange={(e) => doReview.run({ flip: e.target.checked })} />}
            <p className="muted small">Rows are the same customer only when the name matches and the email or phone matches too. Choose what happens to each row; nothing is merged without you seeing it here.</p>
            {review.summary.openingBalances ? <p className="small" style={{ margin: 0 }}>Each opening balance becomes an invoice draft with one line, "Opening balance", for you to review and issue.</p> : null}
            <div className="table-wrap"><table className="table responsive">
              <thead><tr><th>Row</th><th>Values</th><th>Notes</th><th>Action</th></tr></thead>
              <tbody>{review.rows.map((r: any) => {
                const action = r.errors.length ? 'skip' : overrides[r.index] ?? r.action;
                return (
                  <tr key={r.index}>
                    <td data-label="Row" className="num">{r.index + 2}</td>
                    <td data-primary className="small">{Object.entries(r.values).filter(([, v]) => v).map(([k, v]) => <div key={k} className="pre"><span className="muted">{label(k)}:</span> {String(v)}</div>)}</td>
                    <td data-label="Notes" className="small">{r.errors.map((e: string) => <div key={e} className="row" style={{ gap: 4, color: 'var(--danger)' }}><XCircle aria-hidden style={{ width: 14 }} />{e}</div>)}{r.warnings.map((w: string) => <div key={w} className="row" style={{ gap: 4 }}><AlertTriangle aria-hidden style={{ width: 14, color: 'var(--warning)' }} />{w}</div>)}{(r.info ?? []).map((w: string) => <div key={w} className="row" style={{ gap: 4 }}><Info aria-hidden style={{ width: 14 }} />{w}</div>)}{!r.errors.length && !r.warnings.length && !(r.info ?? []).length ? <span className="row" style={{ gap: 4 }}><CheckCircle2 aria-hidden style={{ width: 14, color: 'var(--success)' }} />OK</span> : null}</td>
                    <td data-label="Action">{r.errors.length ? 'Skipped (error)' : (
                      <select className="select" style={{ minHeight: 36, padding: '4px 8px', width: 'auto', maxWidth: 260 }} aria-label={`Action for row ${r.index + 2}`} value={action} onChange={(e) => setOverrides({ ...overrides, [r.index]: e.target.value })}>{(r.options ?? [{ value: 'create', label: 'Create' }, { value: 'skip', label: 'Skip this row' }]).map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                    )}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
            <Checkbox label={`I reviewed these rows. Save the ${upKind === 'customers' ? 'customers and locations' : 'items'} as chosen.`} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <ErrorSummary error={commit.error} />
            <div className="form-actions"><Button variant="primary" disabled={!confirmed} busy={commit.busy} onClick={() => commit.run()}>Save import</Button><Button onClick={() => discard()}>Discard</Button></div>
          </div>
        </Card>
      )}
      {result && (
        <Banner tone="success" title="Import saved" action={<Button size="sm" onClick={() => { reset(); setFile(null); }}>Import another file</Button>}>
          {result.customers ? `${result.customers} customer(s), ${result.locations} location(s). ` : result.locations ? `${result.locations} location(s). ` : ''}{result.resources ? `${result.resources} item(s). ` : ''}{result.skipped} row(s) skipped. {result.locationsAlreadyOnFile ? `${result.locationsAlreadyOnFile} address(es) were already on file. ` : ''}{result.openingBalances ? <>{result.openingBalances} opening balance invoice draft(s) to review in <Link to={c.to('invoices?status=draft')}>Invoices</Link>. </> : null}{upKind === 'customers' ? <Link to={c.to('customers')}>View customers</Link> : <Link to={c.to('resources')}>View equipment</Link>}
          {result.notes?.length ? <ul>{result.notes.map((n: string) => <li key={n}>{n}</li>)}</ul> : null}
        </Banner>
      )}
      <Card id="hist" title="Previous imports">{list.isLoading ? <LoadingBlock /> : list.data.imports.length === 0 ? <p className="muted">None yet.</p> : <ul className="list">{list.data.imports.map((i: any) => <li key={i.id} className="row-between" style={{ padding: '8px 0' }}><span className="row"><FileSpreadsheet aria-hidden style={{ width: 18 }} />{i.file_name} · {i.kind === 'customers' ? 'customers' : 'equipment'}<span className="small muted">{fmtDateTime(i.created_at, c.company.timezone)}</span></span><Pill tone={i.status === 'committed' ? 'success' : i.status === 'failed' ? 'danger' : 'neutral'}>{IMPORT_STATUS[i.status] ?? i.status}</Pill></li>)}</ul>}</Card>
    </div>
  );
}

const IMPORT_STATUS: Record<string, string> = { uploaded: 'Not reviewed yet', reviewed: 'Reviewed, not saved', committed: 'Saved', failed: 'Failed', discarded: 'Discarded' };
