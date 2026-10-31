/**
 * Universal Comic Reader (CBZ, CBR, CB7) for WebXReader.
 *
 * Implements the rock-solid PDF reader architectural mechanics:
 * 1. Explicit pixel-based display scaling and aspect-ratio preservation
 * 2. Stable centering in flex pageStack with zero negative margin push or lateral jumping
 * 3. Smooth matrix preview zooming around pointer anchor with exact layout-effect scroll restoration
 * 4. High-performance lazy blob rendering with IntersectionObserver
 * 5. Full support for Continuous Scroll (Webtoon), Single-page Paginated, and Double-page Spread (Manga RTL)
 * 6. Universal comic archive support: ZIP (CBZ via JSZip), RAR (CBR via 7z-wasm), and 7z (CB7 via 7z-wasm)
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
  type CSSProperties,
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

interface PageSize {
  width: number;
  height: number;
}

interface ComicZoomPreviewTransform {
  baseLeft: number;
  baseTop: number;
  scale: number;
  translateX: number;
  translateY: number;
}

/**
 * Computes explicit pixel display scale matching PdfReader mechanics.
 * Guarantees zero flex-percentage circular layout calculations and stable centering.
 */
function getComicDisplayScale(
  baseWidth: number,
  baseHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  readerZoom: number,
  fitMode: ComicFitMode = 'contain',
  isSpread = false
): number {
  const paddingX = 32;
  const paddingY = 48;
  const availableWidth = Math.max(240, isSpread ? (viewportWidth - paddingX) / 2 : viewportWidth - paddingX);
  const availableHeight = Math.max(240, viewportHeight - paddingY);

  let fitScale: number;
  if (fitMode === 'width') {
    fitScale = availableWidth / Math.max(1, baseWidth);
  } else if (fitMode === 'height') {
    fitScale = availableHeight / Math.max(1, baseHeight);
  } else {
    // 'contain' standard reading view: comfortably fits within readable bounds
    const targetWidth = Math.min(isSpread ? 600 : 900, availableWidth);
    fitScale = targetWidth / Math.max(1, baseWidth);
  }

  return Math.min(8.0, Math.max(0.15, fitScale)) * readerZoom;
}

interface ComicPageViewProps {
  pageNumber: number;
  total: number;
  loadUrl: (index: number) => Promise<string | undefined>;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  pageSize: PageSize | undefined;
  readerZoom: number;
  fitMode: ComicFitMode;
  fallbackAspectRatio: number;
  layoutVersion: number;
  initiallyVisible: boolean;
  isSpread?: boolean;
  onPageSize: (pageNumber: number, size: PageSize) => void;
}

/**
 * Individual Comic Page Shell.
 * Renders at explicit pixel dimensions to ensure precise anchor zoom and scroll isolation.
 */
