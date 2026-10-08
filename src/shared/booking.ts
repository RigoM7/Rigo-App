import { zonedToUtc, addDays, weekday } from './schedule.js';
import type { BusinessHours } from './hours.js';

// The public booking page: its address and the times people can pick.

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
export const RESERVED_SLUGS = ['api', 'admin', 'rigo', 'demo', 'signin', 'signup', 'new', 'book', 'help', 'support', 'www', 'app'];

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Start times (ISO, UTC) people can book: every `slotMinutes` within the hours on open days, from
 * `from` for `days` days, where fewer than `capacity` pieces of work already overlap the slot.
 */
export function bookingSlots(o: { from: string; days: number; hours: BusinessHours; slotMinutes: number; timeZone: string; capacity: number; taken: { start: string; end: string | null }[] }) {
  const out: string[] = [];
  const taken = o.taken.map((t) => ({ s: Date.parse(t.start), e: t.end ? Date.parse(t.end) : Date.parse(t.start) + o.slotMinutes * 60000 }));
  for (let i = 0; i < o.days; i++) {
    const day = addDays(o.from, i);
    if (!o.hours.days.includes(weekday(day))) continue;
    for (let m = toMin(o.hours.start); m + o.slotMinutes <= toMin(o.hours.end); m += o.slotMinutes) {
      const s = zonedToUtc(day, toTime(m), o.timeZone).getTime();
      const e = s + o.slotMinutes * 60000;
      const busy = taken.filter((t) => t.s < e && t.e > s).length;
      if (busy < o.capacity) out.push(new Date(s).toISOString());
    }
  }
  return out;
}
