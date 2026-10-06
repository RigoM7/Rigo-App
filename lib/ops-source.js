/* Milestone D business rules: automation modes, approvals, exceptions and recurring service.
   This file is injected into index.html between the rigo-ops markers by scripts/inject-ops.cjs
   and then extracted into lib/domain.cjs with the rest of the rules. It runs inside the app's
   rules scope: X (rule check), se (new id), Z (list by id), ge (apply action), rigoAssignable,
   rigoUnits are available. Everything here is synchronous and internal: no messages, payments or
   other external effects are produced, and nothing runs in the background. */
var rigoModes = ['manual', 'assisted', 'automatic'];
var rigoProcesses = ['assignment', 'invoicing'];
var rigoIssueKinds = { equipment_failure: 'Equipment failure', inaccessible_site: 'Site not accessible', delay: 'Running late', cancellation_request: 'Customer wants to cancel', missing_information: 'Information missing', delivery_failure: 'Could not deliver', other: 'Other problem' };
var rigoRank = { Viewer: 0, 'Field employee': 1, Dispatcher: 2, Administrator: 3, Owner: 4 };
function rigoAtLeast(role, needed) { return (rigoRank[role] ?? -1) >= (rigoRank[needed] ?? 99); }

// Effective mode for a process. Precedence (highest first): platform/permissions (callers),
// readiness and approvals (callers), action override (workflow.autoInvoice for invoicing),
// process setting, company default. Paused automation never executes on its own.
function rigoMode(s, process) {
  const a = s.automation || {};
  let mode = a.processes?.[process] || a.default || 'manual';
  if (process === 'invoicing' && s.workflow?.autoInvoice) mode = 'automatic';
  if (a.paused && mode === 'automatic') mode = 'assisted';
  return mode;
}

// Suggest the field team member with the fewest open jobs that day, skipping anyone who declined.
function rigoSuggest(s, job) {
  const team = (s.lists.find(l => l.id === 'employees')?.rows || []).filter(r => !r.archived && rigoAssignable(s, r) && !(job.declinedBy || []).includes(r.id));
  if (!team.length) return null;
  const load = id => s.jobs.filter(j => !j.archived && !j.completedAt && j.employeeId === id && j.date === job.date && j.id !== job.id).length;
  const best = team.map(r => ({ r, n: load(r.id) })).sort((a, b) => a.n - b.n || String(a.r.values.code).localeCompare(String(b.r.values.code)))[0];
  return { employeeId: best.r.id, name: best.r.values.name, reason: best.n === 0 ? 'no other jobs that day' : 'fewest jobs that day (' + best.n + ')' };
}

function rigoLog(s, entry) {
  (s.automationLog ||= []).unshift({ id: se(), ...entry });
  s.automationLog = s.automationLog.slice(0, 200);
}

function rigoApprovalRule(s, action, total) {
  return (s.approvalRules || []).find(r => r.enabled !== false && r.action === action && total >= Number(r.minTotal || 0));
}
function rigoProposal(job) { return { quantity: job.quantity, rate: job.rate, total: Math.round(job.quantity * job.rate * 100) / 100 }; }
function rigoSameProposal(a, b) { return a && b && a.quantity === b.quantity && a.rate === b.rate && a.total === b.total; }

// Returns true when the invoice must not be created now (waiting for approval, or skipped).
function rigoInvoiceGate(s, job, role, at, automatic) {
  const proposal = rigoProposal(job);
  if (!(proposal.total > 0)) { if (automatic) return true; return false; }
  const rule = rigoApprovalRule(s, 'invoice', proposal.total);
  if (!rule) return false;
  s.approvals ||= [];
  const approved = s.approvals.find(a => a.jobId === job.id && a.action === 'invoice' && a.status === 'approved' && rigoSameProposal(a.proposal, proposal));
  if (approved) { approved.status = 'used'; approved.usedAt = at; return false; }
  const pending = s.approvals.find(a => a.jobId === job.id && a.action === 'invoice' && a.status === 'pending');
  if (pending && rigoSameProposal(pending.proposal, proposal)) {
    if (!automatic) X(false, 'This invoice is waiting for approval by ' + (pending.role === 'Owner' ? 'an owner' : 'an administrator') + '.');
    return true;
  }
  if (pending) { pending.status = 'stale'; pending.staleAt = at; }
  s.approvals.unshift({ id: se(), action: 'invoice', jobId: job.id, title: job.title, ruleId: rule.id, role: rule.role, backupRole: rule.backupRole || '', proposal, status: 'pending', requestedBy: String(role), requestedAt: at });
  if (automatic) rigoLog(s, { at, process: 'invoicing', jobId: job.id, mode: 'automatic', outcome: 'waiting for approval' });
  return true;
}

