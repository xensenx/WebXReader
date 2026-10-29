/**
 * Fixed-layout PDF reader powered by pdfjs-dist.
 *
 * PDFs are not reflowable, but they should still behave like a document: the
 * primary interaction is native vertical scrolling through a page stack.
 * Reader-level controls own zoom, while the progress scrubber and document
 * contents provide page jumps without a second toolbar.
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
  type CSSProperties,
} from 'react';
import { AlertCircle } from 'lucide-react';
import { pdfjsLib } from '../../core/parsing/pdf-init';
import { createTextExcerpt, findTextMatches, findTextRange } from '../../utils/text-search';
import { showTransientSearchHighlight } from '../../utils/transient-search-highlight';
import type { ReaderSearchResult } from './search-types';
import styles from './PdfReader.module.css';

type PdfDocument = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;
type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>;
type PdfRenderTask = ReturnType<PdfPage['render']>;
type PdfTextContent = Awaited<ReturnType<PdfPage['getTextContent']>>;
type PdfTextLayer = {
  render: () => Promise<unknown>;
  cancel: () => void;
};

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

interface PdfReaderProps {
  fileData: ArrayBuffer;
  initialPage?: number;
  readingMode?: 'scroll' | 'paginated';
  onProgressUpdate: (chapterId: string, progressFraction: number, pageIndex: number) => void;
  onToggleControls?: () => void;
  readerZoom?: number;
  zoomAnchor?: PdfZoomAnchor;
}

interface PageSize {
  width: number;
  height: number;
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

function getPdfDisplayScale(
  baseWidth: number,
  viewportWidth: number,
  readerZoom: number
) {
  const availableWidth = Math.max(240, viewportWidth - 32);
  const fitScale = availableWidth / baseWidth;
  return Math.min(2.2, Math.max(0.45, fitScale)) * readerZoom;
}

interface PdfPageViewProps {
  pdfDoc: PdfDocument;
  pageNumber: number;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  pageSize: PageSize | undefined;
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
  const textContentCacheRef = useRef<{
    pdfDoc: PdfDocument;
    pageNumber: number;
    textContent: PdfTextContent;
  } | null>(null);
  const [shouldRender, setShouldRender] = useState(initiallyVisible);
  const [hasRendered, setHasRendered] = useState(false);

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
          // Keep only nearby pages rasterized. Large zoom levels multiply
          // canvas memory by page area, so distant pages return to placeholders.
          setShouldRender(false);
        }
      },
      { root, rootMargin: '1200px 0px' }
    );
    observer.observe(shell);
    return () => observer.disconnect();
    }, [initiallyVisible, viewportRef]);

  useEffect(() => {
    if (shouldRender) return;
    if (canvasRef.current) {
      canvasRef.current.width = 0;
      canvasRef.current.height = 0;
    }
    textLayerContainerRef.current?.replaceChildren();
    setHasRendered(false);
  }, [shouldRender]);

  useEffect(() => {
    if (!shouldRender || !canvasRef.current || !textLayerContainerRef.current || !viewportRef.current) return;
    let active = true;
    let stagedTextLayer: HTMLDivElement | null = null;

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
          readerZoom
        );
        const viewport = page.getViewport({ scale });
        const stagingCanvas = document.createElement('canvas');
        const maxPixelCount = 16_000_000;
        const dpr = Math.min(
          window.devicePixelRatio || 1,
          2.5,
          8192 / Math.max(1, viewport.width),
          8192 / Math.max(1, viewport.height),
          Math.sqrt(maxPixelCount / Math.max(1, viewport.width * viewport.height))
        );

        stagingCanvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        stagingCanvas.height = Math.max(1, Math.floor(viewport.height * dpr));

        const context = stagingCanvas.getContext('2d', { alpha: false });
        if (!context) return;

        let textContent: PdfTextContent;
        const cachedText = textContentCacheRef.current;
        if (cachedText?.pdfDoc === pdfDoc && cachedText.pageNumber === pageNumber) {
          textContent = cachedText.textContent;
        } else {
          textContent = await page.getTextContent();
          textContentCacheRef.current = { pdfDoc, pageNumber, textContent };
        }
        if (!active || !textLayerContainerRef.current) return;

        stagedTextLayer = document.createElement('div');
        stagedTextLayer.className = styles.textLayer;
        stagedTextLayer.style.position = 'fixed';
        stagedTextLayer.style.inset = 'auto';
        stagedTextLayer.style.left = '-10000px';
        stagedTextLayer.style.top = '0';
        stagedTextLayer.style.width = `${Math.floor(viewport.width)}px`;
        stagedTextLayer.style.height = `${Math.floor(viewport.height)}px`;
        stagedTextLayer.style.setProperty('--total-scale-factor', String(viewport.scale));
        document.body.appendChild(stagedTextLayer);

        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: stagedTextLayer,
          viewport,
        });
        textLayerRef.current = textLayer;
        let textLayerReady = true;
        const textLayerPromise = textLayer.render().catch((textError: unknown) => {
          textLayerReady = false;
          if (active) console.warn(`Failed to render PDF text layer ${pageNumber}:`, textError);
        });

        // Let PDF.js apply the device-pixel transform as part of its render
        // pipeline. Applying a transform directly to the context is easy to
        // get wrong when a render is cancelled during scrolling or zooming.
        const task = page.render({
          canvas: stagingCanvas,
          canvasContext: context,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        });
        renderTaskRef.current = task;
        await task.promise;
        await textLayerPromise;
        if (renderTaskRef.current === task) renderTaskRef.current = null;
        if (textLayerRef.current === textLayer) textLayerRef.current = null;

        if (!active) return;
        const canvas = canvasRef.current;
        const textLayerContainer = textLayerContainerRef.current;
        if (!canvas || !textLayerContainer) return;

        // Keep the previous bitmap on screen while PDF.js draws the next
        // zoom level. Replacing it only after the staged render is complete
        // prevents the blank/white flash on every zoom gesture.
        canvas.width = stagingCanvas.width;
        canvas.height = stagingCanvas.height;
        const visibleContext = canvas.getContext('2d', { alpha: false });
        if (!visibleContext) return;
        visibleContext.drawImage(stagingCanvas, 0, 0);
        if (textLayerReady && stagedTextLayer) {
          textLayerContainer.style.setProperty('--total-scale-factor', String(viewport.scale));
          textLayerContainer.replaceChildren(...Array.from(stagedTextLayer.childNodes));
        }
        setHasRendered(true);
      } catch (error) {
        if (error && typeof error === 'object' && 'name' in error && error.name === 'RenderingCancelledException') {
          return;
        }
        console.error(`Failed to render PDF page ${pageNumber}:`, error);
      } finally {
        stagedTextLayer?.remove();
      }
    };

    // Wheel, pinch and resize gestures can produce many zoom values per
    // second. Let the shell scale immediately and redraw after a short pause.
    const timer = window.setTimeout(() => void render(), 40);
    return () => {
      active = false;
      window.clearTimeout(timer);
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      if (textLayerRef.current) {
        textLayerRef.current.cancel();
        textLayerRef.current = null;
      }
    };
  }, [pdfDoc, pageNumber, shouldRender, readerZoom, layoutVersion, viewportRef, onPageSize]);

  const fallbackSize = pageSize ?? { width: 612, height: 792 };
  const displayScale = getPdfDisplayScale(
    fallbackSize.width,
    viewportRef.current?.clientWidth ?? 0,
    readerZoom
  );
  const shellStyle: CSSProperties = {
    width: `${Math.floor(fallbackSize.width * displayScale)}px`,
    height: `${Math.floor(fallbackSize.height * displayScale)}px`,
  };

  return (
    <div
      ref={shellRef}
      className={styles.pageShell}
      data-pdf-page={pageNumber}
      style={shellStyle}
      aria-label={`PDF page ${pageNumber}`}
    >
      <canvas ref={canvasRef} className={styles.pdfCanvas} aria-label={`Page ${pageNumber}`} />
      <div ref={textLayerContainerRef} className={styles.textLayer} aria-label={`Selectable text for page ${pageNumber}`} />
      {!hasRendered && <div className={styles.pagePlaceholder} aria-hidden="true" />}
    </div>
  );
}

export const PdfReader = forwardRef<PdfReaderHandle, PdfReaderProps>(function PdfReader(
  { fileData, initialPage = 1, readingMode = 'scroll', onProgressUpdate, onToggleControls, readerZoom = 1, zoomAnchor },
  ref
) {
  const isContinuous = readingMode === 'scroll';
  const [pdfDoc, setPdfDoc] = useState<PdfDocument | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(Math.max(1, initialPage));
  const [totalPages, setTotalPages] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pageSizes, setPageSizes] = useState<Record<number, PageSize>>({});
  const [pageLayoutReady, setPageLayoutReady] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);

  const viewportRef = useRef<HTMLDivElement>(null);
  const pageStackRef = useRef<HTMLDivElement>(null);
  const previewTransformRef = useRef<PdfZoomPreviewTransform | null>(null);
  const lastZoomAnchorRef = useRef<PdfZoomAnchor | undefined>(undefined);
  const initialPageRef = useRef(initialPage);
  const onProgressUpdateRef = useRef(onProgressUpdate);
  const scrollFrameRef = useRef<number | null>(null);
  const previousReaderZoomRef = useRef(readerZoom);
  const searchIndexRef = useRef<{ document: PdfDocument; promise: Promise<PdfSearchPage[]> } | null>(null);
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

  const scrollToPage = useCallback((pageNumber: number, behavior: ScrollBehavior = 'smooth') => {
    const viewport = viewportRef.current;
    const page = pageStackRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${pageNumber}"]`);
    if (!viewport || !page) return;
    viewport.scrollTo({ top: Math.max(0, page.offsetTop - 16), behavior });
  }, []);

  // Update one compositor transform per animation frame while the user is
  // zooming. Keep an explicit screen-to-document transform so the point under
  // the pointer remains fixed even when the pointer moves between frames.
  // React state stays at the last committed scale so page layout and PDF.js
  // raster tasks do not restart for every wheel/pinch event.
  const previewZoom = useCallback((nextZoom: number, anchor: PdfZoomAnchor) => {
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

    // Invert the last preview transform to find the document point currently
    // under the pointer, then map that same point to the new zoom level.
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

  const goToPage = useCallback((pageNum: number, behavior: ScrollBehavior = 'smooth') => {
    const clamped = Math.max(1, Math.min(pageNum, totalPages));
    setCurrentPage(clamped);
    requestAnimationFrame(() => scrollToPage(clamped, behavior));
  }, [scrollToPage, totalPages]);

  const searchPdf = useCallback(async (query: string): Promise<ReaderSearchResult[]> => {
    const normalizedQuery = query.trim();
    if (!pdfDoc || normalizedQuery.length < 2) return [];

    if (searchIndexRef.current?.document !== pdfDoc) {
      const document = pdfDoc;
      const promise = (async () => {
        const pages: PdfSearchPage[] = [];
        const batchSize = 6;
        for (let start = 1; start <= document.numPages; start += batchSize) {
          const batch = await Promise.all(Array.from(
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
            },
          ));
          pages.push(...batch);
          // Yield between batches so large PDFs do not monopolize the UI thread.
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
  }, [pdfDoc]);

  const goToSearchMatch = useCallback(async (pageNumber: number, query: string, matchIndex: number) => {
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
  }, [goToPage]);

  useImperativeHandle(ref, () => ({
    goToPage: (pageNum: number) => goToPage(pageNum),
    previewZoom,
    search: searchPdf,
    goToSearchMatch,
    goToProgress: (fraction: number) => {
      const viewport = viewportRef.current;
      const clamped = Math.min(1, Math.max(0, fraction));
      const page = totalPages > 1 ? Math.round(clamped * (totalPages - 1)) + 1 : 1;
      setCurrentPage(page);
      if (viewport) {
        viewport.scrollTo({
          top: clamped * Math.max(0, viewport.scrollHeight - viewport.clientHeight),
          behavior: 'smooth',
        });
      } else {
        requestAnimationFrame(() => scrollToPage(page));
      }
    },
  }), [goToPage, goToSearchMatch, previewZoom, scrollToPage, searchPdf, totalPages]);

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
    }
  };

  return (
    <div className={styles.container} onKeyDown={handleKeyDown} tabIndex={0} autoFocus>
      <div
        ref={viewportRef}
        className={styles.viewport}
        data-reader-viewport={isContinuous ? 'pdf-vertical-scroll' : 'pdf-page'}
        data-current-page={currentPage}
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
