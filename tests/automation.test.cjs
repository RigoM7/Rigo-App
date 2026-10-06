// Milestone D: automation modes, approvals, exceptions and recurring service.
const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../lib/domain.cjs');

const act = (s, action, role = 'Owner') => domain.applyAction(s, action, role);
const rowId = (s, list, code) => s.lists.find(l => l.id === list).rows.find(r => r.values.code === code).id;
function company() {
  let s = domain.createState('Test Co');
  s = act(s, { type: 'applyTemplate', template: 'combined' });
  for (const [listId, values] of [
    ['clients', { code: 'C-1', name: 'Client' }],
    ['services', { code: 'S-1', name: 'Diesel', rate: '4', unit: 'gallon' }],
    ['services', { code: 'S-2', name: 'Pump-out', rate: '300', unit: 'visit' }],
    ['employees', { code: 'T-1', name: 'Dana', role: 'Dispatcher' }],
    ['employees', { code: 'T-2', name: 'Sam', role: 'Driver/Field' }],
    ['employees', { code: 'T-3', name: 'Alex', role: 'Driver/Field' }]
  ]) s = act(s, { type: 'record', listId, values });
  return s;
}
const newJob = (s, extra = {}, role = 'Owner') => act(s, { type: 'job', job: { title: 'Job', clientId: rowId(s, 'clients', 'C-1'), serviceId: rowId(s, 'services', 'S-1'), quantity: 100, date: '2026-10-06', ...extra } }, role);
const complete = (s, job, role = 'Owner') => act(s, { type: 'complete', id: job.id, jobRevision: job.revision, checks: {}, quantity: job.quantity, notes: '' }, role);

test('owners choose the mode; nothing is automatic until they do', () => {
  let s = newJob(company());
  assert.equal(s.automation, undefined);
  assert.equal(s.jobs[0].employeeId || '', '', 'manual by default: no assignment');
  assert.equal(s.jobs[0].suggestion, undefined, 'manual: no suggestions');
  assert.throws(() => act(s, { type: 'automation', default: 'automatic' }, 'Administrator'), /Only owners/);
  assert.throws(() => act(s, { type: 'automation', default: 'magic' }), /Manual, Assisted or Automatic/);
  s = act(s, { type: 'automation', default: 'assisted' });
  assert.equal(s.automation.default, 'assisted');
  assert.equal(s.automation.history.length, 1);
});

test('assisted mode suggests; a dispatcher confirms the suggestion', () => {
  let s = act(company(), { type: 'automation', default: 'assisted' });
  s = newJob(s, { title: 'A' }, 'Dispatcher');
  const job = s.jobs.at(-1);
  assert.equal(job.employeeId || '', '');
  assert.equal(job.suggestion.name, 'Sam');
  assert.match(job.suggestion.reason, /no other jobs/);
  assert.throws(() => act(s, { type: 'acceptSuggestion', id: job.id }, 'Field employee'), /Field employees|Dispatchers/);
  s = act(s, { type: 'acceptSuggestion', id: job.id }, 'Dispatcher');
  assert.equal(s.jobs.at(-1).employeeId, rowId(s, 'employees', 'T-2'));
  assert.equal(s.jobs.at(-1).suggestion, undefined);
  assert.equal(s.automationLog[0].outcome, 'suggestion accepted');
  // The next job goes to the less busy driver.
  s = newJob(s, { title: 'B' });
  assert.equal(s.jobs.at(-1).suggestion.name, 'Alex');
});

test('automatic assignment respects pause and reassigns after a decline, never to the person who declined', () => {
  let s = act(company(), { type: 'automation', default: 'automatic' });
  s = newJob(s, { title: 'Auto' });
  let job = s.jobs.at(-1);
  assert.equal(job.employeeId, rowId(s, 'employees', 'T-2'));
  assert.match(s.automationLog[0].outcome, /assigned to Sam/);
  s = act(s, { type: 'acknowledge', id: job.id, jobRevision: job.revision, status: 'Declined', reason: 'Truck in shop' }, 'Owner');
  job = s.jobs.at(-1);
  assert.equal(job.employeeId, rowId(s, 'employees', 'T-3'), 'reassigned to the other driver');
  assert.deepEqual(job.declinedBy, [rowId(s, 'employees', 'T-2')]);
  s = act(s, { type: 'automation', paused: true });
  s = newJob(s, { title: 'Paused' });
  assert.equal(s.jobs.at(-1).employeeId || '', '', 'paused: nothing runs on its own');
  assert.ok(s.jobs.at(-1).suggestion, 'paused still suggests');
});

