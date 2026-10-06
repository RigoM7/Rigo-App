import { TimezoneSelect } from './workspaces';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Upload, Trash2, Plus, ArrowUp, ArrowDown } from 'lucide-react';
import { useCompany } from '../lib/session';
import { patch, api } from '../lib/api';
import { useSubmit } from '../lib/form';
import { Button, Card, Field, Input, Select, ErrorSummary, PageHeader, Tabs, Banner, Checkbox, Textarea, useToast, useConfirm } from '../components/ui';
import { ACCENT_PRESETS, accentVariants, contrast } from '../../shared/branding';
import { CURRENCIES } from '../../shared/billing';
import { SERVICE_CATEGORIES } from '../../shared/services';
import { CapabilityList } from './automation';
import { useDirtySet, useReportDirty, useUnsavedGuard } from '../lib/unsaved';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40) || 'field';

function CustomFieldsEditor({ onDirty }: { onDirty?: (k: string, v: boolean) => void }) {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState<any>(() => structuredClone(c.company.customFields ?? { customers: [], jobs: [], locations: [] }));
  const [kind, setKind] = useState<'customers' | 'jobs' | 'locations'>('customers');
  const [saved, setSaved] = useState(() => JSON.stringify(c.company.customFields ?? { customers: [], jobs: [], locations: [] }));
  const s = useSubmit(async () => { await patch(`/c/${c.cid}/settings`, { customFields: v }); setSaved(JSON.stringify(v)); qc.invalidateQueries({ queryKey: [c.cid] }); toast('Custom fields saved'); });
  useReportDirty(onDirty, 'customFields', JSON.stringify(v) !== saved);
  const list = v[kind];
  const set = (i: number, p: any) => setV({ ...v, [kind]: list.map((f: any, x: number) => (x === i ? { ...f, ...p } : f)) });
  const mv = (i: number, d: number) => { const a = [...list]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setV({ ...v, [kind]: a }); };
  return (
    <Card id="cf" title="Custom fields">
      <p className="muted">Add your own fields to customers, locations and jobs. They are validated like built-in fields.</p>
      <Tabs label="Record type" value={kind} onChange={setKind} tabs={[{ key: 'customers', label: 'Customers' }, { key: 'locations', label: 'Locations' }, { key: 'jobs', label: 'Jobs' }]} />
      <ErrorSummary error={s.error} />
      <ol className="stack" style={{ listStyle: 'none', padding: 0, margin: '12px 0' }}>{list.map((f: any, i: number) => (
        <li key={i} className="card" style={{ padding: 12 }}>
          <div className="grid-2">
            <Field label="Label" id={`f-customFields-${kind}-${i}-label`} error={s.fieldError(`customFields.${kind}.${i}.label`)}>{(p) => <Input {...p} maxLength={60} value={f.label} onChange={(e) => set(i, { label: e.target.value, key: f.isNew ? slug(e.target.value) : f.key })} />}</Field>
            <Field label="Type" id={`f-cft-${i}`}>{(p) => <Select {...p} value={f.type} onChange={(e) => set(i, { type: e.target.value })}><option value="text">Text</option><option value="number">Number</option><option value="select">Choice list</option><option value="boolean">Yes / no</option><option value="date">Date</option></Select>}</Field>
            {f.type === 'select' && <Field label="Options (one per line)" id={`f-cfo-${i}`}>{(p) => <Textarea {...p} value={(f.options ?? []).join('\n')} onChange={(e) => set(i, { options: e.target.value.split('\n').map((x: string) => x.trim()).filter(Boolean) })} />}</Field>}
          </div>
          <div className="row-between"><Checkbox label="Required" checked={!!f.required} onChange={(e) => set(i, { required: e.target.checked })} />
            <span className="row"><Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => mv(i, -1)}><ArrowUp aria-hidden /></Button><Button size="sm" variant="ghost" aria-label="Move down" disabled={i === list.length - 1} onClick={() => mv(i, 1)}><ArrowDown aria-hidden /></Button><Button size="sm" variant="danger" icon={<Trash2 aria-hidden />} onClick={() => setV({ ...v, [kind]: list.filter((_: any, x: number) => x !== i) })}>Remove</Button></span></div>
        </li>
      ))}</ol>
      <div className="form-actions"><Button icon={<Plus aria-hidden />} onClick={() => setV({ ...v, [kind]: [...list, { key: `field_${list.length + 1}`, label: '', type: 'text', options: [], required: false, isNew: true }] })}>Add field</Button><Button variant="primary" busy={s.busy} onClick={() => s.run()}>Save custom fields</Button></div>
    </Card>
  );
}

