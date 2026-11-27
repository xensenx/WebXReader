/**
 * IndexedDB storage abstraction for WebXReader.
 * Provides a typed interface over the library IndexedDB and separate browser-local preferences.
 */

import { normalizeLibraryName } from '../../features/library/library-name';
import { appendSeriesBooks, BOOK_COMPLETION_THRESHOLD, normalizeSeries, reorderSeriesVolumes } from '../../features/series/series';
import { APP_THEME_OPTIONS, DEFAULT_SETTINGS } from '../../types/book';
import type {
  Book,
  BookSeries,
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
import { sanitizeBookChapter } from '../parsing/sanitize-reader-html';
import { BROWSER_QUOTA_ERROR, MAX_JSON_BACKUP_BYTES, isStorageQuotaError, libraryLimitError, normalizeStorageLimit } from './storage-limits';

const DB_NAME = 'webxreader';
const DB_VERSION = 3;
const SETTINGS_STORAGE_KEY = 'webxreader.preferences.v1';

function normalizeUserSettings(settings: Omit<Partial<UserSettings>, 'theme'> & { theme?: unknown }): UserSettings {
  const savedTheme = settings.theme === 'light' ? 'dark' : settings.theme;
  const theme = APP_THEME_OPTIONS.find(({ value }) => value === savedTheme)?.value ?? DEFAULT_SETTINGS.theme;
  return {
    ...DEFAULT_SETTINGS, ...settings, theme, libraryName: normalizeLibraryName(settings.libraryName), id: 'global',
    importFileLimitBytes: normalizeStorageLimit(settings.importFileLimitBytes),
    librarySizeLimitBytes: normalizeStorageLimit(settings.librarySizeLimitBytes),
  };
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
  series: 'series',
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
      if (oldVersion < 2) {
        db.createObjectStore(STORES.series, { keyPath: 'id' })
          .createIndex('bookId', 'bookIds', { multiEntry: true, unique: true });
      }
      if (oldVersion < 3) {
        request.transaction!.objectStore(STORES.books).createIndex('fileSize', 'fileSize');
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

/** Read index keys so calculating usage never loads book metadata, covers or contents. */
function sumLibraryFileSizes(store: IDBObjectStore, onTotal: (bytes: number) => void) {
  const request = store.index('fileSize').openKeyCursor();
  let total = 0;
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor) {
      total += normalizeStorageLimit(cursor.key) ?? 0;
      cursor.continue();
    } else {
      onTotal(total);
    }
  };
  return request;
}

export async function getLibraryFileSize(): Promise<number> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.books, 'readonly');
    const request = sumLibraryFileSizes(tx.objectStore(STORES.books), resolve);
    request.onerror = () => reject(request.error ?? new Error('Could not calculate the library file size.'));
  });
}

/** Check the cap inside the same write transaction so concurrent imports share it. */
function writeWithinLibraryLimit(tx: IDBTransaction, incoming: number, limit: number | null, write: () => void) {
  let failure: unknown;
  const commit = () => {
    try {
      write();
    } catch (error) {
      failure = error;
      tx.abort();
    }
  };
  if (limit === null || incoming === 0) {
    commit();
  } else {
    sumLibraryFileSizes(tx.objectStore(STORES.books), (used) => {
      if (incoming <= limit - used) {
        commit();
      } else {
        failure = libraryLimitError(limit, used, incoming);
        tx.abort();
      }
    });
  }
  return () => failure ?? tx.error ?? new Error('The library write was rolled back.');
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
    const books = tx.objectStore(STORES.books);
    const request = books.get(book.id);
    request.onsuccess = () => {
      const latest = request.result as Book | undefined;
      if (!latest) { tx.abort(); return; }
      books.put({ ...latest,
        title: book.title, author: book.author, description: book.description,
        coverImage: book.coverImage, originalCoverImage: book.originalCoverImage,
        userTags: book.userTags, updatedAt: Date.now(),
      });
      if (coverData) {
        tx.objectStore(STORES.covers).put({ bookId: book.id, data: coverData });
      } else {
        tx.objectStore(STORES.covers).delete(book.id);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(`Failed to save book details: ${tx.error?.message ?? 'transaction failed'}`));
    tx.onabort = () => reject(new Error(`Book details were not saved: ${tx.error?.message ?? 'transaction aborted'}`));
  });
}

