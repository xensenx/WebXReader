import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReadingProgress } from '../hooks/useReadingProgress';
import {
  addBook,
  saveProgress,
  getProgress,
  clearDatabase,
  getBook,
} from '../core/storage/database';
import type { Book, ReadingProgress } from '../types/book';

describe('useReadingProgress Hook', () => {
  const testBookId = 'progress-test-book';

  beforeEach(async () => {
    await clearDatabase();
    const book: Book = {
      id: testBookId,
      title: 'Progress Testing Novel',
      author: 'Tester',
      description: '',
      language: 'en',
      publisher: '',
      publicationDate: '',
      identifiers: {},
      sourceFormat: 'epub',
      originalFilename: 'novel.epub',
      contentHash: 'hash-test-1',
      fileSize: 1024,
      importedAt: Date.now(),
      updatedAt: Date.now(),
      tableOfContents: [],
      favorite: false,
      archived: false,
      readingStatus: 'unread',
      userTags: [],
      userRating: 0,
      lastOpenedAt: null,
      totalChapters: 0,
    };
    await addBook(book);
  });

  afterEach(async () => {
    await clearDatabase();
  });

  it('loads existing progress on mount', async () => {
    const existingProgress: ReadingProgress = {
      bookId: testBookId,
      chapterId: 'chapter-2',
      chapterProgress: 0.5,
      overallProgress: 0.25,
      scrollPosition: 1200,
      pageIndex: 10,
      readingMode: 'scroll',
      lastUpdatedAt: Date.now(),
    };
    await saveProgress(existingProgress);

    const { result } = renderHook(() => useReadingProgress(testBookId));

    expect(result.current.loading).toBe(true);

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.progress?.chapterId).toBe('chapter-2');
    expect(result.current.progress?.overallProgress).toBe(0.25);
    expect(result.current.getCurrentProgress()?.pageIndex).toBe(10);
  });

  it('updates progress synchronously in memory and persists via flush()', async () => {
    const { result } = renderHook(() => useReadingProgress(testBookId));

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.updateProgress({
        chapterId: 'ch-5',
        overallProgress: 0.45,
        pageIndex: 22,
      });
    });

    // In-memory ref updates immediately
    expect(result.current.getCurrentProgress()?.chapterId).toBe('ch-5');
    expect(result.current.getCurrentProgress()?.overallProgress).toBe(0.45);

    // Explicit flush writes to IndexedDB
    act(() => {
      result.current.flush();
    });

    await vi.waitFor(async () => {
      const persisted = await getProgress(testBookId);
      expect(persisted?.chapterId).toBe('ch-5');
      expect(persisted?.pageIndex).toBe(22);
      const book = await getBook(testBookId);
      expect(book?.readingStatus).toBe('reading');
    });
  });

  it('marks book as completed when overallProgress reaches 0.98+', async () => {
    const { result } = renderHook(() => useReadingProgress(testBookId));

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.updateProgress({
        overallProgress: 0.99,
      });
      result.current.flush();
    });

    await vi.waitFor(async () => {
      const book = await getBook(testBookId);
      expect(book?.readingStatus).toBe('completed');
    });
  });

  it('flushes pending debounced progress on unmount', async () => {
    const { result, unmount } = renderHook(() => useReadingProgress(testBookId));

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.updateProgress({
        chapterId: 'final-chapter',
        overallProgress: 0.8,
      });
    });

    // Unmount before 2s debounce timer expires
    unmount();

    await vi.waitFor(async () => {
      const persisted = await getProgress(testBookId);
      expect(persisted?.chapterId).toBe('final-chapter');
      expect(persisted?.overallProgress).toBe(0.8);
    });
  });
});
