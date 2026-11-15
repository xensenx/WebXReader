/**
 * Double-sided Comic Reader (CBZ, CBR, CB7) powered by PageFlip.
 *
 * Presents comic books as realistic facing spreads with 3D page curl,
 * interactive 2D pointer zoom/pan, LTR/RTL reading direction support,
 * and high-resolution image rendering.
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
import type { ComicReadingDirection } from '../../types/book';
import type { CbzReaderHandle, CbzZoomAnchor } from './CbzReader';
import styles from './ComicDoubleSidedReader.module.css';

interface PageSize {
  width: number;
  height: number;
}

export interface ComicDoubleSidedReaderProps {
  totalPages: number;
  initialPage?: number;
  readingDirection?: ComicReadingDirection;
  loadUrl: (index: number) => Promise<string | undefined>;
  pageSizes: Record<number, PageSize>;
  onProgressUpdate: (chapterId: string, progressFraction: number, pageIndex: number) => void;
  onToggleControls?: () => void;
  readerZoom?: number;
  zoomAnchor?: CbzZoomAnchor;
  onZoomGesture?: (deltaY: number, point?: { x: number; y: number }) => void;
  invertColors?: boolean;
}

/**
 * Double-sided Comic reader presenting facing spreads with 3D paper curl and 2D zoom/pan.
 */
