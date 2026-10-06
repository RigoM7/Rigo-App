// The critique's company: "Tri-County Field Services" (America/Chicago, 7.25% tax), its people,
// price list, customers and trucks. `fixtureServices()` is pure (for billing unit tests);
// `triCounty()` builds the whole company through the API (for server tests).
import { starterService, type ServiceInput } from '../../src/shared/services.js';
import { signup, invite, Client } from '../helpers.js';

const set = (svc: ServiceInput, rates: Record<string, Partial<ServiceInput['pricing'][number]>>) => {
  for (const p of svc.pricing) if (p.id in rates) Object.assign(p, rates[p.id]);
  return svc;
};

/** The fixture price list, rates in ten-thousandths of a dollar (owner decision D3). */
export function fixtureServices() {
  const fuel = set(starterService('fuel'), {
    fuel_diesel: { rateE4: 38990, taxable: true },          // $3.899/gal
    fuel_dyed_diesel: { rateE4: 34990, taxable: false },    // off-road, tax-exempt use
    fuel_gasoline: { rateE4: 35990, taxable: true },
    fuel_heating_oil: { rateE4: 32990, taxable: false },
    delivery: { rateE4: 250000, taxable: true },            // $25 delivery fee
    after_hours: { rateE4: 1500000, taxable: true },        // $150 after-hours fee
  });
  fuel.taxRateBp = 725;
  const septic = set(starterService('septic'), {
    pump_out: { rateE4: 3750000, overageRateE4: 3500 },     // $375 including 1,000 gal, then $0.35/gal
    inspection: { rateE4: 2950000 },                        // $295
    grease_trap: { rateE4: 9500, minimumMinor: 20000 },     // $0.95/gal, $200 minimum
    repair_visit: { rateE4: 1250000 },
    after_hours: { rateE4: 1500000 },
  });
  const toilet = set(starterService('portable_toilet'), { visit: { rateE4: 450000 } }); // extra service $45
  return { fuel, septic, toilet };
}

export interface TriCounty {
  cid: string;
  dana: Client; marcus: Client; priya: Client; luis: Client; sam: Client; jo: Client; tyler: Client;
  ids: Record<'luis' | 'sam' | 'jo' | 'tyler' | 'marcus' | 'priya' | 'dana', string>;
  services: Record<'fuel' | 'septic' | 'portable_toilet', { id: string; version: number }>;
  customers: Record<string, { id: string; locationId: string }>;
  trucks: Record<string, string>;
}

/** Build Tri-County through the API: owner Dana, dispatcher Marcus, office Priya, drivers Luis, Sam, Jo and Tyler. */
export async function triCounty(): Promise<TriCounty> {
  const dana = await signup('Dana');
  const people = { marcus: await signup('Marcus'), priya: await signup('Priya'), luis: await signup('Luis'), sam: await signup('Sam'), jo: await signup('Jo'), tyler: await signup('Tyler') };
  const r = await dana.post('/companies', { name: 'Tri-County Field Services', timezone: 'America/Chicago', currency: 'USD', categories: ['fuel', 'portable_toilet', 'septic'], start: 'starter' });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  const cid = r.body.id as string;
  await invite(dana, cid, people.marcus, 'dispatcher');
  await invite(dana, cid, people.priya, 'office');
  for (const d of ['luis', 'sam', 'jo', 'tyler'] as const) await invite(dana, cid, people[d], 'driver');
  const ids = Object.fromEntries(await Promise.all([['dana', dana] as const, ...Object.entries(people)].map(async ([k, c]) => [k, (await c.get('/auth/me')).body.user.id]))) as TriCounty['ids'];

  const defs = fixtureServices();
  const list = (await dana.get(`/c/${cid}/services`)).body.services;
  const services = {} as TriCounty['services'];
  for (const [cat, def] of [['fuel', defs.fuel], ['septic', defs.septic], ['portable_toilet', defs.toilet]] as const) {
    const s = list.find((x: any) => x.category === cat);
    const put = await dana.put(`/c/${cid}/services/${s.id}`, { service: def, version: s.version });
    if (put.status !== 200) throw new Error(`service ${cat}: ${JSON.stringify(put.body)}`);
    services[cat] = { id: s.id, version: s.version + 1 };
  }

  const customers: TriCounty['customers'] = {};
  const cust = async (key: string, body: Record<string, unknown>) => {
    const c = await dana.post(`/c/${cid}/customers`, body);
    if (c.status !== 200) throw new Error(`customer ${key}: ${JSON.stringify(c.body)}`);
    const d = await dana.get(`/c/${cid}/customers/${c.body.id}`);
    customers[key] = { id: c.body.id, locationId: d.body.locations[0]?.id };
  };
  await cust('hollis', { name: 'Hollis Family Farm', email: 'hollis@example.test', phone: '(555) 201-0001', taxExempt: true, taxExemptNote: 'Farm exemption certificate F-1029', location: { address: '4410 County Rd 9, Millbrook', accessInstructions: 'Dyed diesel tank by the machine shed.' } });
  await cust('ridgeline', { name: 'Ridgeline Construction', email: 'ap@ridgeline.example', phone: '(555) 201-0002', location: { label: 'North yard', address: '12 Quarry Rd, Millbrook' } });
  for (const [label, address] of [['Elm St site', '88 Elm St, Fairview'], ['Route 30 site', '3030 Route 30, Fairview']]) {
    await dana.post(`/c/${cid}/customers/${customers.ridgeline.id}/locations`, { label, address });
  }
  await cust('grace', { name: 'Grace Okafor', email: 'grace@example.test', phone: '(555) 201-0003', location: { address: '812 Willow Ln, Fairview', accessInstructions: 'Fill pipe on the north wall.' } });
  await cust('brigid', { name: 'St. Brigid Church', phone: '(555) 201-0004', location: { address: '1 Church St, Millbrook', accessInstructions: 'Generator behind the hall.' } });
  await cust('harbor', { name: 'Harbor & Vine Events', email: 'events@harborvine.example', location: { address: '77 Harbor Rd, Lakeside' } });
  await cust('jose', { name: 'José Núñez', phone: '(555) 201-0006', location: { address: '9 Sycamore Ct, Fairview' } });
  await cust('dragon', { name: 'Lucky Dragon', phone: '(555) 201-0007', location: { address: '200 Main St, Millbrook', accessInstructions: 'Grease trap behind the kitchen.' } });

  const trucks: Record<string, string> = {};
  for (const [name, kind, capacity, status] of [
    ['Tank wagon 1', 'truck', '3,000 gal', 'available'], ['Tank wagon 2', 'truck', '2,500 gal', 'available'],
    ['Vac truck 1', 'truck', '3,500 gal', 'out_of_service'], ['Vac truck 2', 'truck', '3,500 gal', 'available'],
    ['Toilet truck 1', 'truck', '8 units', 'available'],
    ...['PT-101', 'PT-102', 'PT-103', 'PT-104', 'PT-105'].map((n) => [n, 'unit', '', 'available']),
  ] as const) {
    const t = await dana.post(`/c/${cid}/resources`, { kind, name, capacity, status });
    if (t.status !== 200) throw new Error(`resource ${name}: ${JSON.stringify(t.body)}`);
    trucks[name] = t.body.id;
  }
  return { cid, dana, ...people, ids, services, customers, trucks };
}
