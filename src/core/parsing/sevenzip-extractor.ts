/**
 * 7-Zip WebAssembly archive extraction manager for CBR (.cbr, .rar) and CB7 (.cb7, .7z).
 */

import { createSevenZipInstance } from './sevenzip-init';
import {
  isImageFileName,
  shouldIgnoreEntry,
  naturalCompare,
  getImageMimeType,
} from './comic-archive';
import { removeDirRecursive, walkDirectory } from './sevenzip-common';

export interface ExtractedComicArchive {
  imagePaths: string[];
  comicInfoXml?: string;
  files: Map<string, Uint8Array>;
}

export interface ComicArchiveSession {
  pageNames: string[];
  getPageData: (pageIndex: number) => Promise<Uint8Array | undefined>;
  getPageBlob: (pageIndex: number) => Promise<Blob | undefined>;
  close: () => void;
}

let sessionCounter = 0;

/**
 * Extracts a comic archive in memory and returns image paths, files map, and optional ComicInfo.xml text.
 */
export async function extractComicArchive(
  arrayBuffer: ArrayBuffer,
  fileExtension: string = '7z'
): Promise<ExtractedComicArchive> {
  const sevenZip = await createSevenZipInstance();
  const FS = sevenZip.FS;

  const sessionId = `parse_${Date.now()}_${++sessionCounter}`;
  const baseDir = `/${sessionId}`;
  const outDir = `${baseDir}/out`;
  const inputFile = `${baseDir}/input.${fileExtension}`;

  FS.mkdir(baseDir);
  FS.mkdir(outDir);

  try {
    const bytes = new Uint8Array(arrayBuffer);
    FS.writeFile(inputFile, bytes);

    try {
      sevenZip.callMain(['x', inputFile, `-o${outDir}`, '-y']);
    } catch {
      // callMain throws ExitStatus on completion or error
    }

    // Remove input file immediately to save memory
    try {
      FS.unlink(inputFile);
    } catch {
      // ignore
    }

    const allEntries = walkDirectory(FS, outDir);
    const imagePaths: string[] = [];
    const files = new Map<string, Uint8Array>();
    let comicInfoXml: string | undefined;

    for (const entry of allEntries) {
      if (shouldIgnoreEntry(entry.rel)) continue;

      if (isImageFileName(entry.rel)) {
        imagePaths.push(entry.rel);
        const data = FS.readFile(entry.full);
        files.set(entry.rel, data as Uint8Array);
      } else if (entry.rel.toLowerCase().endsWith('comicinfo.xml')) {
        comicInfoXml = FS.readFile(entry.full, { encoding: 'utf8' }) as string;
      }
    }

    if (imagePaths.length === 0) {
      throw new Error(`No readable image files found in the .${fileExtension} archive.`);
    }

    imagePaths.sort(naturalCompare);

    return {
      imagePaths,
      comicInfoXml,
      files,
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
  const sevenZip = await createSevenZipInstance();
  const FS = sevenZip.FS;

  const sessionId = `session_${Date.now()}_${++sessionCounter}`;
  const baseDir = `/${sessionId}`;
  const outDir = `${baseDir}/out`;
  const inputFile = `${baseDir}/input.${fileExtension}`;

  FS.mkdir(baseDir);
  FS.mkdir(outDir);

  const bytes = new Uint8Array(arrayBuffer);
  FS.writeFile(inputFile, bytes);

  try {
    sevenZip.callMain(['x', inputFile, `-o${outDir}`, '-y']);
  } catch {
    // callMain throws ExitStatus on completion
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
