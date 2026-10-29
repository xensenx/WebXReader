/**
 * CBZ Comic Reader for WebXReader.
 *
 * Provides high-performance, responsive comic reading supporting:
 * 1. Webtoon / continuous vertical scroll mode
 * 2. Single-page paginated mode
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
import {
  ArrowLeftRight,
  Maximize2,
  AlertCircle,
} from 'lucide-react';
import { naturalCompare } from '../../core/parsing/cbz-parser';
import type { ComicReadingDirection, ComicFitMode } from '../../types/book';
import styles from './CbzReader.module.css';

export interface CbzReaderHandle {
  goToPage: (pageNum: number) => void;
  goToProgress: (fraction: number) => void;
  toggleReadingDirection: () => void;
  setFitMode: (mode: ComicFitMode) => void;
  getCurrentPage: () => number;
  getTotalPages: () => number;
}

interface CbzReaderProps {
  fileData: ArrayBuffer;
  initialPage?: number;
  readingMode?: 'scroll' | 'paginated' | 'vertical';
  readingDirection?: ComicReadingDirection;
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
 * Single page item inside vertical scroll mode with lazy-load observer.
 */
function CbzScrollPageItem({
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
  const itemRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [imgSrc, setImgSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    const el = itemRef.current;
    const root = containerRef.current;
    if (!el || !root) return;

    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          setIsVisible(true);
        } else {
          // Offload offscreen images if distance is large
          setIsVisible(false);
        }
      },
      { root, rootMargin: '1000px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef]);

  useEffect(() => {
    if (!isVisible) {
      setImgSrc(undefined);
      return;
    }

    let active = true;
    loadUrl(pageIndex).then((url) => {
      if (active && url) {
        setImgSrc(url);
      }
    });

    return () => {
      active = false;
    };
  }, [isVisible, pageIndex, loadUrl]);

  const fitClass =
    fitMode === 'width' ? styles.fitWidth : fitMode === 'height' ? styles.fitHeight : styles.fitContain;

  return (
    <div
      ref={itemRef}
      className={styles.scrollPageItem}
      data-page-index={pageIndex}
      style={{
        width: fitMode === 'width' ? `${Math.min(100, 100 * readerZoom)}%` : undefined,
      }}
    >
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={`Page ${pageIndex + 1}`}
          className={`${styles.scrollImage} ${fitClass}`}
          style={{
            maxWidth: fitMode === 'width' ? '100%' : `${Math.round(100 * readerZoom)}%`,
          }}
          loading="lazy"
        />
      ) : (
        <div className={styles.pagePlaceholder}>
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
    readingDirection: initialReadingDirection = 'ltr',
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
  const [direction, setDirection] = useState<ComicReadingDirection>(initialReadingDirection);
  const [fitMode, setFitMode] = useState<ComicFitMode>('contain');

  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const blobUrlsRef = useRef<Map<number, string>>(new Map());
  const onProgressUpdateRef = useRef(onProgressUpdate);
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

      if (readingMode === 'scroll' && scrollContainerRef.current) {
        const el = scrollContainerRef.current.querySelector<HTMLElement>(
          `[data-page-index="${target - 1}"]`
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
      toggleReadingDirection: () => {
        setDirection((prev) => (prev === 'ltr' ? 'rtl' : 'ltr'));
      },
      setFitMode: (mode) => setFitMode(mode),
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

    // Prune distant cached URLs (> 8 pages away) to keep memory bounded
    const urls = blobUrlsRef.current;
    if (urls.size > 20) {
      for (const [idx, url] of urls.entries()) {
        if (Math.abs(idx - currentIdx) > 8) {
          try {
            URL.revokeObjectURL(url);
          } catch {
            // ignore
          }
          urls.delete(idx);
        }
      }
    }
  }, [currentPage, totalPages, readingMode, loading, loadPageBlobUrl]);

  // Observer for Scroll Mode to update current page and progress as user scrolls
  useEffect(() => {
    if (readingMode !== 'scroll' || loading || totalPages === 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    let timeoutId: number | null = null;
    const handleScroll = () => {
      if (timeoutId !== null) cancelAnimationFrame(timeoutId);
      timeoutId = requestAnimationFrame(() => {
        const items = container.querySelectorAll<HTMLElement>('[data-page-index]');
        const containerTop = container.getBoundingClientRect().top;
        let closestIndex = 0;
        let minDistance = Infinity;

        items.forEach((item) => {
          const rect = item.getBoundingClientRect();
          const distance = Math.abs(rect.top - containerTop);
          if (distance < minDistance) {
            minDistance = distance;
            const idx = parseInt(item.getAttribute('data-page-index') || '0', 10);
            closestIndex = idx;
          }
        });

        const newPage = closestIndex + 1;
        setCurrentPage((prev) => {
          if (prev !== newPage) {
            notifyProgress(closestIndex);
            return newPage;
          }
          return prev;
        });
      });
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (timeoutId !== null) cancelAnimationFrame(timeoutId);
    };
  }, [readingMode, loading, totalPages, notifyProgress]);

  // Page turns for Single and Double page modes
  const handleNext = useCallback(() => {
    if (readingMode === 'vertical') {
      // Spread mode
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
      if (readingMode === 'scroll') return;

      const isRtl = direction === 'rtl';

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
    [readingMode, direction, handleNext, handlePrev, goToPage, totalPages]
  );

  // Handle stage click zones in paginated/spread modes
  const handleStageClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const ratio = clickX / rect.width;

      const isRtl = direction === 'rtl';

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
    [direction, handleNext, handlePrev, onToggleControls]
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

  // Determine pages on spread
  let spreadFirstIdx = currentIdx;
  let spreadSecondIdx: number | null = null;

  if (isSpread) {
    if (isCover) {
      spreadFirstIdx = 0;
      spreadSecondIdx = null;
    } else {
      // Ensure even pair: 1 & 2 (indices for pages 2 & 3), 3 & 4 (pages 4 & 5)
      spreadFirstIdx = currentIdx % 2 === 1 ? currentIdx : currentIdx - 1;
      spreadSecondIdx = spreadFirstIdx + 1 < totalPages ? spreadFirstIdx + 1 : null;
    }
  }

  const fitClass =
    fitMode === 'width' ? styles.fitWidth : fitMode === 'height' ? styles.fitHeight : styles.fitContain;

  return (
    <div
      ref={viewportRef}
      className={styles.viewport}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label="Comic Book Reader"
    >
      {/* 1. Vertical Scroll (Webtoon) Mode */}
      {readingMode === 'scroll' && (
        <div
          ref={scrollContainerRef}
          className={styles.scrollContainer}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              onToggleControls?.();
            }
          }}
        >
          {pageEntries.map((_, idx) => (
            <CbzScrollPageItem
              key={idx}
              pageIndex={idx}
              total={totalPages}
              loadUrl={loadPageBlobUrl}
              containerRef={scrollContainerRef}
              readerZoom={readerZoom}
              fitMode={fitMode}
            />
          ))}
        </div>
      )}

      {/* 2. Paginated (Single / Spread) Mode */}
      {readingMode !== 'scroll' && (
        <div className={styles.pagedStage} onClick={handleStageClick}>
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
                  flexDirection: direction === 'rtl' ? 'row-reverse' : 'row',
                }}
              >
                {/* Left (or Right if RTL) page */}
                <SpreadPageImage
                  pageIndex={spreadFirstIdx}
                  loadUrl={loadPageBlobUrl}
                />
                {/* Second page if present */}
                {spreadSecondIdx !== null && (
                  <SpreadPageImage
                    pageIndex={spreadSecondIdx}
                    loadUrl={loadPageBlobUrl}
                  />
                )}
              </div>
            ) : (
              <div className={styles.singlePageWrapper}>
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

      {/* Floating Quick Comic Toolbar */}
      <div className={styles.floatingBar}>
        <button
          type="button"
          className={`${styles.barButton} ${direction === 'rtl' ? styles.barButtonActive : ''}`}
          onClick={() => setDirection((d) => (d === 'ltr' ? 'rtl' : 'ltr'))}
          title={direction === 'rtl' ? 'Manga Mode (RTL) Active - Click for Western (LTR)' : 'Western Mode (LTR) - Click for Manga (RTL)'}
        >
          <ArrowLeftRight size={14} />
          <span>{direction === 'rtl' ? 'Manga (RTL)' : 'LTR'}</span>
        </button>

        <div className={styles.barDivider} />

        <button
          type="button"
          className={`${styles.barButton} ${fitMode === 'contain' ? styles.barButtonActive : ''}`}
          onClick={() => setFitMode('contain')}
          title="Fit to Screen"
        >
          <Maximize2 size={14} />
          <span>Fit Screen</span>
        </button>

        <button
          type="button"
          className={`${styles.barButton} ${fitMode === 'width' ? styles.barButtonActive : ''}`}
          onClick={() => setFitMode('width')}
          title="Fit to Width"
        >
          <span>Fit Width</span>
        </button>

        <div className={styles.barDivider} />

        <span className={styles.pagePill}>
          {isSpread && spreadSecondIdx !== null
            ? `Pages ${spreadFirstIdx + 1}–${spreadSecondIdx + 1} / ${totalPages}`
            : `Page ${currentPage} / ${totalPages}`}
        </span>
      </div>
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
      <div className={styles.pagePlaceholder} style={{ minHeight: 360, width: 300 }}>
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
