/**
 * General-purpose RAR Archive parser & extraction manager for WebXReader.
 *
 * Uses 7-Zip WebAssembly to support both RAR4 and modern RAR5 formats,
 * handling solid archives, directory traversal sanitization, archive bomb limits,
 * and on-demand entry extraction.
 */

import { createSevenZipInstance } from './sevenzip-init';
import type { Chapter } from '../../types/book';
import { generateId } from '../../utils';
import {
  detectZipEntryKind,
  sanitizeZipEntryPath,
  formatFileSize,
  buildChapterTree,
  type ZipEntryItem,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_DECOMPRESSED_SIZE,
  MAX_SINGLE_ENTRY_SIZE,
} from './zip-parser';
import { naturalCompare, shouldIgnoreEntry, getImageMimeType } from './comic-archive';

export interface RarParseResult {
  metadata: {
    title: string;
    description?: string;
    totalEntries: number;
    totalFiles: number;
    totalFolders: number;
    uncompressedSize: number;
  };
  tableOfContents: Chapter[];
  entries: ZipEntryItem[];
  coverImage?: string;
}

export interface RarArchiveSession {
  entries: ZipEntryItem[];
  getEntryData: (relativePath: string) => Promise<ArrayBuffer>;
  getEntryBlob: (relativePath: string, mimeType?: string) => Promise<Blob>;
  getEntryText: (relativePath: string) => Promise<string>;
  close: () => void;
}

let sessionCounter = 0;

/** Validates RAR magic header signature (RAR4 and RAR5) */
export function validateRarSignature(bytes: Uint8Array): void {
  if (bytes.length < 7) {
    throw new Error('File is not a valid RAR archive: file is too small or truncated.');
  }
  // RAR 1.5 - 4.x: 0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00
  // RAR 5.0+:     0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01
  const isRar =
    bytes[0] === 0x52 && // 'R'
    bytes[1] === 0x61 && // 'a'
    bytes[2] === 0x72 && // 'r'
    bytes[3] === 0x21 && // '!'
    bytes[4] === 0x1a && // Ctrl+Z
    bytes[5] === 0x07 &&
    (bytes[6] === 0x00 || bytes[6] === 0x01);

  if (!isRar) {
    throw new Error('File is not a valid RAR archive: missing RAR header signature.');
  }
}

function removeDirRecursive(FS: any, dir: string) {
  try {
    const entries = FS.readdir(dir);
    for (const name of entries) {
      if (name === '.' || name === '..') continue;
      const full = `${dir}/${name}`;
      try {
        const stat = FS.stat(full);
        if (FS.isDir(stat.mode)) {
          removeDirRecursive(FS, full);
        } else {
          FS.unlink(full);
        }
      } catch {
        // ignore
      }
    }
    FS.rmdir(dir);
  } catch {
    // ignore
  }
}

interface WalkItem {
  rel: string;
  full: string;
  isDir: boolean;
  size: number;
  mtime?: Date;
}

function walkDirectoryWithStats(
  FS: any,
  dir: string,
  base: string = ''
): WalkItem[] {
  const entries = FS.readdir(dir);
  const results: WalkItem[] = [];

  for (const name of entries) {
    if (name === '.' || name === '..') continue;
    const full = `${dir}/${name}`;
    const rel = base ? `${base}/${name}` : name;
    try {
      const stat = FS.stat(full);
      const isDir = FS.isDir(stat.mode);
      results.push({
        rel,
        full,
        isDir,
        size: isDir ? 0 : stat.size,
        mtime: stat.mtime ? new Date(stat.mtime) : undefined,
      });
      if (isDir) {
        results.push(...walkDirectoryWithStats(FS, full, rel));
      }
    } catch {
      // ignore
    }
  }

  return results;
}

/**
 * Parses a RAR archive from an ArrayBuffer, validates safety, and constructs a navigable directory model.
 */
