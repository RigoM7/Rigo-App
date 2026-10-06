// Customer rules shared by the server and the screens: search normalization, duplicate detection,
// and the default label for a first location (R5-M1, R5-m1, R5-m5).

const FROM = 'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūñçýÿšžłđ';
const TO = 'aaaaaaaeeeeeiiiiiooooooouuuuuncyyszld';

/** Lower case without accents ("José Núñez" → "jose nunez"); the same as rigo.fold() in the database. */
export function fold(s: string | null | undefined) {
  let out = '';
  for (const ch of (s ?? '').toLowerCase()) { const i = FROM.indexOf(ch); out += i >= 0 ? TO[i] : ch; }
  return out;
}

/** Only the digits of a phone number; the same as rigo.digits() in the database. */
export const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/** A name compared loosely: no accents, punctuation, extra spaces or company suffixes. */
export function nameKey(s: string | null | undefined) {
  return fold(s).replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(inc|llc|ltd|co|corp|company|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Edit distance, capped (enough to catch a typo or two). */
function distance(a: string, b: string, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

export function similarNames(a: string, b: string) {
  const x = nameKey(a), y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 6 && y.length >= 6 && (x.includes(y) || y.includes(x))) return true;
  return x.length >= 6 && distance(x, y, 2) <= 2;
}

/**
 * A search that tolerates a typo (R5-m1): every word typed is close to a word of the name ("Okafr"
 * finds Grace Okafor, "nunes" finds José Núñez). Used when the plain search finds nothing.
 */
export function looselyMatches(name: string, query: string) {
  const words = nameKey(name).split(' ').filter(Boolean);
  const typed = nameKey(query).split(' ').filter((w) => w.length >= 3);
  if (!typed.length || !words.length) return false;
  return typed.every((t) => words.some((w) => w.startsWith(t) || distance(t, w.slice(0, Math.max(t.length, Math.min(w.length, t.length + 1))), 2) <= (t.length >= 6 ? 2 : 1)));
}

/** The street part of an address ("812 Willow Ln, Fairview" → "812 Willow Ln"), used to label a first location. */
export function streetLabel(address: string) {
  return address.split(',')[0].trim().slice(0, 80);
}

/** The town of an address (the part after the first comma), for pickers. */
export function townOf(address: string | null | undefined) {
  const parts = (address ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts[1] : '';
}

export interface CustomerLike { name: string; email?: string | null; phone?: string | null; addresses?: string[] }

/** Why two customers look like the same one, in plain words; empty when they don't. */
export function duplicateReasons(a: CustomerLike, b: CustomerLike) {
  const out: string[] = [];
  if (nameKey(a.name) && nameKey(a.name) === nameKey(b.name)) out.push('Same name');
  else if (similarNames(a.name, b.name)) out.push('Similar name');
  if (a.email && b.email && a.email.trim().toLowerCase() === b.email.trim().toLowerCase()) out.push('Same email');
  const pa = digits(a.phone), pb = digits(b.phone);
  if (pa.length >= 7 && pb.length >= 7 && pa.slice(-10) === pb.slice(-10)) out.push('Same phone');
  const addr = (s: string) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
  if ((a.addresses ?? []).some((x) => (b.addresses ?? []).some((y) => addr(x) && addr(x) === addr(y)))) out.push('Same address');
  return out;
}

/** "54", "#54", "job 54" → 54: a search for a job number. */
export function jobNumberQuery(q: string) {
  const m = /^\s*(?:job\s*)?#?\s*(\d{1,7})\s*$/i.exec(q);
  return m ? Number(m[1]) : null;
}
