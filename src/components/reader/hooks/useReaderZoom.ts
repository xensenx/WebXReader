/**
 * Reader Zoom and Viewport Gestures Hook.
 *
 * Encapsulates trackpad pinch, mouse wheel, anchor point tracking,
 * continuous zoom clamping, matrix preview dispatch, and RAF queues.
 */

import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import {
  isFixedLayout,
  type PdfZoomAnchor,
  type EpubReaderHandle,
  type PdfReaderHandle,
  type CbzReaderHandle,
  type DjvuReaderHandle,
  type ImageReaderHandle,
} from '../../../formats';

export const MIN_READER_ZOOM = 0.5;
export const MAX_READER_ZOOM = 3;
export const MIN_PDF_ZOOM = 0.24;
export const MAX_PDF_ZOOM = 8;
export const MAX_EPUB_ZOOM = 8;

export type ReaderZoomAnchor = PdfZoomAnchor & {
  epubSectionIndex?: number;
  epubSectionX?: number;
  epubSectionY?: number;
};

export function clampReaderZoom(value: number, fixedLayout: boolean, continuous = false): number {
  const min = fixedLayout ? MIN_PDF_ZOOM : MIN_READER_ZOOM;
  const max = continuous ? MAX_EPUB_ZOOM : fixedLayout ? MAX_PDF_ZOOM : MAX_READER_ZOOM;
  // Keep PDF and EPUB gesture zoom continuous. Fine EPUB precision avoids
  // visible steps during trackpad zoom at higher magnification.
  const precision = continuous ? 1000 : 100;
  const zoom = fixedLayout ? value : Math.round(value * precision) / precision;
  return Math.min(max, Math.max(min, zoom));
}

export function getWheelDeltaPixels(event: WheelEvent, viewport?: HTMLElement | null): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * (viewport?.clientHeight || window.innerHeight);
  return event.deltaY;
}

export function getTouchZoomGesture(touches: TouchList) {
  const first = touches[0];
  const second = touches[1];
  if (!first || !second) return null;
  return {
    distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
    point: {
      x: (first.clientX + second.clientX) / 2,
      y: (first.clientY + second.clientY) / 2,
    },
  };
}

export interface UseReaderZoomOptions {
  sourceFormat?: string;
  readerStageRef: React.RefObject<HTMLDivElement | null>;
  loading?: boolean;
  previewRefs?: {
    epubReaderRef?: React.RefObject<EpubReaderHandle | null>;
    pdfReaderRef?: React.RefObject<PdfReaderHandle | null>;
    cbzReaderRef?: React.RefObject<CbzReaderHandle | null>;
    djvuReaderRef?: React.RefObject<DjvuReaderHandle | null>;
    imageReaderRef?: React.RefObject<ImageReaderHandle | null>;
  };
}

export interface UseReaderZoomReturn {
  readerZoom: number;
  readerZoomRef: React.MutableRefObject<number>;
  zoomAnchor: ReaderZoomAnchor | undefined;
  zoomLabelRef: React.RefObject<HTMLSpanElement | null>;
  zoomBy: (factor: number, point?: { x: number; y: number }) => void;
  zoomTo: (targetZoom: number, point?: { x: number; y: number }) => void;
  resetZoom: () => void;
  queueWheelZoom: (deltaY: number, point?: { x: number; y: number }) => void;
}

