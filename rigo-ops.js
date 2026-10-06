/* Rigo operations screens (Milestone D): Today dashboard, driver "My work today", automation
   settings, approvals, issues and recurring service. Rendered next to the app bundle; all changes
   go through the app's own save path (window.rigoAct), so the server applies the same rules and
   role checks. */
(() => {
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
  const today = () => new Date().toLocaleDateString('en-CA');
  const current = () => window.rigoRef?.current || {};
  const act = action => window.rigoAct ? window.rigoAct(action) : Promise.resolve(false);
  const rank = { Viewer: 0, 'Field employee': 1, Dispatcher: 2, Administrator: 3, Owner: 4 };
  const atLeast = (role, needed) => (rank[role] ?? -1) >= rank[needed];
  const ISSUES = { equipment_failure: 'Equipment failure', inaccessible_site: 'Site not accessible', delay: 'Running late', cancellation_request: 'Customer wants to cancel', missing_information: 'Information missing', delivery_failure: 'Could not deliver', other: 'Other problem' };
  const MODES = { manual: ['Manual', 'People do each step. Rigo records it.'], assisted: ['Assisted', 'Rigo suggests the next step; a person confirms it.'], automatic: ['Automatic', 'Rigo does the step when everything required is present and no approval is needed.'] };
  const list = (s, id) => s.lists?.find(l => l.id === id)?.rows || [];
  const row = (s, id, rid) => list(s, id).find(r => r.id === rid);
  const name = (s, id, rid) => row(s, id, rid)?.values?.name || '';
  const effectiveMode = (s, process) => {
    const a = s.automation || {};
    let m = a.processes?.[process] || a.default || 'manual';
    if (process === 'invoicing' && s.workflow?.autoInvoice) m = 'automatic';
    return a.paused && m === 'automatic' ? 'assisted (paused)' : m;
  };

  // ---- Small dialog helper -------------------------------------------------------------
  function dialog(id, title, body, onSubmit, submitLabel = 'Save') {
    document.getElementById(id)?.remove();
    const d = document.createElement('dialog');
    d.id = id; d.className = 'rigo-dialog';
    d.setAttribute('aria-labelledby', id + '-title');
    d.innerHTML = `<form novalidate><div class="rigo-dialog-head"><h2 id="${id}-title">${esc(title)}</h2><button class="text-button" type="button" data-close>Cancel</button></div>${body}
      <div class="rigo-actions"><button class="primary" type="submit">${esc(submitLabel)}</button></div><p class="rigo-dialog-message" role="status" aria-live="polite"></p></form>`;
    document.body.append(d);
    const form = d.querySelector('form'), note = d.querySelector('.rigo-dialog-message');
    d.querySelector('[data-close]').onclick = () => d.close();
    d.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); d.close(); } });
    d.addEventListener('close', () => d.remove());
    form.onsubmit = async e => {
      e.preventDefault();
      const fail = text => { note.className = 'rigo-dialog-message error-text'; note.textContent = text; };
      const action = onSubmit(form, fail);
      if (!action) return;
      form.querySelectorAll('button,input,select,textarea').forEach(el => { el.disabled = true; });
      if (await act(action)) d.close();
      else { form.querySelectorAll('button,input,select,textarea').forEach(el => { el.disabled = false; }); fail('Not saved. See the message at the top of the page and try again.'); }
    };
    d.showModal();
    form.querySelector('input,select,textarea')?.focus();
    return d;
  }
  const field = (label, control, help = '') => `<label class="field rigo-field"><span>${label}</span>${control}${help ? `<small class="rigo-help">${help}</small>` : ''}</label>`;

  function reportIssue(job) {
    dialog('rigo-issue', 'Report a problem', `<p><strong>${esc(job.title)}</strong></p>
      ${field('What happened *', `<select name="kind">${Object.entries(ISSUES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`)}
      ${field('Details', '<textarea name="note" rows="3" maxlength="500" placeholder="What you see, and what you need"></textarea>', 'The office sees this right away in Today.')}`,
      (f, fail) => {
        if (f.elements.kind.value === 'other' && !f.elements.note.value.trim()) return fail('Describe the problem.');
        return { type: 'reportIssue', id: job.id, kind: f.elements.kind.value, note: f.elements.note.value.trim() };
      }, 'Send to the office');
  }
  function decline(job) {
    dialog('rigo-decline', 'Decline this job', `<p><strong>${esc(job.title)}</strong></p>${field('Reason *', '<input name="reason" maxlength="300" placeholder="For example: truck in the shop">')}`,
      (f, fail) => f.elements.reason.value.trim() ? { type: 'acknowledge', id: job.id, jobRevision: job.revision, status: 'Declined', reason: f.elements.reason.value.trim() } : fail('Give a reason.'), 'Decline job');
  }
  function resolveIssue(job, issue) {
    dialog('rigo-resolve', 'Resolve: ' + (ISSUES[issue.kind] || issue.kind), `<p><strong>${esc(job.title)}</strong>${issue.note ? '<br>' + esc(issue.note) : ''}</p>
      ${field('Outcome *', '<select name="outcome"><option value="continue">Continue as planned</option><option value="reassign">Reassign</option><option value="reschedule">Reschedule</option><option value="cancel">Cancel the job</option></select>', 'Reassigning, rescheduling or cancelling is then done on the job itself.')}
      ${field('Note', '<input name="note" maxlength="500">')}`,
      f => ({ type: 'resolveIssue', jobId: job.id, issueId: issue.id, outcome: f.elements.outcome.value, note: f.elements.note.value.trim() }), 'Mark resolved');
  }
  function rejectApproval(ap) {
    dialog('rigo-reject', 'Reject approval', `<p>${esc(ap.title)} · ${money(ap.proposal.total)}</p>${field('Reason *', '<input name="note" maxlength="300">')}`,
      (f, fail) => f.elements.note.value.trim() ? { type: 'decideApproval', id: ap.id, decision: 'reject', note: f.elements.note.value.trim() } : fail('Give a reason for rejecting.'), 'Reject');
  }
  function seriesEditor(s, existing) {
    const v = existing || { every: { unit: 'week', interval: 1 }, quantity: 1, startDate: today(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    const opts = (id, sel) => list(s, id).filter(r => !r.archived).map(r => `<option value="${esc(r.id)}"${r.id === sel ? ' selected' : ''}>${esc(r.values.name)}</option>`).join('');
    dialog('rigo-series', existing ? 'Change recurring service' : 'New recurring service', `
      ${field('Name *', `<input name="title" maxlength="120" value="${esc(v.title || '')}" placeholder="For example: Weekly toilet service">`)}
      ${field('Client *', `<select name="clientId"><option value="">Choose…</option>${opts('clients', v.clientId)}</select>`)}
      ${field('Service *', `<select name="serviceId"><option value="">Choose…</option>${opts('services', v.serviceId)}</select>`)}
      ${field('Location', `<select name="locationId"><option value="">None</option>${opts('locations', v.locationId)}</select>`)}
      <div class="rigo-grid2">${field('Every *', `<input name="interval" type="number" min="1" max="52" value="${esc(v.every.interval)}">`)}${field('Unit *', `<select name="unit">${['day', 'week', 'month'].map(u => `<option value="${u}"${v.every.unit === u ? ' selected' : ''}>${u}(s)</option>`).join('')}</select>`)}</div>
      <div class="rigo-grid2">${field('Quantity per visit *', `<input name="quantity" type="number" min="0.01" step="any" value="${esc(v.quantity)}">`)}${field('Billing', '<select name="billing" disabled><option>Per visit</option></select>', 'Monthly billing comes later.')}</div>
      <div class="rigo-grid2">${field('Starts *', `<input name="startDate" type="date" value="${esc(v.startDate)}"${existing ? ' disabled' : ''}>`)}${field('Ends', `<input name="endDate" type="date" value="${esc(v.endDate || '')}">`)}</div>
      ${field('Time zone', `<input name="timeZone" value="${esc(v.timeZone || '')}">`, 'Visit dates follow this time zone.')}
      ${existing ? '<p class="rigo-help">Changes apply to this and future visits that have not started, are not assigned, and were not changed by hand. Past visits stay as they were.</p>' : ''}`,
      (f, fail) => {
        const e = f.elements;
        if (!e.title.value.trim()) return fail('Name the recurring service.');
        if (!e.clientId.value || !e.serviceId.value) return fail('Choose a client and a service.');
        const series = { title: e.title.value.trim(), clientId: e.clientId.value, serviceId: e.serviceId.value, locationId: e.locationId.value, quantity: Number(e.quantity.value),
          every: { unit: e.unit.value, interval: Number(e.interval.value) }, startDate: existing ? existing.startDate : e.startDate.value, endDate: e.endDate.value, timeZone: e.timeZone.value.trim() };
        return existing ? { type: 'series', id: existing.id, from: today(), series } : { type: 'series', series };
      });
  }

  // ---- Today: owners, administrators, dispatchers and viewers --------------------------
  function todayPanel(target) {
    const { state: s, role } = current();
    if (!s || !role) return;
    if (role === 'Field employee') return myWork(target, s);
    const day = today();
    const canDispatch = atLeast(role, 'Dispatcher');
    const jobs = s.jobs.filter(j => !j.archived);
    const open = jobs.filter(j => !j.completedAt);
    const attention = [];
    for (const j of open) {
      if (j.date <= day && !j.employeeId) attention.push({ job: j, kind: 'Unassigned', text: j.date < day ? 'Overdue and unassigned' : 'Needs a driver today', suggestion: j.suggestion });
      if (j.acknowledgment?.status === 'Declined') attention.push({ job: j, kind: 'Declined', text: 'Declined' + (j.acknowledgment.reason ? ': ' + j.acknowledgment.reason : ''), suggestion: j.suggestion });
    }
    for (const j of jobs) for (const issue of (j.issues || []).filter(i => i.status === 'open')) attention.push({ job: j, kind: 'Issue', text: (ISSUES[issue.kind] || issue.kind) + (issue.note ? ': ' + issue.note : ''), issue });
    const approvals = (s.approvals || []).filter(a => ['pending', 'stale'].includes(a.status));
    const unpriced = jobs.filter(j => j.completedAt && !(j.quantity * j.rate > 0) && !s.invoices.some(i => i.jobId === j.id));
    const overdue = s.invoices.filter(i => i.due < day && i.paid < i.total);
    const todays = jobs.filter(j => j.date === day);
    const statuses = s.workflow?.statuses || [];
    const invoiced = s.invoices.reduce((a, i) => a + i.total, 0), collected = s.invoices.reduce((a, i) => a + i.paid, 0);
    const drivers = list(s, 'employees').filter(r => !r.archived && (!r.values.role || r.values.role === 'Driver/Field'));
    const units = list(s, 'equipment').filter(r => !r.archived);
    const count = attention.length + approvals.length + unpriced.length + overdue.length;
    const jobLink = j => `<button type="button" class="text-button rigo-open" data-job="${esc(j.id)}">${esc(j.title)}</button>`;
    const auto = s.automation || {};
    target.innerHTML = `<section class="panel rigo-today-panel" aria-labelledby="rigo-today-title">
      <div class="rigo-today-head"><div><h2 id="rigo-today-title">Today</h2><p>${new Date(day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p></div>
        <div class="rigo-mode-chip" title="How much Rigo handles">Assignment: <strong>${esc(effectiveMode(s, 'assignment'))}</strong> · Invoicing: <strong>${esc(effectiveMode(s, 'invoicing'))}</strong>
        ${role === 'Owner' ? `<button type="button" class="outline small" data-pause>${auto.paused ? 'Resume automation' : 'Pause automation'}</button>` : ''}</div></div>
      <div class="rigo-today-grid">
        <section class="rigo-card rigo-attention" aria-labelledby="rigo-att-title"><h3 id="rigo-att-title">Needs attention <span class="rigo-count">${count}</span></h3>
          ${count ? '' : '<p class="rigo-empty">Nothing needs attention right now.</p>'}
          <ul class="rigo-items">
          ${attention.map(a => `<li><span class="rigo-tag rigo-tag-${a.kind.toLowerCase()}">${esc(a.kind)}</span> ${jobLink(a.job)}<small>${esc(a.text)}</small>
            ${a.suggestion && canDispatch ? `<div class="rigo-row-actions"><span>Suggested: <strong>${esc(a.suggestion.name)}</strong> (${esc(a.suggestion.reason)})</span><button type="button" class="outline small" data-accept="${esc(a.job.id)}">Assign ${esc(a.suggestion.name)}</button></div>` : ''}
            ${a.issue && canDispatch ? `<div class="rigo-row-actions"><button type="button" class="outline small" data-resolve="${esc(a.job.id)}|${esc(a.issue.id)}">Resolve</button></div>` : ''}</li>`).join('')}
          ${approvals.map(ap => `<li><span class="rigo-tag rigo-tag-approval">${ap.status === 'stale' ? 'Changed' : 'Approval'}</span> ${esc(ap.title)} · invoice ${money(ap.proposal.total)}<small>${ap.status === 'stale' ? 'The job changed after this was requested. Create the invoice again to request a new approval.' : 'Waiting for ' + (ap.role === 'Owner' ? 'an owner' : 'an administrator') + (ap.backupRole ? ' (backup: ' + ap.backupRole.toLowerCase() + ')' : '') + '. Never approved automatically.'}</small>
            ${ap.status === 'pending' && (role === ap.role || role === ap.backupRole || role === 'Owner') ? `<div class="rigo-row-actions"><button type="button" class="primary small" data-approve="${esc(ap.id)}">Approve ${money(ap.proposal.total)}</button><button type="button" class="text-button" data-reject="${esc(ap.id)}">Reject</button></div>` : ''}</li>`).join('')}
          ${unpriced.map(j => `<li><span class="rigo-tag rigo-tag-price">Price</span> ${jobLink(j)}<small>Completed without a price. Confirm it in Invoices › Ready to invoice.</small></li>`).join('')}
          ${overdue.map(i => `<li><span class="rigo-tag rigo-tag-overdue">Overdue</span> ${esc(i.clientName || '')} · ${money(i.total - i.paid)} due ${esc(i.due)}<small>${esc(i.description || '')}</small></li>`).join('')}
          </ul></section>
        <section class="rigo-card" aria-labelledby="rigo-ops-title"><h3 id="rigo-ops-title">Today's work <span class="rigo-count">${todays.length}</span></h3>
          ${todays.length ? `<ul class="rigo-status-list">${statuses.map(st => `<li><span>${esc(st)}</span><strong>${todays.filter(j => j.status === st).length}</strong></li>`).join('')}</ul>
          <ul class="rigo-items">${todays.map(j => `<li>${jobLink(j)}<small>${esc(j.status)} · ${esc(name(s, 'employees', j.employeeId) || 'Unassigned')}</small></li>`).join('')}</ul>` : '<p class="rigo-empty">No jobs scheduled today.</p>'}</section>
        <section class="rigo-card" aria-labelledby="rigo-res-title"><h3 id="rigo-res-title">Resources today</h3>
          <ul class="rigo-items">${drivers.map(d => { const n = todays.filter(j => j.employeeId === d.id && !j.completedAt).length; return `<li><strong>${esc(d.values.name)}</strong><small>${n ? n + ' open job' + (n > 1 ? 's' : '') : 'Free'}</small></li>`; }).join('') || '<li class="rigo-empty">No field team yet.</li>'}</ul>
          ${units.length ? `<p class="rigo-help">${units.filter(u => (u.values.status || 'Available') === 'Available').length} of ${units.length} units available.</p>` : ''}</section>
        <section class="rigo-card" aria-labelledby="rigo-money-title"><h3 id="rigo-money-title">Invoices and payments</h3>
          <dl class="rigo-money"><div><dt>Invoiced</dt><dd>${money(invoiced)}</dd></div><div><dt>Collected</dt><dd>${money(collected)}</dd></div><div><dt>Outstanding</dt><dd>${money(invoiced - collected)}</dd></div></dl>
          <p class="rigo-help">Totals from recorded invoices and payments. This is not profit: costs are not recorded here.</p></section>
        ${seriesCard(s, role)}
        ${outboxCard(s, role)}
        ${(s.automationLog || []).length ? `<section class="rigo-card" aria-labelledby="rigo-log-title"><h3 id="rigo-log-title">What Rigo did</h3><ul class="rigo-items">${s.automationLog.slice(0, 5).map(l => { const j = s.jobs.find(x => x.id === l.jobId); return `<li>${j ? jobLink(j) : 'A job'}<small>${esc(l.process)} · ${esc(l.mode)} · ${esc(l.outcome)}${l.reason ? ' (' + esc(l.reason) + ')' : ''} · ${new Date(l.at).toLocaleString()}</small></li>`; }).join('')}</ul></section>` : ''}
      </div></section>`;
    wire(target, s);
  }
  function seriesCard(s, role) {
    const series = (s.series || []).filter(x => x.status !== 'ended');
    const can = atLeast(role, 'Dispatcher');
    if (!series.length && !can) return '';
    const next = x => s.jobs.filter(j => j.seriesId === x.id && !j.archived && !j.completedAt && j.date >= today()).sort((a, b) => a.date.localeCompare(b.date))[0];
    return `<section class="rigo-card" aria-labelledby="rigo-series-title"><h3 id="rigo-series-title">Recurring service</h3>
      ${series.length ? `<ul class="rigo-items">${series.map(x => `<li><strong>${esc(x.title)}</strong><small>Every ${x.every.interval > 1 ? x.every.interval + ' ' : ''}${esc(x.every.unit)}${x.every.interval > 1 ? 's' : ''} · ${esc(name(s, 'clients', x.clientId))} · ${x.status === 'paused' ? 'Paused' : next(x) ? 'next visit ' + esc(next(x).date) : 'no visits planned'}</small>
        ${can ? `<div class="rigo-row-actions"><button type="button" class="text-button" data-series-edit="${esc(x.id)}">Change</button><button type="button" class="text-button" data-series-state="${esc(x.id)}|${x.status === 'paused' ? 'active' : 'paused'}">${x.status === 'paused' ? 'Resume' : 'Pause'}</button><button type="button" class="text-button rigo-danger" data-series-state="${esc(x.id)}|ended">End</button></div>` : ''}</li>`).join('')}</ul>` : '<p class="rigo-empty">No recurring service yet.</p>'}
      ${can ? `<div class="rigo-row-actions"><button type="button" class="outline small" data-series-new>New recurring service</button>${series.some(x => x.status === 'active') ? '<button type="button" class="outline small" data-plan>Plan visits for the next 2 weeks</button>' : ''}</div>
      ${s.lastPlanning ? `<p class="rigo-help">Last planned ${new Date(s.lastPlanning.at).toLocaleString()}: ${s.lastPlanning.made} new visit(s) up to ${esc(s.lastPlanning.until)}.</p>` : ''}` : ''}</section>`;
  }
  function wire(target, s) {
    const on = (sel, fn) => target.querySelectorAll(sel).forEach(b => { b.onclick = () => fn(b); });
    const run = async (b, action) => { b.disabled = true; await act(action); b.disabled = false; };
    on('[data-job]', b => window.rigoOpenJob?.(b.dataset.job));
    on('[data-accept]', b => run(b, { type: 'acceptSuggestion', id: b.dataset.accept }));
    on('[data-approve]', b => { if (confirm('Approve this invoice? It is created right away with exactly these amounts.')) run(b, { type: 'decideApproval', id: b.dataset.approve, decision: 'approve' }); });
    on('[data-reject]', b => rejectApproval(s.approvals.find(a => a.id === b.dataset.reject)));
    on('[data-resolve]', b => { const [jid, iid] = b.dataset.resolve.split('|'); const job = s.jobs.find(j => j.id === jid); resolveIssue(job, job.issues.find(i => i.id === iid)); });
    on('[data-pause]', b => run(b, { type: 'automation', paused: !s.automation?.paused }));
    on('[data-series-new]', () => seriesEditor(s));
    on('[data-series-edit]', b => seriesEditor(s, s.series.find(x => x.id === b.dataset.seriesEdit)));
    on('[data-series-state]', b => {
      const [id, status] = b.dataset.seriesState.split('|');
      const msg = { paused: 'Pause this recurring service? Upcoming visits that have not started are archived (not deleted).', ended: 'End this recurring service? Past visits stay; upcoming unstarted visits are archived.', active: 'Resume this recurring service? Plan visits again afterwards.' }[status];
      if (confirm(msg)) run(b, { type: 'seriesState', id, status });
    });
    on('[data-outbox]', () => outboxDialog());
    on('[data-prepare]', b => { const d = new Date(); if (b.dataset.prepare === 'reminders') d.setDate(d.getDate() + 1); run(b, { type: 'prepareMessages', kind: b.dataset.prepare, date: d.toLocaleDateString('en-CA') }); });
    on('[data-plan]', b => { const d = new Date(); d.setDate(d.getDate() + 14); run(b, { type: 'generateVisits', from: today(), until: d.toLocaleDateString('en-CA') }); });
  }

  // ---- My work today: field employees ---------------------------------------------------
  function myWork(target, s) {
    const day = today();
    const mine = s.jobs.filter(j => !j.archived && (j.date === day || (!j.completedAt && j.date < day))).sort((a, b) => String(a.scheduledTime || '').localeCompare(String(b.scheduledTime || '')));
    target.innerHTML = `<section class="panel rigo-today-panel" aria-labelledby="rigo-my-title"><div class="rigo-today-head"><div><h2 id="rigo-my-title">My work today</h2><p>${mine.length} job${mine.length === 1 ? '' : 's'}</p></div></div>
      ${mine.length ? '' : '<p class="rigo-empty">No jobs for you today.</p>'}
      <ul class="rigo-work">${mine.map(j => {
        const loc = row(s, 'locations', j.locationId)?.values || {};
        const ack = j.acknowledgment?.status;
        const units = (j.equipmentIds || []).length;
        return `<li class="rigo-card"><div class="rigo-work-head"><strong>${esc(j.title)}</strong><span class="rigo-tag">${esc(j.status)}</span></div>
          <dl class="rigo-work-facts">
            <div><dt>When</dt><dd>${esc(j.date)}${j.scheduledTime ? ' · ' + esc(j.scheduledTime) : j.serviceTime === 'ASAP' ? ' · ASAP' : ''}</dd></div>
            <div><dt>Service</dt><dd>${esc(j.serviceName || name(s, 'services', j.serviceId))} · ${esc(j.quantity)} ${esc(j.unit || '')}</dd></div>
            <div><dt>Where</dt><dd>${esc([loc.address, loc.city].filter(Boolean).join(', ') || name(s, 'locations', j.locationId) || '—')}</dd></div>
            ${j.vehicleId || units ? `<div><dt>Resources</dt><dd>${esc(name(s, 'vehicles', j.vehicleId))}${units ? (j.vehicleId ? ' · ' : '') + units + ' unit(s)' : ''}</dd></div>` : ''}
            ${loc.contactName || loc.contactPhone ? `<div><dt>Contact</dt><dd>${esc(loc.contactName || '')} ${loc.contactPhone ? `<a href="tel:${esc(loc.contactPhone)}">${esc(loc.contactPhone)}</a>` : ''}</dd></div>` : ''}
            ${j.notes || loc.accessNotes ? `<div><dt>Instructions</dt><dd>${esc([j.notes, loc.accessNotes].filter(Boolean).join(' · '))}</dd></div>` : ''}
          </dl>
          ${(j.issues || []).filter(i => i.status === 'open').map(i => `<p class="rigo-flag">Reported: ${esc(ISSUES[i.kind] || i.kind)}</p>`).join('')}
          <div class="rigo-row-actions">
            ${!j.completedAt && ack === 'Pending' ? `<button type="button" class="primary small" data-ack="${esc(j.id)}">Accept</button><button type="button" class="outline small" data-decline="${esc(j.id)}">Decline</button>` : ''}
            <button type="button" class="outline small" data-job="${esc(j.id)}">${j.completedAt ? 'View' : 'Open to update or complete'}</button>
            ${!j.completedAt ? `<button type="button" class="text-button" data-issue="${esc(j.id)}">Report a problem</button>` : ''}
          </div></li>`;
      }).join('')}</ul></section>`;
    const on = (sel, fn) => target.querySelectorAll(sel).forEach(b => { b.onclick = () => fn(b); });
    on('[data-job]', b => window.rigoOpenJob?.(b.dataset.job));
    on('[data-ack]', async b => { b.disabled = true; const j = s.jobs.find(x => x.id === b.dataset.ack); await act({ type: 'acknowledge', id: j.id, jobRevision: j.revision, status: 'Accepted' }); });
    on('[data-decline]', b => decline(s.jobs.find(x => x.id === b.dataset.decline)));
    on('[data-issue]', b => reportIssue(s.jobs.find(x => x.id === b.dataset.issue)));
  }

  // ---- Automation, approvals and escalation settings ------------------------------------
  // Save results survive the panel re-rendering after a change (shown for 15 seconds).
  let settingsNotice = null;
  function automationSettings(target, inDialog = false) {
    const { state: s, role } = current();
    if (!s) return;
    const owner = role === 'Owner';
    const a = s.automation || {};
    const dis = owner ? '' : ' disabled';
    target.innerHTML = `<section class="rigo-settings" aria-labelledby="rigo-auto-title">
      ${inDialog ? '' : '<h3 id="rigo-auto-title">How much Rigo handles</h3>'}
      <p class="rigo-help">${owner ? 'Choose a company default, then adjust each process if needed.' : 'Only owners change these settings.'} Automatic never skips approvals or missing information, and never sends anything outside Rigo.</p>
      <fieldset class="rigo-structures"${dis}><legend>Company default</legend>${Object.entries(MODES).map(([k, [label, note]]) => `<label class="rigo-structure"><input type="radio" name="rigo-default" value="${k}"${a.default === k ? ' checked' : ''}><span><strong>${label}</strong><small>${note}</small></span></label>`).join('')}</fieldset>
      ${a.default ? '' : '<p class="rigo-flag">Not chosen yet: Rigo works manually until an owner chooses.</p>'}
      <div class="rigo-grid2">${['assignment', 'invoicing'].map(p => `<label class="field rigo-field"><span>${p === 'assignment' ? 'Assigning drivers' : 'Preparing invoices'}</span><select data-process="${p}"${dis}><option value="">Company default</option>${Object.entries(MODES).map(([k, [label]]) => `<option value="${k}"${a.processes?.[p] === k ? ' selected' : ''}>${label}</option>`).join('')}</select>${p === 'invoicing' && s.workflow?.autoInvoice ? '<small class="rigo-help">Your workflow already creates invoices automatically; that setting is kept.</small>' : ''}</label>`).join('')}</div>
      <label class="rigo-check"><input type="checkbox" data-paused${a.paused ? ' checked' : ''}${dis}> Pause automatic steps (suggestions continue)</label>
      ${owner ? '<div class="rigo-actions"><button type="button" class="primary" data-save-auto>Save automation settings</button></div>' : ''}
      <h3>Approvals</h3>
      <p class="rigo-help">Invoices at or above an amount you set wait for the chosen approver. Nothing is approved automatically, and approval covers exactly the amounts shown.</p>
      <ul class="rigo-items">${(s.approvalRules || []).map(r => `<li><strong>Invoices of ${money(r.minTotal)} or more</strong><small>Approved by ${esc(r.role)}${r.backupRole ? ', backup ' + esc(r.backupRole) : ''}${r.enabled === false ? ' · off' : ''}</small>${owner ? `<div class="rigo-row-actions"><button type="button" class="text-button rigo-danger" data-rule-remove="${esc(r.id)}">Remove</button></div>` : ''}</li>`).join('') || '<li class="rigo-empty">No approval rules.</li>'}</ul>
      ${owner ? `<div class="rigo-rule-form"><label class="field rigo-field"><span>Invoice amount ($)</span><input type="number" min="0" step="0.01" data-rule-min></label><label class="field rigo-field"><span>Approver</span><select data-rule-role><option>Owner</option><option>Administrator</option></select></label><label class="field rigo-field"><span>Backup</span><select data-rule-backup><option value="">None</option><option>Owner</option><option>Administrator</option></select></label><button type="button" class="outline" data-rule-add>Add rule</button></div>` : ''}
      <h3>Who handles reported problems</h3>
      <div class="rigo-grid2">${Object.entries(ISSUES).map(([k, label]) => `<label class="field rigo-field"><span>${label}</span><select data-escalate="${k}"${dis}><option value="dispatcher"${(s.exceptionRules || {})[k] !== 'owner' ? ' selected' : ''}>Dispatchers and above</option><option value="owner"${(s.exceptionRules || {})[k] === 'owner' ? ' selected' : ''}>Escalate to owners and administrators</option></select></label>`).join('')}</div>
      <p class="rigo-settings-message" role="status" aria-live="polite"></p></section>`;
    if (!owner) return;
    const say = (t, e) => { settingsNotice = { t, e, at: Date.now() }; const m = target.querySelector('.rigo-settings-message'); m.textContent = t; m.className = 'rigo-settings-message ' + (e ? 'error-text' : 'success-text'); };
    if (settingsNotice && Date.now() - settingsNotice.at < 15000) say(settingsNotice.t, settingsNotice.e);
    target.querySelector('[data-save-auto]').onclick = async () => {
      const def = target.querySelector('input[name="rigo-default"]:checked')?.value;
      if (!def) return say('Choose Manual, Assisted or Automatic.', true);
      const processes = Object.fromEntries([...target.querySelectorAll('[data-process]')].map(x => [x.dataset.process, x.value]));
      say((await act({ type: 'automation', default: def, processes, paused: target.querySelector('[data-paused]').checked })) ? 'Saved.' : 'Not saved.', false);
    };
    target.querySelector('[data-rule-add]').onclick = async () => {
      const min = target.querySelector('[data-rule-min]').value;
      if (min === '') return say('Enter the invoice amount that needs approval.', true);
      await act({ type: 'approvalRule', action: 'invoice', minTotal: Number(min), role: target.querySelector('[data-rule-role]').value, backupRole: target.querySelector('[data-rule-backup]').value });
    };
    target.querySelectorAll('[data-rule-remove]').forEach(b => { b.onclick = () => confirm('Remove this approval rule?') && act({ type: 'approvalRule', remove: true, id: b.dataset.ruleRemove }); });
    target.querySelectorAll('[data-escalate]').forEach(sel => { sel.onchange = () => act({ type: 'exceptionRule', kind: sel.dataset.escalate, handler: sel.value }); });
  }
  function openAutomation() {
    document.getElementById('rigo-auto-dialog')?.remove();
    const d = document.createElement('dialog');
    d.id = 'rigo-auto-dialog'; d.className = 'rigo-dialog';
    d.setAttribute('aria-labelledby', 'rigo-auto-dialog-title');
    d.innerHTML = '<div class="rigo-dialog-head"><h2 id="rigo-auto-dialog-title">How much Rigo handles</h2><button class="text-button" type="button" data-close>Close</button></div><div data-body></div>';
    document.body.append(d);
    d.querySelector('[data-close]').onclick = () => d.close();
    d.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); d.close(); } });
    d.addEventListener('close', () => d.remove());
    automationSettings(d.querySelector('[data-body]'), true);
    d.showModal();
  }

  // ---- Milestone E: setup changes, templates, assistant, customer messages -----------------
  const SOURCES = { assistant: 'From an assistant', template: 'From a template', visual: 'Setup change' };
  const EVENTS = { confirmation: 'Job confirmation', arrival: 'On the way', delay: 'Running late', completion: 'Work completed', invoice: 'Invoice', reminder: 'Visit reminder', payment_reminder: 'Payment reminder' };
  const connected = () => Boolean(window.Rigo?.connected);
  const workspaceId = () => window.Rigo?.workspaceId;
  async function api(path, body) {
    const response = await window.Rigo.request(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }
  function configPanel(target) {
    const { state: s, role } = current();
    if (!s) return;
    const reviewer = ['Owner', 'Administrator'].includes(role);
    const owner = role === 'Owner';
    const pending = (s.configProposals || []).filter(p => p.status === 'pending');
    const m = s.messaging || {};
    target.innerHTML = `<section class="rigo-settings" aria-labelledby="rigo-review-title">
      <h3 id="rigo-review-title">Setup changes waiting for review <span class="rigo-count">${pending.length}</span></h3>
      <p class="rigo-help">Assistants, templates and setup tools all propose changes the same way. Nothing changes until an owner or administrator applies it, and it is checked again when applied.</p>
      ${pending.length ? `<ul class="rigo-items">${pending.map(p => `<li><span class="rigo-tag">${esc(SOURCES[p.source] || 'Setup change')}</span> <strong>${esc(p.summary || 'Setup change')}</strong><small>Proposed by ${esc(p.createdBy)} · ${new Date(p.createdAt).toLocaleString()}</small>
        <ol class="rigo-preview">${p.preview.map(line => `<li>${esc(line)}</li>`).join('')}</ol>
        ${reviewer ? `<div class="rigo-row-actions"><button type="button" class="primary small" data-apply="${esc(p.id)}">Apply these changes</button><button type="button" class="text-button" data-dismiss="${esc(p.id)}">Dismiss</button></div>` : ''}</li>`).join('')}</ul>` : '<p class="rigo-empty">Nothing waiting.</p>'}
      <h3>Setup assistant</h3>
      <div class="rigo-card rigo-muted"><strong>Rigo's built-in assistant is not set up</strong><p class="rigo-help">The platform owner has not chosen an AI service or budget yet, so no AI is used and nothing is charged. If your browser has its own AI assistant, it can propose setup changes to Rigo (tool: <code>propose_configuration</code>); they appear above for review and are never applied on their own.</p></div>
      <h3>Templates</h3>
      <div data-templates>${connected() ? '<p class="rigo-help">Loading templates…</p>' : '<p class="rigo-help">Templates are shared between real companies. They are not available in the demo; use "Create my company" to start from the demo’s structure.</p>'}</div>
      <h3>Sharing with your other companies</h3>
      <div data-sharing>${connected() ? '<p class="rigo-help">Loading…</p>' : '<p class="rigo-help">Sharing is between real companies; not available in the demo.</p>'}</div>
      <h3>Customer messages</h3>
      <p class="rigo-help">Rigo prepares messages from your wording when jobs are booked, on the way, delayed, completed and invoiced, following each client's contact preference. <strong>No email or SMS provider is connected, so nothing is sent</strong>; messages wait in the outbox on Today.</p>
      ${owner ? `<label class="rigo-check"><input type="checkbox" data-msg-enabled${m.enabled ? ' checked' : ''}> Prepare customer messages${m.enabled ? '' : ' (adds Email, Mobile phone and Contact by fields to Clients)'}</label>` : `<p>${m.enabled ? 'Customer messages are prepared.' : 'Customer messages are off.'}</p>`}
      ${m.enabled && owner ? `<label class="field rigo-field"><span>“On the way” is sent at step</span><select data-msg-arrival><option value="">Never</option>${s.workflow.statuses.map(st => `<option${(m.arrivalStatus ?? (s.workflow.statuses.includes('En Route') ? 'En Route' : '')) === st ? ' selected' : ''}>${esc(st)}</option>`).join('')}</select></label>
        <details class="rigo-review"><summary>Edit message wording</summary>${Object.entries(m.templates || {}).map(([k, t]) => `<fieldset class="rigo-msg-tpl" data-tpl="${k}"><legend>${EVENTS[k] || k}</legend><label class="rigo-check"><input type="checkbox" data-tpl-on${t.enabled !== false ? ' checked' : ''}> Prepare this message</label>${field('Subject', `<input data-tpl-subject maxlength="150" value="${esc(t.subject)}">`)}${field('Text', `<textarea data-tpl-body rows="3" maxlength="1000">${esc(t.body)}</textarea>`)}</fieldset>`).join('')}
        <p class="rigo-help">Placeholders: {company} {client} {service} {date} {quantity} {unit} {total} {due}. Rigo never adds prices or promises of its own.</p><button type="button" class="outline" data-tpl-save>Save wording</button></details>` : ''}
      <p class="rigo-settings-message" role="status" aria-live="polite"></p></section>`;
    const say = (t, e) => { const el = target.querySelector('.rigo-settings-message'); el.textContent = t; el.className = 'rigo-settings-message ' + (e ? 'error-text' : 'success-text'); };
    target.querySelectorAll('[data-apply]').forEach(b => { b.onclick = async () => { b.disabled = true; if (await act({ type: 'decideConfig', id: b.dataset.apply, decision: 'apply' })) say('Changes applied.'); else b.disabled = false; }; });
    target.querySelectorAll('[data-dismiss]').forEach(b => { b.onclick = () => act({ type: 'decideConfig', id: b.dataset.dismiss, decision: 'dismiss' }); });
    const enabled = target.querySelector('[data-msg-enabled]');
    if (enabled) enabled.onchange = async () => {
      if (enabled.checked && !confirm('Prepare customer messages? This adds Email, Mobile phone and Contact by fields to Clients. Nothing is sent until an email or SMS provider is connected.')) { enabled.checked = false; return; }
      await act({ type: 'messaging', enabled: enabled.checked });
    };
    const arrival = target.querySelector('[data-msg-arrival]');
    if (arrival) arrival.onchange = () => act({ type: 'messaging', arrivalStatus: arrival.value });
    const save = target.querySelector('[data-tpl-save]');
    if (save) save.onclick = async () => {
      const templates = Object.fromEntries([...target.querySelectorAll('[data-tpl]')].map(f => [f.dataset.tpl, { enabled: f.querySelector('[data-tpl-on]').checked, subject: f.querySelector('[data-tpl-subject]').value, body: f.querySelector('[data-tpl-body]').value }]));
      say((await act({ type: 'messaging', templates })) ? 'Wording saved.' : 'Not saved.', false);
    };
    if (connected()) templatesSection(target.querySelector('[data-templates]'), owner, reviewer).catch(e => { target.querySelector('[data-templates]').textContent = e.message; });
    if (connected() && reviewer) sharingSection(target.querySelector('[data-sharing]'), owner).catch(e => { target.querySelector('[data-sharing]').textContent = e.message; });
    else if (connected()) target.querySelector('[data-sharing]').innerHTML = '<p class="rigo-help">Owners and administrators manage sharing.</p>';
  }
  // Template results survive the panel re-rendering after a save (shown for 15 seconds).
  let templateNotice = null;
  async function templatesSection(box, owner, reviewer) {
    const { templates } = await api('/api/templates');
    const mine = templates.filter(t => t.mine), shared = templates.filter(t => !t.mine);
    box.innerHTML = `<p class="rigo-help">A template holds this company's structure only: list fields, job steps, modules and rules (switched off). Never customers, team, prices, records or credentials. Companies that used a template are never changed by a newer version.</p>
      ${owner ? `<div class="rigo-rule-form"><label class="field rigo-field"><span>Template name</span><input data-tpl-name maxlength="80" placeholder="For example: Fuel delivery setup"></label><label class="field rigo-field"><span>Description</span><input data-tpl-desc maxlength="300"></label><button type="button" class="outline" data-publish>Save as template</button></div>` : ''}
      ${mine.length ? `<h4>Your templates</h4><ul class="rigo-items">${mine.map(t => `<li><strong>${esc(t.name)}</strong> · version ${t.version}<small>${t.visibility === 'selected' ? 'Shared with ' + esc(t.sharedWith.join(', ') || 'nobody yet') : 'Only you'}</small>
        <div class="rigo-row-actions">${owner ? `<button type="button" class="text-button" data-new-version="${esc(t.id)}|${esc(t.name)}">Save this setup as version ${t.version + 1}</button>` : ''}<button type="button" class="text-button" data-share="${esc(t.id)}">Share…</button></div></li>`).join('')}</ul>` : ''}
      ${shared.length ? `<h4>Shared with you</h4><ul class="rigo-items">${shared.map(t => `<li><strong>${esc(t.name)}</strong> · version ${t.version}<small>${esc(t.description)}</small>${reviewer ? `<div class="rigo-row-actions"><button type="button" class="text-button" data-use="${esc(t.id)}|${t.version}">Review for this company</button></div>` : ''}</li>`).join('')}</ul>` : ''}
      <p class="rigo-tpl-message" role="status" aria-live="polite"></p>`;
    const say = (t, e) => { templateNotice = { t, e, at: Date.now() }; const el = box.querySelector('.rigo-tpl-message'); if (el) { el.textContent = t; el.className = 'rigo-tpl-message ' + (e ? 'error-text' : 'success-text'); } };
    if (templateNotice && Date.now() - templateNotice.at < 15000) say(templateNotice.t, templateNotice.e);
    const reload = () => templatesSection(box, owner, reviewer).catch(e => say(e.message, true));
    const publish = async (templateId, name, description) => {
      try { const r = await api('/api/templates', { op: 'publish', workspace: workspaceId(), templateId, name, description }); say('Saved as version ' + r.version + '.'); reload(); }
      catch (e) { say(e.message, true); }
    };
    box.querySelector('[data-publish]')?.addEventListener('click', () => {
      const name = box.querySelector('[data-tpl-name]').value.trim();
      if (!name) return say('Name the template.', true);
      publish(undefined, name, box.querySelector('[data-tpl-desc]').value.trim());
    });
    box.querySelectorAll('[data-new-version]').forEach(b => { b.onclick = () => { const [id, name] = b.dataset.newVersion.split('|'); if (confirm('Save this company’s current setup as a new version? Companies using earlier versions are not changed.')) publish(id, name); }; });
    box.querySelectorAll('[data-share]').forEach(b => { b.onclick = () => {
      const t = mine.find(x => x.id === b.dataset.share);
      dialog('rigo-share', 'Share “' + t.name + '”', `${field('Who can use it', `<select name="visibility"><option value="private"${t.visibility === 'private' ? ' selected' : ''}>Only me</option><option value="selected"${t.visibility === 'selected' ? ' selected' : ''}>People I choose</option></select>`)}
        ${field('Their emails (one per line)', `<textarea name="emails" rows="4">${esc(t.sharedWith.join('\n'))}</textarea>`, 'They see the template when they sign in with these emails. Public sharing is not available yet.')}`,
        (f, fail) => {
          api('/api/templates', { op: 'share', templateId: t.id, visibility: f.elements.visibility.value, sharedWith: f.elements.emails.value.split(/[\s,;]+/).filter(Boolean) })
            .then(() => { document.getElementById('rigo-share')?.close(); reload(); }).catch(e => fail(e.message));
          return null;
        }, 'Save sharing');
    }; });
    box.querySelectorAll('[data-use]').forEach(b => { b.onclick = async () => {
      const [id, version] = b.dataset.use.split('|');
      try { await api('/api/templates', { op: 'apply', templateId: id, version: Number(version), workspace: workspaceId() }); say('Added to “Setup changes waiting for review”. Nothing has changed yet.'); window.rigoRefresh?.(); }
      catch (e) { say(e.message, true); }
    }; });
  }
  const LIST_NAMES = { clients: 'Clients', locations: 'Locations', services: 'Services', employees: 'Team', vehicles: 'Vehicles', equipment: 'Equipment' };
  let sharingNotice = null;
  async function sharingSection(box, owner) {
    const ws = workspaceId();
    const [{ shares, targets }, { shared }] = await Promise.all([api('/api/shares?workspace=' + encodeURIComponent(ws)), api('/api/shares?records=1&workspace=' + encodeURIComponent(ws))]);
    const open = shares.filter(x => ['pending', 'active'].includes(x.status));
    box.innerHTML = `<p class="rigo-help">Companies are separate by default. You can share chosen lists with another company you also run. An owner there must accept. Shared records are read-only and copied only when you choose. Invoices, payments and money are never shared. Either side can stop sharing at any time.</p>
      ${open.length ? `<ul class="rigo-items">${open.map(x => `<li><strong>${x.direction === 'out' ? 'Sharing with ' : 'Shared by '}${esc(x.other)}</strong> · ${x.lists.map(l => LIST_NAMES[l] || l).join(', ')}<small>${x.status === 'pending' ? 'Waiting for an owner of ' + (x.direction === 'out' ? esc(x.other) : 'this company') + ' to accept' : 'Active'}</small>
        <div class="rigo-row-actions">${x.direction === 'in' && x.status === 'pending' && owner ? `<button type="button" class="primary small" data-share-op="accept|${esc(x.id)}">Accept</button><button type="button" class="text-button" data-share-op="decline|${esc(x.id)}">Decline</button>` : ''}${owner ? `<button type="button" class="text-button rigo-danger" data-share-op="revoke|${esc(x.id)}">Stop sharing</button>` : ''}</div></li>`).join('')}</ul>` : '<p class="rigo-empty">No sharing agreements.</p>'}
      ${owner && targets.length ? `<div class="rigo-share-form"><label class="field rigo-field"><span>Share with</span><select data-share-to>${targets.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label>
        <fieldset class="rigo-share-lists"><legend>Lists to share</legend>${Object.entries(LIST_NAMES).map(([k, v]) => `<label class="rigo-check"><input type="checkbox" value="${k}"> ${v}</label>`).join('')}</fieldset>
        <button type="button" class="outline" data-share-propose>Propose sharing</button></div>` : owner ? '<p class="rigo-help">You can share with companies where you are also an owner or administrator.</p>' : ''}
      ${shared.map(sh => `<h4>From ${esc(sh.from)}</h4>${sh.lists.map(l => `<details class="rigo-review"><summary>${esc(l.name)} (${l.rows.length})</summary>
        <div class="rigo-shared-table" role="group" aria-label="${esc(l.name)} shared by ${esc(sh.from)}"><table><thead><tr><th scope="col"><span class="rigo-sr">Select</span></th>${l.fields.slice(0, 5).map(f => `<th scope="col">${esc(f.name)}</th>`).join('')}</tr></thead>
        <tbody>${l.rows.map(r => `<tr><td><input type="checkbox" aria-label="Select ${esc(r.values.name || r.values.code || 'record')}" data-row="${esc(r.id)}"></td>${l.fields.slice(0, 5).map(f => `<td>${esc(r.values[f.id])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <button type="button" class="outline small" data-copy-rows="${esc(sh.shareId)}|${esc(l.id)}">Copy selected into this company</button></details>`).join('')}`).join('')}
      <p class="rigo-share-message" role="status" aria-live="polite"></p>`;
    const say = (t, e) => { sharingNotice = { t, e, at: Date.now() }; const el = box.querySelector('.rigo-share-message'); el.textContent = t; el.className = 'rigo-share-message ' + (e ? 'error-text' : 'success-text'); };
    if (sharingNotice && Date.now() - sharingNotice.at < 15000) say(sharingNotice.t, sharingNotice.e);
    const reload = () => sharingSection(box, owner).catch(e => say(e.message, true));
    box.querySelectorAll('[data-share-op]').forEach(b => { b.onclick = async () => {
      const [op, id] = b.dataset.shareOp.split('|');
      if (op === 'revoke' && !confirm('Stop sharing? The other company loses access to these lists right away. Records it already copied stay its own.')) return;
      if (op === 'accept' && !confirm('Accept? This company will see the shared lists read-only.')) return;
      try { await api('/api/shares', { op, id }); say({ accept: 'Sharing accepted.', decline: 'Declined.', revoke: 'Sharing stopped.' }[op]); reload(); } catch (e) { say(e.message, true); }
    }; });
    box.querySelector('[data-share-propose]')?.addEventListener('click', async () => {
      const lists = [...box.querySelectorAll('.rigo-share-lists input:checked')].map(x => x.value);
      if (!lists.length) return say('Choose at least one list.', true);
      try { await api('/api/shares', { op: 'propose', from: ws, to: box.querySelector('[data-share-to]').value, lists }); say('Proposed. An owner of that company must accept it.'); reload(); } catch (e) { say(e.message, true); }
    });
    box.querySelectorAll('[data-copy-rows]').forEach(b => { b.onclick = async () => {
      const [shareId, listId] = b.dataset.copyRows.split('|');
      const rowIds = [...b.closest('details').querySelectorAll('input[data-row]:checked')].map(x => x.dataset.row);
      if (!rowIds.length) return say('Select the records to copy.', true);
      try { const r = await api('/api/shares', { op: 'copy', workspace: ws, shareId, listId, rowIds }); say(`Copied ${r.added} record(s)` + (r.skipped ? `; ${r.skipped} already existed` : '') + '.'); window.rigoRefresh?.(); } catch (e) { say(e.message, true); }
    }; });
  }
  // Consolidated view across the companies a person runs; each company's money stays separate.
  async function openOverview() {
    document.getElementById('rigo-overview')?.remove();
    const d = document.createElement('dialog');
    d.id = 'rigo-overview'; d.className = 'rigo-dialog';
    d.setAttribute('aria-labelledby', 'rigo-overview-title');
    d.innerHTML = '<div class="rigo-dialog-head"><h2 id="rigo-overview-title">All my companies</h2><button class="text-button" type="button" data-close>Close</button></div><div data-body><p class="rigo-help">Loading…</p></div>';
    document.body.append(d);
    d.querySelector('[data-close]').onclick = () => d.close();
    d.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); d.close(); } });
    d.addEventListener('close', () => d.remove());
    d.showModal();
    try {
      const { companies } = await api('/api/overview');
      d.querySelector('[data-body]').innerHTML = companies.length ? `<p class="rigo-help">Companies where you are an owner or administrator. Each company's money is shown on its own; amounts are never combined.</p>
        <div class="rigo-overview-table"><table><thead><tr><th scope="col">Company</th><th scope="col">Today</th><th scope="col">Needs attention</th><th scope="col">Invoiced</th><th scope="col">Collected</th><th scope="col">Outstanding</th><th scope="col"><span class="rigo-sr">Open</span></th></tr></thead>
        <tbody>${companies.map(c => `<tr><th scope="row">${esc(c.name)}<small>${esc(c.role)}</small></th><td>${c.today}</td><td>${c.attention + c.unpriced}</td><td>${money(c.money.invoiced)}</td><td>${money(c.money.collected)}</td><td>${money(c.money.outstanding)}</td><td>${c.id === workspaceId() ? 'Current' : `<button type="button" class="text-button" data-go="${esc(c.id)}">Open</button>`}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="rigo-empty">You are not an owner or administrator of any company.</p>';
      d.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => location.assign('/?company=' + b.dataset.go); });
    } catch (e) { d.querySelector('[data-body]').textContent = e.message; }
  }
  function outboxCard(s, role) {
    if (!s.messaging?.enabled || !atLeast(role, 'Dispatcher')) return '';
    const open = (s.outbox || []).filter(m => m.status !== 'dismissed');
    return `<section class="rigo-card" aria-labelledby="rigo-outbox-title"><h3 id="rigo-outbox-title">Customer messages <span class="rigo-count">${open.length}</span></h3>
      <p class="rigo-help">Prepared, not sent: no email or SMS provider is connected.</p>
      ${s.lastPrepared ? `<p class="rigo-help">Last prepared ${new Date(s.lastPrepared.at).toLocaleString()}: ${s.lastPrepared.made} new message(s).</p>` : ''}
      <div class="rigo-row-actions"><button type="button" class="outline small" data-outbox>Review outbox</button><button type="button" class="text-button" data-prepare="reminders">Prepare tomorrow's reminders</button><button type="button" class="text-button" data-prepare="paymentReminders">Prepare payment reminders</button></div></section>`;
  }
  function outboxDialog() {
    const { state: s } = current();
    const open = (s.outbox || []).filter(m => m.status !== 'dismissed');
    document.getElementById('rigo-outbox')?.remove();
    const d = document.createElement('dialog');
    d.id = 'rigo-outbox'; d.className = 'rigo-dialog';
    d.setAttribute('aria-labelledby', 'rigo-outbox-dialog-title');
    d.innerHTML = `<div class="rigo-dialog-head"><h2 id="rigo-outbox-dialog-title">Outbox</h2><button class="text-button" type="button" data-close>Close</button></div>
      <p class="rigo-help">Nothing here has been sent. You can copy a message to send it yourself.</p>
      ${open.length ? `<ul class="rigo-items">${open.map(m => `<li><span class="rigo-tag">${esc(EVENTS[m.event] || m.event)}</span> <strong>${esc(m.subject)}</strong>
        <small>To: ${esc([m.to.email, m.to.phone].filter(Boolean).join(', ') || 'no address')} · ${esc(m.status === 'skipped' ? 'Not prepared: ' + m.note : 'Not sent: ' + m.note)}</small>
        <p class="rigo-msg-body">${esc(m.body)}</p><div class="rigo-row-actions"><button type="button" class="text-button" data-copy="${esc(m.id)}">Copy text</button><button type="button" class="text-button" data-dismiss-msg="${esc(m.id)}">Dismiss</button></div></li>`).join('')}</ul>` : '<p class="rigo-empty">The outbox is empty.</p>'}`;
    document.body.append(d);
    d.querySelector('[data-close]').onclick = () => d.close();
    d.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); d.close(); } });
    d.addEventListener('close', () => d.remove());
    d.querySelectorAll('[data-copy]').forEach(b => { b.onclick = async () => { const msg = open.find(x => x.id === b.dataset.copy); try { await navigator.clipboard.writeText(msg.subject + '\n\n' + msg.body); b.textContent = 'Copied'; } catch { b.textContent = 'Copy not available'; } }; });
    d.querySelectorAll('[data-dismiss-msg]').forEach(b => { b.onclick = async () => { b.disabled = true; if (await act({ type: 'messageState', id: b.dataset.dismissMsg, status: 'dismissed' })) b.closest('li').remove(); }; });
    d.showModal();
  }
  // In-browser AI assistants (WebMCP) may propose setup changes; owners review them in Rigo.
  if (document.modelContext?.registerTool) {
    try {
      Promise.resolve(document.modelContext.registerTool({
        name: 'propose_configuration',
        description: 'Propose setup changes for the open Rigo company as structured steps (addList, addField, workflow, modules, labels, automation, approvalRule, exceptionRule). Changes are only proposed: an owner or administrator reviews and applies them in Rigo. Never include customer data, prices or invented facts.',
        inputSchema: { type: 'object', properties: { summary: { type: 'string', maxLength: 300 }, ops: { type: 'array', maxItems: 50, items: { type: 'object' } } }, required: ['ops'], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: async input => {
          if (window.Rigo?.demo) return { proposed: false, reason: 'The demo does not accept assistant changes.' };
          const ok = await act({ type: 'proposeConfig', ops: input?.ops, summary: String(input?.summary || 'Assistant proposal'), source: 'assistant' });
          return ok ? { proposed: true, review: 'Waiting for an owner or administrator in App settings › Process builder.' } : { proposed: false, reason: 'Rigo refused the proposal; see the message in the app.' };
        }
      })).catch(() => {});
    } catch {}
  }

  // ---- Rendering --------------------------------------------------------------------------
  // Re-render on every state change, except while someone is typing in that area.
  const typing = el => { const a = document.activeElement; return el.contains(a) && (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(a.type))); };
  function render() {
    const today = document.getElementById('rigo-today');
    if (today && !typing(today)) todayPanel(today);
    const auto = document.getElementById('rigo-automation');
    if (auto && !typing(auto)) automationSettings(auto);
    const config = document.getElementById('rigo-config');
    if (config && !typing(config) && !config.querySelector('dialog[open]')) configPanel(config);
    const dlg = document.querySelector('#rigo-auto-dialog [data-body]');
    if (dlg && !typing(dlg)) automationSettings(dlg, true);
  }
  let queued = false;
  const schedule = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; render(); }); };
  window.addEventListener('rigo:state', schedule);
  new MutationObserver(muts => {
    if (muts.some(m => [...m.addedNodes].some(n => n.nodeType === 1 && (['rigo-today', 'rigo-automation', 'rigo-config'].includes(n.id) || n.querySelector?.('#rigo-today,#rigo-automation,#rigo-config'))))) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.Rigo = Object.assign(window.Rigo || {}, { openAutomation, openOverview });
})();
