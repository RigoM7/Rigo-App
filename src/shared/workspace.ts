import { z } from 'zod';
import { ALL_PERMISSIONS, type Permission, type RoleApp } from './permissions.js';

// The workspace model shared by the server (validation) and the screens: the workspace's own words,
// its record types and custom fields, owner-built stages tagged with a meaning, and its roles.
// Owners set all of this up as validated data, never as code (PRODUCT.md, rule 4).

// ---------------------------------------------------------------- words

const wordText = z.string().trim().min(1, 'Enter a word').max(30, 'Use 30 characters or fewer.');
export const wordSchema = z.object({ one: wordText, many: wordText });
export type Word = z.infer<typeof wordSchema>;

/** The things every workspace names its own way. */
export const WORD_KEYS = ['work', 'customer', 'person', 'equipment', 'location'] as const;
export type WordKey = (typeof WORD_KEYS)[number];
export const vocabularySchema = z.object({
  work: wordSchema, customer: wordSchema, person: wordSchema, equipment: wordSchema, location: wordSchema,
});
export type Vocabulary = z.infer<typeof vocabularySchema>;

export const DEFAULT_WORDS: Vocabulary = {
  work: { one: 'Job', many: 'Jobs' },
  customer: { one: 'Customer', many: 'Customers' },
  person: { one: 'Team member', many: 'Team' },
  equipment: { one: 'Equipment', many: 'Equipment' },
  location: { one: 'Location', many: 'Locations' },
};

/** What each word is for, shown next to it on the review screen and in Settings. */
export const WORD_HINTS: Record<WordKey, string> = {
  work: 'The main thing you do for customers: a job, an appointment, an order, a visit.',
  customer: 'Who the work is for and who pays.',
  person: 'The people on your team.',
  equipment: 'Vehicles, tools, chairs or rooms you assign to work.',
  location: 'A place where work happens.',
};

/** A workspace's words, falling back to the defaults for anything not set. */
export function wordsOf(v: unknown): Vocabulary {
  const out = { ...DEFAULT_WORDS };
  const raw = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  for (const k of WORD_KEYS) {
    const r = wordSchema.safeParse(raw[k]);
    if (r.success) out[k] = r.data;
  }
  return out;
}

/** "job" / "jobs": a word for use inside a sentence. Keeps acronyms ("CPR class") as they are. */
export function lower(w: string) {
  return /^[A-Z]{2,}/.test(w) ? w : w.charAt(0).toLowerCase() + w.slice(1);
}

/** "1 job", "3 jobs". */
export function count(n: number, w: Word, inSentence = true) {
  const s = n === 1 ? w.one : w.many;
  return `${n} ${inSentence ? lower(s) : s}`;
}

// ---------------------------------------------------------------- record types and custom fields

export const RECORD_KINDS = ['work', 'customer', 'equipment'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const FIELD_TYPES = {
  text: 'Short text',
  long_text: 'Long text',
  number: 'Number',
  money: 'Amount of money',
  choice: 'Choice from a list',
  yes_no: 'Yes or no',
  date: 'Date',
  phone: 'Phone number',
  email: 'Email address',
} as const;
export type FieldType = keyof typeof FIELD_TYPES;

const keyText = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use lower-case letters, numbers and underscores');

export const fieldDefSchema = z.object({
  key: keyText,
  label: z.string().trim().min(1, 'Name the field').max(60, 'Use 60 characters or fewer.'),
  type: z.enum(Object.keys(FIELD_TYPES) as [FieldType, ...FieldType[]]),
  options: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  unit: z.string().trim().max(20).optional(),
  required: z.boolean().optional(),
  /** Work fields only: whether people on the worker app see and fill it. */
  forWorkers: z.boolean().optional(),
  hint: z.string().trim().max(160).optional(),
});
export type FieldDef = z.infer<typeof fieldDefSchema>;

export const fieldListSchema = z.array(fieldDefSchema).max(30, 'Use 30 fields or fewer.').superRefine((fields, ctx) => {
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    if (seen.has(f.key)) ctx.addIssue({ code: 'custom', path: [i, 'key'], message: 'Two fields have the same name' });
    seen.add(f.key);
    if (f.type === 'choice' && !(f.options?.length)) ctx.addIssue({ code: 'custom', path: [i, 'options'], message: 'Add at least one choice' });
  });
});

