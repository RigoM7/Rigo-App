import { createHash, randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import { z, type ZodType } from 'zod';
import { badRequest, zodFields } from '../http/errors.js';

export const token = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function body<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try { raw = await c.req.json(); } catch { throw badRequest('Request body must be JSON.'); }
  const r = schema.safeParse(raw);
  if (!r.success) throw badRequest('Some information needs attention.', { fields: zodFields(r.error) });
  return r.data;
}

export function normEmail(e: string) { return e.trim().toLowerCase(); }

export function pick<T extends object, K extends keyof T>(o: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = o[k];
  return out;
}

/** `limit` (1..max, default max) and `offset` (0..100000) from a query string, never trusted as SQL. */
export function paging(limit: string | undefined, offset: string | undefined, max: number) {
  const l = Math.floor(Number(limit));
  const o = Math.floor(Number(offset));
  return { limit: Number.isFinite(l) && l >= 1 ? Math.min(l, max) : max, offset: Number.isFinite(o) && o > 0 ? Math.min(o, 100_000) : 0 };
}

/**
 * Every field optional and with no defaults, for partial updates. (zod's own .partial() keeps
 * defaults, which would quietly reset fields the request didn't mention.)
 */
export function patchSchema<T extends z.ZodRawShape>(schema: z.ZodObject<T>): z.ZodType<Partial<z.output<z.ZodObject<T>>>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [k, v] of Object.entries(schema.shape)) {
    let t: any = v;
    while (t instanceof z.ZodDefault) t = t.unwrap();
    shape[k] = t.optional();
  }
  return z.object(shape) as any;
}