// Visit dates for a series between two plain dates (YYYY-MM-DD), calendar based so that
// daylight-saving changes in the series' time zone never shift a visit.
function rigoOccurrences(series, from, until) {
  const out = [];
  const step = Math.max(1, Math.min(365, Number(series.every?.interval) || 1));
  const unit = series.every?.unit;
  const start = new Date(series.startDate + 'T00:00:00Z');
  const end = series.endDate && series.endDate < until ? series.endDate : until;
  for (let i = 0, d = new Date(start); i < 1000; i++) {
    const day = d.toISOString().slice(0, 10);
    if (day > end) break;
    if (day >= from) out.push(day);
    if (unit === 'month') {
      // Same day of the month, or the last day when the month is shorter (31st -> 30th/28th).
      const months = start.getUTCMonth() + step * (i + 1);
      const last = new Date(Date.UTC(start.getUTCFullYear(), months + 1, 0)).getUTCDate();
      d = new Date(Date.UTC(start.getUTCFullYear(), months, Math.min(start.getUTCDate(), last)));
    } else d.setUTCDate(d.getUTCDate() + (unit === 'week' ? 7 : 1) * step);
  }
  return out;
}

function rigoCopy(target, source) { for (const k of Object.keys(target)) if (!(k in source)) delete target[k]; Object.assign(target, source); }