test('process settings override the company default; the existing auto-invoice setting is kept', () => {
  let s = act(company(), { type: 'automation', default: 'automatic', processes: { assignment: 'manual' } });
  s = newJob(s);
  assert.equal(s.jobs.at(-1).employeeId || '', '');
  s = complete(s, s.jobs.at(-1));
  assert.equal(s.invoices.length, 1, 'invoicing follows the automatic default');
  assert.equal(s.automationLog[0].outcome, 'invoice created');
  // A company that already had automatic invoicing keeps it without choosing a mode.
  let legacy = company();
  legacy.workflow.autoInvoice = true;
  legacy = newJob(legacy);
  legacy = complete(legacy, legacy.jobs.at(-1));
  assert.equal(legacy.invoices.length, 1);
});

test('automatic invoicing never blocks completion of unpriced work', () => {
  let s = act(company(), { type: 'automation', default: 'automatic', processes: { assignment: 'manual' } });
  s = act(s, { type: 'record', listId: 'services', values: { code: 'S-9', name: 'Unpriced', unit: 'visit' } });
  s = newJob(s, { serviceId: rowId(s, 'services', 'S-9'), quantity: 1 });
  s = complete(s, s.jobs.at(-1));
  assert.ok(s.jobs.at(-1).completedAt);
  assert.equal(s.invoices.length, 0, 'waits for a confirmed price');
});

test('approval rules: bound to the proposal, re-evaluated after edits, never auto-approved', () => {
  let s = company();
  assert.throws(() => act(s, { type: 'approvalRule', action: 'invoice', minTotal: 500, role: 'Owner' }, 'Administrator'), /Only owners/);
  s = act(s, { type: 'approvalRule', action: 'invoice', minTotal: 500, role: 'Owner', backupRole: 'Administrator' });
  s = newJob(s, { quantity: 50 });
  s = complete(s, s.jobs.at(-1));
  s = act(s, { type: 'invoice', jobId: s.jobs.at(-1).id }, 'Dispatcher');
  assert.equal(s.invoices.length, 1, 'below the threshold: no approval needed');
  s = newJob(s, { quantity: 200, title: 'Big' });
  let big = s.jobs.at(-1);
  s = complete(s, big);
  s = act(s, { type: 'invoice', jobId: big.id }, 'Dispatcher');
  assert.equal(s.invoices.length, 1, 'waits for approval');
  const ap = s.approvals[0];
  assert.deepEqual([ap.status, ap.role, ap.proposal.total], ['pending', 'Owner', 800]);
  assert.throws(() => act(s, { type: 'invoice', jobId: big.id }, 'Dispatcher'), /waiting for approval by an owner/);
  assert.throws(() => act(s, { type: 'decideApproval', id: ap.id, decision: 'approve' }, 'Dispatcher'), /not an approver/);
  assert.throws(() => act(s, { type: 'decideApproval', id: ap.id, decision: 'reject' }), /reason/);
  // The backup approver may decide; approval creates exactly the proposed invoice.
  s = act(s, { type: 'decideApproval', id: ap.id, decision: 'approve' }, 'Administrator');
  assert.equal(s.invoices.length, 2);
  assert.equal(s.invoices.at(-1).total, 800);
  assert.equal(s.approvals[0].status, 'used');
  // A material change after the request makes it stale instead of approving something else.
  s = newJob(s, { quantity: 300, title: 'Bigger' });
  let bigger = s.jobs.at(-1);
  s = complete(s, bigger);
  s = act(s, { type: 'invoice', jobId: bigger.id });
  const second = s.approvals[0];
  bigger = s.jobs.at(-1);
  const edited = act(s, { type: 'record', listId: 'services', id: rowId(s, 'services', 'S-1'), values: { code: 'S-1', name: 'Diesel', rate: '9', unit: 'gallon' } });
  assert.equal(edited.approvals.find(a => a.id === second.id).status, 'pending', 'service price changes do not touch booked work');
  const changed = structuredClone(s);
  changed.jobs.find(j => j.id === bigger.id).rate = 5;
  const after = act(changed, { type: 'dismissNotifications' });
  assert.equal(after.approvals.find(a => a.id === second.id).status, 'stale');
  assert.throws(() => act(after, { type: 'decideApproval', id: second.id, decision: 'approve' }), /no longer waiting/);
});

