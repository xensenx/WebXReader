/**
 * Reflowable page reader for normalized TXT, Markdown, and HTML content.
 *
 * CSS columns do the actual layout. A short measuring pass determines how
 * many rendered columns are needed for the current viewport and typography;
 * navigation then moves by those real columns rather than by character count.
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
  useMemo,
  memo,
  type KeyboardEvent,
  type TouchEvent,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Chapter } from '../../types/book';
import type { EffectiveReaderSettings } from '../../hooks/useReaderSettings';
import { sanitizeReaderHtml } from '../../core/parsing/sanitize-reader-html';
import styles from './PaginatedReader.module.css';

export interface PaginatedReaderProps {
  chapters: Chapter[];
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

export const PaginatedReader = memo(function PaginatedReader({
  chapters,
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
}: PaginatedReaderProps) {
  const safeChapterContents = useMemo(
    () => chapters.map((chapter) => sanitizeReaderHtml(chapter.content)),
    [chapters],
  );
  const [currentPage, setCurrentPage] = useState(Math.max(0, initialPageIndex));
  const [totalPages, setTotalPages] = useState(1);
  const [pageHeight, setPageHeight] = useState(1);
  const [pageWidth, setPageWidth] = useState(1);
  const [columnCount, setColumnCount] = useState(1);
  const [isMeasuring, setIsMeasuring] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const chapterRefs = useRef<Map<string, HTMLElement>>(new Map());
  const onProgressUpdateRef = useRef(onProgressUpdate);
  const touchStartX = useRef<number | null>(null);
  const lastProgressFractionRef = useRef(initialProgressFraction);
  const pendingRestoreFractionRef = useRef(initialProgressFraction);
  const previousZoomRef = useRef(zoom);
  const zoomAnchorRef = useRef(zoomAnchor);
  const initialLayoutAppliedRef = useRef(false);
  const hasMeasuredLayoutRef = useRef(false);
  const spreadGap = pagesPerSpread === 2 ? 24 : 0;
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
    const pageWidth = pagesPerSpread === 2
      ? Math.max(1, Math.floor((availableWidth - spreadGap) / 2))
      : availableWidth;
    const viewportHeight = Math.max(1, viewport.clientHeight - verticalPadding);
    return {
      width: pageWidth,
      // Reflowable pages use a paper-like A4 proportion. The viewport remains
      // the minimum so short/mobile layouts never create an unnecessary
      // scroll range, while desktop pages can be read by scrolling within the
      // current page without crossing into the next one.
      height: Math.max(viewportHeight, Math.round(pageWidth * 1.4142)),
    };
  }, [pagesPerSpread, spreadGap]);

  const startMeasurement = useCallback(() => {
    const dimensions = getViewportDimensions();
    if (!dimensions || dimensions.width <= 1 || dimensions.height <= 1) return;

    const zoomChanged = previousZoomRef.current !== zoom;
    previousZoomRef.current = zoom;
    const restoreFraction = zoomChanged && zoomAnchorRef.current
      ? zoomAnchorRef.current.scrollRatioX
      : lastProgressFractionRef.current;
    pendingRestoreFractionRef.current = Math.min(1, Math.max(0, restoreFraction));
    setPageWidth(dimensions.width);
    setPageHeight(dimensions.height);
    setColumnCount(1);
    setIsMeasuring(true);
    hasMeasuredLayoutRef.current = false;
  }, [getViewportDimensions, zoom]);

  // Reflow when typography, zoom, chapters, or the viewport changes.
  useLayoutEffect(() => {
    startMeasurement();
  }, [layoutKey, chapters, startMeasurement]);

  useEffect(() => {
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => startMeasurement())
      : null;
    if (observer && viewportRef.current) observer.observe(viewportRef.current);
    window.addEventListener('resize', startMeasurement);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', startMeasurement);
    };
  }, [startMeasurement]);

  // First pass: let one column grow naturally so its rendered height is the
  // source of truth for the number of pages.
  useLayoutEffect(() => {
    if (!isMeasuring || pageWidth <= 1 || pageHeight <= 1) return;
    const frame = requestAnimationFrame(() => {
      const track = trackRef.current;
      if (!track) return;
      const naturalHeight = Math.max(pageHeight, track.scrollHeight);
      const measuredColumns = Math.max(1, Math.ceil(naturalHeight / pageHeight));
      setColumnCount(measuredColumns);
      setIsMeasuring(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [isMeasuring, pageHeight, pageWidth]);

  // Second pass: verify the actual horizontal overflow after columns are
  // created, then restore the semantic position in the new layout.
  useLayoutEffect(() => {
    if (isMeasuring || pageWidth <= 1 || pageHeight <= 1) return;
    const frame = requestAnimationFrame(() => {
      const track = trackRef.current;
      const viewport = viewportRef.current;
      if (!track || !viewport) return;

      const actualColumns = Math.max(1, Math.ceil(
        (track.scrollWidth + spreadGap) / Math.max(1, pageWidth + spreadGap)
      ));
      if (actualColumns !== columnCount) {
        setColumnCount(actualColumns);
        return;
      }

      const actualPages = Math.max(1, Math.ceil(actualColumns / pagesPerSpread));
      const spreadWidth = pageWidth * pagesPerSpread + spreadGap * Math.max(0, pagesPerSpread - 1);
      setTotalPages(actualPages);
      const chapterPage = initialChapterId
        ? Math.floor((chapterRefs.current.get(initialChapterId)?.offsetLeft ?? 0) / spreadWidth)
        : 0;
      const targetPage = initialLayoutAppliedRef.current
        ? Math.round(pendingRestoreFractionRef.current * Math.max(0, actualPages - 1))
        : (initialProgressMode === 'paginated' || initialProgressMode === 'vertical')
          ? Math.max(0, Math.min(initialPageIndex > 0 ? initialPageIndex : chapterPage, actualPages - 1))
          : Math.round(initialProgressFraction * Math.max(0, actualPages - 1));

      const clampedPage = Math.max(0, Math.min(targetPage, actualPages - 1));
      setCurrentPage(clampedPage);
      viewport.scrollLeft = clampedPage * spreadWidth;
      lastProgressFractionRef.current = actualPages > 1
        ? clampedPage / (actualPages - 1)
        : 0;
      initialLayoutAppliedRef.current = true;
      hasMeasuredLayoutRef.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [columnCount, initialChapterId, initialPageIndex, initialProgressFraction, initialProgressMode, isMeasuring, pageHeight, pageWidth, pagesPerSpread, spreadGap]);

  const goToPage = useCallback((page: number) => {
    const nextPage = Math.max(0, Math.min(page, totalPages - 1));
    setCurrentPage(nextPage);
    lastProgressFractionRef.current = totalPages > 1 ? nextPage / (totalPages - 1) : 0;
    if (viewportRef.current && pageWidth > 1) {
      const spreadWidth = pageWidth * pagesPerSpread + spreadGap * Math.max(0, pagesPerSpread - 1);
      viewportRef.current.scrollTo({ left: nextPage * spreadWidth, behavior: 'smooth' });
    }
  }, [pageWidth, pagesPerSpread, spreadGap, totalPages]);

  const goToNextPage = useCallback(() => goToPage(currentPage + 1), [currentPage, goToPage]);
  const goToPrevPage = useCallback(() => goToPage(currentPage - 1), [currentPage, goToPage]);

  useEffect(() => {
    if (!hasMeasuredLayoutRef.current || isMeasuring || pageWidth <= 1) return;

    let activeChapterId = chapters[0]?.id || '';
    const spreadWidth = pageWidth * pagesPerSpread + spreadGap * Math.max(0, pagesPerSpread - 1);
    const currentLeft = currentPage * spreadWidth;
    for (const chapter of chapters) {
      const element = chapterRefs.current.get(chapter.id);
      if (element && element.offsetLeft <= currentLeft + pageWidth * 0.4) {
        activeChapterId = chapter.id;
      }
    }

    const fraction = totalPages > 1 ? currentPage / (totalPages - 1) : 0;
    lastProgressFractionRef.current = fraction;
    onProgressUpdateRef.current(activeChapterId, fraction, currentPage);
  }, [chapters, currentPage, isMeasuring, pageWidth, pagesPerSpread, spreadGap, totalPages]);

  const handleScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport || pageWidth <= 1 || isMeasuring) return;
    const spreadWidth = pageWidth * pagesPerSpread + spreadGap * Math.max(0, pagesPerSpread - 1);
    const page = Math.max(0, Math.min(
      Math.round(viewport.scrollLeft / Math.max(1, spreadWidth)),
      totalPages - 1
    ));
    setCurrentPage((previous) => previous === page ? previous : page);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event: TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - (event.changedTouches[0]?.clientX ?? touchStartX.current);
    if (Math.abs(diff) > 40) {
      if (diff > 0) goToNextPage();
      else goToPrevPage();
    }
    touchStartX.current = null;
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

  return (
    <div
      className={styles.container}
      onKeyDown={handleKeyDown}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onWheel={(event) => {
        if (event.ctrlKey || event.metaKey) return;
        // Let the current page consume native vertical scrolling when it has
        // overflow. If it does not, cancel the wheel so browsers do not map a
        // vertical wheel into horizontal page movement. Only a deliberate
        // horizontal gesture can shift the page/spread.
        if (Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
          const viewport = viewportRef.current;
          if (!viewport || viewport.scrollHeight <= viewport.clientHeight + 1) {
            event.preventDefault();
          }
          return;
        }
        if (Math.abs(event.deltaX) < 8) return;
        event.preventDefault();
        if (event.deltaX > 0) goToNextPage();
        else goToPrevPage();
      }}
      tabIndex={0}
      autoFocus
      aria-label={pagesPerSpread === 2 ? 'Double-sided reader content' : 'Paginated reader content'}
    >
      <div
        className={`${styles.viewport} ${modeClass} ${sheetClass}`}
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
          style={{
            fontFamily: settings.fontFamily,
            fontSize: `${settings.fontSize * zoom}px`,
            height: isMeasuring ? 'auto' : `${pageHeight}px`,
            columnWidth: `${pageWidth}px`,
            columnCount: isMeasuring ? 1 : columnCount,
            width: `${Math.max(pageWidth, pageWidth * (isMeasuring ? 1 : columnCount) + spreadGap * Math.max(0, (isMeasuring ? 1 : columnCount) - 1))}px`,
            columnGap: `${spreadGap}px`,
            textAlign: settings.textAlign,
            letterSpacing: `${settings.letterSpacing}px`,
            wordSpacing: `${settings.wordSpacing}px`,
            ['--reader-line-height' as string]: settings.lineHeight,
            ['--reader-paragraph-spacing' as string]: `${settings.paragraphSpacing}em`,
            ['--reader-text-indent' as string]: `${settings.textIndent}em`,
          }}
        >
          {chapters.map((chapter, index) => (
            <section
              key={chapter.id}
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
              <div className={styles.chapterBody} data-chapter-body="true" data-rtf-preserve-align={settings.rtfPreserveAlignment === false ? 'false' : 'true'} dangerouslySetInnerHTML={{ __html: safeChapterContents[index] || '' }} />
              {index < chapters.length - 1 && <div className={styles.chapterDivider} aria-hidden="true">❖ ❖ ❖</div>}
            </section>
          ))}
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
        {pagesPerSpread === 2 ? 'Spread' : 'Page'} {currentPage + 1} of {totalPages}
      </div>
    </div>
  );
});