/** Record a cover scan for an older EPUB while preserving later edits and legacy cover records. */
export async function saveRecoveredEpubCover(bookId: string, coverImage?: string): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORES.books, STORES.covers], 'readwrite');
    const books = tx.objectStore(STORES.books);
    const covers = tx.objectStore(STORES.covers);
    const bookRequest = books.get(bookId);
    const coverRequest = covers.get(bookId);
    coverRequest.onsuccess = () => {
      const book = bookRequest.result as Book | undefined;
      if (book?.sourceFormat !== 'epub' || book.coverImage || book.originalCoverImage !== undefined || coverRequest.result?.data) return;
      if (coverImage) {
        books.put({ ...book, coverImage });
        covers.put({ bookId, data: coverImage });
      } else {
        books.put({ ...book, originalCoverImage: null });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Could not save recovered EPUB cover.'));
  });
}

/** Persist a book, its content, and optional cover in one transaction. */
export async function saveBookBundle(
  book: Book,
  content: StoredBookContent,
  coverData?: string,
  libraryLimit: number | null = null,
): Promise<void> {
  const db = await getDb();
  const storeNames: StoreName[] = coverData
    ? [STORES.books, STORES.bookContent, STORES.covers]
    : [STORES.books, STORES.bookContent];

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, 'readwrite');
    const getError = writeWithinLibraryLimit(tx, book.fileSize, libraryLimit, () => {
      tx.objectStore(STORES.books).add(book);
      tx.objectStore(STORES.bookContent).add(content);
      if (coverData) tx.objectStore(STORES.covers).put({ bookId: book.id, data: coverData });
    });
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(getError());
  });
}

export async function deleteBooks(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [STORES.books, STORES.bookContent, STORES.progress, STORES.bookmarks, STORES.annotations, STORES.bookSettings, STORES.covers, STORES.series],
      'readwrite'
    );

    const bookmarkStore = tx.objectStore(STORES.bookmarks);
    const bookmarkIndex = bookmarkStore.index('bookId');
    const annotationStore = tx.objectStore(STORES.annotations);
    const annotationIndex = annotationStore.index('bookId');
    const deletedIds = new Set(ids);
    const seriesRequest = tx.objectStore(STORES.series).openCursor();
    seriesRequest.onsuccess = () => {
      const cursor = seriesRequest.result;
      if (!cursor) return;
      const series = cursor.value as BookSeries;
      const bookIds = series.bookIds.filter((bookId) => !deletedIds.has(bookId));
      if (bookIds.length !== series.bookIds.length) cursor.update(normalizeSeries({ ...series, bookIds }));
      cursor.continue();
    };

    for (const id of ids) {
      tx.objectStore(STORES.books).delete(id);
      tx.objectStore(STORES.bookContent).delete(id);
      tx.objectStore(STORES.progress).delete(id);
      tx.objectStore(STORES.bookSettings).delete(id);
      tx.objectStore(STORES.covers).delete(id);

      // Delete all bookmarks for this book
      const bookmarkCursor = bookmarkIndex.openCursor(IDBKeyRange.only(id));
      bookmarkCursor.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      // Delete all annotations for this book
      const annotationCursor = annotationIndex.openCursor(IDBKeyRange.only(id));
      annotationCursor.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(`Failed to delete books: ${tx.error?.message ?? 'transaction failed'}`));
    tx.onabort = () => reject(new Error(`Failed to delete books: ${tx.error?.message ?? 'transaction aborted'}`));
  });
}

export async function deleteBook(id: string): Promise<void> {
  return deleteBooks([id]);
}

