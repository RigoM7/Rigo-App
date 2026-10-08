import { formatMoney } from '../../shared/money';
export { formatMoney, parseMoney, minorToInput, formatRate, rateToInput } from '../../shared/money';

// Dates and times always in the workspace's time zone, never the device's.

export function fmtDateTime(iso: string | null | undefined, tz?: string) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso));
}
export function fmtDate(iso: string | null | undefined, tz?: string) {
  if (!iso) return '—';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = dateOnly ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: dateOnly ? 'UTC' : tz }).format(d);
}
export function fmtDay(iso: string, tz?: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }).format(new Date(iso));
}
export function fmtTime(iso: string | null | undefined, tz?: string) {
  if (!iso) return 'Any time';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso));
}
export function relTime(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
/** "2030-01-07" in the workspace's zone for a moment. */
export function dayKey(iso: string | Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
/** Hours and minutes past midnight in the workspace's zone. */
export function minutesOfDay(iso: string, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
}
/** Value for <input type="datetime-local"> in the workspace's zone. */
export function toLocalInput(iso: string | null | undefined, tz: string) {
  if (!iso) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function money(minor: number | null | undefined, currency = 'USD') { return formatMoney(minor, currency); }
export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}
/** "Open in Maps": Apple Maps on Apple devices, Google Maps elsewhere. A link only; no key. */
export function mapsUrl(address: string) {
  const q = encodeURIComponent(address);
  const apple = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
  return apple ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
