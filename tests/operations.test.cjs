// Milestone C: quantities, billing and prices stay reliable and explainable.
const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../lib/domain.cjs');
const seed = require('../lib/demo-seed.js');

const act = (s, action, role = 'Owner') => domain.applyAction(s, action, role);
const rowId = (s, list, code) => s.lists.find(l => l.id === list).rows.find(r => r.values.code === code).id;
function company() {
  let s = domain.createState('Test Co');
  s = act(s, { type: 'applyTemplate', template: 'combined' });
  s = act(s, { type: 'record', listId: 'clients', values: { code: 'C-1', name: 'Client' } });
  s = act(s, { type: 'record', listId: 'services', values: { code: 'S-1', name: 'Diesel', rate: '4', unit: 'gallon' } });
  s = act(s, { type: 'record', listId: 'services', values: { code: 'S-2', name: 'Unpriced pump-out', unit: 'visit' } });
  return s;
}
const addJob = (s, service, quantity) => act(s, { type: 'job', job: { title: 'Job ' + service, clientId: rowId(s, 'clients', 'C-1'), serviceId: rowId(s, 'services', service), quantity, date: '2026-10-06' } });
const finish = (s, extra = {}, role = 'Owner') => { const j = s.jobs.at(-1); return act(s, { type: 'complete', id: j.id, jobRevision: j.revision, checks: {}, quantity: 285, notes: '', ...extra }, role); };

test('completion keeps requested, actual, billable and equipment quantities', () => {
  let s = finish(addJob(company(), 'S-1', 300));
  const j = s.jobs.at(-1);
  assert.deepEqual([j.requestedQuantity, j.actualQuantity, j.billableQuantity, j.quantity, j.equipmentQuantity], [300, 285, 285, 285, 0]);
  s = act(s, { type: 'invoice', jobId: j.id });
  const invoice = s.invoices.at(-1);
  assert.deepEqual([invoice.requestedQuantity, invoice.actualQuantity, invoice.quantity, invoice.rate, invoice.total], [300, 285, 285, 4, 1140]);
});

test('billing a different quantity needs owner or administrator authority and a reason', () => {
  const s = addJob(company(), 'S-1', 300);
  assert.throws(() => finish(s, { billableQuantity: 250 }, 'Dispatcher'), /Only owners and administrators can bill a different quantity/);
  assert.throws(() => finish(s, { billableQuantity: 250 }), /Give a reason/);
  const done = finish(s, { billableQuantity: 250, billableReason: 'Agreed minimum not reached; customer discount' }, 'Administrator').jobs.at(-1);
  assert.deepEqual([done.actualQuantity, done.billableQuantity, done.quantity], [285, 250, 250]);
  assert.match(done.billableReason, /discount/);
  // The same number as delivered is not an override.
  const same = finish(s, { billableQuantity: 285 }, 'Dispatcher').jobs.at(-1);
  assert.equal(same.billableReason, undefined);
});

test('work booked without a price is not invoiced at $0; a confirmed price is recorded with its reason', () => {
  let s = finish(addJob(company(), 'S-2', 1), { quantity: 1 });
  const j = s.jobs.at(-1);
  assert.equal(j.rate, 0);
  assert.throws(() => act(s, { type: 'invoice', jobId: j.id }), /no price\. Confirm a price/);
  assert.throws(() => act(s, { type: 'confirmPrice', jobId: j.id, rate: 325, reason: 'Quoted' }, 'Dispatcher'), /Only owners and administrators/);
  assert.throws(() => act(s, { type: 'confirmPrice', jobId: j.id, rate: 0, reason: 'x' }), /greater than zero/);
  assert.throws(() => act(s, { type: 'confirmPrice', jobId: j.id, rate: 325 }), /reason/);
  s = act(s, { type: 'confirmPrice', jobId: j.id, rate: 325, reason: 'Price quoted by phone' });
  const priced = s.jobs.at(-1);
  assert.equal(priced.rate, 325);
  assert.deepEqual(priced.priceHistory.map(p => [p.from, p.to, p.reason]), [[0, 325, 'Price quoted by phone']]);
  s = act(s, { type: 'invoice', jobId: j.id });
  assert.equal(s.invoices.at(-1).total, 325);
  assert.throws(() => act(s, { type: 'confirmPrice', jobId: j.id, rate: 400, reason: 'Later change' }), /already invoiced/);
});

test('history is never recalculated: later service price changes leave completed jobs and invoices alone', () => {
  let s = finish(addJob(company(), 'S-1', 300));
  const j = s.jobs.at(-1);
  s = act(s, { type: 'invoice', jobId: j.id });
  const service = s.lists.find(l => l.id === 'services').rows.find(r => r.values.code === 'S-1');
  s = act(s, { type: 'record', listId: 'services', id: service.id, values: { ...service.values, rate: '9' } });
  assert.equal(s.jobs.find(x => x.id === j.id).rate, 4);
  assert.equal(s.invoices.at(-1).total, 1140);
  // A job that was completed before this change keeps exactly what it had.
  const legacy = structuredClone(s.jobs.find(x => x.id === j.id));
  delete legacy.requestedQuantity; delete legacy.actualQuantity; delete legacy.billableQuantity;
  const normalized = structuredClone({ ...s, jobs: [legacy] });
  domain.normalize(normalized);
  assert.equal(normalized.jobs[0].requestedQuantity, undefined, 'old completed jobs are not given invented requests');
});

test('the demo shows a delivered amount that differs from the request', () => {
  const s = seed.build(domain, new Date('2026-10-05T12:00:00'));
  const diesel = s.jobs.find(j => j.title === 'Diesel top-up · Ridgeway');
  assert.deepEqual([diesel.requestedQuantity, diesel.actualQuantity, diesel.quantity], [300, 285, 285]);
});
