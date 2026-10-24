import { describe, it, expect, beforeEach } from 'vitest';
import {
  addBook,
  getBook,
  listBooks,
  updateBook,
  deleteBook,
  saveProgress,
  getProgress,
  getBookContent,
  saveBookContent,
  saveBookBundle,
  saveBookmark,
  listBookmarks,
  deleteBookmark,
  saveSettings,
  getSettings,
  exportBackup,
  restoreBackup,
  clearDatabase,
} from '../core/storage/database';
import type { Book, ReadingProgress, Bookmark, UserSettings } from '../types/book';

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

  it('saves and restores reading progress', async () => {
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
      theme: 'dark',
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
      libraryLayout: 'list',
      autoDetectChapters: true,
      importSizeWarningMB: 50,
      updatedAt: 1000,
    };
    await saveSettings(settings);

    const backup = await exportBackup();
    expect(backup.books.length).toBe(1);
    expect(backup.settings?.theme).toBe('dark');
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
    expect(restoredSettings?.theme).toBe('dark');
  });
});
