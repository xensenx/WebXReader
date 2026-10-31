/**
 * IndexedDB storage abstraction for WebXReader.
 * Provides a typed interface over the library IndexedDB and separate browser-local preferences.
 */

import { DEFAULT_SETTINGS } from '../../types/book';
import type {
  Book,
  BookContent,
  BookFormat,
  Chapter,
  ReadingProgress,
  Bookmark,
  Annotation,
  UserSettings,
  BookSettings,
  BackupData,
  BackupBookContent,
} from '../../types/book';
import { sanitizeReaderHtml } from '../parsing/sanitize-reader-html';

const DB_NAME = 'webxreader';
const DB_VERSION = 1;
const SETTINGS_STORAGE_KEY = 'webxreader.preferences.v1';

function normalizeUserSettings(settings: Partial<UserSettings>): UserSettings {
  return { ...DEFAULT_SETTINGS, ...settings, id: 'global' };
}

function readLocalUserSettings(): UserSettings | undefined {
  try {
    const serialized = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!serialized) return undefined;
    const stored = JSON.parse(serialized) as UserSettings;
    return stored && typeof stored === 'object' ? normalizeUserSettings(stored) : undefined;
  } catch {
    return undefined;
  }
}

/** Store names */
const STORES = {
  books: 'books',
  bookContent: 'bookContent',
  progress: 'progress',
  bookmarks: 'bookmarks',
  annotations: 'annotations',
  settings: 'settings',
  bookSettings: 'bookSettings',
  covers: 'covers',
} as const;

type StoreName = (typeof STORES)[keyof typeof STORES];

/**
 * Opens the IndexedDB database with schema migrations.
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error(`Failed to open database: ${request.error?.message}`));
    };

    request.onblocked = () => {
      console.warn('Database open blocked: waiting for other connections to close');
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
      };
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        // Version 1: Initial schema
        const bookStore = db.createObjectStore(STORES.books, { keyPath: 'id' });
        bookStore.createIndex('title', 'title', { unique: false });
        bookStore.createIndex('author', 'author', { unique: false });
        bookStore.createIndex('contentHash', 'contentHash', { unique: false });
        bookStore.createIndex('importedAt', 'importedAt', { unique: false });
        bookStore.createIndex('lastOpenedAt', 'lastOpenedAt', { unique: false });
        bookStore.createIndex('readingStatus', 'readingStatus', { unique: false });
        bookStore.createIndex('favorite', 'favorite', { unique: false });
        bookStore.createIndex('archived', 'archived', { unique: false });

        db.createObjectStore(STORES.bookContent, { keyPath: 'bookId' });

        db.createObjectStore(STORES.progress, { keyPath: 'bookId' });

        const bookmarkStore = db.createObjectStore(STORES.bookmarks, { keyPath: 'id' });
        bookmarkStore.createIndex('bookId', 'bookId', { unique: false });

        const annotationStore = db.createObjectStore(STORES.annotations, { keyPath: 'id' });
        annotationStore.createIndex('bookId', 'bookId', { unique: false });

        db.createObjectStore(STORES.settings, { keyPath: 'id' });

        db.createObjectStore(STORES.bookSettings, { keyPath: 'bookId' });

        db.createObjectStore(STORES.covers, { keyPath: 'bookId' });
      }
    };
  });
}

/** Cached database instance */
let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Gets or creates the database instance.
 */
async function getDb(): Promise<IDBDatabase> {
  if (dbInstance) {
    return dbInstance;
  }
  if (!dbPromise) {
    dbPromise = openDatabase()
      .then((db) => {
        dbInstance = db;
        dbInstance.onclose = () => {
          dbInstance = null;
          dbPromise = null;
        };
        return db;
      })
      .catch((err) => {
        dbPromise = null;
        throw err;
      });
  }
  return dbPromise;
}

/**
 * Generic helper to perform a single-store transaction.
 */
async function withTransaction<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result: T;
    const request = operation(store);
    
    request.onsuccess = () => {
      result = request.result;
      if (mode === 'readonly') {
        resolve(result);
      }
    };
    tx.oncomplete = () => {
      if (mode !== 'readonly') {
        resolve(result);
      }
    };
    request.onerror = () => reject(new Error(`Transaction failed: ${request.error?.message}`));
    tx.onerror = () => reject(new Error(`Transaction error: ${tx.error?.message}`));
    tx.onabort = () => reject(new Error(`Transaction aborted: ${tx.error?.message}`));
  });
}

