/**
 * Fixed-layout DjVu reader powered by djvu-rs WebAssembly.
 *
 * Supports continuous vertical scrolling and paginated modes,
 * zooming with viewport anchors, high-DPI canvas rendering with off-screen
 * double-buffering, and text-layer search across document pages.
 */

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  type KeyboardEvent,
} from 'react';
import { AlertCircle } from 'lucide-react';
import { ensureDjvuInitialized, WasmDocument } from '../../core/parsing/djvu-init';
import { createTextExcerpt, findTextMatches } from '../../utils/text-search';
import type { ReaderSearchResult } from '../../components/reader/search-types';
import type { PdfZoomAnchor } from './PdfReader';
import styles from './DjvuReader.module.css';

export type DjvuZoomAnchor = PdfZoomAnchor;

export interface DjvuReaderHandle {
  goToPage: (pageNum: number) => void;
  goToProgress: (fraction: number) => void;
  previewZoom: (zoom: number, anchor: DjvuZoomAnchor) => void;
  search: (query: string) => Promise<ReaderSearchResult[]>;
  goToSearchMatch: (pageNumber: number, query: string, matchIndex: number) => Promise<void>;
}

interface DjvuReaderProps {
  fileData: ArrayBuffer;
  initialPage?: number;
  readingMode?: 'scroll' | 'paginated';
  onProgressUpdate: (chapterId: string, progressFraction: number, pageIndex: number) => void;
  onToggleControls?: () => void;
  readerZoom?: number;
  zoomAnchor?: DjvuZoomAnchor;
}

interface PageSize {
  width: number;
  height: number;
  dpi: number;
}

interface DjvuZoomPreviewTransform {
  baseLeft: number;
  baseTop: number;
  scale: number;
  translateX: number;
  translateY: number;
}

function getDjvuDisplayScale(
  baseWidth: number,
  viewportWidth: number,
  readerZoom: number
) {
  const availableWidth = Math.max(240, viewportWidth - 32);
  const fitScale = availableWidth / Math.max(1, baseWidth);
  return Math.min(2.5, Math.max(0.4, fitScale)) * readerZoom;
}

interface DjvuPageViewProps {
  doc: WasmDocument;
  pageNumber: number;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  pageSize: PageSize | undefined;
  readerZoom: number;
  layoutVersion: number;
  initiallyVisible: boolean;
}

