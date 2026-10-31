/**
 * DjVu document parser for WebXReader.
 * Uses djvu-rs WebAssembly engine and IFF chunk analysis to extract
 * metadata, bookmarks/outline, cover artwork, and text layers.
 */

import type { Chapter, BookMetadata } from '../../types/book';
import { generateId } from '../../utils';
import { ensureDjvuInitialized, WasmDocument } from './djvu-init';

export interface DjvuParseResult {
  metadata: Partial<BookMetadata>;
  tableOfContents: Chapter[];
  coverImage?: string;
  totalPages: number;
  rawText: string;
}

export interface DjvuParseOptions {
  /** Maximum pages to scan for text extraction (default: 200) */
  maxTextPages?: number;
}

/**
 * Extracts metadata from raw DjVu IFF chunks (e.g. ANTa annotation chunks).
 */
function extractIffMetadata(bytes: Uint8Array): Partial<BookMetadata> {
  const metadata: Partial<BookMetadata> = {};
  const len = bytes.length;
  let offset = 0;

  // Skip AT&T header if present
  if (
    len >= 4 &&
    bytes[0] === 0x41 &&
    bytes[1] === 0x54 &&
    bytes[2] === 0x26 &&
    bytes[3] === 0x54
  ) {
    offset = 4;
  }

  const decoder = new TextDecoder('utf-8', { fatal: false });

  // Scan for chunks
  while (offset + 8 <= len) {
    const chunkId = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
    const chunkLength =
      ((bytes[offset + 4] << 24) >>> 0) +
      (bytes[offset + 5] << 16) +
      (bytes[offset + 6] << 8) +
      bytes[offset + 7];

    if (chunkId === 'FORM') {
      // FORM chunk has a 4-byte secondary ID (e.g. DJVU or DJVM), then inner chunks
      offset += 12;
      continue;
    }

    const chunkDataOffset = offset + 8;
    const chunkDataEnd = Math.min(chunkDataOffset + chunkLength, len);

    if (chunkId === 'ANTa' || chunkId === 'ANNa') {
      try {
        const text = decoder.decode(bytes.subarray(chunkDataOffset, chunkDataEnd));
        const titleMatch = text.match(/\(\s*title\s+"([^"]+)"\s*\)/i);
        if (titleMatch && titleMatch[1]) {
          metadata.title = titleMatch[1].trim();
        }
        const authorMatch = text.match(/\(\s*author\s+"([^"]+)"\s*\)/i);
        if (authorMatch && authorMatch[1]) {
          metadata.author = authorMatch[1].trim();
        }
        const yearMatch = text.match(/\(\s*(?:year|date)\s+"([^"]+)"\s*\)/i);
        if (yearMatch && yearMatch[1]) {
          metadata.publicationDate = yearMatch[1].trim();
        }
        const descMatch = text.match(/\(\s*(?:comment|description|subject)\s+"([^"]+)"\s*\)/i);
        if (descMatch && descMatch[1]) {
          metadata.description = descMatch[1].trim();
        }
      } catch {
        // Ignore annotation decode errors
      }
    }

    // Advance to next chunk (chunks are padded to even 2-byte boundaries)
    const paddedLength = chunkLength + (chunkLength % 2);
    offset += 8 + paddedLength;
  }

  return metadata;
}

/**
 * Extracts bookmarks / table of contents from NAVM chunk if present.
 */
function extractIffBookmarks(bytes: Uint8Array, totalPages: number): Chapter[] {
  const chapters: Chapter[] = [];
  const len = bytes.length;
  let offset = 0;

  if (
    len >= 4 &&
    bytes[0] === 0x41 &&
    bytes[1] === 0x54 &&
    bytes[2] === 0x26 &&
    bytes[3] === 0x54
  ) {
    offset = 4;
  }

  const decoder = new TextDecoder('utf-8', { fatal: false });

  while (offset + 8 <= len) {
    const chunkId = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
    const chunkLength =
      ((bytes[offset + 4] << 24) >>> 0) +
      (bytes[offset + 5] << 16) +
      (bytes[offset + 6] << 8) +
      bytes[offset + 7];

    if (chunkId === 'FORM') {
      offset += 12;
      continue;
    }

    const chunkDataOffset = offset + 8;
    const chunkDataEnd = Math.min(chunkDataOffset + chunkLength, len);

    if (chunkId === 'NAVM' || chunkId === 'NAVI') {
      try {
        const navText = decoder.decode(bytes.subarray(chunkDataOffset, chunkDataEnd));
        // Matches entries like ("Title" "#5") or ("Title" "5")
        const regex = /\(\s*"([^"]+)"\s*"#?(\d+)"\s*\)/g;
        let match: RegExpExecArray | null;
        let order = 0;
        while ((match = regex.exec(navText)) !== null) {
          const title = match[1].trim();
          const pageNum = parseInt(match[2], 10);
          if (title && !isNaN(pageNum)) {
            chapters.push({
              id: generateId(),
              title,
              level: 0,
              order,
            });
            order++;
          }
        }
      } catch {
        // Fallback
      }
    }

    const paddedLength = chunkLength + (chunkLength % 2);
    offset += 8 + paddedLength;
  }

  // If no bookmarks were embedded, generate page-based chapters
  if (chapters.length === 0) {
    for (let i = 0; i < totalPages; i++) {
      chapters.push({
        id: generateId(),
        title: `Page ${i + 1}`,
        level: 0,
        order: i,
      });
    }
  }

  return chapters;
}

