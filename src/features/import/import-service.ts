/**
 * Universal Import Service for WebXReader.
 *
 * Coordinates file validation, deduplication, hash computation, format dispatch,
 * and persistence. Delegates format-specific parsing to the modular format registry.
 */

import type { Book, BookFormat, Chapter } from '../../types/book';
import {
  generateId,
  computeHash,
  getFileExtension,
  readFileAsArrayBuffer,
  reuseImportBuffer,
  releaseImportBuffer,
  formatFileSize,
} from '../../utils';
import {
  findBookByHash,
  getLibraryFileSize,
  getSettings,
  saveBookBundle,
} from '../../core/storage/database';
import {
  detectFormatFromFilename,
  detectFormatFromMimeType,
  getFormat,
  getAllSupportedExtensions,
  type FormatParsedData,
  type FormatDefinition,
} from '../../formats';
import { validateAndDetectImageFormat } from '../../core/parsing/image-parser';
import { getFormatImportLimit } from '../../formats/import-limits';
import { BROWSER_QUOTA_ERROR, MAX_JSON_BACKUP_BYTES, isStorageQuotaError, libraryLimitError } from '../../core/storage/storage-limits';

/** Options for the import process */
export interface ImportOptions {
  /** Whether to auto-detect chapters in TXT files. Defaults to true. */
  autoDetectChapters?: boolean;
  /** Whether to skip the duplicate check and force import. Defaults to false. */
  forceImport?: boolean;
  /** Optional decoder label for text-based imports. */
  textEncoding?: string;
}

/** Successful import result */
export interface ImportSuccess {
  success: true;
  book: Book;
  isDuplicate: boolean;
  existingBookId?: string;
}

/** Failed import result */
export interface ImportError {
  success: false;
  error: string;
}

/** Union type for import results */
export type ImportResult = ImportSuccess | ImportError;

/**
 * Derives a human-readable title from the filename by stripping the extension
 * and normalizing common separator characters.
 */
function titleFromFilename(filename: string): string {
  const ext = getFileExtension(filename);
  let name = filename;
  if (ext) {
    name = filename.slice(0, -(ext.length + 1));
  }
  return name.replace(/[_\-.]+/g, ' ').trim() || 'Untitled';
}

/**
 * Creates a normalized Book record from parsed metadata.
 */
function createBook(params: {
  id: string;
  format: BookFormat;
  filename: string;
  fileSize: number;
  contentHash: string;
  metadata: FormatParsedData['metadata'];
  tableOfContents: Chapter[];
  coverImage?: string;
}): Book {
  const now = Date.now();
  return {
    id: params.id,
    title: params.metadata.title || titleFromFilename(params.filename),
    author: params.metadata.author || 'Unknown Author',
    description: params.metadata.description || '',
    language: params.metadata.language || '',
    publisher: params.metadata.publisher || '',
    publicationDate: params.metadata.publishDate || params.metadata.publicationDate || '',
    identifiers: params.metadata.identifiers || {},
    sourceFormat: params.format,
    originalFilename: params.filename,
    fileSize: params.fileSize,
    contentHash: params.contentHash,
    importedAt: now,
    updatedAt: now,
    coverImage: params.coverImage,
    originalCoverImage: params.format === 'epub' && !params.coverImage ? null : undefined,
    userTags: [],
    userRating: null,
    favorite: false,
    archived: false,
    readingStatus: 'unread',
    lastOpenedAt: null,
    tableOfContents: params.tableOfContents,
    totalChapters: params.tableOfContents.length || (params.format === 'cbz' ? 1 : 1),
  };
}

/**
 * Imports a book file into WebXReader's local IndexedDB library.
 */
