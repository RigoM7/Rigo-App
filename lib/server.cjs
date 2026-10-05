const { randomUUID } = require('node:crypto');
const domain = require('./domain.cjs');
const roles = ['Administrator', 'Dispatcher', 'Field employee', 'Viewer'];
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function check(ok, status, message) { if (!ok) throw new HttpError(status, message); }
function settings(env = process.env) {
  const url = env.SUPABASE_URL?.replace(/\/$/, '');
  const key = env.SUPABASE_ANON_KEY;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  const owner = env.RIGO_OWNER_USER_ID;
  const appUrl = env.RIGO_APP_URL?.replace(/\/$/, '');
  const configured = Boolean(url && key && service && owner && appUrl);
  if (configured) {
    check(/^https:\/\//.test(url) && /^https:\/\//.test(appUrl), 503, 'Use HTTPS Supabase and app URLs.');
    check(/^[0-9a-f-]{36}$/i.test(owner), 503, 'Configure the owner Supabase user ID.');
  }
  return { url, key, service, owner, appUrl, configured };
}
const normalizeEmail = value => String(value || '').trim().toLowerCase();
function membership(row, user) {
  if (row.owner_id === user.id) return { role: 'Owner' };
  // Only server-created invitations grant access. Old browser memberships do not.
  return row.state.members.find(m => m.email === normalizeEmail(user.email) &&
    m.invitation && ['sent', 'active'].includes(m.invitation.status) &&
    (!m.invitation.userId || m.invitation.userId === user.id));
}
function visibleState(state, role, email) {
  const out = structuredClone(state);
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
    equipment: new Set(out.jobs.map(j => j.equipmentId)),
    vehicles: new Set(out.jobs.map(j => j.vehicleId)),
    jobs: new Set(out.jobs.map(j => j.id))
  };
  out.lists = out.lists.map(l => ({ ...l, rows: l.rows.filter(r => ids[l.id]?.has(r.id)) }));
  for (const key of ['invoices', 'imports', 'views', 'notifications', 'inquiries', 'stockMoves']) out[key] = [];
  return out;
}
function createServer({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const config = settings(env);
  async function supabase(path, { method = 'GET', body, admin = true, token } = {}) {
    const key = admin ? config.service : config.key;
    const response = await fetchImpl(config.url + path, {
      method,
      headers: { apikey: key, Authorization: `Bearer ${token || key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      // Do not send database internals or credentials to the client.
      const error = new HttpError(response.status >= 500 ? 502 : 400, path.startsWith('/auth/') ?
        (data?.msg || data?.message || data?.error_description || 'Authentication request failed.') :
        'Shared storage request failed. Check the Supabase setup.');
      error.code = data?.error_code || data?.code;
      throw error;
    }
    return data;
  }
  async function authenticate(req) {
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    check(match, 401, 'Sign in to Rigo to continue.');
    let user;
    try { user = await supabase('/auth/v1/user', { admin: false, token: match[1] }); }
    catch { throw new HttpError(401, 'Your session expired. Sign in again.'); }
    check(user?.id && user.email && user.email_confirmed_at, 403, 'Verify your email before accessing Rigo.');
    return user;
  }
  async function getRows(user, id) {
    if (id) check(/^[0-9a-f-]{36}$/i.test(id), 400, 'Invalid workspace.');
    const query = `owner_id=eq.${config.owner}` + (id ? `&id=eq.${id}` : '');
    const rows = await supabase('/rest/v1/rigo_workspaces?select=*&' + query);
    return rows.filter(row => membership(row, user));
  }
  async function save(row, next) {
    const rows = await supabase(`/rest/v1/rigo_workspaces?id=eq.${row.id}&version=eq.${row.version}`, {
      method: 'PATCH', body: { ...next, version: row.version + 1 }
    });
    check(rows?.length === 1, 409, 'Someone else changed this workspace. Refresh and try again.');
    return rows[0];
  }
  async function invite(row, action, user, body) {
    check(row.owner_id === user.id, 403, 'Only the owner can invite employees or change access.');
    const email = normalizeEmail(action.email);
    check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254, 400, 'Enter a valid employee email.');
    check(roles.includes(action.role), 400, 'Choose a valid role.');
    check(email !== normalizeEmail(user.email), 400, 'The owner already has access.');
    const previous = row.state.members.find(m => m.email === email);
    check(!previous?.invitation || now() - Date.parse(previous.invitation.at) >= 60000, 429, 'Wait a minute before sending another invitation.');
    const state = domain.applyAction(row.state, { ...action, actor: user.email }, 'Owner');
    const member = state.members.find(m => m.email === email);
    const invitationId = randomUUID();
    member.invitation = { id: invitationId, status: 'sending', at: new Date(now()).toISOString() };
    row = await save(row, { state });
    let userId;
    try {
      const redirect = `${config.appUrl}/?invite=1`;
      try {
        const invited = await supabase('/auth/v1/invite?redirect_to=' + encodeURIComponent(redirect), {
          method: 'POST', body: { email }
        });
        userId = invited?.id;
      } catch (error) {
        if (!['email_exists', 'user_already_exists'].includes(error.code)) throw error;
        // An existing account gets a login link instead of a second account.
        await supabase('/auth/v1/otp?redirect_to=' + encodeURIComponent(redirect), {
          method: 'POST', admin: false, body: { email, create_user: false }
        });
        // Preserve the established identity when re-inviting an active member.
        userId = previous?.invitation?.userId;
      }
    } catch {
      await finishInvitation(row.id, email, invitationId, 'failed').catch(() => {});
      throw new HttpError(502, 'Invitation email could not be sent. Check Supabase email delivery, then retry. Access was not granted.');
    }
    // Refetch and update only our invitation: never restore a membership removed concurrently.
    const result = await finishInvitation(row.id, email, invitationId, 'sent', userId, body.requestId, action, user);
    check(result, 409, 'Access changed while the invitation was sending. Review the employee membership.');
    return { ok: true, invitationSent: true };
  }
  async function finishInvitation(id, email, invitationId, status, userId, requestId, action, user) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const [latest] = await supabase(`/rest/v1/rigo_workspaces?id=eq.${id}&select=*`);
      const state = structuredClone(latest.state);
      const member = state.members.find(m => m.email === email && m.invitation?.id === invitationId);
      if (!member) return false;
      member.invitation.status = status;
      if (userId) member.invitation.userId = userId;
      const next = { state };
      if (requestId && status === 'sent') {
        next.receipts = { ...latest.receipts, [requestId]: JSON.stringify(action) };
        next.audit = [{ id: randomUUID(), actor: user.email, action: 'employeeInvited', detail: JSON.stringify({ email, role: member.role }), at: new Date(now()).toISOString() }, ...latest.audit].slice(0, 100);
      }
      try { await save(latest, next); return true; }
      catch (error) { if (error.status !== 409 || attempt === 2) throw error; }
    }
  }
  // Re-read and retry on version conflicts so concurrent saves are never lost.
  async function update(id, change) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const [latest] = await supabase(`/rest/v1/rigo_workspaces?id=eq.${id}&select=*`);
      const next = change(latest);
      if (!next) return latest;
      try { return await save(latest, next); }
      catch (error) { if (error.status !== 409 || attempt === 2) throw error; }
    }
  }
  async function accessRequests(req, user, body) {
    const rows = await supabase(`/rest/v1/rigo_workspaces?select=*&owner_id=eq.${config.owner}`);
    check(rows.length, 404, 'The owner has not set up the shared workspace yet. Try again later.');
    const row = rows[0];
    const email = normalizeEmail(user.email);
    const isOwner = row.owner_id === user.id;
    const list = state => (state.accessRequests || []).filter(r => r.status === 'pending');
    if (req.method === 'GET') {
      if (isOwner) return { requests: list(row.state), signupUrl: config.appUrl + '/?signup=1' };
      if (membership(row, user)) return { status: 'approved' };
      const own = (row.state.accessRequests || []).find(r => r.userId === user.id);
      return { status: own?.status === 'approved' ? 'removed' : own?.status || 'none' };
    }
    check(req.method === 'POST', 405, 'Method not allowed.');
    const op = body.op;
    if (op === 'request') {
      check(!isOwner, 400, 'The owner already has access.');
      if (membership(row, user)) return { status: 'approved' };
      const name = String(body.name || '').trim().slice(0, 80);
      let status;
      await update(row.id, latest => {
        const state = structuredClone(latest.state);
        state.accessRequests ||= [];
        const existing = state.accessRequests.find(r => r.userId === user.id);
        // A declined request stays declined until the owner adds the employee.
        // A removed employee must be re-invited by the owner rather than re-requesting.
        if (existing) { status = existing.status === 'approved' ? 'removed' : existing.status; return null; }
        check(list(state).length < 200, 429, 'Too many pending access requests. Ask the owner to review them.');
        state.accessRequests.push({ id: randomUUID(), userId: user.id, email, name, status: 'pending', at: new Date(now()).toISOString() });
        status = 'pending';
        return { state };
      });
      return { status };
    }
    check(isOwner, 403, 'Only the owner can approve access requests.');
    check(typeof body.requestId === 'string', 400, 'Choose an access request.');
    check(['approve', 'decline'].includes(op), 400, 'Choose approve or decline.');
    if (op === 'approve') check(roles.includes(body.role), 400, 'Choose a valid role.');
    await update(row.id, latest => {
      const state = structuredClone(latest.state);
      const request = (state.accessRequests || []).find(r => r.id === body.requestId && r.status === 'pending');
      check(request, 404, 'This request was already handled. Refresh to see the latest list.');
      request.status = op === 'approve' ? 'approved' : 'declined';
      request.decidedAt = new Date(now()).toISOString();
      if (op === 'approve') {
        // The account already exists and its email is verified, so access is
        // granted directly to that exact user ID without sending an email.
        state.members = state.members.filter(m => m.email !== request.email);
        state.members.push({ email: request.email, role: body.role,
          invitation: { id: randomUUID(), status: 'active', userId: request.userId, at: request.decidedAt, via: 'request' } });
      }
      const audit = [{ id: randomUUID(), actor: email, action: op === 'approve' ? 'accessApproved' : 'accessDeclined',
        detail: JSON.stringify({ email: request.email, role: body.role }), at: request.decidedAt }, ...latest.audit].slice(0, 100);
      return { state, audit };
    });
    return { ok: true };
  }
  async function run(req) {
    const route = req.query?.route || 'config';
    if (route === 'config') return { configured: config.configured, ...(config.configured ? { url: config.url, key: config.key } : {}) };
    check(config.configured, 503, 'Employee access needs Supabase configured. Your existing browser data is unchanged.');
    const user = await authenticate(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const write = req.method === 'POST';
    check(req.method === 'GET' || write, 405, 'Method not allowed.');
    if (route === 'bootstrap') {
      check(write && user.id === config.owner, 403, 'Only the configured owner can set up shared data.');
      const existing = await getRows(user);
      if (existing.length) return { id: existing[0].id };
      const state = body.state ? structuredClone(body.state) : domain.createState('Rigo');
      check(Array.isArray(state.lists) && Array.isArray(state.jobs) && state.workflow, 400, 'Choose a valid Rigo backup.');
      const id = randomUUID();
      state.id = id;
      state.members = [];
      state.accessRequests = [];
      delete state.resetBackup;
      domain.normalize(state);
      const [row] = await supabase('/rest/v1/rigo_workspaces', { method: 'POST', body: { id, owner_id: user.id, state, version: 1, audit: [], receipts: {} } });
      return { id: row.id };
    }
    if (route === 'photos') {
      check(write, 405, 'Method not allowed.');
      const [workspace] = await getRows(user, body.workspace);
      check(workspace, 403, 'You do not have access to this workspace.');
      const role = membership(workspace, user).role;
      check(!['Viewer'].includes(role), 403, 'Your role has read-only access.');
      const job = visibleState(workspace.state, role, user.email).jobs.find(j => j.id === body.job);
      check(job && !job.archived && !job.completedAt, 403, 'You cannot attach a photo to this job.');
      check(typeof body.data === 'string' && body.data.length <= 1000000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.data), 400, 'Use a JPEG, PNG, or WebP photo smaller than 700 KB.');
      return { url: body.data };
    }
    if (route === 'requests') return accessRequests(req, user, body);
    check(route === 'workspaces', 404, 'Unknown request.');
    const id = write ? body.id : req.query?.id;
    if (id) check(/^[0-9a-f-]{36}$/i.test(id), 400, 'Invalid workspace.');
    const rows = await getRows(user, id);
    if (!id && !write) return {
      user: normalizeEmail(user.email), owner: user.id === config.owner,
      workspaces: rows.map(row => ({ id: row.id, name: row.state.name, role: membership(row, user).role }))
    };
    let row = rows[0];
    check(row, 403, 'You do not have access to this workspace. Ask the owner for an invitation.');
    const member = membership(row, user);
    if (!write) {
      if (member.invitation?.status === 'sent') {
        const state = structuredClone(row.state);
        const own = state.members.find(m => m.email === normalizeEmail(user.email));
        own.invitation = { ...own.invitation, status: 'active', userId: user.id };
        row = await save(row, { state });
      }
      return { state: visibleState(row.state, member.role, user.email), version: row.version, user: normalizeEmail(user.email), role: member.role,
        audit: ['Owner', 'Administrator'].includes(member.role) ? row.audit : [] };
    }
    const action = body.action;
    check(action && typeof action.type === 'string', 400, 'Choose a valid action.');
    check(typeof body.requestId === 'string' && body.requestId.length <= 100, 400, 'A save request ID is required.');
    const receipt = row.receipts?.[body.requestId];
    if (receipt) {
      check(receipt === JSON.stringify(action), 400, 'Save request does not match the original action.');
      return { ok: true };
    }
    const projected = visibleState(row.state, member.role, user.email);
    check(typeof body.expected === 'string' ? domain.expected(projected, action) === body.expected : body.version === row.version,
      409, 'Someone else changed this workspace. Refresh before saving.');
    check(member.role !== 'Viewer', 403, 'Your role has read-only access.');
    if (action.type === 'member') {
      check(member.role === 'Owner', 403, 'Only the owner can invite employees or change access.');
      if (!action.remove) return invite(row, action, user, body);
    }
    if (member.role === 'Field employee') {
      const employee = domain.employeeFor(row.state, user.email);
      const job = row.state.jobs.find(j => j.id === action.id);
      check(employee && job && job.employeeId === employee.id, 403, 'You can only update your own assigned jobs.');
    }
    // The client cannot choose its role or audit actor. Business rules also check
    // field employees against their own linked assignments.
    let state;
    try { state = domain.applyAction(row.state, { ...action, actor: normalizeEmail(user.email) }, member.role); }
    catch (error) { throw new HttpError(400, error.message); }
    if (action.type !== 'member') state.members = structuredClone(row.state.members);
    const audit = [{ id: randomUUID(), actor: normalizeEmail(user.email), action: action.type, detail: JSON.stringify(action), at: new Date(now()).toISOString() }, ...row.audit].slice(0, 100);
    const receipts = { ...row.receipts, [body.requestId]: JSON.stringify(action) };
    // Retain the latest 200 request receipts for retry protection.
    const recent = Object.fromEntries(Object.entries(receipts).slice(-200));
    await save(row, { state, audit, receipts: recent });
    return { ok: true };
  }
  return { run, config };
}
module.exports = { createServer, HttpError, membership, visibleState, settings };
