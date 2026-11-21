/**
 * Fixed-layout DjVu reader powered by djvu-rs WebAssembly.
 *
 * Supports continuous vertical scrolling and paginated modes,
 * zooming with viewport anchors and worker-based rasterization and search.
 */

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
  useImperativeHandle,
  forwardRef,
  memo,
  type KeyboardEvent,
} from 'react';
import { AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { createDjvuRenderSession, type DjvuRenderSession } from './djvu-render-session';
import { DEFAULT_DJVU_PAGE_SIZE, getDjvuRasterDpi, type DjvuPageSize } from './djvu-render-protocol';
import type { ReaderSearchResult } from '../../components/reader/search-types';
import type { PdfZoomAnchor } from './PdfReader';
import { findLeadingPage } from './visible-page';
import { createPageVisibility } from './page-visibility';
import styles from './DjvuReader.module.css';

export type DjvuZoomAnchor = PdfZoomAnchor;

export interface DjvuReaderHandle {
  goToPage: (pageNum: number) => void;
  goToProgress: (fraction: number) => void;
  previewZoom: (zoom: number, anchor: DjvuZoomAnchor) => void;
  search: (query: string) => Promise<ReaderSearchResult[]>;
  cancelSearch: () => void;
  goToSearchMatch: (pageNumber: number, query: string, matchIndex: number) => Promise<void>;
}

interface DjvuReaderProps {
  fileData: ArrayBuffer;
  initialPage?: number;
  initialProgressFraction?: number;
  initialProgressMode?: string;
  readingMode?: 'scroll' | 'paginated';
  onProgressUpdate: (chapterId: string, progressFraction: number, pageIndex: number) => void;
  onToggleControls?: () => void;
  readerZoom?: number;
  zoomAnchor?: DjvuZoomAnchor;
}

interface DjvuZoomPreviewTransform {
  baseLeft: number;
  baseTop: number;
  scale: number;
  translateX: number;
  translateY: number;
}

interface DjvuPageViewProps {
  session: DjvuRenderSession;
  pageNumber: number;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  pageSize?: DjvuPageSize;
  readerZoom: number;
  viewportSize: DjvuPageSize;
  paginated: boolean;
  visibility: ReturnType<typeof createPageVisibility>;
}

const DjvuPageView = memo(function DjvuPageView({
  session, pageNumber, viewportRef, pageSize, readerZoom, viewportSize, paginated, visibility,
}: DjvuPageViewProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nearby, setNearby] = useState(paginated);
  const [measuredSize, setMeasuredSize] = useState<DjvuPageSize>();
  const [failed, setFailed] = useState(false);
  const size = pageSize ?? measuredSize;
  const { width, height } = size ?? DEFAULT_DJVU_PAGE_SIZE;
  const fitWidth = Math.max(1, viewportSize.width - 32) / width;
  const fitHeight = Math.max(1, viewportSize.height - 48) / height;
  const displayScale = Math.min(2.5, fitWidth, paginated ? fitHeight : Infinity) * readerZoom;
  const dpi = getDjvuRasterDpi({ width, height }, displayScale, window.devicePixelRatio || 1);

  useEffect(() => {
    if (pageSize || !paginated) return;
    let active = true;
    session.size(pageNumber).then((value) => {
      if (active) setMeasuredSize(value);
    }, () => {
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [pageNumber, pageSize, paginated, session]);

  useEffect(() => {
    if (paginated) return;
    const shell = shellRef.current;
    const root = viewportRef.current;
    if (!shell || !root) return;
    return visibility.watch(root, shell, setNearby);
  }, [paginated, viewportRef, visibility]);

  const shouldRender = paginated || nearby;
  useEffect(() => {
    if (!shouldRender || !size || viewportSize.width <= 1) return;
    const abort = new AbortController();
    // Keep the current bitmap during zoom. Only settled, still-relevant
    // requests enter the serial raster queue.
    const timer = setTimeout(() => {
      const shell = shellRef.current?.getBoundingClientRect();
      const viewport = viewportRef.current?.getBoundingClientRect();
      const visible = paginated || Boolean(shell && viewport && shell.bottom > viewport.top && shell.top < viewport.bottom);
      session.render(pageNumber, dpi, abort.signal, visible).then((raster) => {
        const canvas = canvasRef.current;
        if (abort.signal.aborted || !canvas) return;
        canvas.width = raster.width;
        canvas.height = raster.height;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas rendering is unavailable.');
        context.putImageData(new ImageData(new Uint8ClampedArray(raster.pixels), raster.width, raster.height), 0, 0);
        canvas.dataset.rendered = 'true';
        setFailed(false);
      }).catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    }, paginated ? 0 : 48);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [dpi, pageNumber, paginated, session, shouldRender, size, viewportRef, viewportSize.width]);

  return (
    <div
      ref={shellRef}
      className={styles.pageShell}
      data-djvu-page={pageNumber}
      data-page-number={pageNumber}
      style={{ width: Math.max(1, Math.round(width * displayScale)), height: Math.max(1, Math.round(height * displayScale)) }}
      aria-label={`DjVu page ${pageNumber}`}
    >
      {shouldRender && (
        <canvas ref={canvasRef} className={styles.djvuCanvas} aria-label={`Page ${pageNumber}`} />
      )}
      {shouldRender && failed && <div className={styles.pagePlaceholder}>Unable to render this page.</div>}
    </div>
  );
});

export const DjvuReader = forwardRef<DjvuReaderHandle, DjvuReaderProps>(function DjvuReader(
  {
    fileData,
    initialPage = 1,
    initialProgressFraction = 0,
    initialProgressMode,
    readingMode = 'scroll',
    onProgressUpdate,
    onToggleControls,
    readerZoom = 1,
    zoomAnchor,
  },
  ref
) {
  const [session, setSession] = useState<DjvuRenderSession | null>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [pageSizes, setPageSizes] = useState<DjvuPageSize[]>();
  const [viewportSize, setViewportSize] = useState<DjvuPageSize>({ width: 1, height: 1 });
  const pageLayoutReady = readingMode === 'paginated' || Boolean(pageSizes);
  const visibility = useMemo(createPageVisibility, []);

  const viewportRef = useRef<HTMLDivElement>(null);
  const pageStackRef = useRef<HTMLDivElement>(null);
  const isNavigatingRef = useRef(false);
  const navigationFrameRef = useRef(0);
  const navigationTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollFrameRef = useRef<number | null>(null);
  const initialPageRef = useRef(initialPage);
  const initialProgressRef = useRef({ fraction: initialProgressFraction, mode: initialProgressMode });
  const lastReportedRef = useRef({ page: 0, fraction: -1 });
  const hasScrolledInitialRef = useRef(false);
  const previewTransformRef = useRef<DjvuZoomPreviewTransform | null>(null);
  const lastZoomAnchorRef = useRef<DjvuZoomAnchor | undefined>(undefined);
  const previousReaderZoomRef = useRef(readerZoom);
  const onProgressUpdateRef = useRef(onProgressUpdate);
  onProgressUpdateRef.current = onProgressUpdate;

  useEffect(() => {
    initialPageRef.current = initialPage;
  }, [initialPage]);

  useEffect(() => {
    let active = true;
    let opened: DjvuRenderSession | undefined;
    setLoading(true);
    setError(null);
    setSession(null);
    setPageSizes(undefined);
    hasScrolledInitialRef.current = false;
    lastReportedRef.current = { page: 0, fraction: -1 };

    async function openDocument() {
      try {
        opened = createDjvuRenderSession();
        const count = await opened.open(fileData);
        if (!active) return;
        setTotalPages(count);
        setCurrentPage(Math.max(1, Math.min(initialPageRef.current, count)));
        setSession(opened);
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : String(error));
      } finally {
        if (active) setLoading(false);
      }
    }
    void openDocument();
    return () => {
      active = false;
      opened?.close();
    };
  }, [fileData]);

  useEffect(() => {
    if (!session || readingMode !== 'scroll') return;
    let active = true;
    session.sizes().then((sizes) => {
      if (active) setPageSizes(sizes);
    }, (error: Error) => {
      if (active) setError(error.message);
    });
    return () => { active = false; };
  }, [readingMode, session]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateSize = () => {
      const { clientWidth: width, clientHeight: height } = viewport;
      setViewportSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
    };
    updateSize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const scrollToPage = useCallback((pageNumber: number, behavior: ScrollBehavior = 'smooth') => {
    const viewport = viewportRef.current;
    const page = pageStackRef.current?.querySelector<HTMLElement>(`[data-djvu-page="${pageNumber}"]`);
    if (!viewport || !page) return;
    const top = viewport.scrollTop + page.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 16;
    viewport.scrollTo({ top: Math.max(0, top), behavior });
  }, []);

  // Scroll to initial page only once when document layout is ready
  useEffect(() => {
    if (!session || readingMode !== 'scroll' || !pageLayoutReady || totalPages <= 0 || hasScrolledInitialRef.current) return;
    hasScrolledInitialRef.current = true;

    const page = Math.max(1, Math.min(initialPageRef.current, totalPages));
    const { fraction, mode } = initialProgressRef.current;
    const restoreScroll = readingMode === 'scroll' && mode === 'scroll' && fraction > 0;
    if (page <= 1 && !restoreScroll) return;

    let attempts = 0;
    let frame = 0;
    const seek = () => {
      attempts += 1;
      const target = pageStackRef.current?.querySelector<HTMLElement>(`[data-djvu-page="${page}"]`);
      if (target || attempts >= 12) {
        const viewport = viewportRef.current;
        if (viewport && restoreScroll) {
          viewport.scrollTop = Math.min(1, fraction) * Math.max(0, viewport.scrollHeight - viewport.clientHeight);
        } else {
          scrollToPage(page, 'auto');
        }
        return;
      }
      frame = requestAnimationFrame(seek);
    };
    frame = requestAnimationFrame(seek);
    return () => cancelAnimationFrame(frame);
  }, [session, pageLayoutReady, readingMode, totalPages, scrollToPage]);

  // Report scroll position based on the topmost visible page
  const reportScrollPosition = useCallback(() => {
    const viewport = viewportRef.current;
    const stack = pageStackRef.current;
    if (!viewport || !stack || totalPages < 1) return;

    const viewportTop = viewport.getBoundingClientRect().top + 16;
    const page = findLeadingPage(stack.children, (bounds) => bounds.bottom > viewportTop);
    const visiblePage = Number(page?.getAttribute('data-djvu-page'));
    if (!visiblePage) return;
    const maxScroll = Math.max(1, viewport.scrollHeight - viewport.clientHeight);
    const fraction = Math.min(1, Math.max(0, viewport.scrollTop / maxScroll));
    const previous = lastReportedRef.current;
    if (previous.page === visiblePage && previous.fraction === fraction) return;
    lastReportedRef.current = { page: visiblePage, fraction };
    setCurrentPage(visiblePage);
    onProgressUpdateRef.current(String(visiblePage), fraction, visiblePage - 1);
  }, [totalPages]);

  // Throttle scroll handling to animation frame
  const handleScroll = useCallback(() => {
    if (readingMode !== 'scroll' || isNavigatingRef.current || previewTransformRef.current !== null) return;
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (isNavigatingRef.current || previewTransformRef.current !== null) return;
      reportScrollPosition();
    });
  }, [readingMode, reportScrollPosition]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  // Update compositor matrix transform on pageStackRef during active zoom gestures
  const previewZoom = useCallback((nextZoom: number, anchor: DjvuZoomAnchor) => {
    const viewport = viewportRef.current;
    const pageStack = pageStackRef.current;
    if (!viewport || !pageStack) return;

    const viewportRect = viewport.getBoundingClientRect();
    const pointerX = viewportRect.left + anchor.viewportX;
    const pointerY = viewportRect.top + anchor.viewportY;
    const previous = previewTransformRef.current ?? {
      baseLeft: pageStack.getBoundingClientRect().left,
      baseTop: pageStack.getBoundingClientRect().top,
      scale: 1,
      translateX: 0,
      translateY: 0,
    };
    const scale = nextZoom / readerZoom;

    const documentX = (pointerX - previous.baseLeft - previous.translateX) / previous.scale;
    const documentY = (pointerY - previous.baseTop - previous.translateY) / previous.scale;
    const translateX = pointerX - previous.baseLeft - scale * documentX;
    const translateY = pointerY - previous.baseTop - scale * documentY;

    lastZoomAnchorRef.current = anchor;
    pageStack.style.transformOrigin = '0 0';
    pageStack.style.transform = `matrix(${scale}, 0, 0, ${scale}, ${translateX}, ${translateY})`;
    previewTransformRef.current = {
      baseLeft: previous.baseLeft,
      baseTop: previous.baseTop,
      scale,
      translateX,
      translateY,
    };
  }, [readerZoom]);

  // Reset preview matrix transform and anchor scroll position when zoom commits
  useLayoutEffect(() => {
    if (previousReaderZoomRef.current === readerZoom) return;
    previousReaderZoomRef.current = readerZoom;

    const pageStack = pageStackRef.current;
    if (pageStack) {
      pageStack.style.transform = '';
      pageStack.style.transformOrigin = '';
    }
    previewTransformRef.current = null;

    const viewport = viewportRef.current;
    const activeAnchor = zoomAnchor ?? lastZoomAnchorRef.current;
    lastZoomAnchorRef.current = undefined;
    if (!viewport || !activeAnchor) return;

    const page = activeAnchor.pageNumber
      ? pageStackRef.current?.querySelector<HTMLElement>(`[data-djvu-page="${activeAnchor.pageNumber}"]`)
      : null;
    if (page) {
      const viewportRect = viewport.getBoundingClientRect();
      const pageRect = page.getBoundingClientRect();
      const left = viewport.scrollLeft + pageRect.left - viewportRect.left
        + pageRect.width * (activeAnchor.pageX ?? 0.5) - activeAnchor.viewportX;
      const top = viewport.scrollTop + pageRect.top - viewportRect.top
        + pageRect.height * (activeAnchor.pageY ?? 0.5) - activeAnchor.viewportY;
      viewport.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: 'auto' });
      return;
    }

    viewport.scrollTo({
      left: Math.max(0, activeAnchor.scrollRatioX * viewport.scrollWidth - activeAnchor.viewportX),
      top: Math.max(0, activeAnchor.scrollRatioY * viewport.scrollHeight - activeAnchor.viewportY),
      behavior: 'auto',
    });
  }, [readerZoom, zoomAnchor]);

  // In paginated mode, keep viewport at top when page changes
  useEffect(() => {
    if (readingMode === 'scroll') return;
    const frame = requestAnimationFrame(() => {
      viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentPage, readingMode]);

  const cancelScrollJump = useCallback(() => {
    cancelAnimationFrame(navigationFrameRef.current);
    clearTimeout(navigationTimerRef.current);
    isNavigatingRef.current = false;
  }, []);
  useEffect(() => cancelScrollJump, [cancelScrollJump, readingMode, session]);

  const jumpInScrollMode = useCallback((jump: () => void, behavior: ScrollBehavior) => {
    cancelScrollJump();
    isNavigatingRef.current = true;
    navigationFrameRef.current = requestAnimationFrame(() => {
      jump();
      const finish = () => {
        isNavigatingRef.current = false;
        reportScrollPosition();
      };
      if (behavior === 'smooth') navigationTimerRef.current = setTimeout(finish, 400);
      else finish();
    });
  }, [cancelScrollJump, reportScrollPosition]);

  const goToPage = useCallback((pageNum: number, behavior: ScrollBehavior = 'smooth') => {
    const clamped = Math.max(1, Math.min(pageNum, totalPages));
    setCurrentPage(clamped);
    if (readingMode === 'paginated') {
      const progressFraction = (clamped - 1) / Math.max(1, totalPages - 1);
      onProgressUpdateRef.current(String(clamped), progressFraction, clamped - 1);
    } else {
      jumpInScrollMode(() => scrollToPage(clamped, behavior), behavior);
    }
  }, [jumpInScrollMode, readingMode, scrollToPage, totalPages]);

  const goToProgress = useCallback((fraction: number) => {
    const clamped = Math.min(1, Math.max(0, fraction));
    const targetPage = totalPages > 1 ? Math.round(clamped * (totalPages - 1)) + 1 : 1;

    if (readingMode === 'paginated') {
      goToPage(targetPage);
    } else {
      jumpInScrollMode(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        viewport.scrollTo({
          top: clamped * Math.max(0, viewport.scrollHeight - viewport.clientHeight),
          behavior: 'smooth',
        });
      }, 'smooth');
    }
  }, [goToPage, jumpInScrollMode, readingMode, totalPages]);

  // Imperative handle
  useImperativeHandle(
    ref,
    () => ({
      goToPage: (pageNum: number) => goToPage(pageNum),
      goToProgress,
      previewZoom,
      search: async (query: string): Promise<ReaderSearchResult[]> => {
        const trimmed = query.trim();
        if (!session || !trimmed) return [];
        return session.search(trimmed);
      },
      cancelSearch: () => session?.cancelSearch(),
      goToSearchMatch: async (pageNumber: number) => {
        goToPage(pageNumber, 'smooth');
      },
    }),
    [session, goToPage, goToProgress, previewZoom]
  );

  // Keyboard navigation
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if ((event.target as HTMLElement).closest('button, input, select, textarea, [contenteditable]')) return;

    if (readingMode === 'paginated') {
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        if (currentPage < totalPages) {
          goToPage(currentPage + 1, 'auto');
        }
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        if (currentPage > 1) {
          goToPage(currentPage - 1, 'auto');
        }
      }
    } else {
      if (event.key === 'PageDown' || event.key === 'ArrowDown' || event.key === ' ') {
        event.preventDefault();
        viewport.scrollBy({ top: Math.max(160, viewport.clientHeight * 0.88), behavior: 'smooth' });
      } else if (event.key === 'PageUp' || event.key === 'ArrowUp') {
        event.preventDefault();
        viewport.scrollBy({ top: -Math.max(160, viewport.clientHeight * 0.88), behavior: 'smooth' });
      } else if (event.key === 'Home') {
        event.preventDefault();
        viewport.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (event.key === 'End') {
        event.preventDefault();
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
      }
    }
  };

  const paginatedPage = readingMode === 'paginated' ? currentPage : 0;
  const pages = useMemo(() => {
    if (!session || !pageLayoutReady) return null;
    const numbers = paginatedPage ? [paginatedPage] : Array.from({ length: totalPages }, (_, index) => index + 1);
    return numbers.map((pageNumber) => (
      <DjvuPageView
        key={pageNumber}
        session={session}
        pageNumber={pageNumber}
        viewportRef={viewportRef}
        pageSize={pageSizes?.[pageNumber - 1]}
        readerZoom={readerZoom}
        viewportSize={viewportSize}
        paginated={Boolean(paginatedPage)}
        visibility={visibility}
      />
    ));
  }, [pageLayoutReady, pageSizes, paginatedPage, readerZoom, session, totalPages, viewportSize, visibility]);

  return (
    <div
      className={styles.container}
      tabIndex={0}
      autoFocus
      onKeyDown={handleKeyDown}
      onClick={onToggleControls}
    >
      <div
        ref={viewportRef}
        className={styles.viewport}
        data-reader-viewport={readingMode === 'scroll' ? 'djvu-vertical-scroll' : 'djvu-page'}
        data-current-page={currentPage}
        onScroll={handleScroll}
      >
        {!error && (loading || (session && !pageLayoutReady)) && (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner} />
            <p>Loading DjVu document…</p>
          </div>
        )}

        {error && (
          <div className={styles.errorOverlay}>
            <AlertCircle size={36} color="var(--color-danger)" />
            <p className={styles.errorText}>{error}</p>
          </div>
        )}

        {session && pageLayoutReady && (
          <div ref={pageStackRef} className={styles.pageStack}>
            {pages}
          </div>
        )}
      </div>
      {session && readingMode === 'paginated' && (
        <div className={styles.pageControls} onClick={(event) => event.stopPropagation()}>
          <button type="button" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)}>
            <ChevronLeft size={18} />
          </button>
          <span>Page {currentPage} of {totalPages}</span>
          <button type="button" aria-label="Next page" disabled={currentPage >= totalPages} onClick={() => goToPage(currentPage + 1)}>
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
});
