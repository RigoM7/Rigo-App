export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'rigo-theme';

export function readThemePref(): ThemePref {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark' || v === 'system') return v; } catch { /* storage unavailable */ }
  return 'light';
}

let mq: MediaQueryList | null = null;
function resolved(pref: ThemePref) {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(pref: ThemePref) {
  try { localStorage.setItem(KEY, pref); } catch { /* ignore */ }
  document.documentElement.dataset.theme = resolved(pref);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved(pref) === 'dark' ? '#050506' : '#0A0A0B');
  mq?.removeEventListener('change', onSystem);
  if (pref === 'system') {
    mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', onSystem);
  }
}
function onSystem() { applyTheme('system'); }
