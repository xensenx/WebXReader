/**
 * Initialization and WebAssembly loader for 7z-wasm.
 * Supports both browser environments (via Vite URL bundling) and
 * Node.js / Vitest test environments (via direct file buffer loading).
 */

import SevenZipFactory, { type SevenZipModule } from '7z-wasm';

let wasmBinaryPromise: Promise<ArrayBuffer> | null = null;

export async function getSevenZipWasmBinary(): Promise<ArrayBuffer> {
  if (wasmBinaryPromise) {
    return wasmBinaryPromise;
  }

  wasmBinaryPromise = (async () => {
    // If running in Node.js (including Vitest jsdom test runner)
    if (typeof process !== 'undefined' && Boolean(process.versions?.node)) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const wasmPath = path.resolve(process.cwd(), 'node_modules/7z-wasm/7zz.wasm');
        if (fs.existsSync(wasmPath)) {
          const buffer = fs.readFileSync(wasmPath);
          return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        }
      } catch (nodeErr) {
        console.warn('Failed to load Node-specific wasm for 7z-wasm, falling back to fetch:', nodeErr);
      }
    }

    // Standard browser init (fetch via Vite resolved asset URL)
    const wasmUrl = (await import('7z-wasm/7zz.wasm?url')).default;
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch 7zz.wasm: ${response.status} ${response.statusText}`);
    }
    return await response.arrayBuffer();
  })();

  return wasmBinaryPromise;
}

export async function createSevenZipInstance(): Promise<SevenZipModule> {
  const wasmBinary = await getSevenZipWasmBinary();
  const module = await SevenZipFactory({
    wasmBinary,
    print: () => {},
    printErr: (msg: string) => {
      if (!msg.includes('Everything is Ok')) {
        console.warn('[7z-wasm]:', msg);
      }
    },
  });
  return module;
}

export type { SevenZipModule };
