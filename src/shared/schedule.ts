// Time-zone aware date helpers built on Intl (no external tz database required).

export function zonedParts(date: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second };
}

/** Convert a wall-clock date + time in a time zone into a UTC Date. */
export function zonedToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '08:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes handle DST transitions.
  let ts = guess;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(ts), timeZone);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    ts = ts + (guess - asUtc);
  }
  return new Date(ts);
}

export function localDate(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function addDays(dateStr: string, n: number) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function weekday(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}

export interface VisitRule { frequency: 'daily' | 'weekly' | 'monthly'; interval: number; weekdays: number[]; dayOfMonth?: number; time: string; durationMinutes: number }

/** Occurrence dates in [from, to] for a plan starting on startsOn. Pure and deterministic. */
export function occurrences(rule: VisitRule, startsOn: string, endsOn: string | null, from: string, to: string): string[] {
  const out: string[] = [];
  const last = endsOn && endsOn < to ? endsOn : to;
  let cur = startsOn > from ? startsOn : from;
  const interval = Math.max(1, rule.interval || 1);
  const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  let guard = 0;
  while (cur <= last && guard++ < 800) {
    const diff = daysBetween(startsOn, cur);
    let hit = false;
    if (rule.frequency === 'daily') hit = diff % interval === 0;
    else if (rule.frequency === 'weekly') {
      const week = Math.floor(diff / 7);
      const days = rule.weekdays?.length ? rule.weekdays : [weekday(startsOn)];
      hit = week % interval === 0 && days.includes(weekday(cur));
    } else if (rule.frequency === 'monthly') {
      const dom = rule.dayOfMonth ?? Number(startsOn.slice(8, 10));
      const months = (Number(cur.slice(0, 4)) - Number(startsOn.slice(0, 4))) * 12 + Number(cur.slice(5, 7)) - Number(startsOn.slice(5, 7));
      const [y, m] = cur.split('-').map(Number);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      hit = months % interval === 0 && Number(cur.slice(8, 10)) === Math.min(dom, lastDay);
    }
    if (hit) out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** Billing periods (start dates) that have fully started by `asOf`, independent of visit frequency. */
export function billingPeriods(frequency: 'none' | 'per_visit' | 'weekly' | 'monthly', startsOn: string, endsOn: string | null, after: string | null, asOf: string) {
  if (frequency === 'none' || frequency === 'per_visit') return [];
  const out: { start: string; end: string }[] = [];
  let start = startsOn;
  let guard = 0;
  while (start <= asOf && guard++ < 400) {
    let next: string;
    if (frequency === 'weekly') next = addDays(start, 7);
    else {
      const [y, m, d] = start.split('-').map(Number);
      next = new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
    }
    const end = addDays(next, -1);
    if ((!after || start > after) && (!endsOn || start <= endsOn)) out.push({ start, end: endsOn && endsOn < end ? endsOn : end });
    start = next;
  }
  return out;
}
