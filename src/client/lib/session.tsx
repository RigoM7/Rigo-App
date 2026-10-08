import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { get, post, ApiError, OFFLINE } from './api';
import type { Permission, RoleApp } from '../../shared/permissions';
import type { Vocabulary, FieldDef, Meaning } from '../../shared/workspace';
import { applyTheme, type ThemePref } from './theme';

export interface MeWorkspace { id: string; name: string; kind: 'real' | 'demo'; template_key: string | null; role_key: string; role_name: string; role_app: RoleApp; is_owner: boolean; created_at?: string; address?: string | null; archived_at?: string | null }
export interface Me {
  user: { id: string; email: string; name: string; theme: ThemePref; emailVerified: boolean } | null;
  companies: MeWorkspace[];
  invitations: { id: string; role_name: string; company_name: string; expires_at: string; needsLink?: boolean }[];
  devMailbox: boolean;
  emailChannel: 'email' | 'mailbox' | 'none';
  /** Set when there was no signal and this is the copy saved on this device. */
  offlineSince?: string;
}

const isOffline = (e: unknown) => e instanceof ApiError && (e.code === OFFLINE || e.status === 0);

/** Who is signed in. With no signal, the last answer saved on this device, so the worker screens still open. */
async function fetchMe(): Promise<Me> {
  try {
    const me = await get<Me>('/auth/me');
    const off = await import('./offline');
    if (me.user) void off.cacheMe(me);
    else {
      const last = await off.cachedMe<Me>();
      if (last) void off.clearUserData(last.uid, { keepDrafts: true });
    }
    return me;
  } catch (e) {
    if (!isOffline(e)) throw e;
    const { cachedMe } = await import('./offline');
    const c = await cachedMe<Me>();
    if (!c) throw e;
    return { ...c.me, offlineSince: c.cachedAt };
  }
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 30_000, networkMode: 'always' });
}

/** Loads who is signed in before navigating, after anything that changes it. */
export function refreshMe(qc: QueryClient) {
  return qc.fetchQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 0 });
}

/** Signs out and forgets everything cached, so the next person on this device sees nothing of it. */
export async function signOutAndForget(qc: QueryClient) {
  const uid = qc.getQueryData<Me>(['me'])?.user?.id ?? (await (await import('./offline')).cachedMe<Me>())?.uid;
  if (uid) await (await import('./offline')).clearUserData(uid, { keepDrafts: true }).catch(() => {});
  await post('/auth/signout').catch(() => {});
  qc.clear();
  qc.setQueryData(['me'], { user: null } as Me);
  try { localStorage.removeItem('rigo-last-workspace'); } catch { /* ignore */ }
}

export interface Capability { state: 'available' | 'simulated' | 'disabled'; reason: string }
export interface StageInfo { id: string; key: string; name: string; meaning: Meaning; position: number; requires: string[]; next: string[] | null }
export interface Boot {
  workspace: {
    id: string; name: string; kind: 'real' | 'demo'; timezone: string; currency: string; description: string; templateKey: string | null; archivedAt: string | null;
    taxRateBp?: number | null; automation: { mode: 'manual' | 'assisted' | 'automatic'; paused: boolean; pausedAt: string | null };
  };
  words: Vocabulary;
  role: { key: string; name: string; isOwner: boolean; app: RoleApp; simulated: string | null };
  permissions: Permission[];
  stages: StageInfo[];
  fields: { work: FieldDef[]; customer: FieldDef[]; equipment: FieldDef[] };
  equipment: boolean;
  capabilities: Record<'email' | 'sms' | 'ai' | 'payments' | 'maps' | 'fileStorage', Capability>;
  setup: null | { items: { key: string; label: string; done: boolean; link: string; note?: string }[]; done: number; total: number; dismissed: boolean };
  members: { id: string; name: string; role_key: string; app: RoleApp }[];
  roles: { key: string; name: string; app: RoleApp; is_owner: boolean }[];
  unread: number;
  demo: null | { sample: boolean; view: string };
  me: { id: string; actingUserId: string };
  offlineSince?: string;
}

interface WorkspaceValue extends Boot {
  cid: string;
  can: (p: Permission) => boolean;
  /** A path inside this workspace: to('work/new') → /w/<id>/work/new. */
  to: (path?: string) => string;
  refresh: () => void;
  stage: (id: string) => StageInfo | undefined;
}
const Ctx = createContext<WorkspaceValue | null>(null);

/** Workspace settings. Workers' copies are kept on the device so Today opens with no signal. */
export function useWorkspaceBoot(cid: string, uid: string | undefined) {
  return useQuery({
    queryKey: [cid, 'boot'], staleTime: 15_000, refetchInterval: 60_000, networkMode: 'always',
    queryFn: async () => {
      try {
        const b = await get<Boot>(`/c/${cid}`);
        if (uid && b.role.app === 'worker') void import('./offline').then((o) => o.cacheBoot(uid, cid, b));
        return b;
      } catch (e) {
        if (!isOffline(e) || !uid) throw e;
        const c = await (await import('./offline')).cachedBoot<Boot>(uid, cid);
        if (!c) throw e;
        return { ...c.boot, offlineSince: c.cachedAt };
      }
    },
  });
}

export function WorkspaceProvider({ cid, boot, children }: { cid: string; boot: Boot; children: ReactNode }) {
  const qc = useQueryClient();
  const value = useMemo<WorkspaceValue>(() => {
    const perms = new Set(boot.permissions);
    return {
      ...boot, cid,
      can: (p) => perms.has(p),
      to: (path = '') => `/w/${cid}${path ? `/${path.replace(/^\//, '')}` : ''}`,
      refresh: () => qc.invalidateQueries({ queryKey: [cid] }),
      stage: (id) => boot.stages.find((s) => s.id === id),
    };
  }, [boot, cid, qc]);
  useEffect(() => { try { localStorage.setItem('rigo-last-workspace', cid); } catch { /* ignore */ } }, [cid]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace outside WorkspaceProvider');
  return v;
}
export function useOptionalWorkspace() { return useContext(Ctx); }

export function useApplyUserTheme(pref: ThemePref | undefined) {
  useEffect(() => { if (pref) applyTheme(pref); }, [pref]);
}

/** Where to go after signing in: a same-site path from ?next=, otherwise home. */
export function safeNext(n: string | null | undefined) {
  return n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/home';
}

/** One line that tells two workspaces with the same name apart: role, town, when it started. */
export function workspaceMeta(w: MeWorkspace) {
  if (w.kind === 'demo') return 'Demo';
  const since = w.created_at ? `since ${new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(new Date(w.created_at))}` : '';
  return [w.role_name, since, w.archived_at ? 'archived' : ''].filter(Boolean).join(' · ');
}
