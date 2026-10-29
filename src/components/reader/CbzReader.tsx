/**
 * CBZ Comic Reader for WebXReader.
 *
 * Provides high-performance, responsive comic reading supporting:
 * 1. Webtoon / continuous vertical scroll mode with stable layout and zero page overlap
 * 2. Single-page paginated mode with keyboard and click-zone navigation
 * 3. Double-page spread mode with Manga (RTL) reading support
 * 4. Lazy blob URL decoding and automatic memory management
 * 5. High-resolution canvas/image zoom mirroring PDF reader mechanics (24% to 800% scale, Ctrl+wheel pivot anchor)
 * 6. Clean zoom/scroll isolation: stops scrolling and suppresses layout shifts while zooming
 * 7. Blazing fast skimming performance: O(log N) binary search page tracking and stable aspect-ratio shells
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
import { naturalCompare } from '../../core/parsing/cbz-parser';
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

interface CbzReaderProps {
  fileData: ArrayBuffer;
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

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp']);

function isImageFile(filename: string): boolean {
  const parts = filename.toLowerCase().split('.');
  if (parts.length < 2) return false;
  return IMAGE_EXTENSIONS.has(parts[parts.length - 1]);
}

function shouldIgnore(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  for (const part of normalized.split('/')) {
    if (
      part.startsWith('__MACOSX') ||
      part.startsWith('.') ||
      part === 'Thumbs.db' ||
      part === 'desktop.ini' ||
      part.startsWith('._')
    ) {
      return true;
    }
  }
  return false;
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

  const availableWidth = containerRef.current?.clientWidth
    ? Math.max(300, containerRef.current.clientWidth - 48)
    : 850;
  const baseWidth = fitMode === 'width' ? availableWidth : Math.min(availableWidth, 900);
  const scaledWidth = Math.round(baseWidth * readerZoom);

  if (fitMode === 'height') {
    maxHeightStyle = `${Math.round((window.innerHeight - 100) * readerZoom)}px`;
    widthStyle = 'auto';
  } else {
    widthStyle = `${scaledWidth}px`;
    maxWidthStyle = readerZoom <= 1 ? '100%' : 'none';
  }

  const effectiveRatio = aspectRatio ?? fallbackAspectRatio;

  return (
    <div
      ref={shellRef}
      className={styles.pageShell}
      data-cbz-page={pageIndex + 1}
      style={{
        width: widthStyle,
        maxWidth: maxWidthStyle,
        maxHeight: maxHeightStyle,
        aspectRatio: effectiveRatio ? String(effectiveRatio) : undefined,
      }}
    >
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={`Page ${pageIndex + 1}`}
          className={styles.scrollImage}
          style={{
            maxWidth: '100%',
            maxHeight: maxHeightStyle,
            objectFit: 'contain',
          }}
          onLoad={(e) => {
            const { naturalWidth, naturalHeight } = e.currentTarget;
            if (naturalWidth && naturalHeight && !aspectRatio) {
              const ratio = naturalWidth / naturalHeight;
              setAspectRatio(ratio);
              onAspectRatio(ratio);
            }
          }}
        />
      ) : (
        <div className={styles.pagePlaceholder} style={{ minHeight: 320 }}>
          <div className={styles.spinner} style={{ width: 24, height: 24 }} />
          <span>Page {pageIndex + 1} of {total}</span>
        </div>
      )}
    </div>
  );
});

export const CbzReader = forwardRef<CbzReaderHandle, CbzReaderProps>(function CbzReader(
  {
    fileData,
    initialPage = 1,
    readingMode = 'scroll',
    readingDirection = 'ltr',
    fitMode = 'contain',
    pageGap = 24,
    onProgressUpdate,
    onToggleControls,
    readerZoom = 1.0,
    zoomAnchor,
  },
  ref
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageEntries, setPageEntries] = useState<JSZip.JSZipObject[]>([]);
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

  onProgressUpdateRef.current = onProgressUpdate;

  const totalPages = pageEntries.length;

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
    };
  }, []);

  // Load and cache a page's Blob URL
  const loadPageBlobUrl = useCallback(
    async (pageIndex: number): Promise<string | undefined> => {
      if (pageIndex < 0 || pageIndex >= pageEntries.length) return undefined;
      const cached = blobUrlsRef.current.get(pageIndex);
      if (cached) return cached;

      try {
        const entry = pageEntries[pageIndex];
        const blob = await entry.async('blob');
        const url = URL.createObjectURL(blob);
        blobUrlsRef.current.set(pageIndex, url);
        return url;
      } catch (err) {
        console.error(`Failed to load page ${pageIndex + 1}:`, err);
        return undefined;
      }
    },
    [pageEntries]
  );

  // Parse zip and extract sorted image entries
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    hasRestoredInitialRef.current = false;

    async function loadArchive() {
      try {
        const zip = await JSZip.loadAsync(fileData);
        const images: { path: string; entry: JSZip.JSZipObject }[] = [];

        zip.forEach((path, entry) => {
          if (!entry.dir && isImageFile(path) && !shouldIgnore(path)) {
            images.push({ path, entry });
          }
        });

        if (images.length === 0) {
          throw new Error('No valid images found in the CBZ archive.');
        }

        images.sort((a, b) => naturalCompare(a.path, b.path));

        if (active) {
          setPageEntries(images.map((i) => i.entry));
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
    };
  }, [fileData]);

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
          `[data-cbz-page="${target}"]`
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
          const el = viewport.querySelector<HTMLElement>(`[data-cbz-page="${target}"]`);
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

    const page = activeAnchor.pageNumber
      ? viewport.querySelector<HTMLElement>(`[data-cbz-page="${activeAnchor.pageNumber}"]`)
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
  }, [readerZoom, zoomAnchor, readingMode]);

  // Imperative handle
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

  // Preload neighboring pages for Paginated / Double page modes
  useEffect(() => {
    if (loading || totalPages === 0 || readingMode === 'scroll') return;

    const currentIdx = currentPage - 1;
    const preloadIndices = [
      currentIdx,
      currentIdx + 1,
      currentIdx + 2,
      currentIdx - 1,
      currentIdx - 2,
    ];

    preloadIndices.forEach((idx) => {
      if (idx >= 0 && idx < totalPages) {
        loadPageBlobUrl(idx);
      }
    });
  }, [currentPage, totalPages, readingMode, loading, loadPageBlobUrl]);

  // High-performance scroll tracking in vertical scroll mode
  const handleScroll = useCallback(() => {
    if (readingMode !== 'scroll' || loading || totalPages === 0) return;
    // Suppress scroll tracking while preview zoom is actively animating
    if (previewTransformRef.current !== null) return;

    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (previewTransformRef.current !== null) return;

      const viewport = viewportRef.current;
      const stack = pageStackRef.current;
      if (!viewport || !stack) return;

      const scrollTop = viewport.scrollTop;
      const children = stack.children;
      const count = children.length;
      if (count === 0) return;

      // Binary search for the active visible page (O(log N), 0 DOM queries, 0 forced reflows)
      const targetScroll = scrollTop + 48;
      let low = 0;
      let high = count - 1;
      let visibleIdx = 0;

      while (low <= high) {
        const mid = (low + high) >> 1;
        const el = children[mid] as HTMLElement;
        if (el && el.offsetTop + el.offsetHeight > targetScroll) {
          visibleIdx = mid;
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }

      const visiblePage = visibleIdx + 1;
      if (visiblePage !== currentPage) {
        setCurrentPage(visiblePage);
        notifyProgress(visibleIdx);
      }
    });
  }, [readingMode, loading, totalPages, currentPage, notifyProgress]);

  // Page turns for Single and Double page modes
  const handleNext = useCallback(() => {
    if (readingMode === 'vertical') {
      if (currentPage === 1) {
        goToPage(2, 'smooth');
      } else {
        goToPage(Math.min(totalPages, currentPage + 2), 'smooth');
      }
    } else {
      goToPage(Math.min(totalPages, currentPage + 1), 'smooth');
    }
  }, [readingMode, currentPage, totalPages, goToPage]);

  const handlePrev = useCallback(() => {
    if (readingMode === 'vertical') {
      if (currentPage <= 2) {
        goToPage(1, 'smooth');
      } else {
        goToPage(Math.max(1, currentPage - 2), 'smooth');
      }
    } else {
      goToPage(Math.max(1, currentPage - 1), 'smooth');
    }
  }, [readingMode, currentPage, goToPage]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (readingMode === 'scroll') {
        const viewport = viewportRef.current;
        if (!viewport) return;

        if (e.key === 'PageDown' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          const step = e.key === 'ArrowDown' ? 140 : Math.max(240, viewport.clientHeight * 0.88);
          viewport.scrollBy({ top: step, behavior: 'auto' });
        } else if (e.key === 'PageUp' || e.key === 'ArrowUp') {
          e.preventDefault();
          const step = e.key === 'ArrowUp' ? 140 : Math.max(240, viewport.clientHeight * 0.88);
          viewport.scrollBy({ top: -step, behavior: 'auto' });
        } else if (e.key === 'Home') {
          e.preventDefault();
          viewport.scrollTo({ top: 0, behavior: 'auto' });
        } else if (e.key === 'End') {
          e.preventDefault();
          viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' });
        }
        return;
      }

      const isRtl = readingDirection === 'rtl';

      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
          e.preventDefault();
          if (isRtl) handlePrev();
          else handleNext();
          break;
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          if (isRtl) handleNext();
          else handlePrev();
          break;
        case ' ':
          e.preventDefault();
          if (e.shiftKey) {
            if (isRtl) handleNext();
            else handlePrev();
          } else {
            if (isRtl) handlePrev();
            else handleNext();
          }
          break;
        case 'Home':
          e.preventDefault();
          goToPage(1, 'auto');
          break;
        case 'End':
          e.preventDefault();
          goToPage(totalPages, 'auto');
          break;
      }
    },
    [readingMode, readingDirection, handleNext, handlePrev, goToPage, totalPages]
  );

  // Handle stage click zones in paginated/spread modes
  const handleStageClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (previewTransformRef.current !== null) return;

      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const ratio = clickX / rect.width;

      const isRtl = readingDirection === 'rtl';

      if (ratio < 0.25) {
        if (isRtl) handleNext();
        else handlePrev();
      } else if (ratio > 0.75) {
        if (isRtl) handlePrev();
        else handleNext();
      } else {
        onToggleControls?.();
      }
    },
    [readingDirection, handleNext, handlePrev, onToggleControls]
  );

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner} />
        <p>Opening comic archive…</p>
      </div>
    );
  }

  if (error || totalPages === 0) {
    return (
      <div className={styles.loadingContainer}>
        <AlertCircle size={40} style={{ color: 'var(--color-danger)' }} />
        <p>{error || 'No readable comic pages found.'}</p>
      </div>
    );
  }

  // Active images for Single / Spread modes
  const currentIdx = currentPage - 1;
  const isCover = currentPage === 1;
  const isSpread = readingMode === 'vertical';

  let spreadFirstIdx = currentIdx;
  let spreadSecondIdx: number | null = null;

  if (isSpread) {
    if (isCover) {
      spreadFirstIdx = 0;
      spreadSecondIdx = null;
    } else {
      spreadFirstIdx = currentIdx % 2 === 1 ? currentIdx : currentIdx - 1;
      spreadSecondIdx = spreadFirstIdx + 1 < totalPages ? spreadFirstIdx + 1 : null;
    }
  }

  return (
    <div
      ref={containerRef}
      className={styles.container}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label="Comic Book Reader"
    >
      {/* 1. Continuous Vertical Scroll (Webtoon) Mode */}
      {readingMode === 'scroll' ? (
        <div
          ref={viewportRef}
          className={styles.viewport}
          data-reader-viewport="cbz-vertical-scroll"
          data-current-page={currentPage}
          onScroll={handleScroll}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              onToggleControls?.();
            }
          }}
        >
          <div
            ref={pageStackRef}
            className={styles.pageStack}
            style={{ gap: `${pageGap}px` }}
          >
            {pageEntries.map((_, idx) => (
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
          className={styles.pagedStage}
          data-reader-viewport="cbz-page"
          onClick={handleStageClick}
        >
          <div
            ref={pagedContentRef}
            className={styles.pagedContent}
          >
            {isSpread ? (
              <div
                className={styles.spreadWrapper}
                style={{
                  flexDirection: readingDirection === 'rtl' ? 'row-reverse' : 'row',
                  gap: `${Math.max(12, Math.round(pageGap * 0.75))}px`,
                }}
              >
                <SpreadPageImage
                  pageIndex={spreadFirstIdx}
                  loadUrl={loadPageBlobUrl}
                  readerZoom={readerZoom}
                />
                {spreadSecondIdx !== null && (
                  <SpreadPageImage
                    pageIndex={spreadSecondIdx}
                    loadUrl={loadPageBlobUrl}
                    readerZoom={readerZoom}
                  />
                )}
              </div>
            ) : (
              <div className={styles.singleWrapper}>
                <SinglePageImage
                  pageIndex={currentIdx}
                  loadUrl={loadPageBlobUrl}
                  readerZoom={readerZoom}
                  fitMode={fitMode}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

function SinglePageImage({
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
    loadUrl(pageIndex).then((url) => {
      if (active && url) setSrc(url);
    });
    return () => {
      active = false;
    };
  }, [pageIndex, loadUrl]);

  if (!src) {
    return (
      <div className={styles.pagePlaceholder} style={{ minHeight: 480, width: 360 }}>
        <div className={styles.spinner} />
        <span>Loading Page {pageIndex + 1}…</span>
      </div>
    );
  }

  let style: React.CSSProperties = {};
  if (fitMode === 'width') {
    style = {
      width: `${Math.round(window.innerWidth * 0.9 * readerZoom)}px`,
      maxWidth: readerZoom <= 1 ? 'calc(100vw - 48px)' : 'none',
      height: 'auto',
    };
  } else if (fitMode === 'height') {
    style = {
      height: `${Math.round((window.innerHeight - 100) * readerZoom)}px`,
      width: 'auto',
      maxHeight: 'none',
    };
  } else {
    // contain
    style = {
      maxHeight: `${Math.round((window.innerHeight - 100) * readerZoom)}px`,
      maxWidth: readerZoom <= 1 ? 'calc(100vw - 48px)' : `${Math.round((window.innerWidth - 48) * readerZoom)}px`,
      width: 'auto',
      height: 'auto',
      objectFit: 'contain',
    };
  }

  return (
    <img
      src={src}
      alt={`Page ${pageIndex + 1}`}
      className={styles.comicImage}
      style={style}
    />
  );
}

function SpreadPageImage({
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
