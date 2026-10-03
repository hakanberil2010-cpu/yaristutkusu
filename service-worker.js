// Authenticated data (Supabase, API and cross-origin) is NEVER cached.
const CACHE = 'yaristutkusu-shell-v17';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/config.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
const SAFE = new Set(SHELL);
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
    self.clients.claim(),
  ]));
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !SAFE.has(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
