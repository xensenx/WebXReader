/**
 * Reflowable page reader for normalized TXT, Markdown, and HTML content.
 *
 * CSS columns lay out the text. Navigation uses the track's measured overflow
 * to count pages for the current viewport and typography.
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
  useMemo,
  useImperativeHandle,
  forwardRef,
  memo,
  type KeyboardEvent,
  type TouchEvent,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { BookFormat, Chapter } from '../../types/book';
import type { EffectiveReaderSettings } from '../../hooks/useReaderSettings';
import { allowsEmbeddedReaderImages } from '../../core/parsing/sanitize-reader-html';
import { ChapterBody } from './ChapterBody';
import { getReaderChapterHtml } from './chapter-html';
import { turnBookPage } from './book-turn';
import styles from './PaginatedReader.module.css';

export interface PaginatedReaderProps {
  chapters: Chapter[];
  format?: BookFormat;
  settings: EffectiveReaderSettings;
  initialPageIndex?: number;
  initialChapterId?: string;
  initialProgressFraction?: number;
  initialProgressMode?: string;
  onProgressUpdate: (chapterId: string, progressFraction: number, pageIndex: number) => void;
  onToggleControls?: () => void;
  zoom?: number;
  zoomAnchor?: { scrollRatioX: number; scrollRatioY: number };
  pagesPerSpread?: 1 | 2;
}

export interface PaginatedReaderHandle {
  goToProgress: (fraction: number) => void;
  goToElement: (element: HTMLElement) => void;
  goToRange: (range: Range) => void;
}

export const PaginatedReader = memo(forwardRef<PaginatedReaderHandle, PaginatedReaderProps>(function PaginatedReader({
  chapters,
  format,
  settings,
  initialPageIndex = 0,
  initialChapterId,
  initialProgressFraction = 0,
  initialProgressMode = 'paginated',
  onProgressUpdate,
  onToggleControls,
  zoom = 1,
  zoomAnchor,
  pagesPerSpread = 1,
}, ref) {
  const safeChapterContents = useMemo(
    () => chapters.map((chapter) => getReaderChapterHtml(chapter, format)),
    [chapters, format],
  );
  const [currentPage, setCurrentPage] = useState(Math.max(0, initialPageIndex));
  const [totalPages, setTotalPages] = useState(1);
  const [pageHeight, setPageHeight] = useState(1);
  const [pageWidth, setPageWidth] = useState(1);
  const [imageRevision, setImageRevision] = useState(0);
  const [canPublishProgress, setCanPublishProgress] = useState(false);
  const imageFrameRef = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const chapterRefs = useRef<Map<string, HTMLElement>>(new Map());
  const onProgressUpdateRef = useRef(onProgressUpdate);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const lastWheelTime = useRef(-Infinity);
  const transitionRef = useRef<ViewTransition | undefined>(undefined);
  const navigationTargetRef = useRef<number | undefined>(undefined);
  const chapterOffsetsRef = useRef<number[]>([]);
  const lastProgressFractionRef = useRef(initialProgressFraction);
  const previousZoomRef = useRef(zoom);
  const zoomAnchorRef = useRef(zoomAnchor);
  const initialLocation = useRef({ initialChapterId, initialPageIndex, initialProgressFraction, initialProgressMode });
  const initialLayoutAppliedRef = useRef(false);
  const isBook = pagesPerSpread === 2;
  const [columnsPerTurn, setColumnsPerTurn] = useState(pagesPerSpread);
  const spreadGap = isBook && columnsPerTurn === 2 ? 40 : 0;
  onProgressUpdateRef.current = onProgressUpdate;
  zoomAnchorRef.current = zoomAnchor;

  const layoutKey = [
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.paragraphSpacing,
    settings.letterSpacing,
    settings.wordSpacing,
    settings.textAlign,
    settings.textIndent,
    settings.maxContentWidth,
    settings.contentMargin,
    zoom,
    pagesPerSpread,
  ].join('|');

  const getViewportDimensions = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const computed = getComputedStyle(viewport);
    const horizontalPadding = (parseFloat(computed.paddingLeft) || 0) + (parseFloat(computed.paddingRight) || 0);
    const verticalPadding = (parseFloat(computed.paddingTop) || 0) + (parseFloat(computed.paddingBottom) || 0);
    const availableWidth = Math.max(1, viewport.clientWidth - horizontalPadding);
    const columns: 1 | 2 = isBook && availableWidth >= 590 ? 2 : 1;
    const pageWidth = columns === 2 ? Math.floor((availableWidth - 40) / 2) : availableWidth;
    const viewportHeight = Math.max(1, viewport.clientHeight - verticalPadding);
    return { width: pageWidth, height: viewportHeight, columns };
  }, [isBook]);

  const updateDimensions = useCallback(() => {
    const dimensions = getViewportDimensions();
    if (!dimensions || dimensions.width <= 1 || dimensions.height <= 1) return;
    setPageWidth(dimensions.width);
    setPageHeight(dimensions.height);
    setColumnsPerTurn(dimensions.columns);
  }, [getViewportDimensions]);

  useLayoutEffect(updateDimensions, [layoutKey, updateDimensions]);

  useEffect(() => {
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateDimensions) : null;
    if (observer && viewportRef.current) observer.observe(viewportRef.current);
    window.addEventListener('resize', updateDimensions);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateDimensions);
      if (imageFrameRef.current !== null) cancelAnimationFrame(imageFrameRef.current);
      imageFrameRef.current = null;
    };
  }, [updateDimensions]);

  const handleImageLayout = useCallback(() => {
    if (imageFrameRef.current !== null) return;
    imageFrameRef.current = requestAnimationFrame(() => {
      imageFrameRef.current = null;
      setImageRevision((revision) => revision + 1);
    });
  }, []);

  // Let fixed-height CSS columns overflow naturally. Measuring that overflow
  // counts real pages without allocating space for estimated empty columns.
  useLayoutEffect(() => {
    const track = trackRef.current;
    const viewport = viewportRef.current;
    if (!track || !viewport || pageWidth <= 1 || pageHeight <= 1) return;
    const dimensions = getViewportDimensions();
    if (dimensions?.width !== pageWidth || dimensions.height !== pageHeight || dimensions.columns !== columnsPerTurn) return;

    const zoomChanged = previousZoomRef.current !== zoom;
    previousZoomRef.current = zoom;
    const spreadStep = (pageWidth + spreadGap) * columnsPerTurn;
    const actualColumns = Math.max(1, Math.ceil(
      (track.scrollWidth + spreadGap - 1) / (pageWidth + spreadGap)
    ));
    const actualPages = Math.ceil(actualColumns / columnsPerTurn);
    chapterOffsetsRef.current = chapters.map((chapter) => chapterRefs.current.get(chapter.id)?.offsetLeft ?? 0);
    const { initialChapterId, initialPageIndex, initialProgressFraction, initialProgressMode } = initialLocation.current;
    const chapterPage = initialChapterId
      ? Math.floor((chapterRefs.current.get(initialChapterId)?.offsetLeft ?? 0) / spreadStep)
      : 0;
    const anchor = zoomChanged ? zoomAnchorRef.current : undefined;
    const targetPage = initialLayoutAppliedRef.current
      ? anchor
        ? Math.floor(anchor.scrollRatioX * actualPages)
        : Math.round(lastProgressFractionRef.current * (actualPages - 1))
      : initialProgressFraction > 0
        ? Math.round(initialProgressFraction * (actualPages - 1))
        : initialProgressMode === (isBook ? 'vertical' : 'paginated') && initialPageIndex > 0
          ? initialPageIndex
          : chapterPage;

    const clampedPage = Math.max(0, Math.min(targetPage, actualPages - 1));
    setTotalPages(actualPages);
    setCurrentPage(clampedPage);
    navigationTargetRef.current = undefined;
    viewport.style.setProperty('--reader-last-page-end', `${(actualPages - 1) * spreadStep + viewport.clientWidth}px`);
    viewport.scrollLeft = clampedPage * spreadStep;
    // Even an in-range saved fraction can map to a different page after images load.
    if (allowsEmbeddedReaderImages(format) && !initialLayoutAppliedRef.current &&
        Array.from(track.querySelectorAll<HTMLImageElement>('img[src]')).some((image) => !image.complete)) {
      return;
    }
    lastProgressFractionRef.current = actualPages > 1 ? clampedPage / (actualPages - 1) : 0;
    if (!initialLayoutAppliedRef.current) {
      initialLayoutAppliedRef.current = true;
      setCanPublishProgress(true);
    }
  }, [chapters, columnsPerTurn, getViewportDimensions, imageRevision, format, isBook, layoutKey, pageHeight, pageWidth, spreadGap, zoom]);

  useEffect(() => () => {
    transitionRef.current?.skipTransition();
    transitionRef.current = undefined;
  }, []);

  const goToPage = useCallback((page: number, animate = true) => {
    const from = navigationTargetRef.current ?? currentPage;
    const nextPage = Math.max(0, Math.min(page, totalPages - 1));
    const viewport = viewportRef.current;
    if (!viewport || nextPage === from) return;
    // Repeat input during a turn skips its animation and immediately queues
    // the next position, so a fast key press never waits behind animations.
    const wasTurning = Boolean(transitionRef.current);
    transitionRef.current?.skipTransition();
    navigationTargetRef.current = nextPage;
    const spreadStep = (pageWidth + spreadGap) * columnsPerTurn;
    const showPage = () => {
      if (navigationTargetRef.current !== nextPage) return;
      viewport.scrollLeft = nextPage * spreadStep;
      viewport.scrollTop = 0;
      setCurrentPage(nextPage);
    };
    if (animate && isBook && columnsPerTurn === 2 && !wasTurning && Math.abs(nextPage - from) === 1) {
      const transition = turnBookPage(nextPage > from ? 'forward' : 'backward', showPage);
      transitionRef.current = transition;
      if (transition) {
        const clear = () => {
          if (transitionRef.current === transition) transitionRef.current = undefined;
        };
        void transition.finished.then(clear, clear);
      }
    } else {
      showPage();
    }
  }, [columnsPerTurn, currentPage, isBook, pageWidth, spreadGap, totalPages]);

  useImperativeHandle(ref, () => {
    const goToRect = (target: Node, bounds?: DOMRect) => {
      const track = trackRef.current;
      if (!track || !bounds || !track.contains(target)) return;
      const offset = bounds.left - track.getBoundingClientRect().left;
      goToPage(Math.floor((offset + 1) / ((pageWidth + spreadGap) * columnsPerTurn)), false);
    };
    return {
      goToProgress: (fraction) => goToPage(Math.round(fraction * (totalPages - 1)), false),
      goToElement: (element) => goToRect(element, element.getClientRects()[0]),
      goToRange: (range) => goToRect(range.startContainer, range.getClientRects()[0]),
    };
  }, [columnsPerTurn, goToPage, pageWidth, spreadGap, totalPages]);

  const goToNextPage = useCallback(() => goToPage((navigationTargetRef.current ?? currentPage) + 1), [currentPage, goToPage]);
  const goToPrevPage = useCallback(() => goToPage((navigationTargetRef.current ?? currentPage) - 1), [currentPage, goToPage]);

  useEffect(() => {
    if (!canPublishProgress || pageWidth <= 1) return;

    const threshold = currentPage * (pageWidth + spreadGap) * columnsPerTurn + pageWidth * 0.4;
    const offsets = chapterOffsetsRef.current;
    let low = 0;
    let high = offsets.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      if (offsets[middle] <= threshold) low = middle;
      else high = middle - 1;
    }
    const fraction = totalPages > 1 ? currentPage / (totalPages - 1) : 0;
    lastProgressFractionRef.current = fraction;
    onProgressUpdateRef.current(chapters[low]?.id ?? '', fraction, currentPage);
  }, [canPublishProgress, chapters, columnsPerTurn, currentPage, pageWidth, spreadGap, totalPages]);

  const handleScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport || pageWidth <= 1) return;
    const spreadStep = (pageWidth + spreadGap) * columnsPerTurn;
    const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const atEnd = maxLeft > 0 && viewport.scrollLeft >= maxLeft - 1;
    const page = atEnd ? totalPages - 1 : Math.max(0, Math.min(
      Math.floor((viewport.scrollLeft + pageWidth * 0.4) / Math.max(1, spreadStep)),
      totalPages - 1
    ));
    if (navigationTargetRef.current === page) navigationTargetRef.current = undefined;
    setCurrentPage((previous) => previous === page ? previous : page);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('a, button, input, textarea, select, [contenteditable]')) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') {
      event.preventDefault();
      goToNextPage();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      goToPrevPage();
    } else if (event.key === 'Home') {
      event.preventDefault();
      goToPage(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      goToPage(totalPages - 1);
    }
  };

  const handleTouchStart = (event: TouchEvent) => {
    const touch = event.touches.length === 1 ? event.touches[0] : undefined;
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const handleTouchEnd = (event: TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const distance = start.x - touch.clientX;
    if (Math.abs(distance) < 40 || Math.abs(distance) <= Math.abs(start.y - touch.clientY)) return;
    if (distance > 0) goToNextPage();
    else goToPrevPage();
  };

  const isExpanded = Boolean(settings.expandContent);
  const sheetColor = settings.readerSheetColor ?? 'paper';

  const sheetClass =
    sheetColor === 'archive'
      ? styles.sheetArchive
      : sheetColor === 'dark'
      ? styles.sheetDark
      : styles.sheetPaper;

  const modeClass = isExpanded ? styles.expandedContent : styles.boundedSheet;

  const chapterContent = useMemo(() => chapters.map((chapter, index) => (
    <section
      key={chapter.id}
      id={`chapter-${chapter.id}`}
      data-chapter-id={chapter.id}
      ref={(element) => {
        if (element) chapterRefs.current.set(chapter.id, element);
        else chapterRefs.current.delete(chapter.id);
      }}
      className={styles.chapterSection}
    >
      {chapter.title && (
        <h2 className={styles.chapterHeading} style={{ fontSize: `${settings.fontSize * zoom * 1.3}px` }}>
          {chapter.title}
        </h2>
      )}
      <ChapterBody
        className={styles.chapterBody}
        preserveAlignment={settings.rtfPreserveAlignment !== false}
        html={safeChapterContents[index] || ''}
      />
      {index < chapters.length - 1 && <div className={styles.chapterDivider} aria-hidden="true">❖ ❖ ❖</div>}
    </section>
  )), [chapters, safeChapterContents, settings.fontSize, settings.rtfPreserveAlignment, zoom]);

  return (
    <div
      className={styles.container}
      onKeyDown={handleKeyDown}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => { touchStart.current = null; }}
      onWheel={(event) => {
        if (event.ctrlKey || event.metaKey) return;
        // Vertical wheel input can still scroll an oversized page.
        if (Math.abs(event.deltaY) >= Math.abs(event.deltaX)) return;
        if (Math.abs(event.deltaX) < 8 || performance.now() - lastWheelTime.current < 275) return;
        lastWheelTime.current = performance.now();
        if (event.deltaX > 0) goToNextPage();
        else goToPrevPage();
      }}
      tabIndex={0}
      autoFocus
      aria-label={isBook ? 'Book reader content' : 'Paginated reader content'}
    >
      <div
        className={`${styles.viewport} ${modeClass} ${sheetClass} ${isBook ? styles.bookViewport : ''}`}
        data-book-spread={isBook && columnsPerTurn === 2 || undefined}
        ref={viewportRef}
        data-reader-viewport="paginated"
        onScroll={handleScroll}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
          if (ratio > 0.35 && ratio < 0.65) onToggleControls?.();
          else if (ratio >= 0.65) goToNextPage();
          else goToPrevPage();
        }}
        style={{
          maxWidth: isExpanded ? '100%' : `${settings.maxContentWidth}px`,
          paddingLeft: `${settings.contentMargin}px`,
          paddingRight: `${settings.contentMargin}px`,
        }}
      >
        <div
          ref={trackRef}
          className={styles.columnTrack}
          data-rich-content={allowsEmbeddedReaderImages(format) || undefined}
          onLoadCapture={allowsEmbeddedReaderImages(format) ? handleImageLayout : undefined}
          onErrorCapture={allowsEmbeddedReaderImages(format) ? handleImageLayout : undefined}
          style={{
            fontFamily: settings.fontFamily,
            fontSize: `${settings.fontSize * zoom}px`,
            height: `${pageHeight}px`,
            columnWidth: `${pageWidth}px`,
            columnCount: columnsPerTurn,
            width: `${pageWidth * columnsPerTurn + spreadGap * (columnsPerTurn - 1)}px`,
            ['--reader-page-height' as string]: `${pageHeight}px`,
            columnGap: `${spreadGap}px`,
            textAlign: settings.textAlign,
            letterSpacing: `${settings.letterSpacing}px`,
            wordSpacing: `${settings.wordSpacing}px`,
            ['--reader-line-height' as string]: settings.lineHeight,
            ['--reader-paragraph-spacing' as string]: `${settings.paragraphSpacing}em`,
            ['--reader-text-indent' as string]: `${settings.textIndent}em`,
          }}
        >
          {chapterContent}
        </div>
      </div>

      {currentPage > 0 && (
        <button className={`${styles.navZone} ${styles.navLeft}`} onClick={goToPrevPage} title="Previous page" aria-label="Previous page" type="button">
          <span className={styles.navButton}><ChevronLeft size={20} /></span>
        </button>
      )}
      {currentPage < totalPages - 1 && (
        <button className={`${styles.navZone} ${styles.navRight}`} onClick={goToNextPage} title="Next page" aria-label="Next page" type="button">
          <span className={styles.navButton}><ChevronRight size={20} /></span>
        </button>
      )}
      <div className={styles.pageInfo}>
        {columnsPerTurn === 2 ? 'Spread' : 'Page'} {currentPage + 1} of {totalPages}
      </div>
    </div>
  );
}));
