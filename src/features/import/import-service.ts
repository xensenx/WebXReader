/**
 * Import service for WebXReader.
 * Handles file validation, parsing, deduplication, and persistence of imported books.
 */

import type { Book, BookContent, BookFormat, Chapter } from '../../types/book';
import {
  generateId,
  computeHash,
  getFileExtension,
  readFileAsText,
  readFileAsArrayBuffer,
} from '../../utils';
import {
  findBookByHash,
  saveBookBundle,
} from '../../core/storage/database';
import { parseTxt } from '../../core/parsing/txt-parser';
import { parseMarkdown } from '../../core/parsing/markdown-parser';
import { parseHtml } from '../../core/parsing/html-parser';
import { parseEpub } from '../../core/parsing/epub-parser';
import { parsePdf } from '../../core/parsing/pdf-parser';
import { parseCbz } from '../../core/parsing/cbz-parser';

/** Options for the import process */
export interface ImportOptions {
  /** Whether to auto-detect chapters in TXT files. Defaults to true. */
  autoDetectChapters: boolean;
  /** Whether to skip the duplicate check and force import. Defaults to false. */
  forceImport: boolean;
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

/** Supported file extensions and their corresponding book formats */
const EXTENSION_TO_FORMAT: Record<string, BookFormat> = {
  txt: 'txt',
  epub: 'epub',
  pdf: 'pdf',
  cbz: 'cbz',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
};

/** Supported extensions list */
const SUPPORTED_EXTENSIONS = Object.keys(EXTENSION_TO_FORMAT);

/**
 * Validates that a file has a supported extension.
 */
function validateFileType(filename: string): BookFormat | null {
  const ext = getFileExtension(filename);
  return EXTENSION_TO_FORMAT[ext] ?? null;
}

/**
 * Derives a title from the filename by removing the extension
 * and replacing common separators with spaces.
 */
function titleFromFilename(filename: string): string {
  const ext = getFileExtension(filename);
  let name = filename;
  if (ext) {
    name = filename.slice(0, -(ext.length + 1));
  }
  // Replace underscores, hyphens, and dots with spaces
  return name.replace(/[_\-.]+/g, ' ').trim() || 'Untitled';
}

/**
 * Creates a Book object from parsed data.
 */
function createBook(params: {
  id: string;
  format: BookFormat;
  filename: string;
  fileSize: number;
  contentHash: string;
  metadata: {
    title?: string;
    author?: string;
    description?: string;
    language?: string;
    publisher?: string;
    publicationDate?: string;
    identifiers?: Record<string, string>;
  };
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
    publicationDate: params.metadata.publicationDate || '',
    identifiers: params.metadata.identifiers || {},
    sourceFormat: params.format,
    originalFilename: params.filename,
    fileSize: params.fileSize,
    contentHash: params.contentHash,
    importedAt: now,
    updatedAt: now,
    coverImage: params.coverImage,
    userTags: [],
    userRating: null,
    favorite: false,
    archived: false,
    readingStatus: 'unread',
    lastOpenedAt: null,
    tableOfContents: params.tableOfContents,
    totalChapters: params.tableOfContents.length,
  };
}

/**
 * Imports a TXT file.
 */
async function importTxt(
  file: File,
  contentHash: string,
  bookId: string,
  autoDetect: boolean,
  textEncoding?: string,
): Promise<{ book: Book; content: BookContent }> {
  const text = await readFileAsText(file, textEncoding);
  const { chapters, rawText } = parseTxt(text, { autoDetect });

  // Build table of contents (without content for ToC entries)
  const tableOfContents: Chapter[] = chapters.map((ch) => ({
    id: ch.id,
    title: ch.title,
    level: ch.level,
    order: ch.order,
  }));

  const book = createBook({
    id: bookId,
    format: 'txt',
    filename: file.name,
    fileSize: file.size,
    contentHash,
    metadata: {},
    tableOfContents,
  });

  const content: BookContent = {
    bookId,
    chapters,
    rawText,
    format: 'txt',
  };

  return { book, content };
}

/**
 * Imports a Markdown file.
 */
async function importMarkdown(
  file: File,
  contentHash: string,
  bookId: string,
  textEncoding?: string,
): Promise<{ book: Book; content: BookContent }> {
  const text = await readFileAsText(file, textEncoding);
  const { chapters, metadata } = parseMarkdown(text);

  const tableOfContents: Chapter[] = chapters.map((ch) => ({
    id: ch.id,
    title: ch.title,
    level: ch.level,
    order: ch.order,
  }));

  const book = createBook({
    id: bookId,
    format: 'markdown',
    filename: file.name,
    fileSize: file.size,
    contentHash,
    metadata,
    tableOfContents,
  });

  const content: BookContent = {
    bookId,
    chapters,
    rawText: text,
    format: 'markdown',
  };

  return { book, content };
}

/**
 * Imports an HTML file.
 */
async function importHtml(
  file: File,
  contentHash: string,
  bookId: string,
  textEncoding?: string,
): Promise<{ book: Book; content: BookContent }> {
  const text = await readFileAsText(file, textEncoding);
  const { chapters, metadata } = parseHtml(text);

  const tableOfContents: Chapter[] = chapters.map((ch) => ({
    id: ch.id,
    title: ch.title,
    level: ch.level,
    order: ch.order,
  }));

  const book = createBook({
    id: bookId,
    format: 'html',
    filename: file.name,
    fileSize: file.size,
    contentHash,
    metadata,
    tableOfContents,
  });

  const content: BookContent = {
    bookId,
    chapters,
    rawText: text,
    format: 'html',
  };

  return { book, content };
}

/**
 * Imports an EPUB file.
 */
async function importEpub(
  file: File,
  contentHash: string,
  bookId: string,
  arrayBuffer: ArrayBuffer
): Promise<{ book: Book; content: BookContent; coverImage?: string }> {
  const { metadata, tableOfContents, coverImage } = await parseEpub(arrayBuffer);

  const book = createBook({
    id: bookId,
    format: 'epub',
    filename: file.name,
    fileSize: file.size,
    contentHash,
    metadata,
    tableOfContents,
    coverImage,
  });

  const content: BookContent = {
    bookId,
    originalFile: arrayBuffer,
    format: 'epub',
  };

  return { book, content, coverImage };
}

/**
 * Imports a PDF file.
 */
async function importPdf(
  file: File,
  contentHash: string,
  bookId: string,
  arrayBuffer: ArrayBuffer
): Promise<{ book: Book; content: BookContent; coverImage?: string }> {
  const { metadata, tableOfContents, coverImage } = await parsePdf(arrayBuffer);

  const book = createBook({
    id: bookId,
    format: 'pdf',
    filename: file.name,
    fileSize: file.size,
    contentHash,
    metadata,
    tableOfContents,
    coverImage,
  });

  const content: BookContent = {
    bookId,
    originalFile: arrayBuffer,
    format: 'pdf',
  };

  return { book, content, coverImage };
}

/**
 * Imports a CBZ (Comic Book Zip) file.
 */
async function importCbz(
  file: File,
  contentHash: string,
  bookId: string,
  arrayBuffer: ArrayBuffer
): Promise<{ book: Book; content: BookContent; coverImage?: string }> {
  const { metadata, tableOfContents, coverImage, readingDirection } = await parseCbz(arrayBuffer);

  const identifiers = { ...(metadata.identifiers || {}) };
  if (readingDirection) {
    identifiers.readingDirection = readingDirection;
  }

  const book = createBook({
    id: bookId,
    format: 'cbz',
    filename: file.name,
    fileSize: file.size,
    contentHash,
    metadata: {
      ...metadata,
      identifiers,
    },
    tableOfContents,
    coverImage,
  });

  const content: BookContent = {
    bookId,
    originalFile: arrayBuffer,
    format: 'cbz',
  };

  return { book, content, coverImage };
}

/**
 * Main import function.
 * Accepts a File object, validates it, parses it, checks for duplicates,
 * and persists the book data to IndexedDB.
 *
 * @param file - The file to import
 * @param options - Import options
 * @returns Import result indicating success or error
 */
export async function importFile(
  file: File,
  options?: Partial<ImportOptions>
): Promise<ImportResult> {
  const opts: ImportOptions = {
    autoDetectChapters: options?.autoDetectChapters ?? true,
    forceImport: options?.forceImport ?? false,
    textEncoding: options?.textEncoding,
  };

  try {
    // 1. Validate file type
    const format = validateFileType(file.name);
    if (!format) {
      const ext = getFileExtension(file.name);
      return {
        success: false,
        error: `Unsupported file type: "${ext || 'unknown'}". Supported formats: ${SUPPORTED_EXTENSIONS.join(', ')}`,
      };
    }

    // 2. Validate file is not empty
    if (file.size === 0) {
      return {
        success: false,
        error: 'The file is empty and cannot be imported.',
      };
    }

    // 3. Read file as ArrayBuffer for hashing (and for EPUB usage)
    let arrayBuffer: ArrayBuffer;
    try {
      arrayBuffer = await readFileAsArrayBuffer(file);
    } catch (readError) {
      return {
        success: false,
        error: `Failed to read file: ${readError instanceof Error ? readError.message : String(readError)}`,
      };
    }

    // 4. Compute content hash for deduplication
    const contentHash = await computeHash(arrayBuffer);

    // 5. Check for duplicates
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

    // 6. Generate book ID
    const bookId = generateId();

    // 7. Parse based on format
    let book: Book;
    let content: BookContent;
    let coverImage: string | undefined;

    try {
      switch (format) {
        case 'txt': {
          const result = await importTxt(file, contentHash, bookId, opts.autoDetectChapters, opts.textEncoding);
          book = result.book;
          content = result.content;
          break;
        }
        case 'markdown': {
          const result = await importMarkdown(file, contentHash, bookId, opts.textEncoding);
          book = result.book;
          content = result.content;
          break;
        }
        case 'html': {
          const result = await importHtml(file, contentHash, bookId, opts.textEncoding);
          book = result.book;
          content = result.content;
          break;
        }
        case 'epub': {
          const result = await importEpub(file, contentHash, bookId, arrayBuffer);
          book = result.book;
          content = result.content;
          coverImage = result.coverImage;
          break;
        }
        case 'pdf': {
          const result = await importPdf(file, contentHash, bookId, arrayBuffer);
          book = result.book;
          content = result.content;
          coverImage = result.coverImage;
          break;
        }
        case 'cbz': {
          const result = await importCbz(file, contentHash, bookId, arrayBuffer);
          book = result.book;
          content = result.content;
          coverImage = result.coverImage;
          break;
        }
        default: {
          return {
            success: false,
            error: `Unsupported format: ${format}`,
          };
        }
      }
    } catch (parseError) {
      return {
        success: false,
        error: `Failed to parse ${format.toUpperCase()} file: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      };
    }

    // 8. Save to IndexedDB
    try {
      await saveBookBundle(book, content, coverImage);
    } catch (saveError) {
      return {
        success: false,
        error: `Failed to save book: ${saveError instanceof Error ? saveError.message : String(saveError)}`,
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
  }
}
