import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { makeT, pickLang, LANGS, isLang, type Lang } from '../../shared/i18n';
import { useMe } from './session';

// Which language a screen speaks (D8). The driver side, sign-in and invitations follow the person's
// choice (Account), else their device; office screens stay English for now and use the same t().

const LangContext = createContext<Lang>('en');
const KEY = 'rigo-lang';
const listeners = new Set<() => void>();

function readDeviceChoice(): Lang | null {
  try { const v = localStorage.getItem(KEY); return isLang(v) ? v : null; } catch { return null; }
}
/** Remember a language on this device (signed out, or before the account choice loads). */
export function setDeviceLang(lang: Lang | null) {
  try { if (lang) localStorage.setItem(KEY, lang); else localStorage.removeItem(KEY); } catch { /* storage off */ }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The person's language: their account choice, this device's choice, then the device language. */
export function usePersonLang(): Lang {
  const me = useMe();
  const device = useSyncExternalStore(subscribe, readDeviceChoice, () => null);
  const nav = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  return pickLang(me.data?.user?.language ?? device, nav);
}

/** Screens inside speak the person's language; the page's lang attribute follows for screen readers. */
export function PersonLanguage({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const person = usePersonLang();
  const lang = enabled ? person : 'en';
  useEffect(() => {
    const prev = document.documentElement.lang || 'en';
    document.documentElement.lang = lang;
    return () => { document.documentElement.lang = prev; };
  }, [lang]);
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useT() {
  const lang = useContext(LangContext);
  return useMemo(() => makeT(lang), [lang]);
}

/** "English · Español" on signed-out pages; signed-in people choose in Account. */
export function LanguageSwitch() {
  const t = useT();
  const me = useMe();
  if (me.data?.user) return null;
  return (
    <div className="lang-switch small" role="group" aria-label={`${t('ui.language')} / Language`}>
      {(Object.keys(LANGS) as Lang[]).map((l) => (
        <button key={l} type="button" className="link-button" lang={l} aria-pressed={t.lang === l} onClick={() => setDeviceLang(l)}>{LANGS[l]}</button>
      ))}
    </div>
  );
}