function Branding({ onDirty }: { onDirty?: (k: string, v: boolean) => void }) {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const [accent, setAccent] = useState<string>(c.company.branding?.accent ?? '');
  const variants = accentVariants(accent || null);
  useReportDirty(onDirty, 'branding', accent !== (c.company.branding?.accent ?? ''));
  const s = useSubmit(async () => { await patch(`/c/${c.cid}/branding`, { accent: accent || null }); qc.invalidateQueries({ queryKey: [c.cid] }); toast('Branding saved'); });
  const logo = useSubmit(async (file: File) => { const form = new FormData(); form.append('file', file); await api(`/c/${c.cid}/branding/logo`, { method: 'POST', form }); qc.invalidateQueries({ queryKey: [c.cid] }); toast('Logo uploaded'); });
  const removeLogo = useSubmit(async () => { await patch(`/c/${c.cid}/branding`, { removeLogo: true }); qc.invalidateQueries({ queryKey: [c.cid] }); });
  return (
    <Card id="brand" title="Branding">
      <div className="stack">
        <p className="muted">Your logo and accent appear in your workspace, on invoices and in message previews. Navigation and controls stay the same for every company so they remain easy to use.</p>
        <ErrorSummary error={s.error ?? logo.error} />
        <div className="stack-sm"><span className="label">Logo</span>
          <div className="row">{c.company.branding?.logoFileId ? <img src={`/api/c/${c.cid}/branding/logo?v=${c.company.branding.logoFileId}`} alt="Current logo" style={{ maxHeight: 56, maxWidth: 180, background: '#fff', borderRadius: 6, padding: 4, border: '1px solid var(--border)' }} /> : <span className="muted">No logo yet (optional).</span>}
            <label className="btn"><Upload aria-hidden />{logo.busy ? 'Uploading…' : 'Upload PNG, JPEG or WebP'}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && logo.run(e.target.files[0])} /></label>
            {c.company.branding?.logoFileId ? <Button variant="ghost" icon={<Trash2 aria-hidden />} onClick={() => removeLogo.run()}>Remove</Button> : null}</div>
          <span className="hint">Up to 512 KB. SVG files are not accepted.</span>
        </div>
        <fieldset><legend>Accent color</legend>
          <div className="row">{ACCENT_PRESETS.map((p) => <button key={p.hex} type="button" className="swatch" style={{ background: p.hex }} aria-pressed={accent.toLowerCase() === p.hex.toLowerCase()} aria-label={p.name} title={p.name} onClick={() => setAccent(p.hex)} />)}
            <Button size="sm" variant="ghost" onClick={() => setAccent('')}>Use Rigo red</Button></div>
          <div style={{ maxWidth: 220, marginTop: 8 }}><Field label="Custom hex" optionalText id="f-accent" error={s.fieldError('accent')}>{(p) => <Input {...p} maxLength={7} value={accent} placeholder="#B91C1C" onChange={(e) => setAccent(e.target.value)} />}</Field></div>
        </fieldset>
        {accent && /^#[0-9a-fA-F]{6}$/.test(accent) && (
          variants.usable ? <Banner tone="info" title="Accessible variants">Light theme uses {variants.light} ({contrast(variants.light, '#FFFFFF').toFixed(1)}:1 on white); dark theme uses {variants.dark} ({contrast(variants.dark, '#161618').toFixed(1)}:1 on dark surfaces).<div className="row" style={{ marginTop: 8 }}><span className="pill" style={{ background: variants.light, color: '#fff' }}>Light</span><span className="pill" style={{ background: '#161618', color: variants.dark }}>Dark</span></div></Banner>
            : <Banner tone="warning">This color cannot be made readable in both themes. Choose another.</Banner>
        )}
        <BrandPreview name={c.company.name} accent={variants.usable && /^#[0-9a-fA-F]{6}$/.test(accent) ? variants.light : '#B91C1C'} />
        <div><Button variant="primary" busy={s.busy} onClick={() => s.run()}>Save branding</Button></div>
      </div>
    </Card>
  );
}

