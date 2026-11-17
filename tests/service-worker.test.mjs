import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const scope = 'https://reader.test/app/';
const entryLimit = 5 * 1024 * 1024;
const sizeHeader = 'X-WebXReader-Cache-Bytes';

function worker() {
  const listeners = {};
  const context = vm.createContext({
    URL, Request, Response, Headers, Blob, console,
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
