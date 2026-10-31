/**
 * CBZ (Comic Book Zip) parser for WebXReader.
 * Uses JSZip to extract images, parse ComicInfo.xml metadata,
 * build table of contents, and extract cover thumbnails.
 */

import JSZip from 'jszip';
import type { BookMetadata } from '../../types/book';
import {
  naturalCompare,
  isImageFileName,
  shouldIgnoreEntry,
  IMAGE_EXTENSIONS,
  getImageMimeType,
  parseComicInfoXml,
  buildTableOfContents,
  extractCoverDataUrl,
  type ComicParseResult,
  type ComicInfoBookmark,
} from './comic-archive';

export { naturalCompare, isImageFileName, shouldIgnoreEntry, IMAGE_EXTENSIONS };
export type { ComicParseResult as CbzParseResult };

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
  let comicInfoEntry: JSZip.JSZipObject | null = null;
  zip.forEach((path, entry) => {
    if (!entry.dir && path.toLowerCase().endsWith('comicinfo.xml') && !shouldIgnoreEntry(path)) {
      comicInfoEntry = entry;
    }
  });

  if (!comicInfoEntry) {
    return { metadata: {}, bookmarks: [] };
  }

  try {
    const xmlText = await (comicInfoEntry as JSZip.JSZipObject).async('text');
    return parseComicInfoXml(xmlText);
  } catch (err) {
    console.warn('Could not parse ComicInfo.xml:', err);
    return { metadata: {}, bookmarks: [] };
  }
}

/**
 * Parses a CBZ (Comic Book Zip) file from an ArrayBuffer.
 *
 * @param arrayBuffer - The binary CBZ content
 * @returns Metadata, Table of Contents, cover image, and page filenames
 */
export async function parseCbz(arrayBuffer: ArrayBuffer): Promise<ComicParseResult> {
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

  let coverImage: string | undefined;
  try {
    const coverBlob = await coverEntry.async('blob');
    coverImage = await extractCoverDataUrl(coverBlob, getImageMimeType(coverEntry.name));
  } catch (err) {
    console.warn('Could not extract CBZ cover:', err);
  }

  return {
    metadata,
    tableOfContents,
    coverImage,
    totalPages,
    readingDirection,
    pageFileNames,
  };
}