/**
 * Helper to get all records from a store, optionally filtered by index.
 */
async function getAllFromStore<T>(
  storeName: StoreName,
  indexName?: string,
  query?: IDBValidKey | IDBKeyRange
): Promise<T[]> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const target = indexName ? store.index(indexName) : store;
    const request = target.getAll(query);

    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(new Error(`Failed to get records: ${request.error?.message}`));
  });
}

// ============================================================
// Book Operations
// ============================================================

export async function getBook(id: string): Promise<Book | undefined> {
  return withTransaction<Book | undefined>(STORES.books, 'readonly', (store) => store.get(id));
}

export async function listBooks(): Promise<Book[]> {
  return getAllFromStore<Book>(STORES.books);
}

export async function addBook(book: Book): Promise<void> {
  await withTransaction(STORES.books, 'readwrite', (store) => store.add(book));
}

export async function updateBook(book: Book): Promise<void> {
  await withTransaction(STORES.books, 'readwrite', (store) => store.put(book));
}

/** Persist edited book metadata and its cover together so cleared covers do not reappear. */
export async function updateBookAndCover(book: Book, coverData?: string): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORES.books, STORES.covers], 'readwrite');
    tx.objectStore(STORES.books).put(book);
    if (coverData) {
      tx.objectStore(STORES.covers).put({ bookId: book.id, data: coverData });
    } else {
      tx.objectStore(STORES.covers).delete(book.id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(`Failed to save book details: ${tx.error?.message ?? 'transaction failed'}`));
    tx.onabort = () => reject(new Error(`Book details were not saved: ${tx.error?.message ?? 'transaction aborted'}`));
  });
}

/** Persist a book, its content, and optional cover in one transaction. */
export async function saveBookBundle(
  book: Book,
  content: BookContent,
  coverData?: string,
): Promise<void> {
  const db = await getDb();
  const storeNames: StoreName[] = coverData
    ? [STORES.books, STORES.bookContent, STORES.covers]
    : [STORES.books, STORES.bookContent];

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, 'readwrite');
    tx.objectStore(STORES.books).add(book);
    tx.objectStore(STORES.bookContent).add(content);
    if (coverData) {
      tx.objectStore(STORES.covers).put({ bookId: book.id, data: coverData });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(`Failed to save book: ${tx.error?.message ?? 'transaction failed'}`));
    tx.onabort = () => reject(new Error(`Book import was rolled back: ${tx.error?.message ?? 'transaction aborted'}`));
  });
}

export async function deleteBook(id: string): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [STORES.books, STORES.bookContent, STORES.progress, STORES.bookmarks, STORES.annotations, STORES.bookSettings, STORES.covers],
      'readwrite'
    );

    tx.objectStore(STORES.books).delete(id);
    tx.objectStore(STORES.bookContent).delete(id);
    tx.objectStore(STORES.progress).delete(id);
    tx.objectStore(STORES.bookSettings).delete(id);
    tx.objectStore(STORES.covers).delete(id);

    // Delete all bookmarks for this book
    const bookmarkIndex = tx.objectStore(STORES.bookmarks).index('bookId');
    const bookmarkCursor = bookmarkIndex.openCursor(IDBKeyRange.only(id));
    bookmarkCursor.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    // Delete all annotations for this book
    const annotationIndex = tx.objectStore(STORES.annotations).index('bookId');
    const annotationCursor = annotationIndex.openCursor(IDBKeyRange.only(id));
    annotationCursor.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(`Failed to delete book: ${tx.error?.message}`));
  });
}

export async function findBookByHash(contentHash: string): Promise<Book | undefined> {
  const books = await getAllFromStore<Book>(STORES.books, 'contentHash', contentHash);
  return books[0];
}

// ============================================================
// Book Content Operations
// ============================================================

export async function getBookContent(bookId: string): Promise<BookContent | undefined> {
  const content = await withTransaction<BookContent | undefined>(STORES.bookContent, 'readonly', (store) => store.get(bookId));
  if (content && content.originalFile && content.format === 'mht') {
    delete content.originalFile;
    withTransaction(STORES.bookContent, 'readwrite', (store) => store.put(content)).catch(() => {});
  }
  return content;
}

export async function saveBookContent(content: BookContent): Promise<void> {
  await withTransaction(STORES.bookContent, 'readwrite', (store) => store.put(content));
}

// ============================================================
// Cover Operations
// ============================================================

