import { PERMISSION_PRESETS, type Permission } from './permissions.js';
import type { Structure, StageDef, FieldDef, RoleDef } from './workspace.js';
import { fold } from './customers.js';

// Rigo's built-in templates: structure only (words, roles, stages, fields, the names of what a
// business sells), never prices, people or records. Plus the rule-based word matching that suggests
// one from a sentence at sign-up (no AI until the assistant ships, PRODUCT.md decisions).

export interface Template {
  key: string;
  name: string;
  /** One line under the name. */
  blurb: string;
  /** Kinds of businesses it fits, shown as examples. */
  examples: string[];
  /** Words that point to this template in "describe your business". */
  keywords: string[];
  structure: Structure;
}

const role = (key: string, name: string, app: RoleDef['app'], permissions: Permission[], description = ''): RoleDef => ({ key, name, app, permissions, description });
const stage = (key: string, name: string, meaning: StageDef['meaning'], extra: Partial<StageDef> = {}): StageDef => ({ key, name, meaning, ...extra });
const field = (key: string, label: string, type: FieldDef['type'], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type, ...extra });

export const TEMPLATES: Template[] = [
  {
    key: 'field_service',
    name: 'Field service',
    blurb: 'Drivers and crews doing work at customer sites, with trucks and equipment.',
    examples: ['Fuel delivery', 'Portable toilets', 'Septic pumping', 'Landscaping', 'Plumbing'],
    keywords: ['fuel', 'diesel', 'propane', 'oil', 'delivery truck', 'portable toilet', 'porta', 'potty', 'septic', 'pump', 'pumping', 'grease trap', 'plumb', 'hvac', 'heating', 'electric', 'landscap', 'lawn', 'tree', 'snow', 'pest', 'roof', 'repair', 'install', 'technician', 'field', 'crew', 'truck', 'drivers', 'site', 'rental', 'dumpster', 'junk', 'haul', 'towing', 'pool'],
    structure: {
      words: {
        work: { one: 'Job', many: 'Jobs' }, customer: { one: 'Customer', many: 'Customers' }, person: { one: 'Team member', many: 'Team' },
        equipment: { one: 'Truck or unit', many: 'Trucks and equipment' }, location: { one: 'Site', many: 'Sites' },
      },
      roles: [
        role('dispatcher', 'Dispatcher', 'office', PERMISSION_PRESETS.scheduler, 'Takes requests, plans the day and assigns drivers and trucks.'),
        role('driver', 'Driver', 'worker', PERMISSION_PRESETS.worker, 'Does the jobs assigned to them, from their phone.'),
        role('office', 'Office / billing', 'office', PERMISSION_PRESETS.bookkeeper, 'Handles invoices, payments and customers.'),
      ],
      stages: [
        stage('requested', 'Requested', 'open'),
        stage('scheduled', 'Scheduled', 'open'),
        stage('in_progress', 'In progress', 'active'),
        stage('done', 'Done', 'finished'),
        stage('cancelled', 'Cancelled', 'cancelled'),
        stage('not_done', "Couldn't complete", 'failed'),
      ],
      fields: {
        work: [
          field('access', 'Gate code or access notes', 'text', { forWorkers: true }),
          field('quantity', 'Quantity delivered', 'number', { forWorkers: true, unit: 'gal' }),
        ],
        customer: [field('billing_email', 'Billing email', 'email')],
        equipment: [field('capacity', 'Capacity', 'text', { hint: 'For example 3,000 gal' })],
      },
      equipment: true,
      catalog: [
        { name: 'Fuel delivery', unit: 'gal', taxable: true },
        { name: 'Portable toilet service', unit: 'visit', taxable: false },
        { name: 'Septic pump-out', unit: 'visit', taxable: false },
        { name: 'Grease trap pump-out', unit: 'visit', taxable: false },
        { name: 'Delivery fee', unit: '', taxable: false },
      ],
    },
  },
  {
    key: 'cleaning',
    name: 'Cleaning and home services',
    blurb: 'Cleaners and home crews visiting homes and offices on a schedule.',
    examples: ['House cleaning', 'Office cleaning', 'Window washing', 'Carpet cleaning', 'Handyman'],
    keywords: ['clean', 'maid', 'janitor', 'housekeep', 'window', 'carpet', 'pressure wash', 'power wash', 'handyman', 'home service', 'move out', 'move-out', 'laundry', 'organiz', 'residential', 'office cleaning', 'gutter'],
    structure: {
      words: {
        work: { one: 'Visit', many: 'Visits' }, customer: { one: 'Client', many: 'Clients' }, person: { one: 'Team member', many: 'Team' },
        equipment: { one: 'Van', many: 'Vans' }, location: { one: 'Address', many: 'Addresses' },
      },
      roles: [
        role('manager', 'Manager', 'office', PERMISSION_PRESETS.manager, 'Books visits, plans the week and handles billing.'),
        role('cleaner', 'Cleaner', 'worker', PERMISSION_PRESETS.worker, 'Does the visits assigned to them, from their phone.'),
      ],
      stages: [
        stage('requested', 'Requested', 'open'),
        stage('booked', 'Booked', 'open'),
        stage('in_progress', 'In progress', 'active'),
        stage('done', 'Done', 'finished'),
        stage('cancelled', 'Cancelled', 'cancelled'),
        stage('no_access', "Couldn't get in", 'failed'),
      ],
      fields: {
        work: [
          field('entry', 'How to get in', 'long_text', { forWorkers: true }),
          field('pets', 'Pets at home', 'yes_no', { forWorkers: true }),
        ],
        customer: [field('preferred_day', 'Preferred day', 'choice', { options: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] })],
        equipment: [],
      },
      equipment: false,
      catalog: [
        { name: 'Standard clean', unit: 'visit', taxable: false },
        { name: 'Deep clean', unit: 'visit', taxable: false },
        { name: 'Move-out clean', unit: 'visit', taxable: false },
        { name: 'Extra hour', unit: 'hour', taxable: false },
      ],
    },
  },
  {
    key: 'appointments',
    name: 'Appointments',
    blurb: 'Clients booking time with a person, at your place or theirs.',
    examples: ['Salon', 'Barber', 'Pet grooming', 'Tutoring', 'Massage'],
    keywords: ['salon', 'hair', 'barber', 'nail', 'beauty', 'spa', 'massage', 'groom', 'dog', 'pet', 'tutor', 'lesson', 'teach', 'class', 'coach', 'trainer', 'fitness', 'therap', 'clinic', 'appointment', 'book', 'session', 'studio', 'photograph', 'tattoo', 'lash', 'brow', 'makeup', 'music'],
    structure: {
      words: {
        work: { one: 'Appointment', many: 'Appointments' }, customer: { one: 'Client', many: 'Clients' }, person: { one: 'Staff member', many: 'Staff' },
        equipment: { one: 'Station', many: 'Stations' }, location: { one: 'Address', many: 'Addresses' },
      },
      roles: [
        role('front_desk', 'Front desk', 'office', PERMISSION_PRESETS.front_desk, 'Books appointments, checks clients in and takes payments.'),
        role('specialist', 'Specialist', 'worker', [...PERMISSION_PRESETS.worker, 'customers.contact'], 'Sees their own appointments and moves them along.'),
      ],
      stages: [
        stage('requested', 'Requested', 'open'),
        stage('booked', 'Booked', 'open'),
        stage('checked_in', 'Checked in', 'active'),
        stage('completed', 'Completed', 'finished'),
        stage('cancelled', 'Cancelled', 'cancelled'),
        stage('no_show', 'No-show', 'failed'),
      ],
      fields: {
        work: [field('notes_for_staff', 'Notes for the appointment', 'long_text', { forWorkers: true })],
        customer: [field('preferences', 'Preferences', 'long_text'), field('birthday', 'Birthday', 'date')],
        equipment: [],
      },
      equipment: true,
      catalog: [
        { name: 'Haircut', unit: '', taxable: true },
        { name: 'Color', unit: '', taxable: true },
        { name: 'Grooming, small dog', unit: '', taxable: true },
        { name: 'Grooming, large dog', unit: '', taxable: true },
        { name: 'Tutoring session', unit: 'hour', taxable: false },
      ],
    },
  },
  {
    key: 'orders',
    name: 'Orders and delivery',
    blurb: 'Customers ordering things you make or sell, picked up or delivered.',
    examples: ['Bakery', 'Catering', 'Florist', 'Small shop', 'Meal prep'],
    keywords: ['bake', 'cake', 'bread', 'pastry', 'cater', 'food', 'meal', 'kitchen', 'florist', 'flower', 'shop', 'store', 'order', 'deliver', 'pickup', 'pick up', 'retail', 'boutique', 'gift', 'print', 'candle', 'craft', 'farm', 'produce', 'coffee', 'restaurant'],
    structure: {
      words: {
        work: { one: 'Order', many: 'Orders' }, customer: { one: 'Customer', many: 'Customers' }, person: { one: 'Team member', many: 'Team' },
        equipment: { one: 'Vehicle', many: 'Vehicles' }, location: { one: 'Delivery address', many: 'Delivery addresses' },
      },
      roles: [
        role('manager', 'Manager', 'office', PERMISSION_PRESETS.manager, 'Takes orders, plans the day and handles billing.'),
        role('kitchen', 'Kitchen', 'worker', PERMISSION_PRESETS.worker, 'Makes the orders assigned to them.'),
        role('driver', 'Driver', 'worker', PERMISSION_PRESETS.worker, 'Delivers the orders assigned to them.'),
      ],
      stages: [
        stage('new', 'New', 'open'),
        stage('confirmed', 'Confirmed', 'open'),
        stage('preparing', 'Preparing', 'active'),
        stage('out_for_delivery', 'Out for delivery', 'active'),
        stage('delivered', 'Delivered or picked up', 'finished'),
        stage('cancelled', 'Cancelled', 'cancelled'),
        stage('not_delivered', "Couldn't deliver", 'failed'),
      ],
      fields: {
        work: [
          field('handoff', 'Delivery or pickup', 'choice', { options: ['Delivery', 'Pickup'], forWorkers: true }),
          field('order_notes', 'Order details', 'long_text', { forWorkers: true }),
        ],
        customer: [field('allergies', 'Allergies', 'text')],
        equipment: [],
      },
      equipment: false,
      catalog: [
        { name: 'Custom cake', unit: '', taxable: true },
        { name: 'Dozen cupcakes', unit: 'dozen', taxable: true },
        { name: 'Catering tray', unit: 'tray', taxable: true },
        { name: 'Delivery fee', unit: '', taxable: false },
      ],
    },
  },
  {
    key: 'general',
    name: 'Something else',
    blurb: 'A simple start for any business. Rename everything to fit.',
    examples: ['Agencies', 'Consultants', 'Repairs', 'Events'],
    keywords: [],
    structure: {
      words: {
        work: { one: 'Job', many: 'Jobs' }, customer: { one: 'Customer', many: 'Customers' }, person: { one: 'Team member', many: 'Team' },
        equipment: { one: 'Equipment', many: 'Equipment' }, location: { one: 'Location', many: 'Locations' },
      },
      roles: [
        role('manager', 'Manager', 'office', PERMISSION_PRESETS.manager, 'Runs the day-to-day work and billing.'),
        role('worker', 'Worker', 'worker', PERMISSION_PRESETS.worker, 'Does the work assigned to them, from their phone.'),
      ],
      stages: [
        stage('to_do', 'To do', 'open'),
        stage('scheduled', 'Scheduled', 'open'),
        stage('in_progress', 'In progress', 'active'),
        stage('done', 'Done', 'finished'),
        stage('cancelled', 'Cancelled', 'cancelled'),
        stage('not_done', "Couldn't finish", 'failed'),
      ],
      fields: { work: [], customer: [], equipment: [] },
      equipment: false,
      catalog: [],
    },
  },
];

