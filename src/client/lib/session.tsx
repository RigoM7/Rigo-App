import type { GuideProgress } from '../../shared/demo';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { get, post, ApiError, OFFLINE } from './api';
import type { Permission } from '../../shared/permissions';
import { applyTheme, type ThemePref } from './theme';

export interface Me {
  user: { id: string; email: string; name: string; theme: ThemePref; emailVerified: boolean } | null;
  companies: { id: string; name: string; kind: 'real' | 'demo'; role_key: string; role_name: string; is_owner: boolean; branding: any; setup_completed_at: string | null; created_at?: string; address?: string | null; archived_at?: string | null; copied_from_demo?: boolean }[];
  invitations: { id: string; role_name: string; company_name: string; expires_at: string; needsLink?: boolean }[];
  devMailbox: boolean;
  /** How account email reaches people here: a real service, the local simulated mailbox, or none. */
  emailChannel: 'email' | 'mailbox' | 'none';
  /** Set when there was no signal and this is the copy saved on this device (when it was saved). */
  offlineSince?: string;
}

const isOffline = (e: unknown) => e instanceof ApiError && (e.code === OFFLINE || e.status === 0);

/** Who is signed in. With no signal, the last answer saved on this device, so the driver screens still open (R13-C1). */
async function fetchMe(): Promise<Me> {
  try {
    const me = await get<Me>('/auth/me');
    const off = await import('./offline');
    if (me.user) void off.cacheMe(me);
    else {
      // Signed out on the server (expired, or signed out elsewhere): the device copy goes; unsent drafts stay with their owner.
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

// networkMode "always": with no signal the query still runs and answers from the device copy, instead of pausing.
export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 30_000, networkMode: 'always' });
}

/**
 * Loads who is signed in into the cache before navigating. Use it after anything that changes
 * the signed-in person or their companies (sign-in, sign-up, password reset, accepting an
 * invitation, starting or resetting the demo, creating a company, changing email). An
 * invalidate alone would leave a stale "signed out" answer when nothing is observing it.
 */
export function refreshMe(qc: QueryClient) {
  return qc.fetchQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 0 });
}

/** Signs out and forgets everything cached, so the next person on this device sees nothing of it. */
export async function signOutAndForget(qc: QueryClient) {
  // Every sign-out clears what this phone kept for the person (unsent records stay, under their name only).
  const uid = qc.getQueryData<Me>(['me'])?.user?.id ?? (await (await import('./offline')).cachedMe<Me>())?.uid;
  if (uid) await (await import('./offline')).clearUserData(uid, { keepDrafts: true }).catch(() => {});
  await post('/auth/signout').catch(() => {});
  qc.clear();
  qc.setQueryData(['me'], { user: null } as Me);
  try { localStorage.removeItem('rigo-last-company'); } catch { /* ignore */ }
}

export interface Capability { state: 'available' | 'simulated' | 'disabled'; reason: string }
export interface Boot {
  company: { id: string; name: string; kind: 'real' | 'demo'; timezone: string; currency: string; automation_mode: 'manual' | 'assisted' | 'automatic'; paused: boolean; branding: any; phone: string | null; email: string | null; address: string | null; service_categories: string[]; customFields: any; accent: { base: string | null; light: string; dark: string }; invoiceDueDays: number; paymentInstructions: string; invoicePrefix?: string; remitTo?: string; taxId?: string; invoice_seq?: number; invoiceApprovalRequired?: boolean; businessHours?: { days: number[]; start: string; end: string } | null; paused_at?: string | null; paused_by?: string | null };
  role: { key: string; name: string; isOwner: boolean; simulated: string | null };
  permissions: Permission[];
  capabilities: Record<'email' | 'sms' | 'ai' | 'payments' | 'maps' | 'fileStorage', Capability>;
  attention: { needs_action: number; warnings: number; unread: number };
  setup: null | { items: { key: string; label: string; done: boolean; required: boolean; link: string; note?: string }[]; ready: boolean; done: number; total: number; step: string; dismissed: boolean };
  demo: null | { guide: { step: number; dismissed: boolean }; simRole: string; progress: GuideProgress };
  members: { id: string; name: string; role_key: string }[];
  roles: { key: string; name: string; canApprove?: boolean }[];
  me: { id: string; actingUserId: string };
  /** Set when there was no signal and these are the settings saved on this device. */
  offlineSince?: string;
}

interface CompanyCtxValue extends Boot {
  cid: string;
  can: (p: Permission) => boolean;
  to: (path?: string) => string;
  refresh: () => void;
}
const Ctx = createContext<CompanyCtxValue | null>(null);

/** Company settings. Drivers' copies are kept on the device so My jobs opens with no signal. */
export function useCompanyBoot(cid: string, uid: string | undefined) {
  return useQuery({
    queryKey: [cid, 'boot'], staleTime: 15_000, refetchInterval: 60_000, networkMode: 'always',
    queryFn: async () => {
      try {
        const b = await get<Boot>(`/c/${cid}`);
        if (uid && b.permissions.includes('jobs.work')) void import('./offline').then((o) => o.cacheBoot(uid, cid, b));
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

export function CompanyProvider({ cid, boot, children }: { cid: string; boot: Boot; children: ReactNode }) {
  const qc = useQueryClient();
  const value = useMemo<CompanyCtxValue>(() => {
    const perms = new Set(boot.permissions);
    return {
      ...boot, cid,
      can: (p) => perms.has(p),
      to: (path = '') => `/c/${cid}${path ? `/${path.replace(/^\//, '')}` : ''}`,
      refresh: () => qc.invalidateQueries({ queryKey: [cid] }),
    };
  }, [boot, cid, qc]);
  // Company branding: accent is validated server-side and has accessible light/dark variants.
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = root.dataset.theme === 'dark';
      root.style.setProperty('--brand-accent', dark ? boot.company.accent.dark : boot.company.accent.light);
      root.style.setProperty('--brand-accent-text', dark ? boot.company.accent.dark : boot.company.accent.light);
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { obs.disconnect(); root.style.removeProperty('--brand-accent'); root.style.removeProperty('--brand-accent-text'); };
  }, [boot.company.accent]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCompany() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCompany outside CompanyProvider');
  return v;
}

/** The current company, or null outside a company workspace. */
export function useOptionalCompany() {
  return useContext(Ctx);
}

export function useApplyUserTheme(pref: ThemePref | undefined) {
  useEffect(() => { if (pref) applyTheme(pref); }, [pref]);
}

/** Where to go after signing in: a same-site path from ?next=, otherwise home (the only company, or the list). */
export function safeNext(n: string | null | undefined) {
  return n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/open';
}

/** One line that tells two companies with the same name apart (R17-M2): role, town, when and how it started. */
export function companyMeta(co: { role_name: string; created_at?: string; address?: string | null; copied_from_demo?: boolean; kind?: string }) {
  if (co.kind === 'demo') return 'Demo';
  const parts = (co.address ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const town = parts.length > 1 ? parts[1] : '';
  const since = co.created_at ? `created ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(co.created_at))}` : '';
  return [co.role_name, town, since, co.copied_from_demo ? 'copied from the demo' : ''].filter(Boolean).join(' · ');
}
