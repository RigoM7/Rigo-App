import { getRequestListener } from '@hono/node-server';
import { createApp } from './http/app.js';

// Vercel entry: every /api/* request is routed here with the original path in `__path`.
const app = createApp();
const listener = getRequestListener(app.fetch);

export default function handler(req: any, res: any) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.searchParams.get('__path');
  if (path !== null) {
    url.searchParams.delete('__path');
    req.url = `/api/${path}${url.search}`;
  }
  return listener(req, res);
}
