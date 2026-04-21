/* NRMAi Order Portal — Service Worker v2 (NRMAi brand)
   - Caches the app shell for fast, reliable loading.
   - Network-first for same-origin GETs so deploys land immediately.
   - Passes through Apps Script + Drive requests without touching them,
     so passcode / catalogue / order calls always hit live data.
*/
const VERSION = 'nrmai-portal-v3-2026-04-21-blue';
const APP_SHELL = [
  './',
  './index.html',
  './brand.css',
  './logo.svg',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

const PASSTHROUGH_HOSTS = [
  'script.google.com',
  'script.googleusercontent.com',
  'drive.google.com',
  'googleusercontent.com'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION).then(cache => cache.addAll(APP_SHELL)).catch(() => {})
  );
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

  // Don't cache or intercept backend / image hosts.
  if (PASSTHROUGH_HOSTS.some(h => url.hostname.endsWith(h))) return;

  event.respondWith(
    fetch(req).then(res => {
      if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
