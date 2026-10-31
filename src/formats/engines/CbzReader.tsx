/**
 * Comic Reader (CBZ, CBR, CB7) for WebXReader.
 *
 * Provides high-performance, responsive comic reading supporting:
 * 1. Webtoon / continuous vertical scroll mode with stable layout and zero page overlap
 * 2. Single-page paginated mode with keyboard and click-zone navigation
 * 3. Double-page spread mode with Manga (RTL) reading support
 * 4. Lazy blob URL decoding and automatic memory management
 * 5. High-resolution canvas/image zoom mirroring PDF reader mechanics (24% to 800% scale, Ctrl+wheel pivot anchor)
 * 6. Clean zoom/scroll isolation: stops scrolling and suppresses layout shifts while zooming
 * 7. Blazing fast skimming performance: O(log N) binary search page tracking and stable aspect-ratio shells
 * 8. Universal comic archive support: ZIP (CBZ via JSZip), RAR (CBR via 7z-wasm), and 7z (CB7 via 7z-wasm)
 */

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  memo,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import JSZip from 'jszip';
import { AlertCircle } from 'lucide-react';
import {
  naturalCompare,
  isImageFileName,
  shouldIgnoreEntry,
  detectComicFormat,
} from '../../core/parsing/comic-archive';
import {
  openComicArchiveSession,
  type ComicArchiveSession,
} from '../../core/parsing/sevenzip-extractor';
import type { ComicReadingDirection, ComicFitMode } from '../../types/book';
import styles from './CbzReader.module.css';

export interface CbzZoomAnchor {
  id: number;
  pageNumber?: number;
  pageX?: number;
  pageY?: number;
  viewportX: number;
  viewportY: number;
  scrollRatioX: number;
  scrollRatioY: number;
}

export interface CbzReaderHandle {
  goToPage: (pageNum: number) => void;
  goToProgress: (fraction: number) => void;
  previewZoom: (zoom: number, anchor: CbzZoomAnchor) => void;
  getCurrentPage: () => number;
  getTotalPages: () => number;
}

export type ComicZoomAnchor = CbzZoomAnchor;
export type ComicReaderHandle = CbzReaderHandle;

interface CbzReaderProps {
  fileData: ArrayBuffer;
  format?: 'cbz' | 'cbr' | 'cb7' | string;
  initialPage?: number;
  readingMode?: 'scroll' | 'paginated' | 'vertical';
  readingDirection?: ComicReadingDirection;
  fitMode?: ComicFitMode;
  pageGap?: number;
  onProgressUpdate: (chapterId: string, progressFraction: number, pageIndex: number) => void;
  onToggleControls?: () => void;
  readerZoom?: number;
  zoomAnchor?: CbzZoomAnchor;
}

/**
 * Continuous scroll page shell with stable layout preservation.
 * Memoized to avoid cascading re-renders when currentPage updates.
 */
