/**
 * Custom hook for managing reading progress with debounced persistence.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ReadingProgress } from '../types/book';
import { getProgress, saveProgress, getBook, updateBook } from '../core/storage/database';
import { debounce } from '../utils';

interface UseReadingProgressResult {
  progress: ReadingProgress | null;
  loading: boolean;
  updateProgress: (partial: Partial<ReadingProgress>) => void;
  flush: () => void;
  getCurrentProgress: () => ReadingProgress | null;
}

export function useReadingProgress(bookId: string): UseReadingProgressResult {
  const [progress, setProgress] = useState<ReadingProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const progressRef = useRef<ReadingProgress | null>(null);
  const mountedRef = useRef(true);

  // Keep ref in sync with state
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  // Persist progress to IndexedDB
  const persistProgress = useCallback(async (p: ReadingProgress) => {
    try {
      await saveProgress(p);

      // Update book's lastOpenedAt and readingStatus
      const book = await getBook(p.bookId);
      if (book) {
        let statusChanged = false;
        const newStatus = p.overallProgress >= 0.98 ? 'completed' :
                          p.overallProgress > 0 ? 'reading' : book.readingStatus;

        if (newStatus !== book.readingStatus) {
          statusChanged = true;
        }

        if (statusChanged || Date.now() - (book.lastOpenedAt ?? 0) > 30_000) {
          await updateBook({
            ...book,
            lastOpenedAt: Date.now(),
            readingStatus: newStatus,
            updatedAt: Date.now(),
          });
        }
      }
    } catch (err) {
      console.error('Failed to persist reading progress:', err);
    }
  }, []);

  // Debounced save (2 second delay)
  const debouncedSave = useMemo(
    () => debounce((...args: unknown[]) => {
      const p = args[0] as ReadingProgress;
      persistProgress(p);
    }, 2000),
    [persistProgress]
  );

  // Load progress on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProgress(null);
    progressRef.current = null;

    async function load() {
      try {
        const saved = await getProgress(bookId);
        if (!cancelled) {
          progressRef.current = saved ?? null;
          setProgress(saved ?? null);
        }
      } catch (err) {
        console.error('Failed to load reading progress:', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      debouncedSave.flush();
      debouncedSave.cancel();
    };
  }, [bookId, debouncedSave]);

  // Cleanup on unmount: flush pending and cancel debounce
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      debouncedSave.flush();
      debouncedSave.cancel();
    };
  }, [debouncedSave]);

  const updateProgressFn = useCallback(
    (partial: Partial<ReadingProgress>) => {
      const base: ReadingProgress = progressRef.current ?? {
        bookId,
        chapterId: '',
        chapterProgress: 0,
        overallProgress: 0,
        scrollPosition: 0,
        pageIndex: 0,
        readingMode: 'scroll',
        lastUpdatedAt: Date.now(),
      };
      const updated: ReadingProgress = {
        ...base,
        ...partial,
        bookId,
        lastUpdatedAt: Date.now(),
      };
      progressRef.current = updated;

      // Only trigger a React state update if integer percent, chapter, or page changed
      const prevPercent = Math.round((base.overallProgress || 0) * 100);
      const newPercent = Math.round((updated.overallProgress || 0) * 100);
      const chapterChanged = base.chapterId !== updated.chapterId;
      const pageChanged = base.pageIndex !== updated.pageIndex;

      if (prevPercent !== newPercent || chapterChanged || pageChanged) {
        setProgress(updated);
      }

      debouncedSave(updated);
    },
    [bookId, debouncedSave]
  );

  const flush = useCallback(() => {
    debouncedSave.flush();
  }, [debouncedSave]);

  const getCurrentProgress = useCallback(() => progressRef.current, []);

  return { progress, loading, updateProgress: updateProgressFn, flush, getCurrentProgress };
}
