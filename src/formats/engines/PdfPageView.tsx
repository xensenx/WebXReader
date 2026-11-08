/**
 * Renders an individual PDF page into a high-DPI HTML5 canvas with a selectable text layer.
 *
 * Supports responsive viewport scaling across continuous scroll, horizontal ribbons,
 * single-page pagination, and double-sided spreads.
 */

import {
  useState,
  useEffect,
  useRef,
  type CSSProperties,
} from 'react';
import { pdfjsLib } from '../../core/parsing/pdf-init';
import styles from './PdfReader.module.css';

export type PdfDocument = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;
export type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>;
export type PdfRenderTask = ReturnType<PdfPage['render']>;
export type PdfTextContent = Awaited<ReturnType<PdfPage['getTextContent']>>;
export type PdfTextLayer = {
  render: () => Promise<unknown>;
  cancel: () => void;
};

export interface PageSize {
  width: number;
  height: number;
}

/**
 * Calculates display scaling factor based on container dimensions, page dimensions,
 * reader zoom factor, and the active presentation layout mode.
 *
 * @param baseWidth Intrinsic PDF page width in points.
 * @param viewportWidth Available container viewport width in pixels.
 * @param readerZoom User zoom factor (1.0 = 100%).
 * @param layoutMode Reading presentation mode.
 * @param baseHeight Intrinsic PDF page height in points.
 * @param viewportHeight Available container viewport height in pixels.
 * @returns Resolved visual scale factor.
 */
export function getPdfDisplayScale(
  baseWidth: number,
  viewportWidth: number,
  readerZoom: number,
  layoutMode: 'scroll' | 'horizontal' | 'paginated' | 'vertical' = 'scroll',
  baseHeight: number = 792,
  viewportHeight: number = 800
): number {
  if (layoutMode === 'horizontal' || layoutMode === 'paginated') {
    const availW = Math.max(240, viewportWidth - 48);
    const availH = Math.max(240, viewportHeight - 48);
    const scaleW = availW / Math.max(1, baseWidth);
    const scaleH = availH / Math.max(1, baseHeight);
    const fitScale = Math.min(scaleW, scaleH);
    return Math.min(3.5, Math.max(0.25, fitScale)) * readerZoom;
  }
  if (layoutMode === 'vertical') {
    // Double-sided 2-page spread
    const availW = Math.max(200, (viewportWidth - 64) / 2);
    const availH = Math.max(240, viewportHeight - 48);
    const scaleW = availW / Math.max(1, baseWidth);
    const scaleH = availH / Math.max(1, baseHeight);
    const fitScale = Math.min(scaleW, scaleH);
    return Math.min(3.5, Math.max(0.25, fitScale)) * readerZoom;
  }
  // Standard vertical continuous scroll: fit available container width
  const availableWidth = Math.max(240, viewportWidth - 32);
  const fitScale = availableWidth / Math.max(1, baseWidth);
  return Math.min(2.5, Math.max(0.45, fitScale)) * readerZoom;
}

export interface PdfPageViewProps {
  pdfDoc: PdfDocument;
  pageNumber: number;
  viewportRef?: React.RefObject<HTMLDivElement | null>;
  pageSize: PageSize | undefined;
  readerZoom: number;
  layoutVersion: number;
  initiallyVisible: boolean;
  onPageSize?: (pageNumber: number, size: PageSize) => void;
  layoutMode?: 'scroll' | 'horizontal' | 'paginated' | 'vertical';
  customWidth?: number;
  customHeight?: number;
  className?: string;
}

/**
 * Component responsible for rasterizing a single PDF page to a canvas and rendering
 * the matching transparent text layer for text selection and search highlights.
 */
export function PdfPageView({
  pdfDoc,
  pageNumber,
  viewportRef,
  pageSize,
  readerZoom,
  layoutVersion,
  initiallyVisible,
  onPageSize,
  layoutMode = 'scroll',
  customWidth,
  customHeight,
  className,
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
    const root = viewportRef?.current ?? null;
    if (!shell) return;

    if (typeof IntersectionObserver === 'undefined') {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRender(true);
        } else if (!initiallyVisible) {
          // Keep only nearby pages rasterized to conserve GPU/canvas memory
          setShouldRender(false);
        }
      },
      { root, rootMargin: '1200px 1200px' }
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
    if (!shouldRender || !canvasRef.current || !textLayerContainerRef.current) return;
    let active = true;
    let stagedTextLayer: HTMLDivElement | null = null;

    const render = async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (!active || !canvasRef.current) return;

        const baseViewport = page.getViewport({ scale: 1 });
        onPageSize?.(pageNumber, {
          width: baseViewport.width,
          height: baseViewport.height,
        });

        const vWidth = customWidth ?? viewportRef?.current?.clientWidth ?? window.innerWidth;
        const vHeight = customHeight ?? viewportRef?.current?.clientHeight ?? window.innerHeight;

        const scale = getPdfDisplayScale(
          baseViewport.width,
          vWidth,
          readerZoom,
          layoutMode,
          baseViewport.height,
          vHeight
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

        // Device-pixel transform as part of the PDF.js render pipeline
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

        // Double-buffering prevents blank flicker during zoom or pan
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
  }, [
    pdfDoc,
    pageNumber,
    shouldRender,
    readerZoom,
    layoutVersion,
    viewportRef,
    onPageSize,
    layoutMode,
    customWidth,
    customHeight,
  ]);

  const fallbackSize = pageSize ?? { width: 612, height: 792 };
  const vWidth = customWidth ?? viewportRef?.current?.clientWidth ?? window.innerWidth;
  const vHeight = customHeight ?? viewportRef?.current?.clientHeight ?? window.innerHeight;
  const displayScale = getPdfDisplayScale(
    fallbackSize.width,
    vWidth,
    readerZoom,
    layoutMode,
    fallbackSize.height,
    vHeight
  );

  const shellStyle: CSSProperties = {
    width: `${Math.floor(fallbackSize.width * displayScale)}px`,
    height: `${Math.floor(fallbackSize.height * displayScale)}px`,
  };

  return (
    <div
      ref={shellRef}
      className={`${styles.pageShell} ${className ?? ''}`}
      data-pdf-page={pageNumber}
      style={shellStyle}
      aria-label={`PDF page ${pageNumber}`}
    >
      <canvas ref={canvasRef} className={styles.pdfCanvas} aria-label={`Page ${pageNumber}`} />
      <div
        ref={textLayerContainerRef}
        className={styles.textLayer}
        aria-label={`Selectable text for page ${pageNumber}`}
      />
      {!hasRendered && <div className={styles.pagePlaceholder} aria-hidden="true" />}
    </div>
  );
}
