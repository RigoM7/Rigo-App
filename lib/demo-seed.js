/* Rigo demo workspace: a versioned recipe of ordinary actions, applied through the app's own
   business rules. Everything here is fictional. Used by the browser (window.RigoDemoSeed) and by
   tests (require). Bump VERSION whenever the recipe changes; stored demos from an older version
   are replaced on next open. */
(function (root) {
  const VERSION = 6;
  const NAME = 'Prairie Services Co. (demo)';
  const FIELD_EMAIL = 'sam.ortiz@demo.invalid';
  function build(domain, today = new Date()) {
    const day = offset => { const d = new Date(today); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-CA'); };
    let s = domain.createState(NAME);
    const act = (action, role = 'Owner') => { s = domain.applyAction(s, action, role); return s; };
    const id = (listId, code) => s.lists.find(l => l.id === listId).rows.find(r => r.values.code === code).id;
    const job = title => s.jobs.find(j => j.title === title);
    act({ type: 'applyTemplate', template: 'combined' });
    act({ type: 'configure', name: NAME, modules: [...s.modules, 'Billing & payments', 'Reporting'] });
    const records = {
      clients: [['C-101', 'Ridgeway Builders'], ['C-102', 'Maple Event Hall'], ['C-103', 'Hilltop Farm Co-op'], ['C-104', 'Lakeside RV Park']],
      services: [
        ['S-1', 'Portable toilet delivery', { rate: '125', unit: 'each', serviceInterval: 'One-time' }],
        ['S-2', 'Portable toilet weekly service', { rate: '35', unit: 'each', serviceInterval: 'Weekly' }],
        ['S-3', 'Diesel delivery', { rate: '4.25', unit: 'gallon', fuelType: 'Diesel', serviceInterval: 'One-time' }],
        ['S-4', 'Septic pump-out', { rate: '325', unit: 'visit', serviceInterval: 'One-time' }],
        ['S-5', 'Grease trap pump-out (no price yet)', { unit: 'visit', serviceInterval: 'One-time' }]
      ],
      employees: [['T-1', 'Dana Reyes', { role: 'Dispatcher', phone: '555-0100' }], ['T-2', 'Sam Ortiz', { role: 'Driver/Field', phone: '555-0101' }],
        ['T-3', 'Alex Kim', { role: 'Driver/Field', phone: '555-0102' }], ['T-4', 'Jordan Lee', { role: 'Driver/Field', phone: '555-0103' }]],
      vehicles: [['V-1', 'Truck 900 · vacuum', { type: 'Vacuum truck', capacity: '3000', capacityUnit: 'gallon', plate: 'DEMO-900' }],
        ['V-2', 'Truck 901 · fuel', { type: 'Fuel tanker', capacity: '2800', capacityUnit: 'gallon', plate: 'DEMO-901' }],
        ['V-3', 'Truck 902 · flatbed', { type: 'Flatbed', capacity: '12', capacityUnit: 'each', plate: 'DEMO-902' }]],
      equipment: [1, 2, 3, 4, 5, 6, 7, 8].map(n => [`U-${n}`, `Unit ${n}`, { type: 'Portable toilet', status: 'Available', unitType: n === 8 ? 'ADA' : 'Standard' }])
        .concat([['U-9', 'Hand wash 1', { type: 'Hand wash', status: 'Available', unitType: 'Hand wash station' }]])
    };
    for (const [listId, rows] of Object.entries(records)) for (const [code, name, extra] of rows) act({ type: 'record', listId, values: { code, name, ...(extra || {}) } });
    const locations = [
      ['L-201', 'Ridgeway jobsite', 'C-101', { address: '100 Sample Way', city: 'Fairview', state: 'TX', postalCode: '79000', type: 'Construction site', lat: '33.5779', lng: '-101.8552', contactName: 'Pat (site lead)', contactPhone: '555-0110', accessNotes: 'Gate code 0000 (fictional).' }],
      ['L-202', 'Maple Event Hall', 'C-102', { address: '200 Example St', city: 'Fairview', state: 'TX', postalCode: '79001', type: 'Event venue', lat: '33.5501', lng: '-101.9002' }],
      ['L-203', 'Hilltop farm tank', 'C-103', { address: '3 County Rd', city: 'Fairview', state: 'TX', postalCode: '79002', type: 'Farm', tankCapacity: '1000', lat: '33.6102', lng: '-101.7801' }],
      ['L-204', 'Lakeside RV septic', 'C-104', { address: '44 Shore Ln', city: 'Fairview', state: 'TX', postalCode: '79003', type: 'RV park', tankSize: '1500', lidLocation: 'North of office', lat: '33.5203', lng: '-101.8104' }]
    ];
    for (const [code, name, client, extra] of locations) act({ type: 'record', listId: 'locations', values: { code, name, client: id('clients', client), ...extra } });
    const base = { priority: 'Normal', dispatcher: 'Dana Reyes' };
    const plan = [
      { title: 'Deliver 4 units to Ridgeway jobsite', clientId: 'C-101', serviceId: 'S-1', locationId: 'L-201', quantity: 4, date: day(0), notes: 'Place units by the site trailer.', employeeId: 'T-2', vehicleId: 'V-3', equipment: ['U-1', 'U-2', 'U-3', 'U-4'] },
      { title: '600 gal diesel to Hilltop tank', clientId: 'C-103', serviceId: 'S-3', locationId: 'L-203', quantity: 600, date: day(0), employeeId: 'T-3', vehicleId: 'V-2' },
      { title: 'Pump-out at Lakeside RV', clientId: 'C-104', serviceId: 'S-4', locationId: 'L-204', quantity: 1, date: day(0), employeeId: 'T-4', vehicleId: 'V-1' },
      { title: 'Weekly service · Maple Event Hall', clientId: 'C-102', serviceId: 'S-2', locationId: 'L-202', quantity: 6, date: day(1) },
      { title: 'Diesel top-up · Ridgeway', clientId: 'C-101', serviceId: 'S-3', locationId: 'L-201', quantity: 300, date: day(-2), employeeId: 'T-3', vehicleId: 'V-2' },
      { title: 'Pump-out · Hilltop farmhouse', clientId: 'C-103', serviceId: 'S-4', locationId: 'L-203', quantity: 1, date: day(-3), employeeId: 'T-4', vehicleId: 'V-1' },
      { title: 'Grease trap · Lakeside RV', clientId: 'C-104', serviceId: 'S-5', locationId: 'L-204', quantity: 1, date: day(-1), employeeId: 'T-4', vehicleId: 'V-1' },
      { title: 'Event units · Maple Event Hall', clientId: 'C-102', serviceId: 'S-1', locationId: 'L-202', quantity: 2, date: day(-5), employeeId: 'T-2', vehicleId: 'V-3', equipment: ['U-8', 'U-9'] }
    ];
    for (const p of plan) {
      act({ type: 'job', job: { ...base, title: p.title, clientId: id('clients', p.clientId), serviceId: id('services', p.serviceId), locationId: id('locations', p.locationId), quantity: p.quantity, date: p.date, notes: p.notes || '' } });
      if (p.employeeId) {
        const j = job(p.title);
        act({ type: 'assign', id: j.id, jobRevision: j.revision, employeeId: id('employees', p.employeeId), vehicleId: id('vehicles', p.vehicleId),
          ...(p.equipment ? { equipmentIds: p.equipment.map(c => id('equipment', c)) } : {}) });
      }
    }
    const move = (title, status) => { const j = job(title); act({ type: 'jobStatus', id: j.id, jobRevision: j.revision, status }); };
    const accept = title => { const j = job(title); act({ type: 'acknowledge', id: j.id, jobRevision: j.revision, status: 'Accepted' }); };
    const complete = (title, quantity, notes) => { const j = job(title); act({ type: 'complete', id: j.id, jobRevision: j.revision, checks: {}, quantity, notes }); };
    // Today: one accepted and en route, one on site, one waiting for the driver to accept.
    accept('600 gal diesel to Hilltop tank'); move('600 gal diesel to Hilltop tank', 'En Route');
    accept('Pump-out at Lakeside RV'); move('Pump-out at Lakeside RV', 'En Route'); move('Pump-out at Lakeside RV', 'On Site');
    // Earlier: completed work. Delivered quantity can differ from the request.
    for (const t of ['Diesel top-up · Ridgeway', 'Pump-out · Hilltop farmhouse', 'Event units · Maple Event Hall', 'Grease trap · Lakeside RV']) { accept(t); move(t, 'En Route'); move(t, 'On Site'); }
    complete('Diesel top-up · Ridgeway', 285, 'Tank full at 285 gal.');
    complete('Pump-out · Hilltop farmhouse', 1, 'Tank pumped, lid resealed.');
    complete('Event units · Maple Event Hall', 2, 'Units placed by the stage door.');
    // Booked without a price: shows how Rigo asks for a confirmed price instead of invoicing $0.
    complete('Grease trap · Lakeside RV', 1, 'Trap pumped; price to be confirmed.');
    act({ type: 'invoice', jobId: job('Diesel top-up · Ridgeway').id });
    act({ type: 'invoice', jobId: job('Pump-out · Hilltop farmhouse').id });
    const paid = s.invoices.find(i => i.jobId === job('Pump-out · Hilltop farmhouse').id);
    act({ type: 'payment', id: paid.id, amount: paid.total, reference: 'Check 1001 (fictional)' });
    // Milestone D examples: assisted mode, a recurring service, an approval rule and a reported delay.
    act({ type: 'automation', default: 'assisted' });
    act({ type: 'approvalRule', action: 'invoice', minTotal: 1000, role: 'Owner', backupRole: 'Administrator' });
    act({ type: 'series', series: { title: 'Weekly toilet service · Ridgeway', clientId: id('clients', 'C-101'), serviceId: id('services', 'S-2'), locationId: id('locations', 'L-201'), quantity: 4, every: { unit: 'week', interval: 1 }, startDate: day(2), timeZone: 'America/Chicago' } });
    act({ type: 'generateVisits', from: day(0), until: day(14) });
    act({ type: 'invoice', jobId: job('Event units · Maple Event Hall').id });
    act({ type: 'job', job: { ...base, title: 'Bulk diesel · Hilltop', clientId: id('clients', 'C-103'), serviceId: id('services', 'S-3'), locationId: id('locations', 'L-203'), quantity: 400, date: day(-1), notes: '' } });
    { const j = job('Bulk diesel · Hilltop'); act({ type: 'assign', id: j.id, jobRevision: j.revision, employeeId: id('employees', 'T-3'), vehicleId: id('vehicles', 'V-2') }); }
    accept('Bulk diesel · Hilltop'); move('Bulk diesel · Hilltop', 'En Route'); move('Bulk diesel · Hilltop', 'On Site');
    complete('Bulk diesel · Hilltop', 400, 'Tank filled.');
    act({ type: 'invoice', jobId: job('Bulk diesel · Hilltop').id });
    { const j = job('Pump-out at Lakeside RV'); act({ type: 'reportIssue', id: j.id, kind: 'delay', note: 'Gate locked; waiting for the park manager (fictional).' }); }
    // The driver used by the "Field employee" role preview. Fictional address; never contacted.
    s.lists.find(l => l.id === 'employees').rows.find(r => r.values.code === 'T-2').accountEmail = FIELD_EMAIL;
    s.id = 'demo-workspace';
    s.demo = true;
    s.demoSeed = VERSION;
    return s;
  }
  const api = { VERSION, NAME, FIELD_EMAIL, build };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RigoDemoSeed = api;
})(typeof window === 'undefined' ? globalThis : window);