export async function parseRar(
  buffer: ArrayBuffer | Uint8Array,
  options: { filename?: string } = {}
): Promise<RarParseResult> {
  const byteLength = buffer instanceof ArrayBuffer ? buffer.byteLength : buffer.length;
  if (!buffer || byteLength === 0) {
    throw new Error('RAR archive file is empty.');
  }
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  validateRarSignature(bytes);

  const sevenZip = await createSevenZipInstance();
  const FS = sevenZip.FS;

  const sessionId = `parse_rar_${Date.now()}_${++sessionCounter}`;
  const baseDir = `/${sessionId}`;
  const outDir = `${baseDir}/out`;
  const inputFile = `${baseDir}/input.rar`;

  FS.mkdir(baseDir);
  FS.mkdir(outDir);

  try {
    FS.writeFile(inputFile, bytes);

    let hadExitError = false;
    try {
      // Extract with 7z ('x' handles solid RAR4 and RAR5, -p- disables password prompt to detect encrypted)
      sevenZip.callMain(['x', inputFile, `-o${outDir}`, '-y', '-p-']);
    } catch (err: any) {
      hadExitError = true;
      const msg = String(err?.message || err || '');
      if (msg.includes('Wrong password') || msg.includes('password') || msg.includes('Encrypted')) {
        throw new Error('This RAR archive is password-protected or encrypted. Encrypted archives cannot be opened without a password.');
      }
    }

    try {
      FS.unlink(inputFile);
    } catch {
      // ignore
    }

    const items = walkDirectoryWithStats(FS, outDir);
    if (items.length === 0) {
      if (hadExitError) {
        throw new Error('Failed to read RAR archive: corrupted, encrypted, or unsupported RAR format.');
      }
      throw new Error('RAR archive contains no entries.');
    }

    if (items.length > MAX_ZIP_ENTRIES) {
      throw new Error(
        `RAR archive contains too many entries (${items.length} > ${MAX_ZIP_ENTRIES}). Operation refused for security.`
      );
    }

    let cumulativeUncompressedSize = 0;
    let totalFiles = 0;
    let totalFolders = 0;
    const entries: ZipEntryItem[] = [];
    const pathToFullMap = new Map<string, string>();

    for (const item of items) {
      if (shouldIgnoreEntry(item.rel)) continue;

      const cleanPath = sanitizeZipEntryPath(item.rel);
      if (!cleanPath) continue;

      if (item.isDir) {
        totalFolders++;
        entries.push({
          id: generateId(),
          path: cleanPath,
          name: cleanPath.split('/').pop() || cleanPath,
          isDirectory: true,
          uncompressedSize: 0,
          date: item.mtime,
          kind: 'folder',
          isSupported: true,
        });
      } else {
        totalFiles++;
        if (item.size > MAX_SINGLE_ENTRY_SIZE) {
          throw new Error(
            `Entry "${cleanPath}" exceeds maximum allowable uncompressed size (${formatFileSize(item.size)}).`
          );
        }

        cumulativeUncompressedSize += item.size;
        if (cumulativeUncompressedSize > MAX_ZIP_DECOMPRESSED_SIZE) {
          throw new Error(
            `Cumulative archive decompressed size exceeds maximum allowable limit (${formatFileSize(
              MAX_ZIP_DECOMPRESSED_SIZE
            )}).`
          );
        }

        const name = cleanPath.split('/').pop() || cleanPath;
        const kind = detectZipEntryKind(name);
        entries.push({
          id: generateId(),
          path: cleanPath,
          name,
          isDirectory: false,
          uncompressedSize: item.size,
          date: item.mtime,
          kind,
          isSupported: kind !== 'unsupported',
        });
        pathToFullMap.set(cleanPath, item.full);
      }
    }

    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return naturalCompare(a.path, b.path);
    });

    const tableOfContents = buildChapterTree(entries);

    // Extract cover thumbnail if available
    let coverImage: string | undefined;
    const imageEntries = entries.filter(
      (e) => !e.isDirectory && e.kind === 'image' && e.uncompressedSize <= 5 * 1024 * 1024
    );

    if (imageEntries.length > 0) {
      const explicitCover =
        imageEntries.find((e) => /(?:^|\/)(?:cover|front|default)\.[a-z0-9]+$/i.test(e.path)) ||
        imageEntries[0];

      const fullCoverPath = pathToFullMap.get(explicitCover.path);
      if (fullCoverPath) {
        try {
          const coverBytes = FS.readFile(fullCoverPath);
          const mime = getImageMimeType(explicitCover.path);
          const binary = Array.from(coverBytes, (byte: number) => String.fromCharCode(byte)).join('');
          coverImage = `data:${mime};base64,${btoa(binary)}`;
        } catch {
          // ignore
        }
      }
    }

    const rawTitle = options.filename?.replace(/\.rar$/i, '') || 'RAR Archive';

    return {
      metadata: {
        title: rawTitle,
        description: `RAR Archive containing ${totalFiles} file${totalFiles === 1 ? '' : 's'} across ${totalFolders} folder${totalFolders === 1 ? '' : 's'}. Total uncompressed size: ${formatFileSize(cumulativeUncompressedSize)}.`,
        totalEntries: entries.length,
        totalFiles,
        totalFolders,
        uncompressedSize: cumulativeUncompressedSize,
      },
      tableOfContents,
      entries,
      coverImage,
    };
  } finally {
    removeDirRecursive(FS, baseDir);
  }
}

