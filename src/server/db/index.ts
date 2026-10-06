import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from '../config.js';

export interface Q {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Db extends Q {
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: 'pg' | 'pglite';
}

let current: Promise<Db> | null = null;

/** Returns the process-wide database, connecting and migrating on first use. */
export function getDb(): Promise<Db> {
  if (!current) current = connect(config.databaseUrl, config.dataDir).then(async (db) => { await migrate(db); return db; });
  return current;
}

/** For tests: replace the process-wide database. */
export function setDb(db: Db | null) { current = db ? Promise.resolve(db) : null; }

export async function connect(databaseUrl: string | undefined, dataDir?: string | null): Promise<Db> {
  if (databaseUrl) {
    const pg = (await import('pg')).default;
    // numeric/bigint come back as strings; parse bigint (int8) into numbers within safe range.
    pg.types.setTypeParser(20, (v: string) => Number(v));
    pg.types.setTypeParser(1082, (v: string) => v); // date stays 'YYYY-MM-DD' (no time-zone shifting)
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      max: config.isServerless ? 2 : 10,
      ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(databaseUrl) ? undefined : { rejectUnauthorized: false },
    });
    return {
      kind: 'pg',
      query: (sql, params) => pool.query(sql, params as any[]) as any,
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('begin');
          const res = await fn({ query: (s, p) => client.query(s, p as any[]) as any });
          await client.query('commit');
          return res;
        } catch (e) {
          await client.query('rollback').catch(() => {});
          throw e;
        } finally { client.release(); }
      },
      close: () => pool.end(),
    };
  }
  const { PGlite, types } = await import('@electric-sql/pglite');
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const lite = new PGlite({ dataDir: dataDir ?? undefined, parsers: { [types.INT8]: (v: string) => Number(v), [types.DATE]: (v: string) => v } });
  await lite.waitReady;
  // PGlite is a single connection: serialize transactions so they never interleave.
  let chain: Promise<unknown> = Promise.resolve();
  let inTx = false;
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
  return {
    kind: 'pglite',
    query: (sql, params) => (inTx ? lite.query(sql, params as any[]) : exclusive(() => lite.query(sql, params as any[]))) as any,
    tx: (fn) => exclusive(async () => {
      inTx = true;
      try {
        await lite.query('begin');
        try {
          const res = await fn({ query: (s, p) => lite.query(s, p as any[]) as any, exec: (s: string) => lite.exec(s) } as Q);
          await lite.query('commit');
          return res;
        } catch (e) { await lite.query('rollback').catch(() => {}); throw e; }
      } finally { inTx = false; }
    }),
    close: () => lite.close(),
  };
}

const migrationsDir = () => resolve(config.rootDir, 'migrations');

export async function migrate(db: Db) {
  await db.tx(async (q) => {
    if (db.kind === 'pg') await q.query('select pg_advisory_xact_lock(727274)');
    await q.query('create schema if not exists rigo');
    await q.query('create table if not exists rigo.schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await q.query<{ name: string }>('select name from rigo.schema_migrations')).rows.map((r) => r.name));
    const files = readdirSync(migrationsDir()).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = readFileSync(join(migrationsDir(), f), 'utf8');
      await execMulti(q, sql);
      await q.query('insert into rigo.schema_migrations (name) values ($1)', [f]);
    }
  });
}

/** Run a multi-statement SQL script. pg handles this natively with no params; PGlite needs exec. */
async function execMulti(q: Q, sql: string) {
  const anyQ = q as any;
  if (typeof anyQ.exec === 'function') return anyQ.exec(sql);
  return q.query(sql);
}

export function inClause(start: number, n: number) {
  return Array.from({ length: n }, (_, i) => `$${start + i}`).join(',');
}
