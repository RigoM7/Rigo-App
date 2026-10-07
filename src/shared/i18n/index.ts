import { en, type MessageKey } from './en.js';
import { es, esPhrases } from './es.js';

// Words people read, in their language (R4-M5, D8). English is complete; any key missing from
// another language falls back to English. Spanish is marked "needs review by a Spanish speaker"
// in docs/IMPLEMENTATION-STATUS.md.

export const LANGS = { en: 'English', es: 'Español' } as const;
export type Lang = keyof typeof LANGS;
export type { MessageKey };
export type Vars = Record<string, string | number>;

const DICTS: Record<Lang, Partial<Record<MessageKey, string>>> = { en, es };

export const isLang = (v: unknown): v is Lang => v === 'en' || v === 'es';

/** The person's choice, else the device's language when it's one we have, else English. */
export function pickLang(choice: string | null | undefined, device?: string | readonly string[] | null): Lang {
  if (isLang(choice)) return choice;
  const list = Array.isArray(device) ? device : device ? [device as string] : [];
  for (const d of list) { const base = String(d).toLowerCase().split('-')[0]; if (isLang(base)) return base; }
  return 'en';
}

/** The locale for dates and numbers (US formats, in the person's language). */
export const localeOf = (lang: Lang) => (lang === 'es' ? 'es-US' : 'en-US');

export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const raw = DICTS[lang][key] ?? en[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k]))) : raw;
}

/** "1 record" / "3 records": keys ending in `.one` and `.other`. */
export function plural(lang: Lang, base: string, n: number, vars: Vars = {}) {
  return translate(lang, `${base}.${n === 1 ? 'one' : 'other'}` as MessageKey, { n, ...vars });
}

/**
 * Sentences built elsewhere in English (validation messages from the shared rules, messages from
 * the server) shown in the person's language when we know them; anything else stays as written.
 */
export function phrase(lang: Lang, text: string | null | undefined): string {
  if (!text || lang === 'en') return text ?? '';
  for (const [re, to] of lang === 'es' ? esPhrases : []) {
    const m = re.exec(text);
    if (m) return typeof to === 'string' ? to : to(m);
  }
  return text;
}

export function makeT(lang: Lang) {
  const t = (key: MessageKey, vars?: Vars) => translate(lang, key, vars);
  return Object.assign(t, { lang, locale: localeOf(lang), plural: (base: string, n: number, vars?: Vars) => plural(lang, base, n, vars), phrase: (s: string | null | undefined) => phrase(lang, s) });
}
export type T = ReturnType<typeof makeT>;
