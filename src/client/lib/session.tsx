import type { GuideProgress } from '../../shared/demo';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { get, post } from './api';
import type { Permission } from '../../shared/permissions';
import { applyTheme, type ThemePref } from './theme';

export interface Me {
  user: { id: string; email: string; name: string; theme: ThemePref; emailVerified: boolean } | null;
  companies: { id: string; name: string; kind: 'real' | 'demo'; role_key: string; role_name: string; is_owner: boolean; branding: any; setup_completed_at: string | null }[];
  invitations: { id: string; role_name: string; company_name: string; expires_at: string }[];
  devMailbox: boolean;
  /** How account email reaches people here: a real service, the local simulated mailbox, or none. */
  emailChannel: 'email' | 'mailbox' | 'none';
}

const fetchMe = () => get<Me>('/auth/me');

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 30_000 });
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
  await post('/auth/signout').catch(() => {});
  qc.clear();
  qc.setQueryData(['me'], { user: null } as Me);
  try { localStorage.removeItem('rigo-last-company'); } catch { /* ignore */ }
}

export interface Capability { state: 'available' | 'simulated' | 'disabled'; reason: string }
export interface Boot {
  company: { id: string; name: string; kind: 'real' | 'demo'; timezone: string; currency: string; automation_mode: 'manual' | 'assisted' | 'automatic'; paused: boolean; branding: any; phone: string | null; email: string | null; address: string | null; service_categories: string[]; customFields: any; accent: { base: string | null; light: string; dark: string }; invoiceDueDays: number; paymentInstructions: string; invoicePrefix?: string; remitTo?: string; taxId?: string; invoice_seq?: number; invoiceApprovalRequired?: boolean; paused_at?: string | null; paused_by?: string | null };
  role: { key: string; name: string; isOwner: boolean; simulated: string | null };
  permissions: Permission[];
  capabilities: Record<'email' | 'sms' | 'ai' | 'payments' | 'maps' | 'fileStorage', Capability>;
  attention: { needs_action: number; warnings: number; unread: number };
  setup: null | { items: { key: string; label: string; done: boolean; required: boolean; link: string; note?: string }[]; ready: boolean; done: number; total: number; step: string; dismissed: boolean };
  demo: null | { guide: { step: number; dismissed: boolean }; simRole: string; progress: GuideProgress };
  members: { id: string; name: string; role_key: string }[];
  roles: { key: string; name: string; canApprove?: boolean }[];
  me: { id: string; actingUserId: string };
}

interface CompanyCtxValue extends Boot {
  cid: string;
  can: (p: Permission) => boolean;
  to: (path?: string) => string;
  refresh: () => void;
}
const Ctx = createContext<CompanyCtxValue | null>(null);

export function useCompanyBoot(cid: string) {
  return useQuery({ queryKey: [cid, 'boot'], queryFn: () => get<Boot>(`/c/${cid}`), staleTime: 15_000, refetchInterval: 60_000 });
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

/** Where to go after signing in: a same-site path from ?next=, otherwise the workspace list. */
export function safeNext(n: string | null | undefined) {
  return n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/workspaces';
}
