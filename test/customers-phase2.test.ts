import { describe, it, expect } from 'vitest';
import { triCounty, type TriCounty } from './fixtures/tricounty.js';
import { rid } from './helpers.js';
import { duplicateReasons, looselyMatches, fold, digits, jobNumberQuery, nameKey, streetLabel, townOf } from '../src/shared/customers.js';
import { fieldApplies, INSPECTION_FIELDS } from '../src/shared/services.js';
import { reportLines } from '../src/shared/report.js';

// WP8: duplicates, merge and undo, archive and delete, search, the customer page, bill-to and the
// inspection report.

describe('customer rules (R5-M1, R5-m1, R5-m5)', () => {
  it('folds accents, keeps phone digits, reads job numbers and labels a first location by its street', () => {
    expect(fold('José Núñez')).toBe('jose nunez');
    expect(digits('(555) 201-0003')).toBe('5552010003');
    expect(['54', '#54', 'job 54', 'Job #54', ' 54 '].map(jobNumberQuery)).toEqual([54, 54, 54, 54, 54]);
    expect(jobNumberQuery('54 Elm')).toBeNull();
    expect(streetLabel('812 Willow Ln, Fairview')).toBe('812 Willow Ln');
    expect(townOf('812 Willow Ln, Fairview, IL')).toBe('Fairview');
    expect(nameKey('The Ridgeline Construction, LLC')).toBe('ridgeline construction');
  });

  it('explains why two customers look alike, and stays quiet when they do not', () => {
    expect(duplicateReasons({ name: 'Jose Nunez' }, { name: 'José Núñez' })).toEqual(['Same name']);
    expect(duplicateReasons({ name: 'Ridgline Construction' }, { name: 'Ridgeline Construction' })).toEqual(['Similar name']);
    expect(duplicateReasons({ name: 'G. Okafor', phone: '555.201.0003' }, { name: 'Grace Okafor', phone: '(555) 201-0003' })).toEqual(['Same phone']);
    expect(duplicateReasons({ name: 'New Co', email: 'AP@Ridgeline.example' }, { name: 'Ridgeline', email: 'ap@ridgeline.example' })).toEqual(['Same email']);
    expect(duplicateReasons({ name: 'Someone', addresses: ['812 Willow Ln, Fairview'] }, { name: 'Grace', addresses: ['812 willow ln, fairview'] })).toEqual(['Same address']);
    expect(duplicateReasons({ name: 'Hollis Family Farm' }, { name: 'Harbor & Vine Events' })).toEqual([]);
    expect(duplicateReasons({ name: 'Bob' }, { name: 'Rob' })).toEqual([]);
    expect(looselyMatches('Grace Okafor', 'okafr')).toBe(true);
    expect(looselyMatches('José Núñez', 'nunes')).toBe(true);
    expect(looselyMatches('Harbor & Vine Events', 'okafor')).toBe(false);
  });
});

