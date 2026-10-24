/**
 * Custom hook for managing bookmarks for a specific book.
 */

import { useState, useEffect, useCallback } from 'react';
import type { Bookmark } from '../types/book';
import { listBookmarks, saveBookmark, deleteBookmark as removeBookmarkDb } from '../core/storage/database';
import { generateId } from '../utils';

interface UseBookmarksResult {
  bookmarks: Bookmark[];
  loading: boolean;
  addBookmark: (data: Omit<Bookmark, 'id' | 'bookId' | 'createdAt'>) => Promise<Bookmark>;
  removeBookmark: (id: string) => Promise<void>;
  updateBookmark: (id: string, partial: Partial<Pick<Bookmark, 'label' | 'selectedText'>>) => Promise<void>;
}

export function useBookmarks(bookId: string): UseBookmarksResult {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);

  // Load bookmarks on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBookmarks([]);

    async function load() {
      try {
        const saved = await listBookmarks(bookId);
        if (!cancelled) {
          setBookmarks(saved.sort((a, b) => a.createdAt - b.createdAt));
        }
      } catch (err) {
        console.error('Failed to load bookmarks:', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const addBookmark = useCallback(
    async (data: Omit<Bookmark, 'id' | 'bookId' | 'createdAt'>): Promise<Bookmark> => {
      const bookmark: Bookmark = {
        ...data,
        id: generateId(),
        bookId,
        createdAt: Date.now(),
      };
      await saveBookmark(bookmark);
      setBookmarks((prev) => [...prev, bookmark].sort((a, b) => a.createdAt - b.createdAt));
      return bookmark;
    },
    [bookId]
  );

  const removeBookmark = useCallback(async (id: string) => {
    await removeBookmarkDb(id);
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const updateBookmark = useCallback(
    async (id: string, partial: Partial<Pick<Bookmark, 'label' | 'selectedText'>>) => {
      setBookmarks((prev) => {
        const updated = prev.map((b) => {
          if (b.id === id) {
            const newBookmark = { ...b, ...partial };
            // Persist asynchronously
            saveBookmark(newBookmark).catch((err) =>
              console.error('Failed to update bookmark:', err)
            );
            return newBookmark;
          }
          return b;
        });
        return updated;
      });
    },
    []
  );

  return { bookmarks, loading, addBookmark, removeBookmark, updateBookmark };
}