const CbzScrollPageShell = memo(function CbzScrollPageShell({
  pageIndex,
  total,
  loadUrl,
  containerRef,
  readerZoom,
  fitMode,
  fallbackAspectRatio,
  onAspectRatio,
}: {
  pageIndex: number;
  total: number;
  loadUrl: (idx: number) => Promise<string | undefined>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  readerZoom: number;
  fitMode: ComicFitMode;
  fallbackAspectRatio: number;
  onAspectRatio: (ratio: number) => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(pageIndex < 3);
  const [imgSrc, setImgSrc] = useState<string | undefined>(undefined);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  useEffect(() => {
    if (shouldLoad) return;
    const el = shellRef.current;
    const root = containerRef.current;
    if (!el || !root) return;

    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { root, rootMargin: '800px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [shouldLoad, containerRef]);

  useEffect(() => {
    if (!shouldLoad || imgSrc) return;

    let active = true;
    loadUrl(pageIndex).then((url) => {
      if (active && url) {
        setImgSrc(url);
      }
    });

    return () => {
      active = false;
    };
  }, [shouldLoad, imgSrc, pageIndex, loadUrl]);

  // Compute sizing styles based on fitMode and readerZoom
  let widthStyle: string | undefined;
  let maxWidthStyle: string | undefined;
  let maxHeightStyle: string | undefined;

  if (fitMode === 'width') {
    widthStyle = `${Math.round(100 * readerZoom)}%`;
    maxWidthStyle = readerZoom <= 1 ? '100%' : 'none';
  } else if (fitMode === 'height') {
    maxHeightStyle = `${Math.round(window.innerHeight * readerZoom)}px`;
    maxWidthStyle = 'none';
  } else {
    // 'contain' (default standard view)
    widthStyle = `${Math.round(100 * readerZoom)}%`;
    maxWidthStyle = readerZoom <= 1 ? 'min(860px, 94vw)' : 'none';
  }

  const effectiveRatio = aspectRatio ?? fallbackAspectRatio;
  const minHeightPx = Math.round(500 * (1 / Math.max(0.2, effectiveRatio)));

  return (
    <div
      ref={shellRef}
      className={styles.scrollPageShell}
      data-cbz-page={pageIndex + 1}
      data-comic-page={pageIndex + 1}
      style={{
        width: widthStyle,
        maxWidth: maxWidthStyle,
        maxHeight: maxHeightStyle,
        minHeight: imgSrc ? undefined : `${Math.min(900, minHeightPx)}px`,
        aspectRatio: !imgSrc ? `${effectiveRatio}` : undefined,
      }}
    >
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={`Page ${pageIndex + 1}`}
          className={styles.scrollPageImage}
          style={{
            maxHeight: maxHeightStyle,
          }}
          loading="lazy"
          decoding="async"
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) {
              const ratio = img.naturalWidth / img.naturalHeight;
              setAspectRatio(ratio);
              onAspectRatio(ratio);
            }
          }}
        />
      ) : (
        <div className={styles.pagePlaceholder}>
          <div className={styles.spinner} />
          <span className={styles.placeholderText}>
            Page {pageIndex + 1} of {total}
          </span>
        </div>
      )}
    </div>
  );
});

