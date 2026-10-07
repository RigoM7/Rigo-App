import { translate, localeOf, type Lang, type MessageKey, type Vars } from './i18n/index.js';
import { localDate } from './schedule.js';

// What the office changed on a driver's job, kept as words to translate rather than finished
// sentences, so the phone shows them in the driver's language (D8). `text` is the English line.

export interface ChangeItem { k: MessageKey; v?: Vars; from?: string | null; to?: string | null }

/** One change in a language, with times in the company's time zone. */
export function changeText(lang: Lang, tz: string, item: ChangeItem): string {
  if (item.k === 'notice.moved' || item.k === 'notice.movedSameDay') {
    const locale = localeOf(lang);
    const fmt = (iso: string | null | undefined, timeOnly: boolean) => (iso ? new Intl.DateTimeFormat(locale, timeOnly ? { hour: 'numeric', minute: '2-digit', timeZone: tz } : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso)) : translate(lang, 'notice.noTime'));
    const sameDay = item.k === 'notice.movedSameDay';
    return translate(lang, item.k, { from: fmt(item.from, sameDay), to: fmt(item.to, sameDay) });
  }
  return translate(lang, item.k, item.v);
}

/** What changed between two versions of a job, as items (R11-M2, R6-M1). */
export function changeItems(before: any, after: any, tz: string, addresses: { before: string | null; after: string | null } = { before: null, after: null }): ChangeItem[] {
  const items: ChangeItem[] = [];
  // Times may arrive as Date objects or strings: compare the moment, not the object.
  const ms = (v: unknown) => (v ? new Date(v as string).getTime() : null);
  if (ms(before.scheduled_start) !== ms(after.scheduled_start)) {
    const sameDay = !!before.scheduled_start && !!after.scheduled_start && localDate(new Date(before.scheduled_start), tz) === localDate(new Date(after.scheduled_start), tz);
    const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
    items.push({ k: sameDay ? 'notice.movedSameDay' : 'notice.moved', from: iso(before.scheduled_start), to: iso(after.scheduled_start) });
  }
  if (before.location_id !== after.location_id || (addresses.before && addresses.after && addresses.before !== addresses.after)) items.push(addresses.after ? { k: 'notice.newAddress', v: { address: addresses.after } } : { k: 'notice.newAddressSeeJob' });
  if ((before.access_instructions ?? '') !== (after.access_instructions ?? '')) items.push(after.access_instructions ? { k: 'notice.newAccess', v: { text: after.access_instructions } } : { k: 'notice.accessRemoved' });
  if ((before.contact_name ?? '') !== (after.contact_name ?? '') || (before.contact_phone ?? '') !== (after.contact_phone ?? '')) {
    const text = [after.contact_name, after.contact_phone].filter(Boolean).join(', ');
    items.push(text ? { k: 'notice.newContact', v: { text } } : { k: 'notice.contactRemoved' });
  }
  if ((before.notes ?? '') !== (after.notes ?? '')) items.push({ k: 'notice.notesChanged' });
  if (before.priority !== after.priority && after.priority === 'emergency') items.push({ k: 'notice.nowEmergency' });
  else if (before.priority !== after.priority && after.priority === 'urgent') items.push({ k: 'notice.nowUrgent' });
  return items;
}
