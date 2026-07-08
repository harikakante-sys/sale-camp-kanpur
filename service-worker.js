/* Makes the app open with zero internet after it's been installed once.
   Bump CACHE_NAME whenever a file is added to/removed from SHELL_FILES.
   index.html/pricing.js/manifest.json themselves are served network-first
   below (see fetch handler) specifically so an already-installed phone picks
   up a new deploy the next time it has internet, instead of staying stuck on
   whatever was cached the day it was installed — that was a real bug here:
   this cache was cache-first with a version string that was never bumped
   across several rounds of fixes, so none of them ever reached a phone that
   had already opened the app once. */
const CACHE_NAME = 'sale-camp-shell-v2';
const SHELL_FILES = [
  './',
  './index.html',
  './pricing.js',
  './manifest.json',
  './vendor/supabase-js.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only handle our own files. Supabase API/storage/Claude-proxy calls go
  // straight to the network — dynamic data, already handled by the app's own
  // offline sync queue, not something a cache should intercept.
  if (url.origin !== self.location.origin) return;

  // Network-first for the app shell itself — picks up a new deploy as soon
  // as the phone has internet again. Falls back to the cached copy only when
  // there's genuinely no connection (the offline-use case this cache exists for).
  const isShell = event.request.mode === 'navigate' ||
    ['/', '/index.html', '/pricing.js', '/manifest.json'].some(p => url.pathname.endsWith(p));
  if (isShell) {
    event.respondWith(
      fetch(event.request).then((resp) => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return resp;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for everything else (the vendored Supabase library, icons) —
  // these change rarely, so cache-first keeps the app fast and fully usable offline.
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
