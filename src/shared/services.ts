import { z } from 'zod';
import { rateToMinor } from './billing.js';

// Declarative service configuration. Owners compose these; nothing here executes code.

export const SERVICE_CATEGORIES = {
  fuel: 'Fuel delivery',
  portable_toilet: 'Portable toilets',
  septic: 'Septic services',
  other: 'Other service',
} as const;
export type ServiceCategory = keyof typeof SERVICE_CATEGORIES;

const key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use lowercase letters, numbers and underscores');

export const fieldDefSchema = z.object({
  key,
  label: z.string().trim().min(1).max(60),
  type: z.enum(['number', 'text', 'longtext', 'select', 'boolean', 'date']),
  unit: z.string().max(20).optional().default(''),
  options: z.array(z.string().trim().min(1).max(60)).max(30).optional().default([]),
  stage: z.enum(['request', 'completion', 'both']),
  required: z.boolean().default(false),
  help: z.string().max(200).optional().default(''),
});
export type FieldDef = z.infer<typeof fieldDefSchema>;

const decimal = z.string().regex(/^\d+(\.\d+)?$/, 'Enter a number like 1000 or 12.5');

/** Older price lines stored whole cents in `rateMinor`; they read as ten-thousandths (× 100). */
function legacyRate(v: unknown) {
  if (v && typeof v === 'object' && !('rateE4' in v) && 'rateMinor' in v) {
    const r = (v as { rateMinor: unknown }).rateMinor;
    return { ...v, rateE4: typeof r === 'number' ? r * 100 : null };
  }
  return v;
}

export const priceLineSchema = z.preprocess(legacyRate, z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  basis: z.enum(['flat', 'per_quantity']),
  quantityField: z.string().max(40).optional().default(''),
  unit: z.string().max(20).optional().default(''),
  /** Rate in ten-thousandths of the currency ($3.8995 = 38995); empty means not set (the invoice holds). */
  rateE4: z.number().int().min(0).max(1_000_000_000_000).nullable(),
  taxable: z.boolean().default(false),
  /** Charge this line only when a choice-list or yes/no field has this value (e.g. Product is Diesel). */
  when: z.object({ field: z.string().min(1).max(40), equals: z.string().min(1).max(60) }).nullable().optional().default(null),
  /** Flat lines: quantity covered by the flat price ("$375 including 1,000 gal"). */
  includedQuantity: decimal.nullable().optional().default(null),
  /** Flat lines with an included quantity: rate for each unit beyond it (ten-thousandths). */
  overageRateE4: z.number().int().min(0).max(1_000_000_000_000).nullable().optional().default(null),
  /** Per-unit lines: the least this line charges, in minor units ("$200 minimum"). */
  minimumMinor: z.number().int().min(0).max(1_000_000_000).nullable().optional().default(null),
  /** The date the current rate took effect (set by the server when the rate changes). */
  rateSince: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().default(null),
}));
export type PriceLine = z.output<typeof priceLineSchema>;

/** Price lines as stored: also keep a whole-cent `rateMinor` so older readers of the same data keep working. */
export function storedPricing(pricing: PriceLine[]) {
  return pricing.map((p) => ({ ...p, rateMinor: rateToMinor(p.rateE4) }));
}

/** Keep each line's rate date, or set it to `today` when its rate (or overage rate) changed or is new. */
export function datePriceChanges(before: PriceLine[], after: PriceLine[], today: string): PriceLine[] {
  return after.map((p) => {
    const o = before.find((x) => x.id === p.id);
    const changed = !o || o.rateE4 !== p.rateE4 || o.overageRateE4 !== p.overageRateE4;
    return { ...p, rateSince: p.rateE4 === null ? null : changed ? today : o!.rateSince ?? null };
  });
}

/** Read stored price lines (old or new shape) into the current shape; invalid entries are dropped. */
export function readPricing(raw: unknown): PriceLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => { const r = priceLineSchema.safeParse(x); return r.success ? [r.data] : []; });
}

