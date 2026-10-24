import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// Mock crypto.randomUUID and crypto.subtle if needed
if (!globalThis.crypto) {
  // @ts-expect-error Mocking crypto for test environment
  globalThis.crypto = {};
}

if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = () => '12345678-1234-4234-8234-123456789abc' as `${string}-${string}-${string}-${string}-${string}`;
}

if (!globalThis.crypto.subtle) {
  // @ts-expect-error Mocking crypto.subtle
  globalThis.crypto.subtle = {
    digest: async (_algorithm: string, data: ArrayBuffer) => {
      // Simple mock hash
      const buffer = new Uint8Array(32);
      const view = new Uint8Array(data);
      for (let i = 0; i < view.length; i++) {
        buffer[i % 32] = (buffer[i % 32] + view[i]) % 256;
      }
      return buffer.buffer;
    },
  };
}

// Polyfill Uint8Array.prototype.toHex and Uint8Array.fromHex for JSDOM
if (typeof Uint8Array !== 'undefined') {
  if (!(Uint8Array.prototype as any).toHex) {
    (Uint8Array.prototype as any).toHex = function () {
      let str = '';
      for (let i = 0; i < this.length; i++) {
        str += this[i].toString(16).padStart(2, '0');
      }
      return str;
    };
  }
  if (!(Uint8Array as any).fromHex) {
    (Uint8Array as any).fromHex = function (hex: string) {
      const bytes = new Uint8Array(Math.floor(hex.length / 2));
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
      }
      return bytes;
    };
  }
}

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
