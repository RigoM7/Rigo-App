export { formatMoney, parseMoney, minorToInput } from '../../shared/billing.js';

export function fmtDateTime(iso: string | null | undefined, tz?: string) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(iso));
}
// `locale` (optional): the person's language on translated screens (D8); dates stay in the company's time zone.
export function fmtDate(iso: string | null | undefined, tz?: string, locale?: string) {
  if (!iso) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: /^\d{4}-\d{2}-\d{2}$/.test(iso) ? 'UTC' : tz }).format(d);
}
export function fmtTime(iso: string | null | undefined, tz?: string, locale?: string) {
  if (!iso) return 'No time set';
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: tz }).format(new Date(iso));
}
export function relTime(iso: string, locale?: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (locale && !locale.startsWith('en')) {
    const r = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
    return s < 60 ? r.format(0, 'second') : s < 3600 ? r.format(-Math.floor(s / 60), 'minute') : s < 86400 ? r.format(-Math.floor(s / 3600), 'hour') : r.format(-Math.floor(s / 86400), 'day');
  }
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
/**
 * When a start time moves, move the end by the same amount so the job keeps its length
 * (datetime-local values, "2026-10-06T09:00"). An empty end or start stays as it is.
 */
export function shiftEnd(oldStart: string, oldEnd: string, newStart: string) {
  if (!oldStart || !oldEnd || !newStart) return oldEnd;
  const ms = (s: string) => Date.parse(`${s}:00Z`);
  const len = ms(oldEnd) - ms(oldStart);
  if (!Number.isFinite(len) || len <= 0 || !Number.isFinite(ms(newStart))) return oldEnd;
  return new Date(ms(newStart) + len).toISOString().slice(0, 16);
}

/**
 * "Open in Maps" for an address (R9-M3, D9): Apple Maps on iPhone and iPad, Google Maps elsewhere
 * (it opens the Maps app on Android). A link only; no key, no embedded map.
 */
export function mapsUrl(address: string) {
  const q = encodeURIComponent(address);
  const apple = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in (globalThis as any).document;
  return apple ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}