/** Live preview of exactly where the accent appears: switcher chip, invoice header, message preview. */
function BrandPreview({ name, accent }: { name: string; accent: string }) {
  const initial = (name.replace(/[^A-Za-z0-9]/g, '').charAt(0) || '?').toUpperCase();
  return (
    <section className="stack-sm" aria-labelledby="bp-h">
      <h3 id="bp-h" className="label">Preview <span className="muted" style={{ fontWeight: 400 }}>(unsaved changes show here first)</span></h3>
      <div className="brand-preview" aria-hidden>
        <div className="bp-chrome"><span className="company-chip" data-initial={initial} style={{ background: accent }} /><span>{name}</span></div>
        <div className="bp-doc"><div style={{ height: 4, borderRadius: 2, background: accent }} /><div className="row-between" style={{ marginTop: 10 }}><strong>{name}</strong><span className="doc-title" style={{ fontSize: 'var(--fs-16)' }}>Invoice</span></div></div>
        <div className="bp-msg"><span className="company-chip" data-initial={initial} style={{ background: accent, width: 20, height: 20, fontSize: 11 }} /><span><strong>{name}</strong><br /><span className="muted">Your invoice is ready</span></span></div>
      </div>
    </section>
  );
}

/** Invoice settings (R3-m7): terms, numbering that continues from the previous system (D17), how to pay. */
function InvoiceSettings({ onDirty }: { onDirty?: (k: string, v: boolean) => void }) {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const currentNext = (c.company.invoice_seq ?? 0) + 1;
  const [v, setV] = useState({ invoiceDueDays: String(c.company.invoiceDueDays ?? 30), invoicePrefix: c.company.invoicePrefix ?? 'INV-', nextInvoiceNumber: String(currentNext),
    paymentInstructions: c.company.paymentInstructions ?? '', remitTo: c.company.remitTo ?? '', taxId: c.company.taxId ?? '' });
  const s = useSubmit(async () => {
    const days = Number(v.invoiceDueDays);
    if (!/^\d+$/.test(v.invoiceDueDays) || days > 180) throw Object.assign(new Error('Payment terms are a number of days from 0 to 180.'), { fields: { invoiceDueDays: 'Enter 0 to 180 days' } });
    const next = Number(v.nextInvoiceNumber);
    if (!/^\d+$/.test(v.nextInvoiceNumber) || next < 1) throw Object.assign(new Error('Enter the next invoice number, like 1042.'), { fields: { nextInvoiceNumber: 'Enter a whole number' } });
    await patch(`/c/${c.cid}/settings`, { invoiceDueDays: days, invoicePrefix: v.invoicePrefix, paymentInstructions: v.paymentInstructions, remitTo: v.remitTo, taxId: v.taxId, ...(next !== currentNext ? { nextInvoiceNumber: next } : {}) });
    qc.invalidateQueries({ queryKey: [c.cid] }); qc.invalidateQueries({ queryKey: ['me'] }); toast('Invoice settings saved');
  });
  const preview = `${v.invoicePrefix}${String(Number(v.nextInvoiceNumber) || currentNext).padStart(5, '0')}`;
  useReportDirty(onDirty, 'invoices', JSON.stringify(v) !== JSON.stringify({ invoiceDueDays: String(c.company.invoiceDueDays ?? 30), invoicePrefix: c.company.invoicePrefix ?? 'INV-', nextInvoiceNumber: String(currentNext),
    paymentInstructions: c.company.paymentInstructions ?? '', remitTo: c.company.remitTo ?? '', taxId: c.company.taxId ?? '' }));
  return (
    <Card id="inv" title="Invoices and payments">
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); s.run(); }}>
        <ErrorSummary error={s.error} />
        <Field label="Payment terms (days after the invoice is issued)" id="f-invoiceDueDays" hint="0 means due on receipt. A customer can have their own terms on their page." error={s.fieldError('invoiceDueDays')}>{(p) => <Input {...p} inputMode="numeric" value={v.invoiceDueDays} onChange={(e) => setV({ ...v, invoiceDueDays: e.target.value.replace(/\D/g, '') })} />}</Field>
        <div className="grid-2">
          <Field label="Number prefix" optionalText id="f-invoicePrefix" error={s.fieldError('invoicePrefix')}>{(p) => <Input {...p} maxLength={12} value={v.invoicePrefix} onChange={(e) => setV({ ...v, invoicePrefix: e.target.value })} />}</Field>
          <Field label="Next invoice number" id="f-nextInvoiceNumber" hint={`Continue from QuickBooks or your old system. Next invoice: ${preview}`} error={s.fieldError('nextInvoiceNumber')}>{(p) => <Input {...p} inputMode="numeric" value={v.nextInvoiceNumber} onChange={(e) => setV({ ...v, nextInvoiceNumber: e.target.value.replace(/\D/g, '') })} />}</Field>
        </div>
        <Field label="How customers pay you" optionalText id="f-paymentInstructions" hint="Shown on invoices and in invoice emails, for example who to make checks out to or a number to call to pay by card." error={s.fieldError('paymentInstructions')}>{(p) => <Textarea {...p} maxLength={500} value={v.paymentInstructions} onChange={(e) => setV({ ...v, paymentInstructions: e.target.value })} />}</Field>
        <div className="grid-2">
          <Field label="Send payments to" optionalText id="f-remitTo" hint="A mailing address for checks, if different from yours.">{(p) => <Textarea {...p} maxLength={300} value={v.remitTo} onChange={(e) => setV({ ...v, remitTo: e.target.value })} />}</Field>
          <Field label="Tax ID" optionalText id="f-taxId" hint="Printed on invoices.">{(p) => <Input {...p} maxLength={40} value={v.taxId} onChange={(e) => setV({ ...v, taxId: e.target.value })} />}</Field>
        </div>
        <div><Button type="submit" variant="primary" busy={s.busy}>Save invoice settings</Button></div>
      </form>
      {c.role.isOwner && <ApprovalRule />}
    </Card>
  );
}