function DjvuPageView({
  doc,
  pageNumber,
  viewportRef,
  pageSize,
  readerZoom,
  layoutVersion,
  initiallyVisible,
}: DjvuPageViewProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shouldRender, setShouldRender] = useState(initiallyVisible);
  const [hasRendered, setHasRendered] = useState(false);

  // Viewport intersection observer to lazy-render pages with a generous root margin
  useEffect(() => {
    const shell = shellRef.current;
    const root = viewportRef.current;
    if (!shell || !root) return;

    if (typeof IntersectionObserver === 'undefined') {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRender(true);
        } else if (!initiallyVisible) {
          // Free canvas backing memory for distant pages
          setShouldRender(false);
        }
      },
      { root, rootMargin: '1200px 0px' }
    );

    observer.observe(shell);
    return () => observer.disconnect();
  }, [initiallyVisible, viewportRef]);

  // Clean up canvas dimensions when page leaves render window
  useEffect(() => {
    if (shouldRender) return;
    if (canvasRef.current) {
      canvasRef.current.width = 0;
      canvasRef.current.height = 0;
    }
    setHasRendered(false);
  }, [shouldRender]);

  // Render page when visible using an off-screen staging canvas
  // Debounced by 50ms so rapid zoom or scroll gestures do not thrash WASM rasterization
  useEffect(() => {
    if (!shouldRender || !pageSize || !canvasRef.current || !viewportRef.current) return;
    let active = true;

    const render = () => {
      try {
        const page = doc.page(pageNumber - 1);
        if (!active || !canvasRef.current || !viewportRef.current) return;

        const viewportWidth = viewportRef.current.clientWidth;
        const displayScale = getDjvuDisplayScale(pageSize.width, viewportWidth, readerZoom);
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        // Base resolution is 96 DPI CSS pixels. Target rendering DPI matches screen device pixels:
        const targetDpi = Math.max(36, Math.min(600, Math.round(96 * displayScale * dpr)));

        const renderW = page.width_at(targetDpi);
        const renderH = page.height_at(targetDpi);
        if (renderW <= 0 || renderH <= 0) return;

        const pixels = page.render(targetDpi);
        if (!active || !canvasRef.current) return;

        // Render into an off-screen staging canvas first
        const stagingCanvas = document.createElement('canvas');
        stagingCanvas.width = renderW;
        stagingCanvas.height = renderH;
        const stagingCtx = stagingCanvas.getContext('2d', { alpha: false });
        if (!stagingCtx) return;

        const imgData = new ImageData(pixels as any, renderW, renderH);
        stagingCtx.putImageData(imgData, 0, 0);

        if (!active || !canvasRef.current) return;
        const canvas = canvasRef.current;
        // Swap bitmaps atomically to avoid blank/white canvas flashes during redraws
        canvas.width = renderW;
        canvas.height = renderH;
        const visibleCtx = canvas.getContext('2d', { alpha: false });
        if (visibleCtx) {
          visibleCtx.drawImage(stagingCanvas, 0, 0);
          setHasRendered(true);
        }
      } catch (err) {
        if (active) console.warn(`Failed to render DjVu page ${pageNumber}:`, err);
      }
    };

    const timer = window.setTimeout(render, 50);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [doc, pageNumber, pageSize, shouldRender, readerZoom, layoutVersion, viewportRef]);

  const fallbackSize = pageSize ?? { width: 800, height: 1100, dpi: 100 };
  const viewportWidth = viewportRef.current?.clientWidth ?? window.innerWidth;
  const displayScale = getDjvuDisplayScale(fallbackSize.width, viewportWidth, readerZoom);
  const displayWidth = Math.floor(fallbackSize.width * displayScale);
  const displayHeight = Math.floor(fallbackSize.height * displayScale);

  return (
    <div
      ref={shellRef}
      className={styles.pageShell}
      data-djvu-page={pageNumber}
      data-page-number={pageNumber}
      style={{
        width: `${displayWidth}px`,
        height: `${displayHeight}px`,
      }}
      aria-label={`DjVu page ${pageNumber}`}
    >
      <canvas
        ref={canvasRef}
        className={styles.djvuCanvas}
        aria-label={`Page ${pageNumber}`}
      />
      {!hasRendered && <div className={styles.pagePlaceholder} aria-hidden="true" />}
    </div>
  );
}

