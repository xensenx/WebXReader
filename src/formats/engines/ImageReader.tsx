/**
 * Dedicated Standalone Image Reader (PNG, JPEG / JPG) for WebXReader.
 *
 * Provides a high-fidelity image reading surface supporting:
 * 1. Aspect-ratio preserving display scaling across Contain, Fit Width, and Fit Height modes
 * 2. Actual-size (1:1) pixel inspection and smooth interactive zooming
 * 3. Fluid click-and-drag panning when zoomed in
 * 4. Checkerboard pattern backdrop toggle for transparent PNGs
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
    const stageRef = useRef<HTMLDivElement>(null);
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

      // Auto-enable checkerboard for PNGs with alpha
      if (format === 'png' && book?.identifiers?.hasAlpha === 'true') {
        setCheckerboard(true);
      }

      return () => {
        URL.revokeObjectURL(url);
      };
    }, [fileData, format, book]);

    // Track viewport size via ResizeObserver
    useEffect(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;

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
          images.sort((a, b) => naturalCompare(a.originalFilename || a.title, b.originalFilename || b.title));

          setSiblingImages(images);
          const idx = images.findIndex((b) => b.id === book?.id);
          setCurrentIndex(idx);
        } catch {
          // ignore
        }
      }

      void loadSiblings();
      return () => {
        isMounted = false;
      };
    }, [book?.id]);

    // Handle image loaded event to capture natural dimensions
    const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      setNaturalSize({
        width: img.naturalWidth || 800,
        height: img.naturalHeight || 600,
      });
      setLoading(false);
      onProgressUpdate?.('image-1', 1, 1);
    };

    const handleImageError = () => {
      setLoading(false);
      setError('Failed to decode image. File may be corrupted or unsupported.');
    };

    // Sibling collection navigation
    const navigateToSibling = useCallback(
      (delta: number) => {
        if (siblingImages.length <= 1 || currentIndex < 0) return;
        const targetIdx = currentIndex + delta;
        if (targetIdx >= 0 && targetIdx < siblingImages.length) {
          const target = siblingImages[targetIdx];
          navigate(`/read/${target.id}`);
        }
      },
      [siblingImages, currentIndex, navigate]
    );

    // Keyboard arrow navigation for collection sequences
    useEffect(() => {
      function handleKeyDown(e: KeyboardEvent) {
        if (siblingImages.length <= 1) return;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          navigateToSibling(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          navigateToSibling(1);
        }
      }

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [siblingImages.length, navigateToSibling]);

    // Compute display dimensions preserving natural aspect ratio
    const naturalWidth = naturalSize?.width || 800;
    const naturalHeight = naturalSize?.height || 600;

    // Account for 90° or 270° rotation swapping aspect ratio
    const isRotatedQuarter = rotation === 90 || rotation === 270;
    const effectiveNatW = isRotatedQuarter ? naturalHeight : naturalWidth;
    const effectiveNatH = isRotatedQuarter ? naturalWidth : naturalHeight;

    const vpW = Math.max(320, viewportSize.width);
    const vpH = Math.max(240, viewportSize.height);

    let fitScale = 1;
    if (fitMode === 'width') {
      fitScale = (vpW - 32) / effectiveNatW;
    } else if (fitMode === 'height') {
      fitScale = (vpH - 32) / effectiveNatH;
    } else {
      // contain
      fitScale = Math.min((vpW - 32) / effectiveNatW, (vpH - 32) / effectiveNatH, 1);
    }

    const totalScale = fitScale * readerZoom;
    const displayWidth = Math.round(effectiveNatW * totalScale);
    const displayHeight = Math.round(effectiveNatH * totalScale);

    const isZoomed = displayWidth > vpW || displayHeight > vpH || readerZoom > 1.05;

    // Imperative handle for parent zoom & seeking
    useImperativeHandle(
      ref,
      () => ({
        previewZoom: (zoom: number, _anchor?: ImageZoomAnchor) => {
          const stage = stageRef.current;
          if (!stage) return;
          const ratio = zoom / readerZoom;
          stage.style.transform = `scale(${ratio})`;
        },
        resetView: () => {
          setRotation(0);
          const stage = stageRef.current;
          if (stage) stage.style.transform = '';
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
      [readerZoom]
    );

    // Clear preview scale once zoom is committed
    useLayoutEffect(() => {
      const stage = stageRef.current;
      if (stage) {
        stage.style.transform = '';
      }
    }, [readerZoom]);

    // Restore anchor pivot scroll position
    useLayoutEffect(() => {
      const viewport = viewportRef.current;
      if (!viewport || !zoomAnchor) return;

      viewport.scrollTo({
        left: Math.max(0, zoomAnchor.scrollRatioX * viewport.scrollWidth - zoomAnchor.viewportX),
        top: Math.max(0, zoomAnchor.scrollRatioY * viewport.scrollHeight - zoomAnchor.viewportY),
        behavior: 'auto',
      });
    }, [readerZoom, zoomAnchor]);

    // Pointer Drag Panning
    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return; // Only primary mouse button
      const viewport = viewportRef.current;
      if (!viewport) return;

      e.currentTarget.setPointerCapture(e.pointerId);
      dragStateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startScrollLeft: viewport.scrollLeft,
        startScrollTop: viewport.scrollTop,
        hasMoved: false,
      };
      if (isZoomed) {
        setIsDragging(true);
      }
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== e.pointerId) return;
      const viewport = viewportRef.current;
      if (!viewport) return;

      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;

      if (!state.hasMoved && Math.hypot(dx, dy) > 5) {
        state.hasMoved = true;
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

      setIsDragging(false);
      dragStateRef.current = null;

      // If user clicked without dragging, toggle reader controls
      if (!state.hasMoved) {
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
      <div className={`${styles.container} ${checkerboard ? styles.checkerboard : ''}`}>
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

        {/* Viewport reading surface */}
        <div
          ref={viewportRef}
          className={`${styles.viewport} ${
            isZoomed ? (isDragging ? styles.cursorGrabbing : styles.cursorGrab) : styles.cursorDefault
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
            <div
              ref={stageRef}
              className={styles.stage}
              data-image-page="1"
              style={{
                width: displayWidth || undefined,
                height: displayHeight || undefined,
                transform: rotation ? `rotate(${rotation}deg)` : undefined,
              }}
            >
              <img
                src={objectUrl}
                alt={book?.title || 'Image view'}
                className={styles.imageElement}
                style={{
                  width: isRotatedQuarter ? displayHeight : displayWidth,
                  height: isRotatedQuarter ? displayWidth : displayHeight,
                }}
                onLoad={handleImageLoad}
                onError={handleImageError}
                draggable={false}
              />
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