function rigoOps(s, t, role, at) {
  switch (t.type) {
    case 'automation': {
      X(role === 'Owner', 'Only owners choose how much Rigo handles');
      const a = s.automation ||= {};
      if (t.default !== undefined) { X(rigoModes.includes(t.default), 'Choose Manual, Assisted or Automatic'); a.default = t.default; a.chosenAt ||= at; }
      if (t.processes !== undefined) {
        a.processes = {};
        for (const [p, m] of Object.entries(t.processes || {})) { X(rigoProcesses.includes(p) && (m === '' || rigoModes.includes(m)), 'Choose a valid process setting'); if (m) a.processes[p] = m; }
      }
      if (t.paused !== undefined) { a.paused = Boolean(t.paused); a.pausedAt = a.paused ? at : undefined; }
      (a.history ||= []).unshift({ at, by: String(t.actor || role), default: a.default, processes: { ...a.processes }, paused: !!a.paused });
      a.history = a.history.slice(0, 50);
      break;
    }
    case 'approvalRule': {
      X(role === 'Owner', 'Only owners set approval rules');
      s.approvalRules ||= [];
      if (t.remove) { s.approvalRules = s.approvalRules.filter(r => r.id !== t.id); break; }
      const min = Number(t.minTotal);
      X(t.action === 'invoice', 'Approval rules currently cover invoices');
      X(Number.isFinite(min) && min >= 0, 'Enter the invoice amount that needs approval');
      X(['Owner', 'Administrator'].includes(t.role), 'Choose who approves');
      X(!t.backupRole || (['Owner', 'Administrator'].includes(t.backupRole) && t.backupRole !== t.role), 'Choose a different backup approver');
      const rule = { id: t.id || se(), action: 'invoice', minTotal: Math.round(min * 100) / 100, role: t.role, backupRole: t.backupRole || '', enabled: t.enabled !== false };
      const i = s.approvalRules.findIndex(r => r.id === rule.id);
      i >= 0 ? s.approvalRules[i] = rule : s.approvalRules.push(rule);
      break;
    }
    case 'decideApproval': {
      const ap = (s.approvals || []).find(a => a.id === t.id);
      X(ap && ap.status === 'pending', 'This approval is no longer waiting');
      X(role === ap.role || role === ap.backupRole || role === 'Owner', 'You are not an approver for this');
      X(['approve', 'reject'].includes(t.decision), 'Approve or reject');
      ap.decidedBy = String(t.actor || role); ap.decidedAt = at; ap.note = String(t.note || '').slice(0, 300);
      if (t.decision === 'reject') { X(ap.note.trim(), 'Give a reason for rejecting'); ap.status = 'rejected'; break; }
      const job = s.jobs.find(j => j.id === ap.jobId);
      // Approval binds to what was proposed. A material change needs a new request.
      if (!job || !rigoSameProposal(rigoProposal(job), ap.proposal) || s.invoices.some(i => i.jobId === job.id)) { ap.status = 'stale'; ap.staleAt = at; break; }
      ap.status = 'approved';
      if (rigoInvoiceGate(s, job, role, at) === false) he(s, job);
      break;
    }
    case 'reportIssue': {
      const job = s.jobs.find(j => j.id === t.id);
      X(job && !job.archived, 'Job not found');
      X(Object.hasOwn(rigoIssueKinds, t.kind), 'Choose what happened');
      const note = String(t.note || '').trim();
      X(note || t.kind !== 'other', 'Describe the problem');
      (job.issues ||= []).push({ id: se(), kind: t.kind, note: note.slice(0, 500), status: 'open', at, by: String(t.actor || role) });
      job.revision++;
      break;
    }
    case 'resolveIssue': {
      const job = s.jobs.find(j => j.id === t.jobId);
      const issue = job?.issues?.find(i => i.id === t.issueId);
      X(issue && issue.status === 'open', 'This issue is already resolved');
      const needed = (s.exceptionRules || {})[issue.kind] === 'owner' ? 'Administrator' : 'Dispatcher';
      X(rigoAtLeast(role, needed), needed === 'Administrator' ? 'This kind of issue is escalated to owners and administrators' : 'Dispatchers, administrators and owners resolve issues');
      const outcome = String(t.outcome || '');
      X(['continue', 'reassign', 'reschedule', 'cancel'].includes(outcome), 'Choose how it was resolved');
      Object.assign(issue, { status: 'resolved', outcome, resolution: String(t.note || '').slice(0, 500), resolvedAt: at, resolvedBy: String(t.actor || role) });
      job.revision++;
      break;
    }
    case 'exceptionRule': {
      X(role === 'Owner', 'Only owners set escalation rules');
      X(Object.hasOwn(rigoIssueKinds, t.kind) && ['dispatcher', 'owner'].includes(t.handler), 'Choose who handles this issue');
      (s.exceptionRules ||= {})[t.kind] = t.handler;
      break;
    }
    case 'series': {
      X(rigoAtLeast(role, 'Dispatcher'), 'Dispatchers, administrators and owners manage recurring service');
      const v = t.series || {};
      X(String(v.title || '').trim(), 'Name the recurring service');
      X(Z(s, 'clients').rows.some(r => r.id === v.clientId && !r.archived), 'Choose a client');
      X(Z(s, 'services').rows.some(r => r.id === v.serviceId && !r.archived), 'Choose a service');
      X(!v.locationId || Z(s, 'locations').rows.some(r => r.id === v.locationId && !r.archived), 'Choose a valid location');
      X(/^\d{4}-\d{2}-\d{2}$/.test(String(v.startDate)), 'Choose a start date');
      X(!v.endDate || (/^\d{4}-\d{2}-\d{2}$/.test(String(v.endDate)) && v.endDate >= v.startDate), 'The end date must be after the start date');
      X(['day', 'week', 'month'].includes(v.every?.unit) && Number(v.every?.interval) >= 1 && Number(v.every?.interval) <= 52, 'Choose how often the service happens');
      X(Number(v.quantity) > 0, 'Quantity per visit must be greater than zero');
      X(['per visit'].includes(v.billing || 'per visit'), 'Choose how visits are billed');
      if (v.timeZone) { try { new Intl.DateTimeFormat('en-US', { timeZone: v.timeZone }).format(new Date()); } catch { X(false, 'Choose a valid time zone'); } }
      const clean = { title: String(v.title).trim().slice(0, 120), clientId: v.clientId, serviceId: v.serviceId, locationId: v.locationId || '', quantity: Number(v.quantity),
        every: { unit: v.every.unit, interval: Number(v.every.interval) }, startDate: v.startDate, endDate: v.endDate || '', timeZone: v.timeZone || '', billing: 'per visit',
        notes: String(v.notes || '').slice(0, 500) };
      s.series ||= [];
      if (t.id) {
        const series = s.series.find(x => x.id === t.id);
        X(series && series.status !== 'ended', 'Recurring service not found');
        Object.assign(series, clean, { revision: (series.revision || 1) + 1, updatedAt: at });
        // "This and future visits": only visits that have not started and nobody changed by hand.
        let updated = 0;
        for (const job of s.jobs) {
          if (job.seriesId !== series.id || job.completedAt || job.archived || job.date < (t.from || at.slice(0, 10)) || job.employeeId || job.seriesManual) continue;
          Object.assign(job, { title: clean.title, quantity: clean.quantity, notes: clean.notes || job.notes });
          job.revision++; updated++;
        }
        series.lastFutureUpdate = { at, updated };
      } else s.series.push({ id: se(), ...clean, status: 'active', createdAt: at, revision: 1 });
      break;
    }
    case 'seriesState': {
      X(rigoAtLeast(role, 'Dispatcher'), 'Dispatchers, administrators and owners manage recurring service');
      const series = (s.series || []).find(x => x.id === t.id);
      X(series && series.status !== 'ended', 'Recurring service not found');
      X(['active', 'paused', 'ended'].includes(t.status), 'Choose resume, pause or end');
      series.status = t.status; series.statusAt = at;
      if (t.status !== 'active') {
        // Upcoming visits that have not started are archived, never deleted; history stays.
        for (const job of s.jobs) if (job.seriesId === series.id && !job.completedAt && !job.archived && !job.employeeId && job.date > at.slice(0, 10)) { job.archived = true; job.revision++; }
      }
      break;
    }
    case 'generateVisits': {
      X(rigoAtLeast(role, 'Dispatcher'), 'Dispatchers, administrators and owners plan visits');
      const today = String(t.from || at.slice(0, 10));
      const until = String(t.until || '');
      X(/^\d{4}-\d{2}-\d{2}$/.test(until), 'Choose how far ahead to plan');
      const limit = new Date(today + 'T00:00:00Z'); limit.setUTCDate(limit.getUTCDate() + 62);
      X(until <= limit.toISOString().slice(0, 10), 'Plan up to two months ahead at a time');
      let made = 0;
      for (const series of (s.series || []).filter(x => x.status === 'active' && (!t.seriesId || x.id === t.seriesId))) {
        for (const day of rigoOccurrences(series, today, until)) {
          // Stable key: one visit per series per date, however often this runs.
          if (s.jobs.some(j => j.seriesId === series.id && j.occurrence === day)) continue;
          const next = ge(s, { type: 'job', job: { title: series.title, clientId: series.clientId, serviceId: series.serviceId, locationId: series.locationId, quantity: series.quantity, date: day, notes: series.notes, ...(series.timeZone ? { timeZone: series.timeZone } : {}) }, actor: t.actor, automation: true }, 'Owner');
          const created = next.jobs.find(j => !s.jobs.some(x => x.id === j.id));
          created.seriesId = series.id; created.occurrence = day;
          rigoCopy(s, next);
          made++;
        }
        series.plannedUntil = until > (series.plannedUntil || '') ? until : series.plannedUntil;
      }
      s.lastPlanning = { at, until, made };
      break;
    }
    case 'acceptSuggestion': {
      X(rigoAtLeast(role, 'Dispatcher'), 'Dispatchers, administrators and owners assign work');
      const job = s.jobs.find(j => j.id === t.id);
      X(job && job.suggestion && !job.completedAt, 'This suggestion is no longer available');
      const next = ge(s, { type: 'assign', id: job.id, jobRevision: job.revision, employeeId: job.suggestion.employeeId, actor: t.actor, automation: true }, role);
      rigoCopy(s, next);
      const done = s.jobs.find(j => j.id === t.id);
      rigoLog(s, { at, process: 'assignment', jobId: done.id, mode: 'assisted', outcome: 'suggestion accepted', by: String(t.actor || role) });
      delete done.suggestion;
      break;
    }
  }
}

