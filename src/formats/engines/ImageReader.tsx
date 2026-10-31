/**
 * Dedicated Standalone Image Reader (PNG, JPEG / JPG) for WebXReader.
 *
 * Implements the rock-solid PdfReader and CbzReader architectural mechanics:
 * 1. Explicit pixel-based display scaling and aspect-ratio preservation
 * 2. Stable centering in flex pageStack with zero negative-margin push or lateral jumping
 * 3. Smooth matrix preview zooming around pointer anchor with exact layout-effect scroll restoration
 * 4. Checkerboard pattern toggle for transparent PNG inspection (disabled by default)
 * 5. In-place rotation (90° increments)
 * 6. Sequential image collection navigation with natural filename ordering
 * 7. Seamless integration with WebXReader zoom controls and shortcut gestures
 */

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  memo,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Grid,
  AlertCircle,
} from 'lucide-react';
import type { Book, ComicFitMode } from '../../types/book';
import { listBooks } from '../../core/storage/database';
import { naturalCompare } from '../../core/parsing/comic-archive';
import styles from './ImageReader.module.css';

export interface ImageZoomAnchor {
  id: number;
  pageNumber?: number;
  pageX?: number;
  pageY?: number;
  viewportX: number;
  viewportY: number;
  scrollRatioX: number;
  scrollRatioY: number;
}

export interface ImageReaderHandle {
  previewZoom: (zoom: number, anchor?: ImageZoomAnchor) => void;
  resetView: () => void;
  goToProgress: (fraction: number) => void;
}

export interface ImageReaderProps {
  fileData: ArrayBuffer;
  format?: 'png' | 'jpeg' | string;
  book?: Book;
  fitMode?: ComicFitMode;
  readerZoom?: number;
  zoomAnchor?: ImageZoomAnchor;
  onProgressUpdate?: (chapterId: string, progressFraction: number, pageIndex: number) => void;
  onToggleControls?: () => void;
}

interface PointerDragState {
  pointerId: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
  hasMoved: boolean;
}

interface ImageZoomPreviewTransform {
  baseLeft: number;
  baseTop: number;
  scale: number;
  translateX: number;
  translateY: number;
}

/**
 * Computes explicit pixel display scale matching PdfReader and CbzReader mechanics.
 * Guarantees zero circular layout calculations and stable centering.
 */
function getImageDisplayScale(
  baseWidth: number,
  baseHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  readerZoom: number,
  fitMode: ComicFitMode = 'contain'
): number {
  const paddingX = 32;
  const paddingY = 48;
  const availableWidth = Math.max(240, viewportWidth - paddingX);
  const availableHeight = Math.max(240, viewportHeight - paddingY);

  let fitScale: number;
  if (fitMode === 'width') {
    fitScale = availableWidth / Math.max(1, baseWidth);
  } else if (fitMode === 'height') {
    fitScale = availableHeight / Math.max(1, baseHeight);
  } else {
    // 'contain': comfortably fit within viewport bounds preserving natural proportions
    fitScale = Math.min(
      availableWidth / Math.max(1, baseWidth),
      availableHeight / Math.max(1, baseHeight)
    );
  }

  return Math.min(8.0, Math.max(0.15, fitScale)) * readerZoom;
}

