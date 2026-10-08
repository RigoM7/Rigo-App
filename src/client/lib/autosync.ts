import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { syncPending, nextDelay, onDraftsChanged, type SyncSummary } from './offline';
import { useToast } from '../components/ui';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function syncSummaryText(s: SyncSummary) {
  const parts: string[] = [];
  if (s.sent) parts.push(`${plural(s.sent, 'update', 'updates')} sent.`);
  if (s.attention) parts.push(`${plural(s.attention, 'record needs', 'records need')} your attention.`);
  if (s.waiting) parts.push(`${plural(s.waiting, 'is', 'are')} still waiting for signal.`);
  return parts.join(' ');
}

/**
 * Sends saved records without the worker having to do anything: on start, when signal
 * returns, when the app comes back to the front, and on a backoff timer while something is waiting.
 * One summary toast per run that sent anything.
 */
export function useAutoSync(uid: string, cid: string, enabled: boolean) {
  const qc = useQueryClient();
  const toast = useToast();
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const later = (ms: number) => { if (timer) clearTimeout(timer); timer = setTimeout(run, ms); };
    async function run() {
      if (timer) { clearTimeout(timer); timer = null; }
      const s = await syncPending(uid, cid).catch(() => null);
      if (!alive || !s) return;
      if (s.sent || s.attention) {
        toast(syncSummaryText(s), s.attention ? 'error' : 'success');
        qc.invalidateQueries({ queryKey: [cid] });
      }
      if (s.waiting) later(nextDelay(attempt++));
      else attempt = 0;
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void run(); };
    const onOnline = () => { attempt = 0; void run(); };
    void run();
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    // A record submitted with no signal starts the timer too.
    const stop = onDraftsChanged(() => { if (!timer) later(nextDelay(0)); });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      stop();
    };
  }, [uid, cid, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