export const DjvuReader = forwardRef<DjvuReaderHandle, DjvuReaderProps>(function DjvuReader(
  {
    fileData,
    initialPage = 1,
    readingMode = 'scroll',
    onProgressUpdate,
    onToggleControls,
    readerZoom = 1,
    zoomAnchor,
  },
  ref
) {
  const [doc, setDoc] = useState<WasmDocument | null>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [pageSizes, setPageSizes] = useState<Map<number, PageSize>>(new Map());
  const [pageLayoutReady, setPageLayoutReady] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);

  const viewportRef = useRef<HTMLDivElement>(null);
  const pageStackRef = useRef<HTMLDivElement>(null);
  const isNavigatingRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const textCacheRef = useRef<Map<number, string>>(new Map());
  const initialPageRef = useRef(initialPage);
  const hasScrolledInitialRef = useRef(false);
  const previewTransformRef = useRef<DjvuZoomPreviewTransform | null>(null);
  const lastZoomAnchorRef = useRef<DjvuZoomAnchor | undefined>(undefined);
  const previousReaderZoomRef = useRef(readerZoom);
  const onProgressUpdateRef = useRef(onProgressUpdate);
  onProgressUpdateRef.current = onProgressUpdate;

  useEffect(() => {
    initialPageRef.current = initialPage;
  }, [initialPage]);

  // Initialize document and synchronously pre-measure all page dimensions at 96 DPI
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setDoc(null);
    setPageSizes(new Map());
    setPageLayoutReady(false);
    hasScrolledInitialRef.current = false;

    (async () => {
      try {
        await ensureDjvuInitialized();
        if (!active) return;

        const bytes = new Uint8Array(fileData);
        const parsedDoc = WasmDocument.from_bytes(bytes);
        if (!active) return;

        const count = parsedDoc.page_count();
        const sizes = new Map<number, PageSize>();

        // Pre-measure all page dimensions upfront to eliminate layout shift while scrolling
        for (let i = 0; i < count; i++) {
          try {
            const page = parsedDoc.page(i);
            const nativeDpi = page.dpi() || 100;
            const w96 = page.width_at(96);
            const h96 = page.height_at(96);
            const width = w96 > 0 ? w96 : Math.round((page.width_at(nativeDpi) / nativeDpi) * 96);
            const height = h96 > 0 ? h96 : Math.round((page.height_at(nativeDpi) / nativeDpi) * 96);
            sizes.set(i + 1, { width, height, dpi: nativeDpi });
          } catch (pageErr) {
            console.warn(`Could not pre-measure DjVu page ${i + 1}:`, pageErr);
            sizes.set(i + 1, { width: 800, height: 1100, dpi: 100 });
          }
        }

        setDoc(parsedDoc);
        setTotalPages(count);
        setPageSizes(sizes);
        setPageLayoutReady(true);
        const start = Math.max(1, Math.min(initialPageRef.current, count));
        setCurrentPage(start);
        setLoading(false);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [fileData]);

  // ResizeObserver for container resizing
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setLayoutVersion((v) => v + 1));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [doc]);

  const scrollToPage = useCallback((pageNumber: number, behavior: ScrollBehavior = 'smooth') => {
    const viewport = viewportRef.current;
    const page = pageStackRef.current?.querySelector<HTMLElement>(`[data-djvu-page="${pageNumber}"]`);
    if (!viewport || !page) return;
    viewport.scrollTo({ top: Math.max(0, page.offsetTop - 16), behavior });
  }, []);

  // Scroll to initial page only once when document layout is ready
  useEffect(() => {
    if (!doc || !pageLayoutReady || totalPages <= 0 || hasScrolledInitialRef.current) return;
    hasScrolledInitialRef.current = true;

    const page = Math.max(1, Math.min(initialPageRef.current, totalPages));
    if (page <= 1) return;

    let attempts = 0;
    let frame = 0;
    const seek = () => {
      attempts += 1;
      const target = pageStackRef.current?.querySelector<HTMLElement>(`[data-djvu-page="${page}"]`);
      if (target || attempts >= 12) {
        scrollToPage(page, 'auto');
        return;
      }
      frame = requestAnimationFrame(seek);
    };
    frame = requestAnimationFrame(seek);
    return () => cancelAnimationFrame(frame);
  }, [doc, pageLayoutReady, totalPages, scrollToPage]);

  // Report scroll position based on the topmost visible page
  const reportScrollPosition = useCallback(() => {
    const viewport = viewportRef.current;
    const stack = pageStackRef.current;
    if (!viewport || !stack || totalPages < 1) return;

    const viewportTop = viewport.getBoundingClientRect().top + 16;
    const pages = Array.from(stack.querySelectorAll<HTMLElement>('[data-djvu-page]'));
    let visiblePage = currentPage;
    for (const page of pages) {
      if (page.getBoundingClientRect().bottom > viewportTop) {
        visiblePage = Number(page.dataset.djvuPage) || visiblePage;
        break;
      }
    }

    const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const withinPageFraction = maxScroll > 0 ? viewport.scrollTop / maxScroll : 0;
    const fraction = readingMode === 'scroll'
      ? withinPageFraction
      : totalPages > 1
        ? Math.min(1, (Math.max(0, visiblePage - 1) + withinPageFraction) / (totalPages - 1))
        : withinPageFraction;

    setCurrentPage((prev) => (prev === visiblePage ? prev : visiblePage));
    onProgressUpdateRef.current(String(visiblePage), Math.min(1, Math.max(0, fraction)), visiblePage - 1);
  }, [currentPage, readingMode, totalPages]);

  // Throttle scroll handling to animation frame
  const handleScroll = useCallback(() => {
    if (isNavigatingRef.current || previewTransformRef.current !== null) return;
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (isNavigatingRef.current || previewTransformRef.current !== null) return;
      reportScrollPosition();
    });
  }, [reportScrollPosition]);

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

  const goToPage = useCallback((pageNum: number, behavior: ScrollBehavior = 'smooth') => {
    const clamped = Math.max(1, Math.min(pageNum, totalPages));
    setCurrentPage(clamped);
    if (readingMode === 'paginated') {
      const progressFraction = (clamped - 1) / Math.max(1, totalPages - 1);
      onProgressUpdateRef.current(String(clamped), progressFraction, clamped - 1);
    } else {
      isNavigatingRef.current = true;
      requestAnimationFrame(() => scrollToPage(clamped, behavior));
      const progressFraction = (clamped - 1) / Math.max(1, totalPages - 1);
      onProgressUpdateRef.current(String(clamped), progressFraction, clamped - 1);
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 400);
    }
  }, [readingMode, scrollToPage, totalPages]);

  const goToProgress = useCallback((fraction: number) => {
    const viewport = viewportRef.current;
    const clamped = Math.min(1, Math.max(0, fraction));
    const targetPage = totalPages > 1 ? Math.round(clamped * (totalPages - 1)) + 1 : 1;
    setCurrentPage(targetPage);

    if (readingMode === 'paginated') {
      onProgressUpdateRef.current(String(targetPage), clamped, targetPage - 1);
    } else if (viewport) {
      isNavigatingRef.current = true;
      viewport.scrollTo({
        top: clamped * Math.max(0, viewport.scrollHeight - viewport.clientHeight),
        behavior: 'smooth',
      });
      onProgressUpdateRef.current(String(targetPage), clamped, targetPage - 1);
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 400);
    } else {
      requestAnimationFrame(() => scrollToPage(targetPage, 'smooth'));
    }
  }, [readingMode, scrollToPage, totalPages]);

  // Imperative handle
  useImperativeHandle(
    ref,
    () => ({
      goToPage: (pageNum: number) => goToPage(pageNum),
      goToProgress,
      previewZoom,
      search: async (query: string): Promise<ReaderSearchResult[]> => {
        if (!doc || !query.trim() || totalPages <= 0) return [];
        const trimmed = query.trim();
        const results: ReaderSearchResult[] = [];

        for (let i = 0; i < totalPages; i++) {
          let text = textCacheRef.current.get(i);
          if (text === undefined) {
            try {
              const page = doc.page(i);
              text = page.text() || '';
            } catch {
              text = '';
            }
            textCacheRef.current.set(i, text);
          }

          if (!text) continue;

          const matches = findTextMatches(text, trimmed, 100 - results.length, true);
          matches.forEach((match, matchIndex) => {
            results.push({
              chapterId: String(i + 1),
              chapterTitle: `Page ${i + 1}`,
              ...createTextExcerpt(text!, match),
              offset: match.start,
              matchIndex,
              pageNumber: i + 1,
            });
          });
          if (results.length >= 100) break;
        }

        return results;
      },
      goToSearchMatch: async (pageNumber: number) => {
        goToPage(pageNumber, 'smooth');
      },
    }),
    [doc, goToPage, goToProgress, previewZoom, totalPages]
  );

  // Keyboard navigation
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) return;

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
        {(loading || (doc && !pageLayoutReady)) && (
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

        {doc && pageLayoutReady && (
          <div ref={pageStackRef} className={styles.pageStack}>
            {(readingMode === 'scroll'
              ? Array.from({ length: totalPages }, (_, index) => index + 1)
              : [currentPage]
            ).map((pageNumber) => (
              <DjvuPageView
                key={pageNumber}
                doc={doc}
                pageNumber={pageNumber}
                viewportRef={viewportRef}
                pageSize={pageSizes.get(pageNumber)}
                readerZoom={readerZoom}
                layoutVersion={layoutVersion}
                initiallyVisible={Math.abs(pageNumber - currentPage) <= 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