const ComicPageView = memo(function ComicPageView({
  pageNumber,
  total,
  loadUrl,
  viewportRef,
  pageSize,
  readerZoom,
  fitMode,
  fallbackAspectRatio,
  layoutVersion: _layoutVersion,
  initiallyVisible,
  isSpread = false,
  onPageSize,
}: ComicPageViewProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(initiallyVisible);
  const [imgSrc, setImgSrc] = useState<string | undefined>(undefined);
  const [naturalSize, setNaturalSize] = useState<PageSize | null>(pageSize ?? null);

  // Intersection observer for lazy-loading images ahead of viewport scroll
  useEffect(() => {
    if (shouldLoad) return;
    const el = shellRef.current;
    const root = viewportRef.current;
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
      { root, rootMargin: '1200px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [shouldLoad, viewportRef]);

  // Load page image blob URL
  useEffect(() => {
    if (!shouldLoad || imgSrc) return;
    let active = true;

    loadUrl(pageNumber - 1).then((url) => {
      if (active && url) {
        setImgSrc(url);
      }
    });

    return () => {
      active = false;
    };
  }, [shouldLoad, imgSrc, pageNumber, loadUrl]);

  const effectiveSize = naturalSize ?? pageSize ?? {
    width: 800,
    height: Math.round(800 / Math.max(0.2, fallbackAspectRatio)),
  };

  const viewport = viewportRef.current;
  const viewportWidth = viewport?.clientWidth || window.innerWidth;
  const viewportHeight = viewport?.clientHeight || window.innerHeight;

  const displayScale = getComicDisplayScale(
    effectiveSize.width,
    effectiveSize.height,
    viewportWidth,
    viewportHeight,
    readerZoom,
    fitMode,
    isSpread
  );

  const displayWidth = Math.floor(effectiveSize.width * displayScale);
  const displayHeight = Math.floor(effectiveSize.height * displayScale);

  const shellStyle: CSSProperties = {
    width: `${displayWidth}px`,
    height: `${displayHeight}px`,
  };

  return (
    <div
      ref={shellRef}
      className={styles.pageShell}
      data-cbz-page={pageNumber}
      data-comic-page={pageNumber}
      style={shellStyle}
      aria-label={`Comic page ${pageNumber}`}
    >
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={`Page ${pageNumber}`}
          className={styles.comicImage}
          loading="lazy"
          decoding="async"
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) {
              const size = { width: img.naturalWidth, height: img.naturalHeight };
              setNaturalSize(size);
              onPageSize(pageNumber, size);
            }
          }}
        />
      ) : (
        <div className={styles.pagePlaceholder}>
          <div className={styles.spinner} />
          <span className={styles.placeholderText}>
            Page {pageNumber} of {total}
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
  const isContinuous = readingMode === 'scroll';
  const isSpreadMode = readingMode === 'vertical';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage));
  const [commonAspectRatio, setCommonAspectRatio] = useState<number>(0.68);
  const [pageSizes, setPageSizes] = useState<Record<number, PageSize>>({});
  const [layoutVersion, setLayoutVersion] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pageStackRef = useRef<HTMLDivElement>(null);
  const previewTransformRef = useRef<ComicZoomPreviewTransform | null>(null);
  const lastZoomAnchorRef = useRef<CbzZoomAnchor | undefined>(undefined);
  const blobUrlsRef = useRef<Map<number, string>>(new Map());
  const onProgressUpdateRef = useRef(onProgressUpdate);
  const scrollFrameRef = useRef<number | null>(null);
  const previousReaderZoomRef = useRef(readerZoom);
  const hasRestoredInitialRef = useRef(false);
  const initialPageRef = useRef(initialPage);

  const pageLoaderRef = useRef<(index: number) => Promise<Blob | undefined>>(() => Promise.resolve(undefined));
  const sessionRef = useRef<ComicArchiveSession | null>(null);

  onProgressUpdateRef.current = onProgressUpdate;

  useEffect(() => {
    initialPageRef.current = initialPage;
  }, [initialPage]);

  // Record intrinsic page size when loaded
  const setPageSize = useCallback((pageNumber: number, size: PageSize) => {
    setPageSizes((prev) => {
      const current = prev[pageNumber];
      if (current && current.width === size.width && current.height === size.height) return prev;
      return { ...prev, [pageNumber]: size };
    });
    const ratio = size.width / Math.max(1, size.height);
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
        console.error(`Failed to load comic page ${pageIndex + 1}:`, err);
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

  // ResizeObserver triggers re-render when container dimensions change
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setLayoutVersion((v) => v + 1));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // Programmatic page navigation (TOC, bookmarks, keyboard)
  const scrollToPage = useCallback(
    (pageNum: number, behavior: ScrollBehavior = 'smooth') => {
      if (totalPages === 0) return;
      const target = Math.max(1, Math.min(pageNum, totalPages));
      setCurrentPage(target);

      const fraction = totalPages > 1 ? (target - 1) / (totalPages - 1) : 1;
      onProgressUpdateRef.current(String(target), fraction, target - 1);

      if (isContinuous && viewportRef.current) {
        const el = pageStackRef.current?.querySelector<HTMLElement>(
          `[data-cbz-page="${target}"], [data-comic-page="${target}"]`
        );
        if (el) {
          el.scrollIntoView({ behavior, block: 'start' });
        }
      } else {
        viewportRef.current?.scrollTo({ top: 0, left: 0, behavior });
      }
    },
    [totalPages, isContinuous]
  );

  const goToPage = scrollToPage;

  const goToProgress = useCallback(
    (fraction: number) => {
      if (totalPages === 0) return;
      const clamped = Math.min(1, Math.max(0, fraction));
      if (isContinuous && viewportRef.current) {
        const viewport = viewportRef.current;
        viewport.scrollTo({
          top: clamped * Math.max(0, viewport.scrollHeight - viewport.clientHeight),
          behavior: 'smooth',
        });
      } else {
        const targetPage = Math.round(clamped * (totalPages - 1)) + 1;
        goToPage(targetPage, 'smooth');
      }
    },
    [totalPages, isContinuous, goToPage]
  );

  // Restore initial page on mount after archive loads
  useEffect(() => {
    if (loading || totalPages === 0 || hasRestoredInitialRef.current) return;
    hasRestoredInitialRef.current = true;
    if (initialPageRef.current <= 1) return;

    const target = Math.max(1, Math.min(initialPageRef.current, totalPages));
    setCurrentPage(target);

    if (isContinuous) {
      let attempts = 0;
      let frame = 0;
      const seek = () => {
        attempts += 1;
        const el = pageStackRef.current?.querySelector<HTMLElement>(
          `[data-cbz-page="${target}"], [data-comic-page="${target}"]`
        );
        if (el || attempts >= 15) {
          if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' });
          return;
        }
        frame = requestAnimationFrame(seek);
      };
      frame = requestAnimationFrame(seek);
      return () => cancelAnimationFrame(frame);
    }
  }, [loading, totalPages, isContinuous]);

  // Preview zoom matrix transform around pointer anchor (mirrors PdfReader)
  const previewZoom = useCallback(
    (nextZoom: number, anchor: CbzZoomAnchor) => {
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
    },
    [readerZoom]
  );

  // Exact anchor restoration upon zoom commit (mirrors PdfReader)
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
  }, [readerZoom, zoomAnchor]);

  // Reset scroll to top-left when flipping pages in paginated mode
  useEffect(() => {
    if (isContinuous) return;
    const frame = requestAnimationFrame(() => {
      viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentPage, isContinuous]);

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

  // High performance active page tracking during continuous scroll
  const reportScrollPosition = useCallback(() => {
    const viewport = viewportRef.current;
    const stack = pageStackRef.current;
    if (!viewport || !stack || totalPages < 1 || !isContinuous) return;

    const viewportTop = viewport.getBoundingClientRect().top + 24;
    const shells = Array.from(
      stack.querySelectorAll<HTMLElement>('[data-cbz-page], [data-comic-page]')
    );
    if (shells.length === 0) return;

    let visiblePage = currentPage;
    for (const shell of shells) {
      if (shell.getBoundingClientRect().bottom > viewportTop) {
        visiblePage =
          Number(shell.dataset.cbzPage || shell.dataset.comicPage) || visiblePage;
        break;
      }
    }

    const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const withinPageFraction = maxScroll > 0 ? viewport.scrollTop / maxScroll : 0;
    const fraction = totalPages > 1 ? (visiblePage - 1) / (totalPages - 1) : withinPageFraction;

    setCurrentPage((prev) => (prev === visiblePage ? prev : visiblePage));
    onProgressUpdateRef.current(String(visiblePage), Math.min(1, Math.max(0, fraction)), visiblePage - 1);
  }, [currentPage, isContinuous, totalPages]);

  const handleScroll = useCallback(() => {
    if (previewTransformRef.current !== null || !isContinuous) return;
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (previewTransformRef.current !== null) return;
      reportScrollPosition();
    });
  }, [isContinuous, reportScrollPosition]);

  // Paginated navigation helpers
  const handlePrevPage = useCallback(() => {
    if (isSpreadMode) {
      const step = 2;
      const next = Math.max(1, currentPage - step);
      goToPage(next, 'auto');
    } else {
      if (currentPage > 1) {
        goToPage(currentPage - 1, 'auto');
      }
    }
  }, [isSpreadMode, currentPage, goToPage]);

  const handleNextPage = useCallback(() => {
    if (isSpreadMode) {
      const step = 2;
      const next = Math.min(totalPages, currentPage + step);
      goToPage(next, 'auto');
    } else {
      if (currentPage < totalPages) {
        goToPage(currentPage + 1, 'auto');
      }
    }
  }, [isSpreadMode, currentPage, totalPages, goToPage]);

  // Click zone handling (left 25% = prev, right 25% = next, center 50% = toggle controls)
  const handleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (isContinuous) {
        if (e.target === viewportRef.current || e.target === pageStackRef.current) {
          onToggleControls?.();
        }
        return;
      }

      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const ratio = x / rect.width;
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
    [isContinuous, readingDirection, handlePrevPage, handleNextPage, onToggleControls]
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const isRtl = readingDirection === 'rtl';

      if (isContinuous) {
        if (e.key === 'PageDown' || e.key === 'ArrowDown' || e.key === ' ') {
          e.preventDefault();
          viewport.scrollBy({ top: Math.max(160, viewport.clientHeight * 0.88), behavior: 'smooth' });
        } else if (e.key === 'PageUp' || e.key === 'ArrowUp') {
          e.preventDefault();
          viewport.scrollBy({ top: -Math.max(160, viewport.clientHeight * 0.88), behavior: 'smooth' });
        } else if (e.key === 'Home') {
          e.preventDefault();
          viewport.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (e.key === 'End') {
          e.preventDefault();
          viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
        }
      } else {
        if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
          e.preventDefault();
          if (isRtl) handlePrevPage();
          else handleNextPage();
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          e.preventDefault();
          if (isRtl) handleNextPage();
          else handlePrevPage();
        } else if (e.key === 'Home') {
          e.preventDefault();
          goToPage(1, 'auto');
        } else if (e.key === 'End') {
          e.preventDefault();
          goToPage(totalPages, 'auto');
        }
      }
    },
    [isContinuous, readingDirection, handlePrevPage, handleNextPage, goToPage, totalPages]
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

  // Calculate pages to display in Spread Mode
  let spreadLeft: number | null = null;
  let spreadRight: number | null = null;
  if (isSpreadMode && currentPage > 1) {
    const firstIdx = currentPage % 2 === 0 ? currentPage - 1 : currentPage - 2;
    const secondIdx = firstIdx + 1 < totalPages ? firstIdx + 1 : null;
    spreadLeft = readingDirection === 'rtl' ? (secondIdx !== null ? secondIdx + 1 : null) : firstIdx + 1;
    spreadRight = readingDirection === 'rtl' ? firstIdx + 1 : (secondIdx !== null ? secondIdx + 1 : null);
  }

  return (
    <div
      ref={containerRef}
      className={styles.container}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      autoFocus
    >
      <div
        ref={viewportRef}
        className={styles.viewport}
        data-reader-viewport={isContinuous ? 'cbz-vertical-scroll' : 'cbz-page'}
        data-comic-viewport={isContinuous ? 'vertical-scroll' : 'page'}
        data-current-page={currentPage}
        onScroll={handleScroll}
        onClick={handleClick}
      >
        <div
          ref={pageStackRef}
          className={styles.pageStack}
          style={{ gap: `${pageGap}px` }}
        >
          {isContinuous ? (
            /* 1. Continuous Webtoon Scroll */
            Array.from({ length: totalPages }, (_, idx) => (
              <ComicPageView
                key={idx + 1}
                pageNumber={idx + 1}
                total={totalPages}
                loadUrl={loadPageBlobUrl}
                viewportRef={viewportRef}
                pageSize={pageSizes[idx + 1]}
                readerZoom={readerZoom}
                fitMode={fitMode}
                fallbackAspectRatio={commonAspectRatio}
                layoutVersion={layoutVersion}
                initiallyVisible={Math.abs(idx + 1 - currentPage) <= 1}
                onPageSize={setPageSize}
              />
            ))
          ) : isSpreadMode && currentPage > 1 ? (
            /* 2. Double-Page Spread Mode */
            <div className={styles.spreadRow} style={{ gap: `${pageGap}px` }}>
              {spreadLeft !== null && (
                <ComicPageView
                  key={spreadLeft}
                  pageNumber={spreadLeft}
                  total={totalPages}
                  loadUrl={loadPageBlobUrl}
                  viewportRef={viewportRef}
                  pageSize={pageSizes[spreadLeft]}
                  readerZoom={readerZoom}
                  fitMode={fitMode}
                  fallbackAspectRatio={commonAspectRatio}
                  layoutVersion={layoutVersion}
                  initiallyVisible={true}
                  isSpread={true}
                  onPageSize={setPageSize}
                />
              )}
              {spreadRight !== null && (
                <ComicPageView
                  key={spreadRight}
                  pageNumber={spreadRight}
                  total={totalPages}
                  loadUrl={loadPageBlobUrl}
                  viewportRef={viewportRef}
                  pageSize={pageSizes[spreadRight]}
                  readerZoom={readerZoom}
                  fitMode={fitMode}
                  fallbackAspectRatio={commonAspectRatio}
                  layoutVersion={layoutVersion}
                  initiallyVisible={true}
                  isSpread={true}
                  onPageSize={setPageSize}
                />
              )}
            </div>
          ) : (
            /* 3. Single-Page Paginated Mode */
            <ComicPageView
              key={currentPage}
              pageNumber={currentPage}
              total={totalPages}
              loadUrl={loadPageBlobUrl}
              viewportRef={viewportRef}
              pageSize={pageSizes[currentPage]}
              readerZoom={readerZoom}
              fitMode={fitMode}
              fallbackAspectRatio={commonAspectRatio}
              layoutVersion={layoutVersion}
              initiallyVisible={true}
              onPageSize={setPageSize}
            />
          )}
        </div>
      </div>
    </div>
  );
});

export const ComicReader = CbzReader;
export default CbzReader;