export const ImageReader = memo(
  forwardRef<ImageReaderHandle, ImageReaderProps>(function ImageReader(
    {
      fileData,
      format = 'jpeg',
      book,
      fitMode = 'contain',
      readerZoom = 1,
      zoomAnchor,
      onProgressUpdate,
      onToggleControls,
    },
    ref
  ) {
    const navigate = useNavigate();

    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Viewport & Layout
    const viewportRef = useRef<HTMLDivElement>(null);
    const pageStackRef = useRef<HTMLDivElement>(null);
    const shellRef = useRef<HTMLDivElement>(null);
    const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
      width: 0,
      height: 0,
    });

    // Custom view states
    const [rotation, setRotation] = useState<number>(0);
    const [checkerboard, setCheckerboard] = useState<boolean>(false);

    // Sibling collection state
    const [siblingImages, setSiblingImages] = useState<Book[]>([]);
    const [currentIndex, setCurrentIndex] = useState<number>(-1);

    // Zoom preview and anchor tracking (mirrors PdfReader & CbzReader)
    const previewTransformRef = useRef<ImageZoomPreviewTransform | null>(null);
    const lastZoomAnchorRef = useRef<ImageZoomAnchor | undefined>(undefined);
    const previousReaderZoomRef = useRef(readerZoom);

    // Pointer Drag Panning state
    const dragStateRef = useRef<PointerDragState | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    // Create and manage Blob Object URL lifecycle
    useEffect(() => {
      if (!fileData || fileData.byteLength === 0) {
        setError('No image data provided.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setNaturalSize(null);

      const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
      const blob = new Blob([fileData], { type: mimeType });
      const url = URL.createObjectURL(blob);
      setObjectUrl(url);

      return () => {
        URL.revokeObjectURL(url);
      };
    }, [fileData, format]);

    // Track viewport size via ResizeObserver
    useEffect(() => {
      const viewport = viewportRef.current;
      if (!viewport || typeof ResizeObserver === 'undefined') return;

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          setViewportSize({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      });

      observer.observe(viewport);
      return () => observer.disconnect();
    }, []);

    // Load sibling images for collection navigation
    useEffect(() => {
      let isMounted = true;
      async function loadSiblings() {
        try {
          const allBooks = await listBooks();
          if (!isMounted) return;

          const images = allBooks.filter(
            (b) => b.sourceFormat === 'png' || b.sourceFormat === 'jpeg'
          );

          images.sort((a, b) =>
            naturalCompare(a.originalFilename || a.title, b.originalFilename || b.title)
          );

          setSiblingImages(images);
          if (book) {
            const idx = images.findIndex((b) => b.id === book.id);
            setCurrentIndex(idx);
          }
        } catch {
          // Ignore library lookup errors
        }
      }

      void loadSiblings();
      return () => {
        isMounted = false;
      };
    }, [book]);

    // Report initial progress
    useEffect(() => {
      if (onProgressUpdate) {
        onProgressUpdate('image-1', 1.0, 0);
      }
    }, [onProgressUpdate]);

    const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      setNaturalSize({
        width: img.naturalWidth || 800,
        height: img.naturalHeight || 600,
      });
      setLoading(false);
    };

    const handleImageError = () => {
      setError('Failed to render image.');
      setLoading(false);
    };

    const navigateToSibling = useCallback(
      (offset: number) => {
        if (currentIndex < 0 || siblingImages.length <= 1) return;
        const targetIndex = currentIndex + offset;
        if (targetIndex >= 0 && targetIndex < siblingImages.length) {
          const target = siblingImages[targetIndex];
          navigate(`/reader/${target.id}`);
        }
      },
      [currentIndex, siblingImages, navigate]
    );

    // Keyboard navigation (ArrowLeft/ArrowRight)
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          return;
        }

        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          navigateToSibling(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          navigateToSibling(1);
        } else if (e.key.toLowerCase() === 'r') {
          setRotation((r) => (r + 90) % 360);
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [navigateToSibling]);

    // Calculate dimensions
    const isRotatedQuarter = rotation === 90 || rotation === 270;
    const rawNatW = naturalSize?.width || 800;
    const rawNatH = naturalSize?.height || 600;
    const baseWidth = isRotatedQuarter ? rawNatH : rawNatW;
    const baseHeight = isRotatedQuarter ? rawNatW : rawNatH;

    const vpW = Math.max(240, viewportSize.width || window.innerWidth || 800);
    const vpH = Math.max(240, viewportSize.height || window.innerHeight || 600);

    const displayScale = getImageDisplayScale(baseWidth, baseHeight, vpW, vpH, readerZoom, fitMode);
    const displayWidth = Math.max(1, Math.round(baseWidth * displayScale));
    const displayHeight = Math.max(1, Math.round(baseHeight * displayScale));

    const isZoomed = displayWidth > vpW || displayHeight > vpH;

    // Preview zoom matrix transform around pointer anchor (mirrors PdfReader/CbzReader)
    const previewZoom = useCallback(
      (nextZoom: number, anchor?: ImageZoomAnchor) => {
        const viewport = viewportRef.current;
        const pageStack = pageStackRef.current;
        if (!viewport || !pageStack) return;

        const activeAnchor = anchor ?? lastZoomAnchorRef.current;
        if (!activeAnchor) {
          const ratio = nextZoom / readerZoom;
          pageStack.style.transformOrigin = '50% 50%';
          pageStack.style.transform = `scale(${ratio})`;
          return;
        }

        const viewportRect = viewport.getBoundingClientRect();
        const pointerX = viewportRect.left + activeAnchor.viewportX;
        const pointerY = viewportRect.top + activeAnchor.viewportY;
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

        lastZoomAnchorRef.current = activeAnchor;
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
      [readerZoom]
    );

    // Exact anchor restoration upon zoom commit (mirrors PdfReader/CbzReader)
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

      const page = pageStackRef.current?.querySelector<HTMLElement>('[data-image-page]');

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

    // Imperative handle for parent zoom & seeking
    useImperativeHandle(
      ref,
      () => ({
        previewZoom,
        resetView: () => {
          setRotation(0);
          const pageStack = pageStackRef.current;
          if (pageStack) {
            pageStack.style.transform = '';
            pageStack.style.transformOrigin = '';
          }
          const viewport = viewportRef.current;
          if (viewport) {
            viewport.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
          }
        },
        goToProgress: (fraction: number) => {
          const viewport = viewportRef.current;
          if (!viewport) return;
          const maxScroll = viewport.scrollHeight - viewport.clientHeight;
          if (maxScroll > 0) {
            viewport.scrollTo({ top: fraction * maxScroll, behavior: 'smooth' });
          }
        },
      }),
      [previewZoom]
    );

    // Pointer drag / pan handling when zoomed in
    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(`.${styles.floatingToolbar}, button, a`)) return;

      const viewport = viewportRef.current;
      if (!viewport) return;

      dragStateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startScrollLeft: viewport.scrollLeft,
        startScrollTop: viewport.scrollTop,
        hasMoved: false,
      };

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== e.pointerId) return;
      const viewport = viewportRef.current;
      if (!viewport) return;

      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;

      if (!state.hasMoved && Math.hypot(dx, dy) > 4) {
        state.hasMoved = true;
        setIsDragging(true);
      }

      if (state.hasMoved) {
        viewport.scrollLeft = state.startScrollLeft - dx;
        viewport.scrollTop = state.startScrollTop - dy;
      }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== e.pointerId) return;

      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }

      const hasMoved = state.hasMoved;
      setIsDragging(false);
      dragStateRef.current = null;

      if (!hasMoved) {
        onToggleControls?.();
      }
    };

    if (error) {
      return (
        <div className={styles.centerBox}>
          <AlertCircle size={44} style={{ color: 'var(--color-danger, #ef4444)' }} />
          <p>{error}</p>
        </div>
      );
    }

    return (
      <div className={styles.container}>
        {/* Sibling navigation arrows */}
        {siblingImages.length > 1 && currentIndex > 0 && (
          <button
            type="button"
            className={`${styles.navArrow} ${styles.navArrowLeft}`}
            onClick={(e) => {
              e.stopPropagation();
              navigateToSibling(-1);
            }}
            title="Previous Image (ArrowLeft)"
            aria-label="Previous image"
          >
            <ChevronLeft size={24} />
          </button>
        )}

        {siblingImages.length > 1 && currentIndex < siblingImages.length - 1 && (
          <button
            type="button"
            className={`${styles.navArrow} ${styles.navArrowRight}`}
            onClick={(e) => {
              e.stopPropagation();
              navigateToSibling(1);
            }}
            title="Next Image (ArrowRight)"
            aria-label="Next image"
          >
            <ChevronRight size={24} />
          </button>
        )}

        {/* Viewport scroll surface */}
        <div
          ref={viewportRef}
          className={`${styles.viewport} ${
            isDragging ? styles.cursorGrabbing : isZoomed ? styles.cursorGrab : styles.cursorDefault
          }`}
          data-reader-viewport="image-viewport"
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {loading && (
            <div className={styles.centerBox}>
              <div className={styles.spinner} />
              <p>Loading image…</p>
            </div>
          )}

          {objectUrl && (
            <div ref={pageStackRef} className={styles.pageStack}>
              <div
                ref={shellRef}
                className={`${styles.pageShell} ${checkerboard ? styles.checkerboard : ''}`}
                data-image-page="1"
                style={{
                  width: displayWidth || undefined,
                  height: displayHeight || undefined,
                }}
              >
                <img
                  src={objectUrl}
                  alt={book?.title || 'Image view'}
                  className={styles.imageElement}
                  style={{
                    width: isRotatedQuarter ? displayHeight : displayWidth,
                    height: isRotatedQuarter ? displayWidth : displayHeight,
                    transform: rotation ? `rotate(${rotation}deg)` : undefined,
                  }}
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                  draggable={false}
                />
              </div>
            </div>
          )}
        </div>

        {/* Floating Quick Actions Bar */}
        <div className={styles.floatingToolbar}>
          {siblingImages.length > 1 && (
            <>
              <button
                type="button"
                className={styles.toolBtn}
                disabled={currentIndex <= 0}
                onClick={() => navigateToSibling(-1)}
                title="Previous Image"
              >
                <ChevronLeft size={16} />
              </button>
              <span className={styles.infoBadge}>
                {currentIndex + 1} / {siblingImages.length}
              </span>
              <button
                type="button"
                className={styles.toolBtn}
                disabled={currentIndex >= siblingImages.length - 1}
                onClick={() => navigateToSibling(1)}
                title="Next Image"
              >
                <ChevronRight size={16} />
              </button>
              <div className={styles.divider} />
            </>
          )}

          <span className={styles.infoBadge}>
            {Math.round(readerZoom * 100)}%
          </span>

          <div className={styles.divider} />

          <button
            type="button"
            className={styles.toolBtn}
            onClick={() => setRotation((r) => (r + 90) % 360)}
            title="Rotate 90° Clockwise"
          >
            <RotateCw size={15} />
          </button>

          <button
            type="button"
            className={`${styles.toolBtn} ${checkerboard ? styles.toolBtnActive : ''}`}
            onClick={() => setCheckerboard((v) => !v)}
            title="Toggle Checkerboard Backdrop (for transparency)"
          >
            <Grid size={15} />
          </button>

          {naturalSize && (
            <>
              <div className={styles.divider} />
              <span className={styles.infoBadge}>
                {naturalSize.width} × {naturalSize.height}
              </span>
            </>
          )}
        </div>
      </div>
    );
  })
);