export const CbzReader = forwardRef<CbzReaderHandle, CbzReaderProps>(function CbzReader(
  {
    fileData,
    format,
    initialPage = 1,
    readingMode = 'scroll',
    readingDirection = 'ltr',
    fitMode = 'contain',
    pageGap = 16,
    onProgressUpdate,
    onToggleControls,
    readerZoom = 1,
    zoomAnchor,
  },
  ref
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage));
  const [commonAspectRatio, setCommonAspectRatio] = useState<number>(0.68);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pageStackRef = useRef<HTMLDivElement>(null);
  const pagedContentRef = useRef<HTMLDivElement>(null);
  const blobUrlsRef = useRef<Map<number, string>>(new Map());
  const onProgressUpdateRef = useRef(onProgressUpdate);
  const scrollFrameRef = useRef<number | null>(null);
  const previousReaderZoomRef = useRef(readerZoom);
  const lastZoomAnchorRef = useRef<CbzZoomAnchor | undefined>(undefined);
  const hasRestoredInitialRef = useRef(false);
  const previewTransformRef = useRef<{
    baseLeft: number;
    baseTop: number;
    scale: number;
    translateX: number;
    translateY: number;
  } | null>(null);

  const pageLoaderRef = useRef<(index: number) => Promise<Blob | undefined>>(() => Promise.resolve(undefined));
  const sessionRef = useRef<ComicArchiveSession | null>(null);

  onProgressUpdateRef.current = onProgressUpdate;

  const handlePageAspectRatio = useCallback((ratio: number) => {
    if (ratio > 0.3 && ratio < 2.5) {
      setCommonAspectRatio((prev) => (Math.abs(prev - ratio) > 0.05 ? ratio : prev));
    }
  }, []);

  // Cleanup all blob URLs on unmount
  useEffect(() => {
    const urls = blobUrlsRef.current;
    return () => {
      urls.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      });
      urls.clear();
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
      if (sessionRef.current) {
        sessionRef.current.close();
        sessionRef.current = null;
      }
    };
  }, []);

  // Load and cache a page's Blob URL
  const loadPageBlobUrl = useCallback(
    async (pageIndex: number): Promise<string | undefined> => {
      if (pageIndex < 0 || pageIndex >= totalPages) return undefined;
      const cached = blobUrlsRef.current.get(pageIndex);
      if (cached) return cached;

      try {
        const blob = await pageLoaderRef.current(pageIndex);
        if (!blob) return undefined;
        const url = URL.createObjectURL(blob);
        blobUrlsRef.current.set(pageIndex, url);
        return url;
      } catch (err) {
        console.error(`Failed to load page ${pageIndex + 1}:`, err);
        return undefined;
      }
    },
    [totalPages]
  );

  // Parse archive and extract sorted image entries (ZIP, RAR, or 7z)
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    hasRestoredInitialRef.current = false;

    async function loadArchive() {
      try {
        const detected = detectComicFormat(fileData);
        const formatType = format || (detected !== 'unknown' ? detected : 'cbz');

        if (formatType === 'cbr' || formatType === 'cb7') {
          const session = await openComicArchiveSession(fileData, formatType);
          if (!active) {
            session.close();
            return;
          }
          sessionRef.current = session;
          pageLoaderRef.current = (idx) => session.getPageBlob(idx);
          setTotalPages(session.pageNames.length);
          setLoading(false);
        } else {
          const zip = await JSZip.loadAsync(fileData);
          const images: { path: string; entry: JSZip.JSZipObject }[] = [];

          zip.forEach((path, entry) => {
            if (!entry.dir && isImageFileName(path) && !shouldIgnoreEntry(path)) {
              images.push({ path, entry });
            }
          });

          if (images.length === 0) {
            throw new Error('No valid images found in the comic archive.');
          }

          images.sort((a, b) => naturalCompare(a.path, b.path));

          if (!active) return;
          const entries = images.map((i) => i.entry);
          pageLoaderRef.current = async (idx) => {
            const entry = entries[idx];
            return entry ? await entry.async('blob') : undefined;
          };
          setTotalPages(entries.length);
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }

    loadArchive();

    return () => {
      active = false;
      if (sessionRef.current) {
        sessionRef.current.close();
        sessionRef.current = null;
      }
    };
  }, [fileData, format]);

  // Synchronize progress updates with parent
  const notifyProgress = useCallback(
    (pageIdx: number) => {
      if (totalPages === 0) return;
      const fraction = totalPages > 1 ? pageIdx / (totalPages - 1) : 1;
      const chapterId = `${pageIdx + 1}`;
      onProgressUpdateRef.current(chapterId, fraction, pageIdx);
    },
    [totalPages]
  );

  // Programmatic page navigation (TOC, bookmarks, keyboard)
  const goToPage = useCallback(
    (pageNum: number, behavior: ScrollBehavior = 'smooth') => {
      if (totalPages === 0) return;
      const target = Math.max(1, Math.min(pageNum, totalPages));
      setCurrentPage(target);
      notifyProgress(target - 1);

      if (readingMode === 'scroll' && viewportRef.current) {
        const el = viewportRef.current.querySelector<HTMLElement>(
          `[data-cbz-page="${target}"], [data-comic-page="${target}"]`
        );
        if (el) {
          el.scrollIntoView({ behavior, block: 'start' });
        }
      }
    },
    [totalPages, readingMode, notifyProgress]
  );

  const goToProgress = useCallback(
    (fraction: number) => {
      if (totalPages === 0) return;
      const targetPage = Math.round(fraction * (totalPages - 1)) + 1;
      goToPage(targetPage, 'smooth');
    },
    [totalPages, goToPage]
  );

  // Restore initial page ONCE on mount after archive loads
  useEffect(() => {
    if (loading || totalPages === 0 || readingMode !== 'scroll' || hasRestoredInitialRef.current) return;
    hasRestoredInitialRef.current = true;
    if (initialPage > 1) {
      const target = Math.max(1, Math.min(initialPage, totalPages));
      setCurrentPage(target);
      requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        if (viewport) {
          const el = viewport.querySelector<HTMLElement>(
            `[data-cbz-page="${target}"], [data-comic-page="${target}"]`
          );
          if (el) {
            el.scrollIntoView({ behavior: 'auto', block: 'start' });
          }
        }
      });
    }
  }, [loading, totalPages, readingMode, initialPage]);

  // Smooth preview zoom using CSS matrix transform around the pointer anchor (Ctrl+wheel & pinch)
  const previewZoom = useCallback(
    (nextZoom: number, anchor: CbzZoomAnchor) => {
      const viewport = viewportRef.current;
      const target = readingMode === 'scroll' ? pageStackRef.current : pagedContentRef.current;
      if (!viewport || !target) return;

      const viewportRect = viewport.getBoundingClientRect();
      const pointerX = viewportRect.left + anchor.viewportX;
      const pointerY = viewportRect.top + anchor.viewportY;
      const previous = previewTransformRef.current ?? {
        baseLeft: target.getBoundingClientRect().left,
        baseTop: target.getBoundingClientRect().top,
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
      target.style.transformOrigin = '0 0';
      target.style.transform = `matrix(${scale}, 0, 0, ${scale}, ${translateX}, ${translateY})`;
      previewTransformRef.current = {
        baseLeft: previous.baseLeft,
        baseTop: previous.baseTop,
        scale,
        translateX,
        translateY,
      };
    },
    [readingMode, readerZoom]
  );

  // When readerZoom commits, clear the preview matrix transform and restore exact anchor scroll position
  useLayoutEffect(() => {
    if (previousReaderZoomRef.current === readerZoom) return;
    previousReaderZoomRef.current = readerZoom;

    const target = readingMode === 'scroll' ? pageStackRef.current : pagedContentRef.current;
    if (target) {
      target.style.transform = '';
      target.style.transformOrigin = '';
    }
    previewTransformRef.current = null;

    const viewport = viewportRef.current;
    const activeAnchor = zoomAnchor ?? lastZoomAnchorRef.current;
    lastZoomAnchorRef.current = undefined;
    if (!viewport || !activeAnchor) return;

    if (readingMode === 'scroll') {
      const page = activeAnchor.pageNumber
        ? pageStackRef.current?.querySelector<HTMLElement>(
            `[data-cbz-page="${activeAnchor.pageNumber}"], [data-comic-page="${activeAnchor.pageNumber}"]`
          )
        : null;

      if (page) {
        const viewportRect = viewport.getBoundingClientRect();
        const pageRect = page.getBoundingClientRect();
        const left =
          viewport.scrollLeft +
          pageRect.left -
          viewportRect.left +
          pageRect.width * (activeAnchor.pageX ?? 0.5) -
          activeAnchor.viewportX;
        const top =
          viewport.scrollTop +
          pageRect.top -
          viewportRect.top +
          pageRect.height * (activeAnchor.pageY ?? 0.5) -
          activeAnchor.viewportY;
        viewport.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: 'auto' });
        return;
      }

      viewport.scrollTo({
        left: Math.max(0, activeAnchor.scrollRatioX * viewport.scrollWidth - activeAnchor.viewportX),
        top: Math.max(0, activeAnchor.scrollRatioY * viewport.scrollHeight - activeAnchor.viewportY),
        behavior: 'auto',
      });
    }
  }, [readerZoom, zoomAnchor, readingMode]);

  // Imperative handle for parent control
  useImperativeHandle(
    ref,
    () => ({
      goToPage,
      goToProgress,
      previewZoom,
      getCurrentPage: () => currentPage,
      getTotalPages: () => totalPages,
    }),
    [goToPage, goToProgress, previewZoom, currentPage, totalPages]
  );

  // High performance binary search for active page tracking during continuous scroll
  const handleScroll = useCallback(() => {
    if (previewTransformRef.current !== null || readingMode !== 'scroll') return;
    if (scrollFrameRef.current !== null) return;

    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (previewTransformRef.current !== null || !viewportRef.current || !pageStackRef.current) return;

      const viewport = viewportRef.current;
      const stack = pageStackRef.current;
      const shells = stack.querySelectorAll<HTMLElement>(
        '[data-cbz-page], [data-comic-page]'
      );
      if (shells.length === 0) return;

      const viewportTop = viewport.getBoundingClientRect().top + 24;

      let low = 0;
      let high = shells.length - 1;
      let foundPage = 1;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const rect = shells[mid].getBoundingClientRect();

        if (rect.bottom > viewportTop) {
          const pageAttr = shells[mid].getAttribute('data-cbz-page') || shells[mid].getAttribute('data-comic-page');
          foundPage = Number(pageAttr) || (mid + 1);
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }

      setCurrentPage((prev) => {
        if (prev !== foundPage) {
          notifyProgress(foundPage - 1);
          return foundPage;
        }
        return prev;
      });
    });
  }, [readingMode, notifyProgress]);

  // Paginated navigation helpers
  const handlePrevPage = useCallback(() => {
    if (readingMode === 'vertical') {
      const step = 2;
      const next = Math.max(1, currentPage - step);
      goToPage(next, 'auto');
    } else {
      if (currentPage > 1) {
        goToPage(currentPage - 1, 'auto');
      }
    }
  }, [readingMode, currentPage, goToPage]);

  const handleNextPage = useCallback(() => {
    if (readingMode === 'vertical') {
      const step = 2;
      const next = Math.min(totalPages, currentPage + step);
      goToPage(next, 'auto');
    } else {
      if (currentPage < totalPages) {
        goToPage(currentPage + 1, 'auto');
      }
    }
  }, [readingMode, currentPage, totalPages, goToPage]);

  // Click zone handling (left 25% = prev, right 25% = next, center 50% = toggle controls)
  const handleClickZone = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (readingMode === 'scroll') return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;
      const ratio = x / width;

      const isRtl = readingDirection === 'rtl';

      if (ratio < 0.25) {
        if (isRtl) handleNextPage();
        else handlePrevPage();
      } else if (ratio > 0.75) {
        if (isRtl) handlePrevPage();
        else handleNextPage();
      } else {
        onToggleControls?.();
      }
    },
    [readingMode, readingDirection, handlePrevPage, handleNextPage, onToggleControls]
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        if (readingDirection === 'rtl') handlePrevPage();
        else handleNextPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        if (readingDirection === 'rtl') handleNextPage();
        else handlePrevPage();
      } else if (e.key === 'Home') {
        e.preventDefault();
        goToPage(1, 'auto');
      } else if (e.key === 'End') {
        e.preventDefault();
        goToPage(totalPages, 'auto');
      }
    },
    [readingDirection, handlePrevPage, handleNextPage, goToPage, totalPages]
  );

  if (loading) {
    return (
      <div className={styles.loadingOverlay}>
        <div className={styles.spinner} />
        <p>Opening comic archive…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.errorOverlay}>
        <AlertCircle size={36} color="var(--color-danger)" />
        <p className={styles.errorText}>{error}</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={styles.container}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={readingMode === 'scroll' ? onToggleControls : undefined}
    >
      {/* 1. Continuous Scroll (Webtoon) Mode */}
      {readingMode === 'scroll' ? (
        <div
          ref={viewportRef}
          className={styles.viewport}
          data-reader-viewport="cbz-vertical-scroll"
          data-comic-viewport="vertical-scroll"
          data-current-page={currentPage}
          onScroll={handleScroll}
          onClick={(e) => {
            if (e.target === viewportRef.current || e.target === pageStackRef.current) {
              onToggleControls?.();
            }
          }}
        >
          <div
            ref={pageStackRef}
            className={styles.pageStack}
            style={{ gap: `${pageGap}px` }}
          >
            {Array.from({ length: totalPages }, (_, idx) => (
              <CbzScrollPageShell
                key={idx}
                pageIndex={idx}
                total={totalPages}
                loadUrl={loadPageBlobUrl}
                containerRef={viewportRef}
                readerZoom={readerZoom}
                fitMode={fitMode}
                fallbackAspectRatio={commonAspectRatio}
                onAspectRatio={handlePageAspectRatio}
              />
            ))}
          </div>
        </div>
      ) : (
        /* 2. Paginated (Single / Spread) Mode */
        <div
          ref={viewportRef}
          className={styles.pagedViewport}
          data-reader-viewport="cbz-page"
          data-comic-viewport="page"
          data-current-page={currentPage}
          onClick={handleClickZone}
        >
          <div
            ref={pagedContentRef}
            className={styles.pagedContent}
          >
            {readingMode === 'vertical' ? (
              /* Double-page spread */
              <SpreadView
                currentPage={currentPage}
                totalPages={totalPages}
                loadUrl={loadPageBlobUrl}
                direction={readingDirection}
                readerZoom={readerZoom}
              />
            ) : (
              /* Single-page view */
              <SinglePageView
                pageIndex={currentPage - 1}
                loadUrl={loadPageBlobUrl}
                readerZoom={readerZoom}
                fitMode={fitMode}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export const ComicReader = CbzReader;

/**
 * Single-page view component for paginated mode.
 */
function SinglePageView({
  pageIndex,
  loadUrl,
  readerZoom,
  fitMode,
}: {
  pageIndex: number;
  loadUrl: (idx: number) => Promise<string | undefined>;
  readerZoom: number;
  fitMode: ComicFitMode;
}) {
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setSrc(undefined);
    loadUrl(pageIndex).then((url) => {
      if (active && url) setSrc(url);
    });
    return () => {
      active = false;
    };
  }, [pageIndex, loadUrl]);

  if (!src) {
    return (
      <div className={styles.pagePlaceholder} style={{ minHeight: 400, width: 300 }}>
        <div className={styles.spinner} />
        <span>Page {pageIndex + 1}…</span>
      </div>
    );
  }

  let widthStyle = 'auto';
  let heightStyle = 'auto';
  let maxWidthStyle: string | undefined = `${Math.round(100 * readerZoom)}%`;
  let maxHeightStyle: string | undefined = `${Math.round((window.innerHeight - 80) * readerZoom)}px`;

  if (fitMode === 'width') {
    widthStyle = `${Math.round(100 * readerZoom)}%`;
    maxWidthStyle = readerZoom <= 1 ? '100%' : 'none';
    maxHeightStyle = 'none';
  } else if (fitMode === 'height') {
    heightStyle = `${Math.round((window.innerHeight - 80) * readerZoom)}px`;
    maxWidthStyle = 'none';
  } else {
    // 'contain'
    maxWidthStyle = readerZoom <= 1 ? 'min(1100px, 92vw)' : 'none';
    maxHeightStyle = `${Math.round((window.innerHeight - 80) * readerZoom)}px`;
  }

  return (
    <img
      src={src}
      alt={`Page ${pageIndex + 1}`}
      className={styles.pagedImage}
      style={{
        width: widthStyle,
        height: heightStyle,
        maxWidth: maxWidthStyle,
        maxHeight: maxHeightStyle,
      }}
    />
  );
}

/**
 * Double-page spread view component for Manga / Western 2-page reading.
 */
function SpreadView({
  currentPage,
  totalPages,
  loadUrl,
  direction,
  readerZoom,
}: {
  currentPage: number;
  totalPages: number;
  loadUrl: (idx: number) => Promise<string | undefined>;
  direction: ComicReadingDirection;
  readerZoom: number;
}) {
  // Page 1 is always displayed alone as front cover
  if (currentPage === 1) {
    return (
      <SinglePageView
        pageIndex={0}
        loadUrl={loadUrl}
        readerZoom={readerZoom}
        fitMode="contain"
      />
    );
  }

  // Group into even/odd pairs: page 2 & 3, page 4 & 5...
  const firstIndex = currentPage % 2 === 0 ? currentPage - 1 : currentPage - 2;
  const secondIndex = firstIndex + 1 < totalPages ? firstIndex + 1 : null;

  // For Manga (RTL), right page comes first visually, left page second
  const leftIdx = direction === 'rtl' ? secondIndex : firstIndex;
  const rightIdx = direction === 'rtl' ? firstIndex : secondIndex;

  return (
    <div
      className={styles.spreadContainer}
      style={{
        transform: readerZoom !== 1 ? `scale(${readerZoom})` : undefined,
        transformOrigin: 'center center',
      }}
    >
      {leftIdx !== null && (
        <SpreadImage
          key={leftIdx}
          pageIndex={leftIdx}
          loadUrl={loadUrl}
          readerZoom={readerZoom}
        />
      )}
      {rightIdx !== null && (
        <SpreadImage
          key={rightIdx}
          pageIndex={rightIdx}
          loadUrl={loadUrl}
          readerZoom={readerZoom}
        />
      )}
    </div>
  );
}

function SpreadImage({
  pageIndex,
  loadUrl,
  readerZoom,
}: {
  pageIndex: number;
  loadUrl: (idx: number) => Promise<string | undefined>;
  readerZoom: number;
}) {
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setSrc(undefined);
    loadUrl(pageIndex).then((url) => {
      if (active && url) setSrc(url);
    });
    return () => {
      active = false;
    };
  }, [pageIndex, loadUrl]);

  if (!src) {
    return (
      <div className={styles.pagePlaceholder} style={{ minHeight: 360, width: 320 }}>
        <div className={styles.spinner} />
        <span>Page {pageIndex + 1}…</span>
      </div>
    );
  }

  const height = Math.round((window.innerHeight - 100) * readerZoom);

  return (
    <img
      src={src}
      alt={`Page ${pageIndex + 1}`}
      className={styles.spreadImage}
      style={{
        maxHeight: `${height}px`,
        maxWidth: readerZoom <= 1 ? 'calc(50vw - 24px)' : 'none',
        height: 'auto',
      }}
    />
  );
}
