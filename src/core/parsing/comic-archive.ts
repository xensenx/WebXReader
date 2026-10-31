/**
 * Shared comic book archive utilities for WebXReader.
 * Supports CBZ (ZIP), CBR (RAR), and CB7 (7-Zip).
 */

import type { Chapter, BookMetadata } from '../../types/book';
import { generateId } from '../../utils';

export interface ComicInfoBookmark {
  imageIndex: number;
  bookmark: string;
}

export interface ComicParseResult {
  metadata: Partial<BookMetadata>;
  tableOfContents: Chapter[];
  coverImage?: string;
  totalPages: number;
  readingDirection?: 'ltr' | 'rtl';
  pageFileNames: string[];
}

/** Recognized image extensions */
export const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'avif',
  'bmp',
]);

/**
 * Checks if a filename has an image extension.
 */
export function isImageFileName(filename: string): boolean {
  const parts = filename.toLowerCase().split('.');
  if (parts.length < 2) return false;
  const ext = parts[parts.length - 1];
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Gets MIME type for an image filename.
 */
export function getImageMimeType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'avif':
      return 'image/avif';
    case 'bmp':
      return 'image/bmp';
    default:
      return 'image/jpeg';
  }
}

/**
 * Checks if a zip or archive entry should be ignored (system metadata, macOS resource forks, hidden files).
 */
export function shouldIgnoreEntry(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const segments = normalized.split('/');

  for (const segment of segments) {
    if (
      segment.startsWith('__MACOSX') ||
      segment.startsWith('.') ||
      segment === 'Thumbs.db' ||
      segment === 'desktop.ini' ||
      segment.startsWith('._')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Natural sorting comparison for filenames (e.g. "page2.jpg" before "page10.jpg").
 */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Safely parses XML text using browser DOMParser or regex fallback in node/test environments.
 */
function parseXmlDocument(xmlText: string): Document | null {
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'application/xml');
      const parserError = doc.querySelector('parsererror');
      if (!parserError) return doc;
    } catch {
      // Fallback to regex
    }
  }
  return null;
}

/**
 * Helper to extract text of a tag from an XML Document or string.
 */
function getXmlTagValue(doc: Document | null, xmlText: string, tagName: string): string | undefined {
  if (doc) {
    const el = doc.querySelector(tagName);
    if (el && el.textContent) {
      const trimmed = el.textContent.trim();
      if (trimmed) return trimmed;
    }
  }

  // Regex fallback for non-DOM or malformed XML environments
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = xmlText.match(regex);
  if (match && match[1]) {
    const val = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim();
    if (val) return val;
  }
  return undefined;
}

/**
 * Parses ComicInfo.xml metadata.
 */
