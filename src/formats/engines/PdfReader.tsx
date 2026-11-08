/**
 * Fixed-layout PDF reader powered by pdfjs-dist.
 *
 * Supports continuous vertical scrolling, continuous horizontal ribbon scrolling,
 * single-page pagination, and double-sided facing spreads with interactive 2D zoom/pan.
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
import { AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { pdfjsLib } from '../../core/parsing/pdf-init';
import { createTextExcerpt, findTextMatches, findTextRange } from '../../utils/text-search';
import { showTransientSearchHighlight } from '../../utils/transient-search-highlight';
import type { ReaderSearchResult } from '../../components/reader/search-types';
import type { ReadingMode } from '../../types/book';
import { PdfPageView, type PdfDocument, type PageSize } from './PdfPageView';
import { PdfDoubleSidedReader } from './PdfDoubleSidedReader';
import styles from './PdfReader.module.css';

export interface PdfReaderHandle {
  goToPage: (pageNum: number) => void;
  goToProgress: (fraction: number) => void;
  previewZoom: (zoom: number, anchor: PdfZoomAnchor) => void;
  search: (query: string) => Promise<ReaderSearchResult[]>;
  goToSearchMatch: (pageNumber: number, query: string, matchIndex: number) => Promise<void>;
}

export interface PdfZoomAnchor {
  id: number;
  pageNumber?: number;
  pageX?: number;
  pageY?: number;
  viewportX: number;
  viewportY: number;
  scrollRatioX: number;
  scrollRatioY: number;
}

export interface PdfReaderProps {
  fileData: ArrayBuffer;
  initialPage?: number;
  readingMode?: ReadingMode;
  onProgressUpdate: (chapterId: string, progressFraction: number, pageIndex: number) => void;
  onToggleControls?: () => void;
  readerZoom?: number;
  zoomAnchor?: PdfZoomAnchor;
  onZoomGesture?: (deltaY: number, point?: { x: number; y: number }) => void;
}

interface PdfSearchPage {
  pageNumber: number;
  text: string;
}

interface PdfZoomPreviewTransform {
  baseLeft: number;
  baseTop: number;
  scale: number;
  translateX: number;
  translateY: number;
}

export const PdfReader = forwardRef<PdfReaderHandle, PdfReaderProps>(function PdfReader(
  {
    fileData,
    initialPage = 1,
    readingMode = 'scroll',
    onProgressUpdate,
    onToggleControls,
    readerZoom = 1,
    zoomAnchor,
    onZoomGesture,
  },
  ref
) {
  const isDoubleSided = readingMode === 'vertical';
  const isHorizontal = readingMode === 'horizontal';
  const isPaginated = readingMode === 'paginated';

  const [pdfDoc, setPdfDoc] = useState<PdfDocument | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(Math.max(1, initialPage));
  const [totalPages, setTotalPages] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pageSizes, setPageSizes] = useState<Record<number, PageSize>>({});
  const [pageLayoutReady, setPageLayoutReady] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [isPanning, setIsPanning] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const pageStackRef = useRef<HTMLDivElement>(null);
  const previewTransformRef = useRef<PdfZoomPreviewTransform | null>(null);
  const lastZoomAnchorRef = useRef<PdfZoomAnchor | undefined>(undefined);
  const initialPageRef = useRef(initialPage);
  const onProgressUpdateRef = useRef(onProgressUpdate);
  const scrollFrameRef = useRef<number | null>(null);
  const previousReaderZoomRef = useRef(readerZoom);
  const searchIndexRef = useRef<{ document: PdfDocument; promise: Promise<PdfSearchPage[]> } | null>(null);
  const doubleSidedRef = useRef<PdfReaderHandle>(null);

  const isMouseDownRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number }>({
    x: 0,
    y: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });
  const hasDraggedRef = useRef(false);

  onProgressUpdateRef.current = onProgressUpdate;

  useEffect(() => {
    initialPageRef.current = initialPage;
  }, [initialPage]);

  const setPageSize = useCallback((pageNumber: number, size: PageSize) => {
    setPageSizes((previous) => {
      const current = previous[pageNumber];
      if (current && current.width === size.width && current.height === size.height) return previous;
      return { ...previous, [pageNumber]: size };
    });
  }, []);

  const scrollToPage = useCallback(
    (pageNumber: number, behavior: ScrollBehavior = 'smooth') => {
      const viewport = viewportRef.current;
      const page = pageStackRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${pageNumber}"]`);
      if (!viewport || !page) return;

      if (isHorizontal) {
        viewport.scrollTo({ left: Math.max(0, page.offsetLeft - 24), behavior });
      } else if (isPaginated) {
        viewport.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      } else {
        viewport.scrollTo({ top: Math.max(0, page.offsetTop - 16), behavior });
      }
    },
    [isHorizontal, isPaginated]
  );

  const previewZoom = useCallback(
    (nextZoom: number, anchor: PdfZoomAnchor) => {
      if (isDoubleSided && doubleSidedRef.current) {
        doubleSidedRef.current.previewZoom(nextZoom, anchor);
        return;
      }

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
    [readerZoom, isDoubleSided]
  );

  const goToPage = useCallback(
    (pageNum: number, behavior: ScrollBehavior = 'smooth') => {
      const clamped = Math.max(1, Math.min(pageNum, totalPages));
      setCurrentPage(clamped);
      if (isDoubleSided && doubleSidedRef.current) {
        doubleSidedRef.current.goToPage(clamped);
      } else {
        requestAnimationFrame(() => scrollToPage(clamped, behavior));
      }
    },
    [scrollToPage, totalPages, isDoubleSided]
  );

  const searchPdf = useCallback(
    async (query: string): Promise<ReaderSearchResult[]> => {
      const normalizedQuery = query.trim();
      if (!pdfDoc || normalizedQuery.length < 2) return [];

      if (searchIndexRef.current?.document !== pdfDoc) {
        const document = pdfDoc;
        const promise = (async () => {
          const pages: PdfSearchPage[] = [];
          const batchSize = 6;
          for (let start = 1; start <= document.numPages; start += batchSize) {
            const batch = await Promise.all(
              Array.from(
                { length: Math.min(batchSize, document.numPages - start + 1) },
                async (_, offset) => {
                  const pageNumber = start + offset;
                  try {
                    const page = await document.getPage(pageNumber);
                    const content = await page.getTextContent();
                    let text = '';
                    for (const item of content.items) {
                      if (!('str' in item)) continue;
                      if (text && !/\s$/.test(text) && item.str && !/^\s/.test(item.str)) text += ' ';
                      text += item.str;
                      if (item.hasEOL && !text.endsWith('\n')) text += '\n';
                    }
                    return { pageNumber, text };
                  } catch {
                    return { pageNumber, text: '' };
                  }
                }
              )
            );
            pages.push(...batch);
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          }
          return pages;
        })();
        searchIndexRef.current = { document: pdfDoc, promise };
      }

      const pages = await searchIndexRef.current.promise;
      const results: ReaderSearchResult[] = [];
      for (const page of pages) {
        const matches = findTextMatches(page.text, normalizedQuery, 100 - results.length, true);
        matches.forEach((match, matchIndex) => {
          results.push({
            chapterId: String(page.pageNumber),
            chapterTitle: `Page ${page.pageNumber}`,
            ...createTextExcerpt(page.text, match),
            offset: match.start,
            matchIndex,
            pageNumber: page.pageNumber,
          });
        });
        if (results.length >= 100) break;
      }
      return results;
    },
    [pdfDoc]
  );

  const goToSearchMatch = useCallback(
    async (pageNumber: number, query: string, matchIndex: number) => {
      goToPage(pageNumber, 'auto');
      const viewport = viewportRef.current;
      if (!viewport) return;

      for (let attempt = 0; attempt < 120; attempt++) {
        const page = pageStackRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${pageNumber}"]`);
        const textLayer = page?.querySelector<HTMLElement>(`.${styles.textLayer}`);
        if (textLayer?.textContent?.trim()) {
          const range = findTextRange(textLayer, query, matchIndex, true);
          if (range) {
            showTransientSearchHighlight(range);
            const rect = range.getBoundingClientRect();
            const viewportRect = viewport.getBoundingClientRect();
            viewport.scrollTo({
              top: viewport.scrollTop + rect.top - viewportRect.top - viewport.clientHeight * 0.35,
              left: viewport.scrollLeft + rect.left - viewportRect.left - 24,
              behavior: 'smooth',
            });
            return;
          }
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
      }
    },
    [goToPage]
  );

  useImperativeHandle(
    ref,
    () => ({
      goToPage: (pageNum: number) => goToPage(pageNum),
      previewZoom,
      search: searchPdf,
      goToSearchMatch,
      goToProgress: (fraction: number) => {
        const clamped = Math.min(1, Math.max(0, fraction));
        const page = totalPages > 1 ? Math.round(clamped * (totalPages - 1)) + 1 : 1;
        setCurrentPage(page);

        if (isDoubleSided && doubleSidedRef.current) {
          doubleSidedRef.current.goToProgress(fraction);
          return;
        }

        const viewport = viewportRef.current;
        if (viewport) {
          if (isHorizontal) {
            viewport.scrollTo({
              left: clamped * Math.max(0, viewport.scrollWidth - viewport.clientWidth),
              behavior: 'smooth',
            });
          } else {
            viewport.scrollTo({
              top: clamped * Math.max(0, viewport.scrollHeight - viewport.clientHeight),
              behavior: 'smooth',
            });
          }
        } else {
          requestAnimationFrame(() => scrollToPage(page));
        }
      },
    }),
    [goToPage, goToSearchMatch, previewZoom, scrollToPage, searchPdf, totalPages, isDoubleSided, isHorizontal]
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setPdfDoc(null);
    setPageSizes({});
    setPageLayoutReady(false);

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(fileData.slice(0)),
      useSystemFonts: true,
    });

    loadingTask.promise
      .then((doc) => {
        if (!active) return;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        const start = Math.max(1, Math.min(initialPageRef.current, doc.numPages));
        setCurrentPage(start);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        console.error('Failed to load PDF document:', reason);
        setError(reason instanceof Error ? reason.message : 'Failed to parse PDF document.');
        setLoading(false);
      });

    return () => {
      active = false;
      void loadingTask.destroy();
    };
  }, [fileData]);

  // Restore initial page when layout becomes ready
  useEffect(() => {
    if (!pdfDoc || !pageLayoutReady || isDoubleSided) return;
    let attempts = 0;
    let frame = 0;
    const seek = () => {
      attempts += 1;
      const page = Math.max(1, Math.min(initialPageRef.current, totalPages));
      const target = pageStackRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`);
      if (target || attempts >= 12) {
        scrollToPage(page, 'auto');
        return;
      }
      frame = requestAnimationFrame(seek);
    };
    frame = requestAnimationFrame(seek);
    return () => cancelAnimationFrame(frame);
  }, [pdfDoc, pageLayoutReady, scrollToPage, totalPages, isDoubleSided]);

  // Pre-measure real aspect ratios of all pages to prevent jumpy layout
  useEffect(() => {
    if (!pdfDoc) return;
    let active = true;
    setPageLayoutReady(false);
    void Promise.all(
      Array.from({ length: pdfDoc.numPages }, async (_, index) => {
        const page = await pdfDoc.getPage(index + 1);
        const viewport = page.getViewport({ scale: 1 });
        return [index + 1, { width: viewport.width, height: viewport.height }] as const;
      })
    )
      .then((sizes) => {
        if (!active) return;
        setPageSizes((previous) => ({ ...previous, ...Object.fromEntries(sizes) }));
        setPageLayoutReady(true);
      })
      .catch((reason: unknown) => {
        if (active) {
          console.warn('Could not pre-measure all PDF pages:', reason);
          setPageLayoutReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [pdfDoc]);

  // Trigger resize re-render observer
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setLayoutVersion((version) => version + 1));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [pdfDoc]);

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
      ? pageStackRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${activeAnchor.pageNumber}"]`)
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

  // Keep single page centered on page switch in paginated mode
  useEffect(() => {
    if (!isPaginated) return;
    const frame = requestAnimationFrame(() => {
      viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentPage, isPaginated]);

  const reportScrollPosition = useCallback(() => {
    const viewport = viewportRef.current;
    const stack = pageStackRef.current;
    if (!viewport || !stack || totalPages < 1) return;

    if (isPaginated) {
      const fraction = totalPages > 1 ? (currentPage - 1) / (totalPages - 1) : 0;
      onProgressUpdateRef.current(String(currentPage), Math.min(1, Math.max(0, fraction)), currentPage - 1);
      return;
    }

    if (isHorizontal) {
      const viewportLeft = viewport.getBoundingClientRect().left + 24;
      const pages = Array.from(stack.querySelectorAll<HTMLElement>('[data-pdf-page]'));
      let visiblePage = currentPage;
      for (const page of pages) {
        if (page.getBoundingClientRect().right > viewportLeft) {
          visiblePage = Number(page.dataset.pdfPage) || visiblePage;
          break;
        }
      }

      const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const withinPageFraction = maxScroll > 0 ? viewport.scrollLeft / maxScroll : 0;
      const fraction = totalPages > 1
        ? Math.min(1, (Math.max(0, visiblePage - 1) + withinPageFraction) / (totalPages - 1))
        : withinPageFraction;

      setCurrentPage((previous) => (previous === visiblePage ? previous : visiblePage));
      onProgressUpdateRef.current(String(visiblePage), Math.min(1, Math.max(0, fraction)), visiblePage - 1);
      return;
    }

    // Default continuous vertical scroll
    const viewportTop = viewport.getBoundingClientRect().top + 16;
    const pages = Array.from(stack.querySelectorAll<HTMLElement>('[data-pdf-page]'));
    let visiblePage = currentPage;
    for (const page of pages) {
      if (page.getBoundingClientRect().bottom > viewportTop) {
        visiblePage = Number(page.dataset.pdfPage) || visiblePage;
        break;
      }
    }

    const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const withinPageFraction = maxScroll > 0 ? viewport.scrollTop / maxScroll : 0;
    const fraction = totalPages > 1
      ? Math.min(1, (Math.max(0, visiblePage - 1) + withinPageFraction) / (totalPages - 1))
      : withinPageFraction;

    setCurrentPage((previous) => (previous === visiblePage ? previous : visiblePage));
    onProgressUpdateRef.current(String(visiblePage), Math.min(1, Math.max(0, fraction)), visiblePage - 1);
  }, [currentPage, isHorizontal, isPaginated, totalPages]);

  const handleScroll = useCallback(() => {
    if (previewTransformRef.current !== null) return;
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (previewTransformRef.current !== null) return;
      reportScrollPosition();
    });
  }, [reportScrollPosition]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  // Native wheel listener for 2D pan, Ctrl+wheel gesture zoom, and horizontal wheel conversion
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheelNative = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (onZoomGesture) {
          e.preventDefault();
          onZoomGesture(e.deltaY, { x: e.clientX, y: e.clientY });
        }
        return;
      }

      if (readerZoom > 1) {
        // 2D Pan when zoomed in
        e.preventDefault();
        viewport.scrollLeft += e.deltaX;
        viewport.scrollTop += e.deltaY;
        return;
      }

      if (isHorizontal) {
        // Translate vertical wheel scroll to horizontal scrolling
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          viewport.scrollLeft += e.deltaY;
        }
      }
    };

    viewport.addEventListener('wheel', handleWheelNative, { passive: false });
    return () => {
      viewport.removeEventListener('wheel', handleWheelNative);
    };
  }, [readerZoom, isHorizontal, onZoomGesture]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(`.${styles.navZone}`)) return;

    const viewport = viewportRef.current;
    if (!viewport) return;

    isMouseDownRef.current = true;
    hasDraggedRef.current = false;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
  }, []);

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

      if (!hasDraggedRef.current && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        hasDraggedRef.current = true;
        if (readerZoom > 1) {
          setIsPanning(true);
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {}
        }
      }

      if (hasDraggedRef.current && readerZoom > 1) {
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

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    if (isHorizontal || isPaginated) {
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        goToPage(currentPage - 1);
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        goToPage(currentPage + 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        goToPage(1);
      } else if (event.key === 'End') {
        event.preventDefault();
        goToPage(totalPages);
      }
      return;
    }

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
  };

  // Delegate double-sided spread mode to PdfDoubleSidedReader
  if (isDoubleSided && pdfDoc && pageLayoutReady) {
    return (
      <PdfDoubleSidedReader
        ref={doubleSidedRef}
        pdfDoc={pdfDoc}
        totalPages={totalPages}
        initialPage={currentPage}
        pageSizes={pageSizes}
        onProgressUpdate={onProgressUpdate}
        onToggleControls={onToggleControls}
        readerZoom={readerZoom}
        zoomAnchor={zoomAnchor}
        onZoomGesture={onZoomGesture}
        searchPdf={searchPdf}
        goToSearchMatch={goToSearchMatch}
      />
    );
  }

  const stackClassName = isHorizontal
    ? styles.horizontalStack
    : isPaginated
      ? styles.paginatedStack
      : styles.pageStack;

  const currentLayoutMode: 'scroll' | 'horizontal' | 'paginated' = isHorizontal
    ? 'horizontal'
    : isPaginated
      ? 'paginated'
      : 'scroll';

  const visiblePages = isPaginated
    ? [currentPage]
    : Array.from({ length: totalPages }, (_, index) => index + 1);

  return (
    <div
      className={`${styles.container} ${readerZoom > 1 ? styles.isZoomed : ''} ${isPanning ? styles.isPanning : ''}`}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      tabIndex={0}
      autoFocus
      role="region"
      aria-label="PDF Document Viewer"
    >
      <div
        ref={viewportRef}
        className={styles.viewport}
        data-reader-viewport={
          isHorizontal
            ? 'pdf-horizontal-scroll'
            : isPaginated
              ? 'pdf-page'
              : 'pdf-vertical-scroll'
        }
        data-current-page={currentPage}
        onScroll={handleScroll}
        onClick={(event) => {
          if (hasDraggedRef.current) return;
          if (event.target === viewportRef.current) onToggleControls?.();
        }}
      >
        {(loading || (pdfDoc && !pageLayoutReady)) && (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner} />
            <span>Loading PDF document…</span>
          </div>
        )}

        {error && (
          <div className={styles.errorOverlay}>
            <AlertCircle size={32} style={{ color: 'var(--color-danger)' }} />
            <p className={styles.errorText}>{error}</p>
          </div>
        )}

        {pdfDoc && pageLayoutReady && (
          <div ref={pageStackRef} className={stackClassName}>
            {visiblePages.map((pageNumber) => (
              <PdfPageView
                key={pageNumber}
                pdfDoc={pdfDoc}
                pageNumber={pageNumber}
                viewportRef={viewportRef}
                pageSize={pageSizes[pageNumber]}
                readerZoom={readerZoom}
                layoutVersion={layoutVersion}
                initiallyVisible={Math.abs(pageNumber - currentPage) <= 1}
                onPageSize={setPageSize}
                layoutMode={currentLayoutMode}
              />
            ))}
          </div>
        )}
      </div>

      {/* Floating navigation buttons for paginated and horizontal modes */}
      {(isHorizontal || isPaginated) && (
        <>
          <button
            className={`${styles.navZone} ${styles.navLeft}`}
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            title="Previous Page (ArrowLeft)"
            aria-label="Previous Page"
            type="button"
          >
            <div className={styles.navButton}>
              <ChevronLeft size={24} />
            </div>
          </button>
          <button
            className={`${styles.navZone} ${styles.navRight}`}
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            title="Next Page (ArrowRight)"
            aria-label="Next Page"
            type="button"
          >
            <div className={styles.navButton}>
              <ChevronRight size={24} />
            </div>
          </button>
          <div className={styles.pageBadge}>
            Page {currentPage} of {totalPages}
          </div>
        </>
      )}
    </div>
  );
});