/**
 * Opens an active RAR archive session in MEMFS for on-demand extraction during reading.
 */
export async function openRarArchiveSession(
  buffer: ArrayBuffer | Uint8Array,
  _options: { filename?: string } = {}
): Promise<RarArchiveSession> {
  const byteLength = buffer instanceof ArrayBuffer ? buffer.byteLength : buffer.length;
  if (!buffer || byteLength === 0) {
    throw new Error('RAR archive file is empty.');
  }
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  validateRarSignature(bytes);

  const sevenZip = await createSevenZipInstance();
  const FS = sevenZip.FS;

  const sessionId = `session_rar_${Date.now()}_${++sessionCounter}`;
  const baseDir = `/${sessionId}`;
  const outDir = `${baseDir}/out`;
  const inputFile = `${baseDir}/input.rar`;

  FS.mkdir(baseDir);
  FS.mkdir(outDir);

  FS.writeFile(inputFile, bytes);

  try {
    // Extract archive with 7-Zip
    sevenZip.callMain(['x', inputFile, `-o${outDir}`, '-y', '-p-']);
  } catch (err: any) {
    const msg = String(err?.message || err || '');
    if (msg.includes('Wrong password') || msg.includes('password') || msg.includes('Encrypted')) {
      removeDirRecursive(FS, baseDir);
      throw new Error('This RAR archive is password-protected or encrypted. Encrypted archives cannot be opened without a password.');
    }
  }

  try {
    FS.unlink(inputFile);
  } catch {
    // ignore
  }

  const items = walkDirectoryWithStats(FS, outDir);
  const entries: ZipEntryItem[] = [];
  const pathToFullMap = new Map<string, string>();

  for (const item of items) {
    if (shouldIgnoreEntry(item.rel)) continue;

    const cleanPath = sanitizeZipEntryPath(item.rel);
    if (!cleanPath) continue;

    if (item.isDir) {
      entries.push({
        id: generateId(),
        path: cleanPath,
        name: cleanPath.split('/').pop() || cleanPath,
        isDirectory: true,
        uncompressedSize: 0,
        date: item.mtime,
        kind: 'folder',
        isSupported: true,
      });
    } else {
      const name = cleanPath.split('/').pop() || cleanPath;
      const kind = detectZipEntryKind(name);
      entries.push({
        id: generateId(),
        path: cleanPath,
        name,
        isDirectory: false,
        uncompressedSize: item.size,
        date: item.mtime,
        kind,
        isSupported: kind !== 'unsupported',
      });
      pathToFullMap.set(cleanPath, item.full);
    }
  }

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return naturalCompare(a.path, b.path);
  });

  let isClosed = false;

  return {
    entries,
    getEntryData: async (relativePath: string): Promise<ArrayBuffer> => {
      if (isClosed) throw new Error('Archive session is closed.');
      const fullPath = pathToFullMap.get(relativePath);
      if (!fullPath) throw new Error(`File "${relativePath}" not found in RAR archive.`);
      const data: Uint8Array = FS.readFile(fullPath);
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      return copy.buffer;
    },
    getEntryBlob: async (relativePath: string, mimeType?: string): Promise<Blob> => {
      if (isClosed) throw new Error('Archive session is closed.');
      const fullPath = pathToFullMap.get(relativePath);
      if (!fullPath) throw new Error(`File "${relativePath}" not found in RAR archive.`);
      const data: Uint8Array = FS.readFile(fullPath);
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      const mime = mimeType || getImageMimeType(relativePath) || 'application/octet-stream';
      return new Blob([copy.buffer], { type: mime });
    },
    getEntryText: async (relativePath: string): Promise<string> => {
      if (isClosed) throw new Error('Archive session is closed.');
      const fullPath = pathToFullMap.get(relativePath);
      if (!fullPath) throw new Error(`File "${relativePath}" not found in RAR archive.`);
      return FS.readFile(fullPath, { encoding: 'utf8' });
    },
    close: () => {
      if (!isClosed) {
        isClosed = true;
        removeDirRecursive(FS, baseDir);
      }
    },
  };
}