// After every action: keep suggestions current, run automatic steps the owner allowed, and
// mark approvals stale when the work they cover changed.
function rigoOpsAfter(before, s, t, role, at) {
  if (t.automation) return;
  rigoMessageEventsAfter(before, s, t, at);
  for (const ap of s.approvals || []) {
    if (ap.status !== 'pending') continue;
    const job = s.jobs.find(j => j.id === ap.jobId);
    if (!job || !rigoSameProposal(rigoProposal(job), ap.proposal)) { ap.status = 'stale'; ap.staleAt = at; }
  }
  // A visit changed by hand is no longer updated by "this and future visits".
  for (const job of s.jobs) {
    if (!job.seriesId || job.seriesManual) continue;
    const prior = before.jobs.find(j => j.id === job.id);
    if (prior && t.type !== 'series' && ['title', 'quantity', 'date', 'notes', 'serviceId', 'locationId'].some(k => prior[k] !== job[k])) job.seriesManual = true;
  }
  if (t.type === 'acknowledge' && t.status === 'Declined') {
    const job = s.jobs.find(j => j.id === t.id);
    const prior = before.jobs.find(j => j.id === t.id);
    if (job && prior?.employeeId) (job.declinedBy ||= []).includes(prior.employeeId) || job.declinedBy.push(prior.employeeId);
  }
  const mode = rigoMode(s, 'assignment');
  for (const job of s.jobs) {
    if (job.archived || job.completedAt) { delete job.suggestion; continue; }
    const declined = job.acknowledgment?.status === 'Declined';
    if (job.employeeId && !declined) { delete job.suggestion; continue; }
    if (mode === 'manual') { delete job.suggestion; continue; }
    const pick = rigoSuggest(s, job);
    if (!pick) { delete job.suggestion; continue; }
    // Keep the same suggestion object while the pick is unchanged, so unrelated saves don't conflict.
    if (job.suggestion?.employeeId !== pick.employeeId || job.suggestion?.reason !== pick.reason) job.suggestion = { ...pick, at };
    const fresh = !before.jobs.some(j => j.id === job.id) || (t.type === 'acknowledge' && t.id === job.id);
    const ready = job.clientId && job.serviceId && job.date && !(s.approvalRules || []).some(r => r.enabled !== false && r.action === 'assignment');
    if (mode === 'automatic' && fresh && ready && !(s.automation?.paused)) {
      try {
        const next = ge(s, { type: 'assign', id: job.id, jobRevision: job.revision, employeeId: pick.employeeId, actor: 'Rigo (automatic)', automation: true }, 'Owner');
        rigoCopy(s, next);
        const done = s.jobs.find(j => j.id === job.id);
        delete done.suggestion;
        rigoLog(s, { at, process: 'assignment', jobId: job.id, mode: 'automatic', outcome: 'assigned to ' + pick.name, reason: pick.reason });
      } catch (error) {
        rigoLog(s, { at, process: 'assignment', jobId: job.id, mode: 'automatic', outcome: 'not assigned', reason: error.message });
      }
      return;
    }
  }
}

