/**
 * Universal Comic Reader (CBZ, CBR, CB7) for WebXReader.
 *
 * Implements the rock-solid PDF reader architectural mechanics:
 * 1. Explicit pixel-based display scaling and aspect-ratio preservation
 * 2. Stable centering in flex pageStack with zero negative margin push or lateral jumping
 * 3. Smooth matrix preview zooming around pointer anchor with exact layout-effect scroll restoration
 * 4. High-performance lazy blob rendering with IntersectionObserver
 * 5. Full support for Continuous Vertical Scroll (Webtoon), Continuous Horizontal Ribbon Scroll, Single-page Paginated, and Realistic 3D Double-page Spread (LTR Western & RTL Manga)
 * 6. Universal comic archive support: ZIP (CBZ via JSZip), RAR (CBR via 7z-wasm), and 7z (CB7 via 7z-wasm)
 * 7. Invert Colors filter toggle for dark/night reading
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
import { openBudgetedZip, readZipEntryLimited } from '../../core/parsing/zip-budget';
import { COMIC_ARCHIVE_TOTAL_BYTES } from '../../core/parsing/archive-size-limits';
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
import type { ComicReadingDirection, ComicFitMode, ReadingMode } from '../../types/book';
import { ComicDoubleSidedReader } from './ComicDoubleSidedReader';
import { findLeadingPage } from './visible-page';
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
  previewZoom: (zoom: number, anchor?: CbzZoomAnchor) => void;
  getCurrentPage: () => number;
  getTotalPages: () => number;
}

export type ComicZoomAnchor = CbzZoomAnchor;
export type ComicReaderHandle = CbzReaderHandle;

export interface CbzReaderProps {
  fileData: ArrayBuffer;
  format?: 'cbz' | 'cbr' | 'cb7' | string;
  initialPage?: number;
  bookmarkFraction?: number;
  readingMode?: ReadingMode;
  readingDirection?: ComicReadingDirection;
  fitMode?: ComicFitMode;
  pageGap?: number;
  onProgressUpdate: (chapterId: string, progressFraction: number, pageIndex: number) => void;
  onToggleControls?: () => void;
  readerZoom?: number;
  zoomAnchor?: CbzZoomAnchor;
  onZoomGesture?: (deltaY: number, point?: { x: number; y: number }) => void;
  invertColors?: boolean;
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
  isSpread = false,
  isHorizontal = false
): number {
  if (isHorizontal) {
    const availableHeight = Math.max(240, viewportHeight - 48);
    const fitScale = availableHeight / Math.max(1, baseHeight);
    return Math.min(8.0, Math.max(0.15, fitScale)) * readerZoom;
  }

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
  isHorizontal?: boolean;
  invertColors?: boolean;
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
  isHorizontal = false,
  invertColors = false,
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
      { root, rootMargin: isHorizontal ? '0px 1200px' : '1200px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [shouldLoad, viewportRef, isHorizontal]);

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
    isSpread,
    isHorizontal
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
      className={`${styles.pageShell} ${invertColors ? styles.pageInverted : ''}`}
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

/**
 * Universal Comic reader component supporting vertical continuous scroll,
 * horizontal ribbon scroll, paginated single page, and double-sided spreads.
 */
