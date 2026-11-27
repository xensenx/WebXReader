import assert from 'node:assert/strict';
import { Blob as NodeBlob } from 'node:buffer';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');

const swPath = path.resolve(process.cwd(), 'public/sw.js');
const source = readFileSync(swPath, 'utf8');
const scope = 'https://reader.test/app/';
const entryLimit = 5 * 1024 * 1024;
const sizeHeader = 'X-WebXReader-Cache-Bytes';

function worker() {
  const listeners = {};
  const context = vm.createContext({
    URL, Request, Response, Headers, Blob: NodeBlob, console,
    self: { registration: { scope }, addEventListener: (name, callback) => { listeners[name] = callback; } },
  });
  vm.runInContext(source, context);
  return { context, listeners, run: (code) => vm.runInContext(code, context) };
}

function cacheFixture(count, bytes) {
  const entries = new Map(Array.from({ length: count }, (_, i) => [
    `${scope}${i === 0 ? 'index.html' : `assets/old-${i}.css`}`,
    new Response('', { headers: { [sizeHeader]: String(bytes) } }),
  ]));
  return {
    entries,
    async keys() { return [...entries.keys()].map((url) => new Request(url)); },
    async match(key) { return entries.get(key.url); },
    async delete(key) { return entries.delete(key.url); },
    async put(key, response) { entries.set(key.url, response); },
  };
}

for (const rejection of [false, true]) {
  test(`oversized copy returns promptly when cancellation ${rejection ? 'rejects' : 'stays pending'}`, async () => {
    const sw = worker();
    let cancelled = false;
    let released = false;
    sw.context.response = {
      status: 200, headers: new Headers(),
      clone: () => ({ body: { getReader: () => ({
        read: async () => ({ done: false, value: new Uint8Array(entryLimit + 1) }),
        cancel: () => {
          cancelled = true;
          return rejection ? Promise.reject(new Error('cancel failed')) : new Promise(() => {});
        },
        releaseLock: () => { released = true; },
      }) } }),
    };
    let timer;
    try {
      const result = await Promise.race([
        sw.run('copyResponseWithinLimit(response)'),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('copy stalled')), 1000); }),
      ]);
      assert.equal(result, undefined);
      assert.equal(cancelled, true);
      assert.equal(released, true);
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      clearTimeout(timer);
    }
  });
}

for (const [name, count, bytes] of [['entry count', 200, 1], ['total bytes', 13, entryLimit]]) {
  test(`concurrent writes respect ${name} and retain the offline index`, async () => {
    const sw = worker();
    const cache = cacheFixture(count, bytes);
    // Distinct handles to the same backing cache must share the queue.
    sw.context.handles = [{ ...cache }, { ...cache }, { ...cache }];
    sw.context.payload = new Uint8Array(bytes);
    const results = await sw.run(`Promise.all(handles.map((cache, i) =>
      cacheResponseWithinLimits(cache, '${scope}assets/new-' + i + '.css', new Response(payload))))`);
    assert.ok(results.every(Boolean));
    assert.ok(cache.entries.size <= 200);
    assert.ok([...cache.entries.values()].reduce((sum, response) => sum + Number(response.headers.get(sizeHeader)), 0) <= 64 * 1024 * 1024);
    assert.ok(cache.entries.has(`${scope}index.html`));
    for (let i = 0; i < 3; i++) assert.ok(cache.entries.has(`${scope}assets/new-${i}.css`));
  });
}

test('a failed cache write does not block the next write', async () => {
  const sw = worker();
  const cache = cacheFixture(0, 0);
  const put = cache.put;
  let attempts = 0;
  cache.put = async (...args) => {
    if (++attempts === 1) throw new Error('quota exceeded');
    return put(...args);
  };
  sw.context.cache = cache;
  const results = await sw.run(`Promise.all([0, 1].map((i) =>
    cacheResponseWithinLimits(cache, '${scope}assets/new-' + i + '.css', new Response('ok'))))`);
  assert.deepEqual(Array.from(results), [false, true]);
});

test('hashed JS bundles reach the shell handler while development modules bypass it', async () => {
  const sw = worker();
  const handled = [];
  sw.context.handled = handled;
  sw.run('handleShellAsset = async (request) => { handled.push(request.url); return new Response("bundle"); }');
  for (const path of ['assets/index-Ab12_cd3.js', 'assets/vendor-Ab12_cd3.mjs']) {
    let response;
    sw.listeners.fetch({ request: new Request(scope + path), respondWith: (value) => { response = value; } });
    assert.equal(await (await response).text(), 'bundle');
  }
  for (const path of ['src/main.js', '@vite/client', 'node_modules/.vite/deps/react.js', 'main.js', 'main.tsx', 'assets/index-Ab12_cd3.js?v=1', 'src/assets/index-Ab12_cd3.js']) {
    sw.listeners.fetch({ request: new Request(scope + path), respondWith: () => assert.fail(`intercepted ${path}`) });
  }
  assert.equal(handled.length, 2);
});

test('caches the deferred workspace and its styles without prefetching optional reader engines', async () => {
  const sw = worker();
  sw.context.fetch = async (url) => {
    if (url === scope + 'index.html') return new Response('<script src="assets/index-Ab12_cd3.js"></script>');
    assert.equal(url, scope + 'shell-manifest.json');
    return Response.json({
      'src/app/WorkspaceRoutes.tsx': {
        file: 'assets/WorkspaceRoutes-077fdb13.js', css: ['assets/WorkspaceRoutes-2476acde.css'],
        imports: ['_common'], dynamicImports: ['src/formats/engines/EpubReader.tsx'],
      },
      _common: {
        file: 'assets/common-45ab21ef.js', css: ['https://outside.test/assets/invalid-12345678.css'],
        imports: ['src/app/WorkspaceRoutes.tsx'],
      },
      'src/formats/engines/EpubReader.tsx': { file: 'assets/EpubReader-0112ccab.js' },
    });
  };
  const assets = Array.from(await sw.run('discoverShellAssets()'));
  for (const path of ['webxreader.svg', 'assets/index-Ab12_cd3.js', 'assets/WorkspaceRoutes-077fdb13.js',
    'assets/WorkspaceRoutes-2476acde.css', 'assets/common-45ab21ef.js']) assert.ok(assets.includes(scope + path));
  assert.ok(!assets.some((url) => url.includes('EpubReader') || url.includes('outside.test')));
});

test('serves a precached same-origin module when its request has an Origin header', async () => {
  const sw = worker();
  sw.context.caches = { open: async () => ({
    match: async (request, options) => {
      assert.equal(request.headers.get('origin'), new URL(scope).origin);
      return options?.ignoreVary ? new Response('cached module', { headers: { Vary: 'Origin' } }) : undefined;
    },
  }) };
  sw.context.fetch = () => { throw new Error('offline'); };
  const request = new Request(scope + 'assets/index-Ab12_cd3.js', { headers: { Origin: new URL(scope).origin } });
  let response;
  sw.listeners.fetch({ request, respondWith: (value) => { response = value; } });
  assert.equal(await (await response).text(), 'cached module');
});