export async function findBookByHash(contentHash: string): Promise<Book | undefined> {
  const books = await getAllFromStore<Book>(STORES.books, 'contentHash', contentHash);
  return books[0];
}

// ============================================================
// Book Content Operations
// ============================================================

type StoredBookContent = Omit<BookContent, 'originalFile'> & { originalFile?: Blob | ArrayBuffer };

export async function getStoredBookContent(bookId: string): Promise<StoredBookContent | undefined> {
  const content = await withTransaction<StoredBookContent | undefined>(STORES.bookContent, 'readonly', (store) => store.get(bookId));
  if (content && content.originalFile && content.format === 'mht') {
    delete content.originalFile;
    withTransaction(STORES.bookContent, 'readwrite', (store) => store.put(content)).catch(() => {});
  }
  return content;
}

export async function getBookContent(bookId: string): Promise<BookContent | undefined> {
  const content = await getStoredBookContent(bookId);
  if (!content) return undefined;
  const { originalFile } = content;
  return { ...content, originalFile: originalFile instanceof Blob ? await originalFile.arrayBuffer() : originalFile };
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
  const db = await getDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORES.books, STORES.progress], 'readwrite');
    const books = tx.objectStore(STORES.books);
    const request = books.get(progress.bookId);
    request.onsuccess = () => {
      const book = request.result as Book | undefined;
      if (!book) return;
      tx.objectStore(STORES.progress).put(progress);
      const readingStatus = progress.overallProgress >= BOOK_COMPLETION_THRESHOLD ? 'completed'
        : progress.overallProgress > 0 ? 'reading' : book.readingStatus;
      const now = Date.now();
      if (readingStatus !== book.readingStatus || now - (book.lastOpenedAt ?? 0) > 30_000) {
        books.put({ ...book, readingStatus, lastOpenedAt: now, updatedAt: now });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(`Failed to save progress: ${tx.error?.message ?? 'transaction failed'}`));
    tx.onabort = () => reject(new Error(`Failed to save progress: ${tx.error?.message ?? 'transaction aborted'}`));
  });
}

export async function listProgress(): Promise<ReadingProgress[]> {
  return getAllFromStore<ReadingProgress>(STORES.progress);
}

export async function listSeries(): Promise<BookSeries[]> {
  return getAllFromStore<BookSeries>(STORES.series);
}

export async function getSeriesForBook(bookId: string): Promise<BookSeries | undefined> {
  return withTransaction(STORES.series, 'readonly', (store) => store.index('bookId').get(bookId));
}

export async function saveSeries(input: BookSeries): Promise<BookSeries> {
  return writeSeries({ series: normalizeSeries(input) });
}

export async function addBooksToSeries(seriesId: string, bookIds: readonly string[]): Promise<BookSeries> {
  return writeSeries({ seriesId, bookIds, kind: 'append' });
}

export async function reorderBooksInSeries(seriesId: string, bookIds: readonly string[]): Promise<BookSeries> {
  return writeSeries({ seriesId, bookIds, kind: 'reorder' });
}

async function writeSeries(change: { series: BookSeries } | { seriesId: string; bookIds: readonly string[]; kind: 'append' | 'reorder' }): Promise<BookSeries> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORES.books, STORES.series], 'readwrite');
    const store = tx.objectStore(STORES.series);
    const request = tx.objectStore(STORES.books).getAllKeys();
    let message = 'Could not save the series.';
    let saved: BookSeries;
    const abort = (reason: string) => {
      message = reason;
      tx.abort();
    };
    const write = (series: BookSeries) => {
      saved = series;
      const put = store.put(series);
      put.onerror = () => {
        if (put.error?.name === 'ConstraintError') message = 'A selected book already belongs to another series.';
      };
    };
    request.onsuccess = () => {
      const availableIds = new Set(request.result);
      const bookIds = 'series' in change ? change.series.bookIds : change.bookIds;
      if (bookIds.some((bookId) => !availableIds.has(bookId))) {
        abort('A selected book has been deleted. Refresh the page and try again.');
        return;
      }
      if ('series' in change) {
        write(change.series);
        return;
      }
      // Read and update in one transaction so additions and metadata edits cannot be lost.
      const current = store.get(change.seriesId);
      current.onsuccess = () => {
        if (!current.result) {
          abort('This series has been deleted. Choose another series.');
          return;
        }
        try {
          const update = change.kind === 'reorder' ? reorderSeriesVolumes : appendSeriesBooks;
          write(update(current.result, bookIds));
        } catch (error) {
          abort(error instanceof Error ? error.message : message);
        }
      };
    };
    tx.oncomplete = () => resolve(saved);
    tx.onabort = () => reject(new Error(message));
  });
}

