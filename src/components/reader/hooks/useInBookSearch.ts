/**
 * In-Book Search Hook.
 *
 * Coordinates in-book search drawer state, format-specific search providers
 * (EPUB, PDF, DJVU), match navigation, and text highlighting.
 */

import { useState, useCallback } from 'react';
import type { Book } from '../../../types/book';
import type { ReaderSearchProvider, ReaderSearchResult } from '../search-types';
import { findTextRange } from '../../../utils/text-search';
import { showTransientSearchHighlight } from '../../../utils/transient-search-highlight';
import type { EpubReaderHandle, PdfReaderHandle, DjvuReaderHandle } from '../../../formats';

export interface UseInBookSearchOptions {
  book: Book | null;
  readerStageRef: React.RefObject<HTMLDivElement | null>;
  isEpub: boolean;
  isPdf: boolean;
  isDjvu: boolean;
  readers: {
    epubReaderRef: React.RefObject<EpubReaderHandle | null>;
    pdfReaderRef: React.RefObject<PdfReaderHandle | null>;
    djvuReaderRef: React.RefObject<DjvuReaderHandle | null>;
  };
  setActiveChapterId: (chapterId: string) => void;
  onScrollToElement?: (element: HTMLElement) => void;
  onScrollToRange?: (range: Range) => void;
}

export interface UseInBookSearchReturn {
  searchOpen: boolean;
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  searchProvider: ReaderSearchProvider;
  handleSelectSearchResult: (result: ReaderSearchResult, query: string) => void;
}

export function useInBookSearch({
  book,
  readerStageRef,
  isEpub,
  isPdf,
  isDjvu,
  readers,
  setActiveChapterId,
  onScrollToElement,
  onScrollToRange,
}: UseInBookSearchOptions): UseInBookSearchReturn {
  const [searchOpen, setSearchOpen] = useState(false);

  const searchProvider = useCallback<ReaderSearchProvider>((query) => {
    if (isEpub) return readers.epubReaderRef.current?.search(query) ?? Promise.resolve([]);
    if (isPdf) return readers.pdfReaderRef.current?.search(query) ?? Promise.resolve([]);
    if (isDjvu) return readers.djvuReaderRef.current?.search(query) ?? Promise.resolve([]);
    return Promise.resolve([]);
  }, [isEpub, isPdf, isDjvu, readers.epubReaderRef, readers.pdfReaderRef, readers.djvuReaderRef]);

  const handleSelectSearchResult = useCallback((result: ReaderSearchResult, query: string) => {
    if (book?.sourceFormat === 'djvu' && result.pageNumber && readers.djvuReaderRef.current) {
      void readers.djvuReaderRef.current.goToSearchMatch(result.pageNumber, query, result.matchIndex);
      return;
    }
    if (book?.sourceFormat === 'pdf' && result.pageNumber && readers.pdfReaderRef.current) {
      void readers.pdfReaderRef.current.goToSearchMatch(result.pageNumber, query, result.matchIndex);
      return;
    }
    if (book?.sourceFormat === 'epub' && result.href && readers.epubReaderRef.current) {
      void readers.epubReaderRef.current.goToSearchMatch(result.href, query, result.matchIndex);
      return;
    }

    setActiveChapterId(result.chapterId);
    const chapterElement =
      document.getElementById(`chapter-${result.chapterId}`) ||
      Array.from(readerStageRef.current?.querySelectorAll<HTMLElement>('[data-chapter-id]') || []).find(
        (element) => element.dataset.chapterId === result.chapterId
      );
    if (!chapterElement) return;

    const textRoot = chapterElement.querySelector('[data-chapter-body]') || chapterElement;
    const range = findTextRange(textRoot, query, result.matchIndex);
    if (!range) {
      onScrollToElement?.(chapterElement);
      return;
    }

    requestAnimationFrame(() => {
      showTransientSearchHighlight(range);
      onScrollToRange?.(range);
    });
  }, [book?.sourceFormat, readers.djvuReaderRef, readers.pdfReaderRef, readers.epubReaderRef, setActiveChapterId, readerStageRef, onScrollToElement, onScrollToRange]);

  return {
    searchOpen,
    setSearchOpen,
    searchProvider,
    handleSelectSearchResult,
  };
}
