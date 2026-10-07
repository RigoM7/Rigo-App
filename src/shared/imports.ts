import { fold } from './customers.js';

// Rules for reading a customer or equipment file (R16): text encoding, address columns, names,
// phone numbers, equipment types and which rows are the same customer. Shared by the browser
// (decoding) and the server (review and commit).

export type Encoding = 'utf-8' | 'windows-1252';

/**
 * Read a file's bytes as text. UTF-8 when the bytes are valid UTF-8, otherwise Windows-1252 (what
 * Excel on Windows saves as "CSV"), so "Núñez" never turns into "N��ez" (R16-M1). A byte-order
 * mark is removed. `replaced` says whether the text still has unreadable characters.
 */
export function decodeBytes(bytes: Uint8Array, prefer: Encoding | 'auto' = 'auto'): { text: string; encoding: Encoding; replaced: boolean } {
  let encoding: Encoding = prefer === 'auto' ? 'utf-8' : prefer;
  let text: string;
  if (prefer === 'auto') {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { encoding = 'windows-1252'; text = new TextDecoder('windows-1252').decode(bytes); }
  } else text = new TextDecoder(encoding).decode(bytes);
  text = text.replace(/^﻿/, '');
  return { text, encoding, replaced: text.includes('�') };
}

// NUL and the other control characters (tab and line breaks are kept) break storage and display (R16-m2).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
export function cleanCell(s: string): { value: string; changed: boolean } {
  const value = s.replace(CONTROL, '');
  return { value, changed: value.length !== s.length };
}

/** "12 Quarry Rd", "Unit 4", "Millbrook", "TX", "75001" → "12 Quarry Rd, Unit 4, Millbrook, TX 75001". */
export function combineAddress(p: { street?: string; line2?: string; city?: string; state?: string; zip?: string }) {
  const tidy = (s?: string) => (s ?? '').trim().replace(/\s+/g, ' ').replace(/,+$/, '');
  const region = [tidy(p.state), tidy(p.zip)].filter(Boolean).join(' ');
  return [tidy(p.street), tidy(p.line2), tidy(p.city), region].filter(Boolean).join(', ');
}

const ABBREV: [RegExp, string][] = [
  [/\bstreet\b/g, 'st'], [/\broad\b/g, 'rd'], [/\bavenue\b/g, 'ave'], [/\blane\b/g, 'ln'], [/\bdrive\b/g, 'dr'], [/\bcourt\b/g, 'ct'],
  [/\bboulevard\b/g, 'blvd'], [/\bhighway\b/g, 'hwy'], [/\bcounty road\b/g, 'county rd'], [/\bplace\b/g, 'pl'], [/\bparkway\b/g, 'pkwy'],
  [/\bnorth\b/g, 'n'], [/\bsouth\b/g, 's'], [/\beast\b/g, 'e'], [/\bwest\b/g, 'w'], [/\bsuite\b/g, 'ste'], [/\bapartment\b/g, 'apt'],
];
/** Two ways of writing the same address compare equal ("12 Quarry Road" = "12 quarry rd."). */
export function addressKey(a: string) {
  let s = fold(a).replace(/[.,#]/g, ' ');
  for (const [re, to] of ABBREV) s = s.replace(re, to);
  return s.replace(/\s+/g, ' ').trim();
}

/** Phone digits for matching: "(555) 201-0003" and "1-555-201-0003" are the same number. */
export function phoneDigits(p: string | null | undefined) {
  const d = (p ?? '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
}
/** A 10-digit number shown one way: (555) 201-0003. Anything else is kept as written. */
export function formatPhone(p: string | null | undefined) {
  const raw = (p ?? '').trim();
  const d = phoneDigits(raw);
  if (raw.startsWith('+') && !raw.startsWith('+1')) return raw;
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
}

const COMPANY_WORDS = /\b(llc|inc|co|corp|ltd|company|farms?|church|construction|services?|group|associates|partners|and|&)\b/i;
/** "Núñez, José" looks like Last, First; "Smith, Jones & Co" doesn't. */
export function isLastFirst(name: string) {
  const m = /^\s*([^,]+),\s*([^,]+)$/.exec(name);
  if (!m || COMPANY_WORDS.test(name)) return false;
  const words = (s: string) => s.trim().split(/\s+/).length;
  return words(m[1]) <= 2 && words(m[2]) <= 3 && !/\d/.test(name);
}
export function flipName(name: string) {
  const m = /^\s*([^,]+),\s*([^,]+)$/.exec(name);
  return m ? `${m[2].trim()} ${m[1].trim()}` : name;
}

/** Common words for equipment types (R16-m1): what a vac truck, tank wagon or hand-wash station is. */
const KIND_WORDS: [RegExp, 'truck' | 'equipment' | 'unit'][] = [
  [/\b(portable toilets?|porta[- ]?(john|potty|let)s?|restrooms?|toilets?|hand[- ]?wash(ing)?( stations?)?|sinks?|units?|ada|showers?)\b/, 'unit'],
  [/\b(trailers?|tank wagons?|wagons?|tanks?|pumps?|generators?|equipment|hoses?|reels?|skids?|totes?)\b/, 'equipment'],
  [/\b(trucks?|vac(uum)?( trucks?)?|pump(er)? trucks?|tankers?|bobtails?|vehicles?|vans?|pickups?|lorr(y|ies)|service trucks?)\b/, 'truck'],
];
export function resourceKind(value: string): { kind: 'truck' | 'equipment' | 'unit' | null; exact: boolean } {
  const v = fold(value).trim();
  if (v === 'truck' || v === 'equipment' || v === 'unit') return { kind: v, exact: true };
  // Truck words win when both appear ("vac truck", "pump truck").
  if (KIND_WORDS[2][0].test(v)) return { kind: 'truck', exact: false };
  for (const [re, kind] of KIND_WORDS) if (re.test(v)) return { kind, exact: false };
  return { kind: null, exact: false };
}

export const KIND_LABELS = { truck: 'Truck', equipment: 'Equipment', unit: 'Unit' } as const;

/**
 * Two customer rows are the same customer only when the names match and the email or the phone
 * matches too (R16-M3). Two different people called John Smith stay two customers.
 */
export function sameCustomer(a: { name?: string; email?: string | null; phone?: string | null }, b: { name?: string; email?: string | null; phone?: string | null }) {
  if (!a.name || !b.name || fold(a.name).trim() !== fold(b.name).trim()) return false;
  const ea = (a.email ?? '').trim().toLowerCase(), eb = (b.email ?? '').trim().toLowerCase();
  const pa = phoneDigits(a.phone), pb = phoneDigits(b.phone);
  return (!!ea && ea === eb) || (pa.length >= 7 && pa === pb);
}
