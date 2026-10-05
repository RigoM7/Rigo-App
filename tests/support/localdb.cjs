// Throwaway local PostgreSQL for database tests. Never connects to Supabase.
// Skips when PostgreSQL server binaries or root (to run them as `postgres`) are unavailable.
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function findBin() {
  const root = '/usr/lib/postgresql';
  if (!fs.existsSync(root)) return null;
  const versions = fs.readdirSync(root).sort().reverse();
  for (const v of versions) if (fs.existsSync(path.join(root, v, 'bin', 'initdb'))) return path.join(root, v, 'bin');
  return null;
}
const bin = findBin();
const available = Boolean(bin && process.getuid && process.getuid() === 0);

// Stand-ins for the parts of Supabase the migration depends on.
const SUPABASE_STUB = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text not null);
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
`;

function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rigo-pg-'));
  fs.chmodSync(dir, 0o777);
  const data = path.join(dir, 'data');
  const as = (cmd, args, opts = {}) => execFileSync('runuser', ['-u', 'postgres', '--', path.join(bin, cmd), ...args], { stdio: 'pipe', ...opts }).toString();
  as('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8']);
  const port = String(20000 + Math.floor(Math.random() * 20000));
  as('pg_ctl', ['-D', data, '-l', path.join(dir, 'log'), '-w', '-o', `-k ${dir} -p ${port} -c listen_addresses=''`, 'start']);
  const psqlArgs = ['-h', dir, '-p', port, '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-tA'];
  const sql = query => as('psql', [...psqlArgs, '-c', query]).trim();
  const file = f => as('psql', [...psqlArgs, '-f', f]).trim();
  // Run a query in the background (for concurrency tests). Resolves with { ok, out }.
  const sqlAsync = query => new Promise(resolve => {
    const p = spawn('runuser', ['-u', 'postgres', '--', path.join(bin, 'psql'), ...psqlArgs, '-c', query]);
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', code => resolve({ ok: code === 0, out: out.trim() }));
  });
  const stop = () => {
    try { as('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  };
  sql(SUPABASE_STUB);
  return { sql, file, sqlAsync, stop };
}
// Every migration in name order, as production receives them.
function migrations() {
  const dir = path.join(__dirname, '../../supabase/migrations');
  return fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => path.join(dir, f));
}
module.exports = { available, start, migrations };
