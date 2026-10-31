/**
 * General-purpose ZIP archive parser for WebXReader.
 *
 * Provides inspection, directory structure extraction, security validations
 * (zip bomb protection, path traversal defenses), format detection, and
 * on-demand entry extraction for reading nested e-books, documents, and images.
 */

import JSZip from 'jszip';
import type { Chapter } from '../../types/book';
import { generateId } from '../../utils';
import { naturalCompare, shouldIgnoreEntry, getImageMimeType } from './comic-archive';

/** Maximum total entries permitted in a single ZIP archive to prevent DoS */
export const MAX_ZIP_ENTRIES = 10000;

/** Maximum cumulative decompressed size (500 MB) to guard against ZIP bombs */
export const MAX_ZIP_DECOMPRESSED_SIZE = 500 * 1024 * 1024;

/** Maximum decompressed size for a single entry (100 MB) */
export const MAX_SINGLE_ENTRY_SIZE = 100 * 1024 * 1024;

/** Maximum ratio between decompressed and compressed size for large files */
export const MAX_COMPRESSION_RATIO = 100;

export type ZipItemKind =
  | 'folder'
  | 'epub'
  | 'pdf'
  | 'cbz'
  | 'cbr'
  | 'cb7'
  | 'djvu'
  | 'mht'
  | 'fb2'
  | 'mobi'
  | 'azw3'
  | 'docx'
  | 'doc'
  | 'rtf'
  | 'html'
  | 'markdown'
  | 'txt'
  | 'image'
  | 'unsupported';

export interface ZipEntryItem {
  id: string;
  path: string;
  name: string;
  isDirectory: boolean;
  uncompressedSize: number;
  date?: Date;
  kind: ZipItemKind;
  isSupported: boolean;
}

export interface ZipParseResult {
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

const EXTENSION_TO_KIND: Record<string, ZipItemKind> = {
  epub: 'epub',
  pdf: 'pdf',
  cbz: 'cbz',
  cbr: 'cbr',
  cb7: 'cb7',
  djvu: 'djvu',
  djv: 'djvu',
  mht: 'mht',
  mhtml: 'mht',
  fb2: 'fb2',
  mobi: 'mobi',
  prc: 'mobi',
  azw3: 'azw3',
  azw: 'azw3',
  kf8: 'azw3',
  docx: 'docx',
  doc: 'doc',
  rtf: 'rtf',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  md: 'markdown',
  markdown: 'markdown',
  txt: 'txt',
  text: 'txt',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  avif: 'image',
  bmp: 'image',
  svg: 'image',
};

/**
 * Detects the specific WebXReader supported format or image type from an entry filename.
 */
export function detectZipEntryKind(filename: string): ZipItemKind {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.fb2.zip')) return 'fb2';

  const ext = lower.split('.').pop() || '';
  return Object.prototype.hasOwnProperty.call(EXTENSION_TO_KIND, ext)
    ? EXTENSION_TO_KIND[ext]
    : 'unsupported';
}

/**
 * Validates and sanitizes a ZIP entry path to prevent directory traversal.
 */
export function sanitizeZipEntryPath(rawPath: string): string {
  // Normalize backslashes to forward slashes
  let normalized = rawPath.replace(/\\/g, '/');

  // Strip leading slashes
  normalized = normalized.replace(/^\/+/, '');

  // Disallow path traversal sequences
  const segments = normalized.split('/');
  for (const segment of segments) {
    if (segment === '..' || segment === '.') {
      throw new Error(`Security violation: ZIP archive contains illegal path traversal segment "${rawPath}"`);
    }
  }

  return normalized;
}

/**
 * Converts byte count into a human-readable size string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Parses a ZIP archive from an ArrayBuffer, validates safety, and builds a navigable directory model.
 */
export async function parseZip(
  buffer: ArrayBuffer | Uint8Array,
  options: { filename?: string } = {}
): Promise<ZipParseResult> {
  if (!buffer || (buffer instanceof ArrayBuffer ? buffer.byteLength : buffer.length) === 0) {
    throw new Error('ZIP archive file is empty.');
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    throw new Error(`Failed to read ZIP archive: ${err instanceof Error ? err.message : String(err)}`);
  }

  const fileKeys = Object.keys(zip.files);
  if (fileKeys.length === 0) {
    throw new Error('ZIP archive contains no entries.');
  }

  if (fileKeys.length > MAX_ZIP_ENTRIES) {
    throw new Error(
      `ZIP archive contains too many entries (${fileKeys.length} > ${MAX_ZIP_ENTRIES}). Operation refused for security.`
    );
  }

  let cumulativeUncompressedSize = 0;
  let totalFiles = 0;
  let totalFolders = 0;
  const entries: ZipEntryItem[] = [];
  const validFilePaths: string[] = [];

  for (const rawKey of fileKeys) {
    const zipObj = zip.files[rawKey];
    if (shouldIgnoreEntry(rawKey)) {
      continue;
    }

    const sanitizedPath = sanitizeZipEntryPath(rawKey);
    const isDirectory = zipObj.dir || sanitizedPath.endsWith('/');
    const cleanPath = isDirectory ? sanitizedPath.replace(/\/+$/, '') : sanitizedPath;

    if (!cleanPath) continue;

    // Approximate or inspect uncompressed size
    // JSZip stores _data internally with uncompressedSize on uncompressed objects
    const uncompressed = (zipObj as any)._data?.uncompressedSize ?? 0;
    const compressed = (zipObj as any)._data?.compressedSize ?? 0;

    // Check individual entry limit
    if (uncompressed > MAX_SINGLE_ENTRY_SIZE) {
      throw new Error(
        `Entry "${cleanPath}" exceeds maximum allowable uncompressed size (${formatFileSize(uncompressed)}).`
      );
    }

    // Check compression ratio on sizable files (> 100KB) to catch ZIP bombs
    if (compressed > 0 && uncompressed > 100 * 1024 && uncompressed / compressed > MAX_COMPRESSION_RATIO) {
      throw new Error(
        `Security alert: Entry "${cleanPath}" exhibits abnormal compression ratio (${Math.round(
          uncompressed / compressed
        )}:1), potential ZIP bomb detected.`
      );
    }

    cumulativeUncompressedSize += uncompressed;
    if (cumulativeUncompressedSize > MAX_ZIP_DECOMPRESSED_SIZE) {
      throw new Error(
        `Cumulative archive decompressed size exceeds maximum allowable limit (${formatFileSize(
          MAX_ZIP_DECOMPRESSED_SIZE
        )}).`
      );
    }

    const segments = cleanPath.split('/');
    const name = segments[segments.length - 1];

    if (isDirectory) {
      totalFolders++;
      entries.push({
        id: generateId(),
        path: cleanPath,
        name,
        isDirectory: true,
        uncompressedSize: 0,
        date: zipObj.date,
        kind: 'folder',
        isSupported: true,
      });
    } else {
      totalFiles++;
      const kind = detectZipEntryKind(name);
      const isSupported = kind !== 'unsupported';
      validFilePaths.push(cleanPath);

      entries.push({
        id: generateId(),
        path: cleanPath,
        name,
        isDirectory: false,
        uncompressedSize: uncompressed,
        date: zipObj.date,
        kind,
        isSupported,
      });
    }
  }

  // Sort entries naturally (directories first, then files sorted by filename)
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return naturalCompare(a.path, b.path);
  });

  // Build hierarchical Table of Contents (Chapter tree)
  const tableOfContents = buildChapterTree(entries);

  // Extract cover image thumbnail if available
  let coverImage: string | undefined = undefined;
  const preferredCoverCandidates = entries.filter(
    (e) => !e.isDirectory && e.kind === 'image' && /^(?:cover|thumb|poster|default|folder)\.[a-z0-9]+$/i.test(e.name)
  );

  const coverCandidate =
    preferredCoverCandidates[0] ||
    entries.find((e) => !e.isDirectory && e.kind === 'image');

  if (coverCandidate) {
    try {
      const imgZipObj = zip.file(coverCandidate.path);
      if (imgZipObj) {
        const base64 = await imgZipObj.async('base64');
        const mime = getImageMimeType(coverCandidate.name);
        coverImage = `data:${mime};base64,${base64}`;
      }
    } catch {
      // Cover extraction is best-effort
    }
  }

  const rawTitle = options.filename?.replace(/\.zip$/i, '') || 'ZIP Archive';

  return {
    metadata: {
      title: rawTitle,
      description: `ZIP Archive containing ${totalFiles} file${totalFiles === 1 ? '' : 's'} across ${totalFolders} folder${totalFolders === 1 ? '' : 's'}. Total uncompressed size: ${formatFileSize(cumulativeUncompressedSize)}.`,
      totalEntries: entries.length,
      totalFiles,
      totalFolders,
      uncompressedSize: cumulativeUncompressedSize,
    },
    tableOfContents,
    entries,
    coverImage,
  };
}