/**
 * Extracts a cover image thumbnail from the first page of the DjVu document.
 */
function extractCoverFromPage1(doc: WasmDocument): string | undefined {
  try {
    if (typeof document === 'undefined') return undefined;

    const pageCount = doc.page_count();
    if (pageCount === 0) return undefined;

    const page0 = doc.page(0);
    const nativeDpi = page0.dpi() || 100;
    const targetWidth = 360;
    const baseWidth = page0.width_at(nativeDpi) || 100;
    const scale = Math.min(2.0, Math.max(0.2, targetWidth / baseWidth));
    const targetDpi = Math.max(20, Math.round(nativeDpi * scale));

    const pixels = page0.render(targetDpi);
    const width = page0.width_at(targetDpi);
    const height = page0.height_at(targetDpi);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const imgData = new ImageData(pixels as any, width, height);
    ctx.putImageData(imgData, 0, 0);

    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (err) {
    console.warn('Could not extract DjVu cover thumbnail:', err);
    return undefined;
  }
}

/**
 * Parses a DjVu (.djvu, .djv) document buffer.
 */
export async function parseDjvu(
  data: ArrayBuffer | Uint8Array,
  options: DjvuParseOptions = {}
): Promise<DjvuParseResult> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (bytes.length < 8) {
    throw new Error('Not a valid DjVu file: file is smaller than DjVu header signature (8 bytes).');
  }

  // 1. Validate DjVu Header Signature (AT&T or FORM:DJVU / FORM:DJVM)
  const isAtAndT =
    bytes[0] === 0x41 &&
    bytes[1] === 0x54 &&
    bytes[2] === 0x26 &&
    bytes[3] === 0x54;

  const isForm =
    (bytes[0] === 0x46 && bytes[1] === 0x4f && bytes[2] === 0x52 && bytes[3] === 0x4d) ||
    (isAtAndT && bytes.length >= 8 && bytes[4] === 0x46 && bytes[5] === 0x4f && bytes[6] === 0x52 && bytes[7] === 0x4d);

  if (!isAtAndT && !isForm) {
    throw new Error('Not a valid DjVu file: missing AT&T/FORM DjVu header signature.');
  }

  // 2. Initialize WASM module and open document
  await ensureDjvuInitialized();

  let doc: WasmDocument;
  try {
    doc = WasmDocument.from_bytes(bytes);
  } catch (err) {
    throw new Error(`Failed to parse DjVu file: ${err instanceof Error ? err.message : String(err)}`);
  }

  const totalPages = doc.page_count();
  if (totalPages === 0) {
    throw new Error('Invalid DjVu file: document contains 0 pages.');
  }

  // 3. Extract IFF metadata (annotations) and bookmarks
  const metadata = extractIffMetadata(bytes);
  const tableOfContents = extractIffBookmarks(bytes, totalPages);

  // 4. Extract cover image thumbnail from page 1
  const coverImage = extractCoverFromPage1(doc);

  // 5. Extract text layers for full-text search
  const maxScan = options.maxTextPages ?? 200;
  const scanLimit = Math.min(totalPages, maxScan);
  const textParts: string[] = [];

  for (let i = 0; i < scanLimit; i++) {
    try {
      const page = doc.page(i);
      const txt = page.text();
      if (txt && txt.trim()) {
        textParts.push(txt.trim());
      }
    } catch {
      // Non-critical: some pages may lack text layers
    }
  }

  const rawText = textParts.join('\n\n');

  return {
    metadata,
    tableOfContents,
    coverImage,
    totalPages,
    rawText,
  };
}
