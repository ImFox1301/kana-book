// Service worker KANA. VERSION и ASSETS подставляет build.py при каждой сборке.
const VERSION = '__VERSION__';
const CACHE = 'kana-' + VERSION;
const TTS_CACHE = 'tts-v2';   // не зависит от версии приложения — переживает обновления
const ASSETS = __ASSETS__;

self.addEventListener('install', event => {
  // cache: 'reload' — мимо HTTP-кэша браузера, иначе после обновления могли бы остаться старые файлы
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
});

// напоминания: сервер присылает { title, body, tag, url }
self.addEventListener('push', event => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch (e) { m = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(m.title || 'KANA', {
    body: m.body || 'Пора позаниматься', tag: m.tag || 'reminder', renotify: false,
    icon: 'icons/kana-icon-192.png', badge: 'icons/kana-icon-192.png', lang: 'ru', data: { url: m.url || '/' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find(c => c.url.startsWith(self.location.origin));
    // приложение уже открыто — показать нужный экран (например, заявку в друзья) без перезагрузки
    if (w) { await w.focus(); w.postMessage({ type: 'open', url }); return; }
    await self.clients.openWindow(url);
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if ((key.startsWith('kana-') && key !== CACHE) || (key.startsWith('tts-') && key !== TTS_CACHE)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/api/tts') {
    // озвучка своих слов: один раз с сервера, дальше из кэша — в том числе без сети
    event.respondWith(caches.open(TTS_CACHE).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.pathname.startsWith('/api/')) return;   // остальное API всегда идёт на сервер
  if (url.pathname.includes('/audio/words/')) {
    // озвучка слов: скачивается при первом прослушивании и остаётся в кэше текущей версии
    event.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (req.mode === 'navigate') {
    // страница всегда из кэша текущей версии: мгновенно и офлайн; новая версия приходит через обновление воркера
    event.respondWith(caches.match('./index.html', { cacheName: CACHE }).then(r => r || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then(r => r || fetch(req)));
});
