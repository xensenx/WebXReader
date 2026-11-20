/**
 * Vertical scroll reader component.
 */

import { useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo, type UIEvent } from 'react';
import type { Chapter } from '../../types/book';
import type { EffectiveReaderSettings } from '../../hooks/useReaderSettings';
import { sanitizeReaderHtml, sanitizeMhtReaderHtml } from '../../core/parsing/sanitize-reader-html';
import { ChapterBody } from './ChapterBody';
import styles from './ScrollReader.module.css';

interface ScrollReaderProps {
  chapters: Chapter[];
  isMht?: boolean;
  settings: EffectiveReaderSettings;
  initialScrollPosition?: number;
  initialChapterId?: string;
  initialProgressFraction?: number;
  initialProgressMode?: string;
  onProgressUpdate: (chapterId: string, progressFraction: number, scrollPos: number) => void;
  onToggleControls?: () => void;
  zoom?: number;
  zoomAnchor?: { x?: number; y?: number; scrollRatioX?: number; scrollRatioY?: number; viewportX?: number; viewportY?: number; flowAnchor?: { element: HTMLElement; fractionY: number } };
}

export const ScrollReader = memo(function ScrollReader({
  chapters,
  isMht = false,
  settings,
  initialScrollPosition = 0,
  initialChapterId,
  initialProgressFraction = 0,
  initialProgressMode = 'scroll',
  onProgressUpdate,
  onToggleControls,
  zoom = 1,
  zoomAnchor,
}: ScrollReaderProps) {
  const safeChapterContents = useMemo(
    () => {
      const sanitize = isMht ? sanitizeMhtReaderHtml : sanitizeReaderHtml;
      return chapters.map((chapter) => sanitize(chapter.content));
    },
    [chapters, isMht],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const isInitialRestored = useRef(false);
  const chapterRefs = useRef<Map<string, HTMLElement>>(new Map());
  const onProgressUpdateRef = useRef(onProgressUpdate);
  onProgressUpdateRef.current = onProgressUpdate;
  const rafId = useRef<number | null>(null);
  const lastProgressFractionRef = useRef(initialProgressFraction);
  const lastZoomRef = useRef(zoom);
  const lastLayoutKeyRef = useRef<string | null>(null);
  const zoomAnchorRef = useRef(zoomAnchor);
  zoomAnchorRef.current = zoomAnchor;

  const layoutKey = [
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.paragraphSpacing,
    settings.letterSpacing,
    settings.wordSpacing,
    settings.maxContentWidth,
    settings.contentMargin,
    settings.expandContent,
    zoom,
  ].join('|');

  // Restore initial position on mount
  useEffect(() => {
    let frame: number | null = null;

    const restore = () => {
      const container = containerRef.current;
      if (isInitialRestored.current) return;
      if (!container || container.clientHeight <= 0) {
        frame = requestAnimationFrame(restore);
        return;
      }

      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      if (initialProgressMode === 'scroll' && initialScrollPosition > 0) {
        container.scrollTop = Math.min(initialScrollPosition, maxScroll);
      } else if (initialProgressMode !== 'scroll' && initialProgressFraction > 0) {
        container.scrollTop = initialProgressFraction * maxScroll;
      } else if (initialChapterId && chapterRefs.current.has(initialChapterId)) {
        const chapter = chapterRefs.current.get(initialChapterId);
        if (chapter) container.scrollTop = Math.min(chapter.offsetTop, maxScroll);
      } else if (initialScrollPosition > 0) {
        container.scrollTop = Math.min(initialScrollPosition, maxScroll);
      }

      lastProgressFractionRef.current = maxScroll > 0
        ? container.scrollTop / maxScroll
        : initialProgressFraction;
      isInitialRestored.current = true;
    };

    frame = requestAnimationFrame(restore);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [initialChapterId, initialScrollPosition, initialProgressFraction, initialProgressMode, chapters]);

  // A typography or viewport change changes the scroll geometry. Restore the
  // semantic position rather than leaving the reader at a stale pixel offset.
  useLayoutEffect(() => {
    if (lastLayoutKeyRef.current === null) {
      lastLayoutKeyRef.current = layoutKey;
      return;
    }
    if (lastLayoutKeyRef.current === layoutKey) return;
    lastLayoutKeyRef.current = layoutKey;

    const zoomChanged = lastZoomRef.current !== zoom;
    lastZoomRef.current = zoom;
    const container = containerRef.current;
    if (!container) return;
    const anchor = zoomChanged ? zoomAnchorRef.current : undefined;
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    let targetTop = anchor?.scrollRatioY !== undefined && anchor.viewportY !== undefined
      ? anchor.scrollRatioY * container.scrollHeight - anchor.viewportY
      : lastProgressFractionRef.current * maxScroll;
    const flowAnchor = anchor?.flowAnchor;
    if (flowAnchor && anchor.viewportY !== undefined && container.contains(flowAnchor.element)) {
      const rect = flowAnchor.element.getBoundingClientRect();
      targetTop = container.scrollTop + rect.top - container.getBoundingClientRect().top
        + rect.height * flowAnchor.fractionY - anchor.viewportY;
    }
    container.scrollTop = Math.min(maxScroll, Math.max(0, targetTop));

    const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    if (settings.expandContent || maxLeft === 0) {
      container.scrollLeft = 0;
    } else if (anchor?.scrollRatioX !== undefined && anchor.viewportX !== undefined) {
      const targetLeft = anchor.scrollRatioX * container.scrollWidth - anchor.viewportX;
      container.scrollLeft = Math.min(maxLeft, Math.max(0, targetLeft));
    } else if (zoomChanged && container.scrollLeft === 0) {
      container.scrollLeft = maxLeft / 2;
    }
  }, [layoutKey, settings.expandContent, zoom]);

  // Clean up RAF on unmount
  useEffect(() => {
    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, []);

  // Handle scroll events and determine active chapter + progress
  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      if (rafId.current !== null) return;

      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        const { scrollTop, scrollHeight, clientHeight } = target;
        const maxScroll = Math.max(1, scrollHeight - clientHeight);
        const overallFraction = Math.min(1, Math.max(0, scrollTop / maxScroll));
        lastProgressFractionRef.current = overallFraction;

        const viewport = target.getBoundingClientRect();
        const threshold = viewport.top + viewport.height * 0.4;
        let activeChapterId = chapters[0]?.id || '';
        let low = 0;
        let high = chapters.length - 1;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          const chapter = chapters[middle];
          const element = chapterRefs.current.get(chapter.id);
          if (element && element.getBoundingClientRect().top <= threshold) {
            activeChapterId = chapter.id;
            low = middle + 1;
          } else {
            high = middle - 1;
          }
        }

        onProgressUpdateRef.current(activeChapterId, overallFraction, scrollTop);
      });
    },
    [chapters]
  );

  const isExpanded = Boolean(settings.expandContent);
  const sheetColor = settings.readerSheetColor ?? 'paper';

  const sheetClass =
    sheetColor === 'archive'
      ? styles.sheetArchive
      : sheetColor === 'dark'
      ? styles.sheetDark
      : styles.sheetPaper;

  const modeClass = isExpanded ? styles.expandedContent : styles.boundedSheet;
  const canvasWidth = Math.round(settings.maxContentWidth * zoom);

  return (
    <div
      ref={containerRef}
      className={styles.container}
      data-reader-viewport="vertical-scroll"
      data-mht={isMht || undefined}
      onScroll={handleScroll}
      onClick={(e) => {
        // Toggle controls if clicking on background/margins
        if (e.target === containerRef.current) {
          onToggleControls?.();
        }
      }}
      tabIndex={0}
      autoFocus
      aria-label="Vertical Scroll reader content"
    >
      <div
        className={`${styles.contentWrapper} ${modeClass} ${sheetClass}`}
        style={{
          width: isExpanded
            ? '100%'
            : `${canvasWidth}px`,
          maxWidth: isExpanded ? '100%' : zoom <= 1 ? '100%' : 'none',
          minWidth: !isExpanded && zoom > 1 ? `${canvasWidth}px` : undefined,
          minHeight: isExpanded ? '100%' : `${Math.round(600 * Math.min(1, zoom))}px`,
          borderRadius: isExpanded ? 0 : `${Math.max(4, Math.round(12 * zoom))}px`,
          boxSizing: 'border-box',
          paddingLeft: `${Math.round(settings.contentMargin * (isExpanded ? 1 : zoom))}px`,
          paddingRight: `${Math.round(settings.contentMargin * (isExpanded ? 1 : zoom))}px`,
          paddingTop: isExpanded ? undefined : `${Math.round(40 * zoom)}px`,
          paddingBottom: isExpanded ? undefined : `${Math.round(56 * zoom)}px`,
          fontFamily: settings.fontFamily,
          fontSize: `${settings.fontSize * zoom}px`,
          textAlign: settings.textAlign,
          letterSpacing: `${settings.letterSpacing * (isExpanded ? 1 : zoom)}px`,
          wordSpacing: `${settings.wordSpacing * (isExpanded ? 1 : zoom)}px`,
          ['--reader-line-height' as string]: settings.lineHeight,
          ['--reader-paragraph-spacing' as string]: `${settings.paragraphSpacing}em`,
          ['--reader-text-indent' as string]: `${settings.textIndent}em`,
        }}
      >
        {chapters.map((chapter, index) => (
          <section
            key={chapter.id}
            id={`chapter-${chapter.id}`}
            data-chapter-id={chapter.id}
            ref={(el) => {
              if (el) chapterRefs.current.set(chapter.id, el);
              else chapterRefs.current.delete(chapter.id);
            }}
            className={styles.chapterSection}
          >
            {chapter.title && (
              <h2
                className={styles.chapterHeading}
                style={{ fontSize: `${settings.fontSize * zoom * 1.35}px` }}
              >
                {chapter.title}
              </h2>
            )}

            <ChapterBody
              className={styles.chapterBody}
              preserveAlignment={settings.rtfPreserveAlignment !== false}
              html={safeChapterContents[index] || ''}
            />

            {index < chapters.length - 1 && (
              <div className={styles.chapterDivider} aria-hidden="true">
                ❖ ❖ ❖
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
});
