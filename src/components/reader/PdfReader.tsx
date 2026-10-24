/**
 * Fixed-layout PDF reader powered by pdfjs-dist.
 *
 * PDFs are not reflowable, but they should still behave like a document: the
 * primary interaction is native vertical scrolling through a page stack. Page
 * buttons and the page field are secondary jump controls, not a replacement
 * for scrolling.
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  type KeyboardEvent,
  type ChangeEvent,
  type FormEvent,
  type CSSProperties,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';
import { pdfjsLib } from '../../core/parsing/pdf-init';
import styles from './PdfReader.module.css';

type PdfDocument = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;
type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>;
type PdfRenderTask = ReturnType<PdfPage['render']>;
type PdfTextLayer = {
  render: () => Promise<unknown>;
  cancel: () => void;
};

export interface PdfReaderHandle {
  goToPage: (pageNum: number) => void;
  goToProgress: (fraction: number) => void;
}

interface PdfReaderProps {
  fileData: ArrayBuffer;
  initialPage?: number;
  readingMode?: 'scroll' | 'paginated';
  onProgressUpdate: (chapterId: string, progressFraction: number, pageIndex: number) => void;
  onToggleControls?: () => void;
  readerZoom?: number;
}

interface PageSize {
  width: number;
  height: number;
}

function getPdfDisplayScale(
  baseWidth: number,
  viewportWidth: number,
  zoom: number,
  readerZoom: number
) {
  const availableWidth = Math.max(240, viewportWidth - 32);
  const fitScale = availableWidth / baseWidth;
  return (zoom === 1
    ? Math.min(2.2, Math.max(0.45, fitScale))
    : zoom) * readerZoom;
}

interface PdfPageViewProps {
  pdfDoc: PdfDocument;
  pageNumber: number;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  pageSize: PageSize | undefined;
  zoom: number;
  readerZoom: number;
  layoutVersion: number;
  initiallyVisible: boolean;
  onPageSize: (pageNumber: number, size: PageSize) => void;
}

function PdfPageView({
  pdfDoc,
  pageNumber,
  viewportRef,
  pageSize,
  zoom,
  readerZoom,
  layoutVersion,
  initiallyVisible,
  onPageSize,
}: PdfPageViewProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerContainerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<PdfRenderTask | null>(null);
  const textLayerRef = useRef<PdfTextLayer | null>(null);
  const [shouldRender, setShouldRender] = useState(initiallyVisible);
  const [rendering, setRendering] = useState(false);

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
          // Once a page has entered the reading window, keep its canvas. This
          // avoids destroying and recreating pages while the user scrolls back.
          setShouldRender(true);
        }
      },
      { root, rootMargin: '1200px 0px' }
    );
    observer.observe(shell);
    return () => observer.disconnect();
  }, [initiallyVisible, viewportRef]);

  useEffect(() => {
    if (!shouldRender || !canvasRef.current || !textLayerContainerRef.current || !viewportRef.current) return;
    let active = true;
    setRendering(true);

    const render = async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (!active || !canvasRef.current || !viewportRef.current) return;

        const baseViewport = page.getViewport({ scale: 1 });
        onPageSize(pageNumber, {
          width: baseViewport.width,
          height: baseViewport.height,
        });

        const scale = getPdfDisplayScale(
          baseViewport.width,
          viewportRef.current.clientWidth,
          zoom,
          readerZoom
        );
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const dpr = window.devicePixelRatio || 1;

        canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const context = canvas.getContext('2d', { alpha: false });
        if (!context) return;

        const textLayerContainer = textLayerContainerRef.current;
        if (!textLayerContainer) return;
        textLayerContainer.replaceChildren();
        textLayerContainer.style.setProperty('--total-scale-factor', String(viewport.scale));
        const textContent = await page.getTextContent();
        if (!active || !textLayerContainerRef.current) return;

        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerContainer,
          viewport,
        });
        textLayerRef.current = textLayer;
        const textLayerPromise = textLayer.render().catch((textError: unknown) => {
          if (active) console.warn(`Failed to render PDF text layer ${pageNumber}:`, textError);
        });

        // Let PDF.js apply the device-pixel transform as part of its render
        // pipeline. Applying a transform directly to the context is easy to
        // get wrong when a canvas is resized or a render is cancelled during
        // scrolling/zooming, and can leave pages blank or partially painted.
        const task = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        });
        renderTaskRef.current = task;
        await task.promise;
        await textLayerPromise;
        if (renderTaskRef.current === task) renderTaskRef.current = null;
      } catch (error) {
        if (error && typeof error === 'object' && 'name' in error && error.name === 'RenderingCancelledException') {
          return;
        }
        console.error(`Failed to render PDF page ${pageNumber}:`, error);
      } finally {
        if (active) setRendering(false);
      }
    };

    void render();
    return () => {
      active = false;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      if (textLayerRef.current) {
        textLayerRef.current.cancel();
        textLayerRef.current = null;
      }
      textLayerContainerRef.current?.replaceChildren();
    };
  }, [pdfDoc, pageNumber, shouldRender, zoom, readerZoom, layoutVersion, viewportRef, onPageSize]);

  const fallbackSize = pageSize ?? { width: 612, height: 792 };
  const displayScale = getPdfDisplayScale(
    fallbackSize.width,
    viewportRef.current?.clientWidth ?? 0,
    zoom,
    readerZoom
  );
  const shellStyle: CSSProperties = {
    width: `${Math.floor(fallbackSize.width * displayScale)}px`,
    height: `${Math.floor(fallbackSize.height * displayScale)}px`,
  };

  return (
    <div
      ref={shellRef}
      className={`${styles.pageShell} ${pageSize ? '' : styles.pageShellPlaceholder}`}
      data-pdf-page={pageNumber}
      style={shellStyle}
      aria-label={`PDF page ${pageNumber}`}
    >
      <canvas ref={canvasRef} className={styles.pdfCanvas} aria-label={`Page ${pageNumber}`} />
      <div ref={textLayerContainerRef} className={styles.textLayer} aria-label={`Selectable text for page ${pageNumber}`} />
      {(!shouldRender || rendering) && <div className={styles.pagePlaceholder} aria-hidden="true" />}
    </div>
  );
}

export const PdfReader = forwardRef<PdfReaderHandle, PdfReaderProps>(function PdfReader(
  { fileData, initialPage = 1, readingMode = 'scroll', onProgressUpdate, onToggleControls, readerZoom = 1 },
  ref
) {
  const isContinuous = readingMode === 'scroll';
  const [pdfDoc, setPdfDoc] = useState<PdfDocument | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(Math.max(1, initialPage));
  const [totalPages, setTotalPages] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1.0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pageSizes, setPageSizes] = useState<Record<number, PageSize>>({});
  const [pageLayoutReady, setPageLayoutReady] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);

  const viewportRef = useRef<HTMLDivElement>(null);
  const pageStackRef = useRef<HTMLDivElement>(null);
  const initialPageRef = useRef(initialPage);
  const onProgressUpdateRef = useRef(onProgressUpdate);
  const scrollFrameRef = useRef<number | null>(null);
  const previousZoomRef = useRef(zoom);
  onProgressUpdateRef.current = onProgressUpdate;

  useEffect(() => {
    initialPageRef.current = initialPage;
  }, [initialPage]);

  const [pageInputValue, setPageInputValue] = useState<string>(String(Math.max(1, initialPage)));

  const setPageSize = useCallback((pageNumber: number, size: PageSize) => {
    setPageSizes((previous) => {
      const current = previous[pageNumber];
      if (current && current.width === size.width && current.height === size.height) return previous;
      return { ...previous, [pageNumber]: size };
    });
  }, []);

  const scrollToPage = useCallback((pageNumber: number, behavior: ScrollBehavior = 'smooth') => {
    const viewport = viewportRef.current;
    const page = pageStackRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${pageNumber}"]`);
    if (!viewport || !page) return;
    viewport.scrollTo({ top: Math.max(0, page.offsetTop - 16), behavior });
  }, []);

  const goToPage = useCallback((pageNum: number, behavior: ScrollBehavior = 'smooth') => {
    const clamped = Math.max(1, Math.min(pageNum, totalPages));
    setCurrentPage(clamped);
    setPageInputValue(String(clamped));
    requestAnimationFrame(() => scrollToPage(clamped, behavior));
  }, [scrollToPage, totalPages]);

  useImperativeHandle(ref, () => ({
    goToPage: (pageNum: number) => goToPage(pageNum),
    goToProgress: (fraction: number) => {
      const viewport = viewportRef.current;
      const clamped = Math.min(1, Math.max(0, fraction));
      const page = totalPages > 1 ? Math.round(clamped * (totalPages - 1)) + 1 : 1;
      setCurrentPage(page);
      setPageInputValue(String(page));
      if (viewport) {
        viewport.scrollTo({
          top: clamped * Math.max(0, viewport.scrollHeight - viewport.clientHeight),
          behavior: 'smooth',
        });
      } else {
        requestAnimationFrame(() => scrollToPage(page));
      }
    },
  }), [goToPage, scrollToPage, totalPages]);

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
        setPageInputValue(String(start));
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

  // Keep the initial semantic page in view after the page stack has mounted.
  useEffect(() => {
    if (!pdfDoc || !pageLayoutReady) return;
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
  }, [pdfDoc, pageLayoutReady, scrollToPage, totalPages]);

  // Reserve the real aspect ratio for every page before the user reaches it.
  // A generic placeholder that later changes height moves the scroll surface
  // underneath the user and makes upward scrolling appear to snap downward.
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
    ).then((sizes) => {
      if (!active) return;
      setPageSizes((previous) => ({ ...previous, ...Object.fromEntries(sizes) }));
      // Do not expose the page stack until every shell has its final aspect
      // ratio. Replacing fallback heights while scrolling changes scrollHeight
      // and can make upward scrolling appear to snap back down.
      setPageLayoutReady(true);
    }).catch((reason: unknown) => {
      if (active) {
        console.warn('Could not pre-measure all PDF pages:', reason);
        setPageLayoutReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, [pdfDoc]);

  // Resize-triggered re-rendering is required for fit-to-width pages.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setLayoutVersion((version) => version + 1));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [pdfDoc]);

  useEffect(() => {
    if (previousZoomRef.current === zoom) return;
    previousZoomRef.current = zoom;
    requestAnimationFrame(() => scrollToPage(currentPage, 'auto'));
  }, [currentPage, scrollToPage, zoom]);

  useEffect(() => {
    if (isContinuous) return;
    const frame = requestAnimationFrame(() => {
      viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentPage, isContinuous]);

  const reportScrollPosition = useCallback(() => {
    const viewport = viewportRef.current;
    const stack = pageStackRef.current;
    if (!viewport || !stack || totalPages < 1) return;

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
    const fraction = isContinuous
      ? withinPageFraction
      : totalPages > 1
        ? Math.min(1, (Math.max(0, visiblePage - 1) + withinPageFraction) / (totalPages - 1))
        : withinPageFraction;
    setCurrentPage((previous) => previous === visiblePage ? previous : visiblePage);
    setPageInputValue((previous) => previous === String(visiblePage) ? previous : String(visiblePage));
    onProgressUpdateRef.current(String(visiblePage), Math.min(1, Math.max(0, fraction)), visiblePage - 1);
  }, [currentPage, isContinuous, totalPages]);

  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      reportScrollPosition();
    });
  }, [reportScrollPosition]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const goToNextPage = useCallback(() => goToPage(currentPage + 1), [currentPage, goToPage]);
  const goToPrevPage = useCallback(() => goToPage(currentPage - 1), [currentPage, goToPage]);

  const handlePageInputSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = Number.parseInt(pageInputValue, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= totalPages) {
      goToPage(parsed);
    } else {
      setPageInputValue(String(currentPage));
    }
  };

  const handlePageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setPageInputValue(event.target.value);
  };

  const zoomIn = () => setZoom((value) => Math.min(3, Math.round((value + 0.2) * 10) / 10));
  const zoomOut = () => setZoom((value) => Math.max(0.5, Math.round((value - 0.2) * 10) / 10));
  const resetZoom = () => setZoom(1);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
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
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomIn();
    } else if (event.key === '-') {
      event.preventDefault();
      zoomOut();
    }
  };

  return (
    <div className={styles.container} onKeyDown={handleKeyDown} tabIndex={0} autoFocus>
      <div className={styles.toolbar}>
        <div className={styles.toolGroup}>
          <button className={styles.toolBtn} onClick={goToPrevPage} disabled={currentPage <= 1} title="Scroll to previous page" aria-label="Previous page" type="button">
            <ChevronLeft size={18} />
          </button>

          <form onSubmit={handlePageInputSubmit} className={styles.pageInputGroup}>
            <input
              type="text"
              inputMode="numeric"
              className={styles.pageInput}
              value={pageInputValue}
              onChange={handlePageInputChange}
              onBlur={() => setPageInputValue(String(currentPage))}
              aria-label="Current page number"
            />
            <span className={styles.pageTotal}>/ {totalPages}</span>
          </form>

          <button className={styles.toolBtn} onClick={goToNextPage} disabled={currentPage >= totalPages} title="Scroll to next page" aria-label="Next page" type="button">
            <ChevronRight size={18} />
          </button>
        </div>

        <div className={styles.toolGroup}>
          <button className={styles.toolBtn} onClick={zoomOut} disabled={zoom <= 0.5} title="Zoom out (-)" aria-label="Zoom out" type="button">
            <ZoomOut size={16} />
          </button>
          <span className={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
          <button className={styles.toolBtn} onClick={zoomIn} disabled={zoom >= 3} title="Zoom in (+)" aria-label="Zoom in" type="button">
            <ZoomIn size={16} />
          </button>
          <button className={styles.toolBtn} onClick={resetZoom} title="Fit to width" aria-label="Fit to width" type="button">
            {zoom === 1 ? <Maximize2 size={16} /> : <RotateCcw size={16} />}
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={styles.viewport}
        data-reader-viewport={isContinuous ? 'pdf-vertical-scroll' : 'pdf-page'}
        onScroll={handleScroll}
        onClick={(event) => {
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
          <div ref={pageStackRef} className={styles.pageStack}>
            {(isContinuous
              ? Array.from({ length: totalPages }, (_, index) => index + 1)
              : [currentPage]
            ).map((pageNumber) => {
              return (
                <PdfPageView
                  key={pageNumber}
                  pdfDoc={pdfDoc}
                  pageNumber={pageNumber}
                  viewportRef={viewportRef}
                  pageSize={pageSizes[pageNumber]}
                  zoom={zoom}
                  readerZoom={readerZoom}
                  layoutVersion={layoutVersion}
                  initiallyVisible={Math.abs(pageNumber - currentPage) <= 1}
                  onPageSize={setPageSize}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
