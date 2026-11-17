// WebXReader Offline Application Shell Service Worker
const CACHE_PREFIX = 'webxreader-';
const CACHE_NAME = `${CACHE_PREFIX}shell-v6`;
const CACHE_SIZE_HEADER = 'X-WebXReader-Cache-Bytes';
const MAX_CACHE_ENTRY_BYTES = 5 * 1024 * 1024;
const MAX_CACHE_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 200;

const SHELL_FILES = new Set([
  'index.html',
  'apple-touch-icon.png',
  'favicon-48x48.png',
  'favicon-96x96.png',
  'favicon-192x192.png',
  'favicon-512x512.png',
  'favicon.ico',
  'favicon.png',
  'favicon.svg',
  'icons.svg',
  'manifest.json',
  'webxreader.svg',
  'covers/txt-default-cover.svg',
]);

const HASHED_ASSET_PATTERN = /^assets\/[a-z\d_.-]+-[a-z\d_-]{8,}\.(?:js|mjs|css|wasm|woff2?|ttf|otf|eot|svg|png|jpe?g|gif|webp|avif|ico)$/i;

function appUrl(path) {
  return new URL(path, self.registration.scope).toString();
}

function isWithinAppScope(url) {
  const scope = new URL(self.registration.scope);
  return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
}

function isKnownShellAsset(value) {
  const url = value instanceof URL ? value : new URL(value, self.registration.scope);
  if (!isWithinAppScope(url) || url.search || url.hash) return false;

  const scope = new URL(self.registration.scope);
  const relativePath = url.pathname.slice(scope.pathname.length);
  return relativePath === '' || SHELL_FILES.has(relativePath) || HASHED_ASSET_PATTERN.test(relativePath);
}

function isCacheableResponse(response) {
  if (!response || response.status !== 200 || response.type === 'opaque' || response.redirected) return false;
  if (!response.url) return true;

  try {
    return isWithinAppScope(new URL(response.url));
  } catch {
    return false;
  }
}

async function copyResponseWithinLimit(response) {
  if (!isCacheableResponse(response)) return undefined;

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CACHE_ENTRY_BYTES) return undefined;

  const body = response.clone().body;
  if (!body) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return { response: new Response(null, { status: 200, headers }), bytes: 0 };
  }

  const reader = body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytes += value.byteLength;
      if (bytes > MAX_CACHE_ENTRY_BYTES) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return {
    response: new Response(new Blob(chunks), { status: 200, headers }),
    bytes,
  };
}

async function cacheResponseWithinLimits(cache, cacheKey, response) {
  try {
    const bounded = await copyResponseWithinLimit(response);
    if (!bounded) return false;

    const request = cacheKey instanceof Request ? cacheKey : new Request(cacheKey);
    const existing = [];
    for (const key of await cache.keys()) {
      if (key.url === request.url) continue;

      const cached = await cache.match(key);
      const storedBytes = cached?.headers.get(CACHE_SIZE_HEADER);
      const bytes = storedBytes === null || storedBytes === undefined ? NaN : Number(storedBytes);
      if (!Number.isSafeInteger(bytes) || bytes < 0) {
        await cache.delete(key);
        continue;
      }
      existing.push({ request: key, bytes });
    }

    let totalBytes = existing.reduce((total, entry) => total + entry.bytes, 0);
    while (existing.length + 1 > MAX_CACHE_ENTRIES || totalBytes + bounded.bytes > MAX_CACHE_TOTAL_BYTES) {
      // Keep the offline app entry even when the cache has to evict other assets.
      const oldestIndex = existing.findIndex((entry) => entry.request.url !== appUrl('index.html'));
      if (oldestIndex < 0) return false;

      const [oldest] = existing.splice(oldestIndex, 1);
      await cache.delete(oldest.request);
      totalBytes -= oldest.bytes;
    }

    const headers = new Headers(bounded.response.headers);
    headers.set(CACHE_SIZE_HEADER, String(bounded.bytes));
    await cache.put(request, new Response(bounded.response.body, { status: 200, headers }));
    return true;
  } catch (error) {
    console.warn('[SW] Could not update the bounded shell cache:', error);
    return false;
  }
}

async function discoverShellAssets() {
  const indexUrl = appUrl('index.html');
  const response = await fetch(indexUrl, { cache: 'no-cache' });
  const boundedIndex = await copyResponseWithinLimit(response);
  if (!boundedIndex) throw new Error('Could not fetch a bounded application shell');

  const html = await boundedIndex.response.text();
  const assets = new Set([
    indexUrl,
    ...Array.from(SHELL_FILES, (path) => appUrl(path)).filter((url) => url !== indexUrl),
  ]);
  const assetPattern = /(?:src|href)=["']([^"']+)["']/g;
  let match;
  while ((match = assetPattern.exec(html)) !== null) {
    try {
      const url = new URL(match[1], indexUrl);
      if (isKnownShellAsset(url)) assets.add(url.toString());
    } catch {
      // Ignore malformed, cross-origin, or non-shell references.
    }
  }
  return [...assets].filter(isKnownShellAsset);
}

async function installShell() {
  const cache = await caches.open(CACHE_NAME);
  const indexUrl = appUrl('index.html');
  const assets = await discoverShellAssets();

  for (const assetUrl of assets) {
    try {
      const response = await fetch(assetUrl, { cache: 'no-cache' });
      const stored = await cacheResponseWithinLimits(cache, assetUrl, response);
      if (assetUrl === indexUrl && !stored) {
        throw new Error('The application shell exceeded its cache limit');
      }
    } catch (error) {
      if (assetUrl === indexUrl) throw error;
      console.warn('[SW] Skipping an unavailable shell asset:', assetUrl, error);
    }
  }
}

async function handleNavigation(request) {
  let cache;
  try {
    cache = await caches.open(CACHE_NAME);
  } catch {
    return fetch(request);
  }

  try {
    const response = await fetch(request);
    const contentType = response.headers.get('content-type') || '';
    if (contentType.toLowerCase().includes('text/html')) {
      await cacheResponseWithinLimits(cache, appUrl('index.html'), response);
    }
    return response;
  } catch {
    return (await cache.match(appUrl('index.html'))) || Response.error();
  }
}

async function handleShellAsset(request) {
  let cache;
  try {
    cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch {
    // Keep the network path available when Cache Storage is unavailable.
  }

  const response = await fetch(request);
  if (cache) await cacheResponseWithinLimits(cache, request, response);
  return response;
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(installShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isWithinAppScope(url)) return;

  // Development modules and Vite's HMR endpoints must always use the network.
  if (
    url.pathname.includes('/src/') ||
    url.pathname.includes('/@vite/') ||
    url.pathname.includes('/node_modules/.vite/') ||
    /\.(?:tsx?|jsx?)$/i.test(url.pathname)
  ) return;

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isKnownShellAsset(url)) {
    event.respondWith(handleShellAsset(request));
  }
});