export async function deleteSeries(id: string): Promise<void> {
  await deleteSeriesBatch([id]);
}

export async function deleteSeriesBatch(ids: readonly string[]): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.series, 'readwrite');
    const store = tx.objectStore(STORES.series);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Could not delete the selected series.'));
  });
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
  const books = await listBooks();
  if (books.length > 1000 || books.reduce((sum, book) => sum + (book.fileSize || 0), 0) > MAX_JSON_BACKUP_BYTES) {
    throw new Error('Library exceeds the 100 MB JSON backup limit. Export books individually.');
  }
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [STORES.books, STORES.bookContent, STORES.progress, STORES.bookmarks, STORES.annotations, STORES.bookSettings, STORES.series],
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
      { store: STORES.series, key: 'series' as const },
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
      try {
        results.contents = (contentReq.result as StoredBookContent[]).map(serializeBookContent);
        complete();
      } catch (error) {
        reject(error);
      }
    }
    contentReq.onerror = () => reject(new Error(`Backup export failed: ${contentReq.error?.message ?? 'content read failed'}`));

    tx.onerror = () => reject(new Error(`Backup export failed: ${tx.error?.message ?? 'transaction failed'}`));
  });
}

/** Serialize one IndexedDB record at a time, preserving the version 2 JSON format. */
export async function exportBackupStream(): Promise<ReadableStream<Uint8Array>> {
  const [db, settings, books] = await Promise.all([getDb(), getSettings(), listBooks()]);
  if (books.length > 1000 || books.reduce((sum, book) => sum + (book.fileSize || 0), 0) > MAX_JSON_BACKUP_BYTES) {
    throw new Error('Library exceeds the 100 MB JSON backup limit. Export books individually.');
  }
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const stores = [
        [STORES.books, 'books'], [STORES.progress, 'progress'],
        [STORES.bookmarks, 'bookmarks'], [STORES.annotations, 'annotations'],
        [STORES.bookSettings, 'bookSettings'], [STORES.bookContent, 'contents'], [STORES.series, 'series'],
      ] as const;
      const tx = db.transaction(stores.map(([name]) => name), 'readonly');
      let emittedBytes = 0;
      let failed = false;
      const emit = (value: string) => {
        const bytes = encoder.encode(value);
        emittedBytes += bytes.byteLength;
        if (emittedBytes > 150 * 1024 * 1024) throw new Error('Backup exceeds the 150 MB output limit.');
        controller.enqueue(bytes);
      };
      try {
        emit(`{"version":2,"exportedAt":${Date.now()},"appVersion":"1.0.0","settings":${JSON.stringify(settings ?? null)},`);
      } catch (error) {
        controller.error(error);
        tx.abort();
        return;
      }
      const fail = (error: unknown) => {
        if (failed) return;
        failed = true;
        controller.error(error);
      };
      const readStore = (index: number) => {
        if (index === stores.length) {
          emit('}');
          return;
        }
        const [storeName, key] = stores[index];
        emit(`${index ? ',' : ''}"${key}":[`);
        let first = true;
        const request = tx.objectStore(storeName).openCursor();
        request.onsuccess = () => {
          try {
            const cursor = request.result;
            if (!cursor) {
              emit(']');
              readStore(index + 1);
              return;
            }
            const value = key === 'contents' ? serializeBookContent(cursor.value as StoredBookContent) : cursor.value;
            emit(`${first ? '' : ','}${JSON.stringify(value)}`);
            first = false;
            cursor.continue();
          } catch (error) {
            fail(error);
            tx.abort();
          }
        };
        request.onerror = () => fail(request.error ?? new Error('Backup read failed.'));
      };
      readStore(0);
      tx.oncomplete = () => { if (!failed) controller.close(); };
      tx.onerror = () => fail(tx.error ?? new Error('Backup export failed.'));
      tx.onabort = () => fail(tx.error ?? new Error('Backup export was cancelled.'));
    },
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