export async function getCover(bookId: string): Promise<{ bookId: string; data: string } | undefined> {
  return withTransaction(STORES.covers, 'readonly', (store) => store.get(bookId));
}

export async function saveCover(bookId: string, data: string): Promise<void> {
  await withTransaction(STORES.covers, 'readwrite', (store) => store.put({ bookId, data }));
}

// ============================================================
// Reading Progress Operations
// ============================================================

export async function getProgress(bookId: string): Promise<ReadingProgress | undefined> {
  return withTransaction<ReadingProgress | undefined>(STORES.progress, 'readonly', (store) => store.get(bookId));
}

export async function saveProgress(progress: ReadingProgress): Promise<void> {
  await withTransaction(STORES.progress, 'readwrite', (store) => store.put(progress));
}

export async function listProgress(): Promise<ReadingProgress[]> {
  return getAllFromStore<ReadingProgress>(STORES.progress);
}

// ============================================================
// Bookmark Operations
// ============================================================

export async function listBookmarks(bookId: string): Promise<Bookmark[]> {
  return getAllFromStore<Bookmark>(STORES.bookmarks, 'bookId', bookId);
}

export async function saveBookmark(bookmark: Bookmark): Promise<void> {
  await withTransaction(STORES.bookmarks, 'readwrite', (store) => store.put(bookmark));
}

export async function deleteBookmark(id: string): Promise<void> {
  await withTransaction(STORES.bookmarks, 'readwrite', (store) => store.delete(id));
}

// ============================================================
// Annotation Operations
// ============================================================

export async function listAnnotations(bookId: string): Promise<Annotation[]> {
  return getAllFromStore<Annotation>(STORES.annotations, 'bookId', bookId);
}

export async function saveAnnotation(annotation: Annotation): Promise<void> {
  await withTransaction(STORES.annotations, 'readwrite', (store) => store.put(annotation));
}

export async function deleteAnnotation(id: string): Promise<void> {
  await withTransaction(STORES.annotations, 'readwrite', (store) => store.delete(id));
}

// ============================================================
// General preferences (localStorage, with legacy IndexedDB migration/fallback)
// ============================================================

export async function getSettings(): Promise<UserSettings | undefined> {
  const localSettings = readLocalUserSettings();
  if (localSettings) return localSettings;

  const legacySettings = await withTransaction<UserSettings | undefined>(
    STORES.settings,
    'readonly',
    (store) => store.get('global')
  );

  // A preference may have been saved while the legacy IndexedDB read was pending.
  const newerLocalSettings = readLocalUserSettings();
  if (newerLocalSettings) return newerLocalSettings;
  if (!legacySettings) return undefined;

  const migratedSettings = normalizeUserSettings(legacySettings);
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(migratedSettings));
    await withTransaction(STORES.settings, 'readwrite', (store) => store.delete('global'));
  } catch {
    // Keep the legacy record if migration cannot be completed.
  }
  return migratedSettings;
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  const preferences = normalizeUserSettings(settings);
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preserve preferences in IndexedDB if localStorage is unavailable.
    await withTransaction(STORES.settings, 'readwrite', (store) => store.put(preferences));
  }
}

export async function clearSettings(): Promise<void> {
  try {
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
  } catch {
    // ignore
  }
  await withTransaction(STORES.settings, 'readwrite', (store) => store.clear());
}

export async function getBookSettings(bookId: string): Promise<BookSettings | undefined> {
  return withTransaction<BookSettings | undefined>(STORES.bookSettings, 'readonly', (store) => store.get(bookId));
}

export async function saveBookSettings(settings: BookSettings): Promise<void> {
  await withTransaction(STORES.bookSettings, 'readwrite', (store) => store.put(settings));
}

// ============================================================
// Backup & Export Operations
// ============================================================

