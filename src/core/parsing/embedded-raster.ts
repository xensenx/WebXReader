import { bytesToBase64, ZIP_LIMITS } from './zip-budget';

export function detectRasterMimeType(bytes: Uint8Array): string | undefined {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && ascii(1, 8) === 'PNG\r\n\x1a\n') return 'image/png';
  if (/^GIF8[79]a$/.test(ascii(0, 6))) return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && /avif|avis/.test(ascii(8, 36))) return 'image/avif';
  if (ascii(0, 2) === 'BM') return 'image/bmp';
  return undefined;
}

export function embeddedRasterUrl(bytes: Uint8Array | null): string | undefined {
  if (!bytes || bytes.length > ZIP_LIMITS.coverBytes) return undefined;
  const mime = detectRasterMimeType(bytes);
  return mime ? `data:${mime};base64,${bytesToBase64(bytes)}` : undefined;
}
