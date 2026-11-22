/**
 * ReaderView: the dedicated desktop-class novel reader environment.
 * Keep the browser tab title bound to the active book; this is intentional product behavior.
 */

import { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useLocation, useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  List,
  Search,
  Bookmark as BookmarkIcon,
  Sliders,
  Maximize,
  Minimize,
  ZoomIn,
  ZoomOut,
  AlertCircle,
  X,
} from 'lucide-react';

import { getBook, getBookContent, updateBook, saveBookContent, saveRecoveredEpubCover } from '../../core/storage/database';
import { extractEpubCover } from '../../core/parsing/epub-cover';
import { splitHtmlIntoChapters } from '../../core/parsing/mht-parser';
import { useReadingProgress } from '../../hooks/useReadingProgress';
import { useBookmarks } from '../../hooks/useBookmarks';
import { useReaderSettings } from '../../hooks/useReaderSettings';
import { useBookSeries } from '../../features/series/use-book-series';
import { BOOK_COMPLETION_THRESHOLD, getSeriesPath, getVolumeLabel, summarizeSeries } from '../../features/series/series';


import type { Book, BookContent, Chapter, Bookmark } from '../../types/book';

import type { ArchiveReaderHandle } from '../../formats/engines/ZipReader';
import { ScrollReader } from './ScrollReader';
import { PaginatedReader, type PaginatedReaderHandle } from './PaginatedReader';
import { DoubleSidedReader } from './DoubleSidedReader';
import { TableOfContents } from './TableOfContents';
import { BookmarkPanel } from './BookmarkPanel';
import { SearchPanel } from './SearchPanel';
import { useReaderZoom, MIN_READER_ZOOM, MAX_READER_ZOOM, MIN_PDF_ZOOM, MAX_PDF_ZOOM, MAX_EPUB_ZOOM } from './hooks/useReaderZoom';
import { useInBookSearch } from './hooks/useInBookSearch';
import { ReaderSettings } from './ReaderSettings';
import { ProgressBar } from './ProgressBar';
import { Button } from '../common/Button';
import {
  isFixedLayout,
  formatSupportsFeature,
  type EpubReaderHandle,
  type PdfReaderHandle,
  type CbzReaderHandle,
  type DjvuReaderHandle,
  type ImageReaderHandle,
} from '../../formats';

import styles from './ReaderView.module.css';

// These engines are large and are loaded on demand when opening their respective formats.
const EpubReader = lazy(async () => {
  const module = await import('../../formats/engines/EpubReader');
  return { default: module.EpubReader };
});
const PdfReader = lazy(async () => {
  const module = await import('../../formats/engines/PdfReader');
  return { default: module.PdfReader };
});
const CbzReader = lazy(async () => {
  const module = await import('../../formats/engines/CbzReader');
  return { default: module.CbzReader };
});
const ZipReader = lazy(async () => {
  const module = await import('../../formats/engines/ZipReader');
  return { default: module.ZipReader };
});
const DjvuReader = lazy(async () => {
  const module = await import('../../formats/engines/DjvuReader');
  return { default: module.DjvuReader };
});
const ImageReader = lazy(async () => {
  const module = await import('../../formats/engines/ImageReader');
  return { default: module.ImageReader };
});

function getReaderScrollContainer(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    const canScrollVertically = parent.scrollHeight > parent.clientHeight + 1;
    const canScrollHorizontally = parent.scrollWidth > parent.clientWidth + 1;
    if (canScrollVertically || canScrollHorizontally) return parent;
    parent = parent.parentElement;
  }
  return null;
}

function scrollToReaderElement(element: HTMLElement, behavior: ScrollBehavior = 'smooth') {
  const container = getReaderScrollContainer(element);
  if (!container) {
    element.scrollIntoView({ behavior, block: 'start' });
    return;
  }

  if (
    container.dataset.readerViewport === 'vertical-scroll' ||
    container.dataset.readerViewport === 'pdf-vertical-scroll' ||
    container.dataset.readerViewport === 'epub-vertical-scroll'
  ) {
    element.scrollIntoView({ behavior, block: 'nearest', inline: 'nearest' });
    return;
  }

  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  container.scrollTo({
    top: Math.max(0, container.scrollTop + elementRect.top - containerRect.top - 24),
    left: Math.max(0, container.scrollLeft + elementRect.left - containerRect.left - 24),
    behavior,
  });
}

function scrollToReaderRange(range: Range, behavior: ScrollBehavior = 'smooth') {
  const parent = range.startContainer instanceof HTMLElement
    ? range.startContainer
    : range.startContainer.parentElement as HTMLElement | null;
  const container = parent ? getReaderScrollContainer(parent) : null;
  if (!container) return;

  const rect = range.getClientRects()[0] || range.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  if (
    container.dataset.readerViewport === 'vertical-scroll' ||
    container.dataset.readerViewport === 'pdf-vertical-scroll' ||
    container.dataset.readerViewport === 'epub-vertical-scroll'
  ) {
    container.scrollTo({
      top: Math.max(0, container.scrollTop + rect.top - containerRect.top - 32),
      behavior,
    });
    return;
  }

  container.scrollTo({
    top: Math.max(0, container.scrollTop + rect.top - containerRect.top - 24),
    left: Math.max(0, container.scrollLeft + rect.left - containerRect.left - 24),
    behavior,
  });
}