test('exceptions: drivers report, the right role resolves, escalation is configurable', () => {
  let s = newJob(company());
  const job = s.jobs.at(-1);
  assert.throws(() => act(s, { type: 'reportIssue', id: job.id, kind: 'other' }, 'Field employee'), /Describe the problem/);
  s = act(s, { type: 'reportIssue', id: job.id, kind: 'inaccessible_site', note: 'Gate locked' }, 'Field employee');
  const issue = s.jobs.at(-1).issues[0];
  assert.deepEqual([issue.kind, issue.status], ['inaccessible_site', 'open']);
  assert.throws(() => act(s, { type: 'resolveIssue', jobId: job.id, issueId: issue.id, outcome: 'reschedule' }, 'Field employee'), /Field employees|Dispatchers/);
  s = act(s, { type: 'exceptionRule', kind: 'inaccessible_site', handler: 'owner' });
  assert.throws(() => act(s, { type: 'resolveIssue', jobId: job.id, issueId: issue.id, outcome: 'reschedule' }, 'Dispatcher'), /escalated/);
  s = act(s, { type: 'resolveIssue', jobId: job.id, issueId: issue.id, outcome: 'reschedule', note: 'Customer opens gate tomorrow' }, 'Administrator');
  assert.equal(s.jobs.at(-1).issues[0].status, 'resolved');
  assert.throws(() => act(s, { type: 'resolveIssue', jobId: job.id, issueId: issue.id, outcome: 'continue' }), /already resolved/);
});

test('recurring service: separate visits, idempotent planning, pause, future edits and end', () => {
  let s = company();
  const series = { title: 'Weekly service', clientId: rowId(s, 'clients', 'C-1'), serviceId: rowId(s, 'services', 'S-2'), quantity: 1,
    every: { unit: 'week', interval: 1 }, startDate: '2026-10-05', timeZone: 'America/Chicago' };
  assert.throws(() => act(s, { type: 'series', series }, 'Field employee'), /Field employees|Dispatchers/);
  assert.throws(() => act(s, { type: 'series', series: { ...series, timeZone: 'Mars/Base' } }), /time zone/);
  s = act(s, { type: 'series', series }, 'Dispatcher');
  const id = s.series[0].id;
  s = act(s, { type: 'generateVisits', from: '2026-10-05', until: '2026-10-31' }, 'Dispatcher');
  const visits = () => s.jobs.filter(j => j.seriesId === id && !j.archived);
  assert.deepEqual(visits().map(j => j.date), ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  s = act(s, { type: 'generateVisits', from: '2026-10-05', until: '2026-10-31' }, 'Dispatcher');
  assert.equal(visits().length, 4, 'running again creates no duplicates');
  assert.throws(() => act(s, { type: 'generateVisits', from: '2026-10-05', until: '2027-03-01' }), /two months/);
  // One visit edited by hand keeps its change when the series changes.
  const one = visits()[2];
  s = act(s, { type: 'reschedule', id: one.id, jobRevision: one.revision, date: '2026-10-20', scheduledTime: '09:00', timeZone: 'America/Chicago', durationMinutes: 60, bufferMinutes: 0 });
  s = act(s, { type: 'series', id, from: '2026-10-10', series: { ...series, title: 'Weekly service (2 units)', quantity: 2 } }, 'Dispatcher');
  const after = visits();
  assert.equal(after[0].quantity, 1, 'past visits are untouched');
  assert.equal(after[1].quantity, 2, 'future visits follow the series');
  assert.equal(after.find(j => j.id === one.id).quantity, 1, 'a visit changed by hand is left alone');
  // Pause archives upcoming unstarted visits (never deletes); end stops planning.
  s = act(s, { type: 'seriesState', id, status: 'paused' });
  s = act(s, { type: 'generateVisits', from: '2026-11-01', until: '2026-11-30' });
  assert.equal(s.jobs.filter(j => j.seriesId === id && j.date >= '2026-11-01').length, 0);
  s = act(s, { type: 'seriesState', id, status: 'ended' });
  assert.throws(() => act(s, { type: 'seriesState', id, status: 'active' }), /not found/);
});

test('monthly visits keep the same day, or the last day of shorter months', () => {
  let s = company();
  s = act(s, { type: 'series', series: { title: 'Monthly', clientId: rowId(s, 'clients', 'C-1'), serviceId: rowId(s, 'services', 'S-2'), quantity: 1, every: { unit: 'month', interval: 1 }, startDate: '2026-01-31' } });
  s = act(s, { type: 'generateVisits', from: '2026-01-31', until: '2026-03-31' });
  assert.deepEqual(s.jobs.map(j => j.date), ['2026-01-31', '2026-02-28', '2026-03-31']);
});
