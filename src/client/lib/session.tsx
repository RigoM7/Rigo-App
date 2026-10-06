import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get } from './api';
import type { Permission } from '../../shared/permissions';
import { applyTheme, type ThemePref } from './theme';

export interface Me {
  user: { id: string; email: string; name: string; theme: ThemePref } | null;
  companies: { id: string; name: string; kind: 'real' | 'demo'; role_key: string; role_name: string; is_owner: boolean; branding: any; setup_completed_at: string | null }[];
  invitations: { id: string; role_name: string; company_name: string; expires_at: string }[];
  devMailbox: boolean;
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => get<Me>('/auth/me'), staleTime: 30_000 });
}

export interface Capability { state: 'available' | 'simulated' | 'disabled'; reason: string }
export interface Boot {
  company: { id: string; name: string; kind: 'real' | 'demo'; timezone: string; currency: string; automation_mode: 'manual' | 'assisted' | 'automatic'; paused: boolean; branding: any; phone: string | null; email: string | null; address: string | null; service_categories: string[]; customFields: any; accent: { base: string | null; light: string; dark: string } };
  role: { key: string; name: string; isOwner: boolean; simulated: string | null };
  permissions: Permission[];
  capabilities: Record<'email' | 'sms' | 'ai' | 'payments' | 'maps' | 'fileStorage', Capability>;
  attention: { needs_action: number; warnings: number; unread: number };
  setup: null | { items: { key: string; label: string; done: boolean; required: boolean; link: string; note?: string }[]; ready: boolean; done: number; total: number; step: string; dismissed: boolean };
  demo: null | { guide: { step: number; dismissed: boolean }; simRole: string };
  members: { id: string; name: string; role_key: string }[];
  roles: { key: string; name: string }[];
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

export function useApplyUserTheme(pref: ThemePref | undefined) {
  useEffect(() => { if (pref) applyTheme(pref); }, [pref]);
}