/** "Every invoice needs approval before issuing" (R14-M1): visible, owner only, confirmed and audited. */
function ApprovalRule() {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const { ask, node } = useConfirm();
  const on = c.company.invoiceApprovalRequired !== false;
  const s = useSubmit(async () => {
    const ok = await ask(on
      ? { title: 'Stop requiring approval for every invoice?', body: 'Workflows and people with "Issue invoices" can then issue invoices without anyone approving them first. Steps that have their own approval still ask for it.', confirm: 'Stop requiring approval', danger: true }
      : { title: 'Require approval for every invoice?', body: 'Every invoice will need an approval before it is issued, including invoices issued by workflows in Automatic mode. People who can approve invoices are asked.', confirm: 'Require approval' });
    if (!ok) return;
    await patch(`/c/${c.cid}/settings`, { invoiceApprovalRequired: !on });
    qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: [c.cid] });
    toast(on ? 'Invoices no longer need approval by default' : 'Every invoice now needs approval before it is issued');
  });
  return (
    <div className="stack-sm" style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
      <h3 style={{ margin: 0 }}>Approval before issuing</h3>
      <ErrorSummary error={s.error} />
      <p className="muted" style={{ margin: 0 }}>{on ? 'On: every invoice needs an approval before it is issued, whoever or whatever issues it. In Automatic mode, Rigo asks the people who can approve invoices.' : 'Off: invoices can be issued without an approval, unless a workflow step asks for one.'}</p>
      <div><Button variant={on ? 'danger' : 'primary'} busy={s.busy} onClick={() => s.run()}>{on ? 'Stop requiring approval' : 'Require approval for every invoice'}</Button></div>
      {node}
    </div>
  );
}