function findChapter(chapters: readonly Chapter[], target: string): Chapter | undefined {
  for (const chapter of chapters) {
    if (chapter.id === target || chapter.href === target) return chapter;
    const child = chapter.children?.length ? findChapter(chapter.children, target) : undefined;
    if (child) return child;
  }
  return undefined;
}

export function ReaderView() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const fromSeries: unknown = useLocation().state?.fromSeries;
  const returnPath = typeof fromSeries === 'string' ? getSeriesPath(fromSeries) : '/';
  const returnLabel = returnPath === '/' ? 'Return to Library' : 'Return to series';
  const seriesContext = useBookSeries(bookId);
  const [dismissedRecommendation, setDismissedRecommendation] = useState<string>();

  const [book, setBook] = useState<Book | null>(null);
  const [content, setContent] = useState<BookContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active navigation / reading state
  const [activeChapterId, setActiveChapterId] = useState<string>('');
  const [headerVisible, setHeaderVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const readerStageRef = useRef<HTMLDivElement>(null);

  // Drawers / Panels
  const [tocOpen, setTocOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Hooks
  const {
    progress,
    loading: progressLoading,
    updateProgress,
    flush,
    getCurrentProgress,
  } = useReadingProgress(bookId || '');
  const { bookmarks, addBookmark, removeBookmark } = useBookmarks(bookId || '');
  const {
    settings: readerSettings,
    loading: readerSettingsLoading,
    updateReaderSettings,
    resetBookSettings,
    isCustomBook,
    setIsCustomBook,
  } = useReaderSettings(bookId || '', book?.sourceFormat);


  const epubReaderRef = useRef<EpubReaderHandle>(null);
  const pdfReaderRef = useRef<PdfReaderHandle>(null);
  const cbzReaderRef = useRef<CbzReaderHandle>(null);
  const djvuReaderRef = useRef<DjvuReaderHandle>(null);
  const archiveReaderRef = useRef<ArchiveReaderHandle>(null);
  const imageReaderRef = useRef<ImageReaderHandle>(null);
  const flowPagesRef = useRef<PaginatedReaderHandle>(null);
  const navigateToReaderElement = useCallback((element: HTMLElement, behavior?: ScrollBehavior) => {
    if (flowPagesRef.current) flowPagesRef.current.goToElement(element);
    else scrollToReaderElement(element, behavior);
  }, []);
  const navigateToReaderRange = useCallback((range: Range, behavior?: ScrollBehavior) => {
    if (flowPagesRef.current) flowPagesRef.current.goToRange(range);
    else scrollToReaderRange(range, behavior);
  }, []);
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Keep this behavior: the browser tab shows the active book while reading and the short app name elsewhere.
  useEffect(() => {
    const activeBookTitle = book && book.id === bookId ? book.title.trim() : '';
    document.title = activeBookTitle || 'WebXReader';
    return () => {
      document.title = 'WebXReader';
    };
  }, [book?.id, book?.title, bookId]);

  const isEpub = book?.sourceFormat === 'epub' && Boolean(content?.originalFile);
  const isPdf = book?.sourceFormat === 'pdf' && Boolean(content?.originalFile);
  const isCbz = (book?.sourceFormat === 'cbz' || book?.sourceFormat === 'cbr' || book?.sourceFormat === 'cb7') && Boolean(content?.originalFile);
  const isDjvu = book?.sourceFormat === 'djvu' && Boolean(content?.originalFile);
  const isArchive = (book?.sourceFormat === 'zip' || book?.sourceFormat === 'rar') && Boolean(content?.originalFile);
  const isImage = (book?.sourceFormat === 'png' || book?.sourceFormat === 'jpeg') && Boolean(content?.originalFile);

  const zoomPreviewRefs = useMemo(
    () => ({ epubReaderRef, pdfReaderRef, cbzReaderRef, djvuReaderRef, imageReaderRef }),
    [],
  );
  const searchReaders = useMemo(
    () => ({ epubReaderRef, pdfReaderRef, djvuReaderRef }),
    [],
  );
  const stageReady =
    !loading && !progressLoading && !readerSettingsLoading && (bookId === undefined || book?.id === bookId);

  const {
    readerZoom,
    zoomAnchor,
    zoomLabelRef,
    zoomBy,
    zoomTo,
    resetZoom,
    queueWheelZoom,
  } = useReaderZoom({
    sourceFormat: book?.sourceFormat,
    readerStageRef,
    loading: !stageReady,
    previewRefs: zoomPreviewRefs,
  });
  const resetZoomRef = useRef(resetZoom);
  resetZoomRef.current = resetZoom;

  const {
    searchOpen,
    setSearchOpen,
    searchProvider,
    handleSelectSearchResult,
  } = useInBookSearch({
    book,
    readerStageRef,
    isEpub,
    isPdf,
    isDjvu,
    readers: searchReaders,
    setActiveChapterId,
    onScrollToElement: navigateToReaderElement,
    onScrollToRange: navigateToReaderRange,
  });

  useEffect(() => {
    if (!searchOpen) djvuReaderRef.current?.cancelSearch();
  }, [searchOpen]);

  // Capture initial progress once on load so readers are not re-rendered on scroll
  const initialProgressRef = useRef<{
    scrollPosition?: number;
    chapterId?: string;
    pageIndex?: number;
    epubCfi?: string;
    overallProgress?: number;
    readingMode?: string;
  } | null>(null);

  useEffect(() => {
    initialProgressRef.current = null;
    setActiveChapterId('');
    setBook(null);
    setContent(null);
    resetZoomRef.current();
  }, [bookId]);

  useEffect(() => {
    if (initialProgressRef.current || !progress) return;
    initialProgressRef.current = {
      scrollPosition: progress.scrollPosition,
      chapterId: progress.chapterId,
      pageIndex: progress.pageIndex,
      epubCfi: progress.epubCfi,
      overallProgress: progress.overallProgress,
      readingMode: progress.readingMode,
    };
    if (progress.chapterId) setActiveChapterId(progress.chapterId);
  }, [progress]);

  useEffect(() => {
    if (activeChapterId || progress?.chapterId || book?.id !== bookId) return;
    const firstChapter = book?.tableOfContents[0];
    if (firstChapter) setActiveChapterId(firstChapter.id);
  }, [activeChapterId, book, bookId, progress?.chapterId]);

  // Load Book and BookContent from IndexedDB
  useEffect(() => {
    if (!bookId) {
      setError('No book specified');
      setLoading(false);
      return;
    }

    let isMounted = true;
    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        const [b, c] = await Promise.all([getBook(bookId!), getBookContent(bookId!)]);

        if (!isMounted) return;

        if (!b || !c) {
          setError('Book or book content not found in local database.');
          setLoading(false);
          return;
        }
        if (c.format === 'epub' && c.originalFile) {
          const { openBudgetedZip } = await import('../../core/parsing/zip-budget');
          const zip = await openBudgetedZip(c.originalFile);
          if (!isMounted) return;
          if (!b.coverImage && b.originalCoverImage === undefined) {
            void extractEpubCover(zip).then((cover) => saveRecoveredEpubCover(b.id, cover)).catch(() => {});
          }
        }

        // Optimization: strip dead originalFile buffer and re-split oversized single chapter
        if (c.format === 'mht') {
          let updated = false;
          if (c.originalFile) {
            delete c.originalFile;
            updated = true;
          }
          if (c.chapters && c.chapters.length === 1 && (c.rawText?.length ?? c.chapters[0].content?.length ?? 0) > 25000) {
            const newChapters = splitHtmlIntoChapters(c.chapters[0].content!, b.title);
            if (newChapters.length > 1) {
              newChapters[0].id = c.chapters[0].id;
              c.chapters = newChapters;
              b.tableOfContents = newChapters.map((ch) => ({
                id: ch.id,
                title: ch.title,
                level: ch.level,
                order: ch.order,
              }));
              b.totalChapters = newChapters.length;
              updateBook(b).catch(() => {});
              updated = true;
            }
          }
          if (updated) {
            saveBookContent(c).catch(() => {});
          }
        }

        setBook(b);
        setContent(c);
      } catch (err) {
        if (isMounted) {
          setError(`Failed to open book: ${err instanceof Error ? err.message : String(err)}`);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadData();
    return () => {
      isMounted = false;
      flushRef.current();
    };
  }, [bookId]);

  // Fullscreen toggle handler
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  // Keyboard shortcut listener
  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      // Don't intercept when user is typing in inputs or textareas
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }

      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setHeaderVisible((prev) => !prev);
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        setTocOpen((prev) => !prev);
      } else if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        setBookmarksOpen((prev) => !prev);
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        setSettingsOpen((prev) => !prev);
      } else if (e.key === '/') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        if (tocOpen || bookmarksOpen || searchOpen || settingsOpen) {
          setTocOpen(false);
          setBookmarksOpen(false);
          setSearchOpen(false);
          setSettingsOpen(false);
        }
      } else if (e.ctrlKey || e.metaKey) {
        if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
          e.preventDefault();
          zoomBy(1.1);
        } else if (e.key === '-' || e.code === 'NumpadSubtract') {
          e.preventDefault();
          zoomBy(1 / 1.1);
        } else if (e.key === '0') {
          e.preventDefault();
          resetZoom();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleFullscreen, tocOpen, bookmarksOpen, searchOpen, settingsOpen, zoomBy, resetZoom, setSearchOpen]);

  const searchArchiveEntries = useCallback((query: string) =>
    archiveReaderRef.current?.searchEntries(query) ?? Promise.resolve([]), []);

  const handleToggleControls = useCallback(() => {
    setHeaderVisible((p) => !p);
  }, []);

  const effectiveReadingMode = (() => {
    if (book?.sourceFormat === 'txt') return 'scroll';
    if (!isEpub && !isPdf && !isCbz && readerSettings.readingMode === 'horizontal') {
      if (isDjvu || isImage) return 'paginated';
      return 'scroll';
    }
    if (readerSettings.readingMode === 'vertical' && !formatSupportsFeature(book?.sourceFormat, 'doubleSided')) {
      return 'paginated';
    }
    return readerSettings.readingMode;
  })();
  const effectiveReaderSettings = readerSettings.readingMode === effectiveReadingMode
    ? readerSettings
    : { ...readerSettings, readingMode: effectiveReadingMode };

  // Handle scroll progress update
  const handleScrollProgress = useCallback(
    (chapterId: string, fraction: number, scrollPos: number) => {
      if (chapterId) {
        setActiveChapterId((prev) => (prev !== chapterId ? chapterId : prev));
      }
      updateProgress({
        chapterId,
        overallProgress: fraction,
        scrollPosition: scrollPos,
        readingMode: effectiveReadingMode,
        lastUpdatedAt: Date.now(),
      });
    },
    [updateProgress, effectiveReadingMode]
  );

  const handleDoubleSidedProgress = useCallback(
    (chapterId: string, fraction: number, scrollPos: number) => {
      if (chapterId) {
        setActiveChapterId((prev) => (prev !== chapterId ? chapterId : prev));
      }
      updateProgress({
        chapterId,
        overallProgress: fraction,
        pageIndex: scrollPos,
        readingMode: readerSettings.readingMode,
        lastUpdatedAt: Date.now(),
      });
    },
    [updateProgress, readerSettings.readingMode]
  );

  // Handle paginated progress update
  const handlePaginatedProgress = useCallback(
    (chapterId: string, fraction: number, pageIndex: number) => {
      if (chapterId) {
        setActiveChapterId((prev) => (prev !== chapterId ? chapterId : prev));
      }
      updateProgress({
        chapterId,
        overallProgress: fraction,
        pageIndex,
        readingMode: effectiveReadingMode,
        lastUpdatedAt: Date.now(),
      });
    },
    [updateProgress, effectiveReadingMode]
  );

  // Handle EPUB progress update
  const handleEpubProgress = useCallback(
    (cfi: string, fraction: number, href?: string) => {
      if (href && book?.sourceFormat === 'epub') {
        const normalizedHref = href.split('#')[0];
        const chapter = book.tableOfContents.find((item) => {
          const itemHref = item.href?.split('#')[0];
          return itemHref === normalizedHref || itemHref?.endsWith(normalizedHref) || normalizedHref.endsWith(itemHref || '\u0000');
        });
        if (chapter) setActiveChapterId((previous) => previous === chapter.id ? previous : chapter.id);
      }
      updateProgress({
        epubCfi: cfi,
        overallProgress: Math.min(1, Math.max(0, fraction)),
        // EPUB does not have a reliable vertical writing override. Its
        // vertical setting is rendered as a normal scrolled publication.
        readingMode: readerSettings.readingMode === 'vertical'
          ? 'vertical'
          : readerSettings.readingMode === 'horizontal'
            ? 'horizontal'
            : readerSettings.readingMode === 'paginated'
              ? 'paginated'
              : 'scroll',
        lastUpdatedAt: Date.now(),
      });
    },
    [book, readerSettings.readingMode, updateProgress]
  );

  // Handle bookmark creation
  const handleCreateBookmark = async () => {
    if (!book) return;
    const currentProgress = getCurrentProgress() ?? progress;
    const currentFraction = currentProgress?.overallProgress ?? 0;
    const currentChapter = findChapter(book.tableOfContents, activeChapterId);
    const bookmarkChapterId = book.sourceFormat !== 'zip' && book.sourceFormat !== 'rar' && isFixedLayout(book.sourceFormat)
      ? String((currentProgress?.pageIndex ?? 0) + 1)
      : activeChapterId;
    const label = currentChapter
      ? `${currentChapter.title}`
      : `Bookmark (${Math.round(currentFraction * 100)}%)`;

    await addBookmark({
      chapterId: bookmarkChapterId,
      position: currentFraction,
      epubCfi: currentProgress?.epubCfi,
      selectedText: '',
      label,
    });
  };

  // Handle jumping to bookmark
  const handleSelectBookmark = (bm: Bookmark) => {
    if (isArchive && bm.chapterId) {
      archiveReaderRef.current?.goToEntry(bm.chapterId, bm.position);
    } else if (book?.sourceFormat === 'epub' && bm.epubCfi && epubReaderRef.current) {
      epubReaderRef.current.goToCfi(bm.epubCfi);
    } else if ((book?.sourceFormat === 'cbz' || book?.sourceFormat === 'cbr' || book?.sourceFormat === 'cb7') && bm.chapterId && cbzReaderRef.current) {
      const page = parseInt(bm.chapterId, 10);
      if (!isNaN(page)) {
        cbzReaderRef.current.goToPage(page);
      }
    } else if (book?.sourceFormat === 'djvu' && bm.chapterId && djvuReaderRef.current) {
      const page = parseInt(bm.chapterId, 10);
      if (!isNaN(page)) {
        djvuReaderRef.current.goToPage(page);
      }
    } else if (book?.sourceFormat === 'pdf' && bm.chapterId && pdfReaderRef.current) {
      const page = parseInt(bm.chapterId, 10);
      if (!isNaN(page)) {
        pdfReaderRef.current.goToPage(page);
      }
    } else if (bm.chapterId) {
      setActiveChapterId(bm.chapterId);
      const fraction = Math.min(1, Math.max(0, bm.position));
      if (flowPagesRef.current) {
        flowPagesRef.current.goToProgress(fraction);
        return;
      }
      const container = readerStageRef.current?.querySelector<HTMLElement>('[data-reader-viewport]');
      if (!container) return;
      container.scrollTo({ top: fraction * Math.max(0, container.scrollHeight - container.clientHeight), behavior: 'smooth' });
    }
  };

  // Handle jumping to chapter
  const handleSelectChapter = (chapterId: string) => {
    setActiveChapterId(chapterId);
    const chapter = findChapter(book?.tableOfContents ?? [], chapterId);

    if (isArchive && chapter?.href) {
      archiveReaderRef.current?.goToEntry(chapter.href);
    } else if (book?.sourceFormat === 'epub' && chapter?.href && epubReaderRef.current) {
      epubReaderRef.current.goToHref(chapter.href);
    } else if ((book?.sourceFormat === 'cbz' || book?.sourceFormat === 'cbr' || book?.sourceFormat === 'cb7') && chapter?.href && cbzReaderRef.current) {
      const page = parseInt(chapter.href, 10);
      if (!isNaN(page)) {
        cbzReaderRef.current.goToPage(page);
      }
    } else if (book?.sourceFormat === 'djvu' && djvuReaderRef.current) {
      const page = chapter?.href ? parseInt(chapter.href, 10) : parseInt(chapterId.replace('page-', ''), 10);
      if (!isNaN(page)) {
        djvuReaderRef.current.goToPage(page);
      }
    } else if (book?.sourceFormat === 'pdf' && chapter?.href && pdfReaderRef.current) {
      const page = parseInt(chapter.href, 10);
      if (!isNaN(page)) {
        pdfReaderRef.current.goToPage(page);
      }
    } else {
      const targetEl = document.getElementById(`chapter-${chapterId}`);
      if (targetEl) navigateToReaderElement(targetEl);
    }
  };

  // Find active chapter title
  const currentChapterTitle = useMemo(() => {
    if (!book) return '';
    const found = findChapter(book.tableOfContents, activeChapterId);
    return found ? found.title : '';
  }, [book, activeChapterId]);

  if (
    loading ||
    progressLoading ||
    readerSettingsLoading ||
    (bookId !== undefined && book?.id !== bookId)
  ) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingOrError}>
          <div className={styles.spinner} />
          <p>Loading reader…</p>
        </div>
      </div>
    );
  }

  if (error || !book || !content) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingOrError}>
          <AlertCircle size={40} style={{ color: 'var(--color-danger)' }} />
          <h2 className={styles.errorTitle}>Unable to Open Novel</h2>
          <p className={styles.errorMessage}>{error || 'Book data could not be retrieved.'}</p>
          <Button
            variant="primary"
            icon={<ArrowLeft size={16} />}
            onClick={() => navigate(returnPath)}
          >
            {returnPath === '/' ? 'Back to Library' : 'Back to series'}
          </Button>
        </div>
      </div>
    );
  }

  // Determine which reader to render
  const chapters: Chapter[] = content.chapters && content.chapters.length > 0
    ? content.chapters
    : book.tableOfContents;

  const liveProgress = getCurrentProgress() ?? progress;
  const currentOverallProgress = liveProgress?.overallProgress ?? 0;
  const volumeIndex = seriesContext?.volumes.findIndex((volume) => volume.id === book.id) ?? -1;
  const reachedEnd = currentOverallProgress >= BOOK_COMPLETION_THRESHOLD;
  const seriesSummary = seriesContext && summarizeSeries(seriesContext.volumes.map((volume) =>
    volume.id === book.id ? { ...volume, readingStatus: reachedEnd ? 'completed' : 'reading', readingProgress: currentOverallProgress } : volume));
  const nextVolume = seriesContext && volumeIndex >= 0 && reachedEnd && dismissedRecommendation !== book.id
    ? seriesContext.volumes[volumeIndex + 1]
    : undefined;
  const restoreLocation = liveProgress ?? (initialProgressRef.current ? {
    scrollPosition: initialProgressRef.current.scrollPosition,
    chapterId: initialProgressRef.current.chapterId,
    pageIndex: initialProgressRef.current.pageIndex,
    epubCfi: initialProgressRef.current.epubCfi,
    overallProgress: initialProgressRef.current.overallProgress,
    readingMode: initialProgressRef.current.readingMode,
  } : null);

  const initialEpubHref = restoreLocation?.chapterId
    ? (book.tableOfContents?.find(
        (c) => c.id === restoreLocation.chapterId || c.href === restoreLocation.chapterId
      )?.href ?? restoreLocation.chapterId)
    : undefined;

  return (
    <div
      className={styles.container}
    >
      {/* Reader Header */}
      <header
        className={`${styles.header} ${!headerVisible ? styles.headerHidden : ''}`}
        aria-hidden={!headerVisible}
        inert={!headerVisible}
      >
        <div className={styles.leftGroup}>
          <button
            className={styles.backBtn}
            onClick={() => {
              flush();
              navigate(returnPath);
            }}
            title={returnLabel}
            aria-label={returnLabel}
            type="button"
          >
            <ArrowLeft size={20} />
          </button>

          <div className={styles.titleArea}>
            <span className={styles.bookTitle} title={book.title}>
              {book.title}
            </span>
            <div className={styles.readerMetadata}>
              {currentChapterTitle && <span className={styles.chapterTitle} title={currentChapterTitle}>{currentChapterTitle}</span>}
              {seriesContext && seriesSummary && volumeIndex >= 0 && (
                <Link className={styles.seriesPosition}
                  to={getSeriesPath(seriesContext.series.id)}
                  title={`${seriesContext.series.title} · ${getVolumeLabel(seriesContext.series, book.id, volumeIndex)}`} onClick={flush}>
                  {Math.round(seriesSummary.fraction * 100)}% of series
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className={styles.rightGroup}>
          <button
            className={`${styles.iconBtn} ${tocOpen ? styles.iconBtnActive : ''}`}
            onClick={() => setTocOpen((p) => !p)}
            title="Table of Contents (T)"
            aria-label="Table of Contents"
            type="button"
          >
            <List size={18} />
          </button>

          <button
            className={`${styles.iconBtn} ${searchOpen ? styles.iconBtnActive : ''}`}
            onClick={() => setSearchOpen((p) => !p)}
            title={isArchive ? 'Search archive entries (/)' : 'Search in book (/)'}
            aria-label="Search"
            type="button"
          >
            <Search size={18} />
          </button>

          <button
            className={`${styles.iconBtn} ${bookmarksOpen ? styles.iconBtnActive : ''}`}
            onClick={() => setBookmarksOpen((p) => !p)}
            title="Bookmarks (B)"
            aria-label="Bookmarks"
            type="button"
          >
            <BookmarkIcon size={18} />
          </button>

          <button
            className={`${styles.iconBtn} ${settingsOpen ? styles.iconBtnActive : ''}`}
            onClick={() => setSettingsOpen((p) => !p)}
            title="Reading Settings (S)"
            aria-label="Settings"
            type="button"
          >
            <Sliders size={18} />
          </button>

          <button
            className={styles.iconBtn}
            onClick={() => zoomBy(1 / 1.1)}
            disabled={readerZoom <= (isFixedLayout(book?.sourceFormat) ? MIN_PDF_ZOOM : MIN_READER_ZOOM)}
            title="Zoom out (Ctrl/Cmd -)"
            aria-label="Zoom out"
            type="button"
          >
            <ZoomOut size={18} />
          </button>

          <span ref={zoomLabelRef} className={styles.zoomLabel} aria-label={`Book zoom ${Math.round(readerZoom * 100)} percent`}>
            {Math.round(readerZoom * 100)}%
          </span>

          <button
            className={styles.iconBtn}
            onClick={() => zoomBy(1.1)}
            disabled={readerZoom >= (
              book?.sourceFormat === 'epub'
                ? MAX_EPUB_ZOOM
                : isFixedLayout(book?.sourceFormat)
                  ? MAX_PDF_ZOOM
                  : MAX_READER_ZOOM
            )}
            title="Zoom in (Ctrl/Cmd +)"
            aria-label="Zoom in"
            type="button"
          >
            <ZoomIn size={18} />
          </button>

          <button
            className={styles.iconBtn}
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
            aria-label="Fullscreen"
            type="button"
          >
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </header>

      {/* Reading Stage */}
      <main
        ref={readerStageRef}
        className={`${styles.readerStage} ${
          !headerVisible ? styles.readerStageFull : ''
        }`}
      >
        <Suspense fallback={<div className={styles.loadingOrError}><div className={styles.spinner} /><p>Preparing reader…</p></div>}>
          {isPdf ? (
            <PdfReader
              ref={pdfReaderRef}
              fileData={content.originalFile!}
              initialPage={restoreLocation?.pageIndex !== undefined ? restoreLocation.pageIndex + 1 : 1}
              readingMode={effectiveReaderSettings.readingMode}
              onProgressUpdate={handlePaginatedProgress}
              onToggleControls={handleToggleControls}
              readerZoom={readerZoom}
              zoomAnchor={zoomAnchor}
              onZoomGesture={(deltaY, point) => queueWheelZoom(deltaY, point)}
              invertColors={effectiveReaderSettings.invertColors}
            />
          ) : isDjvu ? (
            <DjvuReader
              ref={djvuReaderRef}
              fileData={content.originalFile!}
              initialPage={restoreLocation?.pageIndex !== undefined ? restoreLocation.pageIndex + 1 : 1}
              initialProgressFraction={restoreLocation?.overallProgress}
              initialProgressMode={restoreLocation?.readingMode}
              readingMode={effectiveReadingMode === 'scroll' ? 'scroll' : 'paginated'}
              onProgressUpdate={handlePaginatedProgress}
              onToggleControls={handleToggleControls}
              readerZoom={readerZoom}
              zoomAnchor={zoomAnchor}
            />
          ) : isArchive ? (
            <ZipReader
              ref={archiveReaderRef}
              fileData={content.originalFile!}
              book={book}
              archiveType={book?.sourceFormat as 'zip' | 'rar'}
              initialSubPath={restoreLocation?.chapterId}
              initialPage={restoreLocation?.pageIndex !== undefined ? restoreLocation.pageIndex + 1 : 1}
              initialProgressFraction={restoreLocation?.overallProgress}
              initialProgressMode={restoreLocation?.readingMode}
              readingMode={effectiveReadingMode}
              readerSettings={effectiveReaderSettings}
              readerZoom={readerZoom}
              zoomAnchor={zoomAnchor}
              onProgressUpdate={handlePaginatedProgress}
              onToggleControls={handleToggleControls}
            />
          ) : isImage ? (
            <ImageReader
              ref={imageReaderRef}
              fileData={content.originalFile!}
              format={book?.sourceFormat}
              book={book}
              fitMode={readerSettings.comicFitMode ?? 'contain'}
              readerZoom={readerZoom}
              zoomAnchor={zoomAnchor}
              onProgressUpdate={handlePaginatedProgress}
              onToggleControls={handleToggleControls}
            />
          ) : isCbz ? (
            <CbzReader
              ref={cbzReaderRef}
              fileData={content.originalFile!}
              format={book?.sourceFormat}
              initialPage={restoreLocation?.pageIndex !== undefined ? restoreLocation.pageIndex + 1 : 1}
              readingMode={effectiveReaderSettings.readingMode}
              readingDirection={readerSettings.comicReadingDirection ?? (book?.identifiers?.readingDirection as 'ltr' | 'rtl') ?? 'ltr'}
              fitMode={readerSettings.comicFitMode ?? 'contain'}
              pageGap={readerSettings.contentMargin}
              onProgressUpdate={handlePaginatedProgress}
              onToggleControls={handleToggleControls}
              readerZoom={readerZoom}
              zoomAnchor={zoomAnchor}
              onZoomGesture={(deltaY, point) => queueWheelZoom(deltaY, point)}
              invertColors={readerSettings.invertColors}
            />
          ) : isEpub ? (
            <EpubReader
              ref={epubReaderRef}
              fileData={content.originalFile!}
              settings={effectiveReaderSettings}
              initialCfi={restoreLocation?.epubCfi}
              initialProgressFraction={restoreLocation?.overallProgress}
              initialHref={initialEpubHref}
              onProgressUpdate={handleEpubProgress}
              onToggleControls={handleToggleControls}
              readerZoom={readerZoom}
              zoomAnchor={zoomAnchor}
              onZoomGesture={(deltaY, point) => queueWheelZoom(deltaY, point)}
              onZoomTo={zoomTo}
            />
          ) : effectiveReadingMode === 'paginated' ? (
          <PaginatedReader
            ref={flowPagesRef}
            chapters={chapters}
            format={book.sourceFormat}
            settings={effectiveReaderSettings}
            initialPageIndex={restoreLocation?.pageIndex}
            initialChapterId={restoreLocation?.chapterId}
            initialProgressFraction={restoreLocation?.overallProgress}
            initialProgressMode={restoreLocation?.readingMode}
            onProgressUpdate={handlePaginatedProgress}
            onToggleControls={handleToggleControls}
            zoom={readerZoom}
            zoomAnchor={zoomAnchor}
          />
        ) : effectiveReadingMode === 'vertical' ? (
          <DoubleSidedReader
            ref={flowPagesRef}
            chapters={chapters}
            format={book.sourceFormat}
            settings={effectiveReaderSettings}
            initialPageIndex={restoreLocation?.pageIndex}
            initialChapterId={restoreLocation?.chapterId}
            initialProgressFraction={restoreLocation?.overallProgress}
            initialProgressMode={restoreLocation?.readingMode}
            onProgressUpdate={handleDoubleSidedProgress}
            onToggleControls={handleToggleControls}
            zoom={readerZoom}
            zoomAnchor={zoomAnchor}
          />
        ) : (
          <ScrollReader
            chapters={chapters}
            format={book.sourceFormat}
            settings={readerSettings}
            initialScrollPosition={restoreLocation?.scrollPosition}
            initialChapterId={restoreLocation?.chapterId}
            initialProgressFraction={restoreLocation?.overallProgress}
            initialProgressMode={restoreLocation?.readingMode}
            onProgressUpdate={handleScrollProgress}
            onToggleControls={handleToggleControls}
            zoom={readerZoom}
            zoomAnchor={zoomAnchor}
          />
          )}
        </Suspense>
      </main>

      {nextVolume && (
        <aside className={styles.nextVolume} aria-label="Next in series">
          <span className={styles.nextVolumeDetails}><small>Next in series</small><strong>{nextVolume.title}</strong></span>
          <Link className={styles.nextVolumeLink} to={`/read/${nextVolume.id}`} state={{ fromSeries }} onClick={flush}>
            Open next <ArrowRight size={15} aria-hidden="true" />
          </Link>
          <Button size="sm" variant="ghost" type="button" icon={<X size={16} />} aria-label="Dismiss next book"
            onClick={() => setDismissedRecommendation(book.id)} />
        </aside>
      )}

      {/* Progress Bar & Scrubber */}
      <ProgressBar
        progress={currentOverallProgress}
        chapterTitle={currentChapterTitle}
        onSeek={(fraction) => {
          if (isArchive) {
            archiveReaderRef.current?.goToProgress(fraction);
            return;
          }
          if (isImage) {
            imageReaderRef.current?.goToProgress(fraction);
            return;
          }
          if (isDjvu) {
            djvuReaderRef.current?.goToProgress(fraction);
            return;
          }
          if (isCbz) {
            cbzReaderRef.current?.goToProgress(fraction);
            return;
          }
          if (isPdf) {
            pdfReaderRef.current?.goToProgress(fraction);
            return;
          }
          if (isEpub) {
            epubReaderRef.current?.goToProgress(fraction);
            return;
          }

          if (flowPagesRef.current) {
            flowPagesRef.current.goToProgress(fraction);
            return;
          }
          const container = readerStageRef.current?.querySelector<HTMLElement>('[data-reader-viewport]');
          if (!container) return;
          container.scrollTo({ top: fraction * Math.max(0, container.scrollHeight - container.clientHeight), behavior: 'smooth' });
        }}
      />

      {/* Table of Contents Drawer */}
      <TableOfContents
        isOpen={tocOpen}
        onClose={() => setTocOpen(false)}
        chapters={book.tableOfContents}
        currentChapterId={isArchive ? findChapter(book.tableOfContents, activeChapterId)?.id ?? activeChapterId : activeChapterId}
        onSelectChapter={handleSelectChapter}
      />

      {/* Bookmarks Drawer */}
      <BookmarkPanel
        isOpen={bookmarksOpen}
        onClose={() => setBookmarksOpen(false)}
        bookmarks={bookmarks}
        currentChapterId={activeChapterId}
        currentPosition={currentOverallProgress}
        onAddBookmark={handleCreateBookmark}
        onRemoveBookmark={removeBookmark}
        onSelectBookmark={handleSelectBookmark}
      />

      {/* Search Drawer */}
      <SearchPanel
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        chapters={chapters}
        searchProvider={isArchive ? searchArchiveEntries : isEpub || isPdf || isDjvu ? searchProvider : undefined}
        title={isArchive ? 'Search Archive Entries' : undefined}
        onSelectResult={(result, query) => {
          if (isArchive) archiveReaderRef.current?.goToEntry(result.chapterId);
          else handleSelectSearchResult(result, query);
        }}
      />

      {/* Reading Settings Drawer */}
      <ReaderSettings
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={effectiveReaderSettings}
        doubleSidedSupported={formatSupportsFeature(book?.sourceFormat, 'doubleSided')}
        fixedLayout={isFixedLayout(book?.sourceFormat)}
        format={book?.sourceFormat}
        isCustomBook={isCustomBook}
        onToggleCustomBook={setIsCustomBook}
        onUpdate={updateReaderSettings}

        onReset={resetBookSettings}
      />
    </div>
  );
}
