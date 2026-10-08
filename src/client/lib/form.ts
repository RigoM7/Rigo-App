import { useCallback, useState } from 'react';
import { ApiError } from './api';

/** Runs a form action once at a time, keeping the error for the form to show. */
export function useSubmit<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useCallback(async (...args: A) => {
    if (busy) return false;
    setBusy(true); setError(null);
    try { await fn(...args); return true; } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'error', (e as Error).message ?? 'Something went wrong.'));
      return false;
    } finally { setBusy(false); }
  }, [fn, busy]);
  const fieldError = (k: string) => error?.fields[k] ?? error?.fields[`fields.${k}`] ?? null;
  return { busy, error, run, fieldError, setError };
}