export function parseComicInfoXml(xmlText: string): {
  metadata: Partial<BookMetadata>;
  readingDirection?: 'ltr' | 'rtl';
  coverImageIndex?: number;
  bookmarks: ComicInfoBookmark[];
} {
  const metadata: Partial<BookMetadata> = {};
  let readingDirection: 'ltr' | 'rtl' | undefined;
  let coverImageIndex: number | undefined;
  const bookmarks: ComicInfoBookmark[] = [];

  try {
    const doc = parseXmlDocument(xmlText);

    const title = getXmlTagValue(doc, xmlText, 'Title');
    const series = getXmlTagValue(doc, xmlText, 'Series');
    const number = getXmlTagValue(doc, xmlText, 'Number');
    const volume = getXmlTagValue(doc, xmlText, 'Volume');
    const summary = getXmlTagValue(doc, xmlText, 'Summary') || getXmlTagValue(doc, xmlText, 'Notes');
    const writer = getXmlTagValue(doc, xmlText, 'Writer');
    const penciller = getXmlTagValue(doc, xmlText, 'Penciller');
    const inker = getXmlTagValue(doc, xmlText, 'Inker');
    const colorist = getXmlTagValue(doc, xmlText, 'Colorist');
    const publisher = getXmlTagValue(doc, xmlText, 'Publisher');
    const year = getXmlTagValue(doc, xmlText, 'Year');
    const month = getXmlTagValue(doc, xmlText, 'Month');
    const day = getXmlTagValue(doc, xmlText, 'Day');
    const language = getXmlTagValue(doc, xmlText, 'LanguageISO');
    const mangaTag = getXmlTagValue(doc, xmlText, 'Manga');

    // Title construction: "Series #Number - Title" or "Series #Number" or "Title"
    if (series) {
      let fullTitle = series;
      if (volume) fullTitle += ` Vol. ${volume}`;
      if (number) fullTitle += ` #${number}`;
      if (title && title !== number && title !== series) fullTitle += `: ${title}`;
      metadata.title = fullTitle;
    } else if (title) {
      metadata.title = title;
    }

    // Authors aggregation
    const authors: string[] = [];
    if (writer) authors.push(writer);
    if (penciller && penciller !== writer) authors.push(`${penciller} (Art)`);
    else if (inker && inker !== writer) authors.push(`${inker} (Inks)`);
    else if (colorist && colorist !== writer) authors.push(`${colorist} (Colors)`);

    if (authors.length > 0) {
      metadata.author = authors.join(', ');
    }

    if (summary) metadata.description = summary;
    if (publisher) metadata.publisher = publisher;
    if (language) metadata.language = language;

    // Publication date
    if (year) {
      let dateStr = year;
      if (month) dateStr += `-${month.padStart(2, '0')}`;
      if (day) dateStr += `-${day.padStart(2, '0')}`;
      metadata.publicationDate = dateStr;
    }

    // Manga / reading direction
    if (mangaTag) {
      const lower = mangaTag.toLowerCase();
      if (lower === 'yesandrighttoleft' || lower === 'yes') {
        readingDirection = 'rtl';
      } else if (lower === 'no') {
        readingDirection = 'ltr';
      }
    }

    // Parse <Pages> elements for bookmarks and FrontCover
    if (doc) {
      const pageElements = doc.querySelectorAll('Page');
      pageElements.forEach((pageEl) => {
        const imageAttr = pageEl.getAttribute('Image');
        const typeAttr = pageEl.getAttribute('Type');
        const bookmarkAttr = pageEl.getAttribute('Bookmark');

        const imageIndex = imageAttr !== null ? parseInt(imageAttr, 10) : NaN;
        if (!isNaN(imageIndex)) {
          if (typeAttr && typeAttr.toLowerCase() === 'frontcover') {
            coverImageIndex = imageIndex;
          }
          if (bookmarkAttr && bookmarkAttr.trim()) {
            bookmarks.push({ imageIndex, bookmark: bookmarkAttr.trim() });
          }
        }
      });
    }
  } catch (err) {
    console.warn('Could not parse ComicInfo.xml:', err);
  }

  return { metadata, readingDirection, coverImageIndex, bookmarks };
}

/**
 * Builds table of contents chapters from bookmarks, directory folders, or page numbers.
 */