export async function importFile(
  file: File,
  options?: Partial<ImportOptions>
): Promise<ImportResult> {
  const opts: ImportOptions = {
    autoDetectChapters: true,
    forceImport: false,
    ...options,
  };

  try {
    // 1. File size sanity check
    if (file.size === 0) {
      return {
        success: false,
        error: 'The selected file is empty (0 bytes).',
      };
    }
    // Resolve the format and enforce its ceiling before buffering the full file.
    let formatDef: FormatDefinition | null = detectFormatFromFilename(file.name) ?? detectFormatFromMimeType(file.type);
    if (!formatDef && file.size >= 8) {
      try {
        const header = await readFileAsArrayBuffer(file.slice(0, 32));
        formatDef = getFormat(validateAndDetectImageFormat(new Uint8Array(header))) ?? null;
      } catch {
        // Not a recognized binary format
      }
    }

    if (!formatDef) {
      const ext = getFileExtension(file.name) || (file.type ? file.type.split('/')[1] : 'unknown');
      return {
        success: false,
        error: `Unsupported file type: "${ext}". Supported formats: ${getAllSupportedExtensions().join(', ')}`,
      };
    }

    const formatLimit = getFormatImportLimit(formatDef.id);
    if (file.size > formatLimit) {
      return { success: false, error: `${formatDef.label} files have a ${formatFileSize(formatLimit)} import limit.` };
    }
    const settings = await getSettings();
    const fileLimit = settings?.importFileLimitBytes;
    if (fileLimit != null && file.size > fileLimit) {
      return {
        success: false,
        error: `This file exceeds your ${formatFileSize(fileLimit)} per-file limit. Change it in Settings → Local storage and privacy.`,
      };
    }

    let arrayBuffer: ArrayBuffer;
    try {
      arrayBuffer = await readFileAsArrayBuffer(file);
      reuseImportBuffer(file, arrayBuffer);
    } catch (readError) {
      return { success: false, error: `Failed to read file: ${readError instanceof Error ? readError.message : String(readError)}` };
    }

    // 5. Compute content hash for deduplication
    const contentHash = await computeHash(arrayBuffer);

    // 6. Check for duplicates
    if (!opts.forceImport) {
      const existingBook = await findBookByHash(contentHash);
      if (existingBook) {
        return {
          success: true,
          book: existingBook,
          isDuplicate: true,
          existingBookId: existingBook.id,
        };
      }
    }

    const libraryLimit = settings?.librarySizeLimitBytes;
    if (libraryLimit != null) {
      const used = await getLibraryFileSize();
      if (file.size > libraryLimit - used) {
        return { success: false, error: libraryLimitError(libraryLimit, used, file.size).message };
      }
    }

    // 7. Generate unique book ID
    const bookId = generateId();

    // 8. Delegate parsing to the format definition
    let parsed: FormatParsedData;
    try {
      parsed = await formatDef.parse(file, {
        autoDetectChapters: opts.autoDetectChapters,
        textEncoding: opts.textEncoding,
      });
    } catch (parseError) {
      return {
        success: false,
        error: `Failed to parse ${formatDef.id.toUpperCase()} file: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      };
    }

    // If parsing extracted a canonical format identifier (e.g. image parser detected png/jpeg),
    // sync final sourceFormat with the real format
    const actualFormatId = (parsed.metadata?.identifiers?.format as BookFormat) || formatDef.id;

    // 9. Construct Book and BookContent entities
    const book = createBook({
      id: bookId,
      format: actualFormatId,
      filename: file.name,
      fileSize: file.size,
      contentHash,
      metadata: parsed.metadata,
      tableOfContents: parsed.tableOfContents,
      coverImage: parsed.coverImage,
    });

    const originalFile = parsed.originalFile ?? (formatDef.requiresOriginalFile ? arrayBuffer : undefined);
    const content = {
      bookId,
      chapters: parsed.chapters,
      rawText: parsed.rawText,
      // IndexedDB can persist a disk-backed File without serializing the entire buffer again.
      originalFile: originalFile === arrayBuffer && arrayBuffer.byteLength > MAX_JSON_BACKUP_BYTES ? file : originalFile,
      format: actualFormatId,
    };

    // 10. Persist to local IndexedDB
    try {
      const currentLimit = (await getSettings())?.librarySizeLimitBytes;
      await saveBookBundle(book, content, parsed.coverImage, currentLimit ?? null);
    } catch (saveError) {
      return {
        success: false,
        error: isStorageQuotaError(saveError)
          ? BROWSER_QUOTA_ERROR
          : `Failed to save book: ${saveError instanceof Error ? saveError.message : String(saveError)}`,
      };
    }

    return {
      success: true,
      book,
      isDuplicate: false,
    };
  } catch (error) {
    return {
      success: false,
      error: `Import failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    releaseImportBuffer(file);
  }
}
