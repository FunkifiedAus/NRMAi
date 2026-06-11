/* NRMAi Order Portal — Service Worker
   - Caches the app shell for fast, reliable loading.
   - Network-first (with a short timeout) for same-origin GETs so
     deploys land immediately but stalled Wi-Fi falls back to cache.
   - Passes through Apps Script / Worker / Drive requests untouched,
     so passcode / catalogue / order calls always hit live data.
*/
const VERSION = 'nrmai-portal-v30-2026-06-11-hardening';

// Same-origin shell files: if these fail to precache, fail the
// install (keeps the previous good cache alive) rather than silently
// activating with an empty cache.
const APP_SHELL = [
  './',
  './index.html',
  './brand.css',
  './logo.svg',
  './manifest.json',
  './apple-touch-icon.png'
];
// Cross-origin extras are best-effort — a fonts hiccup shouldn't
// block a deploy.
const APP_SHELL_OPTIONAL = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

const PASSTHROUGH_HOSTS = [
  'script.google.com',
  'script.googleusercontent.com',
  'drive.google.com',
  'googleusercontent.com',
  // The Cloudflare Worker proxy — API traffic must never be cached.
  'workers.dev'
];

// How long to wait for the network before serving the cached shell.
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION).then(cache =>
      cache.addAll(APP_SHELL).then(() =>
        Promise.all(APP_SHELL_OPTIONAL.map(u => cache.add(u).catch(() => {})))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== VERSION).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // POSTs (order submissions) go straight to the network.
  if (req.method !== 'GET') return;

  // Don't cache or intercept backend / proxy / image hosts.
  if (PASSTHROUGH_HOSTS.some(h => url.hostname.endsWith(h))) return;

  // Network-first with a timeout: on stalled (not dead) Wi-Fi the
  // bare fetch would hang forever and the app would never paint —
  // race it against the cache so the shell always loads.
  event.respondWith((async () => {
    const cached = caches.match(req);
    try {
      const res = await Promise.race([
        fetch(req),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('sw-timeout')), NETWORK_TIMEOUT_MS))
      ]);
      if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (_) {
      const hit = await cached;
      if (hit) return hit;
      // Only fall back to index.html for page navigations — handing
      // HTML to a CSS/image request just breaks it a second way.
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
