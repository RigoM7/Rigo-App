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
    screen('Sign in to Rigo', 'Use the email the owner invited. New employees can set their password through their invitation email.',
      '<form id="login-form"><label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" required></label><label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Sign in</button><button class="text-button" type="button" id="reset-password">Send password reset link</button></form>');
    const form = document.getElementById('login-form');
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
    if (data.workspaces.length) return mount();
    if (!data.owner) {
      screen('Waiting for access', 'This account has no active invitation. Ask the owner to invite the email you used to sign in.', '<button class="outline" id="sign-out">Sign out</button>');
      document.getElementById('sign-out').onclick = logout;
      return;
    }
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
      if (!session) { login(mount); return; }
      const user = await auth('user', undefined, 'GET', await accessToken());
      if (new URLSearchParams(location.search).get('invite') === '1') return passwordSetup(mount, user.email);
      await enter(mount);
    } catch (error) {
      if (config?.configured) { login(mount); message(error.message, true); }
      else screen('Rigo is temporarily unavailable', 'Refresh to retry the connection.', '');
    }
  }
  window.Rigo = { start, request, logout, get connected() { return Boolean(config?.configured); } };
})();
