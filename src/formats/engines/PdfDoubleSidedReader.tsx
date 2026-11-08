/**
 * Double-sided PDF Reader powered by PageFlip and PDF.js.
 *
 * Presents PDF documents as realistic two-page facing spreads with 3D page curl,
 * interactive 2D zoom/pan with left/center/right focus, and always-visible navigation buttons.
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  type KeyboardEvent,
} from 'react';
import { PageFlip } from 'page-flip';
import 'page-flip/src/Style/stPageFlip.css';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PdfDocument, PageSize } from './PdfPageView';
import type { PdfReaderHandle, PdfZoomAnchor } from './PdfReader';
import type { ReaderSearchResult } from '../../components/reader/search-types';
import styles from './PdfDoubleSidedReader.module.css';

export interface PdfDoubleSidedReaderProps {
  pdfDoc: PdfDocument;
  totalPages: number;
  initialPage?: number;
  pageSizes: Record<number, PageSize>;
  onProgressUpdate: (chapterId: string, progressFraction: number, pageIndex: number) => void;
  onToggleControls?: () => void;
  readerZoom?: number;
  zoomAnchor?: PdfZoomAnchor;
  onZoomGesture?: (deltaY: number, point?: { x: number; y: number }) => void;
  searchPdf?: (query: string) => Promise<ReaderSearchResult[]>;
  goToSearchMatch?: (pageNumber: number, query: string, matchIndex: number) => Promise<void>;
}

export const PdfDoubleSidedReader = forwardRef<PdfReaderHandle, PdfDoubleSidedReaderProps>(
  function PdfDoubleSidedReader(
    {
      pdfDoc,
      totalPages,
      initialPage = 1,
      pageSizes,
      onProgressUpdate,
      onToggleControls,
      readerZoom = 1,
      onZoomGesture,
      searchPdf,
      goToSearchMatch,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const bookStageRef = useRef<HTMLDivElement>(null);
    const bookContainerRef = useRef<HTMLDivElement>(null);
    const pageFlipMountRef = useRef<HTMLDivElement | null>(null);
    const pageFlipRef = useRef<PageFlip | null>(null);

    const [currentPageIndex, setCurrentPageIndex] = useState<number>(Math.max(0, initialPage - 1));
    const [, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [sideFocus, setSideFocus] = useState<'left' | 'center' | 'right'>('center');
    const [spreadDimensions, setSpreadDimensions] = useState<{
      pageWidth: number;
      pageHeight: number;
      isPortrait: boolean;
    } | null>(null);

    const isMouseDownRef = useRef(false);
    const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const panRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const hasDraggedRef = useRef(false);
    const renderedPagesSetRef = useRef<Set<number>>(new Set());
    const onProgressUpdateRef = useRef(onProgressUpdate);
    onProgressUpdateRef.current = onProgressUpdate;

    /**
     * Calculates single-page and two-page spread dimensions based on viewport bounds.
     */
    const calculateDimensions = useCallback(() => {
      const container = containerRef.current;
      if (!container) return null;

      const viewportW = container.clientWidth || window.innerWidth;
      const viewportH = container.clientHeight || window.innerHeight;

      const sampleSize = pageSizes[1] ?? { width: 612, height: 792 };
      const baseW = Math.max(100, sampleSize.width);
      const baseH = Math.max(100, sampleSize.height);
      const isPortrait = viewportW < viewportH * 1.15;

      const maxPageW = isPortrait
        ? Math.max(200, viewportW - 48)
        : Math.max(200, (viewportW - 80) / 2);
      const maxPageH = Math.max(200, viewportH - 64);

      const scale = Math.min(maxPageW / baseW, maxPageH / baseH);
      const pageWidth = Math.max(160, Math.floor(baseW * scale));
      const pageHeight = Math.max(200, Math.floor(baseH * scale));

      return { pageWidth, pageHeight, isPortrait };
    }, [pageSizes]);

    /**
     * Renders a given PDF page to its canvas element within the PageFlip mount.
     */
    const renderPageToCanvas = useCallback(
      async (pageNum: number) => {
        if (!pdfDoc || pageNum < 1 || pageNum > totalPages) return;
        if (renderedPagesSetRef.current.has(pageNum)) return;

        const mount = pageFlipMountRef.current;
        if (!mount) return;

        const canvas = mount.querySelector<HTMLCanvasElement>(`[data-pdf-canvas="${pageNum}"]`);
        if (!canvas) return;

        renderedPagesSetRef.current.add(pageNum);

        try {
          const page = await pdfDoc.getPage(pageNum);
          const baseViewport = page.getViewport({ scale: 1 });
          const dims = spreadDimensions ?? calculateDimensions();
          if (!dims) return;

          const scale = dims.pageWidth / baseViewport.width;
          const viewport = page.getViewport({ scale });
          const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);

          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) return;

          await page.render({
            canvas,
            canvasContext: ctx,
            viewport,
            transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
          }).promise;
        } catch (err) {
          renderedPagesSetRef.current.delete(pageNum);
          console.error(`Failed to render page ${pageNum} in double-sided mode:`, err);
        }
      },
      [pdfDoc, totalPages, spreadDimensions, calculateDimensions]
    );

    /**
     * Lazy-renders pages adjacent to the current viewport to conserve resources.
     */
    const renderNearbyPages = useCallback(
      (activePageNum: number) => {
        const start = Math.max(1, activePageNum - 2);
        const end = Math.min(totalPages, activePageNum + 3);
        for (let p = start; p <= end; p++) {
          void renderPageToCanvas(p);
        }
      },
      [renderPageToCanvas, totalPages]
    );

    /**
     * Computes pan boundary limits to constrain viewport motion during zooming.
     */
    const calculateMaxPan = useCallback(
      (zoomLevel: number = readerZoom) => {
        const container = containerRef.current;
        const dims = spreadDimensions;
        if (!dims || !container) return { maxX: 0, maxY: 0, spreadW: 0, spreadH: 0 };

        const spreadW = dims.isPortrait ? dims.pageWidth : dims.pageWidth * 2;
        const spreadH = dims.pageHeight;
        const scaledW = spreadW * zoomLevel;
        const scaledH = spreadH * zoomLevel;
        const viewportW = container.clientWidth || window.innerWidth;
        const viewportH = container.clientHeight || window.innerHeight;

        const sideCenterOffset = dims.isPortrait ? 0 : (spreadW / 4) * zoomLevel;
        const overflowX = Math.max(0, (scaledW - viewportW) / 2);
        const maxX = Math.max(sideCenterOffset, overflowX + 48);

        const overflowY = Math.max(0, (scaledH - viewportH) / 2);
        const maxY = overflowY > 0 ? overflowY + 48 : 48;

        return { maxX, maxY, spreadW, spreadH };
      },
      [readerZoom, spreadDimensions]
    );

    /**
     * Focuses the camera onto the left page, spine center, or right page when zoomed.
     */
    const focusSide = useCallback(
      (side: 'left' | 'center' | 'right', zoomLevel: number = readerZoom) => {
        const { maxX, spreadW } = calculateMaxPan(zoomLevel);
        let targetX = 0;
        if (side === 'left') {
          targetX = Math.min(maxX, (spreadW / 4) * zoomLevel);
        } else if (side === 'right') {
          targetX = Math.max(-maxX, -(spreadW / 4) * zoomLevel);
        } else {
          targetX = 0;
        }

        const newPan = { x: targetX, y: 0 };
        setPan(newPan);
        panRef.current = newPan;
        setSideFocus(side);

        if (bookStageRef.current) {
          bookStageRef.current.style.setProperty('--pdf-pan-x', `${targetX}px`);
          bookStageRef.current.style.setProperty('--pdf-pan-y', '0px');
        }
      },
      [calculateMaxPan, readerZoom]
    );

    // Mount PageFlip instance when dimensions and container are ready
    useEffect(() => {
      const bookContainer = bookContainerRef.current;
      if (!bookContainer || !pdfDoc || totalPages < 1) return;

      const dims = calculateDimensions();
      if (!dims) return;
      setSpreadDimensions(dims);

      // Clean up previous PageFlip instance
      if (pageFlipRef.current) {
        try {
          pageFlipRef.current.destroy();
        } catch {}
        pageFlipRef.current = null;
      }
      renderedPagesSetRef.current.clear();
      bookContainer.replaceChildren();

      // Create dedicated mount container
      const mountEl = document.createElement('div');
      mountEl.style.width = `${dims.isPortrait ? dims.pageWidth : dims.pageWidth * 2}px`;
      mountEl.style.height = `${dims.pageHeight}px`;
      pageFlipMountRef.current = mountEl;
      bookContainer.appendChild(mountEl);

      // Create page sheets with canvas elements
      for (let p = 1; p <= totalPages; p++) {
        const sheet = document.createElement('div');
        sheet.className = styles.pageSheet;
        sheet.dataset.density = p === 1 || p === totalPages ? 'hard' : 'soft';
        sheet.setAttribute('aria-label', `Page ${p}`);

        const canvas = document.createElement('canvas');
        canvas.setAttribute('data-pdf-canvas', String(p));
        sheet.appendChild(canvas);
        mountEl.appendChild(sheet);
      }

      const initialStart = Math.max(0, Math.min(totalPages - 1, currentPageIndex));

      const pageFlip = new PageFlip(mountEl, {
        width: dims.pageWidth,
        height: dims.pageHeight,
        size: 'fixed',
        minWidth: 200,
        maxWidth: 2400,
        minHeight: 250,
        maxHeight: 2800,
        maxShadowOpacity: 0.5,
        showCover: true,
        mobileScrollSupport: false,
        useMouseEvents: readerZoom <= 1,
        flippingTime: 450,
        usePortrait: dims.isPortrait,
        startPage: initialStart,
      });

      pageFlipRef.current = pageFlip;
      pageFlip.loadFromHTML(mountEl.querySelectorAll(`.${styles.pageSheet}`));

      pageFlip.on('flip', (e) => {
        const newIdx = typeof e.data === 'number' ? e.data : pageFlip.getCurrentPageIndex();
        setCurrentPageIndex(newIdx);
        const pageNum = newIdx + 1;
        const fraction = totalPages > 1 ? newIdx / (totalPages - 1) : 0;
        onProgressUpdateRef.current(String(pageNum), Math.min(1, Math.max(0, fraction)), newIdx);
        renderNearbyPages(pageNum);
      });

      // Render pages around the starting spread
      const activeNum = initialStart + 1;
      renderNearbyPages(activeNum);

      return () => {
        try {
          pageFlip.destroy();
        } catch {}
        pageFlipRef.current = null;
        mountEl.remove();
      };
    }, [pdfDoc, totalPages, calculateDimensions]); // eslint-disable-line react-hooks/exhaustive-deps

    // Apply readerZoom transform and update PageFlip mouse event handling
    useEffect(() => {
      if (bookStageRef.current) {
        bookStageRef.current.style.setProperty('--pdf-reader-zoom', String(readerZoom));
      }

      if (pageFlipRef.current) {
        try {
          const pf = pageFlipRef.current as any;
          const flipSettings = pf.getSettings?.();
          if (flipSettings) {
            flipSettings.useMouseEvents = readerZoom <= 1;
          }
          const ui = pf.getUI?.() || pf.ui;
          if (ui) {
            if (readerZoom > 1) {
              ui.removeHandlers?.();
            } else {
              ui.setHandlers?.();
            }
          }
        } catch {}
      }

      if (readerZoom <= 1) {
        setPan({ x: 0, y: 0 });
        panRef.current = { x: 0, y: 0 };
        setSideFocus('center');
        if (bookStageRef.current) {
          bookStageRef.current.style.setProperty('--pdf-pan-x', '0px');
          bookStageRef.current.style.setProperty('--pdf-pan-y', '0px');
        }
      }
    }, [readerZoom]);

    // Native wheel listener for 2D pan and Ctrl+wheel zooming
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const handleWheelNative = (e: WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
          if (onZoomGesture) {
            e.preventDefault();
            onZoomGesture(e.deltaY, { x: e.clientX, y: e.clientY });
          }
          return;
        }

        if (readerZoom > 1) {
          e.preventDefault();
          const { maxX, maxY } = calculateMaxPan(readerZoom);
          const nextX = Math.max(-maxX, Math.min(maxX, panRef.current.x - e.deltaX));
          const nextY = Math.max(-maxY, Math.min(maxY, panRef.current.y - e.deltaY));
          const newPan = { x: nextX, y: nextY };
          panRef.current = newPan;
          setPan(newPan);

          if (bookStageRef.current) {
            bookStageRef.current.style.setProperty('--pdf-pan-x', `${nextX}px`);
            bookStageRef.current.style.setProperty('--pdf-pan-y', `${nextY}px`);
          }
        }
      };

      container.addEventListener('wheel', handleWheelNative, { passive: false });
      return () => {
        container.removeEventListener('wheel', handleWheelNative);
      };
    }, [readerZoom, onZoomGesture, calculateMaxPan]);

    // Handle window resize re-measurement
    useEffect(() => {
      const container = containerRef.current;
      if (!container || typeof ResizeObserver === 'undefined') return;

      const observer = new ResizeObserver(() => {
        const dims = calculateDimensions();
        if (dims) setSpreadDimensions(dims);
      });
      observer.observe(container);
      return () => observer.disconnect();
    }, [calculateDimensions]);

    const flipPrev = useCallback(() => {
      try {
        pageFlipRef.current?.flipPrev();
      } catch {}
    }, []);

    const flipNext = useCallback(() => {
      try {
        pageFlipRef.current?.flipNext();
      } catch {}
    }, []);

    const turnToPage = useCallback(
      (pageNumber: number) => {
        const targetIdx = Math.max(0, Math.min(totalPages - 1, pageNumber - 1));
        setCurrentPageIndex(targetIdx);
        renderNearbyPages(pageNumber);
        try {
          pageFlipRef.current?.turnToPage(targetIdx);
        } catch {}
      },
      [totalPages, renderNearbyPages]
    );

    useImperativeHandle(
      ref,
      () => ({
        goToPage: (pageNum: number) => turnToPage(pageNum),
        goToProgress: (fraction: number) => {
          const clamped = Math.min(1, Math.max(0, fraction));
          const page = totalPages > 1 ? Math.round(clamped * (totalPages - 1)) + 1 : 1;
          turnToPage(page);
        },
        previewZoom: (zoom: number) => {
          if (bookStageRef.current) {
            bookStageRef.current.style.setProperty('--pdf-reader-zoom', String(zoom));
          }
        },
        search: async (query: string) => {
          return searchPdf ? searchPdf(query) : [];
        },
        goToSearchMatch: async (pageNumber: number, query: string, matchIndex: number) => {
          turnToPage(pageNumber);
          if (goToSearchMatch) await goToSearchMatch(pageNumber, query, matchIndex);
        },
      }),
      [turnToPage, totalPages, searchPdf, goToSearchMatch]
    );

    const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest(`.${styles.navZone}`) || target.closest(`.${styles.sideFocusControls}`)) return;

      isMouseDownRef.current = true;
      hasDraggedRef.current = false;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      panStartRef.current = { ...panRef.current };
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
          const { maxX, maxY } = calculateMaxPan(readerZoom);
          const nextX = Math.max(-maxX, Math.min(maxX, panStartRef.current.x + dx));
          const nextY = Math.max(-maxY, Math.min(maxY, panStartRef.current.y + dy));
          const newPan = { x: nextX, y: nextY };
          panRef.current = newPan;
          setPan(newPan);

          if (bookStageRef.current) {
            bookStageRef.current.style.setProperty('--pdf-pan-x', `${nextX}px`);
            bookStageRef.current.style.setProperty('--pdf-pan-y', `${nextY}px`);
          }
        }
      },
      [readerZoom, calculateMaxPan]
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

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        flipPrev();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        flipNext();
      } else if (e.key === 'Home') {
        e.preventDefault();
        turnToPage(1);
      } else if (e.key === 'End') {
        e.preventDefault();
        turnToPage(totalPages);
      }
    };

    const isFirstPage = currentPageIndex <= 0;
    const isLastPage = currentPageIndex >= totalPages - 1;

    return (
      <div
        ref={containerRef}
        className={`${styles.container} ${readerZoom > 1 ? styles.isZoomed : ''} ${isPanning ? styles.isPanning : ''}`}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        tabIndex={0}
        autoFocus
        role="region"
        aria-label="Double-sided PDF spread viewer"
      >
        <div
          ref={bookStageRef}
          className={`${styles.bookStage} ${isPanning ? styles.isPanningStage : ''}`}
          onClick={(e) => {
            if (hasDraggedRef.current) return;
            const target = e.target as HTMLElement;
            if (!target.closest(`.${styles.pageSheet}`)) {
              onToggleControls?.();
            }
          }}
        >
          <div ref={bookContainerRef} className={styles.bookContainer} />
        </div>

        {/* Floating previous page button */}
        <button
          className={`${styles.navZone} ${styles.navLeft}`}
          onClick={flipPrev}
          disabled={isFirstPage}
          title="Previous Page (ArrowLeft)"
          aria-label="Previous Page"
          type="button"
        >
          <div className={styles.navButton}>
            <ChevronLeft size={24} />
          </div>
        </button>

        {/* Floating next page button */}
        <button
          className={`${styles.navZone} ${styles.navRight}`}
          onClick={flipNext}
          disabled={isLastPage}
          title="Next Page (ArrowRight)"
          aria-label="Next Page"
          type="button"
        >
          <div className={styles.navButton}>
            <ChevronRight size={24} />
          </div>
        </button>

        {/* Side focus controls when zoomed in */}
        {readerZoom > 1 && (
          <div className={styles.sideFocusControls} aria-label="Page focus regions">
            <button
              className={`${styles.sideFocusBtn} ${sideFocus === 'left' ? styles.sideFocusBtnActive : ''}`}
              onClick={() => focusSide('left')}
              type="button"
            >
              Left Page
            </button>
            <button
              className={`${styles.sideFocusBtn} ${sideFocus === 'center' ? styles.sideFocusBtnActive : ''}`}
              onClick={() => focusSide('center')}
              type="button"
            >
              Center
            </button>
            <button
              className={`${styles.sideFocusBtn} ${sideFocus === 'right' ? styles.sideFocusBtnActive : ''}`}
              onClick={() => focusSide('right')}
              type="button"
            >
              Right Page
            </button>
          </div>
        )}

        {/* Page progress badge */}
        <div className={styles.pageBadge}>
          {currentPageIndex === 0
            ? 'Cover (Page 1)'
            : `Pages ${currentPageIndex + 1}–${Math.min(totalPages, currentPageIndex + 2)} of ${totalPages}`}
        </div>
      </div>
    );
  }
);
