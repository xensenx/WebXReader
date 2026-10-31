/**
 * Initialization and WebAssembly loader for djvu-rs.
 * Supports both browser environments (via Vite URL bundling) and
 * Node.js / Vitest test environments (via direct file buffer loading).
 */

import init, {
  WasmDocument,
  WasmPage,
  WasmPixmap,
  wasmSimd128Supported,
} from 'djvu-rs';

let initPromise: Promise<void> | null = null;

export async function ensureDjvuInitialized(): Promise<void> {
  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    // If running in Node.js (including Vitest jsdom test runner)
    if (typeof process !== 'undefined' && Boolean(process.versions?.node)) {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const isSimd = wasmSimd128Supported();
        const variant = isSimd ? 'simd128' : 'scalar';
        const wasmPath = path.resolve(process.cwd(), 'node_modules/djvu-rs', variant, 'djvu_rs_bg.wasm');
        if (fs.existsSync(wasmPath)) {
          const wasmBytes = fs.readFileSync(wasmPath);
          await init(wasmBytes);
          return;
        }
      } catch (nodeErr) {
        console.warn('Failed to load Node-specific wasm for djvu-rs, falling back to standard init:', nodeErr);
      }
    }

    // Standard browser init (uses djvu-rs's built-in variant selector and wasm loader)
    await init();
  })();

  await initPromise;
}

export { WasmDocument, WasmPage, WasmPixmap, wasmSimd128Supported };
