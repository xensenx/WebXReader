/**
 * 7-Zip WebAssembly archive extraction manager for CBR (.cbr, .rar) and CB7 (.cb7, .7z).
 */

import { createSevenZipInstance } from './sevenzip-init';
import {
  isImageFileName,
  shouldIgnoreEntry,
  naturalCompare,
  getImageMimeType,
  parseComicInfoXml,
  buildTableOfContents,
  extractCoverDataUrl,
  type ComicParseResult,
} from './comic-archive';
import { removeDirRecursive, walkDirectory } from './sevenzip-common';
import { extractSevenZipWithBudget, inspectSevenZipArchive } from './sevenzip-budget';
import { COMIC_ARCHIVE_TOTAL_BYTES } from './archive-size-limits';

export interface ComicArchiveSession {
  pageNames: string[];
  getPageData: (pageIndex: number) => Promise<Uint8Array | undefined>;
  getPageBlob: (pageIndex: number) => Promise<Blob | undefined>;
  close: () => void;
}

let sessionCounter = 0;

/**
 * Read the archive listing and extract only the metadata and cover needed for import.
 */
export async function parseSevenZipComic(
  arrayBuffer: ArrayBuffer,
  fileExtension: 'cbr' | 'cb7',
): Promise<ComicParseResult> {
  const listing: string[] = [];
  const sevenZip = await createSevenZipInstance((line) => listing.push(line));
  const FS = sevenZip.FS;

  const sessionId = `parse_${Date.now()}_${++sessionCounter}`;
  const baseDir = `/${sessionId}`;
  const outDir = `${baseDir}/out`;
  const inputFile = `${baseDir}/input.${fileExtension}`;

  FS.mkdir(baseDir);
  FS.mkdir(outDir);

  try {
    FS.writeFile(inputFile, new Uint8Array(arrayBuffer));
    const entries = inspectSevenZipArchive(sevenZip, inputFile, listing, COMIC_ARCHIVE_TOTAL_BYTES)
      .filter(({ path, isDirectory }) => !isDirectory && !shouldIgnoreEntry(path.replace(/\\/g, '/')));
    const images = entries.filter(({ path }) => isImageFileName(path)).sort((a, b) => naturalCompare(a.path, b.path));
    if (images.length === 0) {
      throw new Error(`No readable image files found in the .${fileExtension} archive.`);
    }

    function extractEntry(entry: (typeof entries)[number]): Uint8Array {
      const outputFile = `${outDir}/${entry.path.replace(/\\/g, '/')}`;
      extractSevenZipWithBudget(sevenZip, outDir, ['x', inputFile, `-o${outDir}`, '-y', '-p-', '-spd', `-i!${entry.path}`], entry.size);
      const bytes = FS.readFile(outputFile) as Uint8Array;
      FS.unlink(outputFile);
      return bytes;
    }

    const info = entries.find(({ path }) => /(?:^|[\\/])ComicInfo\.xml$/i.test(path));
    const { metadata, readingDirection, coverImageIndex, bookmarks } = info
      ? parseComicInfoXml(new TextDecoder().decode(extractEntry(info)))
      : { metadata: {}, bookmarks: [] };
    const cover = images[coverImageIndex ?? 0] ?? images[0];
    let coverImage: string | undefined;
    try {
      coverImage = await extractCoverDataUrl(extractEntry(cover), getImageMimeType(cover.path));
    } catch (error) {
      console.warn('Could not extract comic cover:', error);
    }
    const imagePaths = images.map(({ path }) => path.replace(/\\/g, '/'));
    return {
      metadata,
      tableOfContents: buildTableOfContents(imagePaths, bookmarks),
      coverImage,
      totalPages: imagePaths.length,
      readingDirection,
      pageFileNames: imagePaths,
    };
  } finally {
    removeDirRecursive(FS, baseDir);
  }
}

/**
 * Opens an active comic archive session for interactive reading.
 * Images remain in MEMFS and are read into Blobs on demand.
 */
export async function openComicArchiveSession(
  arrayBuffer: ArrayBuffer,
  fileExtension: string = '7z'
): Promise<ComicArchiveSession> {
  const listing: string[] = [];
  const sevenZip = await createSevenZipInstance((line) => listing.push(line));
  const FS = sevenZip.FS;

  const sessionId = `session_${Date.now()}_${++sessionCounter}`;
  const baseDir = `/${sessionId}`;
  const outDir = `${baseDir}/out`;
  const inputFile = `${baseDir}/input.${fileExtension}`;

  FS.mkdir(baseDir);
  FS.mkdir(outDir);

  try {
    const bytes = new Uint8Array(arrayBuffer);
    FS.writeFile(inputFile, bytes);
    inspectSevenZipArchive(sevenZip, inputFile, listing, COMIC_ARCHIVE_TOTAL_BYTES);
    extractSevenZipWithBudget(sevenZip, outDir, ['x', inputFile, `-o${outDir}`, '-y', '-p-'], COMIC_ARCHIVE_TOTAL_BYTES);
  } catch (error) {
    removeDirRecursive(FS, baseDir);
    throw error;
  }

  try {
    FS.unlink(inputFile);
  } catch {
    // ignore
  }

  const allEntries = walkDirectory(FS, outDir);
  const pathToFullMap = new Map<string, string>();
  const imagePaths: string[] = [];

  for (const entry of allEntries) {
    if (shouldIgnoreEntry(entry.rel)) continue;
    if (isImageFileName(entry.rel)) {
      imagePaths.push(entry.rel);
      pathToFullMap.set(entry.rel, entry.full);
    }
  }

  if (imagePaths.length === 0) {
    removeDirRecursive(FS, baseDir);
    throw new Error(`No readable image files found in the .${fileExtension} archive.`);
  }

  imagePaths.sort(naturalCompare);

  let isClosed = false;

  return {
    pageNames: imagePaths,
    getPageData: async (pageIndex: number): Promise<Uint8Array | undefined> => {
      if (isClosed || pageIndex < 0 || pageIndex >= imagePaths.length) return undefined;
      const relPath = imagePaths[pageIndex];
      const fullPath = pathToFullMap.get(relPath);
      if (!fullPath) return undefined;
      try {
        return FS.readFile(fullPath) as Uint8Array;
      } catch (err) {
        console.error(`Failed to read page data for ${relPath}:`, err);
        return undefined;
      }
    },
    getPageBlob: async (pageIndex: number): Promise<Blob | undefined> => {
      if (isClosed || pageIndex < 0 || pageIndex >= imagePaths.length) return undefined;
      const relPath = imagePaths[pageIndex];
      const fullPath = pathToFullMap.get(relPath);
      if (!fullPath) return undefined;
      try {
        const data = FS.readFile(fullPath);
        const mimeType = getImageMimeType(relPath);
        return new Blob([data as any], { type: mimeType });
      } catch (err) {
        console.error(`Failed to read page blob for ${relPath}:`, err);
        return undefined;
      }
    },
    close: () => {
      if (!isClosed) {
        isClosed = true;
        removeDirRecursive(FS, baseDir);
      }
    },
  };
}
