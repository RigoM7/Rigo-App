/* Rigo service worker: lets the installed app open without a connection and meets app-store
   packaging checks. It only keeps the app's own files. Company data, sign-in and every other
   site are never cached or touched: /api/ and other origins go straight to the network.
   Files are fetched fresh first, so a new deployment is used as soon as it is online. */
const VERSION = '__RIGO_BUILD__';
const CACHE = 'rigo-shell-' + VERSION;
const SHELL = ['/', '/rigo-access.js', '/rigo-ops.js', '/rigo-access.css', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('rigo-shell-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const isPage = request.mode === 'navigate';
  if (!isPage && !SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(isPage ? '/' : request, copy));
    }
    return response;
  }).catch(() => caches.match(isPage ? '/' : request).then(hit => hit || new Response('Rigo is offline. Reconnect to continue.', { status: 503, headers: { 'Content-Type': 'text/plain' } }))));
});
