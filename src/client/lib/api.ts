// Thin fetch wrapper. Every request carries the CSRF header; errors carry field details for forms.

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: any = null) { super(message); }
  get fields(): Record<string, string> { return this.details?.fields ?? {}; }
  get missing(): string[] { return this.details?.missing ?? []; }
}

export const OFFLINE = 'offline';

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET'),
      headers: init.form ? { 'x-rigo': '1' } : { 'content-type': 'application/json', 'x-rigo': '1' },
      body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
      credentials: 'same-origin',
      signal: init.signal,
    });
  } catch (e) {
    if ((e as any)?.name === 'AbortError') throw e;
    throw new ApiError(0, OFFLINE, 'You appear to be offline. Check your connection and try again.');
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'error', err.message ?? `Request failed (${res.status}).`, err.details ?? null);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body });
export const patch = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: 'PATCH', body });
export const put = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: 'PUT', body });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });

export function newId(prefix = 'req') {
  return `${prefix}-${crypto.randomUUID()}`;
}