export function buildTableOfContents(
  pageNames: string[],
  bookmarks: ComicInfoBookmark[]
): Chapter[] {
  const totalPages = pageNames.length;
  const tableOfContents: Chapter[] = [];

  // 1. If ComicInfo bookmarks exist, use them
  if (bookmarks.length > 0) {
    const sortedBookmarks = [...bookmarks].sort((a, b) => a.imageIndex - b.imageIndex);
    let order = 0;
    for (const bm of sortedBookmarks) {
      const pageNum = bm.imageIndex + 1;
      if (pageNum >= 1 && pageNum <= totalPages) {
        tableOfContents.push({
          id: generateId(),
          title: bm.bookmark,
          href: `${pageNum}`,
          level: 0,
          order: order++,
        });
      }
    }
  }

  // 2. If no bookmarks, check if pages are structured in subdirectories (e.g. Chapter 01/01.jpg)
  if (tableOfContents.length === 0) {
    const dirMap = new Map<string, number>();
    pageNames.forEach((name, idx) => {
      const normalized = name.replace(/\\/g, '/');
      const lastSlash = normalized.lastIndexOf('/');
      if (lastSlash > 0) {
        const dir = normalized.slice(0, lastSlash);
        if (!dirMap.has(dir)) {
          dirMap.set(dir, idx + 1);
        }
      }
    });

    if (dirMap.size > 1) {
      let order = 0;
      for (const [dir, firstPage] of dirMap.entries()) {
        const displayTitle = dir.split('/').pop() || dir;
        tableOfContents.push({
          id: generateId(),
          title: displayTitle,
          href: `${firstPage}`,
          level: 0,
          order: order++,
        });
      }
    }
  }

  // 3. Fallback: generate page navigation milestones
  if (tableOfContents.length === 0) {
    const step = totalPages > 100 ? 5 : 1;
    let order = 0;
    for (let p = 1; p <= totalPages; p += step) {
      tableOfContents.push({
        id: generateId(),
        title: step > 1 ? `Pages ${p}–${Math.min(totalPages, p + step - 1)}` : `Page ${p}`,
        href: `${p}`,
        level: 0,
        order: order++,
      });
    }
  }

  return tableOfContents;
}

/**
 * Extracts a cover image data URL from image bytes or a Blob.
 */
export async function extractCoverDataUrl(
  source: Blob | Uint8Array,
  mimeType: string = 'image/jpeg'
): Promise<string | undefined> {
  try {
    const blob = source instanceof Blob ? source : new Blob([source as any], { type: mimeType });

    // In modern browsers, createImageBitmap provides fast offscreen decoding
    if (
      typeof window !== 'undefined' &&
      typeof createImageBitmap === 'function' &&
      typeof document !== 'undefined' &&
      typeof document.createElement === 'function'
    ) {
      try {
        const bitmap = await createImageBitmap(blob);
        try {
          const maxDim = 480;
          const scale = Math.min(1.0, maxDim / Math.max(bitmap.width, bitmap.height));
          const w = Math.max(1, Math.round(bitmap.width * scale));
          const h = Math.max(1, Math.round(bitmap.height * scale));

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0, w, h);
            return canvas.toDataURL('image/jpeg', 0.85);
          }
        } finally {
          bitmap.close();
        }
      } catch {
        // Fallback below
      }
    }

    // Direct FileReader fallback
    if (typeof FileReader !== 'undefined') {
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('FileReader error'));
        reader.readAsDataURL(blob);
      });
    }

    // Node.js fallback (Buffer to base64 data URL)
    if (typeof Buffer !== 'undefined') {
      const buffer = source instanceof Uint8Array ? Buffer.from(source) : Buffer.from(await source.arrayBuffer());
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
    }

    return undefined;
  } catch (err) {
    console.warn('Could not extract comic cover:', err);
    return undefined;
  }
}

/**
 * Detects archive format from binary magic bytes.
 */
export function detectComicFormat(input: ArrayBuffer | Uint8Array): 'cbz' | 'cbr' | 'cb7' | 'unknown' {
  const u8 = input instanceof Uint8Array
    ? input
    : new Uint8Array(input);

  if (u8.length < 4) return 'unknown';

  // ZIP: PK\x03\x04 or PK\x05\x06 or PK\x07\x08
  if (u8[0] === 0x50 && u8[1] === 0x4b) {
    return 'cbz';
  }

  // RAR: Rar!\x1A\x07 (RAR4: 0x52 0x61 0x72 0x21 0x1A 0x07 0x00, RAR5: 0x52 0x61 0x72 0x21 0x1A 0x07 0x01 0x00)
  if (u8[0] === 0x52 && u8[1] === 0x61 && u8[2] === 0x72 && u8[3] === 0x21) {
    return 'cbr';
  }

  // 7z: 7z\xBC\xAF'\x1C (0x37 0x7A 0xBC 0xAF 0x27 0x1C)
  if (u8[0] === 0x37 && u8[1] === 0x7a && u8[2] === 0xbc && u8[3] === 0xaf) {
    return 'cb7';
  }

  return 'unknown';
}