export const serviceInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(['fuel', 'portable_toilet', 'septic', 'other']),
  description: z.string().max(500).default(''),
  fields: z.array(fieldDefSchema).max(30).default([]),
  pricing: z.array(priceLineSchema).max(20).default([]),
  taxRateBp: z.number().int().min(0).max(5000).nullable().default(null),
  requiresPhoto: z.boolean().default(false),
  requiresSignature: z.boolean().default(false),
  active: z.boolean().default(true),
  /** Print the driver's notes and other completion details on the invoice (quantities always print). */
  invoiceShowsNotes: z.boolean().default(false),
}).superRefine((s, ctx) => {
  const keys = new Set<string>();
  s.fields.forEach((f, i) => {
    if (keys.has(f.key)) ctx.addIssue({ code: 'custom', path: ['fields', i, 'key'], message: `Duplicate field key "${f.key}"` });
    keys.add(f.key);
    if (f.type === 'select' && f.options.length === 0) ctx.addIssue({ code: 'custom', path: ['fields', i, 'options'], message: 'Add at least one option' });
  });
  s.pricing.forEach((p, i) => {
    if (p.includedQuantity !== null) {
      const f = s.fields.find((x) => x.key === p.quantityField);
      if (p.basis !== 'flat') ctx.addIssue({ code: 'custom', path: ['pricing', i, 'includedQuantity'], message: 'An included quantity goes with a flat price' });
      else if (!f || f.type !== 'number') ctx.addIssue({ code: 'custom', path: ['pricing', i, 'quantityField'], message: 'Choose the number field the included quantity is measured in' });
    }
    if (p.minimumMinor !== null && p.basis !== 'per_quantity') ctx.addIssue({ code: 'custom', path: ['pricing', i, 'minimumMinor'], message: 'A minimum charge goes with a price per unit' });
    if (p.basis === 'per_quantity') {
      const f = s.fields.find((x) => x.key === p.quantityField);
      if (!f) ctx.addIssue({ code: 'custom', path: ['pricing', i, 'quantityField'], message: 'Choose the quantity field this price uses' });
      else if (f.type !== 'number') ctx.addIssue({ code: 'custom', path: ['pricing', i, 'quantityField'], message: 'The quantity field must be a number field' });
    }
    if (p.when) {
      const f = s.fields.find((x) => x.key === p.when!.field);
      if (!f || (f.type !== 'select' && f.type !== 'boolean')) ctx.addIssue({ code: 'custom', path: ['pricing', i, 'when', 'field'], message: 'Choose a choice-list or yes/no field for this condition' });
      else if (f.type === 'select' && !f.options.includes(p.when.equals)) ctx.addIssue({ code: 'custom', path: ['pricing', i, 'when', 'equals'], message: `Choose one of the options of ${f.label}` });
      else if (f.type === 'boolean' && !['true', 'false'].includes(p.when.equals)) ctx.addIssue({ code: 'custom', path: ['pricing', i, 'when', 'equals'], message: 'Choose Yes or No' });
    }
  });
});
export type ServiceInput = z.infer<typeof serviceInputSchema>;

/** A price line with every optional setting at its default. */
export function priceLine(p: Pick<PriceLine, 'id' | 'label' | 'basis'> & Partial<PriceLine>): PriceLine {
  return { quantityField: '', unit: '', rateE4: null, taxable: false, when: null, includedQuantity: null, overageRateE4: null, minimumMinor: null, rateSince: null, ...p };
}

// Built fresh on each call: a shared object here would carry one company's edits into the next starter.
const afterHoursField = (): FieldDef => ({ key: 'after_hours', label: 'After-hours visit', type: 'boolean', unit: '', options: [], stage: 'both', required: false, help: 'Evenings, nights, weekends or holidays.' });
const afterHoursLine = () => priceLine({ id: 'after_hours', label: 'After-hours visit', basis: 'flat', when: { field: 'after_hours', equals: 'true' } });
export const FUEL_PRODUCTS = ['Diesel', 'Dyed diesel', 'Gasoline', 'Heating oil'];
export const SEPTIC_DETAILS = ['Pump-out', 'Inspection', 'Grease trap', 'Repair visit'];
const slugId = (s: string) => s.toLowerCase().replace(/\W+/g, '_');

/**
 * Starting examples per category, shaped like a real price list (one line per product, an included
 * quantity with overage, a minimum charge). Rates start empty: Rigo never assumes a price.
 */
