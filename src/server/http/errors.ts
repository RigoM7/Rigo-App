import type { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'bad_request', msg, details);
export const forbidden = (msg = 'You do not have permission to do that.') => new HttpError(403, 'forbidden', msg);
export const notFound = (what = 'That record') => new HttpError(404, 'not_found', `${what} was not found.`);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, 'conflict', msg, details);
export const unauthorized = () => new HttpError(401, 'unauthorized', 'Please sign in.');

/** Field-level errors keyed by dotted path, for inline form errors and error summaries. */
export function zodFields(err: ZodError) {
  const fields: Record<string, string> = {};
  for (const i of err.issues) {
    const k = i.path.join('.') || '_';
    if (!fields[k]) fields[k] = i.message;
  }
  return fields;
}
