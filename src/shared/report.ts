import { fieldApplies, type FieldDef } from './services.js';
import { translate, plural, type Lang, type MessageKey } from './i18n/index.js';

// The job report (R6-M4): what the driver recorded, in the order the service lists it, for the printed
// report and the prepared customer email. Fields that don't apply to the visit are left out.

export interface ReportLine { label: string; value: string }

function show(f: FieldDef, v: unknown) {
  if (f.type === 'boolean') return v === true || v === 'true' ? 'Yes' : 'No';
  return `${String(v)}${f.unit ? ` ${f.unit}` : ''}`;
}

export function reportLines(fields: FieldDef[], details: Record<string, unknown> | null | undefined, values: Record<string, unknown> | null | undefined) {
  const all = { ...(details ?? {}), ...(values ?? {}) };
  const request: ReportLine[] = [];
  const findings: ReportLine[] = [];
  for (const f of fields) {
    if (!fieldApplies(f, all)) continue;
    const v = f.stage === 'request' ? details?.[f.key] : values?.[f.key] ?? (f.stage === 'both' ? details?.[f.key] : undefined);
    if (v === undefined || v === null || v === '') continue;
    // Booleans left unticked are findings too ("No"), but only once the driver recorded the visit.
    (f.stage === 'request' ? request : findings).push({ label: f.label, value: show(f, v) });
  }
  return { request, findings };
}

/** Plain text for the prepared email, in the customer's language (D8). */
export function reportText(o: { company: string; companyPhone?: string | null; customer: string; jobNumber: number; serviceName: string; address: string | null; date: string; outcome: string; request: ReportLine[]; findings: ReportLine[]; notes: string; photoCount: number; signer?: string | null;
  deliveries?: { product: string; quantity: string; tank?: string; ticket?: string }[]; unit?: string }, lang: Lang = 'en') {
  const t = (k: MessageKey, v?: Record<string, string | number>) => translate(lang, k, v);
  return [
    t('customer.hello', { name: o.customer }), '',
    t('cm.reportLead', { number: o.jobNumber, service: o.serviceName, at: o.address ? t('customer.at', { address: o.address }) : '', date: o.date }), '',
    t('cm.outcome', { text: o.outcome }),
    ...o.request.map((l) => `${l.label}: ${l.value}`),
    ...(o.deliveries?.length ? ['', t('cm.delivered'), ...o.deliveries.map((d) => `- ${d.product}: ${d.quantity}${o.unit ? ` ${o.unit}` : ''}${d.tank ? `, ${d.tank}` : ''}${d.ticket ? t('cm.ticket', { n: d.ticket }) : ''}`)] : []),
    ...(o.findings.length ? ['', t('cm.findings'), ...o.findings.map((l) => `- ${l.label}: ${l.value}`)] : []),
    ...(o.notes ? ['', t('cm.notes'), o.notes] : []),
    ...(o.photoCount ? ['', plural(lang, 'cm.photos', o.photoCount)] : []),
    ...(o.signer ? ['', t('cm.signedBy', { name: o.signer })] : []),
    '', t('cm.thankYou'), o.company, ...(o.companyPhone ? [o.companyPhone] : []),
  ].join('\n');
}