export const templateByKey = (key: string | null | undefined) => TEMPLATES.find((t) => t.key === key) ?? null;
export const GENERAL = templateByKey('general')!;

/** A deep copy of a template's structure, so a workspace never shares objects with it. */
export const structureOf = (t: Template): Structure => JSON.parse(JSON.stringify(t.structure));

export interface Match { key: string; score: number; matched: string[] }

/**
 * Suggests templates from a sentence by plain word matching (no AI). Each keyword found scores one;
 * a keyword that is a whole word scores two. Ties keep the template order. With nothing matched,
 * the general template is suggested.
 */
export function matchTemplates(description: string): Match[] {
  const text = ` ${fold(description).replace(/[^a-z0-9]+/g, ' ')} `;
  const out: Match[] = [];
  for (const t of TEMPLATES) {
    let score = 0;
    const matched: string[] = [];
    for (const k of t.keywords) {
      const kw = fold(k);
      if (!text.includes(kw)) continue;
      matched.push(k);
      score += text.includes(` ${kw} `) || text.includes(` ${kw}s `) ? 2 : 1;
    }
    out.push({ key: t.key, score, matched });
  }
  out.sort((a, b) => b.score - a.score);
  if (!out[0].score) return [{ key: 'general', score: 0, matched: [] }, ...out.filter((m) => m.key !== 'general')];
  return out;
}

/** The single best template for a sentence. */
export const suggestTemplate = (description: string) => templateByKey(matchTemplates(description)[0].key)!;
