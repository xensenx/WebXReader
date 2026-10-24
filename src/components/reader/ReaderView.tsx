/**
 * ReaderView: the dedicated desktop-class novel reader environment.
 */

import { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  List,
  Search,
  Bookmark as BookmarkIcon,
  Sliders,
  Maximize,
  Minimize,
  ZoomIn,
  ZoomOut,
  AlertCircle,
} from 'lucide-react';

import { getBook, getBookContent } from '../../core/storage/database';
import { useReadingProgress } from '../../hooks/useReadingProgress';
import { useBookmarks } from '../../hooks/useBookmarks';
import { useReaderSettings } from '../../hooks/useReaderSettings';
import { useSettingsContext } from '../../app/providers/SettingsContext';

import type { Book, BookContent, Chapter, Bookmark } from '../../types/book';

import { ScrollReader } from './ScrollReader';
import { PaginatedReader } from './PaginatedReader';
import { DoubleSidedReader } from './DoubleSidedReader';
import type { EpubReaderHandle } from './EpubReader';
import type { PdfReaderHandle } from './PdfReader';
import { TableOfContents } from './TableOfContents';
import { BookmarkPanel } from './BookmarkPanel';
import { SearchPanel } from './SearchPanel';
import { ReaderSettings } from './ReaderSettings';
import { ProgressBar } from './ProgressBar';
import { Button } from '../common/Button';

import styles from './ReaderView.module.css';

