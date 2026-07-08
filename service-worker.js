/* Makes the app open with zero internet after it's been installed once.
   Bump CACHE_NAME whenever any file in SHELL_FILES changes, so phones pick
   up the new version instead of serving a stale cached copy forever. */
const CACHE_NAME = 'sale-camp-shell-v1';
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
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
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
  // Only handle our own files. Supabase API/storage calls go straight to the
  // network — they're dynamic data, already handled by the app's own offline
  // sync queue, not something a cache should intercept.
  if (url.origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
