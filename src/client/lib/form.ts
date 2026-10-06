import { useState, useCallback } from 'react';
import { ApiError } from './api';

/** Submission state for a form: busy flag, the last ApiError, and per-field errors. */
export function useSubmit<A extends unknown[], T>(fn: (...args: A) => Promise<T>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useCallback(async (...args: A): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try { return await fn(...args); }
    catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'error', (e as Error)?.message ?? 'Something went wrong.'));
      return undefined;
    } finally { setBusy(false); }
  }, [fn]);
  const fieldError = (k: string) => error?.fields?.[k];
  return { run, busy, error, setError, fieldError };
}
