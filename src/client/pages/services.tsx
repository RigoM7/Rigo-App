import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ArrowUp, ArrowDown, Save, Wrench } from 'lucide-react';
import { useCompany } from '../lib/session';
import { get, post, put } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Select, Textarea, ErrorSummary, LoadingBlock, ErrorState, PageHeader, Empty, Pill, Checkbox, Banner, useToast } from '../components/ui';
import { formatMoney, parseMoney, minorToInput } from '../lib/format';
import { SERVICE_CATEGORIES, starterService, type FieldDef, type PriceLine } from '../../shared/services';

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
          const unpriced = s.pricing.filter((p: any) => p.rateMinor === null || p.rateSet === false).length;
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
  useEffect(() => {
    if (svc && !v) {
      setV({ name: svc.name, category: svc.category, description: svc.description, fields: svc.fields, pricing: svc.pricing, requiresPhoto: svc.requiresPhoto, requiresSignature: svc.requiresSignature, active: svc.active });
      setRates(Object.fromEntries(svc.pricing.map((p: any) => [p.id, minorToInput(p.rateMinor)])));
      setTax(svc.taxRateBp === null || svc.taxRateBp === undefined ? '' : String(svc.taxRateBp / 100));
    }
  }, [svc, v]);
  const fin = c.can('finance.view');
  const s = useSubmit(async () => {
    const pricing: PriceLine[] = v.pricing.map((p: PriceLine) => {
      const raw = rates[p.id]?.trim() ?? '';
      return { ...p, rateMinor: raw === '' ? null : parseMoney(raw) ?? -1 };
    });
    const bad = pricing.find((p) => p.rateMinor === -1);
    if (bad) throw Object.assign(new Error(`Enter the rate for "${bad.label}" like 12.50, or leave it empty.`), { status: 400 });
    const taxBp = tax.trim() === '' ? null : Math.round(Number(tax) * 100);
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
                  <div className="small muted">Key: {f.key}</div>
                </li>
              ))}
            </ol>
          </Card>
          <Card id="pricing" title="Pricing" actions={<Button size="sm" icon={<Plus aria-hidden />} onClick={() => setV({ ...v, pricing: [...v.pricing, { id: `line_${Date.now()}`, label: 'Charge', basis: 'flat', quantityField: '', unit: '', rateMinor: null, taxable: false }] })}>Add price line</Button>}>
            <p className="muted">Leave a rate empty if you have not decided it. Invoices that need it are held, never priced at zero.</p>
            <ol className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {v.pricing.map((p: PriceLine, i: number) => (
                <li key={p.id} className="card" style={{ padding: 12 }}>
                  <div className="grid-2">
                    <Field label="Line label" id={`f-service-pricing-${i}-label`}>{(pp) => <Input {...pp} maxLength={80} value={p.label} onChange={(e) => setPrice(i, { label: e.target.value })} />}</Field>
                    <Field label="Charged" id={`f-pb-${i}`}>{(pp) => <Select {...pp} value={p.basis} onChange={(e) => setPrice(i, { basis: e.target.value as any })}><option value="flat">Once per job</option><option value="per_quantity">Per unit of a quantity field</option></Select>}</Field>
                    {p.basis === 'per_quantity' && <Field label="Quantity field" id={`f-service-pricing-${i}-quantityField`} error={s.fieldError(`service.pricing.${i}.quantityField`)}>{(pp) => <Select {...pp} value={p.quantityField} onChange={(e) => { const f = numberFields.find((x: FieldDef) => x.key === e.target.value); setPrice(i, { quantityField: e.target.value, unit: f?.unit ?? p.unit }); }}><option value="">Choose…</option>{numberFields.map((f: FieldDef) => <option key={f.key} value={f.key}>{f.label}</option>)}</Select>}</Field>}
                    <Field label={`Rate (${c.company.currency})${p.basis === 'per_quantity' && p.unit ? ` per ${p.unit}` : ''}`} id={`f-rate-${i}`} hint="Empty means not set yet.">{(pp) => <Input {...pp} inputMode="decimal" value={rates[p.id] ?? ''} onChange={(e) => setRates({ ...rates, [p.id]: e.target.value })} />}</Field>
                  </div>
                  <div className="row-between" style={{ marginTop: 8 }}>
                    <Checkbox label="Taxable" checked={p.taxable} onChange={(e) => setPrice(i, { taxable: e.target.checked })} />
                    <Button size="sm" variant="danger" icon={<Trash2 aria-hidden />} onClick={() => setV({ ...v, pricing: v.pricing.filter((_: any, x: number) => x !== i) })}>Remove</Button>
                  </div>
                  {rates[p.id] && parseMoney(rates[p.id]) !== null ? <div className="small muted">{formatMoney(parseMoney(rates[p.id]), c.company.currency)}</div> : null}
                </li>
              ))}
            </ol>
            <div style={{ marginTop: 12, maxWidth: 260 }}><Field label="Tax rate (%)" optionalText id="f-tax" hint="Applied to taxable lines only. Rigo does not decide tax rules; enter what applies to you.">{(p) => <Input {...p} inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />}</Field></div>
          </Card>
        </fieldset>
        {canEdit && <div className="form-actions"><Button type="submit" variant="primary" size="lg" icon={<Save aria-hidden />} busy={s.busy}>Save service</Button></div>}
      </form>
    </div>
  );
}
