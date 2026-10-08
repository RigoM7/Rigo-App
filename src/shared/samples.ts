// Sample data for demos only ("Show sample data"). Fictional people and places, example prices that
// are not recommendations, and example.com addresses. A real workspace never gets any of this.

export interface SampleSet {
  customers: { name: string; address: string; phone: string; email: string }[];
  /** Example prices by price-list item name; an item left out stays unpriced to show a held invoice. */
  prices: Record<string, string>;
  equipment: string[];
  /** Work: customer index, item name, quantity, days from today, hour, and the stage meaning to end in. */
  work: { c: number; item: string; qty: string; day: number; hour: number; minutes?: number; meaning: 'open' | 'active' | 'finished' | 'failed'; title?: string }[];
}

const people = [
  ['Harbor View Apartments', '12 Harbor View Rd', '(555) 010-2001', 'office@harborview.example.com'],
  ['Maple Street Bakery', '48 Maple St', '(555) 010-2002', 'hello@maplebakery.example.com'],
  ['Jordan Ellis', '7 Birch Ln', '(555) 010-2003', 'jordan.ellis@example.com'],
  ['Riverside Clinic', '300 River Rd', '(555) 010-2004', 'admin@riverside.example.com'],
  ['Priya Nair', '19 Elm Ct', '(555) 010-2005', 'priya.nair@example.com'],
] as const;
const customers = people.map(([name, address, phone, email]) => ({ name, address: `${address}, Springfield`, phone, email }));

export const SAMPLES: Record<string, SampleSet> = {
  field_service: {
    customers, equipment: ['Tanker 12', 'Vac truck 3', 'Flatbed 7'],
    prices: { 'Fuel delivery': '3.8995', 'Portable toilet service': '95', 'Septic pump-out': '375', 'Delivery fee': '45' },
    work: [
      { c: 0, item: 'Septic pump-out', qty: '1', day: -3, hour: 9, meaning: 'finished' },
      { c: 1, item: 'Fuel delivery', qty: '250', day: -2, hour: 8, meaning: 'finished' },
      { c: 3, item: 'Grease trap pump-out', qty: '1', day: -1, hour: 13, meaning: 'finished' },
      { c: 2, item: 'Portable toilet service', qty: '2', day: 0, hour: 8, meaning: 'active' },
      { c: 4, item: 'Fuel delivery', qty: '150', day: 0, hour: 11, meaning: 'open' },
      { c: 0, item: 'Portable toilet service', qty: '4', day: 0, hour: 14, meaning: 'open' },
      { c: 3, item: 'Septic pump-out', qty: '1', day: 1, hour: 9, meaning: 'open' },
      { c: 1, item: 'Fuel delivery', qty: '300', day: 2, hour: 10, meaning: 'open' },
      { c: 2, item: 'Septic pump-out', qty: '1', day: -1, hour: 10, meaning: 'failed', title: 'Gate locked' },
    ],
  },
  cleaning: {
    customers, equipment: [],
    prices: { 'Standard clean': '140', 'Deep clean': '260', 'Extra hour': '45' },
    work: [
      { c: 2, item: 'Standard clean', qty: '1', day: -3, hour: 9, meaning: 'finished' },
      { c: 4, item: 'Deep clean', qty: '1', day: -2, hour: 10, meaning: 'finished' },
      { c: 0, item: 'Move-out clean', qty: '1', day: -1, hour: 9, meaning: 'finished' },
      { c: 3, item: 'Standard clean', qty: '1', day: 0, hour: 8, meaning: 'active' },
      { c: 2, item: 'Standard clean', qty: '1', day: 0, hour: 13, meaning: 'open' },
      { c: 1, item: 'Deep clean', qty: '1', day: 1, hour: 9, meaning: 'open' },
      { c: 4, item: 'Extra hour', qty: '2', day: 3, hour: 14, meaning: 'open' },
    ],
  },
  appointments: {
    customers, equipment: ['Chair 1', 'Chair 2', 'Wash station'],
    prices: { Haircut: '45', Color: '120', 'Grooming, small dog': '65', 'Tutoring session': '55' },
    work: [
      { c: 2, item: 'Haircut', qty: '1', day: -2, hour: 10, minutes: 45, meaning: 'finished' },
      { c: 4, item: 'Color', qty: '1', day: -1, hour: 13, minutes: 90, meaning: 'finished' },
      { c: 0, item: 'Grooming, large dog', qty: '1', day: -1, hour: 15, minutes: 60, meaning: 'finished' },
      { c: 3, item: 'Haircut', qty: '1', day: 0, hour: 9, minutes: 45, meaning: 'active' },
      { c: 2, item: 'Tutoring session', qty: '1', day: 0, hour: 15, minutes: 60, meaning: 'open' },
      { c: 1, item: 'Color', qty: '1', day: 1, hour: 11, minutes: 90, meaning: 'open' },
      { c: 4, item: 'Haircut', qty: '1', day: 2, hour: 16, minutes: 45, meaning: 'open' },
    ],
  },
  orders: {
    customers, equipment: ['Delivery van'],
    prices: { 'Custom cake': '85', 'Dozen cupcakes': '36', 'Delivery fee': '15' },
    work: [
      { c: 0, item: 'Catering tray', qty: '3', day: -2, hour: 11, meaning: 'finished' },
      { c: 3, item: 'Dozen cupcakes', qty: '4', day: -1, hour: 9, meaning: 'finished' },
      { c: 2, item: 'Custom cake', qty: '1', day: -1, hour: 16, meaning: 'finished' },
      { c: 4, item: 'Custom cake', qty: '1', day: 0, hour: 10, meaning: 'active' },
      { c: 1, item: 'Dozen cupcakes', qty: '2', day: 0, hour: 15, meaning: 'open' },
      { c: 0, item: 'Catering tray', qty: '5', day: 2, hour: 12, meaning: 'open' },
    ],
  },
  general: {
    customers, equipment: [],
    prices: {},
    work: [
      { c: 0, item: '', qty: '1', day: -1, hour: 10, meaning: 'finished', title: 'Site visit' },
      { c: 2, item: '', qty: '1', day: 0, hour: 9, meaning: 'active', title: 'Repair' },
      { c: 3, item: '', qty: '1', day: 0, hour: 14, meaning: 'open', title: 'Consultation' },
      { c: 4, item: '', qty: '1', day: 2, hour: 11, meaning: 'open', title: 'Follow-up' },
    ],
  },
};
