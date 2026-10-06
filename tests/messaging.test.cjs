// Milestone E: customer messages are prepared from company wording and client preferences.
// No provider is connected, so nothing is ever reported as sent.
const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../lib/domain.cjs');

const act = (s, action, role = 'Owner') => domain.applyAction(s, action, role);
function company() {
  let s = act(domain.createState('Test Co'), { type: 'applyTemplate', template: 'combined' });
  s = act(s, { type: 'record', listId: 'services', values: { code: 'S-1', name: 'Diesel', rate: '4', unit: 'gallon' } });
  return s;
}
const field = (s, name) => s.lists.find(l => l.id === 'clients').fields.find(f => f.name === name).id;
const client = (s, code, values) => act(s, { type: 'record', listId: 'clients', values: { code, name: 'Client ' + code, ...Object.fromEntries(Object.entries(values).map(([k, v]) => [field(s, k), v])) } });
const job = (s, code, extra = {}) => act(s, { type: 'job', job: { title: 'Job ' + code, clientId: s.lists.find(l => l.id === 'clients').rows.find(r => r.values.code === code).id, serviceId: s.lists.find(l => l.id === 'services').rows[0].id, quantity: 100, date: '2026-10-06', ...extra } });

test('messages are off until an owner turns them on; turning on adds contact fields', () => {
  let s = job(act(company(), { type: 'record', listId: 'clients', values: { code: 'C-0', name: 'Before' } }), 'C-0');
  assert.equal(s.outbox, undefined);
  assert.throws(() => act(s, { type: 'messaging', enabled: true }, 'Administrator'), /Only owners/);
  s = act(s, { type: 'messaging', enabled: true });
  assert.deepEqual(s.lists.find(l => l.id === 'clients').fields.filter(f => f.rigoContact).map(f => f.name), ['Email', 'Mobile phone', 'Contact by']);
  assert.equal(s.outbox, undefined, 'turning on does not message past work');
});

test('events prepare messages that respect preferences and are never marked sent', () => {
  let s = act(company(), { type: 'messaging', enabled: true });
  s = client(s, 'C-1', { Email: 'pat@example.com', 'Contact by': 'Email' });
  s = client(s, 'C-2', { 'Contact by': 'Do not contact', Email: 'no@example.com' });
  s = client(s, 'C-3', { 'Contact by': 'Text message' });
  s = job(s, 'C-1'); s = job(s, 'C-2'); s = job(s, 'C-3');
  const byClient = code => s.outbox.find(m => m.clientId === s.lists.find(l => l.id === 'clients').rows.find(r => r.values.code === code).id);
  assert.equal(byClient('C-1').status, 'not sent');
  assert.match(byClient('C-1').note, /No email or SMS provider/);
  assert.equal(byClient('C-1').to.email, 'pat@example.com');
  assert.match(byClient('C-1').body, /Hello Client C-1, your Diesel \(100 gallon\) is scheduled for 2026-10-06/);
  assert.equal(byClient('C-2').status, 'skipped');
  assert.match(byClient('C-2').note, /asked not to be contacted/);
  assert.match(byClient('C-3').note, /No mobile phone/);
  assert.ok(s.outbox.every(m => m.status !== 'sent'));
  // Completion and invoice events; the same event is never prepared twice.
  let j = s.jobs.find(x => x.title === 'Job C-1');
  s = act(s, { type: 'complete', id: j.id, jobRevision: j.revision, checks: {}, quantity: 90, notes: '' });
  s = act(s, { type: 'invoice', jobId: j.id });
  assert.deepEqual(s.outbox.filter(m => m.jobId === j.id).map(m => m.event).sort(), ['completion', 'confirmation', 'invoice']);
  assert.match(s.outbox.find(m => m.event === 'invoice').body, /\$360\.00, due/);
});

test('reminders are prepared on request, once per day, by dispatchers and above', () => {
  let s = act(company(), { type: 'messaging', enabled: true, templates: { reminder: { enabled: true, subject: 'See you {date}', body: 'Hi {client}' } } });
  s = client(s, 'C-1', { Email: 'pat@example.com' });
  s = job(s, 'C-1', { date: '2026-10-07' });
  assert.throws(() => act(s, { type: 'prepareMessages', kind: 'reminders', date: '2026-10-07' }, 'Viewer'));
  s = act(s, { type: 'prepareMessages', kind: 'reminders', date: '2026-10-07' }, 'Dispatcher');
  s = act(s, { type: 'prepareMessages', kind: 'reminders', date: '2026-10-07' }, 'Dispatcher');
  assert.equal(s.outbox.filter(m => m.event === 'reminder').length, 1);
  assert.equal(s.outbox.find(m => m.event === 'reminder').subject, 'See you 2026-10-07');
  const id = s.outbox[0].id;
  s = act(s, { type: 'messageState', id, status: 'dismissed' }, 'Dispatcher');
  assert.equal(s.outbox.find(m => m.id === id).status, 'dismissed');
});
