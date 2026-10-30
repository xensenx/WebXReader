/**
 * Vertical scroll reader component.
 */

import { useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo, type UIEvent } from 'react';
import type { Chapter } from '../../types/book';
import type { EffectiveReaderSettings } from '../../hooks/useReaderSettings';
import { sanitizeReaderHtml } from '../../core/parsing/sanitize-reader-html';
import styles from './ScrollReader.module.css';

interface ScrollReaderProps {
  chapters: Chapter[];
  settings: EffectiveReaderSettings;
  initialScrollPosition?: number;
  initialChapterId?: string;
  initialProgressFraction?: number;
  initialProgressMode?: string;
  onProgressUpdate: (chapterId: string, progressFraction: number, scrollPos: number) => void;
  onToggleControls?: () => void;
  zoom?: number;
}

export const ScrollReader = memo(function ScrollReader({
  chapters,
  settings,
  initialScrollPosition = 0,
  initialChapterId,
  initialProgressFraction = 0,
  initialProgressMode = 'scroll',
  onProgressUpdate,
  onToggleControls,
  zoom = 1,
}: ScrollReaderProps) {
  const safeChapterContents = useMemo(
    () => chapters.map((chapter) => sanitizeReaderHtml(chapter.content)),
    [chapters],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const isInitialRestored = useRef(false);
  const chapterRefs = useRef<Map<string, HTMLElement>>(new Map());
  const onProgressUpdateRef = useRef(onProgressUpdate);
  onProgressUpdateRef.current = onProgressUpdate;
  const rafId = useRef<number | null>(null);
  const lastProgressFractionRef = useRef(initialProgressFraction);
  const lastLayoutKeyRef = useRef<string | null>(null);

  const layoutKey = [
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.paragraphSpacing,
    settings.letterSpacing,
    settings.wordSpacing,
    settings.maxContentWidth,
    settings.contentMargin,
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

    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTop = lastProgressFractionRef.current * maxScroll;
    });
    return () => cancelAnimationFrame(frame);
  }, [layoutKey]);

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
      const { scrollTop, scrollHeight, clientHeight } = target;

      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }

      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        const maxScroll = Math.max(1, scrollHeight - clientHeight);
        const overallFraction = Math.min(1, Math.max(0, scrollTop / maxScroll));
        lastProgressFractionRef.current = overallFraction;

        // Find current chapter based on scroll position
        let activeChapterId = chapters[0]?.id || '';
        for (const chapter of chapters) {
          const el = chapterRefs.current.get(chapter.id);
          if (el) {
            const rect = el.getBoundingClientRect();
            const containerRect = target.getBoundingClientRect();
            // If top of chapter is within or above the viewport
            if (rect.top <= containerRect.top + containerRect.height * 0.4) {
              activeChapterId = chapter.id;
            }
          }
        }

        onProgressUpdateRef.current(activeChapterId, overallFraction, scrollTop);
      });
    },
    [chapters]
  );

  return (
    <div
      ref={containerRef}
      className={styles.container}
      data-reader-viewport="vertical-scroll"
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
        className={styles.contentWrapper}
        style={{
          maxWidth: `${settings.maxContentWidth}px`,
          paddingLeft: `${settings.contentMargin}px`,
          paddingRight: `${settings.contentMargin}px`,
          fontFamily: settings.fontFamily,
          fontSize: `${settings.fontSize * zoom}px`,
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

            <div
              className={styles.chapterBody}
              data-chapter-body="true"
              data-rtf-preserve-align={settings.rtfPreserveAlignment === false ? 'false' : 'true'}
              dangerouslySetInnerHTML={{ __html: safeChapterContents[index] || '' }}
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
