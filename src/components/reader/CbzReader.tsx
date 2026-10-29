/**
 * CBZ Comic Reader for WebXReader.
 *
 * Provides high-performance, responsive comic reading supporting:
 * 1. Webtoon / continuous vertical scroll mode with stable layout and zero page overlap
 * 2. Single-page paginated mode with keyboard and click-zone navigation
 * 3. Double-page spread mode with Manga (RTL) reading support
 * 4. Lazy blob URL decoding and automatic memory management
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import JSZip from 'jszip';
import { AlertCircle } from 'lucide-react';
import { naturalCompare } from '../../core/parsing/cbz-parser';
import type { ComicReadingDirection, ComicFitMode } from '../../types/book';
import styles from './CbzReader.module.css';

export interface CbzReaderHandle {
  goToPage: (pageNum: number) => void;
  goToProgress: (fraction: number) => void;
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
 * Once an image loads, it remains mounted so the layout never collapses or flickers.
 */
function CbzScrollPageShell({
  pageIndex,
  total,
  loadUrl,
  containerRef,
  readerZoom,
  fitMode,
}: {
  pageIndex: number;
  total: number;
  loadUrl: (idx: number) => Promise<string | undefined>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  readerZoom: number;
  fitMode: ComicFitMode;
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
      { root, rootMargin: '1200px 0px' }
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
    widthStyle = '100%';
    maxWidthStyle = `${Math.min(100, Math.round(100 * readerZoom))}%`;
  } else if (fitMode === 'height') {
    maxHeightStyle = 'calc(100vh - 120px)';
    widthStyle = 'auto';
  } else {
    // contain
    maxWidthStyle = `min(100%, ${Math.round(850 * readerZoom)}px)`;
    maxHeightStyle = 'calc(100vh - 120px)';
  }

  return (
    <div
      ref={shellRef}
      className={styles.pageShell}
      data-cbz-page={pageIndex + 1}
      style={{
        width: widthStyle,
        maxWidth: maxWidthStyle,
        maxHeight: maxHeightStyle,
        aspectRatio: aspectRatio ? String(aspectRatio) : undefined,
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
              setAspectRatio(naturalWidth / naturalHeight);
            }
          }}
        />
      ) : (
        <div className={styles.pagePlaceholder} style={{ minHeight: 480 }}>
          <div className={styles.spinner} style={{ width: 24, height: 24 }} />
          <span>Page {pageIndex + 1} of {total}</span>
        </div>
      )}
    </div>
  );
}

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
  },
  ref
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageEntries, setPageEntries] = useState<JSZip.JSZipObject[]>([]);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage));

  const viewportRef = useRef<HTMLDivElement>(null);
  const pageStackRef = useRef<HTMLDivElement>(null);
  const blobUrlsRef = useRef<Map<number, string>>(new Map());
  const onProgressUpdateRef = useRef(onProgressUpdate);
  const scrollFrameRef = useRef<number | null>(null);
  onProgressUpdateRef.current = onProgressUpdate;

  const totalPages = pageEntries.length;

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

  const goToPage = useCallback(
    (pageNum: number) => {
      if (totalPages === 0) return;
      const target = Math.max(1, Math.min(pageNum, totalPages));
      setCurrentPage(target);
      notifyProgress(target - 1);

      if (readingMode === 'scroll' && viewportRef.current) {
        const el = viewportRef.current.querySelector<HTMLElement>(
          `[data-cbz-page="${target}"]`
        );
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    },
    [totalPages, readingMode, notifyProgress]
  );

  const goToProgress = useCallback(
    (fraction: number) => {
      if (totalPages === 0) return;
      const targetPage = Math.round(fraction * (totalPages - 1)) + 1;
      goToPage(targetPage);
    },
    [totalPages, goToPage]
  );

  // Imperative handle
  useImperativeHandle(
    ref,
    () => ({
      goToPage,
      goToProgress,
      getCurrentPage: () => currentPage,
      getTotalPages: () => totalPages,
    }),
    [goToPage, goToProgress, currentPage, totalPages]
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

  // Track scroll position in vertical scroll mode
  const handleScroll = useCallback(() => {
    if (readingMode !== 'scroll' || loading || totalPages === 0) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;

      const viewportTop = viewport.getBoundingClientRect().top + 32;
      const pages = Array.from(viewport.querySelectorAll<HTMLElement>('[data-cbz-page]'));
      let visiblePage = currentPage;

      for (const page of pages) {
        if (page.getBoundingClientRect().bottom > viewportTop) {
          visiblePage = Number(page.dataset.cbzPage) || visiblePage;
          break;
        }
      }

      if (visiblePage !== currentPage) {
        setCurrentPage(visiblePage);
        notifyProgress(visiblePage - 1);
      }
    });
  }, [readingMode, loading, totalPages, currentPage, notifyProgress]);

  // Page turns for Single and Double page modes
  const handleNext = useCallback(() => {
    if (readingMode === 'vertical') {
      if (currentPage === 1) {
        goToPage(2);
      } else {
        goToPage(Math.min(totalPages, currentPage + 2));
      }
    } else {
      goToPage(Math.min(totalPages, currentPage + 1));
    }
  }, [readingMode, currentPage, totalPages, goToPage]);

  const handlePrev = useCallback(() => {
    if (readingMode === 'vertical') {
      if (currentPage <= 2) {
        goToPage(1);
      } else {
        goToPage(Math.max(1, currentPage - 2));
      }
    } else {
      goToPage(Math.max(1, currentPage - 1));
    }
  }, [readingMode, currentPage, goToPage]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (readingMode === 'scroll') {
        if (e.key === 'Home') {
          e.preventDefault();
          goToPage(1);
        } else if (e.key === 'End') {
          e.preventDefault();
          goToPage(totalPages);
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
          goToPage(1);
          break;
        case 'End':
          e.preventDefault();
          goToPage(totalPages);
          break;
      }
    },
    [readingMode, readingDirection, handleNext, handlePrev, goToPage, totalPages]
  );

  // Handle stage click zones in paginated/spread modes
  const handleStageClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const ratio = clickX / rect.width;

      const isRtl = readingDirection === 'rtl';

      if (ratio < 0.25) {
        // Left zone
        if (isRtl) handleNext();
        else handlePrev();
      } else if (ratio > 0.75) {
        // Right zone
        if (isRtl) handlePrev();
        else handleNext();
      } else {
        // Center zone: toggle controls
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

  const fitClass =
    fitMode === 'width' ? styles.fitWidth : fitMode === 'height' ? styles.fitHeight : styles.fitContain;

  return (
    <div
      ref={viewportRef}
      className={styles.container}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label="Comic Book Reader"
    >
      {/* 1. Continuous Vertical Scroll (Webtoon) Mode */}
      {readingMode === 'scroll' ? (
        <div
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
              />
            ))}
          </div>
        </div>
      ) : (
        /* 2. Paginated (Single / Spread) Mode */
        <div
          className={styles.pagedStage}
          data-reader-viewport="cbz-page"
          onClick={handleStageClick}
        >
          <div
            className={styles.pagedContent}
            style={{
              transform: readerZoom !== 1.0 ? `scale(${readerZoom})` : undefined,
            }}
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
                />
                {spreadSecondIdx !== null && (
                  <SpreadPageImage
                    pageIndex={spreadSecondIdx}
                    loadUrl={loadPageBlobUrl}
                  />
                )}
              </div>
            ) : (
              <div className={styles.singleWrapper}>
                <SinglePageImage
                  pageIndex={currentIdx}
                  loadUrl={loadPageBlobUrl}
                  fitClass={fitClass}
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
  fitClass,
}: {
  pageIndex: number;
  loadUrl: (idx: number) => Promise<string | undefined>;
  fitClass: string;
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
      <div className={styles.pagePlaceholder}>
        <div className={styles.spinner} />
        <span>Loading Page {pageIndex + 1}…</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`Page ${pageIndex + 1}`}
      className={`${styles.comicImage} ${fitClass}`}
    />
  );
}

function SpreadPageImage({
  pageIndex,
  loadUrl,
}: {
  pageIndex: number;
  loadUrl: (idx: number) => Promise<string | undefined>;
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

  return (
    <img
      src={src}
      alt={`Page ${pageIndex + 1}`}
      className={styles.spreadImage}
    />
  );
}
