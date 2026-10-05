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
        const result = await auth('signup?redirect_to=' + encodeURIComponent(location.origin + '/'), {
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
  async function requestAccess() {
    const user = await auth('user', undefined, 'GET', await accessToken());
    const response = await request('/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'request', name: user.user_metadata?.full_name || '' }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data.status;
  }
  async function waiting(mount) {
    const status = await requestAccess();
    if (status === 'approved') return enter(mount);
    const text = {
      pending: 'Your request was sent to the owner. You can open Rigo as soon as they approve it and choose your role.',
      declined: 'The owner declined this access request. Contact them if you think this is a mistake.',
      removed: 'Your access was removed. Ask the owner to invite you again.'
    }[status] || 'Ask the owner to approve the email you used to sign in.';
    screen(status === 'pending' ? 'Waiting for approval' : 'No access yet', text,
      '<button class="primary" id="check-again">Check again</button><button class="text-button" id="sign-out">Sign out</button>');
    document.getElementById('sign-out').onclick = logout;
    document.getElementById('check-again').onclick = async event => {
      event.target.disabled = true;
      try { await waiting(mount); } catch (error) { message(error.message, true); event.target.disabled = false; }
    };
  }
  async function ownerRequests() {
    document.getElementById('rigo-requests')?.remove();
    const box = document.createElement('aside');
    box.id = 'rigo-requests';
    box.innerHTML = '<button class="primary" id="rigo-requests-toggle" aria-expanded="false"></button><section class="panel" hidden><h2>Employee access requests</h2><p>Share the sign-up link with employees. Approve each request and choose their role.</p><button class="outline" id="rigo-copy-link">Copy sign-up link</button><div id="rigo-request-list" class="review-list"></div><p id="rigo-request-message" role="status" aria-live="polite"></p></section>';
    document.body.append(box);
    const toggle = box.querySelector('#rigo-requests-toggle'), panel = box.querySelector('section');
    const list = box.querySelector('#rigo-request-list'), status = box.querySelector('#rigo-request-message');
    let link = location.origin + '/?signup=1';
    async function load() {
      const response = await request('/api/requests');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      link = data.signupUrl || link;
      toggle.textContent = 'Access requests (' + data.requests.length + ')';
      list.replaceChildren(...data.requests.map(item => {
        const row = document.createElement('div');
        const who = document.createElement('div');
        const name = document.createElement('strong'); name.textContent = item.name || item.email;
        const detail = document.createElement('small'); detail.textContent = item.email + ' · requested ' + new Date(item.at).toLocaleDateString();
        who.append(name, detail);
        const role = document.createElement('select');
        role.setAttribute('aria-label', 'Role for ' + item.email);
        for (const value of ['Field employee', 'Dispatcher', 'Viewer', 'Administrator']) role.add(new Option(value, value));
        const approve = document.createElement('button'); approve.className = 'primary'; approve.textContent = 'Approve';
        const decline = document.createElement('button'); decline.className = 'text-button'; decline.textContent = 'Decline';
        const decide = op => async () => {
          if (op === 'decline' && !confirm('Decline access for ' + item.email + '?')) return;
          approve.disabled = decline.disabled = true;
          try {
            const response = await request('/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ op, requestId: item.id, role: role.value }) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            status.className = 'success-text';
            status.textContent = op === 'approve' ? item.email + ' can now sign in as ' + role.value + '. Reload to see them in People & access.' : 'Request declined.';
            await load();
          } catch (error) { status.className = 'error-text'; status.textContent = error.message; approve.disabled = decline.disabled = false; }
        };
        approve.onclick = decide('approve'); decline.onclick = decide('decline');
        const actions = document.createElement('div'); actions.className = 'rigo-request-actions';
        actions.append(role, approve, decline);
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
    screen('Set your Rigo password', 'Choose a password for the email the owner invited.',
      '<p id="invited-email"></p><form id="password-form"><label class="field"><span>New password</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label><label class="field"><span>Confirm password</span><input name="confirm" type="password" autocomplete="new-password" minlength="8" required></label><button class="primary" type="submit">Save password and open Rigo</button></form>');
    document.getElementById('invited-email').textContent = email;
    const form = document.getElementById('password-form');
    form.onsubmit = async event => {
      event.preventDefault(); const data = new FormData(form);
      if (data.get('password') !== data.get('confirm')) return message('Passwords must match.', true);
      busy(form, true); message('Saving your password…');
      try {
        await auth('user', { password: data.get('password') }, 'PUT', await accessToken());
        history.replaceState(null, '', '/');
        await enter(mount);
      } catch (error) { message(error.message, true); busy(form, false); }
    };
  }
  async function enter(mount) {
    const response = await request('/api/workspaces');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (data.workspaces.length) {
      mount();
      if (data.owner) ownerRequests().catch(() => {});
      return;
    }
    if (!data.owner) return waiting(mount);
    let backup;
    try { backup = JSON.parse(localStorage.getItem('fieldbase-standalone-v1')); } catch {}
    screen('Set up shared Rigo', backup?.state ? 'Move this browser’s existing Rigo records into your shared workspace so invited employees can access their work.' : 'Create your shared workspace, then invite employees from People & access.',
      '<button class="primary" id="create-workspace">' + (backup?.state ? 'Use this browser’s existing records' : 'Create shared workspace') + '</button><button class="text-button" id="sign-out">Sign out</button>');
    document.getElementById('sign-out').onclick = logout;
    document.getElementById('create-workspace').onclick = async event => {
      event.target.disabled = true;
      try {
        const response = await request('/api/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: backup?.state }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        mount();
        ownerRequests().catch(() => {});
      } catch (error) { message(error.message, true); event.target.disabled = false; }
    };
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
      if (new URLSearchParams(location.search).get('signup') === '1') history.replaceState(null, '', '/');
      const user = await auth('user', undefined, 'GET', await accessToken());
      if (new URLSearchParams(location.search).get('invite') === '1') return passwordSetup(mount, user.email);
      await enter(mount);
    } catch (error) {
      if (config?.configured) { login(mount); message(error.message, true); }
      else screen('Rigo is temporarily unavailable', 'Refresh to retry the connection.', '');
    }
  }
  async function geocode(address) {
    const response = await request('/api/geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data;
  }
  window.Rigo = { start, request, logout, geocode, get connected() { return Boolean(config?.configured); }, get geocoding() { return Boolean(config?.geocoding); } };
})();
