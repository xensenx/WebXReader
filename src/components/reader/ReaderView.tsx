/**
 * ReaderView: the dedicated desktop-class novel reader environment.
 */

import { lazy, Suspense, useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
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
import { TableOfContents } from './TableOfContents';
import { BookmarkPanel } from './BookmarkPanel';
import { SearchPanel } from './SearchPanel';
import type { ReaderSearchProvider, ReaderSearchResult } from './search-types';
import { findTextRange } from '../../utils/text-search';
import { showTransientSearchHighlight } from '../../utils/transient-search-highlight';
import { ReaderSettings } from './ReaderSettings';
import { ProgressBar } from './ProgressBar';
import { Button } from '../common/Button';
import {
  isFixedLayout,
  formatSupportsFeature,
  type EpubReaderHandle,
  type PdfReaderHandle,
  type PdfZoomAnchor,
  type CbzReaderHandle,
  type DjvuReaderHandle,
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
const DjvuReader = lazy(async () => {
  const module = await import('../../formats/engines/DjvuReader');
  return { default: module.DjvuReader };
});

const MIN_READER_ZOOM = 0.5;
const MAX_READER_ZOOM = 3;
const MIN_PDF_ZOOM = 0.24;
const MAX_PDF_ZOOM = 8;

type ReaderZoomAnchor = PdfZoomAnchor;

function clampReaderZoom(value: number, fixedLayout: boolean) {
  const min = fixedLayout ? MIN_PDF_ZOOM : MIN_READER_ZOOM;
  const max = fixedLayout ? MAX_PDF_ZOOM : MAX_READER_ZOOM;
  // Keep PDF wheel/pinch zoom continuous. Rounding each input step makes
  // small trackpad deltas visibly stall and jump at high magnification.
  const zoom = fixedLayout ? value : Math.round(value * 100) / 100;
  return Math.min(max, Math.max(min, zoom));
}

function getWheelDeltaPixels(event: WheelEvent, viewport?: HTMLElement | null) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * (viewport?.clientHeight || window.innerHeight);
  return event.deltaY;
}

function getTouchZoomGesture(touches: TouchList) {
  const first = touches[0];
  const second = touches[1];
  if (!first || !second) return null;
  return {
    distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
    point: {
      x: (first.clientX + second.clientX) / 2,
      y: (first.clientY + second.clientY) / 2,
    },
  };
}

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
  const readerZoomRef = useRef(1);
  const [zoomAnchor, setZoomAnchor] = useState<ReaderZoomAnchor | undefined>(undefined);
  const pdfZoomAnchorRef = useRef<ReaderZoomAnchor | undefined>(undefined);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const previousReaderZoomRef = useRef(readerZoom);
  const readerStageRef = useRef<HTMLDivElement>(null);
  const zoomAnchorIdRef = useRef(0);
  const wheelZoomDeltaRef = useRef(0);
  const wheelZoomPointRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const wheelZoomFrameRef = useRef<number | null>(null);
  const lastWheelZoomAtRef = useRef(0);
  const pdfZoomCommitTimerRef = useRef<number | null>(null);
  const touchZoomStartRef = useRef<{ distance: number; zoom: number } | null>(null);
  const touchZoomPendingRef = useRef<{ zoom: number; point: { x: number; y: number } } | null>(null);
  const touchZoomFrameRef = useRef<number | null>(null);
  const lastTouchZoomAtRef = useRef(0);

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
  const cbzReaderRef = useRef<CbzReaderHandle>(null);
  const djvuReaderRef = useRef<DjvuReaderHandle>(null);
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const captureZoomAnchor = useCallback((clientX?: number, clientY?: number) => {
    const stage = readerStageRef.current;
    const viewport = stage?.querySelector<HTMLElement>('[data-reader-viewport]');
    if (!stage || !viewport) return undefined;

    const viewportRect = viewport.getBoundingClientRect();
    const x = clientX ?? viewportRect.left + viewportRect.width / 2;
    const y = clientY ?? viewportRect.top + viewportRect.height / 2;
    const viewportX = Math.max(0, Math.min(viewport.clientWidth, x - viewportRect.left));
    const viewportY = Math.max(0, Math.min(viewport.clientHeight, y - viewportRect.top));
    const hitPage = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-pdf-page], [data-cbz-page]');
    const page = hitPage && stage.contains(hitPage) ? hitPage : null;
    const pageRect = page?.getBoundingClientRect();

    return {
      id: ++zoomAnchorIdRef.current,
      pageNumber: page ? Number(page.dataset.pdfPage || page.dataset.cbzPage) : undefined,
      pageX: pageRect?.width ? Math.max(0, Math.min(1, (x - pageRect.left) / pageRect.width)) : undefined,
      pageY: pageRect?.height ? Math.max(0, Math.min(1, (y - pageRect.top) / pageRect.height)) : undefined,
      viewportX,
      viewportY,
      scrollRatioX: (viewport.scrollLeft + viewportX) / Math.max(1, viewport.scrollWidth),
      scrollRatioY: (viewport.scrollTop + viewportY) / Math.max(1, viewport.scrollHeight),
    } satisfies ReaderZoomAnchor;
  }, []);

  const updateZoom = useCallback((nextZoom: number, fixedLayout: boolean, anchor?: ReaderZoomAnchor) => {
    if (Math.abs(nextZoom - readerZoomRef.current) < 1e-7) return;
    readerZoomRef.current = nextZoom;
    if (!fixedLayout) {
      if (anchor) setZoomAnchor(anchor);
      setReaderZoom(nextZoom);
      return;
    }

    if (anchor) pdfZoomAnchorRef.current = anchor;
    const activeAnchor = pdfZoomAnchorRef.current ?? captureZoomAnchor();
    if (activeAnchor) {
      pdfZoomAnchorRef.current = activeAnchor;
      pdfReaderRef.current?.previewZoom(nextZoom, activeAnchor);
      cbzReaderRef.current?.previewZoom(nextZoom, activeAnchor);
    }
    if (zoomLabelRef.current) {
      const percent = Math.round(nextZoom * 100);
      zoomLabelRef.current.textContent = `${percent}%`;
      zoomLabelRef.current.setAttribute('aria-label', `Book zoom ${percent} percent`);
    }

    if (pdfZoomCommitTimerRef.current !== null) {
      window.clearTimeout(pdfZoomCommitTimerRef.current);
    }
    pdfZoomCommitTimerRef.current = window.setTimeout(() => {
      setZoomAnchor(pdfZoomAnchorRef.current);
      setReaderZoom(readerZoomRef.current);
      pdfZoomCommitTimerRef.current = null;
    }, 120);
  }, [captureZoomAnchor]);

  const zoomBy = useCallback((factor: number, point?: { x: number; y: number }) => {
    const anchor = captureZoomAnchor(point?.x, point?.y);
    const fixedLayout = isFixedLayout(book?.sourceFormat);
    updateZoom(clampReaderZoom(readerZoomRef.current * factor, fixedLayout), fixedLayout, anchor);
  }, [book?.sourceFormat, captureZoomAnchor, updateZoom]);

  const zoomTo = useCallback((targetZoom: number, point?: { x: number; y: number }) => {
    const anchor = captureZoomAnchor(point?.x, point?.y);
    const fixedLayout = isFixedLayout(book?.sourceFormat);
    updateZoom(clampReaderZoom(targetZoom, fixedLayout), fixedLayout, anchor);
  }, [book?.sourceFormat, captureZoomAnchor, updateZoom]);

  const resetZoom = useCallback(() => {
    const anchor = captureZoomAnchor();
    updateZoom(1, isFixedLayout(book?.sourceFormat), anchor);
  }, [book?.sourceFormat, captureZoomAnchor, updateZoom]);

  const queueWheelZoom = useCallback((deltaY: number, point?: { x: number; y: number }) => {
    const fixedLayout = isFixedLayout(book?.sourceFormat);
    wheelZoomDeltaRef.current += deltaY;
    if (point) wheelZoomPointRef.current = point;
    if (wheelZoomFrameRef.current !== null) return;

    const applyPendingZoom = () => {
      const elapsed = performance.now() - lastWheelZoomAtRef.current;
      if (!fixedLayout && wheelZoomDeltaRef.current !== 0 && elapsed < 50) {
        wheelZoomFrameRef.current = requestAnimationFrame(applyPendingZoom);
        return;
      }

      wheelZoomFrameRef.current = null;
      const delta = wheelZoomDeltaRef.current;
      const latestPoint = wheelZoomPointRef.current;
      wheelZoomDeltaRef.current = 0;
      wheelZoomPointRef.current = undefined;
      if (delta !== 0) {
        if (!fixedLayout) lastWheelZoomAtRef.current = performance.now();
        zoomBy(Math.exp(-delta * 0.0008), latestPoint);
      }
    };

    wheelZoomFrameRef.current = requestAnimationFrame(applyPendingZoom);
  }, [book?.sourceFormat, zoomBy]);

  const queueTouchZoom = useCallback((zoom: number, point: { x: number; y: number }) => {
    const fixedLayout = isFixedLayout(book?.sourceFormat);
    touchZoomPendingRef.current = { zoom, point };
    if (touchZoomFrameRef.current !== null) return;

    const applyPendingZoom = () => {
      const elapsed = performance.now() - lastTouchZoomAtRef.current;
      if (!fixedLayout && touchZoomPendingRef.current && elapsed < 40) {
        touchZoomFrameRef.current = requestAnimationFrame(applyPendingZoom);
        return;
      }

      touchZoomFrameRef.current = null;
      const pending = touchZoomPendingRef.current;
      touchZoomPendingRef.current = null;
      if (!pending) return;
      if (!fixedLayout) lastTouchZoomAtRef.current = performance.now();
      zoomTo(pending.zoom, pending.point);
    };

    touchZoomFrameRef.current = requestAnimationFrame(applyPendingZoom);
  }, [book?.sourceFormat, zoomTo]);

  useEffect(() => () => {
    if (wheelZoomFrameRef.current !== null) cancelAnimationFrame(wheelZoomFrameRef.current);
    if (touchZoomFrameRef.current !== null) cancelAnimationFrame(touchZoomFrameRef.current);
    if (pdfZoomCommitTimerRef.current !== null) window.clearTimeout(pdfZoomCommitTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    if (previousReaderZoomRef.current === readerZoom) return;
    previousReaderZoomRef.current = readerZoom;
    if (isFixedLayout(book?.sourceFormat) || book?.sourceFormat === 'epub' || !zoomAnchor) return;

    const viewport = readerStageRef.current?.querySelector<HTMLElement>('[data-reader-viewport]');
    if (!viewport) return;
    const horizontal = viewport.dataset.readerViewport === 'paginated';
    viewport.scrollTo({
      left: horizontal
        ? Math.max(0, zoomAnchor.scrollRatioX * viewport.scrollWidth - zoomAnchor.viewportX)
        : viewport.scrollLeft,
      top: horizontal
        ? viewport.scrollTop
        : Math.max(0, zoomAnchor.scrollRatioY * viewport.scrollHeight - zoomAnchor.viewportY),
      behavior: 'auto',
    });
  }, [book?.sourceFormat, readerZoom, zoomAnchor]);

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
    readerZoomRef.current = 1;
    setReaderZoom(1);
    setZoomAnchor(undefined);
    pdfZoomAnchorRef.current = undefined;
    wheelZoomDeltaRef.current = 0;
    wheelZoomPointRef.current = undefined;
    lastWheelZoomAtRef.current = 0;
    if (wheelZoomFrameRef.current !== null) {
      cancelAnimationFrame(wheelZoomFrameRef.current);
      wheelZoomFrameRef.current = null;
    }
    touchZoomStartRef.current = null;
    touchZoomPendingRef.current = null;
    lastTouchZoomAtRef.current = 0;
    if (touchZoomFrameRef.current !== null) {
      cancelAnimationFrame(touchZoomFrameRef.current);
      touchZoomFrameRef.current = null;
    }
    if (pdfZoomCommitTimerRef.current !== null) {
      window.clearTimeout(pdfZoomCommitTimerRef.current);
      pdfZoomCommitTimerRef.current = null;
    }
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
  }, [toggleFullscreen, tocOpen, bookmarksOpen, searchOpen, settingsOpen, zoomBy, resetZoom]);

  const handleToggleControls = useCallback(() => {
    setHeaderVisible((p) => !p);
  }, []);

  // Prevent browser zoom and native scrolling inside the reading surface during Ctrl+wheel
  // and route the gesture cleanly to the reader zoom controller.
  useEffect(() => {
    const stage = readerStageRef.current;
    if (!stage) return;

    const handleNativeWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const target = event.target as Node | null;
      if (!stage.contains(target)) return;

      event.preventDefault();
      event.stopPropagation();
      queueWheelZoom(getWheelDeltaPixels(event, stage.querySelector<HTMLElement>('[data-reader-viewport]')), {
        x: event.clientX,
        y: event.clientY,
      });
    };

    stage.addEventListener('wheel', handleNativeWheel, { capture: true, passive: false });
    return () => stage.removeEventListener('wheel', handleNativeWheel, true);
  }, [loading, queueWheelZoom]);

  useEffect(() => {
    const stage = readerStageRef.current;
    if (!stage) return;

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length < 2) return;
      const gesture = getTouchZoomGesture(event.touches);
      if (!gesture || gesture.distance <= 0) return;
      touchZoomStartRef.current = { distance: gesture.distance, zoom: readerZoomRef.current };
      event.stopPropagation();
    };
    const handleTouchMove = (event: TouchEvent) => {
      const start = touchZoomStartRef.current;
      if (!start || event.touches.length < 2) return;
      const gesture = getTouchZoomGesture(event.touches);
      if (!gesture) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      queueTouchZoom(start.zoom * gesture.distance / start.distance, gesture.point);
    };
    const handleTouchEnd = (event: TouchEvent) => {
      if (!touchZoomStartRef.current) return;
      event.stopPropagation();
      if (event.touches.length < 2) touchZoomStartRef.current = null;
    };

    stage.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
    stage.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
    stage.addEventListener('touchend', handleTouchEnd, { capture: true, passive: true });
    stage.addEventListener('touchcancel', handleTouchEnd, { capture: true, passive: true });
    return () => {
      stage.removeEventListener('touchstart', handleTouchStart, true);
      stage.removeEventListener('touchmove', handleTouchMove, true);
      stage.removeEventListener('touchend', handleTouchEnd, true);
      stage.removeEventListener('touchcancel', handleTouchEnd, true);
    };
  }, [loading, queueTouchZoom]);

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
    const bookmarkChapterId = isFixedLayout(book.sourceFormat)
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
    } else if (book?.sourceFormat === 'cbz' && bm.chapterId && cbzReaderRef.current) {
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
    } else if (book?.sourceFormat === 'cbz' && chapter?.href && cbzReaderRef.current) {
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
      if (targetEl) scrollToReaderElement(targetEl);
    }
  };

  // Navigate to the exact result in the active format, then select its text.
  const handleSelectSearchResult = (result: ReaderSearchResult, query: string) => {
    if (book?.sourceFormat === 'djvu' && result.pageNumber && djvuReaderRef.current) {
      void djvuReaderRef.current.goToSearchMatch(result.pageNumber, query, result.matchIndex);
      return;
    }
    if (book?.sourceFormat === 'pdf' && result.pageNumber && pdfReaderRef.current) {
      void pdfReaderRef.current.goToSearchMatch(result.pageNumber, query, result.matchIndex);
      return;
    }
    if (book?.sourceFormat === 'epub' && result.href && epubReaderRef.current) {
      void epubReaderRef.current.goToSearchMatch(result.href, query, result.matchIndex);
      return;
    }

    setActiveChapterId(result.chapterId);
    const chapterElement = document.getElementById(`chapter-${result.chapterId}`) ||
      Array.from(readerStageRef.current?.querySelectorAll<HTMLElement>('[data-chapter-id]') || [])
        .find((element) => element.dataset.chapterId === result.chapterId);
    if (!chapterElement) return;

    const textRoot = chapterElement.querySelector('[data-chapter-body]') || chapterElement;
    const range = findTextRange(textRoot, query, result.matchIndex);
    if (!range) {
      scrollToReaderElement(chapterElement);
      return;
    }

    requestAnimationFrame(() => {
      showTransientSearchHighlight(range);
      scrollToReaderRange(range);
    });
  };

  // Find active chapter title
  const currentChapterTitle = useMemo(() => {
    if (!book) return '';
    const found = book.tableOfContents.find((c) => c.id === activeChapterId);
    return found ? found.title : '';
  }, [book, activeChapterId]);

  const isEpub = book?.sourceFormat === 'epub' && Boolean(content?.originalFile);
  const isPdf = book?.sourceFormat === 'pdf' && Boolean(content?.originalFile);
  const isCbz = book?.sourceFormat === 'cbz' && Boolean(content?.originalFile);
  const isDjvu = book?.sourceFormat === 'djvu' && Boolean(content?.originalFile);
  const searchProvider = useCallback<ReaderSearchProvider>((query) => {
    if (isEpub) return epubReaderRef.current?.search(query) ?? Promise.resolve([]);
    if (isPdf) return pdfReaderRef.current?.search(query) ?? Promise.resolve([]);
    if (isDjvu) return djvuReaderRef.current?.search(query) ?? Promise.resolve([]);
    return Promise.resolve([]);
  }, [isEpub, isPdf, isDjvu]);
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
            disabled={readerZoom >= (isFixedLayout(book?.sourceFormat) ? MAX_PDF_ZOOM : MAX_READER_ZOOM)}
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
              zoomAnchor={zoomAnchor}
            />
          ) : isDjvu ? (
            <DjvuReader
              ref={djvuReaderRef}
              fileData={content.originalFile!}
              initialPage={restoreLocation?.pageIndex !== undefined ? restoreLocation.pageIndex + 1 : 1}
              readingMode={readerSettings.readingMode === 'scroll' ? 'scroll' : 'paginated'}
              onProgressUpdate={handlePaginatedProgress}
              onToggleControls={handleToggleControls}
              readerZoom={readerZoom}
              zoomAnchor={zoomAnchor}
            />
          ) : isCbz ? (
            <CbzReader
              ref={cbzReaderRef}
              fileData={content.originalFile!}
              initialPage={restoreLocation?.pageIndex !== undefined ? restoreLocation.pageIndex + 1 : 1}
              readingMode={readerSettings.readingMode}
              readingDirection={readerSettings.comicReadingDirection ?? (book?.identifiers?.readingDirection as 'ltr' | 'rtl') ?? 'ltr'}
              fitMode={readerSettings.comicFitMode ?? 'contain'}
              pageGap={readerSettings.contentMargin}
              onProgressUpdate={handlePaginatedProgress}
              onToggleControls={handleToggleControls}
              readerZoom={readerZoom}
              zoomAnchor={zoomAnchor}
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
              onZoomGesture={(deltaY) => queueWheelZoom(deltaY)}
              onZoomTo={zoomTo}
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
            zoomAnchor={zoomAnchor}
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
            zoomAnchor={zoomAnchor}
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
        searchProvider={isEpub || isPdf ? searchProvider : undefined}
        onSelectResult={handleSelectSearchResult}
      />

      {/* Reading Settings Drawer */}
      <ReaderSettings
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={effectiveReaderSettings}
        doubleSidedSupported={formatSupportsFeature(book?.sourceFormat, 'doubleSided')}
        fixedLayout={isFixedLayout(book?.sourceFormat)}
        format={book?.sourceFormat}
        onUpdate={updateReaderSettings}
        onUpdateTheme={(theme) => updateGlobalSettings({ theme })}
        onReset={resetBookSettings}
      />
    </div>
  );
}