/** Fields whose values are contact details or money: removed on the server for roles without access. */
export function fieldSensitivity(f: Pick<FieldDef, 'type'>): 'contact' | 'money' | null {
  if (f.type === 'phone' || f.type === 'email') return 'contact';
  if (f.type === 'money') return 'money';
  return null;
}

/** A field key made from its label ("Gate code" → "gate_code"), unique among `taken`. */
export function fieldKey(label: string, taken: string[] = []) {
  let base = label.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'field';
  if (!/^[a-z]/.test(base)) base = `f_${base}`;
  let k = base, n = 2;
  while (taken.includes(k)) k = `${base}_${n++}`;
  return k;
}

/** Checks one value against its field; returns the problem in plain words, or null. */
export function fieldValueProblem(f: FieldDef, v: unknown): string | null {
  const empty = v === undefined || v === null || v === '';
  if (empty) return f.required ? `Fill in ${f.label}.` : null;
  switch (f.type) {
    case 'number': return /^-?\d+(\.\d+)?$/.test(String(v)) ? null : `${f.label} needs digits, like 2 or 1.5.`;
    case 'money': return Number.isInteger(v) ? null : `${f.label} must be an amount.`;
    case 'yes_no': return typeof v === 'boolean' ? null : `${f.label} must be yes or no.`;
    case 'choice': return (f.options ?? []).includes(String(v)) ? null : `Choose one of the options for ${f.label}.`;
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? null : `${f.label} must be a date.`;
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v)) ? null : `${f.label} must be an email address.`;
    default: return String(v).length > (f.type === 'long_text' ? 4000 : 300) ? `${f.label} is too long.` : null;
  }
}

/** Validates values against field definitions, dropping keys no field defines. */
export function cleanValues(fields: FieldDef[], values: Record<string, unknown>, opts: { requireAll?: boolean } = {}) {
  const out: Record<string, unknown> = {};
  const problems: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.key];
    const p = fieldValueProblem(opts.requireAll === false ? { ...f, required: false } : f, v);
    if (p) problems[f.key] = p;
    else if (v !== undefined && v !== null && v !== '') out[f.key] = v;
  }
  return { values: out, problems };
}

// ---------------------------------------------------------------- stages

/**
 * What a stage means, whatever the workspace calls it, so Rigo can bill, report and stay honest:
 * open (not started), active (being done), finished (done, can be billed), cancelled (won't
 * happen), failed (tried and couldn't be done; never billed automatically).
 */
export const MEANINGS = {
  open: { label: 'Open', hint: 'Not started yet' },
  active: { label: 'Active', hint: 'Being done now' },
  finished: { label: 'Finished', hint: 'Done; can be billed' },
  cancelled: { label: 'Cancelled', hint: "Won't happen" },
  failed: { label: 'Failed', hint: "Tried, but couldn't be done" },
} as const;
export type Meaning = keyof typeof MEANINGS;
export const MEANING_KEYS = Object.keys(MEANINGS) as Meaning[];
/** Work in these stages is over: it leaves the schedule and the worker's Today. */
export const isClosed = (m: Meaning) => m === 'finished' || m === 'cancelled' || m === 'failed';

export const stageDefSchema = z.object({
  key: keyText,
  name: z.string().trim().min(1, 'Name the stage').max(40, 'Use 40 characters or fewer.'),
  meaning: z.enum(MEANING_KEYS as [Meaning, ...Meaning[]]),
  /** Work fields that must be filled before work enters this stage. */
  requires: z.array(keyText).max(20).optional(),
  /** Stages work may move to from here; missing means any stage. */
  next: z.array(keyText).max(15).optional(),
});
export type StageDef = z.infer<typeof stageDefSchema>;

/** Problems with a stage list, in plain words. An empty list means it can be saved. */
export function stageProblems(stages: StageDef[], workFields: Pick<FieldDef, 'key' | 'label'>[] = []): string[] {
  const out: string[] = [];
  if (stages.length < 2) out.push('Add at least two stages.');
  if (stages.length > 15) out.push('Use 15 stages or fewer.');
  if (!stages.some((s) => s.meaning === 'open')) out.push('Add a stage marked Open, where new work starts.');
  if (!stages.some((s) => s.meaning === 'finished')) out.push('Add a stage marked Finished, so finished work can be billed.');
  const keys = new Set<string>();
  const names = new Set<string>();
  for (const s of stages) {
    if (keys.has(s.key)) out.push(`Two stages use the key ${s.key}.`);
    keys.add(s.key);
    const n = s.name.trim().toLowerCase();
    if (names.has(n)) out.push(`Two stages are called ${s.name}.`);
    names.add(n);
  }
  for (const s of stages) {
    for (const k of s.next ?? []) if (!keys.has(k)) out.push(`${s.name} leads to a stage that doesn't exist.`);
    for (const k of s.requires ?? []) if (!workFields.some((f) => f.key === k)) out.push(`${s.name} requires a field that doesn't exist.`);
  }
  return [...new Set(out)];
}