describe('duplicates, merge and archive (R5-M1, D14)', () => {
  it('warns before creating a likely duplicate, and creates it anyway when asked', async () => {
    const t = await triCounty();
    const r = await t.priya.post(`/c/${t.cid}/customers`, { name: 'Jose Nunez', phone: '555-201-0006' });
    expect(r.status).toBe(409);
    expect(r.body.error.details.needsConfirm).toBe('duplicate');
    expect(r.body.error.details.candidates).toEqual([expect.objectContaining({ id: t.customers.jose.id, name: 'José Núñez', reasons: ['Same name', 'Same phone'], firstAddress: '9 Sycamore Ct, Fairview' })]);
    const ok = await t.priya.post(`/c/${t.cid}/customers`, { name: 'Jose Nunez', phone: '555-201-0006', allowDuplicate: true, location: { address: '9 Sycamore Ct, Fairview' } });
    expect(ok.status).toBe(200);
    // The first location is labelled from its street, not "Location" (R5-m5).
    expect((await t.priya.get(`/c/${t.cid}/customers/${ok.body.id}`)).body.locations[0].label).toBe('9 Sycamore Ct');
    // Checking while editing leaves the customer itself out.
    const check = await t.priya.post(`/c/${t.cid}/customers/duplicates`, { name: 'José Núñez', exceptId: t.customers.jose.id });
    expect(check.body.candidates.map((x: any) => x.id)).toEqual([ok.body.id]);
  });

  it('merges a duplicate with its jobs, invoices and messages, keeps history, and undoes exactly that', async () => {
    const t = await triCounty();
    const dup = (await t.priya.post(`/c/${t.cid}/customers`, { name: 'G Okafor', email: 'grace.o@example.test', allowDuplicate: true, location: { address: '14 Birch Rd, Fairview' } })).body.id;
    const dupLoc = (await t.priya.get(`/c/${t.cid}/customers/${dup}`)).body.locations[0].id;
    const job = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: dup, locationId: dupLoc, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, intent: 'draft', clientRequestId: rid() });
    expect(job.status).toBe(200);
    const keepJobs = (await t.dana.get(`/c/${t.cid}/customers/${t.customers.grace.id}`)).body.jobs.length;
    // Drivers and dispatchers can't merge (D14: owners and office).
    expect((await t.marcus.post(`/c/${t.cid}/customers/${t.customers.grace.id}/merge`, { mergedId: dup })).status).toBe(403);
    const m = await t.priya.post(`/c/${t.cid}/customers/${t.customers.grace.id}/merge`, { mergedId: dup });
    expect(m.status).toBe(200);
    expect(m.body.moved).toMatchObject({ 'locations.customer_id': 1, 'jobs.customer_id': 1 });
    const kept = (await t.dana.get(`/c/${t.cid}/customers/${t.customers.grace.id}`)).body;
    expect(kept.locations.map((l: any) => l.address)).toContain('14 Birch Rd, Fairview');
    expect(kept.jobs.length).toBe(keepJobs + 1);
    expect(kept.customer.email).toBe('grace@example.test'); // not overwritten: only blanks are filled
    expect(kept.mergedFrom[0]).toMatchObject({ name: 'G Okafor', can_undo: true });
    // The merged one is archived, points to the kept one, and is gone from lists and pickers.
    const gone = (await t.dana.get(`/c/${t.cid}/customers/${dup}`)).body;
    expect(gone.customer.mergedInto).toBe(t.customers.grace.id);
    expect(gone.mergedInto.name).toBe('Grace Okafor');
    expect((await t.dana.get(`/c/${t.cid}/customers?q=okafor`)).body.customers.map((c: any) => c.id)).toEqual([t.customers.grace.id]);
    expect((await t.dana.get(`/c/${t.cid}/customers?archived=1`)).body.customers.map((c: any) => c.id)).toEqual([dup]);
    // In the activity log.
    expect((await t.dana.get(`/c/${t.cid}/activity`)).body.entries.some((e: any) => e.action === 'customer.merged' && e.detail.mergedName === 'G Okafor')).toBe(true);
    // Undo: the location and job go back; the duplicate is active again.
    expect((await t.priya.post(`/c/${t.cid}/customer-merges/${kept.mergedFrom[0].id}/undo`, {})).status).toBe(200);
    const back = (await t.dana.get(`/c/${t.cid}/customers/${dup}`)).body;
    expect(back.customer.archivedAt).toBeNull();
    expect(back.locations.map((l: any) => l.id)).toEqual([dupLoc]);
    expect(back.jobs.map((j: any) => j.id)).toEqual([job.body.id]);
    expect((await t.dana.get(`/c/${t.cid}/customers/${t.customers.grace.id}`)).body.jobs.length).toBe(keepJobs);
    expect((await t.priya.post(`/c/${t.cid}/customer-merges/${kept.mergedFrom[0].id}/undo`, {})).status).toBe(409);
  });

  it('archives only customers without open work, and deletes only customers never used', async () => {
    const t = await triCounty();
    const c = t.customers.harbor;
    await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.portable_toilet.id, details: { visit_type: 'Delivery', units: '2' }, intent: 'draft', clientRequestId: rid() });
    const a = await t.dana.post(`/c/${t.cid}/customers/${c.id}/archive`, {});
    expect(a.status).toBe(409);
    expect(a.body.error.message).toMatch(/has 1 open job/);
    const del = await t.dana.del(`/c/${t.cid}/customers/${c.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.message).toMatch(/Archive it instead/);
    // St. Brigid has no history: it can be archived, restored and deleted.
    const b = t.customers.brigid.id;
    expect((await t.dana.post(`/c/${t.cid}/customers/${b}/archive`, {})).status).toBe(200);
    expect((await t.dana.get(`/c/${t.cid}/customers`)).body.customers.some((x: any) => x.id === b)).toBe(false);
    expect((await t.dana.post(`/c/${t.cid}/customers/${b}/unarchive`, {})).status).toBe(200);
    expect((await t.luis.del(`/c/${t.cid}/customers/${b}`)).status).toBe(403);
    expect((await t.dana.del(`/c/${t.cid}/customers/${b}`)).status).toBe(200);
    expect((await t.dana.get(`/c/${t.cid}/customers/${b}`)).status).toBe(404);
  });
});

// Drivers who may look customers up, without contact details: the case for server-side removal.
const driversSeeCustomers = (t: TriCounty) => t.dana.patch(`/c/${t.cid}/roles/driver`, { permissions: ['jobs.view_assigned', 'jobs.work', 'resources.view', 'assistant.use', 'customers.view'] });

describe('search and the customer page (R5-m1, R17-M3, R5-m2, R5-m3)', () => {
  it('finds customers without accents or phone formatting, and shows the town and first address', async () => {
    const t = await triCounty();
    const byName = (await t.marcus.get(`/c/${t.cid}/customers?q=jose%20nunez`)).body.customers;
    expect(byName.map((c: any) => c.name)).toEqual(['José Núñez']);
    expect(byName[0]).toMatchObject({ firstAddress: '9 Sycamore Ct, Fairview', town: 'Fairview' });
    expect((await t.marcus.get(`/c/${t.cid}/customers?q=5552010003`)).body.customers.map((c: any) => c.name)).toEqual(['Grace Okafor']);
    expect((await t.marcus.get(`/c/${t.cid}/customers?q=willow`)).body.customers.map((c: any) => c.name)).toEqual(['Grace Okafor']);
    // A typo still finds them, marked as an approximate match (R5-m1).
    const typo = (await t.marcus.get(`/c/${t.cid}/customers?q=okafr`)).body;
    expect([typo.customers.map((c: any) => c.name), typo.approximate]).toEqual([['Grace Okafor'], true]);
    expect((await t.marcus.get(`/c/${t.cid}/customers?q=ridgline%20construction`)).body.customers.map((c: any) => c.name)).toEqual(['Ridgeline Construction']);
    expect((await t.marcus.get(`/c/${t.cid}/customers?q=zzzqqq`)).body.customers).toEqual([]);
    // People who aren't shown phone numbers can't search by them either.
    await driversSeeCustomers(t);
    expect((await t.luis.get(`/c/${t.cid}/customers?q=5552010003`)).body.customers).toEqual([]);
    expect((await t.luis.get(`/c/${t.cid}/customers?q=willow`)).body.customers.map((c: any) => [c.name, c.phone])).toEqual([['Grace Okafor', undefined]]);
  });

  it('puts the exact job number first in job search', async () => {
    const t = await triCounty();
    const c = t.customers.grace;
    const made = [];
    for (let i = 0; i < 3; i++) made.push((await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, intent: 'draft', clientRequestId: rid() })).body);
    for (const q of [`${made[1].number}`, `job ${made[1].number}`, `%23${made[1].number}`]) {
      expect((await t.dana.get(`/c/${t.cid}/jobs?q=${q}`)).body.jobs[0].number).toBe(made[1].number);
    }
  });

  it('answers "next visit" for everyone and "what do they owe" only for finance roles; the billing contact gets the invoices', async () => {
    const t = await triCounty();
    const c = t.customers.grace;
    const soon = new Date(Date.now() + 2 * 86400_000).toISOString();
    const later = new Date(Date.now() + 9 * 86400_000).toISOString();
    for (const start of [later, soon]) await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Heating oil' }, intent: 'open', clientRequestId: rid(), scheduledStart: start });
    const owner = (await t.dana.get(`/c/${t.cid}/customers/${c.id}`)).body;
    expect(owner.summary.nextVisit).toMatchObject({ service_name: 'Fuel delivery', address: '812 Willow Ln, Fairview' });
    expect(new Date(owner.summary.nextVisit.scheduled_start).toISOString()).toBe(soon);
    expect(owner.upcoming.map((j: any) => new Date(j.scheduled_start).toISOString())).toEqual([soon, later]);
    expect(owner.summary.owes).toEqual({ balanceMinor: 0, unpaid: 0, overdue: 0 });
    const dispatcher = (await t.marcus.get(`/c/${t.cid}/customers/${c.id}`)).body;
    expect(dispatcher.summary.nextVisit).not.toBeNull();
    expect(dispatcher.summary.owes).toBeNull();
    // A billing contact (R5-m3): contact details only for roles that see them.
    expect((await t.priya.patch(`/c/${t.cid}/customers/${c.id}`, { billingContact: { name: 'Okafor Accounts', email: 'billing@okafor.example', phone: '555-0100' }, version: owner.customer.version })).status).toBe(200);
    expect((await t.dana.get(`/c/${t.cid}/customers/${c.id}`)).body.customer.billingContact).toEqual({ name: 'Okafor Accounts', email: 'billing@okafor.example', phone: '555-0100' });
    await driversSeeCustomers(t);
    expect((await t.luis.get(`/c/${t.cid}/customers/${c.id}`)).body.customer.billingContact).toEqual({ name: 'Okafor Accounts' });
  });

  it('keeps a site contact phone and location fields; drivers see only the fields marked for them (R5-M2)', async () => {
    const t = await triCounty();
    expect((await t.dana.patch(`/c/${t.cid}/settings`, { customFields: { customers: [], jobs: [], locations: [
      { key: 'gate_code', label: 'Gate code', type: 'text', driverVisible: true }, { key: 'account_no', label: 'Utility account', type: 'text' }] } })).status).toBe(200);
    const c = t.customers.grace;
    expect((await t.dana.patch(`/c/${t.cid}/locations/${c.locationId}`, { siteContactPhone: '555-0142', custom: { gate_code: '#4412', account_no: 'U-77' } })).status).toBe(200);
    const job = (await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.fuel.id, details: { product: 'Diesel' }, intent: 'open', clientRequestId: rid(), scheduledStart: new Date(Date.now() + 3600_000).toISOString() })).body;
    const j = (await t.dana.get(`/c/${t.cid}/jobs/${job.id}`)).body;
    expect(j.location.custom).toEqual({ gate_code: '#4412', account_no: 'U-77' });
    expect(j.locationFields.map((f: any) => f.key)).toEqual(['gate_code', 'account_no']);
    await t.dana.post(`/c/${t.cid}/jobs/${job.id}/assign`, { userId: t.ids.luis, resourceIds: [], version: j.job.version });
    const mine = (await t.luis.get(`/c/${t.cid}/my/jobs`)).body.jobs.find((x: any) => x.id === job.id);
    expect(mine.site_fields).toEqual([{ label: 'Gate code', value: '#4412' }]);
    expect(mine.site_contact_phone).toBe('555-0142');
    // Another driver opening the customer doesn't get the phone number.
    await driversSeeCustomers(t);
    expect((await t.sam.get(`/c/${t.cid}/customers/${c.id}`)).body.locations[0].site_contact_phone).toBeUndefined();
  });
});

describe('bill-to and the inspection report (R6-M4)', () => {
  async function inspection(t: TriCounty, billTo?: string) {
    const c = t.customers.grace;
    const r = await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.septic.id, billToCustomerId: billTo, details: { service_detail: 'Inspection' }, intent: 'open', clientRequestId: rid(), scheduledStart: new Date(Date.now() + 3600_000).toISOString() });
    expect(r.status).toBe(200);
    const job = (await t.dana.get(`/c/${t.cid}/jobs/${r.body.id}`)).body.job;
    const a = await t.dana.post(`/c/${t.cid}/jobs/${job.id}/assign`, { userId: t.ids.sam, resourceIds: [], version: job.version });
    return { id: job.id as string, version: a.body.version as number, number: job.number as number };
  }
  const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it('asks the inspection checklist only on inspections', async () => {
    expect(fieldApplies(INSPECTION_FIELDS[0], {})).toBe(true);
    const tank = { ...INSPECTION_FIELDS[0], when: { field: 'service_detail', equals: 'Inspection' } };
    expect(fieldApplies(tank, { service_detail: 'Pump-out' })).toBe(false);
    expect(fieldApplies(tank, { service_detail: 'Inspection' })).toBe(true);
    const t = await triCounty();
    const job = await inspection(t);
    // Required findings are asked for on an inspection…
    const miss = await t.sam.post(`/c/${t.cid}/jobs/${job.id}/complete`, { submissionId: rid(), baseVersion: job.version, outcome: 'completed', values: {}, photos: [photo] });
    expect(miss.status).toBe(400);
    expect(Object.keys(miss.body.error.details.fields).sort()).toEqual(['recommendation', 'tank_condition']);
    // …but not on a pump-out, where they'd be dropped if sent.
    const c = t.customers.grace;
    const p = (await t.dana.post(`/c/${t.cid}/jobs`, { customerId: c.id, locationId: c.locationId, serviceId: t.services.septic.id, details: { service_detail: 'Pump-out' }, intent: 'open', clientRequestId: rid() })).body;
    const pj = (await t.dana.get(`/c/${t.cid}/jobs/${p.id}`)).body.job;
    const pa = await t.dana.post(`/c/${t.cid}/jobs/${p.id}/assign`, { userId: t.ids.sam, resourceIds: [], version: pj.version });
    const done = await t.sam.post(`/c/${t.cid}/jobs/${p.id}/complete`, { submissionId: rid(), baseVersion: pa.body.version, outcome: 'completed', values: { volume_pumped: '900', tank_condition: 'Poor' }, photos: [photo] });
    expect(done.status).toBe(200);
    expect((await t.dana.get(`/c/${t.cid}/jobs/${p.id}`)).body.job.completion.values).toEqual({ volume_pumped: '900' });
  });

  it('bills the realtor, and prepares the report email for them without sending it', async () => {
    const t = await triCounty();
    const realtor = (await t.priya.post(`/c/${t.cid}/customers`, { name: 'Lakeside Realty', email: 'office@lakeside.example', billingContact: { name: 'AP', email: 'ap@lakeside.example' } })).body.id;
    const job = await inspection(t, realtor);
    const d = (await t.dana.get(`/c/${t.cid}/jobs/${job.id}`)).body;
    expect(d.billTo).toEqual({ id: realtor, name: 'Lakeside Realty' });
    // The realtor's page lists the job too.
    expect((await t.dana.get(`/c/${t.cid}/customers/${realtor}`)).body.jobs.map((j: any) => j.id)).toEqual([job.id]);
    // The report can't be prepared before the visit is recorded.
    expect((await t.priya.post(`/c/${t.cid}/jobs/${job.id}/report-message`, {})).status).toBe(409);
    const values = { tank_condition: 'Fair', sludge_depth: '14', baffles_intact: true, drainfield_ok: false, recommendation: 'Pump within 6 months. Outlet baffle cracked.' };
    expect((await t.sam.post(`/c/${t.cid}/jobs/${job.id}/complete`, { submissionId: rid(), baseVersion: job.version, outcome: 'completed', values, photos: [photo], notes: 'Lid replaced.' })).status).toBe(200);
    const inv = await t.dana.post(`/c/${t.cid}/jobs/${job.id}/invoice`);
    expect(inv.status).toBe(200);
    const invoice = (await t.dana.get(`/c/${t.cid}/invoices/${inv.body.invoiceId}`)).body;
    expect(invoice.invoice).toMatchObject({ customerId: realtor, customerName: 'Lakeside Realty', customerEmail: 'ap@lakeside.example' });
    // The report email goes to the realtor's billing contact, prepared, not sent; asking twice reuses it.
    const r1 = await t.priya.post(`/c/${t.cid}/jobs/${job.id}/report-message`, {});
    expect(r1.status).toBe(200);
    expect((await t.priya.post(`/c/${t.cid}/jobs/${job.id}/report-message`, {})).body).toEqual({ messageId: r1.body.messageId, already: true });
    const msg = (await t.priya.get(`/c/${t.cid}/messages`)).body.messages.find((m: any) => m.id === r1.body.messageId);
    expect(msg).toMatchObject({ status: 'prepared', recipient: 'ap@lakeside.example', subject: 'Inspection report: 812 Willow Ln, Fairview' });
    expect(msg.body).toContain('- Tank condition: Fair');
    expect(msg.body).toContain('- Sludge depth: 14 in');
    expect(msg.body).toContain('- Drain field: no pooling, odor or wet spots: No');
    expect(msg.body).toContain('1 photo was taken on site.');
    // Drivers can't prepare customer emails.
    expect((await t.sam.post(`/c/${t.cid}/jobs/${job.id}/report-message`, {})).status).toBe(403);
    // The printed report's lines match.
    const svc = (await t.dana.get(`/c/${t.cid}/services`)).body.services.find((s: any) => s.id === t.services.septic.id);
    const lines = reportLines(svc.fields, { service_detail: 'Inspection' }, values);
    expect(lines.request).toEqual([{ label: 'Service details', value: 'Inspection' }]);
    expect(lines.findings.map((l) => l.label)).toEqual(['Tank condition', 'Sludge depth', 'Inlet and outlet baffles intact', 'Drain field: no pooling, odor or wet spots', 'Findings and recommendation']);
  });
});
