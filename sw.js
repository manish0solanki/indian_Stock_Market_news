const CACHE_NAME = 'mp-v1';
const SHELL = ['/','/index.html','/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // API calls: network only (don't cache live data)
  if (url.pathname.includes('/webhook') || url.pathname.endsWith('.json')) {
    e.respondWith(fetch(request));
    return;
  }

  // Shell assets: cache first
  e.respondWith(
    caches.match(request).then(cached => {
      return cached || fetch(request).then(resp => {
        if (resp.ok && request.method === 'GET') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return resp;
      });
    })
  );
});sw.js
