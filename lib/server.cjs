const { randomUUID } = require('node:crypto');
const domain = require('./domain.cjs');
const { structureOps, previewOps } = require('./structure.cjs');

const roles = ['Administrator', 'Dispatcher', 'Field employee', 'Viewer'];
const allRoles = ['Owner', ...roles];
const INVITE_DAYS = 7;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function check(ok, status, message) { if (!ok) throw new HttpError(status, message); }
// Database rule failures raised as `rigo:<code>` by the SQL functions.
const RULE_ERRORS = {
  name_required: [400, 'Enter a company name.'],
  request_required: [400, 'Retry creating the company.'],
  not_found: [404, 'This invitation is not available to your account.'],
  not_member: [403, 'You do not have access to this company.'],
  not_allowed: [403, 'Your role cannot grant, change or remove that access.'],
  already_member: [409, 'This person is already a member of the company. Change their role in People & access instead.'],
  target_not_member: [404, 'That person is not an active member of this company.'],
  last_owner: [409, 'A company must keep at least one owner. Make someone else an owner first.'],
  already_shared: [409, 'These companies already have an open sharing agreement in that direction.'],
  too_many_companies: [429, 'You have created several companies today. Try again tomorrow or contact support.']
};
function settings(env = process.env) {
  const url = env.SUPABASE_URL?.replace(/\/$/, '');
  const key = env.SUPABASE_ANON_KEY;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl = env.RIGO_APP_URL?.replace(/\/$/, '');
  const configured = Boolean(url && key && service && appUrl);
  if (configured) check(/^https:\/\//.test(url) && /^https:\/\//.test(appUrl), 503, 'Use HTTPS Supabase and app URLs.');
  return { url, key, service, appUrl, configured, mapboxToken: env.MAPBOX_TOKEN };
}
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const isId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
// Apply the same versioned upgrades the business rules apply on every save,
// so older workspaces read with their current defaults.
function current(state) {
  const out = structuredClone(state);
  // A read must never lock people out; saves still normalize strictly.
  try { domain.normalize(out); } catch { return structuredClone(state); }
  return out;
}
function visibleState(state, role, email) {
  const out = current(state);
  if (!['Owner', 'Administrator'].includes(role)) {
    out.members = [];
    out.accessRequests = [];
    delete out.resetBackup;
  }
  if (role !== 'Field employee') return out;
  const employee = domain.employeeFor(state, email);
  out.jobs = state.jobs.filter(j => employee && j.employeeId === employee.id);
  const ids = {
    employees: new Set(employee ? [employee.id] : []),
    clients: new Set(out.jobs.map(j => j.clientId)),
    services: new Set(out.jobs.map(j => j.serviceId)),
    locations: new Set(out.jobs.map(j => j.locationId)),
    equipment: new Set(out.jobs.flatMap(j => j.equipmentIds?.length ? j.equipmentIds : [j.equipmentId])),
    vehicles: new Set(out.jobs.map(j => j.vehicleId)),
    jobs: new Set(out.jobs.map(j => j.id))
  };
  out.lists = out.lists.map(l => ({ ...l, rows: l.rows.filter(r => ids[l.id]?.has(r.id)) }));
  for (const key of ['invoices', 'imports', 'views', 'notifications', 'inquiries', 'stockMoves', 'outbox', 'approvals', 'configProposals', 'automationLog', 'series']) out[key] = [];
  return out;
}
// Structure for a brand-new company: no records, members, credentials or integrations.
// A starting structure is generated here from the reviewed templates, never taken from the client.
function blankCompanyState(name, template) {
  let state = domain.createState(String(name).trim());
  if (template) state = domain.applyAction(state, { type: 'applyTemplate', template }, 'Owner');
  state.members = [];
  state.accessRequests = [];
  delete state.resetBackup;
  // Paid services start off for new companies. Companies that existed before
  // Milestone A have no flag and keep the address lookup they already had.
  state.integrations = { geocoding: false };
  return state;
}

function createServer({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const config = settings(env);
  const nowIso = () => new Date(now()).toISOString();
  async function supabase(path, { method = 'GET', body, admin = true, token } = {}) {
    const key = admin ? config.service : config.key;
    const response = await fetchImpl(config.url + path, {
      method,
      headers: { apikey: key, Authorization: `Bearer ${token || key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const rule = /^rigo:(\w+)/.exec(data?.message || '')?.[1];
      if (rule && RULE_ERRORS[rule]) {
        const error = new HttpError(...RULE_ERRORS[rule]);
        error.rule = rule;
        throw error;
      }
      // Do not send database internals or credentials to the client.
      const error = new HttpError(response.status >= 500 ? 502 : 400, path.startsWith('/auth/') ?
        (data?.msg || data?.message || data?.error_description || 'Authentication request failed.') :
        'Shared storage request failed. Check the Supabase setup.');
      error.code = data?.error_code || data?.code;
      throw error;
    }
    return data;
  }
  const rpc = (name, args) => supabase('/rest/v1/rpc/' + name, { method: 'POST', body: args });
  async function authenticate(req) {
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    check(match, 401, 'Sign in to Rigo to continue.');
    let user;
    try { user = await supabase('/auth/v1/user', { admin: false, token: match[1] }); }
    catch { throw new HttpError(401, 'Your session expired. Sign in again.'); }
    check(user?.id && user.email && user.email_confirmed_at, 403, 'Verify your email before accessing Rigo.');
    return user;
  }
  // The caller's role in one company, from the membership table. Null when none.
  async function roleIn(user, workspaceId) {
    const rows = await supabase(`/rest/v1/rigo_memberships?select=role&workspace_id=eq.${workspaceId}&user_id=eq.${user.id}&status=eq.active`);
    return rows[0]?.role || null;
  }
  // Every company operation names its company explicitly. There is no default company.
  async function access(user, workspaceId) {
    check(isId(workspaceId), 400, 'Choose a company first.');
    const role = await roleIn(user, workspaceId);
    // The same answer whether the company exists or not, so ids reveal nothing.
    check(role, 403, 'You do not have access to this company.');
    const [row] = await supabase(`/rest/v1/rigo_workspaces?id=eq.${workspaceId}&select=*`);
    check(row, 403, 'You do not have access to this company.');
    return { row, role };
  }
  async function loadWorkspace(id) {
    const [row] = await supabase(`/rest/v1/rigo_workspaces?id=eq.${id}&select=*`);
    return row;
  }
  async function save(row, next) {
    const rows = await supabase(`/rest/v1/rigo_workspaces?id=eq.${row.id}&version=eq.${row.version}`, {
      method: 'PATCH', body: { ...next, version: row.version + 1 }
    });
    check(rows?.length === 1, 409, 'Someone else changed this workspace. Refresh and try again.');
    return rows[0];
  }
  // Re-read and retry on version conflicts so concurrent saves are never lost.
  async function update(id, change) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await loadWorkspace(id);
      const next = change(latest);
      if (!next) return latest;
      try { return await save(latest, next); }
      catch (error) { if (error.status !== 409 || attempt === 2) throw error; }
    }
  }
  const auditEntry = (actor, action, detail) => ({ id: randomUUID(), actor: normalizeEmail(actor), action, detail: JSON.stringify(detail), at: nowIso() });
  // state.members is a display copy of the membership table (People & access, Team
  // linking). Authorization never reads it.
  async function syncMembers(workspaceId, auditItem) {
    const [members, invitations] = await Promise.all([
      supabase(`/rest/v1/rigo_memberships?select=email,role,user_id,created_at&workspace_id=eq.${workspaceId}&status=eq.active&order=created_at.asc`),
      supabase(`/rest/v1/rigo_invitations?select=id,email,role,created_at,expires_at&workspace_id=eq.${workspaceId}&status=eq.pending&order=created_at.asc`)
    ]);
    const mirror = [
      ...members.map(m => ({ email: normalizeEmail(m.email), role: m.role, invitation: { status: 'active', userId: m.user_id } })),
      ...invitations.filter(i => Date.parse(i.expires_at) > now()).map(i => ({ email: normalizeEmail(i.email), role: i.role, invitation: { status: 'sent', id: i.id, at: i.created_at, expiresAt: i.expires_at } }))
    ];
    await update(workspaceId, latest => {
      const same = domain.canonical(latest.state.members || []) === domain.canonical(mirror);
      if (same && !auditItem) return null;
      return { state: { ...latest.state, members: mirror }, ...(auditItem ? { audit: [auditItem, ...latest.audit].slice(0, 100) } : {}) };
    });
  }
  async function sendInvitationEmail(email) {
    const redirect = `${config.appUrl}/?invite=1`;
    try {
      await supabase('/auth/v1/invite?redirect_to=' + encodeURIComponent(redirect), { method: 'POST', body: { email } });
    } catch (error) {
      if (!['email_exists', 'user_already_exists'].includes(error.code)) throw error;
      // An existing account gets a sign-in link instead of a second account.
      await supabase('/auth/v1/otp?redirect_to=' + encodeURIComponent(redirect), { method: 'POST', admin: false, body: { email, create_user: false } });
    }
  }
  // People & access: invite, change a role, remove, or withdraw an invitation.
  async function manageMember(row, role, user, action, body) {
    check(['Owner', 'Administrator'].includes(role), 403, 'Only owners and administrators manage access.');
    const email = normalizeEmail(action.email);
    check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254, 400, 'Enter a valid email.');
    const [target] = await supabase(`/rest/v1/rigo_memberships?select=user_id,role&workspace_id=eq.${row.id}&email=eq.${encodeURIComponent(email)}&status=eq.active`);
    let outcome;
    if (action.remove) {
      if (target) {
        await rpc('rigo_change_member', { p_workspace: row.id, p_actor: user.id, p_target: target.user_id, p_role: null, p_remove: true });
        outcome = 'memberRemoved';
      } else {
        const [pending] = await supabase(`/rest/v1/rigo_invitations?select=id&workspace_id=eq.${row.id}&email=eq.${encodeURIComponent(email)}&status=eq.pending`);
        check(pending, 404, 'That person is not a member and has no pending invitation.');
        await rpc('rigo_revoke_invitation', { p_invitation: pending.id, p_actor: user.id });
        outcome = 'invitationRevoked';
      }
    } else {
      check(allRoles.includes(action.role), 400, 'Choose a valid role.');
      if (target) {
        if (target.role === action.role) return { ok: true, unchanged: true };
        await rpc('rigo_change_member', { p_workspace: row.id, p_actor: user.id, p_target: target.user_id, p_role: action.role, p_remove: false });
        outcome = 'memberRoleChanged';
      } else {
        const [recent] = await supabase(`/rest/v1/rigo_invitations?select=created_at&workspace_id=eq.${row.id}&email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=1`);
        check(!recent || now() - Date.parse(recent.created_at) >= 60000, 429, 'Wait a minute before sending another invitation.');
        const invitationId = await rpc('rigo_invite', { p_workspace: row.id, p_actor: user.id, p_email: email, p_role: action.role, p_days: INVITE_DAYS });
        try { await sendInvitationEmail(email); }
        catch {
          await rpc('rigo_revoke_invitation', { p_invitation: invitationId, p_actor: user.id }).catch(() => {});
          await syncMembers(row.id).catch(() => {});
          throw new HttpError(502, 'The invitation email could not be sent, so the invitation was withdrawn. Check Supabase email delivery, then try again.');
        }
        outcome = 'employeeInvited';
      }
    }
    await syncMembers(row.id, auditEntry(user.email, outcome, { email, role: action.role }));
    if (body.requestId) await update(row.id, latest => ({ receipts: { ...latest.receipts, [body.requestId]: JSON.stringify(action) } }));
    return { ok: true, invitationSent: outcome === 'employeeInvited' };
  }
  // Self-sign-up requests to join one company, reached through its owner's sign-up link.
  async function accessRequests(req, user, body) {
    const workspaceId = req.method === 'GET' ? req.query?.workspace : body.workspace;
    check(isId(workspaceId), 400, 'This sign-up link is incomplete. Ask the company for a new link.');
    const role = await roleIn(user, workspaceId);
    const email = normalizeEmail(user.email);
    const list = state => (state.accessRequests || []).filter(r => r.status === 'pending');
    if (req.method === 'GET') {
      if (['Owner', 'Administrator'].includes(role)) {
        const row = await loadWorkspace(workspaceId);
        return { requests: list(row.state), signupUrl: `${config.appUrl}/?signup=1&join=${workspaceId}` };
      }
      if (role) return { status: 'approved' };
      const row = await loadWorkspace(workspaceId);
      const own = (row?.state.accessRequests || []).find(r => r.userId === user.id);
      return { status: own?.status === 'approved' ? 'removed' : own?.status || 'none' };
    }
    check(req.method === 'POST', 405, 'Method not allowed.');
    if (body.op === 'request') {
      if (role) return { status: 'approved' };
      const row = await loadWorkspace(workspaceId);
      check(row, 404, 'This sign-up link is no longer valid. Ask the company for a new link.');
      const name = String(body.name || '').trim().slice(0, 80);
      let status;
      await update(row.id, latest => {
        const state = structuredClone(latest.state);
        state.accessRequests ||= [];
        const existing = state.accessRequests.find(r => r.userId === user.id);
        // A declined request stays declined; a removed member needs a new invitation.
        if (existing) { status = existing.status === 'approved' ? 'removed' : existing.status; return null; }
        check(list(state).length < 200, 429, 'Too many pending access requests. Ask the company to review them.');
        state.accessRequests.push({ id: randomUUID(), userId: user.id, email, name, status: 'pending', at: nowIso() });
        status = 'pending';
        return { state };
      });
      return { status };
    }
    check(['Owner', 'Administrator'].includes(role), 403, 'Only owners and administrators can review access requests.');
    check(typeof body.requestId === 'string', 400, 'Choose an access request.');
    check(['approve', 'decline'].includes(body.op), 400, 'Choose approve or decline.');
    const row = await loadWorkspace(workspaceId);
    const request = list(row.state).find(r => r.id === body.requestId);
    check(request, 404, 'This request was already handled. Refresh to see the latest list.');
    if (body.op === 'approve') {
      check(roles.includes(body.role) || body.role === 'Owner', 400, 'Choose a valid role.');
      await rpc('rigo_add_member', { p_workspace: workspaceId, p_actor: user.id, p_user: request.userId, p_email: request.email, p_role: body.role });
    }
    await update(workspaceId, latest => {
      const state = structuredClone(latest.state);
      const target = (state.accessRequests || []).find(r => r.id === body.requestId);
      if (!target || target.status !== 'pending') return null;
      target.status = body.op === 'approve' ? 'approved' : 'declined';
      target.decidedAt = nowIso();
      return { state, audit: [auditEntry(email, body.op === 'approve' ? 'accessApproved' : 'accessDeclined', { email: request.email, role: body.role }), ...latest.audit].slice(0, 100) };
    });
    if (body.op === 'approve') await syncMembers(workspaceId);
    return { ok: true };
  }
  async function templateFor(user, id, version) {
    check(isId(id), 400, 'Choose a template.');
    const [t] = await supabase(`/rest/v1/rigo_templates?select=*&id=eq.${id}`);
    const email = normalizeEmail(user.email);
    check(t && (t.owner_id === user.id || (t.visibility === 'selected' && t.shared_with.includes(email))), 404, 'This template is not available to your account.');
    const v = Number(version || t.latest_version);
    check(Number.isInteger(v) && v >= 1 && v <= t.latest_version, 400, 'Choose a valid template version.');
    const [row] = await supabase(`/rest/v1/rigo_template_versions?select=content,version&template_id=eq.${id}&version=eq.${v}`);
    check(row, 404, 'This template version is not available.');
    return { template: t, version: v, ops: row.content };
  }
  async function templates(req, user, body) {
    const email = normalizeEmail(user.email);
    const view = t => ({ id: t.id, name: t.name, description: t.description, version: t.latest_version, mine: t.owner_id === user.id,
      ...(t.owner_id === user.id ? { visibility: t.visibility, sharedWith: t.shared_with } : {}) });
    if (req.method === 'GET') {
      if (req.query?.id) {
        const { template, version, ops } = await templateFor(user, req.query.id, req.query.version);
        return { ...view(template), version, preview: previewOps(ops) };
      }
      const [mine, shared] = await Promise.all([
        supabase(`/rest/v1/rigo_templates?select=*&owner_id=eq.${user.id}&order=name.asc`),
        supabase(`/rest/v1/rigo_templates?select=*&visibility=eq.selected&shared_with=cs.${encodeURIComponent('{' + JSON.stringify(email) + '}')}&order=name.asc`)
      ]);
      return { templates: [...mine, ...shared.filter(t => t.owner_id !== user.id)].map(view) };
    }
    check(req.method === 'POST', 405, 'Method not allowed.');
    if (body.op === 'publish') {
      const { row, role } = await access(user, body.workspace);
      check(role === 'Owner', 403, 'Only owners publish templates from a company.');
      const name = String(body.name || '').trim();
      check(name && name.length <= 80, 400, 'Name the template (up to 80 characters).');
      check(body.templateId === undefined || isId(body.templateId), 400, 'Choose a template.');
      // The content is generated here from the company's setup; the client cannot supply it.
      const ops = structureOps(row.state);
      check(ops.length, 400, 'This company has no setup to share yet.');
      return rpc('rigo_publish_template', { p_user: user.id, p_template: body.templateId || null, p_name: name, p_description: String(body.description || '').slice(0, 300), p_content: ops, p_source: row.id });
    }
    if (body.op === 'share') {
      check(isId(body.templateId), 400, 'Choose a template.');
      check(['private', 'selected'].includes(body.visibility), 400, 'Choose who can use the template.');
      const emails = [...new Set((body.sharedWith || []).map(normalizeEmail).filter(Boolean))];
      check(emails.length <= 50 && emails.every(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)), 400, 'Enter up to 50 valid emails.');
      const updated = await supabase(`/rest/v1/rigo_templates?id=eq.${body.templateId}&owner_id=eq.${user.id}`, { method: 'PATCH', body: { visibility: body.visibility, shared_with: body.visibility === 'selected' ? emails : [] } });
      check(updated.length === 1, 404, 'This template is not available to your account.');
      return view(updated[0]);
    }
    if (body.op === 'apply') {
      const { template, version, ops } = await templateFor(user, body.templateId, body.version);
      const { row, role } = await access(user, body.workspace);
      check(['Owner', 'Administrator'].includes(role), 403, 'Owners and administrators review setup changes.');
      // Applying a template creates a reviewed proposal; nothing changes until someone applies it.
      let state;
      await update(row.id, latest => {
        state = domain.applyAction(latest.state, { type: 'proposeConfig', ops, source: 'template', summary: template.name + ' v' + version,
          template: { id: template.id, version, name: template.name }, actor: normalizeEmail(user.email) }, role);
        return { state, audit: [auditEntry(user.email, 'templateProposed', { template: template.id, version }), ...latest.audit].slice(0, 100) };
      });
      return { proposal: state.configProposals[0].id };
    }
    check(false, 400, 'Choose a template action.');
  }
  // ---- Milestone F: consolidated owner view and explicit sharing between companies ----
  const SHARE_LISTS = ['clients', 'locations', 'services', 'employees', 'vehicles', 'equipment'];
  // Each company is summarised on its own; money is never added up across companies.
  async function overview(user) {
    const memberships = (await supabase(`/rest/v1/rigo_memberships?select=workspace_id,role&user_id=eq.${user.id}&status=eq.active`))
      .filter(m => ['Owner', 'Administrator'].includes(m.role));
    if (!memberships.length) return { companies: [] };
    const rows = await supabase(`/rest/v1/rigo_workspaces?select=id,state&id=in.(${memberships.map(m => m.workspace_id).join(',')})`);
    const day = new Date(now()).toISOString().slice(0, 10);
    const companies = rows.map(r => {
      const s = r.state, jobs = (s.jobs || []).filter(j => !j.archived);
      const invoiced = (s.invoices || []).reduce((a, i) => a + i.total, 0), collected = (s.invoices || []).reduce((a, i) => a + i.paid, 0);
      return { id: r.id, name: s.name, role: memberships.find(m => m.workspace_id === r.id).role,
        today: jobs.filter(j => j.date === day).length,
        attention: jobs.filter(j => !j.completedAt && j.date <= day && !j.employeeId).length + jobs.reduce((a, j) => a + (j.issues || []).filter(i => i.status === 'open').length, 0)
          + (s.approvals || []).filter(a => a.status === 'pending').length,
        unpriced: jobs.filter(j => j.completedAt && !(j.quantity * j.rate > 0) && !(s.invoices || []).some(i => i.jobId === j.id)).length,
        money: { invoiced: Math.round(invoiced * 100) / 100, collected: Math.round(collected * 100) / 100, outstanding: Math.round((invoiced - collected) * 100) / 100 } };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return { companies };
  }
  async function shares(req, user, body) {
    const roleOf = ws => roleIn(user, ws);
    const names = async ids => Object.fromEntries((ids.length ? await supabase(`/rest/v1/rigo_workspaces?select=id,name:state->>name&id=in.(${[...new Set(ids)].join(',')})`) : []).map(r => [r.id, r.name]));
    if (req.method === 'GET') {
      const ws = req.query?.workspace;
      check(isId(ws), 400, 'Choose a company first.');
      const role = await roleOf(ws);
      check(['Owner', 'Administrator'].includes(role), 403, 'Only owners and administrators see sharing agreements.');
      const list = [...await supabase(`/rest/v1/rigo_shares?select=*&from_workspace=eq.${ws}&order=created_at.desc`), ...await supabase(`/rest/v1/rigo_shares?select=*&to_workspace=eq.${ws}&order=created_at.desc`)];
      const n = await names(list.flatMap(x => [x.from_workspace, x.to_workspace]));
      const mine = (await supabase(`/rest/v1/rigo_memberships?select=workspace_id,role&user_id=eq.${user.id}&status=eq.active`)).filter(m => ['Owner', 'Administrator'].includes(m.role) && m.workspace_id !== ws);
      const targets = await names(mine.map(m => m.workspace_id));
      return { shares: list.map(x => ({ id: x.id, direction: x.from_workspace === ws ? 'out' : 'in', other: n[x.from_workspace === ws ? x.to_workspace : x.from_workspace] || 'Company', lists: x.lists, status: x.status, createdAt: x.created_at })),
        targets: mine.map(m => ({ id: m.workspace_id, name: targets[m.workspace_id] || 'Company' })) };
    }
    check(req.method === 'POST', 405, 'Method not allowed.');
    if (body.op === 'propose') {
      check(isId(body.from) && isId(body.to) && body.from !== body.to, 400, 'Choose two different companies.');
      const lists = [...new Set(body.lists || [])];
      check(lists.length && lists.every(l => SHARE_LISTS.includes(l)), 400, 'Choose what to share. Invoices and payments are never shared.');
      const id = await rpc('rigo_share_propose', { p_actor: user.id, p_from: body.from, p_to: body.to, p_lists: lists });
      return { id, status: 'pending' };
    }
    if (['accept', 'decline', 'revoke'].includes(body.op)) {
      check(isId(body.id), 400, 'Choose a sharing agreement.');
      return { status: await rpc('rigo_share_decide', { p_actor: user.id, p_share: body.id, p_decision: body.op }) };
    }
    if (body.op === 'copy') {
      // Copies chosen shared records into the receiving company as its own new records.
      const { row, role } = await access(user, body.workspace);
      check(['Owner', 'Administrator', 'Dispatcher'].includes(role), 403, 'Your role cannot add records.');
      const [share] = await supabase(`/rest/v1/rigo_shares?select=*&id=eq.${body.shareId}&to_workspace=eq.${row.id}&status=eq.active`);
      check(isId(body.shareId) && share && share.lists.includes(body.listId), 404, 'This shared list is not available.');
      const source = await loadWorkspace(share.from_workspace);
      const wanted = new Set(body.rowIds || []);
      check(wanted.size && wanted.size <= 200, 400, 'Choose up to 200 records.');
      const sourceList = source.state.lists.find(l => l.id === body.listId);
      const picked = (sourceList?.rows || []).filter(r => wanted.has(r.id) && !r.archived);
      let added = 0, skipped = 0;
      await update(row.id, latest => {
        let state = latest.state;
        const target = state.lists.find(l => l.id === body.listId);
        for (const r of picked) {
          // Only fields the receiving list also has; references to the other company are dropped.
          const values = {};
          for (const f of target.fields) {
            const sf = sourceList.fields.find(x => x.id === f.id || x.name === f.name);
            if (!sf || f.type === 'reference' || sf.type === 'reference') continue;
            if (r.values[sf.id] !== undefined && r.values[sf.id] !== '') values[f.id] = r.values[sf.id];
          }
          if (target.rows.some(x => !x.archived && (x.values.code === values.code || String(x.values.name).toLowerCase() === String(values.name).toLowerCase()))) { skipped++; continue; }
          state = domain.applyAction(state, { type: 'record', listId: body.listId, values, actor: normalizeEmail(user.email) }, role);
          added++;
        }
        if (!added) return null;
        return { state, audit: [auditEntry(user.email, 'sharedRecordsCopied', { share: share.id, listId: body.listId, added }), ...latest.audit].slice(0, 100) };
      });
      return { added, skipped };
    }
    check(false, 400, 'Choose a sharing action.');
  }
  // Shared records, read-only, for a company that received an active share.
  async function sharedRecords(user, ws) {
    check(isId(ws), 400, 'Choose a company first.');
    const role = await roleIn(user, ws);
    check(role && role !== 'Field employee', 403, 'You do not have access to this company.');
    const active = await supabase(`/rest/v1/rigo_shares?select=*&to_workspace=eq.${ws}&status=eq.active`);
    const out = [];
    for (const share of active) {
      const source = await loadWorkspace(share.from_workspace);
      if (!source) continue;
      out.push({ shareId: share.id, from: source.state.name, lists: share.lists.map(id => {
        const list = source.state.lists.find(l => l.id === id);
        const fields = (list?.fields || []).filter(f => f.type !== 'reference');
        return { id, name: list?.name || id, fields: fields.map(f => ({ id: f.id, name: f.name })),
          rows: (list?.rows || []).filter(r => !r.archived).map(r => ({ id: r.id, values: Object.fromEntries(fields.map(f => [f.id, r.values[f.id] ?? ''])) })) };
      }) });
    }
    return { shared: out };
  }

  async function listCompanies(user) {
    const memberships = await supabase(`/rest/v1/rigo_memberships?select=workspace_id,role&user_id=eq.${user.id}&status=eq.active`);
    const invites = (await supabase(`/rest/v1/rigo_invitations?select=id,workspace_id,role,expires_at&email=eq.${encodeURIComponent(normalizeEmail(user.email))}&status=eq.pending`))
      .filter(i => Date.parse(i.expires_at) > now());
    const ids = [...new Set([...memberships.map(m => m.workspace_id), ...invites.map(i => i.workspace_id)])];
    const names = ids.length ? await supabase(`/rest/v1/rigo_workspaces?select=id,name:state->>name&id=in.(${ids.join(',')})`) : [];
    const nameOf = id => names.find(n => n.id === id)?.name || 'Company';
    return {
      user: normalizeEmail(user.email),
      userId: user.id,
      workspaces: memberships.map(m => ({ id: m.workspace_id, name: nameOf(m.workspace_id), role: m.role }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      invitations: invites.map(i => ({ id: i.id, company: nameOf(i.workspace_id), role: i.role, expiresAt: i.expires_at }))
    };
  }

  async function run(req) {
    const route = req.query?.route || 'config';
    if (route === 'config') return { configured: config.configured, ...(config.configured ? { url: config.url, key: config.key, geocoding: Boolean(config.mapboxToken) } : {}) };
    check(config.configured, 503, 'Employee access needs Supabase configured. Your existing browser data is unchanged.');
    const user = await authenticate(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const write = req.method === 'POST';
    check(req.method === 'GET' || write, 405, 'Method not allowed.');

    if (route === 'companies') {
      check(write, 405, 'Method not allowed.');
      const name = String(body.name || '').trim();
      check(name && name.length <= 120, 400, 'Enter a company name (up to 120 characters).');
      check(typeof body.requestId === 'string' && body.requestId.length >= 8 && body.requestId.length <= 100, 400, 'Retry creating the company.');
      check(body.template === undefined || Object.hasOwn(domain.templates, body.template), 400, 'Choose a valid starting structure.');
      let state = blankCompanyState(name, body.template);
      if (body.templateId !== undefined) {
        const { template, version, ops } = await templateFor(user, body.templateId, body.templateVersion);
        state = domain.applyAction(state, { type: 'proposeConfig', ops, source: 'template', summary: template.name + ' v' + version, template: { id: template.id, version, name: template.name }, actor: normalizeEmail(user.email) }, 'Owner');
        state = domain.applyAction(state, { type: 'decideConfig', id: state.configProposals[0].id, decision: 'apply', actor: normalizeEmail(user.email) }, 'Owner');
      }
      const id = await rpc('rigo_create_company', { p_user: user.id, p_email: normalizeEmail(user.email), p_request: body.requestId, p_name: name, p_state: state });
      await syncMembers(id);
      return { id };
    }
    if (route === 'invitations') {
      check(write, 405, 'Method not allowed.');
      check(isId(body.id) && ['accept', 'decline'].includes(body.op), 400, 'Choose an invitation.');
      const status = await rpc('rigo_answer_invitation', { p_invitation: body.id, p_user: user.id, p_email: normalizeEmail(user.email), p_accept: body.op === 'accept' });
      const [invitation] = await supabase(`/rest/v1/rigo_invitations?select=workspace_id&id=eq.${body.id}`);
      if (['accepted', 'declined', 'already_member'].includes(status) && invitation) await syncMembers(invitation.workspace_id);
      return { status, ...(['accepted', 'already_member'].includes(status) && invitation ? { workspace: invitation.workspace_id } : {}) };
    }
    if (route === 'leave') {
      check(write, 405, 'Method not allowed.');
      await access(user, body.workspace);
      await rpc('rigo_change_member', { p_workspace: body.workspace, p_actor: user.id, p_target: user.id, p_role: null, p_remove: true });
      await syncMembers(body.workspace, auditEntry(user.email, 'memberLeft', { email: normalizeEmail(user.email) }));
      return { ok: true };
    }
    if (route === 'photos') {
      check(write, 405, 'Method not allowed.');
      const { row, role } = await access(user, body.workspace);
      check(role !== 'Viewer', 403, 'Your role has read-only access.');
      const job = visibleState(row.state, role, user.email).jobs.find(j => j.id === body.job);
      check(job && !job.archived && !job.completedAt, 403, 'You cannot attach a photo to this job.');
      check(typeof body.data === 'string' && body.data.length <= 1000000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.data), 400, 'Use a JPEG, PNG, or WebP photo smaller than 700 KB.');
      return { url: body.data };
    }
    if (route === 'requests') return accessRequests(req, user, body);
    if (route === 'overview') return overview(user);
    if (route === 'shares') return req.query?.records ? sharedRecords(user, req.query.workspace) : shares(req, user, body);
    // Sending needs an email/SMS provider chosen by the platform owner; none is connected, so
    // nothing leaves Rigo and prepared messages stay in each company's outbox.
    if (route === 'messages') {
      check(write, 405, 'Method not allowed.');
      const { role } = await access(user, body.workspace);
      check(['Owner', 'Administrator', 'Dispatcher'].includes(role), 403, 'Your role cannot send customer messages.');
      check(false, 503, 'No email or SMS provider is connected yet. Messages stay in the outbox and nothing was sent.');
    }
    // The built-in setup assistant needs an AI provider and budget chosen by the platform owner.
    if (route === 'assistant') {
      check(write, 405, 'Method not allowed.');
      await access(user, body.workspace);
      check(false, 503, "Rigo's built-in assistant is not set up yet. No AI service was called.");
    }
    // Templates: structure only, private or shared with selected people, versioned.
    if (route === 'templates') return templates(req, user, body);
    // Paid services are switched per company by an owner, and only when the platform offers them.
    if (route === 'integrations') {
      const workspaceId = write ? body.workspace : req.query?.workspace;
      const { row, role } = await access(user, workspaceId);
      const status = state => ({ geocoding: { available: Boolean(config.mapboxToken), enabled: state.integrations?.geocoding !== false } });
      if (!write) return status(row.state);
      check(role === 'Owner', 403, 'Only owners can turn paid services on or off.');
      check(typeof body.geocoding === 'boolean', 400, 'Choose on or off.');
      check(!body.geocoding || config.mapboxToken, 409, 'Address lookup is not available on this platform yet.');
      let latest;
      await update(row.id, current => {
        latest = current.state;
        if ((current.state.integrations?.geocoding !== false) === body.geocoding) return null;
        latest = { ...current.state, integrations: { ...current.state.integrations, geocoding: body.geocoding } };
        return { state: latest, audit: [auditEntry(user.email, 'integrationChanged', { geocoding: body.geocoding }), ...current.audit].slice(0, 100) };
      });
      return status(latest);
    }
    if (route === 'geocode') {
      check(write, 405, 'Method not allowed.');
      const { row, role } = await access(user, body.workspace);
      check(role !== 'Viewer', 403, 'Your role cannot look up addresses.');
      // Paid lookups need the platform token and the company's own opt-in. New companies start off.
      check(config.mapboxToken && row.state.integrations?.geocoding !== false, 503, "Address lookup isn't set up for this company. Enter the coordinates instead.");
      const address = String(body.address || '').trim();
      check(address && address.length <= 300, 400, 'Enter an address to look up.');
      const response = await fetchImpl('https://api.mapbox.com/geocoding/v5/mapbox.places/' + encodeURIComponent(address) + '.json?limit=1&access_token=' + encodeURIComponent(config.mapboxToken));
      const data = await response.json().catch(() => null);
      const center = response.ok && data?.features?.[0]?.center;
      check(Array.isArray(center), 404, 'No coordinates were found for that address. Check it or enter them yourself.');
      return { lat: center[1], lng: center[0], label: data.features[0].place_name };
    }
    check(route === 'workspaces', 404, 'Unknown request.');
    if (!write && !req.query?.id) return listCompanies(user);
    const id = write ? body.id : req.query.id;
    let { row, role } = await access(user, id);
    if (!write) {
      return { state: visibleState(row.state, role, user.email), version: row.version, user: normalizeEmail(user.email), role,
        audit: ['Owner', 'Administrator'].includes(role) ? row.audit : [] };
    }
    const action = body.action;
    check(action && typeof action.type === 'string', 400, 'Choose a valid action.');
    check(typeof body.requestId === 'string' && body.requestId.length <= 100, 400, 'A save request ID is required.');
    const receipt = row.receipts?.[body.requestId];
    if (receipt) {
      check(receipt === JSON.stringify(action), 400, 'Save request does not match the original action.');
      return { ok: true };
    }
    const projected = visibleState(row.state, role, user.email);
    check(typeof body.expected === 'string' ? domain.expected(projected, action) === body.expected : body.version === row.version,
      409, 'Someone else changed this workspace. Refresh before saving.');
    check(role !== 'Viewer', 403, 'Your role has read-only access.');
    if (action.type === 'member') return manageMember(row, role, user, action, body);
    if (role === 'Field employee') {
      const employee = domain.employeeFor(row.state, user.email);
      const job = row.state.jobs.find(j => j.id === action.id);
      check(employee && job && job.employeeId === employee.id, 403, 'You can only update your own assigned jobs.');
    }
    // The client cannot choose its role or audit actor. Business rules also check
    // field employees against their own linked assignments.
    let state;
    try { state = domain.applyAction(row.state, { ...action, actor: normalizeEmail(user.email) }, role); }
    catch (error) { throw new HttpError(400, error.message); }
    state.members = structuredClone(row.state.members);
    const audit = [auditEntry(user.email, action.type, action), ...row.audit].slice(0, 100);
    const receipts = { ...row.receipts, [body.requestId]: JSON.stringify(action) };
    // Retain the latest 200 request receipts for retry protection.
    const recent = Object.fromEntries(Object.entries(receipts).slice(-200));
    await save(row, { state, audit, receipts: recent });
    return { ok: true };
  }
  return { run, config };
}
module.exports = { createServer, HttpError, visibleState, settings, blankCompanyState };
