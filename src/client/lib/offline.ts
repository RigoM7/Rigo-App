import { ApiError, post, OFFLINE } from './api';

// Bounded offline support for drivers: cached assignments and completion drafts in IndexedDB,
// always keyed by user AND company so nothing leaks between people or workspaces. A draft saved
// here is never "completed": only the server's acceptance completes a job.

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

export type DraftState = 'local' | 'pending' | 'accepted' | 'failed' | 'conflict';
export interface Draft {
  userId: string; companyId: string; jobId: string; jobNumber: number; baseVersion: number; submissionId: string;
  outcome: 'completed' | 'partial' | 'unsuccessful'; values: Record<string, string>; notes: string; reason: string; problem: string;
  photos: string[]; signature: string | null; signerName: string;
  state: DraftState; message?: string; fields?: Record<string, string>; updatedAt: string;
}

const scope = (uid: string, cid: string) => `${uid}:${cid}`;
const draftKey = (uid: string, cid: string, jobId: string) => `draft:${scope(uid, cid)}:${jobId}`;

export async function cacheJobs(uid: string, cid: string, payload: unknown) { await kvSet(`jobs:${scope(uid, cid)}`, { payload, cachedAt: new Date().toISOString() }); }
export async function cachedJobs<T>(uid: string, cid: string) { return kvGet<{ payload: T; cachedAt: string }>(`jobs:${scope(uid, cid)}`); }

export async function saveDraft(d: Draft) { await kvSet(draftKey(d.userId, d.companyId, d.jobId), { ...d, updatedAt: new Date().toISOString() }); }
export async function getDraft(uid: string, cid: string, jobId: string) { return kvGet<Draft>(draftKey(uid, cid, jobId)); }
export async function deleteDraft(uid: string, cid: string, jobId: string) { await kvDel(draftKey(uid, cid, jobId)); }
export async function listDrafts(uid: string, cid: string) {
  const prefix = `draft:${scope(uid, cid)}:`;
  const keys = (await kvKeys()).map(String).filter((k) => k.startsWith(prefix));
  const out: Draft[] = [];
  for (const k of keys) { const d = await kvGet<Draft>(k); if (d) out.push(d); }
  return out;
}

export async function hasUnsynced(uid: string) {
  const keys = (await kvKeys()).map(String).filter((k) => k.startsWith(`draft:${uid}:`));
  for (const k of keys) { const d = await kvGet<Draft>(k); if (d && d.state !== 'accepted') return true; }
  return false;
}

/** Remove everything this user cached on the device (called on sign-out). */
export async function clearUserData(uid: string) {
  const keys = (await kvKeys()).map(String).filter((k) => k.includes(`${uid}:`));
  for (const k of keys) await kvDel(k);
}

/**
 * Send a draft to the server. The server revalidates membership, assignment and version; only
 * its acceptance completes the job and starts downstream work (invoices, follow-ups).
 */
export async function syncDraft(d: Draft): Promise<Draft> {
  await saveDraft({ ...d, state: 'pending' });
  try {
    await post(`/c/${d.companyId}/jobs/${d.jobId}/complete`, {
      submissionId: d.submissionId, baseVersion: d.baseVersion, outcome: d.outcome, values: d.values, notes: d.notes, reason: d.reason,
      photos: d.photos, signature: d.signature, signerName: d.signerName, problem: d.problem,
    });
    const done = { ...d, state: 'accepted' as const, message: 'Accepted by the server.', fields: undefined, updatedAt: new Date().toISOString() };
    await saveDraft(done);
    return done;
  } catch (e) {
    const err = e as ApiError;
    let next: Draft;
    if (err.code === OFFLINE || err.status === 0 || err.status >= 500) next = { ...d, state: 'failed', message: err.code === OFFLINE ? 'Waiting for a connection. Your draft is saved on this device.' : 'The server could not accept it yet. Try again.' };
    else if (err.status === 409 || err.status === 404) next = { ...d, state: 'conflict', message: err.message };
    else next = { ...d, state: 'local', message: err.message, fields: err.fields };
    await saveDraft(next);
    return next;
  }
}
