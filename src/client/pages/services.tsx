import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ArrowUp, ArrowDown, Save, Wrench } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, put } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Select, Textarea, ErrorSummary, LoadingBlock, ErrorState, PageHeader, Empty, Pill, Checkbox, Banner, useToast } from '../components/ui';
import { formatMoney, parseMoney, minorToInput, fmtDate } from '../lib/format';
import { parseRate, rateToInput, formatRate, buildLines, computeTotals, pricingWarnings, lineApplies } from '../../shared/billing';
import { SERVICE_CATEGORIES, starterService, priceLine, type FieldDef, type PriceLine } from '../../shared/services';

export function Services() {
  const c = useCompany();
  const nav = useNavigate();
  const q = useQuery({ queryKey: [c.cid, 'services'], queryFn: () => get(`/c/${c.cid}/services`) });
  const create = useSubmit(async (cat: string) => { const r = await post(`/c/${c.cid}/services`, starterService(cat as any)); nav(c.to(`services/${r.id}`)); });
  const [cat, setCat] = useState('fuel');
  return (
    <div className="page">
      <PageHeader title="Services & pricing" sub="What you offer, what dispatch records, what drivers confirm on site, and how it is priced." />
      {c.can('services.manage') && (
        <Card id="add" title="Add a service">
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label="Start from" id="f-cat">{(p) => <Select {...p} value={cat} onChange={(e) => setCat(e.target.value)}>{Object.entries(SERVICE_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l} example</option>)}</Select>}</Field>
            <Button variant="primary" icon={<Plus aria-hidden />} busy={create.busy} onClick={() => create.run(cat)}>Add service</Button>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>Examples are starting points with editable fields. Rates start empty: Rigo never assumes a price.</p>
          <ErrorSummary error={create.error} />
        </Card>
      )}
      {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorState error={q.error} /> : q.data.services.length === 0 ? <Card><Empty icon={<Wrench aria-hidden />} title="No services yet" /></Card> : (
        <div className="card card-flush"><ul className="list">{q.data.services.map((s: any) => {
          const unpriced = s.pricing.filter((p: any) => p.rateE4 === null || p.rateSet === false).length;
          return (
            <li key={s.id}><Link className="list-item" to={c.to(`services/${s.id}`)} style={{ alignItems: 'center' }}>
              <span style={{ flex: 1 }}><strong>{s.name}</strong><div className="small muted">{(SERVICE_CATEGORIES as any)[s.category]} · {s.fields.length} field(s) · {s.pricing.length} price line(s){s.requiresPhoto ? ' · photo required' : ''}{s.requiresSignature ? ' · signature required' : ''}</div></span>
              {!s.active ? <Pill>Inactive</Pill> : unpriced ? <Pill tone="warning">{unpriced} rate(s) not set</Pill> : <Pill tone="success">Priced</Pill>}
            </Link></li>
          );
        })}</ul></div>
      )}
    </div>
  );
}

function move<T>(arr: T[], i: number, d: number) { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; }
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40) || 'field';

/** Rates are typed as text; read them into a price list. `bad` names the first rate that isn't a number. */
function readRates(pricing: PriceLine[], rates: Record<string, string>) {
  let bad: string | null = null;
  const out = pricing.map((p): PriceLine => {
    const read = (k: string, parse: (s: string) => number | null, what: string) => {
      const raw = rates[k]?.trim() ?? '';
      if (raw === '') return null;
      const n = parse(raw);
      if (n === null) bad ??= `Enter ${what} for "${p.label}" like 3.8995 or 375, or leave it empty.`;
      return n;
    };
    const included = p.basis === 'flat' && p.includedQuantity !== null;
    if (included && !/^\d+(\.\d+)?$/.test(p.includedQuantity ?? '')) bad ??= `Enter how much "${p.label}" includes, like 1000.`;
    return {
      ...p,
      rateE4: read(p.id, parseRate, 'the rate'),
      includedQuantity: included ? p.includedQuantity : null,
      overageRateE4: included ? read(`${p.id}:over`, parseRate, 'the rate beyond the included quantity') : null,
      minimumMinor: p.basis === 'per_quantity' ? read(`${p.id}:min`, parseMoney, 'the minimum charge') : null,
    };
  });
  return { pricing: out, bad };
}

