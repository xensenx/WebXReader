/**
 * Custom hook for managing the books collection.
 * Loads books from IndexedDB and provides CRUD operations.
 */

import { useState, useEffect, useCallback } from 'react';
import type { Book, ReadingStatus } from '../types/book';
import { listBooks, listProgress, deleteBook, deleteBooks, updateBook, getCover } from '../core/storage/database';

export type LibraryBook = Book & {
  /** Derived from the progress store; never used as the persisted book value. */
  readingProgress: number;
};

interface UseBooksResult {
  books: LibraryBook[];
  loading: boolean;
  error: string | null;
  refreshBooks: () => Promise<void>;
  removeBook: (id: string) => Promise<void>;
  removeBooks: (ids: string[]) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  updateReadingStatus: (id: string, status: ReadingStatus) => Promise<void>;
  toggleArchive: (id: string) => Promise<void>;
}

let cachedBooks: LibraryBook[] | null = null;

export function invalidateBooksCache(): void {
  cachedBooks = null;
}

export function useBooks(): UseBooksResult {
  const [books, setBooks] = useState<LibraryBook[]>(() => cachedBooks ?? []);
  const [loading, setLoading] = useState(() => cachedBooks === null);
  const [error, setError] = useState<string | null>(null);

  const refreshBooks = useCallback(async () => {
    try {
      if (!cachedBooks) {
        setLoading(true);
      }
      setError(null);
      const [allBooks, allProgress] = await Promise.all([listBooks(), listProgress()]);
      const progressByBook = new Map(allProgress.map((progress) => [progress.bookId, progress.overallProgress]));
      const booksWithCovers = await Promise.all(
        allBooks.map(async (book) => {
          const readingProgress = book.readingStatus === 'completed'
            ? 1
            : progressByBook.get(book.id) ?? 0;
          const withProgress = { ...book, readingProgress };
          if (book.coverImage && (book.coverImage.startsWith('data:') || book.coverImage.startsWith('blob:'))) {
            return withProgress;
          }
          try {
            const coverRec = await getCover(book.id);
            if (coverRec?.data) {
              return { ...withProgress, coverImage: coverRec.data };
            }
          } catch {
            // ignore
          }
          return withProgress;
        })
      );
      cachedBooks = booksWithCovers;
      setBooks(booksWithCovers);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load books';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshBooks();
  }, [refreshBooks]);

  const removeBook = useCallback(async (id: string) => {
    try {
      await deleteBook(id);
      await refreshBooks();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete book';
      setError(message);
      throw err;
    }
  }, [refreshBooks]);

  const removeBooks = useCallback(async (ids: string[]) => {
    try {
      await deleteBooks(ids);
      await refreshBooks();
    } catch (err) {
      await refreshBooks();
      const message = err instanceof Error ? err.message : 'Failed to delete selected books';
      setError(message);
      throw err;
    }
  }, [refreshBooks]);

  const toggleFavorite = useCallback(async (id: string) => {
    try {
      const book = books.find((b) => b.id === id);
      if (!book) return;
      const { readingProgress: _readingProgress, ...storedBook } = book;
      const updated: Book = {
        ...storedBook,
        favorite: !book.favorite,
        updatedAt: Date.now(),
      };
      await updateBook(updated);
      await refreshBooks();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to toggle favorite';
      setError(message);
      throw err;
    }
  }, [books, refreshBooks]);

  const updateReadingStatus = useCallback(async (id: string, status: ReadingStatus) => {
    try {
      const book = books.find((b) => b.id === id);
      if (!book) return;
      const { readingProgress: _readingProgress, ...storedBook } = book;
      const updated: Book = {
        ...storedBook,
        readingStatus: status,
        updatedAt: Date.now(),
      };
      setBooks((currentBooks) => currentBooks.map((currentBook) =>
        currentBook.id === id
          ? { ...currentBook, readingStatus: status, readingProgress: status === 'completed' ? 1 : currentBook.readingProgress }
          : currentBook
      ));
      await updateBook(updated);
      await refreshBooks();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update reading status';
      setError(message);
      throw err;
    }
  }, [books, refreshBooks]);

  const toggleArchive = useCallback(async (id: string) => {
    try {
      const book = books.find((b) => b.id === id);
      if (!book) return;
      const { readingProgress: _readingProgress, ...storedBook } = book;
      const updated: Book = {
        ...storedBook,
        archived: !book.archived,
        updatedAt: Date.now(),
      };
      await updateBook(updated);
      await refreshBooks();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to toggle archive';
      setError(message);
      throw err;
    }
  }, [books, refreshBooks]);

  return {
    books,
    loading,
    error,
    refreshBooks,
    removeBook,
    removeBooks,
    toggleFavorite,
    updateReadingStatus,
    toggleArchive,
  };
}
