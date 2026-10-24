// WebXReader Offline Application Shell Service Worker
const CACHE_NAME = 'webxreader-shell-v4';

function appUrl(path) {
  return new URL(path, self.registration.scope).toString();
}

async function discoverShellAssets() {
  const indexUrl = appUrl('index.html');
  const response = await fetch(indexUrl, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Could not fetch application shell (${response.status})`);

  const html = await response.text();
  const assets = new Set([indexUrl, appUrl('favicon.svg'), appUrl('manifest.json')]);
  const assetPattern = /(?:src|href)=["']([^"']+)["']/g;
  let match;
  while ((match = assetPattern.exec(html)) !== null) {
    const value = match[1];
    if (!value || value.startsWith('http') || value.startsWith('//') || value.startsWith('#')) continue;
    assets.add(new URL(value, indexUrl).toString());
  }
  return [...assets];
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    discoverShellAssets().then((assets) => caches.open(CACHE_NAME).then((cache) => cache.addAll(assets)))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) return;

  // Development modules and styles must never be served from an old cache.
  if (url.pathname.includes('/src/') ||
      url.pathname.endsWith('.tsx') ||
      url.pathname.endsWith('.ts') ||
      url.pathname.endsWith('.css')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // For HTML documents / page navigations: Network First, fallback to cached HTML
  if (
    event.request.mode === 'navigate' ||
    event.request.destination === 'document' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html')
  ) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            return cached || caches.match(appUrl('index.html'));
          });
        })
    );
    return;
  }

  // For hashed assets and other static resources: Cache First, fallback to network
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      });
    })
  );
});
