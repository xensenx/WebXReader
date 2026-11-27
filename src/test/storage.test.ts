import { renderHook, waitFor } from '@testing-library/react';
import { useSettings } from '../hooks/useSettings';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  addBook,
  getBook,
  listBooks,
  getLibraryFileSize,
  updateBook,
  updateBookAndCover,
  deleteBook,
  deleteBooks,
  saveProgress,
  getProgress,
  getBookContent,
  saveBookContent,
  saveBookBundle,
  saveRecoveredEpubCover,
  getCover,
  saveBookmark,
  listBookmarks,
  deleteBookmark,
  saveSettings,
  getSettings,
  exportBackup,
  restoreBackup,
  clearDatabase,
  clearSettings,
} from '../core/storage/database';
import { DEFAULT_SETTINGS, type Book, type ReadingProgress, type Bookmark, type UserSettings } from '../types/book';

describe('IndexedDB Storage Operations', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  const dummyBook: Book = {
    id: 'book-1',
    title: 'Test Novel',
    author: 'Test Author',
    description: 'A thrilling test book.',
    language: 'en',
    publisher: 'Test Press',
    publicationDate: '2026-01-01',
    identifiers: {},
    sourceFormat: 'txt',
    originalFilename: 'test.txt',
    fileSize: 1024,
    contentHash: 'hash-abc-123',
    importedAt: 1000,
    updatedAt: 1000,
    userTags: ['fantasy'],
    userRating: 5,
    favorite: false,
    archived: false,
    readingStatus: 'unread',
    lastOpenedAt: null,
    tableOfContents: [{ id: 'ch-1', title: 'Chapter 1', level: 0, order: 0 }],
    totalChapters: 1,
  };

  it('adds, gets, lists, updates, and deletes a book', async () => {
    await addBook(dummyBook);

    const retrieved = await getBook('book-1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.title).toBe('Test Novel');

    const all = await listBooks();
    expect(all.length).toBe(1);

    // Update
    await updateBook({ ...dummyBook, favorite: true, readingStatus: 'reading' });
    const updated = await getBook('book-1');
    expect(updated?.favorite).toBe(true);
    expect(updated?.readingStatus).toBe('reading');

    // Delete
    await deleteBook('book-1');
    const afterDelete = await getBook('book-1');
    expect(afterDelete).toBeUndefined();
  });

  it('rolls back the entire book bundle when metadata cannot be added', async () => {
    await addBook(dummyBook);
    await saveBookContent({ bookId: dummyBook.id, format: 'txt', rawText: 'original' });

    await expect(
      saveBookBundle(dummyBook, { bookId: dummyBook.id, format: 'txt', rawText: 'replacement' }),
    ).rejects.toThrow();

    expect((await getBookContent(dummyBook.id))?.rawText).toBe('original');
  });

  it('counts archived originals and enforces the same budget for concurrent writes', async () => {
    await addBook({ ...dummyBook, archived: true });
    const a = { ...dummyBook, id: 'a' };
    const b = { ...dummyBook, id: 'b' };
    const save = (book: Book) => saveBookBundle(book, { bookId: book.id, format: 'txt', rawText: book.id }, undefined, 2048);
    const results = await Promise.allSettled([save(a), save(b)]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(await getLibraryFileSize()).toBe(2048);
    expect(await listBooks()).toHaveLength(2);
    await deleteBook(dummyBook.id);
    await save(results[0].status === 'rejected' ? a : b);
    expect(await getLibraryFileSize()).toBe(2048);
  });

  it('leaves the library intact when a backup exceeds its budget', async () => {
    await addBook(dummyBook);
    const backup = await exportBackup();
    await clearDatabase();
    await saveSettings({ ...DEFAULT_SETTINGS, librarySizeLimitBytes: 1023 });
    try {
      await expect(restoreBackup(backup)).rejects.toThrow('library limit');
      expect(await listBooks()).toHaveLength(0);
      expect((await getSettings())?.librarySizeLimitBytes).toBe(1023);
    } finally {
      await clearSettings();
    }
  });

  it('saves and restores reading progress', async () => {
    await addBook(dummyBook);
    const prog: ReadingProgress = {
      bookId: 'book-1',
      chapterId: 'ch-1',
      chapterProgress: 0.5,
      overallProgress: 0.25,
      scrollPosition: 400,
      pageIndex: 2,
      readingMode: 'scroll',
      lastUpdatedAt: 1500,
    };

    await saveProgress(prog);
    const restored = await getProgress('book-1');
    expect(restored).toBeDefined();
    expect(restored?.overallProgress).toBe(0.25);
    expect(restored?.scrollPosition).toBe(400);
    expect((await getBook('book-1'))?.readingStatus).toBe('reading');
    await deleteBook('book-1');
    await saveProgress(prog);
    expect(await getProgress('book-1')).toBeUndefined();
  });

  it('preserves newer progress when stale metadata is saved', async () => {
    await addBook(dummyBook);
    const staleEdit = { ...dummyBook, title: 'Edited title' };
    await saveProgress({
      bookId: dummyBook.id, chapterId: 'ch-1', chapterProgress: 0.5,
      overallProgress: 0.5, scrollPosition: 0, pageIndex: 1,
      readingMode: 'scroll', lastUpdatedAt: Date.now(),
    });
    await updateBookAndCover(staleEdit);
    const stored = await getBook(dummyBook.id);
    expect(stored?.title).toBe('Edited title');
    expect(stored?.readingStatus).toBe('reading');
    expect(stored?.lastOpenedAt).not.toBeNull();
  });

  it('saves, lists, and deletes bookmarks', async () => {
    const bm: Bookmark = {
      id: 'bm-1',
      bookId: 'book-1',
      chapterId: 'ch-1',
      position: 0.35,
      selectedText: 'Some exciting passage',
      label: 'Great quote',
      createdAt: 2000,
    };

    await saveBookmark(bm);
    const list = await listBookmarks('book-1');
    expect(list.length).toBe(1);
    expect(list[0].label).toBe('Great quote');

    await deleteBookmark('bm-1');
    const afterDelete = await listBookmarks('book-1');
    expect(afterDelete.length).toBe(0);
  });

  it('starts new users in Midnight Blue and honors a saved Dark preference', async () => {
    const previousTheme = document.documentElement.getAttribute('data-theme');
    await clearSettings();
    try {
      const fresh = renderHook(() => useSettings());
      await waitFor(() => expect(fresh.result.current.loading).toBe(false));
      expect(fresh.result.current.settings.theme).toBe('midnight');
      expect(document.documentElement.dataset.theme).toBe('midnight');
      fresh.unmount();

      await saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' });
      const returning = renderHook(() => useSettings());
      await waitFor(() => expect(returning.result.current.loading).toBe(false));
      expect(returning.result.current.settings.theme).toBe('dark');
      expect(document.documentElement.dataset.theme).toBe('dark');
      returning.unmount();
    } finally {
      await clearSettings();
      if (previousTheme === null) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = previousTheme;
    }
  });

  it('maps removed Light preferences to Dark and keeps the other settings', async () => {
    const key = 'webxreader.preferences.v1';
    const previous = localStorage.getItem(key);
    try {
      localStorage.setItem(key, JSON.stringify({ theme: 'light', fontSize: 22, readerSheetColor: 'archive' }));
      expect(await getSettings()).toMatchObject({ theme: 'dark', fontSize: 22, readerSheetColor: 'archive' });
    } finally {
      if (previous === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previous);
    }
  });

  it.each(['solarized-dark', 'dark-orchid'] as const)('persists the %s theme', async (theme) => {
    const settings = await getSettings();
    await saveSettings({ ...DEFAULT_SETTINGS, ...settings, theme });
    expect((await getSettings())?.theme).toBe(theme);
  });

  it('recovers an old EPUB cover without overwriting existing cover choices', async () => {
    const recoverable = { ...dummyBook, sourceFormat: 'epub' as const };
    const custom = { ...recoverable, id: 'custom', coverImage: 'blob:custom' };
    const removed = { ...recoverable, id: 'removed', originalCoverImage: 'blob:original' };
    await Promise.all([addBook(recoverable), addBook(custom), addBook(removed)]);

    await Promise.all([recoverable, custom, removed].map(({ id }) => saveRecoveredEpubCover(id, 'blob:recovered')));

    expect((await getBook(recoverable.id))?.coverImage).toBe('blob:recovered');
    expect((await getCover(recoverable.id))?.data).toBe('blob:recovered');
    expect((await getBook(custom.id))?.coverImage).toBe('blob:custom');
    expect((await getBook(removed.id))?.coverImage).toBeUndefined();
  });

  it('exports and restores complete library backup', async () => {
    await addBook(dummyBook);
    await saveBookContent({
      bookId: dummyBook.id,
      format: 'txt',
      rawText: 'A complete local backup payload.',
      chapters: [{ id: 'ch-1', title: 'Chapter 1', content: '<p>A complete local backup payload.</p>', level: 0, order: 0 }],
    });
    const settings: UserSettings = {
      id: 'global',
      theme: 'midnight',
      libraryName: '  \u{1f4da} Reading Room  ',
      defaultReadingMode: 'paginated',
      fontFamily: 'Verdana',
      fontSize: 20,
      lineHeight: 1.8,
      paragraphSpacing: 1.2,
      letterSpacing: 0,
      wordSpacing: 0,
      textAlign: 'justify',
      textIndent: 1.5,
      maxContentWidth: 800,
      contentMargin: 32,
      readerSheetColor: 'paper',
      expandContent: false,
      libraryLayout: 'list',
      librarySortField: 'importedAt',
      librarySortDirection: 'desc',
      autoDetectChapters: true,
      importSizeWarningMB: 50,
      updatedAt: 1000,
    };
    await saveSettings(settings);

    const backup = await exportBackup();
    expect(backup.books.length).toBe(1);
    expect(backup.settings?.theme).toBe('midnight');
    expect(backup.settings?.libraryName).toBe('\u{1f4da} Reading Room');
    expect(backup.version).toBe(2);
    expect(backup.contents?.[0]?.rawText).toContain('complete local backup');

    // Clear db
    await clearDatabase();
    expect((await listBooks()).length).toBe(0);

    // Restore
    const restoreResult = await restoreBackup(backup);
    expect(restoreResult.booksRestored).toBe(1);

    const restoredBooks = await listBooks();
    expect(restoredBooks.length).toBe(1);
    expect(restoredBooks[0].title).toBe('Test Novel');
    expect((await getBookContent('book-1'))?.rawText).toContain('complete local backup');

    const restoredSettings = await getSettings();
    expect(restoredSettings?.theme).toBe('midnight');
    expect(restoredSettings?.libraryName).toBe('\u{1f4da} Reading Room');
  });

  it('atomically deletes multiple books and their associated progress and content in batch', async () => {
    const bookA: Book = { ...dummyBook, id: 'batch-book-a', title: 'Batch Book A' };
    const bookB: Book = { ...dummyBook, id: 'batch-book-b', title: 'Batch Book B' };
    await addBook(bookA);
    await addBook(bookB);
    await saveBookContent({ bookId: 'batch-book-a', format: 'txt', rawText: 'Content A' });
    await saveBookContent({ bookId: 'batch-book-b', format: 'txt', rawText: 'Content B' });
    await saveProgress({
      bookId: 'batch-book-a',
      chapterId: 'ch-1',
      chapterProgress: 0.5,
      overallProgress: 0.25,
      scrollPosition: 100,
      pageIndex: 0,
      readingMode: 'scroll',
      lastUpdatedAt: 1000,
    });
    await saveProgress({
      bookId: 'batch-book-b',
      chapterId: 'ch-1',
      chapterProgress: 0.5,
      overallProgress: 0.25,
      scrollPosition: 100,
      pageIndex: 0,
      readingMode: 'scroll',
      lastUpdatedAt: 1000,
    });

    expect((await listBooks()).length).toBe(2);

    await deleteBooks(['batch-book-a', 'batch-book-b']);

    expect((await listBooks()).length).toBe(0);
    expect(await getBookContent('batch-book-a')).toBeUndefined();
    expect(await getBookContent('batch-book-b')).toBeUndefined();
    expect(await getProgress('batch-book-a')).toBeUndefined();
    expect(await getProgress('batch-book-b')).toBeUndefined();
  });
});
