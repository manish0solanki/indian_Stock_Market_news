const CACHE_NAME = 'mp-v2';
const SHELL = ['/','/index.html','/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // API/live data must always use the network.
  if (
    url.pathname.includes('/webhook') ||
    url.pathname.endsWith('.json') ||
    url.pathname.includes('/functions/')
  ) {
    e.respondWith(fetch(request));
    return;
  }

  // HTML pages must always use the network so deployments are reflected
  // immediately. This prevents stale portfolio.html from being served.
  if (
    request.mode === 'navigate' ||
    request.destination === 'document' ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/'
  ) {
    e.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(resp => resp)
        .catch(() => caches.match(request))
    );
    return;
  }

  // Other static assets can remain cache-first.
  e.respondWith(
    caches.match(request).then(cached => {
      return cached || fetch(request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return resp;
      });
    })
  );
});
