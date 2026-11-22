import { useEffect, useState } from 'react';
import { getBook, getProgress, getSeriesForBook } from '../../core/storage/database';
import type { BookSeries } from '../../types/book';
import type { SeriesBookProgress } from './series';

interface ReaderVolume extends SeriesBookProgress {
  id: string;
  title: string;
}

interface ReaderSeries {
  bookId: string;
  series: BookSeries;
  volumes: ReaderVolume[];
}

export function useBookSeries(bookId?: string) {
  const [result, setResult] = useState<ReaderSeries | null>(null);

  useEffect(() => {
    if (!bookId) return;
    let active = true;
    async function load(id: string) {
      const series = await getSeriesForBook(id);
      if (!series || !active) return null;
      const volumes = await Promise.all(series.bookIds.map(async (bookId) => {
        const [book, progress] = await Promise.all([getBook(bookId), getProgress(bookId)]);
        return book ? {
          id: book.id,
          title: book.title,
          readingStatus: book.readingStatus,
          readingProgress: progress?.overallProgress ?? 0,
        } : undefined;
      }));
      return { bookId: id, series, volumes: volumes.filter((volume) => volume !== undefined) };
    }
    load(bookId).then((value) => { if (active) setResult(value); }, () => { if (active) setResult(null); });
    return () => { active = false; };
  }, [bookId]);

  return result?.bookId === bookId ? result : null;
}
