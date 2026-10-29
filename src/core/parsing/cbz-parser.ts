/**
 * CBZ (Comic Book Zip) parser for WebXReader.
 * Uses JSZip to extract images, parse ComicInfo.xml metadata,
 * build table of contents, and extract cover thumbnails.
 */

import JSZip from 'jszip';
import type { Chapter, BookMetadata } from '../../types/book';
import { generateId } from '../../utils';

export interface CbzParseResult {
  metadata: Partial<BookMetadata>;
  tableOfContents: Chapter[];
  coverImage?: string;
  totalPages: number;
  readingDirection?: 'ltr' | 'rtl';
  pageFileNames: string[];
}

/** Recognized image extensions */
const IMAGE_EXTENSIONS = new Set([
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
function isImageFileName(filename: string): boolean {
  const parts = filename.toLowerCase().split('.');
  if (parts.length < 2) return false;
  const ext = parts[parts.length - 1];
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Checks if a zip entry should be ignored (system metadata, macOS resource forks, hidden files).
 */
function shouldIgnoreEntry(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const segments = normalized.split('/');

  // Ignore MacOS resource forks, Thumbs.db, desktop.ini, hidden directories/files
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
      // Fallback below
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

interface ComicInfoBookmark {
  imageIndex: number;
  bookmark: string;
}

/**
 * Parses ComicInfo.xml metadata if present in the zip.
 */
async function parseComicInfo(
  zip: JSZip
): Promise<{
  metadata: Partial<BookMetadata>;
  readingDirection?: 'ltr' | 'rtl';
  coverImageIndex?: number;
  bookmarks: ComicInfoBookmark[];
}> {
  const metadata: Partial<BookMetadata> = {};
  let readingDirection: 'ltr' | 'rtl' | undefined;
  let coverImageIndex: number | undefined;
  const bookmarks: ComicInfoBookmark[] = [];

  // Search for ComicInfo.xml case-insensitively
  let comicInfoEntry: JSZip.JSZipObject | null = null;
  zip.forEach((path, entry) => {
    if (!entry.dir && path.toLowerCase().endsWith('comicinfo.xml') && !shouldIgnoreEntry(path)) {
      comicInfoEntry = entry;
    }
  });

  if (!comicInfoEntry) {
    return { metadata, readingDirection, coverImageIndex, bookmarks };
  }

  try {
    const xmlText = await (comicInfoEntry as JSZip.JSZipObject).async('text');
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
 * Extracts a cover image data URL from the selected image file entry.
 */
async function extractCoverDataUrl(entry: JSZip.JSZipObject): Promise<string | undefined> {
  try {
    const blob = await entry.async('blob');

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
        // Fallback to FileReader below
      }
    }

    // Direct FileReader fallback (universal, works in jsdom and all browsers)
    if (typeof FileReader !== 'undefined') {
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('FileReader error'));
        reader.readAsDataURL(blob);
      });
    }

    return undefined;
  } catch (err) {
    console.warn('Could not extract CBZ cover:', err);
    return undefined;
  }
}

/**
 * Builds table of contents chapters from bookmarks, directory folders, or page numbers.
 */
function buildTableOfContents(
  pageNames: string[],
  bookmarks: ComicInfoBookmark[]
): Chapter[] {
  const totalPages = pageNames.length;
  const tableOfContents: Chapter[] = [];

  // 1. If ComicInfo bookmarks exist, use them
  if (bookmarks.length > 0) {
    // Sort bookmarks by imageIndex
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
    const dirMap = new Map<string, number>(); // dirName -> first 1-based pageNum
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

  // 3. Fallback: generate page navigation milestones (like PDF / SumatraPDF)
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
 * Parses a CBZ (Comic Book Zip) file from an ArrayBuffer.
 *
 * @param arrayBuffer - The binary CBZ content
 * @returns Metadata, Table of Contents, cover image, and page filenames
 */
export async function parseCbz(arrayBuffer: ArrayBuffer): Promise<CbzParseResult> {
  const zip = await JSZip.loadAsync(arrayBuffer);

  // 1. Gather all valid image file entries
  const imageEntries: { path: string; entry: JSZip.JSZipObject }[] = [];

  zip.forEach((path, entry) => {
    if (!entry.dir && isImageFileName(path) && !shouldIgnoreEntry(path)) {
      imageEntries.push({ path, entry });
    }
  });

  if (imageEntries.length === 0) {
    throw new Error('No readable image files found in the CBZ archive.');
  }

  // 2. Sort images naturally
  imageEntries.sort((a, b) => naturalCompare(a.path, b.path));
  const pageFileNames = imageEntries.map((e) => e.path);
  const totalPages = pageFileNames.length;

  // 3. Parse ComicInfo.xml metadata
  const { metadata, readingDirection, coverImageIndex, bookmarks } = await parseComicInfo(zip);

  // 4. Build Table of Contents
  const tableOfContents = buildTableOfContents(pageFileNames, bookmarks);

  // 5. Extract cover image
  let coverEntry = imageEntries[0].entry;
  if (
    coverImageIndex !== undefined &&
    coverImageIndex >= 0 &&
    coverImageIndex < imageEntries.length
  ) {
    coverEntry = imageEntries[coverImageIndex].entry;
  }

  const coverImage = await extractCoverDataUrl(coverEntry);

  return {
    metadata,
    tableOfContents,
    coverImage,
    totalPages,
    readingDirection,
    pageFileNames,
  };
}
