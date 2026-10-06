export { formatMoney, parseMoney, minorToInput } from '../../shared/billing.js';

export function fmtDateTime(iso: string | null | undefined, tz?: string) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(iso));
}
export function fmtDate(iso: string | null | undefined, tz?: string) {
  if (!iso) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: /^\d{4}-\d{2}-\d{2}$/.test(iso) ? 'UTC' : tz }).format(d);
}
export function fmtTime(iso: string | null | undefined, tz?: string) {
  if (!iso) return 'No time set';
  return new Intl.DateTimeFormat(undefined, { timeStyle: 'short', timeZone: tz }).format(new Date(iso));
}
export function relTime(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
/** Value for <input type="datetime-local"> in the company time zone. */
export function toLocalInput(iso: string | null | undefined, tz: string) {
  if (!iso) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function titleCase(s: string) { return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()); }
