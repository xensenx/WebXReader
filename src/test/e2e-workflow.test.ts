import { describe, it, expect, beforeEach } from 'vitest';
import { importFile } from '../features/import/import-service';
import {
  listBooks,
  getBook,
  updateBook,
  saveProgress,
  getProgress,
  saveBookmark,
  listBookmarks,
  deleteBook,
  exportBackup,
  restoreBackup,
  clearDatabase,
} from '../core/storage/database';

describe('End-to-End Reading Workflow', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('executes the full lifecycle: import -> read -> bookmark -> backup -> restore -> delete', async () => {
    // 1. Launch with empty library
    const initialBooks = await listBooks();
    expect(initialBooks.length).toBe(0);

    // 2. Import a novel file
    const fileContent = `The Starlight Chronicle\nBy Elena Vance\n\nChapter 1: The Departure\n\nThe starship engines flared amber against the asteroid belt.\n\nChapter 2: The Void\n\nSilence enveloped the cockpit as hyperspace folded around them.`;
    const novelFile = new File([fileContent], 'starlight_chronicle.txt', { type: 'text/plain' });

    const importRes = await importFile(novelFile, { autoDetectChapters: true });
    expect(importRes.success).toBe(true);
    if (!importRes.success) return;

    const bookId = importRes.book.id;

    // 3. Verify book is in the library (includes preamble + 2 chapters)
    const libraryBooks = await listBooks();
    expect(libraryBooks.length).toBe(1);
    expect(libraryBooks[0].id).toBe(bookId);
    expect(libraryBooks[0].totalChapters).toBe(3);

    // 4. Update status to currently reading
    await updateBook({
      ...libraryBooks[0],
      readingStatus: 'reading',
      lastOpenedAt: Date.now(),
    });

    const readingBook = await getBook(bookId);
    expect(readingBook?.readingStatus).toBe('reading');

    // 5. Save reading progress
    await saveProgress({
      bookId,
      chapterId: importRes.book.tableOfContents[1]?.id || 'ch-2',
      chapterProgress: 0.4,
      overallProgress: 0.6,
      scrollPosition: 850,
      pageIndex: 5,
      readingMode: 'scroll',
      lastUpdatedAt: Date.now(),
    });

    const progress = await getProgress(bookId);
    expect(progress?.overallProgress).toBe(0.6);
    expect(progress?.scrollPosition).toBe(850);

    // 6. Create a bookmark
    await saveBookmark({
      id: 'bm-test-1',
      bookId,
      chapterId: 'ch-2',
      position: 0.6,
      selectedText: 'hyperspace folded around them',
      label: 'Hyperspace jump',
      createdAt: Date.now(),
    });

    const bookmarks = await listBookmarks(bookId);
    expect(bookmarks.length).toBe(1);
    expect(bookmarks[0].label).toBe('Hyperspace jump');

    // 7. Export backup
    const backup = await exportBackup();
    expect(backup.books.length).toBe(1);
    expect(backup.progress.length).toBe(1);
    expect(backup.bookmarks.length).toBe(1);

    // 8. Wipe database
    await clearDatabase();
    expect((await listBooks()).length).toBe(0);

    // 9. Restore backup
    const restoreResult = await restoreBackup(backup);
    expect(restoreResult.booksRestored).toBe(1);

    const restoredBooks = await listBooks();
    expect(restoredBooks.length).toBe(1);
    expect(restoredBooks[0].title).toBe('starlight chronicle');

    const restoredProgress = await getProgress(bookId);
    expect(restoredProgress?.overallProgress).toBe(0.6);

    const restoredBookmarks = await listBookmarks(bookId);
    expect(restoredBookmarks.length).toBe(1);

    // 10. Delete book
    await deleteBook(bookId);
    expect((await listBooks()).length).toBe(0);
    expect((await listBookmarks(bookId)).length).toBe(0);
    expect(await getProgress(bookId)).toBeUndefined();
  });
});