export function starterService(category: ServiceCategory): ServiceInput {
  switch (category) {
    case 'fuel':
      return {
        name: 'Fuel delivery', category, description: 'Deliver fuel to a customer tank or site.',
        fields: [
          { key: 'product', label: 'Product', type: 'select', unit: '', options: [...FUEL_PRODUCTS], stage: 'request', required: true, help: '' },
          { key: 'requested_qty', label: 'Requested quantity', type: 'number', unit: 'gal', options: [], stage: 'request', required: false, help: '' },
          { key: 'delivered_qty', label: 'Delivered quantity', type: 'number', unit: 'gal', options: [], stage: 'completion', required: true, help: 'From the meter reading.' },
          afterHoursField(),
        ],
        // One price per product: the invoice uses the line for the product on the job.
        pricing: [
          ...FUEL_PRODUCTS.map((product) => priceLine({ id: `fuel_${slugId(product)}`, label: product, basis: 'per_quantity', quantityField: 'delivered_qty', unit: 'gal', when: { field: 'product', equals: product } })),
          priceLine({ id: 'delivery', label: 'Delivery fee', basis: 'flat' }),
          afterHoursLine(),
        ],
        taxRateBp: null, requiresPhoto: false, requiresSignature: false, active: true, invoiceShowsNotes: false,
      };
    case 'portable_toilet':
      return {
        name: 'Portable toilet service', category, description: 'Delivery, servicing and pickup of portable toilet units.',
        fields: [
          { key: 'visit_type', label: 'Visit type', type: 'select', unit: '', options: ['Delivery', 'Service', 'Pickup'], stage: 'request', required: true, help: '' },
          // One units field: dispatch sets it, the driver's form starts from it and confirms what was serviced (R8-m2).
          { key: 'units', label: 'Units', type: 'number', unit: 'units', options: [], stage: 'both', required: true, help: 'Booked units; the driver confirms how many were serviced.' },
          { key: 'placement', label: 'Placement on site', type: 'text', unit: '', options: [], stage: 'request', required: false, help: '' },
        ],
        pricing: [priceLine({ id: 'visit', label: 'Visit', basis: 'per_quantity', quantityField: 'units', unit: 'units' })],
        taxRateBp: null, requiresPhoto: true, requiresSignature: false, active: true, invoiceShowsNotes: false,
      };
    case 'septic':
      return {
        name: 'Septic service', category, description: 'Pumping and servicing of septic systems.',
        fields: [
          { key: 'service_detail', label: 'Service details', type: 'select', unit: '', options: [...SEPTIC_DETAILS], stage: 'request', required: true, help: '' },
          { key: 'volume_pumped', label: 'Volume pumped', type: 'number', unit: 'gal', options: [], stage: 'completion', required: false, help: 'Record the measurement your company uses.' },
          { key: 'condition_notes', label: 'Condition notes', type: 'longtext', unit: '', options: [], stage: 'completion', required: false, help: '' },
          afterHoursField(),
        ],
        pricing: [
          // "$375 including 1,000 gal, then a rate per gallon": a flat price with an included quantity.
          priceLine({ id: 'pump_out', label: 'Pump-out', basis: 'flat', quantityField: 'volume_pumped', unit: 'gal', includedQuantity: '1000', when: { field: 'service_detail', equals: 'Pump-out' } }),
          priceLine({ id: 'inspection', label: 'Inspection', basis: 'flat', when: { field: 'service_detail', equals: 'Inspection' } }),
          priceLine({ id: 'grease_trap', label: 'Grease trap', basis: 'per_quantity', quantityField: 'volume_pumped', unit: 'gal', when: { field: 'service_detail', equals: 'Grease trap' } }),
          priceLine({ id: 'repair_visit', label: 'Repair visit', basis: 'flat', when: { field: 'service_detail', equals: 'Repair visit' } }),
          afterHoursLine(),
        ],
        taxRateBp: null, requiresPhoto: true, requiresSignature: false, active: true, invoiceShowsNotes: false,
      };
    default:
      return {
        name: 'General service', category, description: '', fields: [], taxRateBp: null,
        pricing: [priceLine({ id: 'visit', label: 'Service', basis: 'flat' })],
        requiresPhoto: false, requiresSignature: false, active: true, invoiceShowsNotes: false,
      };
  }
}

export interface CustomFieldDef { key: string; label: string; type: 'text' | 'number' | 'select' | 'boolean' | 'date'; options?: string[]; required?: boolean }
export const customFieldSchema = z.object({
  key,
  label: z.string().trim().min(1).max(60),
  type: z.enum(['text', 'number', 'select', 'boolean', 'date']),
  options: z.array(z.string().trim().min(1).max(60)).max(30).optional().default([]),
  required: z.boolean().optional().default(false),
});
export const customFieldsSchema = z.object({
  customers: z.array(customFieldSchema).max(20).default([]),
  jobs: z.array(customFieldSchema).max(20).default([]),
  locations: z.array(customFieldSchema).max(20).default([]),
});
export type CustomFields = z.infer<typeof customFieldsSchema>;

/** Validate values against field definitions; returns a cleaned record and per-field errors. */
export function validateValues(defs: { key: string; label: string; type: string; options?: string[]; required?: boolean }[],
  values: Record<string, unknown>, opts: { enforceRequired: boolean }) {
  const clean: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const d of defs) {
    const raw = values?.[d.key];
    const empty = raw === undefined || raw === null || raw === '';
    if (empty) {
      if (opts.enforceRequired && d.required) errors[d.key] = `${d.label} is required`;
      continue;
    }
    switch (d.type) {
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
        if (!Number.isFinite(n) || n < 0) errors[d.key] = `${d.label} must be a number of zero or more`;
        else clean[d.key] = String(raw).trim();
        break;
      }
      case 'boolean': clean[d.key] = raw === true || raw === 'true'; break;
      case 'select':
        if (!d.options?.includes(String(raw))) errors[d.key] = `Choose a listed option for ${d.label}`;
        else clean[d.key] = String(raw);
        break;
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) errors[d.key] = `${d.label} must be a date`;
        else clean[d.key] = String(raw);
        break;
      default: clean[d.key] = String(raw).slice(0, 2000);
    }
  }
  return { clean, errors };
}
