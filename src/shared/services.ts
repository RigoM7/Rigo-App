import { z } from 'zod';

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

export const priceLineSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  basis: z.enum(['flat', 'per_quantity']),
  quantityField: z.string().max(40).optional().default(''),
  unit: z.string().max(20).optional().default(''),
  rateMinor: z.number().int().min(0).max(1_000_000_000).nullable(),
  taxable: z.boolean().default(false),
  /** Charge this line only when a choice-list or yes/no field has this value (e.g. Product is Diesel). */
  when: z.object({ field: z.string().min(1).max(40), equals: z.string().min(1).max(60) }).nullable().optional().default(null),
});
export type PriceLine = z.infer<typeof priceLineSchema>;

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
}).superRefine((s, ctx) => {
  const keys = new Set<string>();
  s.fields.forEach((f, i) => {
    if (keys.has(f.key)) ctx.addIssue({ code: 'custom', path: ['fields', i, 'key'], message: `Duplicate field key "${f.key}"` });
    keys.add(f.key);
    if (f.type === 'select' && f.options.length === 0) ctx.addIssue({ code: 'custom', path: ['fields', i, 'options'], message: 'Add at least one option' });
  });
  s.pricing.forEach((p, i) => {
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

const AFTER_HOURS_FIELD: FieldDef = { key: 'after_hours', label: 'After-hours visit', type: 'boolean', unit: '', options: [], stage: 'both', required: false, help: 'Evenings, nights, weekends or holidays.' };
const AFTER_HOURS_LINE: PriceLine = { id: 'after_hours', label: 'After-hours visit', basis: 'flat', quantityField: '', unit: '', rateMinor: null, taxable: false, when: { field: 'after_hours', equals: 'true' } };

/** Starting examples per category. They are editable defaults, not regulatory or pricing rules. */
export function starterService(category: ServiceCategory): ServiceInput {
  switch (category) {
    case 'fuel':
      return {
        name: 'Fuel delivery', category, description: 'Deliver fuel to a customer tank or site.',
        fields: [
          { key: 'product', label: 'Product', type: 'select', unit: '', options: ['Diesel', 'Gasoline', 'Heating oil'], stage: 'request', required: true, help: '' },
          { key: 'requested_qty', label: 'Requested quantity', type: 'number', unit: 'gal', options: [], stage: 'request', required: false, help: '' },
          { key: 'delivered_qty', label: 'Delivered quantity', type: 'number', unit: 'gal', options: [], stage: 'completion', required: true, help: 'From the meter reading.' },
          AFTER_HOURS_FIELD,
        ],
        // One price per product: the invoice uses the line for the product on the job.
        pricing: [
          ...['Diesel', 'Gasoline', 'Heating oil'].map((product) => ({ id: `fuel_${product.toLowerCase().replace(/\W+/g, '_')}`, label: product, basis: 'per_quantity' as const, quantityField: 'delivered_qty', unit: 'gal', rateMinor: null, taxable: false, when: { field: 'product', equals: product } })),
          AFTER_HOURS_LINE,
        ],
        taxRateBp: null, requiresPhoto: false, requiresSignature: false, active: true,
      };
    case 'portable_toilet':
      return {
        name: 'Portable toilet service', category, description: 'Delivery, servicing and pickup of portable toilet units.',
        fields: [
          { key: 'visit_type', label: 'Visit type', type: 'select', unit: '', options: ['Delivery', 'Service', 'Pickup'], stage: 'request', required: true, help: '' },
          { key: 'units', label: 'Units', type: 'number', unit: 'units', options: [], stage: 'both', required: true, help: '' },
          { key: 'placement', label: 'Placement on site', type: 'text', unit: '', options: [], stage: 'request', required: false, help: '' },
          { key: 'units_serviced', label: 'Units serviced', type: 'number', unit: 'units', options: [], stage: 'completion', required: false, help: '' },
        ],
        pricing: [{ id: 'visit', label: 'Visit', basis: 'per_quantity', quantityField: 'units', unit: 'units', rateMinor: null, taxable: false, when: null }],
        taxRateBp: null, requiresPhoto: true, requiresSignature: false, active: true,
      };
    case 'septic':
      return {
        name: 'Septic service', category, description: 'Pumping and servicing of septic systems.',
        fields: [
          { key: 'service_detail', label: 'Service details', type: 'select', unit: '', options: ['Pump-out', 'Inspection', 'Repair visit'], stage: 'request', required: true, help: '' },
          { key: 'volume_pumped', label: 'Volume pumped', type: 'number', unit: 'gal', options: [], stage: 'completion', required: false, help: 'Record the measurement your company uses.' },
          { key: 'condition_notes', label: 'Condition notes', type: 'longtext', unit: '', options: [], stage: 'completion', required: false, help: '' },
          AFTER_HOURS_FIELD,
        ],
        pricing: [
          { id: 'pump_out', label: 'Pump-out', basis: 'per_quantity', quantityField: 'volume_pumped', unit: 'gal', rateMinor: null, taxable: false, when: { field: 'service_detail', equals: 'Pump-out' } },
          { id: 'inspection', label: 'Inspection', basis: 'flat', quantityField: '', unit: '', rateMinor: null, taxable: false, when: { field: 'service_detail', equals: 'Inspection' } },
          { id: 'repair_visit', label: 'Repair visit', basis: 'flat', quantityField: '', unit: '', rateMinor: null, taxable: false, when: { field: 'service_detail', equals: 'Repair visit' } },
          AFTER_HOURS_LINE,
        ],
        taxRateBp: null, requiresPhoto: true, requiresSignature: false, active: true,
      };
    default:
      return {
        name: 'General service', category, description: '', fields: [], taxRateBp: null,
        pricing: [{ id: 'visit', label: 'Service', basis: 'flat', quantityField: '', unit: '', rateMinor: null, taxable: false, when: null }],
        requiresPhoto: false, requiresSignature: false, active: true,
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