/** Where new work starts: the first stage marked Open. */
export function firstOpen<T extends { meaning: string; position?: number }>(stages: T[]) {
  return stages.find((s) => s.meaning === 'open') ?? null;
}

/** Whether work may move from one stage to another, and why not. */
export function moveProblem(from: { key: string; name: string; next?: string[] | null } | null, to: { key: string; name: string; requires?: string[] | null }, values: Record<string, unknown>, fields: Pick<FieldDef, 'key' | 'label'>[]): string | null {
  if (from && from.key === to.key) return null;
  if (from?.next && !from.next.includes(to.key)) return `Work in ${from.name} can't move to ${to.name}.`;
  const missing = (to.requires ?? []).filter((k) => values[k] === undefined || values[k] === null || values[k] === '');
  if (missing.length) {
    const labels = missing.map((k) => fields.find((f) => f.key === k)?.label ?? k);
    return `Fill in ${labels.join(', ')} before moving to ${to.name}.`;
  }
  return null;
}

/** The stages work can move to next, in order. */
export function nextStages<T extends { key: string; next?: string[] | null }>(from: T | null, stages: T[]): T[] {
  return stages.filter((s) => s.key !== from?.key && (!from?.next || from.next.includes(s.key)));
}

// ---------------------------------------------------------------- roles

export const roleDefSchema = z.object({
  key: keyText,
  name: z.string().trim().min(1, 'Name the role').max(40, 'Use 40 characters or fewer.'),
  description: z.string().trim().max(200).default(''),
  app: z.enum(['office', 'worker']),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).max(ALL_PERMISSIONS.length),
});
export type RoleDef = z.infer<typeof roleDefSchema>;

/** A role key from its name ("Front desk" → "front_desk"); "owner" is reserved. */
export function roleKey(name: string, taken: string[] = []) {
  return fieldKey(name, ['owner', ...taken]);
}

/** Worker-app roles get only what the worker app uses, whatever else is ticked. */
export function effectivePermissions(app: RoleApp, perms: Permission[]): Permission[] {
  if (app === 'office') return perms;
  const allowed: Permission[] = ['work.view_assigned', 'work.do', 'customers.contact', 'money.view', 'payments.record'];
  return perms.filter((p) => allowed.includes(p));
}

// ---------------------------------------------------------------- the whole structure

export const catalogDefSchema = z.object({
  name: z.string().trim().min(1, 'Name it').max(80, 'Use 80 characters or fewer.'),
  unit: z.string().trim().max(20).default(''),
  taxable: z.boolean().default(false),
});

/**
 * A workspace's structure: what a template carries and what the review screen adjusts. Never prices,
 * people or records (PRODUCT.md, templates).
 */
export const structureSchema = z.object({
  words: vocabularySchema,
  roles: z.array(roleDefSchema).max(12, 'Use 12 roles or fewer.'),
  stages: z.array(stageDefSchema).min(2, 'Add at least two stages.').max(15, 'Use 15 stages or fewer.'),
  fields: z.object({ work: fieldListSchema, customer: fieldListSchema, equipment: fieldListSchema }),
  equipment: z.boolean(),
  catalog: z.array(catalogDefSchema).max(60),
});
export type Structure = z.infer<typeof structureSchema>;

/** Problems with a whole structure beyond its shape (stage rules, role keys), in plain words. */
export function structureProblems(s: Structure): string[] {
  const out = stageProblems(s.stages, s.fields.work);
  const keys = new Set<string>();
  for (const r of s.roles) {
    if (r.key === 'owner') out.push('The Owner role is always there; add other roles beside it.');
    if (keys.has(r.key)) out.push(`Two roles use the key ${r.key}.`);
    keys.add(r.key);
  }
  return out;
}