export async function exportBackup(): Promise<BackupData> {
  const [db, settings] = await Promise.all([getDb(), getSettings()]);
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [STORES.books, STORES.bookContent, STORES.progress, STORES.bookmarks, STORES.annotations, STORES.bookSettings],
      'readonly'
    );

    const results: Partial<BackupData> = {
      version: 2,
      exportedAt: Date.now(),
      appVersion: '1.0.0',
      settings,
    };

    const requests = [
      { store: STORES.books, key: 'books' as const },
      { store: STORES.progress, key: 'progress' as const },
      { store: STORES.bookmarks, key: 'bookmarks' as const },
      { store: STORES.annotations, key: 'annotations' as const },
      { store: STORES.bookSettings, key: 'bookSettings' as const },
    ];

    let completed = 0;
    const total = requests.length + 1; // content
    const complete = () => {
      completed++;
      if (completed === total) resolve(results as BackupData);
    };

    for (const { store, key } of requests) {
      const request = tx.objectStore(store).getAll();
      request.onsuccess = () => {
        (results as Record<string, unknown>)[key] = request.result;
        complete();
      };
      request.onerror = () => reject(new Error(`Backup export failed: ${request.error?.message ?? 'read failed'}`));
    }

    const contentReq = tx.objectStore(STORES.bookContent).getAll();
    contentReq.onsuccess = () => {
      results.contents = (contentReq.result as BookContent[]).map(serializeBookContent);
      complete();
    }
    contentReq.onerror = () => reject(new Error(`Backup export failed: ${contentReq.error?.message ?? 'content read failed'}`));

    tx.onerror = () => reject(new Error(`Backup export failed: ${tx.error?.message ?? 'transaction failed'}`));
  });
}

function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function serializeBookContent(content: BookContent): BackupBookContent {
  return {
    bookId: content.bookId,
    format: content.format,
    rawText: content.rawText,
    chapters: content.chapters,
    originalFileBase64: content.originalFile ? toBase64(content.originalFile) : undefined,
  };
}

function deserializeBookContent(content: BackupBookContent): BookContent {
  return {
    bookId: content.bookId,
    format: content.format,
    rawText: content.rawText,
    chapters: content.chapters?.map(sanitizeRestoredChapter),
    originalFile: content.originalFileBase64 ? fromBase64(content.originalFileBase64) : undefined,
  };
}

const BOOK_FORMATS: readonly BookFormat[] = ['epub', 'txt', 'markdown', 'html', 'pdf', 'cbz', 'cbr', 'cb7', 'rtf', 'fb2', 'mobi', 'azw3', 'docx', 'doc', 'djvu', 'mht', 'zip', 'rar'];

function isBookFormat(value: unknown): value is BookFormat {
  return typeof value === 'string' && BOOK_FORMATS.includes(value as BookFormat);
}

function isBackupChapter(value: unknown, depth = 0): value is Chapter {
  if (!value || typeof value !== 'object' || depth > 100) return false;
  const chapter = value as Partial<Chapter>;
  return (
    typeof chapter.id === 'string' &&
    typeof chapter.title === 'string' &&
    Number.isFinite(chapter.level) &&
    Number.isFinite(chapter.order) &&
    (chapter.content === undefined || typeof chapter.content === 'string') &&
    (chapter.href === undefined || typeof chapter.href === 'string') &&
    (chapter.children === undefined ||
      (Array.isArray(chapter.children) && chapter.children.every((child) => isBackupChapter(child, depth + 1))))
  );
}

function isBackupBookContent(value: unknown): value is BackupBookContent {
  if (!value || typeof value !== 'object') return false;
  const content = value as Partial<BackupBookContent>;
  return (
    typeof content.bookId === 'string' && content.bookId.length > 0 &&
    isBookFormat(content.format) &&
    (content.rawText === undefined || typeof content.rawText === 'string') &&
    (content.chapters === undefined ||
      (Array.isArray(content.chapters) && content.chapters.every((chapter) => isBackupChapter(chapter)))) &&
    (content.originalFileBase64 === undefined || typeof content.originalFileBase64 === 'string')
  );
}

function sanitizeRestoredChapter(chapter: Chapter): Chapter {
  return {
    id: chapter.id,
    title: chapter.title,
    content: chapter.content === undefined ? undefined : sanitizeReaderHtml(chapter.content),
    href: chapter.href,
    level: chapter.level,
    order: chapter.order,
    children: chapter.children?.map(sanitizeRestoredChapter),
  };
}

function isBackupObject(value: unknown): value is BackupData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BackupData>;
  return (
    (candidate.version === 1 || candidate.version === 2) &&
    typeof candidate.exportedAt === 'number' &&
    Array.isArray(candidate.books) &&
    Array.isArray(candidate.progress) &&
    Array.isArray(candidate.bookmarks) &&
    Array.isArray(candidate.annotations) &&
    Array.isArray(candidate.bookSettings) &&
    (candidate.contents === undefined || Array.isArray(candidate.contents))
  );
}

function isBookRecord(value: unknown): value is Book {
  if (!value || typeof value !== 'object') return false;
  const book = value as Partial<Book>;
  return (
    typeof book.id === 'string' &&
    typeof book.title === 'string' &&
    typeof book.contentHash === 'string' &&
    typeof book.sourceFormat === 'string'
  );
}

