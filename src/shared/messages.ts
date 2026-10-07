// The words of a customer update about a job (R15-M2). Live updates ("on the way", "started") have
// a short form for a text message; every form names the company so the customer knows who it is.

export interface JobForUpdate {
  number: number; status: string; customer_name: string | null; company_name: string; service_name: string | null; address: string | null;
  driver_name: string | null; en_route_at: string | null; en_route_eta_minutes: number | null;
}

export function jobUpdateText(j: JobForUpdate, extra?: string) {
  const hello = j.customer_name ? `Hello ${j.customer_name},` : 'Hello,';
  const service = (j.service_name ?? 'service').toLowerCase();
  const at = j.address ? ` at ${j.address}` : '';
  const driver = j.driver_name?.trim().split(/\s+/)[0] || 'Our driver';
  const note = extra?.trim() ? ` ${extra.trim()}` : '';
  if (j.status === 'open' && j.en_route_at) {
    const eta = j.en_route_eta_minutes ? `, arriving in about ${j.en_route_eta_minutes} minute${j.en_route_eta_minutes === 1 ? '' : 's'}` : '';
    const short = `${j.company_name}: ${driver} is on the way for your ${service}${at}${eta}.${note}`;
    return { live: true, what: 'On-the-way update', subject: `${j.company_name}: ${driver} is on the way`, short, body: `${hello}\n\n${driver} from ${j.company_name} is on the way for your ${service}${at}${eta}.${note}\n\n${j.company_name}` };
  }
  if (j.status === 'in_progress') {
    const short = `${j.company_name}: ${driver} has started your ${service}${at}.${note}`;
    return { live: true, what: 'Started update', subject: `${j.company_name}: your ${service} has started`, short, body: `${hello}\n\n${driver} from ${j.company_name} has started your ${service}${at}.${note}\n\n${j.company_name}` };
  }
  const outcome = j.status === 'unsuccessful' ? 'we were not able to complete the visit' : j.status === 'partial' ? 'we completed part of the visit' : 'the visit is complete';
  const body = `${hello}\n\nAn update on job #${j.number}: ${outcome}.${note}\n\nWe will follow up with next steps.\n\n${j.company_name}`;
  return { live: false, what: 'Customer update', subject: `${j.company_name}: update on your service`, short: `${j.company_name}: an update on job #${j.number}: ${outcome}.${note}`, body };
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