export const CbzReader = forwardRef<CbzReaderHandle, CbzReaderProps>(function CbzReader(
  {
    fileData,
    format,
    initialPage = 1,
    bookmarkFraction = 0,
    readingMode = 'scroll',
    readingDirection = 'ltr',
    fitMode = 'contain',
    pageGap = 16,
    onProgressUpdate,
    onToggleControls,
    readerZoom = 1,
    zoomAnchor,
    onZoomGesture,
    invertColors = false,
  },
  ref
) {
  const isContinuous = readingMode === 'scroll';
  const isHorizontal = readingMode === 'horizontal';
  const isSpreadMode = readingMode === 'vertical';
  const isPaginated = readingMode === 'paginated';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage));
  const [commonAspectRatio, setCommonAspectRatio] = useState<number>(0.68);
  const [pageSizes, setPageSizes] = useState<Record<number, PageSize>>({});
  const [layoutVersion, setLayoutVersion] = useState(0);

  const [isPanning, setIsPanning] = useState(false);
  const [isSpaceDown, setIsSpaceDown] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pageStackRef = useRef<HTMLDivElement>(null);
  const previewTransformRef = useRef<ComicZoomPreviewTransform | null>(null);
  const lastZoomAnchorRef = useRef<CbzZoomAnchor | undefined>(undefined);
  const blobUrlsRef = useRef<Map<number, string>>(new Map());
  const pendingPagesRef = useRef<Map<number, Promise<string | undefined>>>(new Map());
  const archiveGenerationRef = useRef(0);
  const onProgressUpdateRef = useRef(onProgressUpdate);
  const scrollFrameRef = useRef<number | null>(null);
  const previousReaderZoomRef = useRef(readerZoom);
  const hasRestoredInitialRef = useRef(false);
  const initialPageRef = useRef(initialPage);
  const bookmarkFractionRef = useRef(Math.min(1, Math.max(0, bookmarkFraction)));
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const doubleSidedRef = useRef<CbzReaderHandle>(null);

  const isMouseDownRef = useRef(false);
  const isSpaceDownRef = useRef(false);
  const spaceDraggedRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number }>({
    x: 0,
    y: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

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
        } catch {}
      });
      urls.clear();
      archiveGenerationRef.current++;
      pendingPagesRef.current.clear();
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
      const pending = pendingPagesRef.current.get(pageIndex);
      if (pending) return pending;

      const generation = archiveGenerationRef.current;
      const load = (async () => { try {
        const blob = await pageLoaderRef.current(pageIndex);
        if (!blob || generation !== archiveGenerationRef.current) return undefined;
        const url = URL.createObjectURL(blob);
        blobUrlsRef.current.set(pageIndex, url);
        return url;
      } catch (err) {
        console.error(`Failed to load comic page ${pageIndex + 1}:`, err);
        return undefined;
      } finally {
        pendingPagesRef.current.delete(pageIndex);
      } })();
      pendingPagesRef.current.set(pageIndex, load);
      return load;
    },
    [totalPages]
  );

  // Parse archive and extract sorted image entries (ZIP, RAR, or 7z)
  useEffect(() => {
    let active = true;
    archiveGenerationRef.current++;
    pendingPagesRef.current.clear();
    blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    blobUrlsRef.current.clear();
    setLoading(true);
    setError(null);
    hasRestoredInitialRef.current = false;

    const finishLoad = (count: number) => {
      if (bookmarkFractionRef.current > 0 && count > 0) {
        setCurrentPage(Math.round(bookmarkFractionRef.current * (count - 1)) + 1);
      }
      setTotalPages(count);
      setLoading(false);
    };

    async function loadArchive() {
      try {
        if (!fileData || fileData.byteLength < 32) {
          setLoading(false);
          return;
        }

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
          finishLoad(session.pageNames.length);
        } else {
          const zip = await openBudgetedZip(fileData, COMIC_ARCHIVE_TOTAL_BYTES);
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
            return entry ? new Blob([await readZipEntryLimited(entry) as BlobPart]) : undefined;
          };
          finishLoad(entries.length);
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

  useEffect(() => {
    for (const [index, url] of blobUrlsRef.current) {
      if (Math.abs(index + 1 - currentPage) > 3) {
        URL.revokeObjectURL(url);
        blobUrlsRef.current.delete(index);
      }
    }
  }, [currentPage]);

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
      const target = totalPages > 0 ? Math.max(1, Math.min(pageNum, totalPages)) : Math.max(1, pageNum);
      setCurrentPage(target);

      const fraction = totalPages > 1 ? (target - 1) / (totalPages - 1) : 0;
      onProgressUpdateRef.current(String(target), fraction, target - 1);

      if ((isContinuous || isHorizontal) && viewportRef.current) {
        const el = pageStackRef.current?.querySelector<HTMLElement>(
          `[data-cbz-page="${target}"], [data-comic-page="${target}"]`
        );
        if (el) {
          el.scrollIntoView({ behavior, block: isHorizontal ? 'nearest' : 'start', inline: isHorizontal ? 'start' : 'nearest' });
        }
      } else {
        viewportRef.current?.scrollTo?.({ top: 0, left: 0, behavior });
      }
    },
    [totalPages, isContinuous, isHorizontal]
  );

  const goToPage = useCallback((pageNum: number, behavior: ScrollBehavior = 'smooth') => {
    const target = totalPages > 0 ? Math.max(1, Math.min(pageNum, totalPages)) : Math.max(1, pageNum);
    if (isSpreadMode && doubleSidedRef.current) {
      doubleSidedRef.current.goToPage(target);
      return;
    }
    scrollToPage(target, behavior);
  }, [totalPages, isSpreadMode, scrollToPage]);

  const goToProgress = useCallback(
    (fraction: number) => {
      if (totalPages === 0) return;
      const clamped = Math.min(1, Math.max(0, fraction));
      if (isSpreadMode && doubleSidedRef.current) {
        doubleSidedRef.current.goToProgress(clamped);
        return;
      }
      if (isContinuous && viewportRef.current) {
        const viewport = viewportRef.current;
        viewport.scrollTo?.({
          top: clamped * Math.max(0, viewport.scrollHeight - viewport.clientHeight),
          behavior: 'smooth',
        });
      } else if (isHorizontal && viewportRef.current) {
        const viewport = viewportRef.current;
        viewport.scrollTo?.({
          left: (readingDirection === 'rtl' ? 1 - clamped : clamped) * Math.max(0, viewport.scrollWidth - viewport.clientWidth),
          behavior: 'smooth',
        });
      } else {
        const targetPage = Math.round(clamped * (totalPages - 1)) + 1;
        goToPage(targetPage, 'smooth');
      }
    },
    [totalPages, isContinuous, isHorizontal, isSpreadMode, readingDirection, goToPage]
  );

  // Restore initial page on mount after archive loads
  useEffect(() => {
    if (loading || totalPages === 0) return;
    const restoring = !hasRestoredInitialRef.current;
    hasRestoredInitialRef.current = true;
    const fraction = restoring ? bookmarkFractionRef.current : 0;
    const target = Math.max(1, Math.min(restoring && !(fraction > 0) ? initialPageRef.current : currentPageRef.current, totalPages));
    setCurrentPage(target);

    if (isContinuous || isHorizontal) {
      let attempts = 0;
      let frame = 0;
      const seek = () => {
        attempts += 1;
        const el = pageStackRef.current?.querySelector<HTMLElement>(
          `[data-cbz-page="${target}"], [data-comic-page="${target}"]`
        );
        if (el || attempts >= 15) {
          const viewport = viewportRef.current;
          if (fraction > 0 && isHorizontal && viewport) {
            const ratio = readingDirection === 'rtl' ? 1 - fraction : fraction;
            viewport.scrollLeft = ratio * Math.max(0, viewport.scrollWidth - viewport.clientWidth);
          } else if (el) el.scrollIntoView({ behavior: 'auto', block: isHorizontal ? 'nearest' : 'start', inline: isHorizontal ? 'start' : 'nearest' });
          return;
        }
        frame = requestAnimationFrame(seek);
      };
      frame = requestAnimationFrame(seek);
      return () => cancelAnimationFrame(frame);
    }
  }, [loading, totalPages, isContinuous, isHorizontal, isSpreadMode, readingDirection]);

  // Preview zoom matrix transform around pointer anchor (mirrors PdfReader)
  const previewZoom = useCallback(
    (nextZoom: number, anchor?: CbzZoomAnchor) => {
      if (isSpreadMode && doubleSidedRef.current) {
        doubleSidedRef.current.previewZoom(nextZoom, anchor);
        return;
      }

      const viewport = viewportRef.current;
      const pageStack = pageStackRef.current ?? viewport?.querySelector<HTMLElement>('[class*="Stack"]');
      if (!viewport || !pageStack) return;

      const scale = nextZoom / readerZoom;
      if (Math.abs(scale - 1) < 0.005) {
        pageStack.style.transform = '';
        pageStack.style.transformOrigin = '';
        previewTransformRef.current = null;
        if (anchor) lastZoomAnchorRef.current = anchor;
        return;
      }

      const isZoomingOut = nextZoom < readerZoom;
      const targetViewportX = isZoomingOut || !anchor
        ? viewport.clientWidth / 2
        : Math.max(0, Math.min(viewport.clientWidth, anchor.viewportX));
      const targetViewportY = isZoomingOut || !anchor
        ? viewport.clientHeight / 2
        : Math.max(0, Math.min(viewport.clientHeight, anchor.viewportY));

      const stackX = viewport.scrollLeft + targetViewportX - pageStack.offsetLeft;
      const stackY = viewport.scrollTop + targetViewportY - pageStack.offsetTop;
      const translateX = Math.round(stackX * (1 - scale));
      const translateY = Math.round(stackY * (1 - scale));

      if (anchor) lastZoomAnchorRef.current = anchor;
      pageStack.style.transformOrigin = '0 0';
      pageStack.style.transform = `matrix(${scale}, 0, 0, ${scale}, ${translateX}, ${translateY})`;
      previewTransformRef.current = {
        baseLeft: pageStack.offsetLeft,
        baseTop: pageStack.offsetTop,
        scale,
        translateX,
        translateY,
      };
    },
    [readerZoom, isSpreadMode]
  );

  // Exact anchor restoration upon zoom commit (mirrors PdfReader)
  useLayoutEffect(() => {
    if (isSpreadMode) return;
    if (previousReaderZoomRef.current === readerZoom) return;
    const prevZoom = previousReaderZoomRef.current;
    const wasZoomingOut = readerZoom < prevZoom;
    previousReaderZoomRef.current = readerZoom;

    const viewport = viewportRef.current;
    const pageStack = pageStackRef.current ?? viewport?.querySelector<HTMLElement>('[class*="Stack"]');
    if (pageStack) {
      pageStack.style.transform = '';
      pageStack.style.transformOrigin = '';
    }
    previewTransformRef.current = null;

    if (!viewport) return;

    const activeAnchor = zoomAnchor ?? lastZoomAnchorRef.current;
    lastZoomAnchorRef.current = undefined;

    const targetViewportX = wasZoomingOut
      ? viewport.clientWidth / 2
      : (activeAnchor?.viewportX ?? viewport.clientWidth / 2);
    const targetViewportY = wasZoomingOut
      ? viewport.clientHeight / 2
      : (activeAnchor?.viewportY ?? viewport.clientHeight / 2);

    const page = activeAnchor?.pageNumber
      ? pageStack?.querySelector<HTMLElement>(
          `[data-cbz-page="${activeAnchor.pageNumber}"], [data-comic-page="${activeAnchor.pageNumber}"]`
        )
      : null;
    const pageRect = page?.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const hasRenderedPage = Boolean(page && pageRect && (pageRect.height > 0 || pageRect.width > 0));

    if (hasRenderedPage && page && pageRect) {
      const anchorPageX = activeAnchor?.pageX ?? 0.5;
      const anchorPageY = activeAnchor?.pageY ?? 0.5;

      const currentAnchorViewportX = pageRect.left - viewportRect.left + pageRect.width * anchorPageX;
      const currentAnchorViewportY = pageRect.top - viewportRect.top + pageRect.height * anchorPageY;

      const deltaX = currentAnchorViewportX - targetViewportX;
      const deltaY = currentAnchorViewportY - targetViewportY;

      const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const nextScrollLeft = wasZoomingOut && readerZoom <= 1.0 && !isHorizontal
        ? Math.round(maxScrollLeft / 2)
        : Math.max(0, Math.min(maxScrollLeft, Math.round(viewport.scrollLeft + deltaX)));
      const nextScrollTop = wasZoomingOut && readerZoom <= 1.0 && isHorizontal
        ? Math.round(maxScrollTop / 2)
        : Math.max(0, Math.min(maxScrollTop, Math.round(viewport.scrollTop + deltaY)));

      viewport.scrollTo?.({
        left: nextScrollLeft,
        top: nextScrollTop,
        behavior: 'auto',
      });
      return;
    }

    if (readerZoom <= 1.0) {
      const maxScrollX = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const maxScrollY = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      viewport.scrollTo?.({
        left: isHorizontal ? viewport.scrollLeft : Math.round(maxScrollX / 2),
        top: isHorizontal ? Math.round(maxScrollY / 2) : viewport.scrollTop,
        behavior: 'auto',
      });
      return;
    }

    const zoomRatio = prevZoom > 0 ? readerZoom / prevZoom : 1;
    const docX = viewport.scrollLeft + targetViewportX;
    const docY = viewport.scrollTop + targetViewportY;

    if (isHorizontal) {
      const nextScrollLeft = Math.max(0, Math.round(docX * zoomRatio - targetViewportX));
      viewport.scrollTo?.({ left: nextScrollLeft, behavior: 'auto' });
      return;
    }

    // Vertical continuous scroll
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const nextScrollTop = Math.max(0, Math.min(maxScrollTop, Math.round(docY * zoomRatio - targetViewportY)));
    const nextScrollLeft = wasZoomingOut && readerZoom <= 1.0
      ? Math.round(maxScrollLeft / 2)
      : Math.max(0, Math.min(maxScrollLeft, Math.round(docX * zoomRatio - targetViewportX)));

    viewport.scrollTo?.({
      left: nextScrollLeft,
      top: nextScrollTop,
      behavior: 'auto',
    });
  }, [readerZoom, zoomAnchor, isHorizontal, isSpreadMode]);

  // Reset scroll to top-left when flipping pages in paginated mode
  useEffect(() => {
    if (isContinuous || isHorizontal) return;
    const frame = requestAnimationFrame(() => {
      viewportRef.current?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentPage, isContinuous, isHorizontal]);

  // Report progress synchronously on page change in paginated mode
  useEffect(() => {
    if (!isPaginated || loading || error || totalPages < 1) return;
    const fraction = totalPages > 1 ? (currentPage - 1) / (totalPages - 1) : 0;
    onProgressUpdateRef.current(String(currentPage), Math.min(1, Math.max(0, fraction)), currentPage - 1);
  }, [currentPage, error, isPaginated, loading, totalPages]);

  // Native wheel listener for Ctrl+Wheel zooming and horizontal scrolling
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleNativeWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (onZoomGesture) {
          e.preventDefault();
          e.stopPropagation();
          const isZoomingIn = e.deltaY < 0;
          const viewportRect = viewport.getBoundingClientRect();
          const point = isZoomingIn
            ? { x: e.clientX, y: e.clientY }
            : {
                x: viewportRect.left + viewportRect.width / 2,
                y: viewportRect.top + viewportRect.height / 2,
              };
          onZoomGesture(e.deltaY, point);
        }
        return;
      } else if (isHorizontal && !e.shiftKey && Math.abs(e.deltaY) > 0) {
        e.preventDefault();
        viewport.scrollLeft += e.deltaY * (readingDirection === 'rtl' ? -1 : 1);
      }
    };

    viewport.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleNativeWheel);
  }, [isHorizontal, onZoomGesture, readingDirection]);

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
    if (!viewport || !stack || totalPages < 1) return;

    const rect = viewport.getBoundingClientRect();
    const rtl = isHorizontal && readingDirection === 'rtl';
    const page = findLeadingPage(stack.children, (bounds) => {
      if (rtl) return bounds.left < rect.right - 24;
      if (isHorizontal) return bounds.right > rect.left + 24;
      return bounds.bottom > rect.top + 24;
    }, rtl);
    const visiblePage = Number(page?.getAttribute('data-cbz-page')) || currentPage;
    const maxScroll = isHorizontal
      ? viewport.scrollWidth - viewport.clientWidth
      : viewport.scrollHeight - viewport.clientHeight;
    const offset = isHorizontal ? viewport.scrollLeft : viewport.scrollTop;
    const scrollFraction = maxScroll > 0 ? offset / maxScroll : 0;
    const fraction = isHorizontal ? rtl && maxScroll > 0 ? 1 - scrollFraction : scrollFraction
      : totalPages > 1 ? (visiblePage - 1) / (totalPages - 1) : scrollFraction;
    setCurrentPage(visiblePage);
    onProgressUpdateRef.current(String(visiblePage), Math.min(1, Math.max(0, fraction)), visiblePage - 1);
  }, [currentPage, isHorizontal, totalPages, readingDirection]);

  const handleScroll = useCallback(() => {
    if (previewTransformRef.current !== null || (!isContinuous && !isHorizontal)) return;
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (previewTransformRef.current !== null) return;
      reportScrollPosition();
    });
  }, [isContinuous, isHorizontal, reportScrollPosition]);

  // Paginated navigation helpers
  const handlePrevPage = useCallback(() => {
    if (currentPage > 1) {
      goToPage(currentPage - 1, 'auto');
    }
  }, [currentPage, goToPage]);

  const handleNextPage = useCallback(() => {
    if (currentPage < totalPages) {
      goToPage(currentPage + 1, 'auto');
    }
  }, [currentPage, totalPages, goToPage]);

  // Pointer drag and pan handling
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const canPan = readerZoom > 1 || isSpaceDownRef.current || e.button === 1;
      if (!canPan && e.button !== 0) return;

      isMouseDownRef.current = true;
      hasDraggedRef.current = false;
      const viewport = viewportRef.current;
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: viewport?.scrollLeft ?? 0,
        scrollTop: viewport?.scrollTop ?? 0,
      };
    },
    [readerZoom]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isMouseDownRef.current) return;
      if (e.buttons === 0) {
        isMouseDownRef.current = false;
        setIsPanning(false);
        return;
      }

      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      const canPan = readerZoom > 1 || isSpaceDownRef.current || (e.buttons & 4) !== 0;

      if (!hasDraggedRef.current && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        hasDraggedRef.current = true;
        if (isSpaceDownRef.current) {
          spaceDraggedRef.current = true;
        }
        if (canPan) {
          setIsPanning(true);
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {}
        }
      }

      if (hasDraggedRef.current && canPan) {
        const viewport = viewportRef.current;
        if (viewport) {
          viewport.scrollLeft = dragStartRef.current.scrollLeft - dx;
          viewport.scrollTop = dragStartRef.current.scrollTop - dy;
        }
      }
    },
    [readerZoom]
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isMouseDownRef.current) return;
    isMouseDownRef.current = false;
    setIsPanning(false);

    try {
      if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      }
    } catch {}

    if (hasDraggedRef.current) {
      setTimeout(() => {
        hasDraggedRef.current = false;
      }, 100);
    }
  }, []);

  // Click zone handling (left 25% = prev, right 25% = next, center 50% = toggle controls)
  const handleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (hasDraggedRef.current) return;

      if (isContinuous || isHorizontal) {
        if (e.target === viewportRef.current || e.target === pageStackRef.current) {
          onToggleControls?.();
        }
        return;
      }

      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const ratio = x / rect.width;
      if (ratio < 0.25) {
        handlePrevPage();
      } else if (ratio > 0.75) {
        handleNextPage();
      } else {
        onToggleControls?.();
      }
    },
    [isContinuous, isHorizontal, handlePrevPage, handleNextPage, onToggleControls]
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      if (e.key === ' ' || e.code === 'Space') {
        const activeElement = document.activeElement;
        const isInput =
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          activeElement?.getAttribute('contenteditable') === 'true';
        if (!isInput) {
          e.preventDefault();
          if (!isSpaceDownRef.current) {
            isSpaceDownRef.current = true;
            spaceDraggedRef.current = false;
            setIsSpaceDown(true);
          }
          return;
        }
      }

      if (isHorizontal) {
        if (e.key === (readingDirection === 'rtl' ? 'ArrowLeft' : 'ArrowRight') || e.key === 'PageDown') {
          e.preventDefault();
          handleNextPage();
        } else if (e.key === (readingDirection === 'rtl' ? 'ArrowRight' : 'ArrowLeft') || e.key === 'PageUp') {
          e.preventDefault();
          handlePrevPage();
        } else if (e.key === 'Home') {
          e.preventDefault();
          goToPage(1, 'smooth');
        } else if (e.key === 'End') {
          e.preventDefault();
          goToPage(totalPages, 'smooth');
        }
        return;
      }

      if (isContinuous) {
        if (e.key === 'PageDown' || e.key === 'ArrowDown') {
          e.preventDefault();
          viewport.scrollBy?.({ top: Math.max(160, viewport.clientHeight * 0.88), behavior: 'smooth' });
        } else if (e.key === 'PageUp' || e.key === 'ArrowUp') {
          e.preventDefault();
          viewport.scrollBy?.({ top: -Math.max(160, viewport.clientHeight * 0.88), behavior: 'smooth' });
        } else if (e.key === 'Home') {
          e.preventDefault();
          viewport.scrollTo?.({ top: 0, behavior: 'smooth' });
        } else if (e.key === 'End') {
          e.preventDefault();
          viewport.scrollTo?.({ top: viewport.scrollHeight, behavior: 'smooth' });
        }
        return;
      }

      // Paginated
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        handleNextPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        handlePrevPage();
      } else if (e.key === 'Home') {
        e.preventDefault();
        goToPage(1, 'auto');
      } else if (e.key === 'End') {
        e.preventDefault();
        goToPage(totalPages, 'auto');
      }
    },
    [isContinuous, isHorizontal, handlePrevPage, handleNextPage, goToPage, totalPages, readingDirection]
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === ' ' || e.code === 'Space') {
        const wasDown = isSpaceDownRef.current;
        const hadDragged = spaceDraggedRef.current;
        isSpaceDownRef.current = false;
        spaceDraggedRef.current = false;
        setIsSpaceDown(false);

        if (wasDown && !hadDragged) {
          const viewport = viewportRef.current;
          if (!viewport) return;
          if (isContinuous) {
            viewport.scrollBy?.({ top: Math.max(160, viewport.clientHeight * 0.88), behavior: 'smooth' });
          } else {
            handleNextPage();
          }
        }
      }
    },
    [isContinuous, handlePrevPage, handleNextPage]
  );

  // Delegate double-sided spread mode to ComicDoubleSidedReader
  if (isSpreadMode && totalPages > 0) {
    return (
      <ComicDoubleSidedReader
        ref={doubleSidedRef}
        totalPages={totalPages}
        initialPage={currentPage}
        readingDirection={readingDirection}
        loadUrl={loadPageBlobUrl}
        pageSizes={pageSizes}
        onProgressUpdate={(chapterId, fraction, pageIndex) => {
          setCurrentPage(pageIndex + 1);
          onProgressUpdateRef.current(chapterId, fraction, pageIndex);
        }}
        onToggleControls={onToggleControls}
        readerZoom={readerZoom}
        zoomAnchor={zoomAnchor}
        onZoomGesture={onZoomGesture}
        invertColors={invertColors}
      />
    );
  }

  const stackClassName = isHorizontal
    ? styles.horizontalStack
    : isPaginated
      ? styles.paginatedStack
      : styles.pageStack;

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${invertColors ? styles.containerInverted : ''} ${readerZoom > 1 ? styles.isZoomed : ''} ${isPanning ? styles.isPanning : ''} ${isSpaceDown ? styles.isHandTool : ''}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      autoFocus
      role="region"
      aria-label="Comic Document Viewer"
    >
      <div
        ref={viewportRef}
        className={styles.viewport}
        data-reader-viewport={
          isHorizontal
            ? 'comic-horizontal-scroll'
            : isPaginated
              ? 'cbz-page'
              : 'cbz-vertical-scroll'
        }
        data-comic-viewport={
          isHorizontal
            ? 'horizontal-scroll'
            : isPaginated
              ? 'page'
              : 'vertical-scroll'
        }
        data-current-page={currentPage}
        onScroll={handleScroll}
        onClick={handleClick}
      >
        {loading && (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner} />
            <p>Opening comic archive…</p>
          </div>
        )}

        {error && (
          <div className={styles.errorOverlay}>
            <AlertCircle size={36} color="var(--color-danger)" />
            <p className={styles.errorText}>{error}</p>
          </div>
        )}

        {!loading && !error && (
          <div
            ref={pageStackRef}
            className={stackClassName}
            style={{ gap: `${pageGap}px` }}
          >
          {isContinuous || isHorizontal ? (
            /* Continuous Vertical (Webtoon) or Horizontal Ribbon Scroll */
            Array.from({ length: totalPages }, (_, position) => {
              const idx = isHorizontal && readingDirection === 'rtl' ? totalPages - position - 1 : position;
              return (
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
                initiallyVisible={idx + 1 === initialPageRef.current}
                isHorizontal={isHorizontal}
                invertColors={invertColors}
                onPageSize={setPageSize}
              />
              );
            })
          ) : (
            /* Single-Page Paginated Mode */
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
              invertColors={invertColors}
              onPageSize={setPageSize}
            />
          )}
        </div>
        )}
      </div>
    </div>
  );
});

export const ComicReader = CbzReader;
export default CbzReader;
