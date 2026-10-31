/**
 * Fixed-layout DjVu reader powered by djvu-rs WebAssembly.
 *
 * Supports continuous vertical scrolling and paginated modes,
 * zooming with viewport anchors, high-DPI canvas rendering,
 * and text-layer search across document pages.
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



function getDjvuDisplayScale(
  baseWidth: number,
  viewportWidth: number,
  readerZoom: number
) {
  const availableWidth = Math.max(240, viewportWidth - 32);
  const fitScale = availableWidth / baseWidth;
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
  onPageSize: (pageNumber: number, size: PageSize) => void;
}

function DjvuPageView({
  doc,
  pageNumber,
  viewportRef,
  pageSize,
  readerZoom,
  layoutVersion,
  initiallyVisible,
  onPageSize,
}: DjvuPageViewProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isVisible, setIsVisible] = useState(initiallyVisible);
  const [isRendered, setIsRendered] = useState(false);

  // Measure initial page size from document if not cached
  useEffect(() => {
    if (!pageSize) {
      try {
        const page = doc.page(pageNumber - 1);
        const nativeDpi = page.dpi() || 100;
        const width = page.width_at(nativeDpi);
        const height = page.height_at(nativeDpi);
        onPageSize(pageNumber, { width, height, dpi: nativeDpi });
      } catch (err) {
        console.warn(`Could not measure DjVu page ${pageNumber}:`, err);
      }
    }
  }, [doc, pageNumber, pageSize, onPageSize]);

  // Viewport intersection observer to lazy-render pages
  useEffect(() => {
    const el = shellRef.current;
    const root = viewportRef.current;
    if (!el || !root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setIsVisible(true);
        } else {
          setIsVisible(false);
        }
      },
      { root, rootMargin: '600px 0px 600px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [viewportRef]);

  // Render page when visible
  useEffect(() => {
    if (!isVisible || !pageSize) return;

    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const viewportWidth = viewportRef.current?.clientWidth || window.innerWidth;
    const displayScale = getDjvuDisplayScale(pageSize.width, viewportWidth, readerZoom);
    const pixelRatio = window.devicePixelRatio || 1;
    const renderDpi = Math.max(30, Math.round(pageSize.dpi * displayScale * pixelRatio));

    try {
      const page = doc.page(pageNumber - 1);
      const pixels = page.render(renderDpi);
      const renderW = page.width_at(renderDpi);
      const renderH = page.height_at(renderDpi);

      if (cancelled) return;

      canvas.width = renderW;
      canvas.height = renderH;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imgData = new ImageData(pixels as any, renderW, renderH);
        ctx.putImageData(imgData, 0, 0);
        setIsRendered(true);
      }
    } catch (err) {
      console.warn(`Failed to render DjVu page ${pageNumber}:`, err);
    }

    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, pageSize, isVisible, readerZoom, viewportRef, layoutVersion]);

  const viewportWidth = viewportRef.current?.clientWidth || window.innerWidth;
  const baseWidth = pageSize?.width || 800;
  const baseHeight = pageSize?.height || 1100;
  const displayScale = getDjvuDisplayScale(baseWidth, viewportWidth, readerZoom);
  const displayWidth = Math.round(baseWidth * displayScale);
  const displayHeight = Math.round(baseHeight * displayScale);

  return (
    <div
      ref={shellRef}
      className={styles.pageShell}
      style={{
        width: `${displayWidth}px`,
        height: `${displayHeight}px`,
      }}
      data-page-number={pageNumber}
    >
      <canvas
        ref={canvasRef}
        className={styles.djvuCanvas}
        style={{
          width: `${displayWidth}px`,
          height: `${displayHeight}px`,
        }}
      />
      {!isRendered && <div className={styles.pagePlaceholder} />}
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
    zoomAnchor: _zoomAnchor,
  },
  ref
) {
  const [doc, setDoc] = useState<WasmDocument | null>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [pageSizes, setPageSizes] = useState<Map<number, PageSize>>(new Map());
  const [layoutVersion, setLayoutVersion] = useState(0);

  const viewportRef = useRef<HTMLDivElement>(null);
  const isNavigatingRef = useRef(false);
  const textCacheRef = useRef<Map<number, string>>(new Map());

  // Initialize document
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        await ensureDjvuInitialized();
        if (cancelled) return;

        const bytes = new Uint8Array(fileData);
        const parsedDoc = WasmDocument.from_bytes(bytes);
        if (cancelled) return;

        setDoc(parsedDoc);
        setTotalPages(parsedDoc.page_count());
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileData]);

  const handlePageSize = useCallback((pageNumber: number, size: PageSize) => {
    setPageSizes((prev) => {
      if (prev.has(pageNumber)) return prev;
      const next = new Map(prev);
      next.set(pageNumber, size);
      return next;
    });
  }, []);

  // Window resize layout version bump
  useEffect(() => {
    const handleResize = () => setLayoutVersion((v) => v + 1);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Update progress on scroll
  const handleScroll = useCallback(() => {
    if (isNavigatingRef.current || !viewportRef.current || totalPages <= 0) return;

    const viewport = viewportRef.current;
    const scrollTop = viewport.scrollTop;
    const pageShells = viewport.querySelectorAll<HTMLElement>('[data-page-number]');

    let activePage = 1;
    let minDistance = Infinity;

    pageShells.forEach((shell) => {
      const pageNum = parseInt(shell.getAttribute('data-page-number') || '1', 10);
      const offsetTop = shell.offsetTop;
      const distance = Math.abs(offsetTop - scrollTop);
      if (distance < minDistance) {
        minDistance = distance;
        activePage = pageNum;
      }
    });

    setCurrentPage(activePage);
    const progressFraction = (activePage - 1) / Math.max(1, totalPages - 1);
    onProgressUpdate(`page-${activePage}`, progressFraction, activePage - 1);
  }, [totalPages, onProgressUpdate]);

  // Scroll to initial page on load
  useLayoutEffect(() => {
    if (!loading && totalPages > 0 && initialPage > 1 && viewportRef.current) {
      const target = viewportRef.current.querySelector(`[data-page-number="${initialPage}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    }
  }, [loading, totalPages, initialPage]);

  // Imperative handle
  useImperativeHandle(
    ref,
    () => ({
      goToPage: (pageNum: number) => {
        const clamped = Math.min(totalPages, Math.max(1, pageNum));
        setCurrentPage(clamped);

        if (readingMode === 'paginated') {
          const progressFraction = (clamped - 1) / Math.max(1, totalPages - 1);
          onProgressUpdate(`page-${clamped}`, progressFraction, clamped - 1);
        } else if (viewportRef.current) {
          isNavigatingRef.current = true;
          const target = viewportRef.current.querySelector(`[data-page-number="${clamped}"]`);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          const progressFraction = (clamped - 1) / Math.max(1, totalPages - 1);
          onProgressUpdate(`page-${clamped}`, progressFraction, clamped - 1);
          setTimeout(() => {
            isNavigatingRef.current = false;
          }, 400);
        }
      },
      goToProgress: (fraction: number) => {
        const targetPage = Math.min(totalPages, Math.max(1, Math.round(fraction * (totalPages - 1)) + 1));
        const clamped = targetPage;
        setCurrentPage(clamped);

        if (viewportRef.current) {
          isNavigatingRef.current = true;
          const target = viewportRef.current.querySelector(`[data-page-number="${clamped}"]`);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          onProgressUpdate(`page-${clamped}`, fraction, clamped - 1);
          setTimeout(() => {
            isNavigatingRef.current = false;
          }, 400);
        }
      },
      previewZoom: (_zoom: number, _anchor: DjvuZoomAnchor) => {
        setLayoutVersion((v) => v + 1);
      },
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
        }

        return results;
      },
      goToSearchMatch: async (pageNumber: number) => {
        if (viewportRef.current) {
          const target = viewportRef.current.querySelector(`[data-page-number="${pageNumber}"]`);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      },
    }),
    [doc, totalPages, readingMode, onProgressUpdate]
  );

  // Keyboard navigation for paginated mode
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (readingMode !== 'paginated') return;

    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault();
      if (currentPage < totalPages) {
        const next = currentPage + 1;
        setCurrentPage(next);
        const progressFraction = (next - 1) / Math.max(1, totalPages - 1);
        onProgressUpdate(`page-${next}`, progressFraction, next - 1);
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      if (currentPage > 1) {
        const prev = currentPage - 1;
        setCurrentPage(prev);
        const progressFraction = (prev - 1) / Math.max(1, totalPages - 1);
        onProgressUpdate(`page-${prev}`, progressFraction, prev - 1);
      }
    }
  };

  if (loading) {
    return (
      <div className={styles.loadingOverlay}>
        <div className={styles.spinner} />
        <p>Loading DjVu document…</p>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className={styles.errorOverlay}>
        <AlertCircle size={36} color="var(--color-danger)" />
        <p className={styles.errorText}>{error || 'Failed to open DjVu document.'}</p>
      </div>
    );
  }

  const pageNumbers = readingMode === 'paginated'
    ? [currentPage]
    : Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <div
      className={styles.container}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={onToggleControls}
    >
      <div
        ref={viewportRef}
        className={styles.viewport}
        onScroll={handleScroll}
      >
        <div className={styles.pageStack}>
          {pageNumbers.map((num) => (
            <DjvuPageView
              key={num}
              doc={doc}
              pageNumber={num}
              viewportRef={viewportRef}
              pageSize={pageSizes.get(num)}
              readerZoom={readerZoom}
              layoutVersion={layoutVersion}
              initiallyVisible={num <= 3}
              onPageSize={handlePageSize}
            />
          ))}
        </div>
      </div>
    </div>
  );
});
