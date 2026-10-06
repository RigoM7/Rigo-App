// A stand-in for the Supabase endpoints Rigo's server uses, backed by a throwaway local
// PostgreSQL (see localdb.cjs). REST reads/writes and RPC calls run as real SQL, so the
// server is tested against the real migration and database rules. Auth and email are
// simulated: tokens map to fixture users and sent emails are recorded, never delivered.
const lit = value => value === null || value === undefined ? 'null' : `'${String(value).replace(/'/g, "''")}'`;
const json = value => {
  const tag = '$j' + Math.random().toString(36).slice(2, 8) + '$';
  return `${tag}${JSON.stringify(value)}${tag}::jsonb`;
};
function column(c) {
  const m = /^(\w+):(\w+)->>(\w+)$/.exec(c);
  if (m) return `${m[2]}->>'${m[3]}' as ${m[1]}`;
  if (!/^(\*|\w+)$/.test(c)) throw new Error('Unsupported select ' + c);
  return c;
}
function where(params) {
  const parts = [];
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit'].includes(key)) continue;
    const [, op, value] = /^(eq|in|cs)\.(.*)$/.exec(raw) || [];
    if (op === 'cs') { parts.push(`${key} @> ${lit(value)}`); continue; }
    if (op === 'eq') parts.push(`${key} = ${lit(value)}`);
    else if (op === 'in') parts.push(`${key}::text in (${value.replace(/^\(|\)$/g, '').split(',').map(lit).join(',')})`);
    else throw new Error('Unsupported filter ' + key + '=' + raw);
  }
  return parts.length ? ' where ' + parts.join(' and ') : '';
}
function createFakeSupabase(db, users) {
  const mails = [];
  const calls = [];
  const rows = sql => JSON.parse(db.sql(`select coalesce(json_agg(t), '[]') from (${sql}) t`) || '[]');
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ method, host: u.hostname, path: u.pathname, search: u.search });
    // The paid lookup provider is simulated and only recorded; tests never reach it.
    if (u.hostname === 'api.mapbox.com') return Response.json({ features: [{ center: [-97.1, 32.7], place_name: 'Simulated place' }] });
    if (u.hostname !== 'project.supabase.co') throw new Error('Unexpected external request to ' + u.hostname);
    if (u.pathname === '/auth/v1/user') {
      const user = users[(options.headers.Authorization || '').replace('Bearer ', '')];
      return user ? Response.json(user) : Response.json({ msg: 'invalid' }, { status: 401 });
    }
    if (u.pathname === '/auth/v1/invite' || u.pathname === '/auth/v1/otp') {
      mails.push({ path: u.pathname, email: body.email, redirect: u.searchParams.get('redirect_to') });
      if (users.__mailFails) return Response.json({ msg: 'SMTP down' }, { status: 500 });
      const exists = Object.values(users).some(x => x?.email === body.email);
      if (u.pathname === '/auth/v1/invite' && exists) return Response.json({ error_code: 'email_exists', msg: 'exists' }, { status: 422 });
      return Response.json({});
    }
    try {
      const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(u.pathname);
      if (rpc) {
        const value = v => Array.isArray(v) && v.every(x => typeof x === 'string') && v.length ? `array[${v.map(lit).join(',')}]::text[]` : v !== null && typeof v === 'object' ? json(v) : lit(v);
        const args = Object.entries(body).map(([k, v]) => `${k} => ${value(v)}`).join(', ');
        const out = db.sql(`select to_json(public.${rpc[1]}(${args}))`);
        return Response.json(JSON.parse(out));
      }
      const table = /^\/rest\/v1\/(\w+)$/.exec(u.pathname)?.[1];
      if (!table) throw new Error('Unsupported path ' + u.pathname);
      const params = [...u.searchParams];
      if (method === 'GET') {
        const select = (u.searchParams.get('select') || '*').split(',').map(column).join(', ');
        const order = u.searchParams.get('order');
        const orderSql = order ? ' order by ' + order.split(',').map(o => o.replace(/\.(asc|desc)$/, ' $1')).join(', ') : '';
        const limit = u.searchParams.get('limit') ? ' limit ' + Number(u.searchParams.get('limit')) : '';
        return Response.json(rows(`select ${select} from public.${table}${where(params)}${orderSql}${limit}`));
      }
      if (method === 'PATCH') {
        const sets = Object.entries(body).map(([k, v]) => `${k} = ${['state', 'audit', 'receipts'].includes(k) ? json(v) : Array.isArray(v) ? `array[${v.map(lit).join(',')}]::text[]` : lit(v)}`).join(', ');
        const out = db.sql(`with u as (update public.${table} set ${sets}${where(params)} returning *) select coalesce(json_agg(u), '[]') from u`);
        return Response.json(JSON.parse(out || '[]'));
      }
      throw new Error('Unsupported method ' + method);
    } catch (error) {
      const text = String(error.stderr || error.message);
      const rule = /rigo:\w+/.exec(text)?.[0];
      return Response.json({ code: rule ? 'P0001' : 'XX000', message: rule || text.slice(0, 300) }, { status: rule ? 400 : 500 });
    }
  };
  return { fetchImpl, mails, calls };
}
module.exports = { createFakeSupabase };
