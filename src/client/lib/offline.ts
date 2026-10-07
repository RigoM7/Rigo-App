import { ApiError, post, OFFLINE } from './api';
import { parseMoney } from '../../shared/billing';

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

/**
 * local: on this phone, not submitted yet. queued: submitted, waiting for signal (sent automatically).
 * pending: sending now. failed: the server had a problem (sent again automatically). conflict: needs the
 * driver's review. held: with the office for review (the job moved on). accepted: the server has it.
 */
export type DraftState = 'local' | 'queued' | 'pending' | 'accepted' | 'failed' | 'conflict' | 'held';
/** What the driver saw when they opened the job, to show what the office changed since (R13-m2). */
export interface JobSnapshot { address: string | null; scheduled_start: string | null; access: string | null; notes: string | null; contact: string | null; details: Record<string, unknown>; resources: string }
export interface Draft {
  userId: string; companyId: string; jobId: string; jobNumber: number; baseVersion: number; submissionId: string;
  /** Not chosen until the driver picks one (R9-M1). */
  outcome: 'completed' | 'partial' | 'unsuccessful' | null; values: Record<string, string>; notes: string; reason: string; problem: string;
  reasonCode?: 'locked_gate' | 'dog' | 'no_access' | 'customer_cancelled' | 'tank_full' | 'other' | null;
  photos: string[]; signature: string | null; signerName: string;
  /** Draw on the screen, or type the customer's name with their agreement (R9-m4). */
  signatureMode?: 'draw' | 'type';
  /** The customer agreed to a typed signature. */
  signatureTyped?: boolean;
  /** Quantities the driver typed a second time to confirm an unusual amount (more than the truck holds). */
  confirmQuantities?: Record<string, string>;
  /** Fuel stops: one line per product or tank, with meter readings and a ticket (R7-M1, R7-M4). */
  lines?: { product: string; tank: string; quantity: string; meterStart: string; meterEnd: string; ticket: string }[];
  /** Payment taken at the stop (D21): the driver sees only the amount they typed. */
  collected?: { method: 'check' | 'cash' | 'card_terminal'; amount: string; reference: string; photo: string | null } | null;
  /** Start was tapped without signal: the record is sent with an implicit start, which history flags. */
  startedOffline?: boolean;
  base?: JobSnapshot;
  /** Goes up with each edit on this phone, so an older stored copy never replaces newer typing. */
  rev?: number;
  state: DraftState; message?: string; fields?: Record<string, string>; updatedAt: string; attempts?: number;
}

const scope = (uid: string, cid: string) => `${uid}:${cid}`;
const draftKey = (uid: string, cid: string, jobId: string) => `draft:${scope(uid, cid)}:${jobId}`;

export async function cacheJobs(uid: string, cid: string, payload: unknown) { await kvSet(`jobs:${scope(uid, cid)}`, { payload, cachedAt: new Date().toISOString() }); }
export async function cachedJobs<T>(uid: string, cid: string) { return kvGet<{ payload: T; cachedAt: string }>(`jobs:${scope(uid, cid)}`); }

// The last sign-in check and company settings, so the driver screens open with no signal (R13-C1).
// Removed on sign-out like everything else here.
export async function cacheMe(me: { user: { id: string } | null }) { if (me.user) await kvSet('me:last', { me, uid: me.user.id, cachedAt: new Date().toISOString() }); }
export async function cachedMe<T>() { return (await kvGet<{ me: T; uid: string; cachedAt: string }>('me:last')) ?? null; }
export async function cacheBoot(uid: string, cid: string, boot: unknown) { await kvSet(`boot:${scope(uid, cid)}`, { boot, cachedAt: new Date().toISOString() }); }
export async function cachedBoot<T>(uid: string, cid: string) { return (await kvGet<{ boot: T; cachedAt: string }>(`boot:${scope(uid, cid)}`)) ?? null; }

export async function saveDraft(d: Draft) { await kvSet(draftKey(d.userId, d.companyId, d.jobId), { ...d, updatedAt: new Date().toISOString() }); changed(); }
export async function getDraft(uid: string, cid: string, jobId: string) { return kvGet<Draft>(draftKey(uid, cid, jobId)); }
export async function deleteDraft(uid: string, cid: string, jobId: string) { await kvDel(draftKey(uid, cid, jobId)); changed(); }
export async function listDrafts(uid: string, cid: string) {
  const prefix = `draft:${scope(uid, cid)}:`;
  const keys = (await kvKeys()).map(String).filter((k) => k.startsWith(prefix));
  const out: Draft[] = [];
  for (const k of keys) { const d = await kvGet<Draft>(k); if (d) out.push(d); }
  return out;
}

/** Drafts the server doesn't have yet (anything not accepted and not with the office). */
export const isUnsent = (d: Draft) => d.state !== 'accepted' && d.state !== 'held';
/** Drafts that wait on the driver, not on signal. */
export const needsAttention = (d: Draft) => d.state === 'conflict' || (d.state === 'local' && !!d.fields && Object.keys(d.fields).length > 0);

export async function hasUnsynced(uid: string) {
  const keys = (await kvKeys()).map(String).filter((k) => k.startsWith(`draft:${uid}:`));
  for (const k of keys) { const d = await kvGet<Draft>(k); if (d && isUnsent(d)) return true; }
  return false;
}

