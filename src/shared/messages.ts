import { translate, plural, type Lang, type MessageKey } from './i18n/index.js';

// The words of a customer update about a job (R15-M2). Live updates ("on the way", "started") have
// a short form for a text message; every form names the company so the customer knows who it is.

export interface JobForUpdate {
  number: number; status: string; customer_name: string | null; company_name: string; service_name: string | null; address: string | null;
  driver_name: string | null; en_route_at: string | null; en_route_eta_minutes: number | null;
}

/** The update in the customer's language (D8). */
export function jobUpdateText(j: JobForUpdate, extra?: string, lang: Lang = 'en') {
  const t = (k: MessageKey, v?: Record<string, string | number>) => translate(lang, k, v);
  const hello = j.customer_name ? t('customer.hello', { name: j.customer_name }) : t('customer.helloPlain');
  const service = (j.service_name ?? t('customer.service')).toLowerCase();
  const at = j.address ? t('customer.at', { address: j.address }) : '';
  const driver = j.driver_name?.trim().split(/\s+/)[0] || t('customer.ourDriver');
  const note = extra?.trim() ? ` ${extra.trim()}` : '';
  const company = j.company_name;
  const v = { company, driver, service, at, note };
  if (j.status === 'open' && j.en_route_at) {
    const eta = j.en_route_eta_minutes ? plural(lang, 'customer.eta', j.en_route_eta_minutes) : '';
    return { live: true, what: 'On-the-way update', subject: t('customer.onWaySubject', v), short: t('customer.onWayShort', { ...v, eta }), body: `${hello}\n\n${t('customer.onWayBody', { ...v, eta })}\n\n${company}` };
  }
  if (j.status === 'in_progress') {
    return { live: true, what: 'Started update', subject: t('customer.startedSubject', v), short: t('customer.startedShort', v), body: `${hello}\n\n${t('customer.startedBody', v)}\n\n${company}` };
  }
  const outcome = t(j.status === 'unsuccessful' ? 'customer.outcome.unsuccessful' : j.status === 'partial' ? 'customer.outcome.partial' : 'customer.outcome.completed');
  const body = `${hello}\n\n${t('customer.updateBody', { number: j.number, outcome, note })}\n\n${t('customer.followUp')}\n\n${company}`;
  return { live: false, what: 'Customer update', subject: t('customer.updateSubject', { company }), short: t('customer.updateShort', { company, number: j.number, outcome, note }), body };
}

/** A phone number as a text service needs it (+15552010003). US/Canada 10-digit numbers get +1;
 * anything else written with a leading + is kept; otherwise the number is left as typed. */
export function textNumber(phone: string | null | undefined) {
  const raw = (phone ?? '').trim();
  const d = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && d.length >= 8) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return raw;
}