export const ComicDoubleSidedReader = forwardRef<CbzReaderHandle, ComicDoubleSidedReaderProps>(
  function ComicDoubleSidedReader(
    {
      totalPages,
      initialPage = 1,
      readingDirection = 'ltr',
      loadUrl,
      pageSizes,
      onProgressUpdate,
      onToggleControls,
      readerZoom = 1,
      zoomAnchor,
      onZoomGesture,
      invertColors = false,
    },
    ref
  ) {
    const isRtl = readingDirection === 'rtl';
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
    const loadedPagesRef = useRef<Set<number>>(new Set());
    const readerZoomRef = useRef(readerZoom);
    readerZoomRef.current = readerZoom;
    const onProgressUpdateRef = useRef(onProgressUpdate);
    onProgressUpdateRef.current = onProgressUpdate;

    /**
     * Maps spread sheet index to real comic page number taking reading direction into account.
     */
    const sheetIndexToPageNumber = useCallback(
      (sheetIdx: number, isPortrait: boolean): number => {
        if (isPortrait) return sheetIdx + 1;
        if (!isRtl) return sheetIdx + 1;

        // In RTL Manga:
        // Sheet 0 (Left) = Page 2, Sheet 1 (Right) = Page 1
        // Sheet 2 (Left) = Page 4, Sheet 3 (Right) = Page 3
        const spreadBase = Math.floor(sheetIdx / 2) * 2;
        const isLeftSheet = sheetIdx % 2 === 0;
        return isLeftSheet ? spreadBase + 2 : spreadBase + 1;
      },
      [isRtl]
    );

    /**
     * Maps real comic page number to spread sheet index taking reading direction into account.
     */
    const pageNumberToSheetIndex = useCallback(
      (pageNumber: number, isPortrait: boolean): number => {
        if (isPortrait) return pageNumber - 1;
        if (!isRtl) return pageNumber - 1;

        // In RTL Manga:
        // Page 1 -> Sheet 1 (Right), Page 2 -> Sheet 0 (Left)
        // Page 3 -> Sheet 3 (Right), Page 4 -> Sheet 2 (Left)
        const spreadBase = Math.floor((pageNumber - 1) / 2) * 2;
        const isOdd = pageNumber % 2 !== 0;
        return isOdd ? spreadBase + 1 : spreadBase;
      },
      [isRtl]
    );

    /**
     * Calculates single-page and two-page spread dimensions based on viewport bounds.
     */
    const calculateDimensions = useCallback(() => {
      const container = containerRef.current;
      if (!container) return null;

      const viewportW = container.clientWidth || window.innerWidth;
      const viewportH = container.clientHeight || window.innerHeight;

      const sampleSize = pageSizes[1] ?? { width: 800, height: 1200 };
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
     * Loads image for a given page sheet and renders it into the sheet's image element.
     */
    const renderPageImage = useCallback(
      async (pageNum: number) => {
        if (pageNum < 1 || pageNum > totalPages) return;
        const mount = pageFlipMountRef.current;
        if (!mount) return;

        const img = mount.querySelector<HTMLImageElement>(`[data-comic-page-img="${pageNum}"]`);
        if (!img) return;

        loadedPagesRef.current.add(pageNum);

        try {
          const url = await loadUrl(pageNum - 1);
          if (url && img.src !== url) {
            img.src = url;
            img.style.display = 'block';
          }
        } catch (err) {
          console.error(`Failed to load comic page ${pageNum} image:`, err);
        }
      },
      [loadUrl, totalPages]
    );

    /**
     * Lazy-loads images for pages adjacent to current viewport to conserve resources.
     * Pages far outside the nearby buffer are unloaded to prevent unbounded memory growth.
     */
    const renderNearbyPages = useCallback(
      (activePageNum: number) => {
        const start = Math.max(1, activePageNum - 2);
        const end = Math.min(totalPages, activePageNum + 3);
        const mount = pageFlipMountRef.current;

        // Clear distant images to release GPU memory
        loadedPagesRef.current.forEach((p) => {
          if (p >= start - 2 && p <= end + 2) return;
          const distantImg = mount?.querySelector<HTMLImageElement>(`[data-comic-page-img="${p}"]`);
          if (distantImg) {
            distantImg.src = '';
            distantImg.style.display = 'none';
          }
          loadedPagesRef.current.delete(p);
        });

        for (let p = start; p <= end; p++) {
          void renderPageImage(p);
        }
      },
      [renderPageImage, totalPages]
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
          bookStageRef.current.style.setProperty('--comic-pan-x', `${targetX}px`);
          bookStageRef.current.style.setProperty('--comic-pan-y', '0px');
        }
      },
      [calculateMaxPan, readerZoom]
    );

    // Mount PageFlip instance when dimensions and container are ready
    useEffect(() => {
      const bookContainer = bookContainerRef.current;
      if (!bookContainer || totalPages < 1) return;

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
      loadedPagesRef.current.clear();
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

      const mappedStartSheet = pageNumberToSheetIndex(currentPageIndex + 1, dims.isPortrait);
      let initialStart = Math.max(0, Math.min(totalPages - 1, mappedStartSheet));
      if (!dims.isPortrait && initialStart % 2 !== 0) {
        initialStart -= 1;
      }
      if (initialStart < 0) initialStart = 0;

      // Balance two-page spread with an even number of sheets
      const totalSheets = !dims.isPortrait && totalPages % 2 !== 0 ? totalPages + 1 : totalPages;
      for (let s = 0; s < totalSheets; s++) {
        const pageNum = sheetIndexToPageNumber(s, dims.isPortrait);
        const sheet = document.createElement('div');
        sheet.className = styles.pageSheet;
        sheet.dataset.density = 'soft';
        sheet.setAttribute('aria-label', pageNum <= totalPages ? `Page ${pageNum}` : 'End of Book');

        if (pageNum <= totalPages) {
          const img = document.createElement('img');
          img.className = styles.comicPageImg;
          img.setAttribute('data-comic-page-img', String(pageNum));
          img.alt = `Comic Page ${pageNum}`;
          img.loading = 'lazy';
          img.decoding = 'async';
          sheet.appendChild(img);
        } else {
          const placeholder = document.createElement('div');
          placeholder.className = styles.pagePlaceholder;
          placeholder.textContent = 'End of Comic';
          sheet.appendChild(placeholder);
        }

        const isLeft = s % 2 === 0;
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
        flippingTime: 600,
        useMouseEvents: readerZoom <= 1,
        showPageCorners: true,
        disableFlipByClick: true,
        autoSize: false,
      });

      pageFlipRef.current = pageFlip;
      pageFlip.loadFromHTML(mountEl.querySelectorAll(`.${styles.pageSheet}`));

      pageFlip.on('flip', (e) => {
        const newSheetIdx = typeof e.data === 'number' ? e.data : pageFlip.getCurrentPageIndex();
        const resolvedPageNum = sheetIndexToPageNumber(newSheetIdx, dims.isPortrait);
        const resolvedPageIndex = Math.max(0, Math.min(totalPages - 1, resolvedPageNum - 1));
        setCurrentPageIndex(resolvedPageIndex);
        const fraction = totalPages > 1 ? resolvedPageIndex / (totalPages - 1) : 0;
        onProgressUpdateRef.current(String(resolvedPageNum), Math.min(1, Math.max(0, fraction)), resolvedPageIndex);
        renderNearbyPages(resolvedPageNum);
      });

      const initialPageNum = sheetIndexToPageNumber(initialStart, dims.isPortrait);
      renderNearbyPages(initialPageNum);

      return () => {
        try {
          pageFlip.destroy();
        } catch {}
        pageFlipRef.current = null;
        mountEl.remove();
      };
    }, [
      totalPages,
      calculateDimensions,
      sheetIndexToPageNumber,
      pageNumberToSheetIndex,
      renderNearbyPages,
      invertColors,
    ]);

    // Apply readerZoom transform, update PageFlip mouse event handling, and anchor zoom
    useEffect(() => {
      const prevZoom = previousZoomRef.current;
      previousZoomRef.current = readerZoom;

      if (bookStageRef.current) {
        bookStageRef.current.style.setProperty('--comic-reader-zoom', String(readerZoom));
      }

      if (pageFlipRef.current) {
        try {
          const pf = pageFlipRef.current as any;
          const flipSettings = pf.getSettings?.();
          if (flipSettings) {
            flipSettings.useMouseEvents = readerZoom <= 1;
          }
        } catch {}
      }

      if (readerZoom <= 1) {
        setPan({ x: 0, y: 0 });
        panRef.current = { x: 0, y: 0 };
        setSideFocus('center');
        if (bookStageRef.current) {
          bookStageRef.current.style.setProperty('--comic-pan-x', '0px');
          bookStageRef.current.style.setProperty('--comic-pan-y', '0px');
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
              bookStageRef.current.style.setProperty('--comic-pan-x', `${clampedX}px`);
              bookStageRef.current.style.setProperty('--comic-pan-y', `${clampedY}px`);
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
          bookStageRef.current.style.setProperty('--comic-pan-x', `${clampedX}px`);
          bookStageRef.current.style.setProperty('--comic-pan-y', `${clampedY}px`);
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
            bookStageRef.current.style.setProperty('--comic-pan-x', `${clampedX}px`);
            bookStageRef.current.style.setProperty('--comic-pan-y', `${clampedY}px`);
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
        } else if (readerZoomRef.current > 1) {
          e.preventDefault();
          const { maxX, maxY } = calculateMaxPan(readerZoomRef.current);
          const dx = e.shiftKey ? -e.deltaY : -e.deltaX;
          const dy = e.shiftKey ? 0 : -e.deltaY;
          const targetX = panRef.current.x + dx;
          const targetY = panRef.current.y + dy;
          const clampedX = Math.max(-maxX, Math.min(maxX, targetX));
          const clampedY = Math.max(-maxY, Math.min(maxY, targetY));
          panRef.current = { x: clampedX, y: clampedY };
          setPan({ x: clampedX, y: clampedY });
          setSideFocus('custom');
          if (bookStageRef.current) {
            bookStageRef.current.style.setProperty('--comic-pan-x', `${clampedX}px`);
            bookStageRef.current.style.setProperty('--comic-pan-y', `${clampedY}px`);
          }
        }
      };

      container.addEventListener('wheel', handleWheelNative, { passive: false });
      return () => {
        container.removeEventListener('wheel', handleWheelNative);
      };
    }, [onZoomGesture, calculateMaxPan]);

    // Imperative handle for parent control
    useImperativeHandle(
      ref,
      () => ({
        goToPage: (pageNum: number) => {
          if (!pageFlipRef.current) return;
          const isPortrait = spreadDimensions?.isPortrait ?? false;
          const targetSheet = pageNumberToSheetIndex(pageNum, isPortrait);
          try {
            pageFlipRef.current.flip(targetSheet);
          } catch {
            try {
              pageFlipRef.current.turnToPage(targetSheet);
            } catch {}
          }
        },
        goToProgress: (fraction: number) => {
          if (!pageFlipRef.current || totalPages <= 1) return;
          const clamped = Math.min(1, Math.max(0, fraction));
          const pageNum = Math.round(clamped * (totalPages - 1)) + 1;
          const isPortrait = spreadDimensions?.isPortrait ?? false;
          const targetSheet = pageNumberToSheetIndex(pageNum, isPortrait);
          try {
            pageFlipRef.current.turnToPage(targetSheet);
          } catch {}
        },
        previewZoom: (zoom: number, anchor?: CbzZoomAnchor) => {
          if (bookStageRef.current) {
            bookStageRef.current.style.setProperty('--comic-reader-zoom', String(zoom));
            if (zoom <= 1.0) {
              bookStageRef.current.style.setProperty('--comic-pan-x', '0px');
              bookStageRef.current.style.setProperty('--comic-pan-y', '0px');
              panRef.current = { x: 0, y: 0 };
              setPan({ x: 0, y: 0 });
              setSideFocus('center');
            } else if (anchor && containerRef.current) {
              const rect = containerRef.current.getBoundingClientRect();
              const px = rect.left + anchor.viewportX;
              const py = rect.top + anchor.viewportY;
              const cx = rect.left + rect.width / 2;
              const cy = rect.top + rect.height / 2;
              const dx = px - cx;
              const dy = py - cy;
              const factor = zoom - 1;
              const { maxX, maxY } = calculateMaxPan(zoom);
              const targetX = -dx * factor;
              const targetY = -dy * factor;
              const clampedX = Math.max(-maxX, Math.min(maxX, targetX));
              const clampedY = Math.max(-maxY, Math.min(maxY, targetY));
              panRef.current = { x: clampedX, y: clampedY };
              setPan({ x: clampedX, y: clampedY });
              setSideFocus('custom');
              bookStageRef.current.style.setProperty('--comic-pan-x', `${clampedX}px`);
              bookStageRef.current.style.setProperty('--comic-pan-y', `${clampedY}px`);
            }
          }
        },
        getCurrentPage: () => currentPageIndex + 1,
        getTotalPages: () => totalPages,
      }),
      [totalPages, spreadDimensions, pageNumberToSheetIndex, calculateMaxPan, currentPageIndex]
    );

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      pointerPosRef.current = { clientX: e.clientX, clientY: e.clientY };
      if (readerZoom <= 1) return;
      isMouseDownRef.current = true;
      hasDraggedRef.current = false;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      panStartRef.current = { ...panRef.current };
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      pointerPosRef.current = { clientX: e.clientX, clientY: e.clientY };
      if (!isMouseDownRef.current || readerZoom <= 1) return;

      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;

      if (!hasDraggedRef.current && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        hasDraggedRef.current = true;
        setIsPanning(true);
        if (bookStageRef.current) {
          bookStageRef.current.classList.add(styles.isPanningStage);
        }
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {}
      }

      if (hasDraggedRef.current) {
        const { maxX, maxY } = calculateMaxPan(readerZoom);
        const targetX = panStartRef.current.x + dx;
        const targetY = panStartRef.current.y + dy;
        const clampedX = Math.max(-maxX, Math.min(maxX, targetX));
        const clampedY = Math.max(-maxY, Math.min(maxY, targetY));
        panRef.current = { x: clampedX, y: clampedY };
        setPan({ x: clampedX, y: clampedY });
        setSideFocus('custom');

        if (bookStageRef.current) {
          bookStageRef.current.style.setProperty('--comic-pan-x', `${clampedX}px`);
          bookStageRef.current.style.setProperty('--comic-pan-y', `${clampedY}px`);
        }
      }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isMouseDownRef.current) return;
      isMouseDownRef.current = false;
      setIsPanning(false);

      if (bookStageRef.current) {
        bookStageRef.current.classList.remove(styles.isPanningStage);
      }

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
    };

    const handlePrev = () => {
      if (!pageFlipRef.current) return;
      if (isRtl) {
        pageFlipRef.current.flipNext();
      } else {
        pageFlipRef.current.flipPrev();
      }
    };

    const handleNext = () => {
      if (!pageFlipRef.current) return;
      if (isRtl) {
        pageFlipRef.current.flipPrev();
      } else {
        pageFlipRef.current.flipNext();
      }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      if (!pageFlipRef.current) return;

      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        if (isRtl) {
          pageFlipRef.current.flipNext();
        } else {
          pageFlipRef.current.flipPrev();
        }
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        if (isRtl) {
          pageFlipRef.current.flipPrev();
        } else {
          pageFlipRef.current.flipNext();
        }
      } else if (e.key === 'Home') {
        e.preventDefault();
        const isPortrait = spreadDimensions?.isPortrait ?? false;
        pageFlipRef.current.turnToPage(pageNumberToSheetIndex(1, isPortrait));
      } else if (e.key === 'End') {
        e.preventDefault();
        const isPortrait = spreadDimensions?.isPortrait ?? false;
        pageFlipRef.current.turnToPage(pageNumberToSheetIndex(totalPages, isPortrait));
      }
    };

    const activePage = currentPageIndex + 1;
    const isPortrait = spreadDimensions?.isPortrait ?? false;
    let badgeText = `Page ${activePage} of ${totalPages}`;
    if (!isPortrait && totalPages > 1) {
      const spreadBase = Math.floor(currentPageIndex / 2) * 2 + 1;
      const secondPage = spreadBase + 1 <= totalPages ? spreadBase + 1 : null;
      badgeText = secondPage ? `Pages ${spreadBase}–${secondPage} of ${totalPages}` : `Page ${spreadBase} of ${totalPages}`;
    }

    return (
      <div
        ref={containerRef}
        className={`${styles.container} ${invertColors ? styles.containerInverted : ''} ${readerZoom > 1 ? styles.isZoomed : ''} ${isPanning ? styles.isPanning : ''}`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        autoFocus
        role="region"
        aria-label="Double-sided Comic Viewer"
      >
        <div className={styles.pageBadge} aria-live="polite">
          {badgeText}
        </div>

        <button
          className={`${styles.navZone} ${styles.navLeft}`}
          onClick={handlePrev}
          aria-label={isRtl ? 'Next page' : 'Previous page'}
          type="button"
        >
          <div className={styles.navButton}>
            <ChevronLeft size={24} />
          </div>
        </button>

        <button
          className={`${styles.navZone} ${styles.navRight}`}
          onClick={handleNext}
          aria-label={isRtl ? 'Previous page' : 'Next page'}
          type="button"
        >
          <div className={styles.navButton}>
            <ChevronRight size={24} />
          </div>
        </button>

        {readerZoom > 1 && !isPortrait && (
          <div className={styles.sideFocusControls} role="group" aria-label="Spread camera focus">
            <button
              type="button"
              className={`${styles.sideFocusBtn} ${sideFocus === 'left' ? styles.sideFocusBtnActive : ''}`}
              onClick={() => focusSide('left')}
              aria-label="Focus on left page"
            >
              Left
            </button>
            <button
              type="button"
              className={`${styles.sideFocusBtn} ${sideFocus === 'center' ? styles.sideFocusBtnActive : ''}`}
              onClick={() => focusSide('center')}
              aria-label="Focus on spread center"
            >
              Center
            </button>
            <button
              type="button"
              className={`${styles.sideFocusBtn} ${sideFocus === 'right' ? styles.sideFocusBtnActive : ''}`}
              onClick={() => focusSide('right')}
              aria-label="Focus on right page"
            >
              Right
            </button>
          </div>
        )}

        <div ref={bookStageRef} className={styles.bookStage}>
          <div
            ref={bookContainerRef}
            className={styles.bookContainer}
            onClick={() => {
              if (hasDraggedRef.current) return;
              onToggleControls?.();
            }}
          />
        </div>
      </div>
    );
  }
);