function hasBookId(value: unknown): value is { bookId: string } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { bookId?: unknown }).bookId === 'string' &&
    (value as { bookId: string }).bookId.length > 0,
  );
}

export async function restoreBackup(backup: BackupData): Promise<{ booksRestored: number; errors: string[] }> {
  if (!isBackupObject(backup)) {
    throw new Error('Invalid or unsupported backup format');
  }

  const errors: string[] = [];
  const existingBooks = await listBooks();
  const existingIds = new Set(existingBooks.map((book) => book.id));
  const existingHashes = new Set(existingBooks.map((book) => book.contentHash));
  const booksToRestore: Book[] = [];

  for (const candidate of backup.books) {
    if (!isBookRecord(candidate)) {
      errors.push('Skipped an invalid book record');
      continue;
    }
    if (existingIds.has(candidate.id)) {
      errors.push(`Book "${candidate.title}" already exists, skipped`);
      continue;
    }
    if (candidate.contentHash && existingHashes.has(candidate.contentHash)) {
      errors.push(`Book "${candidate.title}" has matching content already in the library, skipped`);
      continue;
    }
    booksToRestore.push(candidate);
    existingIds.add(candidate.id);
    existingHashes.add(candidate.contentHash);
  }

  const restorableIds = new Set(booksToRestore.map((book) => book.id));
  const contentRecords = new Map<string, BookContent>();
  for (const candidate of backup.contents ?? []) {
    if (!isBackupBookContent(candidate)) {
      throw new Error('Invalid content payload in backup');
    }
    try {
      contentRecords.set(candidate.bookId, deserializeBookContent(candidate));
    } catch {
      throw new Error(`Invalid content payload for book "${candidate.bookId}"`);
    }
  }
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [STORES.books, STORES.bookContent, STORES.progress, STORES.bookmarks, STORES.annotations, STORES.bookSettings],
      'readwrite'
    );

    for (const book of booksToRestore) {
      tx.objectStore(STORES.books).put(book);
      const content = contentRecords.get(book.id);
      if (content) {
        tx.objectStore(STORES.bookContent).put(content);
      } else if (backup.version === 1) {
        errors.push(`Backup does not contain content for "${book.title}"`);
      }
    }

    for (const progress of backup.progress) {
      if (hasBookId(progress) && restorableIds.has(progress.bookId)) {
        tx.objectStore(STORES.progress).put(progress);
      }
    }
    for (const bookmark of backup.bookmarks) {
      if (hasBookId(bookmark) && restorableIds.has(bookmark.bookId)) {
        tx.objectStore(STORES.bookmarks).put(bookmark);
      }
    }
    for (const annotation of backup.annotations) {
      if (hasBookId(annotation) && restorableIds.has(annotation.bookId)) {
        tx.objectStore(STORES.annotations).put(annotation);
      }
    }
    for (const bookSetting of backup.bookSettings) {
      if (hasBookId(bookSetting) && restorableIds.has(bookSetting.bookId)) {
        tx.objectStore(STORES.bookSettings).put(bookSetting);
      }
    }
    tx.oncomplete = () => {
      if (backup.settings) {
        saveSettings(backup.settings)
          .then(() => resolve({ booksRestored: booksToRestore.length, errors }))
          .catch(reject);
        return;
      }
      resolve({ booksRestored: booksToRestore.length, errors });
    };
    tx.onerror = () => reject(new Error(`Backup restore failed: ${tx.error?.message ?? 'transaction failed'}`));
    tx.onabort = () => reject(new Error(`Backup restore was rolled back: ${tx.error?.message ?? 'transaction aborted'}`));
  });
}

/**
 * Gets an estimate of storage usage.
 */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
    };
  }
  return null;
}

/**
 * Requests persistent storage.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    return navigator.storage.persist();
  }
  return false;
}

/** Clears library and reading data while preserving general site preferences. */
export async function clearDatabase(): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const storeNames: StoreName[] = [
      STORES.books,
      STORES.bookContent,
      STORES.progress,
      STORES.bookmarks,
      STORES.annotations,
      STORES.bookSettings,
      STORES.covers,
    ].filter((name) => db.objectStoreNames.contains(name));
    const tx = db.transaction(storeNames, 'readwrite');
    for (const name of storeNames) {
      tx.objectStore(name).clear();
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(`Failed to clear database: ${tx.error?.message}`));
  });
}
