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
  invertColors?: boolean;
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
      zoomAnchor,
      onZoomGesture,
      searchPdf,
      goToSearchMatch,
      invertColors = false,
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
    const [sideFocus, setSideFocus] = useState<'left' | 'center' | 'right' | 'custom'>('center');
    const sideFocusRef = useRef<'left' | 'center' | 'right' | 'custom'>('center');
    sideFocusRef.current = sideFocus;
    const pointerPosRef = useRef<{ clientX: number; clientY: number } | null>(null);
    const previousZoomRef = useRef(readerZoom);
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
    const renderedPageZoomsRef = useRef<Map<number, number>>(new Map());
    const renderTasksRef = useRef<Map<number, any>>(new Map());
    const readerZoomRef = useRef(readerZoom);
    readerZoomRef.current = readerZoom;
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
      const isPortrait = viewportW < 680;

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
      async (pageNum: number, forceZoom?: number) => {
        if (!pdfDoc || pageNum < 1 || pageNum > totalPages) return;

        const currentZoom = forceZoom ?? readerZoomRef.current;
        const lastRenderedZoom = renderedPageZoomsRef.current.get(pageNum);
        if (lastRenderedZoom !== undefined && lastRenderedZoom >= currentZoom) return;

        const mount = pageFlipMountRef.current;
        if (!mount) return;

        const canvas = mount.querySelector<HTMLCanvasElement>(`[data-pdf-canvas="${pageNum}"]`);
        if (!canvas) return;

        renderedPageZoomsRef.current.set(pageNum, currentZoom);

        try {
          const page = await pdfDoc.getPage(pageNum);
          const baseViewport = page.getViewport({ scale: 1 });
          const dims = spreadDimensions ?? calculateDimensions();
          if (!dims) return;

          const scale = Math.min(dims.pageWidth / baseViewport.width, dims.pageHeight / baseViewport.height);
          const viewport = page.getViewport({ scale });

          // Render at high-DPI (at least 2.5x supersampling, scaling up with readerZoom)
          // so text is razor-sharp and crystal clear at all zoom levels
          const baseDpr = window.devicePixelRatio || 1;
          const targetDpr = Math.max(2.5, Math.min(4.0, baseDpr * Math.max(1, currentZoom)));

          const targetWidth = Math.max(1, Math.floor(viewport.width * targetDpr));
          const targetHeight = Math.max(1, Math.floor(viewport.height * targetDpr));

          const stagingCanvas = document.createElement('canvas');
          stagingCanvas.width = targetWidth;
          stagingCanvas.height = targetHeight;

          const ctx = stagingCanvas.getContext('2d', { alpha: false });
          if (!ctx) return;

          // Cancel any in-flight task for this page
          const existingTask = renderTasksRef.current.get(pageNum);
          if (existingTask) {
            try {
              existingTask.cancel();
            } catch {}
          }

          const task = page.render({
            canvas: stagingCanvas,
            canvasContext: ctx,
            viewport,
            transform: targetDpr === 1 ? undefined : [targetDpr, 0, 0, targetDpr, 0, 0],
          });
          renderTasksRef.current.set(pageNum, task);
          await task.promise;
          if (renderTasksRef.current.get(pageNum) === task) {
            renderTasksRef.current.delete(pageNum);
          }

          // Double-buffered copy to visible canvas prevents blank flickering
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const visibleCtx = canvas.getContext('2d', { alpha: false });
          if (visibleCtx) {
            visibleCtx.drawImage(stagingCanvas, 0, 0);
          }
        } catch (err: any) {
          if (err?.name === 'RenderingCancelledException') return;
          renderedPageZoomsRef.current.delete(pageNum);
          console.error(`Failed to render page ${pageNum} in double-sided mode:`, err);
        }
      },
      [pdfDoc, totalPages, spreadDimensions, calculateDimensions]
    );

    /**
     * Lazy-renders pages adjacent to the current viewport to conserve resources.
     */
    const renderNearbyPages = useCallback(
      (activePageNum: number, zoom?: number) => {
        const start = Math.max(1, activePageNum - 2);
        const end = Math.min(totalPages, activePageNum + 3);
        for (let p = start; p <= end; p++) {
          void renderPageToCanvas(p, zoom);
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
      renderedPageZoomsRef.current.clear();
      bookContainer.replaceChildren();

      // Create dedicated mount container
      const mountEl = document.createElement('div');
      mountEl.style.width = `${dims.isPortrait ? dims.pageWidth : dims.pageWidth * 2}px`;
      mountEl.style.height = `${dims.pageHeight}px`;
      if (invertColors) {
        mountEl.classList.add(styles.pageInverted);
      }
      pageFlipMountRef.current = mountEl;
      bookContainer.appendChild(mountEl);

      let initialStart = Math.max(0, Math.min(totalPages - 1, currentPageIndex));
      if (!dims.isPortrait && initialStart % 2 !== 0) {
        initialStart -= 1;
      }
      if (initialStart < 0) initialStart = 0;

      // Balance two-page spread with an even number of sheets
      const totalSheets = !dims.isPortrait && totalPages % 2 !== 0 ? totalPages + 1 : totalPages;
      for (let p = 1; p <= totalSheets; p++) {
        const sheet = document.createElement('div');
        sheet.className = styles.pageSheet;
        sheet.dataset.density = 'soft';
        sheet.setAttribute('aria-label', p <= totalPages ? `Page ${p}` : 'End of Book');

        const canvas = document.createElement('canvas');
        canvas.setAttribute('data-pdf-canvas', String(p));
        sheet.appendChild(canvas);

        const isLeft = (p - 1) % 2 === 0;
        const spineShadow = document.createElement('div');
        spineShadow.className = isLeft ? styles.spineShadowLeft : styles.spineShadowRight;
        sheet.appendChild(spineShadow);

        const pageEdge = document.createElement('div');
        pageEdge.className = isLeft ? styles.pageEdgeLeft : styles.pageEdgeRight;
        sheet.appendChild(pageEdge);

        mountEl.appendChild(sheet);
      }

      const pageFlip = new PageFlip(mountEl, {
        width: dims.pageWidth,
        height: dims.pageHeight,
        size: 'fixed',
        minWidth: dims.pageWidth,
        maxWidth: dims.pageWidth,
        minHeight: dims.pageHeight,
        maxHeight: dims.pageHeight,
        drawShadow: true,
        maxShadowOpacity: 0.45,
        showCover: false,
        usePortrait: dims.isPortrait,
        startPage: initialStart,
        flippingTime: 650,
        useMouseEvents: readerZoom <= 1,
        showPageCorners: true,
        disableFlipByClick: true,
        autoSize: false,
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

      // Pre-render pages during drag/fold so user sees both sides dynamically as page turns
      pageFlip.on('changeState', () => {
        const currentIdx = pageFlip.getCurrentPageIndex();
        renderNearbyPages(currentIdx + 1);
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
        renderTasksRef.current.forEach((t) => {
          try {
            t.cancel();
          } catch {}
        });
        renderTasksRef.current.clear();
      };
    }, [pdfDoc, totalPages, calculateDimensions]); // eslint-disable-line react-hooks/exhaustive-deps

    // Re-render nearby pages at higher resolution when zoom level settles
    useEffect(() => {
      if (readerZoom > 1) {
        const timer = window.setTimeout(() => {
          renderNearbyPages(currentPageIndex + 1, readerZoom);
        }, 120);
        return () => window.clearTimeout(timer);
      }
    }, [readerZoom, currentPageIndex, renderNearbyPages]);

    // Apply readerZoom transform, update PageFlip mouse event handling, and anchor zoom
    useEffect(() => {
      const prevZoom = previousZoomRef.current;
      previousZoomRef.current = readerZoom;

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
      } else if (readerZoom > prevZoom && (zoomAnchor || pointerPosRef.current)) {
        // Zooming IN with anchor or pointer: anchor towards pointer
        let px = 0;
        let py = 0;
        let hasPoint = false;
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          if (zoomAnchor && typeof zoomAnchor.viewportX === 'number' && typeof zoomAnchor.viewportY === 'number') {
            px = rect.left + zoomAnchor.viewportX;
            py = rect.top + zoomAnchor.viewportY;
            hasPoint = true;
          } else if (pointerPosRef.current) {
            px = pointerPosRef.current.clientX;
            py = pointerPosRef.current.clientY;
            hasPoint = true;
          }
          if (hasPoint) {
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dx = px - cx;
            const dy = py - cy;
            const factor = readerZoom / Math.max(1, prevZoom) - 1;
            const { maxX, maxY } = calculateMaxPan(readerZoom);
            const targetX = panRef.current.x - dx * factor;
            const targetY = panRef.current.y - dy * factor;
            const clampedX = Math.max(-maxX, Math.min(maxX, targetX));
            const clampedY = Math.max(-maxY, Math.min(maxY, targetY));
            panRef.current = { x: clampedX, y: clampedY };
            setPan({ x: clampedX, y: clampedY });
            setSideFocus('custom');
            if (bookStageRef.current) {
              bookStageRef.current.style.setProperty('--pdf-pan-x', `${clampedX}px`);
              bookStageRef.current.style.setProperty('--pdf-pan-y', `${clampedY}px`);
            }
          }
        }
      } else if (readerZoom < prevZoom) {
        // Zooming OUT: smoothly pull back to center
        const { maxX, maxY } = calculateMaxPan(readerZoom);
        const centerRatio = Math.max(0, (readerZoom - 1.0) / Math.max(0.01, prevZoom - 1.0));
        const targetX = panRef.current.x * centerRatio;
        const targetY = panRef.current.y * centerRatio;
        const clampedX = Math.max(-maxX, Math.min(maxX, targetX));
        const clampedY = Math.max(-maxY, Math.min(maxY, targetY));
        panRef.current = { x: clampedX, y: clampedY };
        setPan({ x: clampedX, y: clampedY });
        if (centerRatio < 0.1) setSideFocus('center');
        if (bookStageRef.current) {
          bookStageRef.current.style.setProperty('--pdf-pan-x', `${clampedX}px`);
          bookStageRef.current.style.setProperty('--pdf-pan-y', `${clampedY}px`);
        }
      } else {
        const currentFocus = sideFocusRef.current;
        if (currentFocus === 'left' || currentFocus === 'right') {
          focusSide(currentFocus, readerZoom);
        } else if (currentFocus === 'center') {
          focusSide('center', readerZoom);
        } else {
          const { maxX, maxY } = calculateMaxPan(readerZoom);
          const clampedX = Math.max(-maxX, Math.min(maxX, panRef.current.x));
          const clampedY = Math.max(-maxY, Math.min(maxY, panRef.current.y));
          panRef.current = { x: clampedX, y: clampedY };
          setPan({ x: clampedX, y: clampedY });
          if (bookStageRef.current) {
            bookStageRef.current.style.setProperty('--pdf-pan-x', `${clampedX}px`);
            bookStageRef.current.style.setProperty('--pdf-pan-y', `${clampedY}px`);
          }
        }
      }
    }, [readerZoom, zoomAnchor, focusSide, calculateMaxPan]);

    // Apply color inversion to mounted PageFlip spread
    useEffect(() => {
      if (pageFlipMountRef.current) {
        if (invertColors) {
          pageFlipMountRef.current.classList.add(styles.pageInverted);
        } else {
          pageFlipMountRef.current.classList.remove(styles.pageInverted);
        }
      }
    }, [invertColors]);

    // Native wheel listener for 2D pan and Ctrl+wheel zooming
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const handleWheelNative = (e: WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
          if (onZoomGesture) {
            e.preventDefault();
            pointerPosRef.current = { clientX: e.clientX, clientY: e.clientY };
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
          setSideFocus('custom');

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
        let targetIdx = Math.max(0, Math.min(totalPages - 1, pageNumber - 1));
        const dims = spreadDimensions ?? calculateDimensions();
        if (dims && !dims.isPortrait && targetIdx % 2 !== 0) {
          targetIdx -= 1;
        }
        if (targetIdx < 0) targetIdx = 0;
        setCurrentPageIndex(targetIdx);
        renderNearbyPages(targetIdx + 1);
        try {
          pageFlipRef.current?.turnToPage(targetIdx);
        } catch {}
      },
      [totalPages, renderNearbyPages, spreadDimensions, calculateDimensions]
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
        previewZoom: (zoom: number, anchor?: PdfZoomAnchor) => {
          const prevZoom = readerZoomRef.current;
          if (bookStageRef.current) {
            bookStageRef.current.style.setProperty(
              '--pdf-reader-zoom',
              String(zoom)
            );
          }
          if (zoom <= 1.001) {
            panRef.current = { x: 0, y: 0 };
            setPan({ x: 0, y: 0 });
            setSideFocus('center');
            if (bookStageRef.current) {
              bookStageRef.current.style.setProperty('--pdf-pan-x', '0px');
              bookStageRef.current.style.setProperty('--pdf-pan-y', '0px');
            }
          } else if (zoom > prevZoom) {
            // Zooming IN: anchor towards pointer if available
            let px = 0;
            let py = 0;
            let hasPoint = false;
            const container = containerRef.current;
            if (container) {
              const rect = container.getBoundingClientRect();
              if (anchor && typeof anchor.viewportX === 'number' && typeof anchor.viewportY === 'number') {
                px = rect.left + anchor.viewportX;
                py = rect.top + anchor.viewportY;
                hasPoint = true;
              } else if (pointerPosRef.current) {
                px = pointerPosRef.current.clientX;
                py = pointerPosRef.current.clientY;
                hasPoint = true;
              }
              if (hasPoint) {
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                const dx = px - cx;
                const dy = py - cy;
                const factor = zoom / Math.max(1, prevZoom) - 1;
                const { maxX, maxY } = calculateMaxPan(zoom);
                const targetX = panRef.current.x - dx * factor;
                const targetY = panRef.current.y - dy * factor;
                const clampedX = Math.max(-maxX, Math.min(maxX, targetX));
                const clampedY = Math.max(-maxY, Math.min(maxY, targetY));
                panRef.current = { x: clampedX, y: clampedY };
                setPan({ x: clampedX, y: clampedY });
                setSideFocus('custom');
                if (bookStageRef.current) {
                  bookStageRef.current.style.setProperty('--pdf-pan-x', `${clampedX}px`);
                  bookStageRef.current.style.setProperty('--pdf-pan-y', `${clampedY}px`);
                }
              } else {
                const { maxX, maxY } = calculateMaxPan(zoom);
                const clampedX = Math.max(-maxX, Math.min(maxX, panRef.current.x));
                const clampedY = Math.max(-maxY, Math.min(maxY, panRef.current.y));
                panRef.current = { x: clampedX, y: clampedY };
                setPan({ x: clampedX, y: clampedY });
                if (bookStageRef.current) {
                  bookStageRef.current.style.setProperty('--pdf-pan-x', `${clampedX}px`);
                  bookStageRef.current.style.setProperty('--pdf-pan-y', `${clampedY}px`);
                }
              }
            }
          } else {
            // Zooming OUT (zoom < prevZoom): smoothly pull back to center (0, 0)
            const { maxX, maxY } = calculateMaxPan(zoom);
            const centerRatio = Math.max(0, (zoom - 1.0) / Math.max(0.01, prevZoom - 1.0));
            const targetX = panRef.current.x * centerRatio;
            const targetY = panRef.current.y * centerRatio;
            const clampedX = Math.max(-maxX, Math.min(maxX, targetX));
            const clampedY = Math.max(-maxY, Math.min(maxY, targetY));
            panRef.current = { x: clampedX, y: clampedY };
            setPan({ x: clampedX, y: clampedY });
            if (centerRatio < 0.1) setSideFocus('center');
            if (bookStageRef.current) {
              bookStageRef.current.style.setProperty('--pdf-pan-x', `${clampedX}px`);
              bookStageRef.current.style.setProperty('--pdf-pan-y', `${clampedY}px`);
            }
          }
          readerZoomRef.current = zoom;
        },
        search: async (query: string) => {
          return searchPdf ? searchPdf(query) : [];
        },
        goToSearchMatch: async (pageNumber: number, query: string, matchIndex: number) => {
          turnToPage(pageNumber);
          if (goToSearchMatch) await goToSearchMatch(pageNumber, query, matchIndex);
        },
      }),
      [turnToPage, totalPages, searchPdf, goToSearchMatch, calculateMaxPan]
    );

    const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.button !== 1) return;
      const target = e.target as HTMLElement;
      if (target.closest(`.${styles.navZone}`) || target.closest(`.${styles.sideFocusControls}`)) return;

      pointerPosRef.current = { clientX: e.clientX, clientY: e.clientY };
      isMouseDownRef.current = true;
      hasDraggedRef.current = false;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      panStartRef.current = { ...panRef.current };
    }, []);

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        pointerPosRef.current = { clientX: e.clientX, clientY: e.clientY };
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
            setSideFocus('custom');
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

    const isPortrait = spreadDimensions?.isPortrait ?? false;
    const isFirstPage = currentPageIndex <= 0;
    const isLastPage = currentPageIndex >= totalPages - (isPortrait ? 1 : 2);

    return (
      <div
        ref={containerRef}
        className={`${styles.container} ${invertColors ? styles.containerInverted : ''} ${readerZoom > 1 ? styles.isZoomed : ''} ${isPanning ? styles.isPanning : ''}`}
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
          {spreadDimensions?.isPortrait
            ? `Page ${currentPageIndex + 1} of ${totalPages}`
            : `Pages ${currentPageIndex + 1}–${Math.min(totalPages, currentPageIndex + 2)} of ${totalPages}`}
        </div>
      </div>
    );
  }
);