/* ---- Milestone E: one validated configuration model ------------------------------------
   Visual editors, templates and AI assistants all describe changes as the same small set of
   operations. A proposal is validated by a dry run, previewed in plain words, and applied only
   when an owner or administrator chooses to; applying re-checks it against the current setup. */
var rigoConfigOps = ['addList', 'addField', 'workflow', 'modules', 'labels', 'automation', 'approvalRule', 'exceptionRule'];
function rigoListRef(s, ref) {
  const r = String(ref || '').trim().toLowerCase();
  return s.lists.find(l => l.id === ref) || s.lists.find(l => l.name.toLowerCase() === r);
}
function rigoOpAction(s, op) {
  X(op && rigoConfigOps.includes(op.op), 'Unknown configuration change: ' + String(op?.op || '').slice(0, 40));
  const text = (v, n = 80) => String(v ?? '').trim().slice(0, n);
  switch (op.op) {
    case 'addList': return { type: 'list', name: text(op.name, 60) };
    case 'addField': {
      const list = rigoListRef(s, op.list);
      X(list, 'List not found: ' + text(op.list, 60));
      const field = { name: text(op.name, 60), type: String(op.type || 'text'), required: false };
      if (field.type === 'select') field.options = (Array.isArray(op.options) ? op.options : []).map(o => text(o, 60)).filter(Boolean).slice(0, 50);
      if (field.type === 'reference') { const target = rigoListRef(s, op.target); X(target, 'Referenced list not found'); field.listId = target.id; }
      X(!list.fields.some(f => f.name.toLowerCase() === field.name.toLowerCase()), 'A field named ' + field.name + ' already exists in ' + list.name);
      return { type: 'field', listId: list.id, field };
    }
    case 'workflow': {
      const w = s.workflow;
      return { type: 'workflow', workflow: { statuses: (op.statuses || w.statuses).map(x => text(x, 40)), checklist: (op.checklist || w.checklist).map(x => text(x, 80)),
        autoInvoice: w.autoInvoice, signatureRequired: w.signatureRequired, requireApproval: w.requireApproval, requireAcknowledgment: w.requireAcknowledgment, retired: op.active === undefined ? w.retired : !op.active } };
    }
    case 'modules': {
      const set = new Set(s.modules);
      for (const m of op.add || []) set.add(String(m));
      for (const m of op.remove || []) set.delete(String(m));
      return { type: 'configure', name: s.name, modules: [...set], logo: s.logo, terminology: s.terminology };
    }
    case 'labels': return { type: 'configure', name: s.name, modules: s.modules, logo: s.logo, terminology: { ...s.terminology, ...Object.fromEntries(Object.entries(op.terminology || {}).map(([k, v]) => [k, text(v, 40)])) } };
    case 'automation': return { type: 'automation', default: op.default, processes: op.processes };
    case 'approvalRule': return { type: 'approvalRule', action: 'invoice', minTotal: op.minTotal, role: op.role, backupRole: op.backupRole, enabled: op.enabled };
    case 'exceptionRule': return { type: 'exceptionRule', kind: op.kind, handler: op.handler };
  }
}
function rigoDescribe(s, op) {
  const list = op.list ? (rigoListRef(s, op.list)?.name || op.list) : '';
  switch (op.op) {
    case 'addList': return 'Add a list “' + op.name + '”';
    case 'addField': return 'Add ' + (op.type || 'text') + ' field “' + op.name + '” to ' + list + (op.options?.length ? ' (' + op.options.join(', ') + ')' : '');
    case 'workflow': return (op.active ? 'Publish job steps: ' : 'Use job steps: ') + (op.statuses || s.workflow.statuses).join(' → ') + (op.checklist ? '; checklist: ' + (op.checklist.join(', ') || 'none') : '') + ' (new jobs only)';
    case 'modules': return [(op.add || []).length ? 'Turn on ' + op.add.join(', ') : '', (op.remove || []).length ? 'Turn off ' + op.remove.join(', ') : ''].filter(Boolean).join('; ');
    case 'labels': return 'Rename labels: ' + Object.entries(op.terminology || {}).map(([k, v]) => k + ' → ' + v).join(', ');
    case 'automation': return 'Automation: default ' + (op.default || 'unchanged') + Object.entries(op.processes || {}).map(([p, m]) => '; ' + p + ' ' + (m || 'company default')).join('');
    case 'approvalRule': return 'Invoices of $' + op.minTotal + ' or more need ' + op.role + ' approval' + (op.enabled === false ? ' (added switched off)' : '');
    case 'exceptionRule': return (rigoIssueKinds[op.kind] || op.kind) + ' handled by ' + (op.handler === 'owner' ? 'owners and administrators' : 'dispatchers and above');
    default: return String(op.op);
  }
}
// A step that is already in place (same list, or same field with the same type) is skipped.
function rigoSatisfied(s, op) {
  if (op?.op === 'addList') return Boolean(rigoListRef(s, op.name));
  if (op?.op === 'addField') {
    const list = rigoListRef(s, op.list);
    const same = list?.fields.find(f => f.name.toLowerCase() === String(op.name || '').trim().toLowerCase());
    if (same) { X(same.type === (op.type || 'text'), 'A field named ' + same.name + ' already exists in ' + list.name + ' with a different type'); return true; }
  }
  if (op?.op === 'modules') return (op.add || []).every(m => s.modules.includes(m)) && !(op.remove || []).some(m => s.modules.includes(m));
  return false;
}
// Applies every operation or none, using the caller's own role for each underlying rule.
function rigoApplyOps(s, ops, role, actor) {
  X(Array.isArray(ops) && ops.length > 0 && ops.length <= 80, 'A configuration change has 1–80 steps');
  let next = s;
  for (const op of ops) if (!rigoSatisfied(next, op)) next = ge(next, { ...rigoOpAction(next, op), actor, automation: true }, role);
  return next;
}
function rigoConfig(s, t, role, at) {
  X(['Owner', 'Administrator'].includes(role), 'Owners and administrators review configuration changes');
  if (t.type === 'proposeConfig') {
    X(Array.isArray(t.ops), 'Describe the configuration change as a list of steps');
    const ops = structuredClone(t.ops).filter(op => !rigoSatisfied(s, op));
    X(ops.length, 'Nothing to change: this setup is already in place.');
    rigoApplyOps(s, ops, role, t.actor);
    (s.configProposals ||= []).unshift({ id: se(), ops, summary: String(t.summary || '').slice(0, 300), source: ['assistant', 'visual', 'template'].includes(t.source) ? t.source : 'visual',
      template: t.template, preview: ops.map(op => rigoDescribe(s, op)), status: 'pending', createdAt: at, createdBy: String(t.actor || role) });
    s.configProposals = s.configProposals.slice(0, 50);
    return;
  }
  const p = (s.configProposals || []).find(x => x.id === t.id);
  X(p && p.status === 'pending', 'This change is no longer waiting for review');
  X(['apply', 'dismiss'].includes(t.decision), 'Apply or dismiss');
  if (t.decision === 'dismiss') { Object.assign(p, { status: 'dismissed', decidedAt: at, decidedBy: String(t.actor || role) }); return; }
  const next = rigoApplyOps(s, p.ops, role, t.actor);
  rigoCopy(s, next);
  const done = s.configProposals.find(x => x.id === t.id);
  Object.assign(done, { status: 'applied', decidedAt: at, decidedBy: String(t.actor || role) });
  if (done.template) s.templateSource = { ...done.template, appliedAt: at };
}

