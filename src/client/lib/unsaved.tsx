import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { Button, Dialog } from '../components/ui';

/**
 * Warn before leaving a screen with unsaved changes: in-app navigation shows a dialog (Save, Discard
 * or Keep editing); closing or reloading the tab uses the browser's own prompt.
 */
export function useUnsavedGuard(dirty: boolean, opts: { message: string; onSave?: () => Promise<boolean>; ignoreSearch?: boolean }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && (currentLocation.pathname !== nextLocation.pathname || (!opts.ignoreSearch && currentLocation.search !== nextLocation.search)));
  const [saving, setSaving] = useState(false);
  // The latest blocker: saving is async, and proceed/reset are only valid while it is still blocked.
  const latest = useRef(blocker);
  latest.current = blocker;
  const proceed = () => { if (latest.current.state === 'blocked') latest.current.proceed(); };
  const reset = () => { if (latest.current.state === 'blocked') latest.current.reset(); };
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = opts.message; return opts.message; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty, opts.message]);
  const open = blocker.state === 'blocked';
  const node = (
    <Dialog open={open} onClose={reset} title="Leave without saving?"
      footer={<>
        <Button onClick={reset}>Keep editing</Button>
        <Button variant="danger" onClick={proceed}>Discard changes</Button>
        {opts.onSave ? <Button variant="primary" busy={saving} onClick={async () => { setSaving(true); const ok = await opts.onSave!().catch(() => false); setSaving(false); if (ok) proceed(); else reset(); }}>Save</Button> : null}
      </>}>
      <p>{opts.message}</p>
    </Dialog>
  );
  return node;
}

/**
 * Several editable sections on one page share one guard (React Router allows one blocker at a time):
 * each section reports whether it has unsaved changes, and the page guards when any does.
 */
export function useDirtySet() {
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const report = useCallback((key: string, value: boolean) => setDirty((d) => (d[key] === value ? d : { ...d, [key]: value })), []);
  return { any: Object.values(dirty).some(Boolean), report };
}

/** A section tells its page whether it has unsaved changes. */
export function useReportDirty(report: ((key: string, v: boolean) => void) | undefined, key: string, dirty: boolean) {
  useEffect(() => { report?.(key, dirty); }, [report, key, dirty]);
  useEffect(() => () => report?.(key, false), [report, key]);
}