/**
 * Builds a nested Chapter hierarchy from flat ZIP entries.
 */
export function buildChapterTree(entries: ZipEntryItem[]): Chapter[] {
  interface Node {
    id: string;
    title: string;
    path: string;
    isDirectory: boolean;
    level: number;
    children: Node[];
  }

  const rootNodes: Node[] = [];
  const dirMap = new Map<string, Node>();

  // Process all directories first
  for (const entry of entries) {
    if (entry.isDirectory) {
      const node: Node = {
        id: entry.id,
        title: entry.name,
        path: entry.path,
        isDirectory: true,
        level: entry.path.split('/').length - 1,
        children: [],
      };
      dirMap.set(entry.path, node);

      const parentPath = entry.path.split('/').slice(0, -1).join('/');
      if (parentPath && dirMap.has(parentPath)) {
        dirMap.get(parentPath)!.children.push(node);
      } else {
        rootNodes.push(node);
      }
    }
  }

  // Place files into their respective directories
  for (const entry of entries) {
    if (!entry.isDirectory) {
      const node: Node = {
        id: entry.id,
        title: entry.name,
        path: entry.path,
        isDirectory: false,
        level: entry.path.split('/').length - 1,
        children: [],
      };

      const parentPath = entry.path.split('/').slice(0, -1).join('/');
      if (parentPath && dirMap.has(parentPath)) {
        dirMap.get(parentPath)!.children.push(node);
      } else {
        rootNodes.push(node);
      }
    }
  }

  // Convert Node hierarchy to Chapter structure
  function nodeToChapter(node: Node, order: number): Chapter {
    return {
      id: node.id,
      title: node.title,
      href: node.path,
      level: node.level,
      order,
      children: node.children.map((c, i) => nodeToChapter(c, i)),
    };
  }

  return rootNodes.map((n, i) => nodeToChapter(n, i));
}