/**
 * Remove what this user cached on the device. `keepDrafts` keeps their unsent work for when they sign
 * in again on a shared phone (R4-M4): drafts are keyed by their owner, so the next driver never sees
 * them. `companyId` limits it to one company (after being removed from it).
 */
export async function clearUserData(uid: string, opts: { keepDrafts?: boolean; companyId?: string } = {}) {
  const needle = opts.companyId ? `${uid}:${opts.companyId}` : `${uid}:`;
  const keys = (await kvKeys()).map(String).filter((k) => k.includes(needle) && !(opts.keepDrafts && k.startsWith('draft:')));
  for (const k of keys) await kvDel(k);
  if (!opts.companyId) { const m = await kvGet<{ uid: string }>('me:last'); if (m?.uid === uid) await kvDel('me:last'); }
  changed();
}

// Screens listen for this to re-read drafts after a background sync.
const EVT = 'rigo-drafts-changed';
function changed() { try { window.dispatchEvent(new Event(EVT)); } catch { /* not in a browser */ } }
export function onDraftsChanged(fn: () => void) { window.addEventListener(EVT, fn); return () => window.removeEventListener(EVT, fn); }

function payload(d: Draft) {
  return {
    submissionId: d.submissionId, baseVersion: d.baseVersion, outcome: d.outcome, values: d.values, notes: d.notes, reason: d.reason, reasonCode: d.reasonCode ?? null,
    photos: d.photos, signature: d.signatureMode === 'type' ? null : d.signature, signatureTyped: d.signatureMode === 'type' && !!d.signatureTyped, signerName: d.signerName, problem: d.problem, confirmQuantities: d.confirmQuantities ?? {},
    lines: d.outcome === 'unsuccessful' ? [] : d.lines ?? [],
    collected: d.collected && d.collected.amount ? { method: d.collected.method, amountMinor: parseMoney(d.collected.amount), reference: d.collected.reference, photo: d.collected.photo } : null,
  };
}

export const WAITING_FOR_SIGNAL = 'Waiting for signal — will send automatically.';

/**
 * Send a draft to the server. The server revalidates membership, assignment and version; only
 * its acceptance completes the job and starts downstream work (invoices, follow-ups). A record
 * for a job that moved on goes to the office for review instead of being lost.
 */
export async function syncDraft(d: Draft): Promise<Draft> {
  await saveDraft({ ...d, state: 'pending' });
  let next: Draft;
  try {
    const r = await post(`/c/${d.companyId}/jobs/${d.jobId}/complete`, payload(d));
    next = r?.pendingReview
      ? { ...d, state: 'held', message: r.message ?? 'Sent to the office for review.', fields: undefined, attempts: 0 }
      : { ...d, state: 'accepted', message: 'Accepted by the server.', fields: undefined, attempts: 0 };
  } catch (e) {
    const err = e as ApiError;
    if (err.code === 'not_member') next = await sendLateRecord(d);
    else if (err.code === OFFLINE || err.status === 0) next = { ...d, state: 'queued', message: WAITING_FOR_SIGNAL };
    else if (err.status >= 500 || err.status === 429) next = { ...d, state: 'failed', message: `The server couldn't take it yet (${err.message}). It will try again automatically.`, attempts: (d.attempts ?? 0) + 1 };
    else if (err.status === 409 || err.status === 404) next = { ...d, state: 'conflict', message: err.message };
    else next = { ...d, state: 'local', message: err.message, fields: err.fields };
  }
  await saveDraft(next);
  return next;
}

/** After removal from a company: records made while assigned still reach the office, for 7 days (D12). */
export async function sendLateRecord(d: Draft): Promise<Draft> {
  try {
    await post(`/late-records/${d.companyId}/jobs/${d.jobId}`, payload(d));
    return { ...d, state: 'held', message: 'Sent to the office for review.' };
  } catch (e) {
    const err = e as ApiError;
    if (err.code === OFFLINE || err.status === 0) return { ...d, state: 'queued', message: WAITING_FOR_SIGNAL };
    return { ...d, state: 'conflict', message: err.status === 404 ? 'This record can no longer be sent: you are no longer a member of this company.' : err.message };
  }
}

// ---------------------------------------------------------------- automatic sync (R13-M1)
// One run at a time per tab. Submitted drafts (queued, failed, or left "sending" by a closed app)
// are sent on app start, when signal returns, when the app comes back to the front, and on a backoff
// timer (15 s, then 1 min, then every 5 min) while anything is still waiting.
const BACKOFF = [15_000, 60_000, 300_000];
let running: Promise<SyncSummary> | null = null;
export interface SyncSummary { sent: number; held: number; attention: number; waiting: number }

export function syncPending(uid: string, cid: string): Promise<SyncSummary> {
  if (running) return running;
  running = (async () => {
    const sum: SyncSummary = { sent: 0, held: 0, attention: 0, waiting: 0 };
    const due = (await listDrafts(uid, cid)).filter((d) => d.state === 'queued' || d.state === 'failed' || d.state === 'pending');
    for (const d of due) {
      const r = await syncDraft(d);
      if (r.state === 'accepted') sum.sent++;
      else if (r.state === 'held') sum.held++;
      else if (r.state === 'queued' || r.state === 'failed') sum.waiting++;
      else sum.attention++;
      if (r.state === 'queued') break; // no signal: the rest wait too
    }
    return sum;
  })().finally(() => { running = null; });
  return running;
}

export function nextDelay(attempt: number) { return BACKOFF[Math.min(attempt, BACKOFF.length - 1)]; }
