// Polyfill Uint8Array.prototype.toHex and Uint8Array.fromHex if not supported by runtime
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

import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export { pdfjsLib };
