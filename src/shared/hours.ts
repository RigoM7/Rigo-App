import { z } from 'zod';
import { zonedParts } from './schedule.js';

// Business hours (D16): set by the owner in setup and Settings. A visit outside them is an
// after-hours visit. Until hours are set, nothing is marked after-hours automatically.

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 07:00');
export const businessHoursSchema = z.object({
  /** 0 = Sunday … 6 = Saturday. */
  days: z.array(z.number().int().min(0).max(6)).max(7),
  start: hhmm,
  end: hhmm,
}).refine((h) => h.end > h.start, { message: 'The day must end after it starts', path: ['end'] });
export type BusinessHours = z.infer<typeof businessHoursSchema>;

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Whether a visit starting at this moment falls outside business hours, in the company's time zone. */
export function isAfterHours(startIso: string, timeZone: string, hours: BusinessHours | null | undefined) {
  if (!hours) return false;
  const d = new Date(startIso);
  const p = zonedParts(d, timeZone);
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  const t = `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`;
  return !hours.days.includes(day) || t < hours.start || t >= hours.end;
}

/** "Mon–Fri, 7:00 AM – 5:00 PM" */
export function hoursText(h: BusinessHours) {
  const fmt = (t: string) => { const [H, M] = t.split(':').map(Number); return `${((H + 11) % 12) + 1}:${String(M).padStart(2, '0')} ${H < 12 ? 'AM' : 'PM'}`; };
  const days = [...h.days].sort();
  const runs: string[] = [];
  for (let i = 0; i < days.length; i++) {
    let j = i;
    while (j + 1 < days.length && days[j + 1] === days[j] + 1) j++;
    runs.push(j > i ? `${DAY_NAMES[days[i]].slice(0, 3)}–${DAY_NAMES[days[j]].slice(0, 3)}` : DAY_NAMES[days[i]].slice(0, 3));
    i = j;
  }
  return `${runs.join(', ') || 'No days'}, ${fmt(h.start)} – ${fmt(h.end)}`;
}