const parseTax = (tax: string) => (tax.trim() === '' ? null : Math.round(Number(tax.replace(',', '.')) * 100));

export function ServiceEditor() {
  const c = useCompany();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: [c.cid, 'services'], queryFn: () => get(`/c/${c.cid}/services`) });
  const svc = q.data?.services.find((s: any) => s.id === id);
  const [v, setV] = useState<any>(null);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [tax, setTax] = useState('');
  const [sample, setSample] = useState<Record<string, string>>({});
  useEffect(() => {
    if (svc && !v) {
      setV({ name: svc.name, category: svc.category, description: svc.description, fields: svc.fields, pricing: svc.pricing, requiresPhoto: svc.requiresPhoto, requiresSignature: svc.requiresSignature, active: svc.active });
      setRates(Object.fromEntries(svc.pricing.flatMap((p: any) => [[p.id, rateToInput(p.rateE4)], [`${p.id}:over`, rateToInput(p.overageRateE4)], [`${p.id}:min`, minorToInput(p.minimumMinor)]])));
      setTax(svc.taxRateBp === null || svc.taxRateBp === undefined ? '' : String(svc.taxRateBp / 100));
    }
  }, [svc, v]);
  const fin = c.can('finance.view');
  const cur = c.company.currency;
  const s = useSubmit(async () => {
    const { pricing, bad } = readRates(v.pricing, rates);
    if (bad) throw Object.assign(new Error(bad), { status: 400 });
    const taxBp = parseTax(tax);
    if (taxBp !== null && (!Number.isFinite(taxBp) || taxBp < 0 || taxBp > 5000)) throw new Error('Tax rate must be a percentage between 0 and 50.');
    await put(`/c/${c.cid}/services/${id}`, { service: { ...v, pricing, taxRateBp: taxBp }, version: svc.version });
    await qc.invalidateQueries({ queryKey: [c.cid] });
    setV(null);
    toast('Service saved. Held invoices for this service were recalculated.');
  });
  if (q.isLoading || (svc && !v)) return <div className="page"><LoadingBlock /></div>;
  if (q.error) return <div className="page"><ErrorState error={q.error} /></div>;
  if (!svc) return <div className="page"><ErrorState error={{ status: 404, message: 'Service not found.' }} /></div>;
  const canEdit = c.can('services.manage') && fin;
  const setField = (i: number, patch: Partial<FieldDef>) => setV({ ...v, fields: v.fields.map((f: FieldDef, x: number) => (x === i ? { ...f, ...patch } : f)) });
  const setPrice = (i: number, patch: Partial<PriceLine>) => setV({ ...v, pricing: v.pricing.map((p: PriceLine, x: number) => (x === i ? { ...p, ...patch } : p)) });
  const numberFields = v.fields.filter((f: FieldDef) => f.type === 'number');
  const choiceFields = v.fields.filter((f: FieldDef) => f.type === 'select' || f.type === 'boolean');
  const whenValues = (key: string): [string, string][] => { const f = choiceFields.find((x: FieldDef) => x.key === key); return f ? (f.type === 'boolean' ? [['true', 'Yes'], ['false', 'No']] : (f.options ?? []).map((o: string): [string, string] => [o, o])) : []; };
  const taxBp = parseTax(tax);
  const taxSet = taxBp !== null && Number.isFinite(taxBp) && taxBp > 0;
  const draft = readRates(v.pricing, rates).pricing;
  const warnings = fin ? pricingWarnings({ pricing: draft, fields: v.fields, taxRateBp: taxSet ? taxBp : null }, cur) : [];
  const untaxed = draft.filter((p) => !p.taxable).length;
  const unitOf = (key: string) => numberFields.find((f: FieldDef) => f.key === key)?.unit ?? '';
  return (
    <div className="page page-narrow">
      <PageHeader back={{ to: c.to('services'), label: 'Services' }} title={v.name || 'Service'} />
      {!canEdit && <Banner tone="info">You can view this service. Changing it needs service and finance permissions.</Banner>}
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); s.run(); }}>
        <ErrorSummary error={s.error} />
        <fieldset disabled={!canEdit} className="stack">
          <Card id="basics" title="Basics">
            <div className="stack">
              <div className="grid-2">
                <Field label="Name" id="f-service-name" error={s.fieldError('service.name')}>{(p) => <Input {...p} maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
                <Field label="Category" id="f-category">{(p) => <Select {...p} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{Object.entries(SERVICE_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
              </div>
              <Field label="Description" optionalText id="f-description">{(p) => <Textarea {...p} maxLength={500} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />}</Field>
              <Checkbox label="Require at least one photo to complete" checked={v.requiresPhoto} onChange={(e) => setV({ ...v, requiresPhoto: e.target.checked })} />
              <Checkbox label="Require a customer signature to complete" checked={v.requiresSignature} onChange={(e) => setV({ ...v, requiresSignature: e.target.checked })} />
              <Checkbox label="Active (available for new jobs)" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
            </div>
          </Card>
          <Card id="fields" title="Fields" actions={<Button size="sm" icon={<Plus aria-hidden />} onClick={() => setV({ ...v, fields: [...v.fields, { key: `field_${v.fields.length + 1}`, label: 'New field', type: 'text', unit: '', options: [], stage: 'request', required: false, help: '' }] })}>Add field</Button>}>
            <p className="muted">“Request” fields are filled when the job is recorded; “Completion” fields are confirmed by the driver on site.</p>
            <ol className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {v.fields.map((f: FieldDef, i: number) => (
                <li key={i} className="card" style={{ padding: 12 }}>
                  <div className="grid-2">
                    <Field label="Label" id={`f-service-fields-${i}-label`} error={s.fieldError(`service.fields.${i}.label`)}>{(p) => <Input {...p} maxLength={60} value={f.label} onChange={(e) => setField(i, { label: e.target.value, key: f.key.startsWith('field_') ? slug(e.target.value) : f.key })} />}</Field>
                    <Field label="Type" id={`f-ft-${i}`}>{(p) => <Select {...p} value={f.type} onChange={(e) => setField(i, { type: e.target.value as any })}><option value="text">Short text</option><option value="longtext">Long text</option><option value="number">Number</option><option value="select">Choice list</option><option value="boolean">Yes / no</option><option value="date">Date</option></Select>}</Field>
                    <Field label="When" id={`f-fs-${i}`}>{(p) => <Select {...p} value={f.stage} onChange={(e) => setField(i, { stage: e.target.value as any })}><option value="request">Request (dispatch)</option><option value="completion">Completion (driver)</option><option value="both">Both</option></Select>}</Field>
                    {f.type === 'number' && <Field label="Unit" optionalText id={`f-fu-${i}`}>{(p) => <Input {...p} maxLength={20} value={f.unit} onChange={(e) => setField(i, { unit: e.target.value })} />}</Field>}
                    {f.type === 'select' && <Field label="Options (one per line)" id={`f-service-fields-${i}-options`} error={s.fieldError(`service.fields.${i}.options`)}>{(p) => <Textarea {...p} value={(f.options ?? []).join('\n')} onChange={(e) => setField(i, { options: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} />}</Field>}
                  </div>
                  <div className="row-between" style={{ marginTop: 8 }}>
                    <Checkbox label="Required" checked={f.required} onChange={(e) => setField(i, { required: e.target.checked })} />
                    <span className="row">
                      <Button size="sm" variant="ghost" aria-label={`Move ${f.label} up`} disabled={i === 0} onClick={() => setV({ ...v, fields: move(v.fields, i, -1) })}><ArrowUp aria-hidden /></Button>
                      <Button size="sm" variant="ghost" aria-label={`Move ${f.label} down`} disabled={i === v.fields.length - 1} onClick={() => setV({ ...v, fields: move(v.fields, i, 1) })}><ArrowDown aria-hidden /></Button>
                      <Button size="sm" variant="danger" icon={<Trash2 aria-hidden />} onClick={() => setV({ ...v, fields: v.fields.filter((_: any, x: number) => x !== i) })}>Remove</Button>
                    </span>
                  </div>
                  <details className="advanced"><summary className="small">Advanced</summary><p className="small muted" style={{ margin: '6px 0 0' }}>Field key for imports and workflows: <code>{f.key}</code></p></details>
                </li>
              ))}
            </ol>
          </Card>
          <Card id="pricing" title="Pricing" actions={<Button size="sm" icon={<Plus aria-hidden />} onClick={() => setV({ ...v, pricing: [...v.pricing, priceLine({ id: `line_${Date.now()}`, label: 'Charge', basis: 'flat', taxable: taxSet })] })}>Add price line</Button>}>
            <p className="muted">Leave a rate empty if you have not decided it. Invoices that need it are held, never priced at zero. Rates can have up to 4 decimals ($3.8995 a gallon); each line rounds to the cent. A line can apply only to some jobs, for example a different price per product.</p>
            {warnings.length > 0 && (
              <div className="pricing-warnings" role="status">
                <Banner tone="warning" title="Check these prices">
                  <ul className="warn-list">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </Banner>
              </div>
            )}
            <div className="row" style={{ alignItems: 'flex-end', margin: '12px 0' }}>
              <div style={{ maxWidth: 220 }}><Field label="Tax rate (%)" optionalText id="f-tax" hint="Applied to taxable lines only. Enter what applies to you.">{(p) => <Input {...p} inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />}</Field></div>
              {taxSet && untaxed > 0 && <Button size="sm" onClick={() => setV({ ...v, pricing: v.pricing.map((p: PriceLine) => ({ ...p, taxable: true })) })}>Make all lines taxable</Button>}
            </div>
            <ol className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {v.pricing.map((p: PriceLine, i: number) => {
                const perUnit = p.basis === 'per_quantity';
                const included = !perUnit && p.includedQuantity !== null;
                const unit = p.unit || unitOf(p.quantityField) || 'unit';
                return (
                <li key={p.id} className="card" style={{ padding: 12 }}>
                  <div className="grid-2">
                    <Field label="Line label" id={`f-service-pricing-${i}-label`}>{(pp) => <Input {...pp} maxLength={80} value={p.label} onChange={(e) => setPrice(i, { label: e.target.value })} />}</Field>
                    <Field label="Charged" id={`f-pb-${i}`}>{(pp) => <Select {...pp} value={p.basis} onChange={(e) => setPrice(i, { basis: e.target.value as any, includedQuantity: null })}><option value="flat">Once per job</option><option value="per_quantity">Per unit of a quantity field</option></Select>}</Field>
                    {(perUnit || included) && <Field label="Quantity field" id={`f-service-pricing-${i}-quantityField`} error={s.fieldError(`service.pricing.${i}.quantityField`)}>{(pp) => <Select {...pp} value={p.quantityField} onChange={(e) => setPrice(i, { quantityField: e.target.value, unit: unitOf(e.target.value) || p.unit })}><option value="">Choose…</option>{numberFields.map((f: FieldDef) => <option key={f.key} value={f.key}>{f.label}</option>)}</Select>}</Field>}
                    <Field label={`Rate (${cur})${perUnit ? ` per ${unit}` : ''}`} id={`f-rate-${i}`} hint={p.rateSince && fin ? `Current rate since ${fmtDate(p.rateSince)}. Empty means not set yet.` : 'Empty means not set yet.'}>{(pp) => <Input {...pp} inputMode="decimal" value={rates[p.id] ?? ''} onChange={(e) => setRates({ ...rates, [p.id]: e.target.value })} />}</Field>
                    {perUnit && <Field label={`Minimum charge (${cur})`} optionalText id={`f-service-pricing-${i}-minimumMinor`} error={s.fieldError(`service.pricing.${i}.minimumMinor`)} hint="The least this line charges, for small jobs.">{(pp) => <Input {...pp} inputMode="decimal" value={rates[`${p.id}:min`] ?? ''} onChange={(e) => setRates({ ...rates, [`${p.id}:min`]: e.target.value })} />}</Field>}
                    {included && <Field label={`Included${p.quantityField ? ` (${unit})` : ''}`} id={`f-service-pricing-${i}-includedQuantity`} error={s.fieldError(`service.pricing.${i}.includedQuantity`)} hint="Covered by the flat rate.">{(pp) => <Input {...pp} inputMode="decimal" value={p.includedQuantity ?? ''} onChange={(e) => setPrice(i, { includedQuantity: e.target.value.trim().replace(/,/g, '') })} />}</Field>}
                    {included && <Field label={`Rate beyond that (${cur} per ${unit})`} id={`f-over-${i}`} hint="Empty holds jobs that go over.">{(pp) => <Input {...pp} inputMode="decimal" value={rates[`${p.id}:over`] ?? ''} onChange={(e) => setRates({ ...rates, [`${p.id}:over`]: e.target.value })} />}</Field>}
                  </div>
                  {!perUnit && numberFields.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <Checkbox label="The flat rate includes a quantity, with a rate beyond it" checked={included}
                        onChange={(e) => setPrice(i, e.target.checked ? { includedQuantity: '', quantityField: p.quantityField || numberFields[0].key, unit: p.unit || numberFields[0].unit } : { includedQuantity: null })} />
                    </div>
                  )}
                  <fieldset className="charge-when" aria-describedby={`f-pw-${i}-hint`}>
                    <legend className="small">When to charge this line</legend>
                    <div className="charge-when-row">
                      <Select aria-label={`When to charge ${p.label}`} value={p.when ? 'when' : 'always'} disabled={!choiceFields.length}
                        onChange={(e) => { if (e.target.value === 'always') setPrice(i, { when: null }); else { const f = choiceFields[0]; setPrice(i, { when: { field: f.key, equals: whenValues(f.key)[0]?.[0] ?? '' } }); } }}>
                        <option value="always">On every job</option><option value="when">Only when…</option>
                      </Select>
                      {p.when ? <>
                        <Select aria-label={`Field that decides whether ${p.label} is charged`} value={p.when.field} onChange={(e) => setPrice(i, { when: { field: e.target.value, equals: whenValues(e.target.value)[0]?.[0] ?? '' } })}>
                          {choiceFields.map((f: FieldDef) => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </Select>
                        <span className="small">is</span>
                        <Select aria-label={`Value of ${choiceFields.find((f: FieldDef) => f.key === p.when!.field)?.label ?? 'the field'} that charges ${p.label}`} value={p.when.equals} onChange={(e) => setPrice(i, { when: { field: p.when!.field, equals: e.target.value } })}>
                          {whenValues(p.when.field).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                        </Select>
                      </> : null}
                    </div>
                    <p id={`f-pw-${i}-hint`} className="hint" style={{ margin: 0 }}>{p.when ? `Charge only when ${choiceFields.find((f: FieldDef) => f.key === p.when!.field)?.label ?? p.when.field} is ${whenValues(p.when.field).find(([val]) => val === p.when!.equals)?.[1] ?? p.when.equals}.` : choiceFields.length ? 'Charged on every job of this service.' : 'Charged on every job. Add a choice list or yes/no field to charge only some jobs.'}</p>
                    {s.fieldError(`service.pricing.${i}.when.field`) || s.fieldError(`service.pricing.${i}.when.equals`) ? <p className="field-error" style={{ margin: 0 }}>{s.fieldError(`service.pricing.${i}.when.field`) ?? s.fieldError(`service.pricing.${i}.when.equals`)}</p> : null}
                  </fieldset>
                  <div className="row-between" style={{ marginTop: 8 }}>
                    <Checkbox label="Taxable" checked={p.taxable} onChange={(e) => setPrice(i, { taxable: e.target.checked })} />
                    <Button size="sm" variant="danger" icon={<Trash2 aria-hidden />} onClick={() => setV({ ...v, pricing: v.pricing.filter((_: any, x: number) => x !== i) })}>Remove</Button>
                  </div>
                </li>
                );
              })}
            </ol>
          </Card>
        </fieldset>
        {fin && <ExampleBill pricing={draft} fields={v.fields} taxRateBp={taxSet ? taxBp : null} currency={cur} sample={sample} setSample={setSample} />}
        {canEdit && <div className="form-actions"><Button type="submit" variant="primary" size="lg" icon={<Save aria-hidden />} busy={s.busy}>Save service</Button></div>}
      </form>
    </div>
  );
}

/**
 * A live bill for one sample job, built with the same code that prices real invoices, so the owner
 * sees exactly which lines a job like this would charge before saving.
 */
function ExampleBill({ pricing, fields, taxRateBp, currency, sample, setSample }: { pricing: PriceLine[]; fields: FieldDef[]; taxRateBp: number | null; currency: string; sample: Record<string, string>; setSample: (s: Record<string, string>) => void }) {
  const used = new Set<string>();
  for (const p of pricing) {
    if (p.when) used.add(p.when.field);
    if (p.basis === 'per_quantity' || p.includedQuantity !== null) used.add(p.quantityField);
  }
  const inputs = fields.filter((f) => used.has(f.key) && ['number', 'select', 'boolean'].includes(f.type));
  const fallback = (f: FieldDef) => {
    if (f.type === 'boolean') return 'false';
    if (f.type === 'select') return pricing.find((p) => p.when?.field === f.key)?.when?.equals ?? f.options[0] ?? '';
    const inc = pricing.find((p) => p.quantityField === f.key && p.includedQuantity && /^\d+(\.\d+)?$/.test(p.includedQuantity));
    return inc ? String(Number(inc.includedQuantity) + 250) : '100';
  };
  const values: Record<string, unknown> = Object.fromEntries(inputs.map((f) => [f.key, (sample[f.key] ?? fallback(f)).replace(',', '.')]));
  const labels = Object.fromEntries(fields.map((f) => [f.key, f.label]));
  const types = Object.fromEntries(fields.map((f) => [f.key, f.type]));
  const built = buildLines(pricing, values, labels, types, { currency });
  const totals = computeTotals(built.lines, taxRateBp);
  const holds = [...new Set([...built.holdReasons, ...totals.holdReasons])];
  const skipped = pricing.filter((p) => !lineApplies(p, values));
  return (
    <Card id="example-bill" title="Example bill">
      <p className="muted">Try a job to see what it would be billed with the prices above. Nothing is saved.</p>
      {inputs.length > 0 && (
        <div className="grid-2" style={{ marginBottom: 12 }}>
          {inputs.map((f) => (
            <Field key={f.key} label={`${f.label}${f.unit ? ` (${f.unit})` : ''}`} id={`ex-${f.key}`}>{(p) => f.type === 'number'
              ? <Input {...p} inputMode="decimal" value={sample[f.key] ?? fallback(f)} onChange={(e) => setSample({ ...sample, [f.key]: e.target.value })} />
              : <Select {...p} value={sample[f.key] ?? fallback(f)} onChange={(e) => setSample({ ...sample, [f.key]: e.target.value })}>
                {f.type === 'boolean' ? <><option value="false">No</option><option value="true">Yes</option></> : f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>}</Field>
          ))}
        </div>
      )}
      <div className="table-wrap">
        <table className="table example-bill" aria-label="Example bill">
          <thead><tr><th>Line</th><th className="right">Quantity</th><th className="right">Rate</th><th className="right">Amount</th></tr></thead>
          <tbody>
            {built.lines.length === 0 ? <tr><td colSpan={4} className="muted">No line charges on this job.</td></tr> : built.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.description}{l.taxable ? <span className="small muted"> · taxable</span> : null}{l.note ? <div className="small muted">{l.note}</div> : null}</td>
                <td className="right num">{l.quantity}{l.unit ? ` ${l.unit}` : ''}</td>
                <td className="right num">{formatRate(l.rateE4, currency)}</td>
                <td className="right num">{formatMoney(l.amountMinor, currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3} className="right">Subtotal</td><td className="right num">{formatMoney(totals.subtotalMinor, currency)}</td></tr>
            <tr><td colSpan={3} className="right">Tax{taxRateBp !== null ? ` (${taxRateBp / 100}%)` : ''}</td><td className="right num">{formatMoney(totals.taxMinor, currency)}</td></tr>
            <tr><th colSpan={3} className="right">Total</th><th className="right num">{formatMoney(totals.totalMinor, currency)}</th></tr>
          </tfoot>
        </table>
      </div>
      {skipped.length > 0 && <p className="small muted" style={{ marginTop: 8 }}>Not charged on this job: {skipped.map((p) => p.label).join(', ')}.</p>}
      {holds.length > 0 && <Banner tone="warning" title="This invoice would be held">{holds.map((h) => <div key={h}>{h}</div>)}</Banner>}
    </Card>
  );
}
