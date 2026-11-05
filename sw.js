// Network-first service worker: always fresh when online, still opens offline.
const CACHE = 'reviewer2-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './core.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Revalidate subresources with the server every time (a cheap 304 when unchanged).
  // Otherwise the HTTP cache (GitHub Pages: max-age=600) can pair a fresh index.html
  // with a stale app.js for ten minutes after a deploy. Navigation requests can't take
  // an init object, and browsers revalidate the page itself on reload anyway.
  const fresh = req.mode === 'navigate' ? fetch(req) : fetch(req, { cache: 'no-cache' });
  e.respondWith(
    fresh
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')),
      ),
  );
});
