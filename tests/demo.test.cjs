const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../lib/domain.cjs');
const seed = require('../lib/demo-seed.js');

test('the demo is built through the business rules and is clearly fictional', () => {
  const today = new Date('2026-10-05T12:00:00');
  const s = seed.build(domain, today);
  assert.equal(s.demo, true);
  assert.equal(s.demoSeed, seed.VERSION);
  assert.equal(s.id, 'demo-workspace');
  assert.match(s.name, /\(demo\)$/);
  const services = s.lists.find(l => l.id === 'services').rows.map(r => r.values.name);
  for (const kind of [/toilet/i, /diesel/i, /septic/i]) assert.ok(services.some(n => kind.test(n)), 'covers ' + kind);
  // Today's work, work in progress, completion examples and invoices.
  const statuses = s.jobs.map(j => j.status);
  for (const status of ['Call Received', 'Dispatched', 'En Route', 'On Site', 'Completed']) assert.ok(statuses.includes(status), status);
  assert.ok(s.jobs.some(j => j.date === '2026-10-05'));
  assert.ok(s.invoices.length >= 2 && s.invoices.every(i => i.total > 0));
  assert.ok(s.invoices.some(i => i.paid === i.total) && s.invoices.some(i => i.paid === 0));
  // Fictional contact details only: no real-looking emails and reserved test domains.
  const text = JSON.stringify(s);
  for (const email of text.match(/[\w.+-]+@[\w.-]+/g) || []) assert.match(email, /@demo\.invalid$/);
  assert.ok(!/370 Enviro/i.test(text));
  assert.ok(!s.integrations && !s.members.length, 'no credentials, integrations or members');
  // A field employee is linked for the role preview.
  assert.ok(domain.employeeFor(s, seed.FIELD_EMAIL));
});

test('the same recipe gives the same structure every time', () => {
  const shape = s => s.jobs.map(j => [j.title, j.status, j.quantity]).concat(s.lists.map(l => [l.id, l.rows.length]));
  const today = new Date('2026-10-05T12:00:00');
  assert.deepEqual(shape(seed.build(domain, today)), shape(seed.build(domain, today)));
});
