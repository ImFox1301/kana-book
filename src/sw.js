// Service worker Кана-тетради. VERSION и ASSETS подставляет build.py при каждой сборке.
const VERSION = '__VERSION__';
const CACHE = 'kana-' + VERSION;
const ASSETS = __ASSETS__;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('kana-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;   // API всегда идёт на сервер
  if (req.mode === 'navigate') {
    // страница всегда из кэша текущей версии: мгновенно и офлайн; новая версия приходит через обновление воркера
    event.respondWith(caches.match('./index.html', { cacheName: CACHE }).then(r => r || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then(r => r || fetch(req)));
});
