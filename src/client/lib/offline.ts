import { ApiError, post, OFFLINE } from './api';

// Offline support for the worker's phone: cached lists and records (drafts) in IndexedDB, always keyed
// by person AND workspace so nothing leaks between people or workspaces. A record saved here is never
// "done": only the server's acceptance moves the work.

const DB = 'rigo-offline';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const kvGet = <T>(k: string) => tx<T | undefined>('readonly', (s) => s.get(k) as IDBRequest<T | undefined>).catch(() => undefined);
const kvSet = (k: string, v: unknown) => tx('readwrite', (s) => s.put(v, k)).catch(() => undefined);
const kvDel = (k: string) => tx('readwrite', (s) => s.delete(k)).catch(() => undefined);
const kvKeys = () => tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys()).catch(() => [] as IDBValidKey[]);

/**
 * local: on this phone, not sent. queued: waiting for signal (sent automatically). pending: sending.
 * failed: the server had a problem (sent again automatically). conflict: needs the worker's look.
 * accepted: the server has it.
 */
export type DraftState = 'local' | 'queued' | 'pending' | 'accepted' | 'failed' | 'conflict';
export interface Draft {
  userId: string; companyId: string; workId: string; number: number; title: string;
  baseVersion: number; submissionId: string;
  /** The stage the worker is moving the work to. */
  to: string | null; toName: string;
  fields: Record<string, unknown>; note: string;
  /** Goes up with each edit on this phone, so an older stored copy never replaces newer typing. */
  rev?: number;
  state: DraftState; message?: string; errors?: Record<string, string>; updatedAt: string; attempts?: number;
}

const scope = (uid: string, cid: string) => `${uid}:${cid}`;
const draftKey = (uid: string, cid: string, workId: string) => `draft:${scope(uid, cid)}:${workId}`;

export async function cacheList(uid: string, cid: string, payload: unknown) { await kvSet(`list:${scope(uid, cid)}`, { payload, cachedAt: new Date().toISOString() }); }
export async function cachedList<T>(uid: string, cid: string) { return kvGet<{ payload: T; cachedAt: string }>(`list:${scope(uid, cid)}`); }
export async function cacheMe(me: { user: { id: string } | null }) { if (me.user) await kvSet('me:last', { me, uid: me.user.id, cachedAt: new Date().toISOString() }); }
export async function cachedMe<T>() { return (await kvGet<{ me: T; uid: string; cachedAt: string }>('me:last')) ?? null; }
export async function cacheBoot(uid: string, cid: string, boot: unknown) { await kvSet(`boot:${scope(uid, cid)}`, { boot, cachedAt: new Date().toISOString() }); }
export async function cachedBoot<T>(uid: string, cid: string) { return (await kvGet<{ boot: T; cachedAt: string }>(`boot:${scope(uid, cid)}`)) ?? null; }

export async function saveDraft(d: Draft) { await kvSet(draftKey(d.userId, d.companyId, d.workId), { ...d, updatedAt: new Date().toISOString() }); changed(); }
export async function getDraft(uid: string, cid: string, workId: string) { return kvGet<Draft>(draftKey(uid, cid, workId)); }
export async function deleteDraft(uid: string, cid: string, workId: string) { await kvDel(draftKey(uid, cid, workId)); changed(); }
export async function listDrafts(uid: string, cid: string) {
  const prefix = `draft:${scope(uid, cid)}:`;
  const keys = (await kvKeys()).map(String).filter((k) => k.startsWith(prefix));
  const out: Draft[] = [];
  for (const k of keys) { const d = await kvGet<Draft>(k); if (d) out.push(d); }
  return out;
}

/** Records the server doesn't have yet. */
export const isUnsent = (d: Draft) => d.state !== 'accepted';

export async function hasUnsynced(uid: string) {
  const keys = (await kvKeys()).map(String).filter((k) => k.startsWith(`draft:${uid}:`));
  for (const k of keys) { const d = await kvGet<Draft>(k); if (d && isUnsent(d)) return true; }
  return false;
}

/**
 * Removes what this person cached on the device. `keepDrafts` keeps their unsent records for when
 * they sign in again on a shared phone: records are keyed by their owner, so nobody else sees them.
 */
export async function clearUserData(uid: string, opts: { keepDrafts?: boolean; companyId?: string } = {}) {
  const needle = opts.companyId ? `${uid}:${opts.companyId}` : `${uid}:`;
  const keys = (await kvKeys()).map(String).filter((k) => k.includes(needle) && !(opts.keepDrafts && k.startsWith('draft:')));
  for (const k of keys) await kvDel(k);
  if (!opts.companyId) { const m = await kvGet<{ uid: string }>('me:last'); if (m?.uid === uid) await kvDel('me:last'); }
  changed();
}

const EVT = 'rigo-drafts-changed';
function changed() { try { window.dispatchEvent(new Event(EVT)); } catch { /* not in a browser */ } }
export function onDraftsChanged(fn: () => void) { window.addEventListener(EVT, fn); return () => window.removeEventListener(EVT, fn); }

export const WAITING_FOR_SIGNAL = 'Saved on this phone. It sends by itself when there is signal.';

/** Sends a record. The server rechecks membership, assignment and the stage rules. */
export async function syncDraft(d: Draft): Promise<Draft> {
  await saveDraft({ ...d, state: 'pending' });
  let next: Draft;
  try {
    await post(`/c/${d.companyId}/my/work/${d.workId}/submit`, { submissionId: d.submissionId, baseVersion: d.baseVersion, to: d.to, fields: d.fields, note: d.note });
    next = { ...d, state: 'accepted', message: 'Sent.', errors: undefined, attempts: 0 };
  } catch (e) {
    const err = e as ApiError;
    if (err.code === OFFLINE || err.status === 0) next = { ...d, state: 'queued', message: WAITING_FOR_SIGNAL };
    else if (err.status >= 500 || err.status === 429) next = { ...d, state: 'failed', message: `Rigo couldn't take it yet. It will try again by itself.`, attempts: (d.attempts ?? 0) + 1 };
    else if (err.status === 409 || err.status === 404 || err.status === 403) next = { ...d, state: 'conflict', message: err.message };
    else next = { ...d, state: 'local', message: err.message, errors: err.fields };
  }
  await saveDraft(next);
  return next;
}

// One run at a time per tab. Waiting records are sent on start, when signal returns, when the app
// comes back to the front, and on a backoff timer (15 s, 1 min, then every 5 min).
const BACKOFF = [15_000, 60_000, 300_000];
let running: Promise<SyncSummary> | null = null;
export interface SyncSummary { sent: number; attention: number; waiting: number }

export function syncPending(uid: string, cid: string): Promise<SyncSummary> {
  if (running) return running;
  running = (async () => {
    const sum: SyncSummary = { sent: 0, attention: 0, waiting: 0 };
    const due = (await listDrafts(uid, cid)).filter((d) => d.state === 'queued' || d.state === 'failed' || d.state === 'pending');
    for (const d of due) {
      const r = await syncDraft(d);
      if (r.state === 'accepted') sum.sent++;
      else if (r.state === 'queued' || r.state === 'failed') sum.waiting++;
      else sum.attention++;
      if (r.state === 'queued') break; // no signal: the rest wait too
    }
    return sum;
  })().finally(() => { running = null; });
  return running;
}

export function nextDelay(attempt: number) { return BACKOFF[Math.min(attempt, BACKOFF.length - 1)]; }