export function SettingsPage() {
  const c = useCompany();
  const qc = useQueryClient();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') ?? 'company') as 'company' | 'invoices' | 'branding' | 'fields' | 'services';
  const [v, setV] = useState({ name: c.company.name, timezone: c.company.timezone, currency: c.company.currency, phone: c.company.phone ?? '', email: c.company.email ?? '', address: c.company.address ?? '', serviceCategories: c.company.service_categories,
    invoiceDueDays: c.company.invoiceDueDays ?? 30, paymentInstructions: c.company.paymentInstructions ?? '' });
  const [savedDetails, setSavedDetails] = useState(() => JSON.stringify(v));
  const s = useSubmit(async () => {
    const { invoiceDueDays: _d, paymentInstructions: _p, ...details } = v;
    await patch(`/c/${c.cid}/settings`, details); setSavedDetails(JSON.stringify(v)); qc.invalidateQueries({ queryKey: [c.cid] }); qc.invalidateQueries({ queryKey: ['me'] }); toast('Company details saved');
  });
  // One guard for the page: any section with unsaved changes asks before leaving or switching tabs (R11-m2).
  const dirt = useDirtySet();
  useReportDirty(dirt.report, 'company', JSON.stringify(v) !== savedDetails);
  const guard = useUnsavedGuard(dirt.any, { message: 'Some settings are not saved. Leave without saving?' });
  return (
    <div className="page page-narrow">
      <PageHeader title="Settings" sub={c.company.name} />
      <Tabs label="Settings sections" value={tab} onChange={(k) => setSp({ tab: k })} tabs={[{ key: 'company', label: 'Company' }, { key: 'invoices', label: 'Invoices' }, { key: 'branding', label: 'Branding' }, { key: 'fields', label: 'Custom fields' }, { key: 'services', label: 'Connected services' }]} />
      {tab === 'company' && (
        <Card id="co" title="Company details">
          <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); s.run(); }}>
            <ErrorSummary error={s.error} />
            <Field label="Company name" id="f-name" error={s.fieldError('name')}>{(p) => <Input {...p} maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
            <div className="grid-2">
              <Field label="Phone" optionalText id="f-phone">{(p) => <Input {...p} maxLength={40} type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />}</Field>
              <Field label="Email" optionalText id="f-email">{(p) => <Input {...p} maxLength={254} type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
            </div>
            <Field label="Address" optionalText id="f-address" hint="Shown on invoices.">{(p) => <Input {...p} maxLength={300} value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />}</Field>
            <div className="grid-2">
              <Field label="Time zone" id="f-timezone" hint="Schedules, late jobs and due dates use this." error={s.fieldError('timezone')}>{(p) => <TimezoneSelect {...p} value={v.timezone} onChange={(tz) => setV({ ...v, timezone: tz })} />}</Field>
              <Field label="Currency" id="f-currency">{(p) => <Select {...p} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })}>{CURRENCIES.map((x) => <option key={x}>{x}</option>)}</Select>}</Field>
            </div>
            <fieldset><legend>Service types</legend>{Object.entries(SERVICE_CATEGORIES).map(([k, l]) => <Checkbox key={k} label={l} checked={v.serviceCategories.includes(k)} onChange={(e) => setV({ ...v, serviceCategories: e.target.checked ? [...v.serviceCategories, k] : v.serviceCategories.filter((x) => x !== k) })} />)}</fieldset>
            <div><Button type="submit" variant="primary" busy={s.busy}>Save</Button></div>
          </form>
        </Card>
      )}
      {tab === 'invoices' && <InvoiceSettings onDirty={dirt.report} />}
      {tab === 'branding' && <Branding onDirty={dirt.report} />}
      {tab === 'fields' && <CustomFieldsEditor onDirty={dirt.report} />}
      {guard}
      {tab === 'services' && <Card id="caps" title="Connected services"><p className="muted">These services stay off until they are set up for Rigo. Creating a company is free, and Rigo does not bill you yet.</p><CapabilityList /></Card>}
    </div>
  );
}
