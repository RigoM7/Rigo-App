/* Authentication and server transport for the existing Rigo app. */
(() => {
  const sessionKey = 'rigo-auth-session-v1';
  let config, session, refreshPromise;
  const root = () => document.getElementById('root');
  const readSession = () => { try { return JSON.parse(localStorage.getItem(sessionKey)); } catch { return null; } };
  function saveSession(value) {
    session = { access_token: value.access_token, refresh_token: value.refresh_token,
      expires_at: value.expires_at || Date.now() / 1000 + value.expires_in };
    localStorage.setItem(sessionKey, JSON.stringify(session));
  }
  async function auth(path, body, method = 'POST', token) {
    const response = await fetch(config.url + '/auth/v1/' + path, {
      method, headers: { apikey: config.key, Authorization: 'Bearer ' + (token || config.key), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.msg || data.message || data.error_description || 'Sign-in could not be completed.');
    return data;
  }
  async function accessToken() {
    session = readSession();
    if (!session) throw new Error('Sign in to Rigo to continue.');
    if (session.expires_at < Date.now() / 1000 + 60) {
      if (!refreshPromise) refreshPromise = auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
        .then(saveSession).finally(() => { refreshPromise = null; });
      await refreshPromise;
    }
    return session.access_token;
  }
  async function request(url, options = {}) {
    if (!config?.configured) throw new Error('Invitations need Supabase connected and email delivery configured.');
    const original = new URL(url, location.origin);
    const route = original.pathname.split('/').pop();
    const query = new URLSearchParams(original.search);
    query.set('route', route);
    const headers = { ...options.headers, Authorization: 'Bearer ' + await accessToken() };
    let body = options.body;
    if (route === 'photos') {
      const file = body.get('file');
      if (!file || file.size > 700000) throw new Error('Use a photo smaller than 700 KB.');
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read photo.')); reader.readAsDataURL(file);
      });
      body = JSON.stringify({ workspace: body.get('workspace'), job: body.get('job'), data });
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch('/api/rigo?' + query, { ...options, body, headers });
    if (response.status === 401) {
      localStorage.removeItem(sessionKey);
      location.reload();
    }
    return response;
  }
  function screen(title, text, content) {
    root().innerHTML = `<main class="rigo-auth"><section class="panel"><h1>${title}</h1><p>${text}</p>${content}<p id="auth-message" role="status" aria-live="polite"></p></section></main>`;
  }
  function message(value, error = false) {
    const target = document.getElementById('auth-message');
    target.textContent = value;
    target.className = error ? 'error-text' : 'success-text';
  }
  function busy(form, value) { form.querySelectorAll('button,input').forEach(el => { el.disabled = value; }); }
  function login(mount) {
    screen('Sign in to Rigo', 'New employee? Create an account, and the owner will approve your access.',
      '<form id="login-form"><label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" required></label><label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Sign in</button><button class="outline" type="button" id="create-account">Create an account</button><button class="text-button" type="button" id="reset-password">Send password reset link</button></form>');
    const form = document.getElementById('login-form');
    document.getElementById('create-account').onclick = () => signup(mount);
    form.onsubmit = async event => {
      event.preventDefault(); const data = new FormData(form); busy(form, true); message('Signing in…');
      try {
        saveSession(await auth('token?grant_type=password', { email: String(data.get('email')).trim(), password: data.get('password') }));
        await enter(mount);
      } catch (error) { message(error.message, true); busy(form, false); }
    };
    document.getElementById('reset-password').onclick = async () => {
      const email = form.elements.email.value.trim();
      if (!form.elements.email.reportValidity() || !email) return;
      busy(form, true);
      try {
        await auth('recover?redirect_to=' + encodeURIComponent(location.origin + '/?invite=1'), { email });
        message('If an account exists for this email, a password reset link will arrive shortly.');
      } catch (error) { message(error.message, true); }
      finally { busy(form, false); }
    };
  }
  function signup(mount) {
    screen('Create your Rigo account', 'After you confirm your email, the owner chooses your role and approves your access.',
      '<form id="signup-form"><label class="field"><span>Full name</span><input name="name" autocomplete="name" maxlength="80" required></label><label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" required></label><label class="field"><span>Password</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label><label class="field"><span>Confirm password</span><input name="confirm" type="password" autocomplete="new-password" minlength="8" required></label><button class="primary" type="submit">Create account</button><button class="text-button" type="button" id="have-account">I already have an account</button></form>');
    document.getElementById('have-account').onclick = () => { history.replaceState(null, '', '/'); login(mount); };
    const form = document.getElementById('signup-form');
    form.onsubmit = async event => {
      event.preventDefault(); const data = new FormData(form);
      if (data.get('password') !== data.get('confirm')) return message('Passwords must match.', true);
      busy(form, true); message('Creating your account…');
      try {
        const join = new URLSearchParams(location.search).get('join');
        if (isId(join)) localStorage.setItem(joinKey, join);
        const result = await auth('signup?redirect_to=' + encodeURIComponent(location.origin + '/' + (isId(join) ? '?join=' + join : '')), {
          email: String(data.get('email')).trim(), password: data.get('password'), data: { full_name: String(data.get('name')).trim() }
        });
        history.replaceState(null, '', '/');
        // Supabase returns a session only when email confirmation is turned off.
        if (result.access_token) { saveSession(result); return await enter(mount); }
        screen('Check your email', 'Open the confirmation link we sent to finish creating your account. Then the owner can approve your access.', '<button class="outline" id="back-to-sign-in">Back to sign in</button>');
        document.getElementById('back-to-sign-in').onclick = () => login(mount);
      } catch (error) { message(error.message, true); busy(form, false); }
    };
  }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const roleNote = { Owner: 'Owner', Administrator: 'Administrator', Dispatcher: 'Dispatcher', 'Field employee': 'Field employee', Viewer: 'Viewer' };
  // The company this tab works in. Chosen once at entry; every write carries it explicitly.
  let selected = null, companies = [], account = null;
  const preferenceKey = () => 'rigo-company-' + (account?.userId || '');
  const joinKey = 'rigo-join';
  const isId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
  async function api(path, body) {
    const response = await request(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed. Try again.');
    return data;
  }
  async function requestAccess(workspace) {
    const user = await auth('user', undefined, 'GET', await accessToken());
    return (await api('/api/requests', { op: 'request', workspace, name: user.user_metadata?.full_name || '' })).status;
  }
  async function waiting(mount, workspace) {
    const status = await requestAccess(workspace);
    if (status === 'approved') { localStorage.removeItem(joinKey); return enter(mount); }
    const text = {
      pending: 'Your request was sent to the company. You can open it as soon as an owner or administrator approves it and chooses your role.',
      declined: 'The company declined this access request. Contact them if you think this is a mistake.',
      removed: 'Your access to this company was removed. Ask them to invite you again.'
    }[status] || 'Ask the company to approve the email you used to sign in.';
    screen(status === 'pending' ? 'Waiting for approval' : 'No access yet', text,
      '<div class="rigo-actions"><button class="primary" id="check-again">Check again</button><button class="outline" id="my-companies">Go to my companies</button><button class="text-button" id="sign-out">Sign out</button></div>');
    document.getElementById('sign-out').onclick = logout;
    document.getElementById('my-companies').onclick = () => { localStorage.removeItem(joinKey); enter(mount).catch(error => message(error.message, true)); };
    document.getElementById('check-again').onclick = async event => {
      event.target.disabled = true;
      try { await waiting(mount, workspace); } catch (error) { message(error.message, true); event.target.disabled = false; }
    };
  }
  async function ownerRequests(workspace, role) {
    document.getElementById('rigo-requests')?.remove();
    const box = document.createElement('aside');
    box.id = 'rigo-requests';
    box.innerHTML = '<button class="primary" id="rigo-requests-toggle" aria-expanded="false" aria-controls="rigo-requests-panel"></button><section class="panel" id="rigo-requests-panel" hidden><h2>Access requests</h2><p>Share the sign-up link for this company. Approve each request and choose a role.</p><button class="outline" id="rigo-copy-link">Copy sign-up link</button><div id="rigo-request-list" class="review-list"></div><p id="rigo-request-message" role="status" aria-live="polite"></p></section>';
    document.body.append(box);
    const toggle = box.querySelector('#rigo-requests-toggle'), panel = box.querySelector('section');
    const list = box.querySelector('#rigo-request-list'), status = box.querySelector('#rigo-request-message');
    let link = location.origin + '/?signup=1&join=' + workspace;
    const roles = role === 'Owner' ? ['Field employee', 'Dispatcher', 'Viewer', 'Administrator'] : ['Field employee', 'Dispatcher', 'Viewer'];
    async function load() {
      const data = await api('/api/requests?workspace=' + encodeURIComponent(workspace));
      link = data.signupUrl || link;
      toggle.textContent = 'Access requests (' + data.requests.length + ')';
      list.replaceChildren(...data.requests.map(item => {
        const row = document.createElement('div');
        const who = document.createElement('div');
        const name = document.createElement('strong'); name.textContent = item.name || item.email;
        const detail = document.createElement('small'); detail.textContent = item.email + ' · requested ' + new Date(item.at).toLocaleDateString();
        who.append(name, detail);
        const select = document.createElement('select');
        select.setAttribute('aria-label', 'Role for ' + item.email);
        for (const value of roles) select.add(new Option(value, value));
        const approve = document.createElement('button'); approve.className = 'primary'; approve.textContent = 'Approve';
        const decline = document.createElement('button'); decline.className = 'text-button'; decline.textContent = 'Decline';
        const decide = op => async () => {
          if (op === 'decline' && !confirm('Decline access for ' + item.email + '?')) return;
          approve.disabled = decline.disabled = true;
          try {
            await api('/api/requests', { op, workspace, requestId: item.id, role: select.value });
            status.className = 'success-text';
            status.textContent = op === 'approve' ? item.email + ' can now open this company as ' + select.value + '. Reload to see them in People & access.' : 'Request declined.';
            await load();
          } catch (error) { status.className = 'error-text'; status.textContent = error.message; approve.disabled = decline.disabled = false; }
        };
        approve.onclick = decide('approve'); decline.onclick = decide('decline');
        const actions = document.createElement('div'); actions.className = 'rigo-request-actions';
        actions.append(select, approve, decline);
        row.append(who, actions);
        return row;
      }));
      if (!data.requests.length) list.textContent = 'No pending requests.';
    }
    toggle.onclick = () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) load().catch(error => { status.className = 'error-text'; status.textContent = error.message; });
    };
    box.querySelector('#rigo-copy-link').onclick = async () => {
      try { await navigator.clipboard.writeText(link); status.className = 'success-text'; status.textContent = 'Sign-up link copied: ' + link; }
      catch { status.className = ''; status.textContent = link; }
    };
    toggle.textContent = 'Access requests';
    await load().catch(() => {});
  }
  function passwordSetup(mount, email) {
    screen('Set your Rigo password', 'Choose a password for the invited email. If you already have a password, you can keep it.',
      '<p id="invited-email"></p><form id="password-form"><label class="field"><span>New password</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label><label class="field"><span>Confirm password</span><input name="confirm" type="password" autocomplete="new-password" minlength="8" required></label><button class="primary" type="submit">Save password and continue</button><button class="text-button" type="button" id="keep-password">Keep my current password</button></form>');
    document.getElementById('invited-email').textContent = email;
    const form = document.getElementById('password-form');
    const next = () => { history.replaceState(null, '', '/'); return enter(mount); };
    document.getElementById('keep-password').onclick = () => next().catch(error => message(error.message, true));
    form.onsubmit = async event => {
      event.preventDefault(); const data = new FormData(form);
      if (data.get('password') !== data.get('confirm')) return message('Passwords must match.', true);
      busy(form, true); message('Saving your password…');
      try {
        await auth('user', { password: data.get('password') }, 'PUT', await accessToken());
        await next();
      } catch (error) { message(error.message, true); busy(form, false); }
    };
  }
  function companyItems(list, current) {
    return list.map(w => `<li><button type="button" class="rigo-company${w.id === current ? ' is-current' : ''}" data-id="${esc(w.id)}"${w.id === current ? ' aria-current="true"' : ''}><span class="rigo-company-name">${esc(w.name)}</span><span class="rigo-company-role">${esc(roleNote[w.role] || w.role)}${w.id === current ? ' · Current' : ''}</span></button></li>`).join('');
  }
  function remember(id) { try { localStorage.setItem(preferenceKey(), id); } catch {} }
  // Offline updates saved before companies existed belong to the company last opened in this browser.
  function migratePending(id) {
    const legacy = 'rigo-pending-' + account.user;
    const owner = localStorage.getItem('fieldbase-html-workspace');
    const value = localStorage.getItem(legacy);
    if (value === null || owner !== id) return;
    const target = legacy + ':' + id;
    if (localStorage.getItem(target) === null) localStorage.setItem(target, value);
    localStorage.removeItem(legacy);
  }
  function openCompany(mount, company) {
    selected = company;
    remember(company.id);
    migratePending(company.id);
    const url = new URL(location.href);
    url.searchParams.delete('join');
    url.searchParams.set('company', company.id);
    history.replaceState(null, '', url.pathname + url.search);
    mount();
    if (['Owner', 'Administrator'].includes(company.role)) ownerRequests(company.id, company.role).catch(() => {});
  }
  function picker(mount, notice) {
    screen('Choose a company', 'You belong to more than one company. Pick the one to open. You can switch later from the account menu.',
      `<ul class="rigo-company-list">${companyItems(companies)}</ul><div class="rigo-actions"><button class="outline" id="create-company">Create a company</button><button class="text-button" id="sign-out">Sign out</button></div>`);
    if (notice) message(notice, true);
    document.querySelectorAll('.rigo-company').forEach(button => { button.onclick = () => openCompany(mount, companies.find(w => w.id === button.dataset.id)); });
    document.getElementById('create-company').onclick = () => createCompany(mount, () => picker(mount));
    document.getElementById('sign-out').onclick = logout;
  }
  function onboarding(mount, notice) {
    screen('Welcome to Rigo', 'Your account is ready. Create your company to start, or ask an existing company to invite you.',
      `<div class="rigo-choices">
        <button class="rigo-choice" id="create-company" type="button"><strong>Create my company</strong><span>Start an empty company. You become its owner and can invite your team.</span></button>
        <div class="rigo-choice is-disabled" aria-disabled="true"><strong>Explore a demo</strong><span>A separate sample company to try Rigo safely. Coming soon.</span></div>
      </div>
      <p class="rigo-hint">Joining an existing company? Ask an owner or administrator to invite <strong>${esc(account.user)}</strong>. Invitations appear here when you sign in.</p>
      <div class="rigo-actions"><button class="outline" id="check-invites">Check for invitations</button><button class="text-button" id="sign-out">Sign out</button></div>`);
    if (notice) message(notice, true);
    document.getElementById('create-company').onclick = () => createCompany(mount, () => onboarding(mount));
    document.getElementById('check-invites').onclick = () => enter(mount).catch(error => message(error.message, true));
    document.getElementById('sign-out').onclick = logout;
  }
  function createCompany(mount, back) {
    screen('Create a company', 'Name the business. You can change it later in App settings. The company starts empty: no records, members, payments or paid services.',
      '<form id="company-form" novalidate><label class="field"><span>Company name <span aria-hidden="true">*</span></span><input name="name" maxlength="120" autocomplete="organization" required aria-describedby="company-name-help"></label><small id="company-name-help" class="rigo-help">Similar names are allowed. Companies are identified internally, not by name.</small><button class="primary" type="submit">Create company</button><button class="text-button" type="button" id="cancel-company">Cancel</button></form>');
    const form = document.getElementById('company-form');
    const input = form.elements.name;
    input.focus();
    // One request ID per attempt makes retries after a network error safe.
    let requestId = null;
    input.oninput = () => { requestId = null; input.removeAttribute('aria-invalid'); };
    document.getElementById('cancel-company').onclick = back;
    form.onsubmit = async event => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) { input.setAttribute('aria-invalid', 'true'); input.focus(); return message('Enter the company name.', true); }
      requestId ||= crypto.randomUUID();
      busy(form, true); message('Creating your company…');
      try {
        const { id } = await api('/api/companies', { name, requestId });
        remember(id);
        location.assign('/?company=' + id);
      } catch (error) { message(error.message + ' Your entry is kept; try again.', true); busy(form, false); }
    };
  }
  function invitationsScreen(mount, invitations) {
    screen('You have an invitation', 'Accept to join the company with the role shown. Declining does not affect your other companies.',
      `<ul class="rigo-company-list">${invitations.map(i => `<li class="rigo-invite" data-id="${esc(i.id)}"><div><strong>${esc(i.company)}</strong><small>${esc(i.role)} · expires ${esc(new Date(i.expiresAt).toLocaleDateString())}</small></div><div class="rigo-actions"><button class="primary" data-op="accept">Accept</button><button class="text-button" data-op="decline">Decline</button></div></li>`).join('')}</ul>
      <div class="rigo-actions"><button class="outline" id="later">Decide later</button></div>`);
    document.querySelectorAll('.rigo-invite button').forEach(button => {
      button.onclick = async () => {
        const item = button.closest('.rigo-invite');
        const op = button.dataset.op;
        if (op === 'decline' && !confirm('Decline this invitation?')) return;
        item.querySelectorAll('button').forEach(b => { b.disabled = true; });
        try {
          const result = await api('/api/invitations', { id: item.dataset.id, op });
          if (result.workspace) return await enter(mount, { skipInvitations: true, prefer: result.workspace });
          item.remove();
          message(result.status === 'declined' ? 'Invitation declined.' : 'This invitation is no longer valid (' + result.status.replace(/_/g, ' ') + '). Ask the company to send a new one.', result.status !== 'declined');
          if (!document.querySelector('.rigo-invite')) document.getElementById('later').textContent = 'Continue';
        } catch (error) { message(error.message, true); item.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
      };
    });
    document.getElementById('later').onclick = () => enter(mount, { skipInvitations: true }).catch(error => message(error.message, true));
  }
  async function enter(mount, { skipInvitations = false, prefer } = {}) {
    const data = await api('/api/workspaces');
    account = { user: data.user, userId: data.userId };
    companies = data.workspaces;
    const params = new URLSearchParams(location.search);
    const join = params.get('join') || localStorage.getItem(joinKey);
    const member = id => companies.find(w => w.id === id);
    if (isId(join) && !member(join)) { localStorage.setItem(joinKey, join); return waiting(mount, join); }
    localStorage.removeItem(joinKey);
    if (!skipInvitations && data.invitations?.length) return invitationsScreen(mount, data.invitations);
    if (member(prefer)) return openCompany(mount, member(prefer));
    let notice = '';
    const asked = params.get('company');
    if (asked && !member(asked)) notice = 'That company link is not available to this account. Choose one of your companies.';
    if (!companies.length) return onboarding(mount, notice);
    let saved = null;
    try { saved = localStorage.getItem(preferenceKey()); } catch {}
    const choice = member(asked) || (companies.length === 1 ? companies[0] : member(saved));
    if (choice && !notice) return openCompany(mount, choice);
    picker(mount, notice);
  }
  // Company switcher dialog, opened from the account menu.
  // Opened after the account menu has closed and returned focus, so focus lands inside the dialog.
  function openSwitcher() { setTimeout(showSwitcher, 50); }
  function showSwitcher() {
    document.getElementById('rigo-switcher')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'rigo-switcher';
    dialog.setAttribute('aria-labelledby', 'rigo-switcher-title');
    dialog.innerHTML = `<form method="dialog" class="rigo-dialog-head"><h2 id="rigo-switcher-title">Your companies</h2><button class="text-button" value="close" aria-label="Close">Close</button></form>
      <ul class="rigo-company-list">${companyItems(companies, selected?.id)}</ul>
      <div class="rigo-actions"><button class="outline" type="button" id="rigo-new-company">Create a company</button>${selected ? `<button class="text-button rigo-danger" type="button" id="rigo-leave">Leave ${esc(selected.name)}</button>` : ''}</div>
      <p id="rigo-switcher-message" role="status" aria-live="polite"></p>`;
    document.body.append(dialog);
    const status = dialog.querySelector('#rigo-switcher-message');
    const say = (text, error) => { status.textContent = text; status.className = error ? 'error-text' : 'success-text'; };
    const pending = () => { try { return JSON.parse(localStorage.getItem('rigo-pending-' + account.user + ':' + selected?.id) || '[]').length; } catch { return 0; } };
    const leaveWork = () => {
      const unsaved = document.querySelector('.app-modal, [role="dialog"]:not(#rigo-switcher)');
      const count = pending();
      if (count) return confirm(count + ' field update(s) for this company are not synchronized yet. They stay on this device and sync when you come back. Continue?');
      return !unsaved || confirm('A form is open. Unsaved changes in it will be lost. Continue?');
    };
    dialog.querySelectorAll('.rigo-company').forEach(button => {
      button.onclick = () => {
        if (button.dataset.id === selected?.id) return dialog.close();
        if (!leaveWork()) return;
        remember(button.dataset.id);
        location.assign('/?company=' + button.dataset.id);
      };
    });
    dialog.querySelector('#rigo-new-company').onclick = () => {
      if (!leaveWork()) return;
      dialog.close();
      createCompany(() => {}, () => location.assign('/?company=' + (selected?.id || '')));
    };
    dialog.querySelector('#rigo-leave')?.addEventListener('click', async event => {
      if (!confirm('Leave ' + selected.name + '? You lose access right away. An owner or administrator must invite you again to return. Your past work stays in the company records.')) return;
      event.target.disabled = true;
      try {
        await api('/api/leave', { workspace: selected.id });
        try { if (localStorage.getItem(preferenceKey()) === selected.id) localStorage.removeItem(preferenceKey()); } catch {}
        location.assign('/');
      } catch (error) { say(error.message, true); event.target.disabled = false; }
    });
    // The app listens for Escape globally, so the dialog handles it itself.
    dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dialog.close(); } });
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
    dialog.querySelector('.rigo-company.is-current, .rigo-company')?.focus();
  }
  async function logout() {
    try { await auth('logout', {}, 'POST', await accessToken()); } catch {}
    localStorage.removeItem(sessionKey);
    localStorage.removeItem('fieldbase-html-pending');
    location.assign('/');
  }
  async function start(mount) {
    // file:// exports retain their existing standalone behavior.
    if (location.protocol === 'file:') { config = { configured: false }; return mount(); }
    try {
      const response = await fetch('/api/rigo?route=config', { cache: 'no-store' });
      if (response.status === 404) { config = { configured: false }; return mount(); }
      if (!response.ok) throw new Error('Rigo connection could not be checked. Refresh and try again.');
      config = await response.json();
      if (!config.configured) return mount();
      session = readSession();
      const hash = new URLSearchParams(location.hash.slice(1));
      if (hash.get('error') || hash.get('error_description')) {
        history.replaceState(null, '', '/'); login(mount);
        return message('This invitation link expired or is invalid. Ask the owner to resend it.', true);
      }
      if (hash.get('access_token')) {
        saveSession({ access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token'), expires_in: Number(hash.get('expires_in') || 3600) });
        history.replaceState(null, '', location.pathname + location.search);
      }
      if (!session) return new URLSearchParams(location.search).get('signup') === '1' ? signup(mount) : login(mount);
      if (new URLSearchParams(location.search).get('signup') === '1') {
        const join = new URLSearchParams(location.search).get('join');
        history.replaceState(null, '', isId(join) ? '/?join=' + join : '/');
      }
      const user = await auth('user', undefined, 'GET', await accessToken());
      if (new URLSearchParams(location.search).get('invite') === '1') return passwordSetup(mount, user.email);
      await enter(mount);
    } catch (error) {
      if (config?.configured) { login(mount); message(error.message, true); }
      else screen('Rigo is temporarily unavailable', 'Refresh to retry the connection.', '');
    }
  }
  async function geocode(address) {
    const response = await request('/api/geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, workspace: selected?.id }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data;
  }
  // The bundle opens exactly the company chosen at entry; there is no default company when connected.
  const pickWorkspace = list => config?.configured ? list.find(w => w.id === selected?.id) || null : list[0];
  window.Rigo = { start, request, logout, geocode, pickWorkspace, openSwitcher,
    get workspaceId() { return config?.configured ? selected?.id || null : null; },
    get connected() { return Boolean(config?.configured); }, get geocoding() { return Boolean(config?.geocoding); } };
})();
