// MarketPulse service worker.
// Only same-origin files are handled here. Everything else (Supabase, the
// Cloudflare worker, Yahoo, CDNs) goes straight to the network so live data
// (news, prices, indices) is never served from a stale cache.
const CACHE_NAME = 'mp-v3'; // bumped: purges old caches that held stale API responses
const SHELL = ['/', '/index.html', '/manifest.json'];

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
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never touch cross-origin requests: let the browser fetch them normally.
  if (url.origin !== self.location.origin) return;

  // Live same-origin data: always network.
  if (
    url.pathname.includes('/webhook') ||
    url.pathname.endsWith('.json') ||
    url.pathname.includes('/functions/')
  ) {
    return;
  }

  // HTML pages: network first (so deployments show immediately), cache only when offline.
  if (
    request.mode === 'navigate' ||
    request.destination === 'document' ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/'
  ) {
    e.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() => caches.match(request))
    );
    return;
  }

  // Other same-origin static assets (icons, images): network first, cache as offline fallback.
  e.respondWith(
    fetch(request)
      .then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(request))
  );
});

// Price-alert notifications: focus the open tab, or open the site.
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