function serializeBookContent(content: StoredBookContent): BackupBookContent {
  if (content.originalFile instanceof Blob) {
    throw new Error('Library exceeds the 100 MB JSON backup limit. Export books individually.');
  }
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
    chapters: content.chapters?.map((chapter) => sanitizeRestoredChapter(chapter, content.format)),
    originalFile: content.originalFileBase64 ? fromBase64(content.originalFileBase64) : undefined,
  };
}

const BOOK_FORMATS: readonly BookFormat[] = ['epub', 'txt', 'markdown', 'html', 'pdf', 'cbz', 'cbr', 'cb7', 'rtf', 'fb2', 'mobi', 'azw3', 'docx', 'doc', 'djvu', 'mht', 'zip', 'rar', 'png', 'jpeg'];

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

function sanitizeRestoredChapter(chapter: Chapter, format: BookFormat): Chapter {
  return {
    id: chapter.id,
    title: chapter.title,
    content: chapter.content === undefined ? undefined : sanitizeBookChapter(chapter.content, format),
    href: chapter.href,
    level: chapter.level,
    order: chapter.order,
    children: chapter.children?.map((child) => sanitizeRestoredChapter(child, format)),
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
    (candidate.contents === undefined || Array.isArray(candidate.contents)) &&
    (candidate.series === undefined || Array.isArray(candidate.series))
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
  if (backup.books.length > 1000 || backup.progress.length > 1000 ||
      backup.bookmarks.length > 100000 || backup.annotations.length > 100000 ||
      backup.bookSettings.length > 1000 || (backup.contents?.length ?? 0) > 1000 ||
      (backup.series?.length ?? 0) > 1000) {
    throw new Error('Backup contains too many records.');
  }
  let decodedBytes = 0;
  let chapterCount = 0;
  for (const content of backup.contents ?? []) {
    if (!isBackupBookContent(content)) throw new Error('Invalid content payload in backup');
    decodedBytes += Math.ceil((content.originalFileBase64?.length ?? 0) * 3 / 4);
    decodedBytes += content.rawText?.length ?? 0;
    const stack = [...(content.chapters ?? [])];
    while (stack.length) {
      const chapter = stack.pop()!;
      chapterCount++;
      if (chapterCount > 100000) throw new Error('Backup contains too many chapters.');
      decodedBytes += chapter.content?.length ?? 0;
      if (chapter.children) for (const child of chapter.children) stack.push(child);
    }
    if (decodedBytes > MAX_JSON_BACKUP_BYTES) throw new Error('Backup content exceeds the 100 MB limit.');
  }

  const errors: string[] = [];
  const existingBooks = await listBooks();
  const existingIds = new Set(existingBooks.map((book) => book.id));
  const existingHashes = new Map(existingBooks.map((book) => [book.contentHash, book.id]));
  const bookIdRemap = new Map<string, string>();
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
    const matchingId = candidate.contentHash ? existingHashes.get(candidate.contentHash) : undefined;
    if (matchingId) {
      bookIdRemap.set(candidate.id, matchingId);
      errors.push(`Book "${candidate.title}" has matching content already in the library, skipped`);
      continue;
    }
    booksToRestore.push({ ...candidate });
    existingIds.add(candidate.id);
    existingHashes.set(candidate.contentHash, candidate.id);
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
  let incoming = 0;
  for (const book of booksToRestore) {
    const content = contentRecords.get(book.id);
    book.fileSize = Math.max(normalizeStorageLimit(book.fileSize) ?? 0, content?.originalFile?.byteLength ?? 0);
    incoming += book.fileSize;
  }
  const [db, currentSettings] = await Promise.all([getDb(), getSettings()]);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [STORES.books, STORES.bookContent, STORES.progress, STORES.bookmarks, STORES.annotations, STORES.bookSettings, STORES.series],
      'readwrite'
    );

    const limit = normalizeStorageLimit(currentSettings?.librarySizeLimitBytes);
    const getError = writeWithinLibraryLimit(tx, incoming, limit, () => {
      for (const book of booksToRestore) {
        tx.objectStore(STORES.books).add(book);
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
      if (backup.series?.length) restoreSeriesRecords(tx, backup.series, bookIdRemap, errors);
    });
    tx.oncomplete = () => {
      if (backup.settings) {
        saveSettings(backup.settings)
          .then(() => resolve({ booksRestored: booksToRestore.length, errors }))
          .catch(reject);
        return;
      }
      resolve({ booksRestored: booksToRestore.length, errors });
    };
    tx.onabort = () => {
      const error = getError();
      reject(isStorageQuotaError(error) ? new Error(BROWSER_QUOTA_ERROR) : error);
    };
  });
}