/* ---- Milestone E: customer communication (prepared, never sent without a provider) ------ */
var rigoMessageEvents = {
  confirmation: { label: 'Job confirmation', subject: '{company}: your {service} is booked', body: 'Hello {client}, your {service} ({quantity} {unit}) is scheduled for {date}. Reply to this message if anything changes.' },
  arrival: { label: 'On the way', subject: '{company} is on the way', body: 'Hello {client}, our team is on the way for your {service}.' },
  delay: { label: 'Running late', subject: '{company}: running late', body: 'Hello {client}, we are running late for your {service} on {date}. We will update you as soon as we can.' },
  completion: { label: 'Work completed', subject: '{company}: {service} completed', body: 'Hello {client}, your {service} on {date} is complete.' },
  invoice: { label: 'Invoice', subject: '{company} invoice', body: 'Hello {client}, your invoice for {service} is {total}, due {due}.' },
  reminder: { label: 'Visit reminder', subject: '{company}: reminder for {date}', body: 'Hello {client}, this is a reminder that your {service} is scheduled for {date}.' },
  payment_reminder: { label: 'Payment reminder', subject: '{company}: payment reminder', body: 'Hello {client}, our records show {total} outstanding for {service}, due {due}.' }
};
var rigoContactFields = [['email', 'Email', 'text'], ['phone', 'Mobile phone', 'text'], ['contactBy', 'Contact by', 'select', ['Email', 'Text message', 'Email and text', 'Do not contact']]];
function rigoClientField(s, id) { const list = s.lists.find(l => l.id === 'clients'); return list?.fields.find(f => f.rigoContact === id); }
function rigoRender(text, values) { return String(text).replace(/\{(\w+)\}/g, (m, k) => values[k] ?? m); }
function rigoQueueMessage(s, event, { job, invoice }, at, key) {
  const m = s.messaging;
  const tpl = m?.templates?.[event];
  if (!m?.enabled || !tpl || tpl.enabled === false) return;
  s.outbox ||= [];
  const stableKey = key || event + ':' + (invoice?.id || job?.id);
  if (s.outbox.some(x => x.key === stableKey)) return;
  const clientId = invoice?.clientId || job?.clientId;
  const client = s.lists.find(l => l.id === 'clients')?.rows.find(r => r.id === clientId);
  const v = f => { const field = rigoClientField(s, f); return field ? String(client?.values?.[field.id] || '').trim() : ''; };
  const by = v('contactBy') || 'Email';
  const channels = by === 'Do not contact' ? [] : by === 'Email and text' ? ['email', 'sms'] : by === 'Text message' ? ['sms'] : ['email'];
  const to = { email: channels.includes('email') ? v('email') : '', phone: channels.includes('sms') ? v('phone') : '' };
  const values = { company: s.name, client: client?.values?.name || job?.clientName || invoice?.clientName || 'there', service: job?.serviceName || invoice?.description || '', date: job?.date || '',
    quantity: job?.quantity ?? '', unit: job?.unit || '', total: invoice ? '$' + (invoice.total - invoice.paid).toFixed(2) : '', due: invoice?.due || '', job: job?.title || '' };
  const reason = !client ? 'No client on this job' : by === 'Do not contact' ? 'Client asked not to be contacted' : !to.email && !to.phone ? 'No ' + (channels.includes('sms') && !channels.includes('email') ? 'mobile phone' : 'email') + ' on the client record' : '';
  s.outbox.unshift({ id: se(), key: stableKey, event, jobId: job?.id, invoiceId: invoice?.id, clientId, to, channels, subject: rigoRender(tpl.subject, values), body: rigoRender(tpl.body, values),
    status: reason ? 'skipped' : 'not sent', note: reason || 'No email or SMS provider is connected. Nothing was sent.', createdAt: at });
  s.outbox = s.outbox.slice(0, 300);
}
function rigoMessaging(s, t, role, at) {
  if (t.type === 'messaging') {
    X(role === 'Owner', 'Only owners set up customer messages');
    const m = s.messaging ||= { enabled: false, templates: {} };
    for (const [k, def] of Object.entries(rigoMessageEvents)) m.templates[k] ||= { enabled: true, subject: def.subject, body: def.body };
    if (t.enabled !== undefined) {
      m.enabled = Boolean(t.enabled);
      if (m.enabled) {
        // Turning messages on adds contact fields to Clients (explicit, shown before saving).
        const list = Z(s, 'clients');
        for (const [id, name, type, options] of rigoContactFields) if (!list.fields.some(f => f.rigoContact === id)) list.fields.push({ id: se(), name, type, required: false, rigoContact: id, ...(options ? { options } : {}) });
      }
    }
    if (t.arrivalStatus !== undefined) { X(!t.arrivalStatus || s.workflow.statuses.includes(t.arrivalStatus), 'Choose one of your job steps'); m.arrivalStatus = t.arrivalStatus; }
    for (const [k, v] of Object.entries(t.templates || {})) {
      X(Object.hasOwn(rigoMessageEvents, k), 'Unknown message');
      X(String(v.subject || '').trim() && String(v.body || '').trim(), 'Each message needs a subject and text');
      m.templates[k] = { enabled: v.enabled !== false, subject: String(v.subject).slice(0, 150), body: String(v.body).slice(0, 1000) };
    }
    return;
  }
  X(rigoAtLeast(role, 'Dispatcher'), 'Dispatchers, administrators and owners manage customer messages');
  if (t.type === 'prepareMessages') {
    X(s.messaging?.enabled, 'Turn on customer messages first');
    const day = String(t.date || '');
    X(/^\d{4}-\d{2}-\d{2}$/.test(day), 'Choose a date');
    let made = (s.outbox || []).length;
    if (t.kind === 'reminders') for (const job of s.jobs.filter(j => !j.archived && !j.completedAt && j.date === day)) rigoQueueMessage(s, 'reminder', { job }, at, 'reminder:' + job.id + ':' + day);
    else if (t.kind === 'paymentReminders') for (const invoice of s.invoices.filter(i => i.paid < i.total && i.due < day)) rigoQueueMessage(s, 'payment_reminder', { invoice, job: s.jobs.find(j => j.id === invoice.jobId) }, at, 'payment:' + invoice.id + ':' + day);
    else X(false, 'Choose reminders or payment reminders');
    s.lastPrepared = { at, kind: t.kind, made: (s.outbox || []).length - made };
    return;
  }
  if (t.type === 'messageState') {
    const msg = (s.outbox || []).find(x => x.id === t.id);
    X(msg, 'Message not found');
    X(t.status === 'dismissed', 'Messages can only be dismissed here');
    msg.status = 'dismissed'; msg.note = 'Dismissed by ' + String(t.actor || role); msg.dismissedAt = at;
  }
}
// Prepares messages for what just happened (called after every action).
function rigoMessageEventsAfter(before, s, t, at) {
  if (!s.messaging?.enabled) return;
  const arrival = s.messaging.arrivalStatus ?? (s.workflow.statuses.includes('En Route') ? 'En Route' : '');
  for (const job of s.jobs) {
    const prior = before.jobs.find(j => j.id === job.id);
    // Recurring visits get reminders instead of one confirmation per planned visit.
    if (!prior && !job.archived && !job.seriesId) rigoQueueMessage(s, 'confirmation', { job }, at);
    if (prior && arrival && prior.status !== arrival && job.status === arrival) rigoQueueMessage(s, 'arrival', { job }, at);
    if (prior && !prior.completedAt && job.completedAt) rigoQueueMessage(s, 'completion', { job }, at);
    const priorIssues = prior?.issues?.length || 0;
    for (const issue of (job.issues || []).slice(priorIssues)) if (issue.kind === 'delay') rigoQueueMessage(s, 'delay', { job }, at, 'delay:' + issue.id);
  }
  for (const invoice of s.invoices) if (!before.invoices.some(i => i.id === invoice.id)) rigoQueueMessage(s, 'invoice', { invoice, job: s.jobs.find(j => j.id === invoice.jobId) }, at);
}