export function useReaderZoom({
  sourceFormat,
  readerStageRef,
  loading = false,
  previewRefs,
}: UseReaderZoomOptions): UseReaderZoomReturn {
  const [readerZoom, setReaderZoom] = useState(1);
  const readerZoomRef = useRef(1);
  const [zoomAnchor, setZoomAnchor] = useState<ReaderZoomAnchor | undefined>(undefined);
  const pdfZoomAnchorRef = useRef<ReaderZoomAnchor | undefined>(undefined);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const previousReaderZoomRef = useRef(readerZoom);
  const zoomAnchorIdRef = useRef(0);
  const wheelZoomDeltaRef = useRef(0);
  const wheelZoomPointRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const wheelZoomFrameRef = useRef<number | null>(null);
  const lastWheelZoomAtRef = useRef(0);
  const pdfZoomCommitTimerRef = useRef<number | null>(null);
  const touchZoomStartRef = useRef<{ distance: number; zoom: number } | null>(null);
  const touchZoomPendingRef = useRef<{ zoom: number; point: { x: number; y: number } } | null>(null);
  const touchZoomFrameRef = useRef<number | null>(null);
  const lastTouchZoomAtRef = useRef(0);

  const captureZoomAnchor = useCallback((clientX?: number, clientY?: number) => {
    const stage = readerStageRef.current;
    const viewport = stage?.querySelector<HTMLElement>('[data-reader-viewport]');
    if (!stage || !viewport) return undefined;

    const viewportRect = viewport.getBoundingClientRect();
    const x = clientX === undefined
      ? viewportRect.left + viewportRect.width / 2
      : clientX;
    const y = clientY === undefined
      ? viewportRect.top + viewportRect.height / 2
      : clientY;
    const viewportX = Math.max(0, Math.min(viewport.clientWidth, x - viewportRect.left));
    const viewportY = Math.max(0, Math.min(viewport.clientHeight, y - viewportRect.top));
    const hitPage = (
      typeof document.elementFromPoint === 'function'
        ? (document.elementFromPoint(x, y) as HTMLElement | null)
        : null
    )?.closest<HTMLElement>(
      '[data-pdf-page], [data-cbz-page], [data-djvu-page], [data-image-page]'
    );
    let page = hitPage && stage.contains(hitPage) ? hitPage : null;
    if (!page && viewport) {
      const pages = Array.from(viewport.querySelectorAll<HTMLElement>('[data-pdf-page], [data-cbz-page], [data-djvu-page], [data-image-page]'));
      for (const p of pages) {
        const rect = p.getBoundingClientRect();
        if (y >= rect.top && y <= rect.bottom) {
          page = p;
          break;
        }
      }
      if (!page && pages.length > 0) {
        page = pages.reduce((closest, curr) => {
          const currDist = Math.abs(curr.getBoundingClientRect().top - y);
          const closestDist = Math.abs(closest.getBoundingClientRect().top - y);
          return currDist < closestDist ? curr : closest;
        }, pages[0]);
      }
    }
    const pageRect = page?.getBoundingClientRect();
    const hitSection =
      sourceFormat === 'epub' && typeof document.elementFromPoint === 'function'
        ? (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-epub-section-index]')
        : null;
    const section = hitSection && stage.contains(hitSection) ? hitSection : null;
    const sectionRect = section?.getBoundingClientRect();

    return {
      id: ++zoomAnchorIdRef.current,
      pageNumber: page
        ? Number(page.dataset.pdfPage || page.dataset.cbzPage || page.dataset.djvuPage || page.dataset.imagePage)
        : undefined,
      pageX: pageRect?.width
        ? Math.max(0, Math.min(1, (x - pageRect.left) / pageRect.width))
        : undefined,
      pageY: pageRect?.height
        ? Math.max(0, Math.min(1, (y - pageRect.top) / pageRect.height))
        : undefined,
      epubSectionIndex: section ? Number(section.dataset.epubSectionIndex) : undefined,
      epubSectionX: sectionRect?.width
        ? Math.max(0, Math.min(1, (x - sectionRect.left) / sectionRect.width))
        : undefined,
      epubSectionY: sectionRect?.height
        ? Math.max(0, Math.min(1, (y - sectionRect.top) / sectionRect.height))
        : undefined,
      viewportX,
      viewportY,
      scrollRatioX: (viewport.scrollLeft + viewportX) / Math.max(1, viewport.scrollWidth),
      scrollRatioY: (viewport.scrollTop + viewportY) / Math.max(1, viewport.scrollHeight),
    } satisfies ReaderZoomAnchor;
  }, [readerStageRef, sourceFormat]);

  const updateZoom = useCallback((nextZoom: number, fixedLayout: boolean, anchor?: ReaderZoomAnchor) => {
    if (Math.abs(nextZoom - readerZoomRef.current) < 1e-7) return;
    readerZoomRef.current = nextZoom;
    if (!fixedLayout || sourceFormat === 'pdf') {
      if (anchor) {
        pdfZoomAnchorRef.current = anchor;
        setZoomAnchor(anchor);
      }
      if (sourceFormat === 'epub') {
        previewRefs?.epubReaderRef?.current?.previewZoom(nextZoom, anchor ?? captureZoomAnchor());
      }
      setReaderZoom(nextZoom);
      if (zoomLabelRef.current) {
        const percent = Math.round(nextZoom * 100);
        zoomLabelRef.current.textContent = `${percent}%`;
        zoomLabelRef.current.setAttribute('aria-label', `Book zoom ${percent} percent`);
      }
      return;
    }

    if (anchor) pdfZoomAnchorRef.current = anchor;
    const activeAnchor = pdfZoomAnchorRef.current ?? captureZoomAnchor();
    if (activeAnchor) {
      pdfZoomAnchorRef.current = activeAnchor;
      previewRefs?.pdfReaderRef?.current?.previewZoom(nextZoom, activeAnchor);
      previewRefs?.cbzReaderRef?.current?.previewZoom(nextZoom, activeAnchor);
      previewRefs?.djvuReaderRef?.current?.previewZoom(nextZoom, activeAnchor);
      previewRefs?.imageReaderRef?.current?.previewZoom(nextZoom, activeAnchor);
    }
    if (zoomLabelRef.current) {
      const percent = Math.round(nextZoom * 100);
      zoomLabelRef.current.textContent = `${percent}%`;
      zoomLabelRef.current.setAttribute('aria-label', `Book zoom ${percent} percent`);
    }

    if (pdfZoomCommitTimerRef.current !== null) {
      window.clearTimeout(pdfZoomCommitTimerRef.current);
    }
    pdfZoomCommitTimerRef.current = window.setTimeout(() => {
      setZoomAnchor(pdfZoomAnchorRef.current);
      setReaderZoom(readerZoomRef.current);
      pdfZoomCommitTimerRef.current = null;
    }, 120);
  }, [captureZoomAnchor, previewRefs, sourceFormat]);

  const zoomBy = useCallback((factor: number, point?: { x: number; y: number }) => {
    const isZoomingOut = factor < 1;
    const stage = readerStageRef.current;
    const viewport = stage?.querySelector<HTMLElement>('[data-reader-viewport]');
    const viewportRect = viewport?.getBoundingClientRect();
    const effectivePoint = isZoomingOut && viewportRect
      ? { x: viewportRect.left + viewportRect.width / 2, y: viewportRect.top + viewportRect.height / 2 }
      : point;
    const anchor = captureZoomAnchor(effectivePoint?.x, effectivePoint?.y);
    const fixedLayout = isFixedLayout(sourceFormat);
    updateZoom(clampReaderZoom(readerZoomRef.current * factor, fixedLayout, sourceFormat === 'epub'), fixedLayout, anchor);
  }, [sourceFormat, captureZoomAnchor, updateZoom, readerStageRef]);

  const zoomTo = useCallback((targetZoom: number, point?: { x: number; y: number }) => {
    const isZoomingOut = targetZoom < readerZoomRef.current;
    const stage = readerStageRef.current;
    const viewport = stage?.querySelector<HTMLElement>('[data-reader-viewport]');
    const viewportRect = viewport?.getBoundingClientRect();
    const effectivePoint = isZoomingOut && viewportRect
      ? { x: viewportRect.left + viewportRect.width / 2, y: viewportRect.top + viewportRect.height / 2 }
      : point;
    const anchor = captureZoomAnchor(effectivePoint?.x, effectivePoint?.y);
    const fixedLayout = isFixedLayout(sourceFormat);
    updateZoom(clampReaderZoom(targetZoom, fixedLayout, sourceFormat === 'epub'), fixedLayout, anchor);
  }, [sourceFormat, captureZoomAnchor, updateZoom, readerStageRef]);

  const resetZoom = useCallback(() => {
    const epubAnchor = sourceFormat === 'epub' ? captureZoomAnchor() : undefined;
    readerZoomRef.current = 1;
    setZoomAnchor(epubAnchor);
    pdfZoomAnchorRef.current = undefined;
    wheelZoomDeltaRef.current = 0;
    wheelZoomPointRef.current = undefined;
    lastWheelZoomAtRef.current = 0;
    if (wheelZoomFrameRef.current !== null) {
      cancelAnimationFrame(wheelZoomFrameRef.current);
      wheelZoomFrameRef.current = null;
    }
    touchZoomStartRef.current = null;
    touchZoomPendingRef.current = null;
    lastTouchZoomAtRef.current = 0;
    if (touchZoomFrameRef.current !== null) {
      cancelAnimationFrame(touchZoomFrameRef.current);
      touchZoomFrameRef.current = null;
    }
    if (pdfZoomCommitTimerRef.current !== null) {
      window.clearTimeout(pdfZoomCommitTimerRef.current);
      pdfZoomCommitTimerRef.current = null;
    }
    setReaderZoom(1);
    if (sourceFormat === 'epub') {
      previewRefs?.epubReaderRef?.current?.previewZoom(1, epubAnchor);
    }
    if (zoomLabelRef.current) {
      zoomLabelRef.current.textContent = '100%';
      zoomLabelRef.current.setAttribute('aria-label', 'Book zoom 100 percent');
    }
  }, [captureZoomAnchor, previewRefs, sourceFormat]);

  const queueWheelZoom = useCallback((deltaY: number, point?: { x: number; y: number }) => {
    const isBufferedFormat = sourceFormat !== 'pdf' && isFixedLayout(sourceFormat);
    wheelZoomDeltaRef.current += deltaY;
    if (point) wheelZoomPointRef.current = point;
    if (wheelZoomFrameRef.current !== null) return;

    const applyPendingZoom = () => {
      const elapsed = performance.now() - lastWheelZoomAtRef.current;
      if (!isBufferedFormat && wheelZoomDeltaRef.current !== 0 && elapsed < 50) {
        wheelZoomFrameRef.current = requestAnimationFrame(applyPendingZoom);
        return;
      }

      wheelZoomFrameRef.current = null;
      const delta = wheelZoomDeltaRef.current;
      const latestPoint = wheelZoomPointRef.current;
      wheelZoomDeltaRef.current = 0;
      wheelZoomPointRef.current = undefined;
      if (delta !== 0) {
        if (!isBufferedFormat) lastWheelZoomAtRef.current = performance.now();
        zoomBy(Math.exp(-delta * 0.0008), latestPoint);
      }
    };

    wheelZoomFrameRef.current = requestAnimationFrame(applyPendingZoom);
  }, [sourceFormat, zoomBy]);

  const queueTouchZoom = useCallback((zoom: number, point: { x: number; y: number }) => {
    const fixedLayout = isFixedLayout(sourceFormat);
    touchZoomPendingRef.current = { zoom, point };
    if (touchZoomFrameRef.current !== null) return;

    const applyPendingZoom = () => {
      const elapsed = performance.now() - lastTouchZoomAtRef.current;
      if (!fixedLayout && touchZoomPendingRef.current && elapsed < 40) {
        touchZoomFrameRef.current = requestAnimationFrame(applyPendingZoom);
        return;
      }

      touchZoomFrameRef.current = null;
      const pending = touchZoomPendingRef.current;
      touchZoomPendingRef.current = null;
      if (!pending) return;
      if (!fixedLayout) lastTouchZoomAtRef.current = performance.now();
      zoomTo(pending.zoom, pending.point);
    };

    touchZoomFrameRef.current = requestAnimationFrame(applyPendingZoom);
  }, [sourceFormat, zoomTo]);

  // Clean up RAFs and timers on unmount
  useEffect(() => () => {
    if (wheelZoomFrameRef.current !== null) cancelAnimationFrame(wheelZoomFrameRef.current);
    if (touchZoomFrameRef.current !== null) cancelAnimationFrame(touchZoomFrameRef.current);
    if (pdfZoomCommitTimerRef.current !== null) window.clearTimeout(pdfZoomCommitTimerRef.current);
  }, []);

  // Viewport anchor restoration for reflowable content
  useLayoutEffect(() => {
    if (previousReaderZoomRef.current === readerZoom) return;
    previousReaderZoomRef.current = readerZoom;
    if (isFixedLayout(sourceFormat) || sourceFormat === 'epub' || !zoomAnchor) return;

    const viewport = readerStageRef.current?.querySelector<HTMLElement>('[data-reader-viewport]');
    if (!viewport) return;
    const horizontal = viewport.dataset.readerViewport === 'paginated';
    viewport.scrollTo({
      left: horizontal
        ? Math.max(0, zoomAnchor.scrollRatioX * viewport.scrollWidth - zoomAnchor.viewportX)
        : viewport.scrollLeft,
      top: horizontal
        ? viewport.scrollTop
        : Math.max(0, zoomAnchor.scrollRatioY * viewport.scrollHeight - zoomAnchor.viewportY),
      behavior: 'auto',
    });
  }, [sourceFormat, readerZoom, zoomAnchor, readerStageRef]);

  // Wheel zoom gesture listener
  useEffect(() => {
    const stage = readerStageRef.current;
    if (!stage) return;

    const handleNativeWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const target = event.target as Node | null;
      if (!stage.contains(target)) return;

      event.preventDefault();
      event.stopPropagation();
      const viewport = stage.querySelector<HTMLElement>('[data-reader-viewport]');
      const viewportRect = viewport?.getBoundingClientRect();
      const isZoomingIn = event.deltaY < 0;
      const point = isZoomingIn || !viewportRect
        ? { x: event.clientX, y: event.clientY }
        : {
            x: viewportRect.left + viewportRect.width / 2,
            y: viewportRect.top + viewportRect.height / 2,
          };
      queueWheelZoom(getWheelDeltaPixels(event, viewport), point);
    };

    stage.addEventListener('wheel', handleNativeWheel, { capture: true, passive: false });
    return () => stage.removeEventListener('wheel', handleNativeWheel, true);
  }, [loading, queueWheelZoom, readerStageRef]);

  // Touch pinch-to-zoom gesture listener
  useEffect(() => {
    const stage = readerStageRef.current;
    if (!stage) return;

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length < 2) return;
      const gesture = getTouchZoomGesture(event.touches);
      if (!gesture || gesture.distance <= 0) return;
      touchZoomStartRef.current = { distance: gesture.distance, zoom: readerZoomRef.current };
      event.stopPropagation();
    };

    const handleTouchMove = (event: TouchEvent) => {
      const start = touchZoomStartRef.current;
      if (!start || event.touches.length < 2) return;
      const gesture = getTouchZoomGesture(event.touches);
      if (!gesture) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      const nextZoom = (start.zoom * gesture.distance) / start.distance;
      const isZoomingIn = nextZoom > readerZoomRef.current;
      const viewport = stage.querySelector<HTMLElement>('[data-reader-viewport]');
      const viewportRect = viewport?.getBoundingClientRect();
      const point = isZoomingIn || !viewportRect
        ? gesture.point
        : {
            x: viewportRect.left + viewportRect.width / 2,
            y: viewportRect.top + viewportRect.height / 2,
          };
      queueTouchZoom(nextZoom, point);
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (!touchZoomStartRef.current) return;
      event.stopPropagation();
      if (event.touches.length < 2) touchZoomStartRef.current = null;
    };

    stage.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
    stage.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
    stage.addEventListener('touchend', handleTouchEnd, { capture: true, passive: true });
    stage.addEventListener('touchcancel', handleTouchEnd, { capture: true, passive: true });
    return () => {
      stage.removeEventListener('touchstart', handleTouchStart, true);
      stage.removeEventListener('touchmove', handleTouchMove, true);
      stage.removeEventListener('touchend', handleTouchEnd, true);
      stage.removeEventListener('touchcancel', handleTouchEnd, true);
    };
  }, [loading, queueTouchZoom, readerStageRef]);

  return {
    readerZoom,
    readerZoomRef,
    zoomAnchor,
    zoomLabelRef,
    zoomBy,
    zoomTo,
    resetZoom,
    queueWheelZoom,
  };
}