// These engines are large and are only needed after opening an EPUB/PDF.
const EpubReader = lazy(async () => {
  const module = await import('./EpubReader');
  return { default: module.EpubReader };
});
const PdfReader = lazy(async () => {
  const module = await import('./PdfReader');
  return { default: module.PdfReader };
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

export function ReaderView() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  const [book, setBook] = useState<Book | null>(null);
  const [content, setContent] = useState<BookContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active navigation / reading state
  const [activeChapterId, setActiveChapterId] = useState<string>('');
  const [headerVisible, setHeaderVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [readerZoom, setReaderZoom] = useState(1);
  const readerStageRef = useRef<HTMLDivElement>(null);

  // Drawers / Panels
  const [tocOpen, setTocOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
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
  } = useReaderSettings(bookId || '');
  const { updateSettings: updateGlobalSettings } = useSettingsContext();

  const epubReaderRef = useRef<EpubReaderHandle>(null);
  const pdfReaderRef = useRef<PdfReaderHandle>(null);
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

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
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          setReaderZoom((value) => Math.min(2.5, Math.round((value + 0.1) * 20) / 20));
        } else if (e.key === '-') {
          e.preventDefault();
          setReaderZoom((value) => Math.max(0.75, Math.round((value - 0.1) * 20) / 20));
        } else if (e.key === '0') {
          e.preventDefault();
          setReaderZoom(1);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleFullscreen, tocOpen, bookmarksOpen, searchOpen, settingsOpen]);

  const handleToggleControls = useCallback(() => {
    setHeaderVisible((p) => !p);
  }, []);

  // React's wheel event is not guaranteed to be non-passive in every browser.
  // Install a native listener as well so browser page zoom cannot win the race.
  useEffect(() => {
    const stage = readerStageRef.current;
    if (!stage) return;

    const handleNativeWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setReaderZoom((value) => Math.min(
        2.5,
        Math.max(0.75, Math.round((value + (event.deltaY < 0 ? 0.1 : -0.1)) * 20) / 20)
      ));
    };

    stage.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => stage.removeEventListener('wheel', handleNativeWheel);
  }, []);

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
        readingMode: 'scroll',
        lastUpdatedAt: Date.now(),
      });
    },
    [updateProgress]
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
        readingMode: 'vertical',
        lastUpdatedAt: Date.now(),
      });
    },
    [updateProgress]
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
        readingMode: 'paginated',
        lastUpdatedAt: Date.now(),
      });
    },
    [updateProgress]
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
    const currentChapter = book.tableOfContents.find((c) => c.id === activeChapterId);
    const bookmarkChapterId = book.sourceFormat === 'pdf'
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
    if (book?.sourceFormat === 'epub' && bm.epubCfi && epubReaderRef.current) {
      epubReaderRef.current.goToCfi(bm.epubCfi);
    } else if (book?.sourceFormat === 'pdf' && bm.chapterId && pdfReaderRef.current) {
      const page = parseInt(bm.chapterId, 10);
      if (!isNaN(page)) {
        pdfReaderRef.current.goToPage(page);
      }
    } else if (bm.chapterId) {
      setActiveChapterId(bm.chapterId);
      const targetEl = document.getElementById(`chapter-${bm.chapterId}`);
      if (targetEl) scrollToReaderElement(targetEl);

      // Bookmarks for normalized books store the overall reading fraction.
      // Restore that semantic position after the chapter target has rendered.
      requestAnimationFrame(() => {
        const container = readerStageRef.current?.querySelector<HTMLElement>('[data-reader-viewport]');
        if (!container) return;
        const fraction = Math.min(1, Math.max(0, bm.position));
        if (readerSettings.readingMode === 'vertical') {
          container.scrollTo({ left: fraction * Math.max(0, container.scrollWidth - container.clientWidth), behavior: 'smooth' });
        } else if (readerSettings.readingMode === 'paginated') {
          container.scrollTo({ left: fraction * Math.max(0, container.scrollWidth - container.clientWidth), behavior: 'smooth' });
        } else {
          container.scrollTo({ top: fraction * Math.max(0, container.scrollHeight - container.clientHeight), behavior: 'smooth' });
        }
      });
    }
  };

  // Handle jumping to chapter
  const handleSelectChapter = (chapterId: string) => {
    setActiveChapterId(chapterId);
    const chapter = book?.tableOfContents.find((c) => c.id === chapterId);

    if (book?.sourceFormat === 'epub' && chapter?.href && epubReaderRef.current) {
      epubReaderRef.current.goToHref(chapter.href);
    } else if (book?.sourceFormat === 'pdf' && chapter?.href && pdfReaderRef.current) {
      const page = parseInt(chapter.href, 10);
      if (!isNaN(page)) {
        pdfReaderRef.current.goToPage(page);
      }
    } else {
      const targetEl = document.getElementById(`chapter-${chapterId}`);
      if (targetEl) scrollToReaderElement(targetEl);
    }
  };

  // Handle search result jump
  const handleSelectSearchResult = (chapterId: string) => {
    handleSelectChapter(chapterId);
  };

  // Find active chapter title
  const currentChapterTitle = useMemo(() => {
    if (!book) return '';
    const found = book.tableOfContents.find((c) => c.id === activeChapterId);
    return found ? found.title : '';
  }, [book, activeChapterId]);

  const isEpub = book?.sourceFormat === 'epub' && Boolean(content?.originalFile);
  const isPdf = book?.sourceFormat === 'pdf' && Boolean(content?.originalFile);
  const effectiveReadingMode = isPdf && readerSettings.readingMode === 'vertical'
      ? 'paginated'
      : readerSettings.readingMode;
  const effectiveReaderSettings = readerSettings.readingMode === effectiveReadingMode
    ? readerSettings
    : { ...readerSettings, readingMode: effectiveReadingMode };

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
            onClick={() => navigate('/')}
          >
            Back to Library
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
  const restoreLocation = liveProgress ?? (initialProgressRef.current ? {
    scrollPosition: initialProgressRef.current.scrollPosition,
    chapterId: initialProgressRef.current.chapterId,
    pageIndex: initialProgressRef.current.pageIndex,
    epubCfi: initialProgressRef.current.epubCfi,
    overallProgress: initialProgressRef.current.overallProgress,
    readingMode: initialProgressRef.current.readingMode,
  } : null);

  return (
    <div
      className={styles.container}
      data-theme={readerSettings.theme}
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
              navigate('/');
            }}
            title="Return to Library"
            aria-label="Return to Library"
            type="button"
          >
            <ArrowLeft size={20} />
          </button>

          <div className={styles.titleArea}>
            <span className={styles.bookTitle} title={book.title}>
              {book.title}
            </span>
            {currentChapterTitle && (
              <span className={styles.chapterTitle} title={currentChapterTitle}>
                {currentChapterTitle}
              </span>
            )}
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
            title="Search in book (/)"
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
            onClick={() => setReaderZoom((value) => Math.max(0.75, Math.round((value - 0.1) * 20) / 20))}
            title="Zoom out (Ctrl/Cmd -)"
            aria-label="Zoom out"
            type="button"
          >
            <ZoomOut size={18} />
          </button>

          <span className={styles.zoomLabel} aria-label={`Book zoom ${Math.round(readerZoom * 100)} percent`}>
            {Math.round(readerZoom * 100)}%
          </span>

          <button
            className={styles.iconBtn}
            onClick={() => setReaderZoom((value) => Math.min(2.5, Math.round((value + 0.1) * 20) / 20))}
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
              readingMode={readerSettings.readingMode === 'scroll' ? 'scroll' : 'paginated'}
              onProgressUpdate={handlePaginatedProgress}
              onToggleControls={handleToggleControls}
              readerZoom={readerZoom}
            />
          ) : isEpub ? (
            <EpubReader
              ref={epubReaderRef}
              fileData={content.originalFile!}
              settings={effectiveReaderSettings}
              initialCfi={restoreLocation?.epubCfi}
              onProgressUpdate={handleEpubProgress}
              onToggleControls={handleToggleControls}
              readerZoom={readerZoom}
            />
          ) : effectiveReadingMode === 'paginated' ? (
          <PaginatedReader
            chapters={chapters}
            settings={readerSettings}
            initialPageIndex={restoreLocation?.pageIndex}
            initialChapterId={restoreLocation?.chapterId}
            initialProgressFraction={restoreLocation?.overallProgress}
            initialProgressMode={restoreLocation?.readingMode}
            onProgressUpdate={handlePaginatedProgress}
            onToggleControls={handleToggleControls}
            zoom={readerZoom}
          />
        ) : effectiveReadingMode === 'vertical' ? (
          <DoubleSidedReader
            chapters={chapters}
            settings={readerSettings}
            initialPageIndex={restoreLocation?.pageIndex}
            initialChapterId={restoreLocation?.chapterId}
            initialProgressFraction={restoreLocation?.overallProgress}
            initialProgressMode={restoreLocation?.readingMode}
            onProgressUpdate={handleDoubleSidedProgress}
            onToggleControls={handleToggleControls}
            zoom={readerZoom}
          />
        ) : (
          <ScrollReader
            chapters={chapters}
            settings={readerSettings}
            initialScrollPosition={restoreLocation?.scrollPosition}
            initialChapterId={restoreLocation?.chapterId}
            initialProgressFraction={restoreLocation?.overallProgress}
            initialProgressMode={restoreLocation?.readingMode}
            onProgressUpdate={handleScrollProgress}
            onToggleControls={handleToggleControls}
            zoom={readerZoom}
          />
          )}
        </Suspense>
      </main>

      {/* Progress Bar & Scrubber */}
      <ProgressBar
        progress={currentOverallProgress}
        chapterTitle={currentChapterTitle}
        onSeek={(fraction) => {
          if (isPdf) {
            pdfReaderRef.current?.goToProgress(fraction);
            return;
          }
          if (isEpub) {
            epubReaderRef.current?.goToProgress(fraction);
            return;
          }

          const container = readerStageRef.current?.querySelector<HTMLElement>('[data-reader-viewport]');
          if (!container) return;
          if (effectiveReadingMode === 'vertical') {
            container.scrollTo({ left: fraction * Math.max(0, container.scrollWidth - container.clientWidth), behavior: 'smooth' });
          } else if (effectiveReadingMode === 'paginated') {
            container.scrollTo({ left: fraction * Math.max(0, container.scrollWidth - container.clientWidth), behavior: 'smooth' });
          } else {
            container.scrollTo({ top: fraction * Math.max(0, container.scrollHeight - container.clientHeight), behavior: 'smooth' });
          }
        }}
      />

      {/* Table of Contents Drawer */}
      <TableOfContents
        isOpen={tocOpen}
        onClose={() => setTocOpen(false)}
        chapters={book.tableOfContents}
        currentChapterId={activeChapterId}
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
        onSelectResult={handleSelectSearchResult}
      />

      {/* Reading Settings Drawer */}
      <ReaderSettings
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={effectiveReaderSettings}
        doubleSidedSupported={!isPdf}
        fixedLayout={isPdf}
        onUpdate={updateReaderSettings}
        onUpdateTheme={(theme) => updateGlobalSettings({ theme })}
        onReset={resetBookSettings}
      />
    </div>
  );
}