function restoreSeriesRecords(tx: IDBTransaction, candidates: BookSeries[], remap: Map<string, string>, errors: string[]) {
  const store = tx.objectStore(STORES.series);
  const books = tx.objectStore(STORES.books).getAllKeys();
  const request = store.getAll();
  request.onsuccess = () => {
    const existing = request.result as BookSeries[];
    const ids = new Set(existing.map(({ id }) => id));
    const occupied = new Set(existing.flatMap(({ bookIds }) => bookIds));
    const available = new Set(books.result);
    for (const candidate of candidates) {
      let series: BookSeries;
      try {
        if (candidate?.bookIds?.length > 1000) throw new Error('Too many books.');
        series = normalizeSeries(candidate);
      } catch {
        errors.push('Skipped an invalid series record');
        continue;
      }
      if (ids.has(series.id)) continue;
      const members = new Map<string, number | undefined>();
      for (const originalId of series.bookIds) {
        const bookId = remap.get(originalId) ?? originalId;
        if (available.has(bookId) && !occupied.has(bookId) && !members.has(bookId)) {
          members.set(bookId, series.volumeNumbers?.[originalId]);
        }
      }
      if (members.size !== series.bookIds.length) errors.push(`Skipped unavailable books in series "${series.title}"`);
      if (!members.size && series.bookIds.length) continue;
      const bookIds = [...members.keys()];
      const volumeNumbers = series.volumeNumbers
        ? Object.fromEntries([...members].filter(([, number]) => number !== undefined))
        : undefined;
      store.add({ ...series, bookIds, volumeNumbers });
      ids.add(series.id);
      for (const bookId of bookIds) occupied.add(bookId);
    }
  };
}

/**
 * Gets an estimate of storage usage.
 */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    const { usage, quota } = estimate ?? {};
    if (typeof usage === 'number' && Number.isFinite(usage) && usage >= 0 &&
        typeof quota === 'number' && Number.isFinite(quota) && quota > 0) return { usage, quota };
  } catch {
    // An estimate may be unavailable in private or restricted browser contexts.
  }
  return null;
}

export async function getStoragePersistence(): Promise<boolean | null> {
  try {
    return await navigator.storage?.persisted?.() ?? null;
  } catch {
    return null;
  }
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
      STORES.series,
    ].filter((name) => db.objectStoreNames.contains(name));
    const tx = db.transaction(storeNames, 'readwrite');
    for (const name of storeNames) {
      tx.objectStore(name).clear();
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(`Failed to clear database: ${tx.error?.message}`));
  });
}
