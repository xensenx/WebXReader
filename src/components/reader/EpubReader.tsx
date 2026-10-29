/**
 * EPUB Reader component powered by epub.js.
 */

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import type { CSSProperties } from 'react';
import ePub from 'epubjs';
import type { Rendition, Location } from 'epubjs';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { EffectiveReaderSettings } from '../../hooks/useReaderSettings';
import { createTextExcerpt, extractDomText, findTextMatches, findTextRange } from '../../utils/text-search';
import { showTransientSearchHighlight } from '../../utils/transient-search-highlight';
import type { ReaderSearchResult } from './search-types';
import styles from './EpubReader.module.css';

export interface EpubReaderHandle {
  goToHref: (href: string) => void;
  goToCfi: (cfi: string) => void;
  goToProgress: (fraction: number) => void;
  search: (query: string) => Promise<ReaderSearchResult[]>;
  goToSearchMatch: (href: string, query: string, matchIndex: number) => Promise<void>;
}

interface EpubReaderProps {
  fileData: ArrayBuffer;
  settings: EffectiveReaderSettings;
  initialCfi?: string;
  onProgressUpdate: (cfi: string, progressFraction: number, href?: string) => void;
  onToggleControls?: () => void;
  readerZoom?: number;
  onZoomGesture?: (deltaY: number) => void;
  onZoomTo?: (zoom: number, point?: { x: number; y: number }) => void;
}

type EpubContent = {
  document?: Document;
  sectionIndex?: number;
  cfiFromRange?: (range: Range) => string;
};

type EpubResourceBook = ReturnType<typeof ePub>;

type EpubResources = {
  get: (path: string) => string | Promise<string | undefined> | undefined;
  urls?: string[];
};

type EpubSearchSection = {
  index: number;
  href: string;
  document: Document;
  load: (request?: Function) => Promise<unknown>;
  cfiFromRange: (range: Range) => string;
  unload: () => void;
};

interface EpubSearchSectionIndex {
  index: number;
  href: string;
  title: string;
  text: string;
}

const isInlineOrNetworkUrl = (value: string) =>
  /^(?:data:|blob:|https?:|file:|mailto:|javascript:)/i.test(value.trim());

const withoutFragment = (value: string) => value.split('#')[0].split('?')[0];

const appendCandidate = (candidates: string[], value: string | undefined) => {
  if (!value || candidates.includes(value)) return;
  candidates.push(value);
};

/**
 * EPUBs can reference an asset by its package path, a chapter-relative path,
 * or a URL which has already been substituted by epub.js. Resolve all three
 * forms through epub.js's resource map before the iframe is paginated.
 */
const resolveEpubResource = async (
  book: EpubResourceBook,
  rawSource: string,
  contents: EpubContent
): Promise<string | undefined> => {
  const source = rawSource.trim();
  if (!source || isInlineOrNetworkUrl(source)) return undefined;

  const candidates: string[] = [];
  appendCandidate(candidates, source);
  appendCandidate(candidates, withoutFragment(source));

  const section = typeof contents.sectionIndex === 'number'
    ? book.spine.get(contents.sectionIndex)
    : undefined;
  const baseUrl = section?.url || contents.document?.baseURI;

  if (baseUrl) {
    try {
      appendCandidate(candidates, new URL(source, baseUrl).toString());
      appendCandidate(candidates, new URL(withoutFragment(source), baseUrl).toString());
    } catch {
      // Some archived EPUB paths are not valid browser URLs. The package
      // path candidates below still cover those publications.
    }
  }

  try {
    appendCandidate(candidates, book.resolve(source, true));
  } catch {
    // Keep trying the resource map with the candidates already collected.
  }

  const resources = book.resources as unknown as EpubResources;
  for (const candidate of candidates) {
    const replacement = await Promise.resolve(resources.get(candidate));
    if (typeof replacement === 'string' && replacement.length > 0) {
      return replacement;
    }
  }

  // Match against the manifest when a browser URL and a package-relative URL
  // describe the same asset but do not have identical string forms.
  const normalizedCandidates = candidates.map((candidate) => withoutFragment(candidate));
  const manifestUrl = resources.urls?.find((url) => {
    if (normalizedCandidates.includes(withoutFragment(url))) return true;
    try {
      return normalizedCandidates.includes(withoutFragment(book.resolve(url, true)));
    } catch {
      return false;
    }
  });

  if (manifestUrl) {
    const replacement = await Promise.resolve(resources.get(manifestUrl));
    if (typeof replacement === 'string' && replacement.length > 0) {
      return replacement;
    }
  }

  return undefined;
};

const waitForImageLayout = (image: HTMLImageElement): Promise<void> => {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      image.removeEventListener('load', finish);
      image.removeEventListener('error', finish);
      resolve();
    };

    image.addEventListener('load', finish, { once: true });
    image.addEventListener('error', finish, { once: true });
    window.setTimeout(finish, 1500);
  });
};

const resolveSrcset = async (
  book: EpubResourceBook,
  contents: EpubContent,
  element: Element,
  attribute: string
) => {
  const value = element.getAttribute(attribute);
  if (!value) return;

  const entries = value.split(',');
  const resolvedEntries = await Promise.all(entries.map(async (entry) => {
    const match = entry.trim().match(/^(\S+)(\s+.*)?$/);
    if (!match) return entry;
    const resolved = await resolveEpubResource(book, match[1], contents);
    return resolved ? `${resolved}${match[2] || ''}` : entry;
  }));
  element.setAttribute(attribute, resolvedEntries.join(','));
};

const prepareEpubImageSources = async (
  book: EpubResourceBook,
  contents: EpubContent
) => {
  const document = contents.document;
  if (!document) return [] as HTMLImageElement[];

  const images = Array.from(document.querySelectorAll('img'));
  const svgImages = Array.from(document.querySelectorAll('svg image'));

  await Promise.all(images.map(async (image) => {
    const declaredSource = image.getAttribute('src');
    const lazySource = image.getAttribute('data-src') || image.getAttribute('data-original');
    const source = lazySource && (
      !declaredSource ||
      declaredSource === 'about:blank' ||
      declaredSource.startsWith('data:')
    )
      ? lazySource
      : declaredSource || lazySource;
    if (source) {
      const replacement = await resolveEpubResource(book, source, contents);
      if (replacement) image.setAttribute('src', replacement);
    }
    await resolveSrcset(book, contents, image, 'srcset');
  }));

  await Promise.all(svgImages.map(async (image) => {
    const source = image.getAttribute('href') || image.getAttribute('xlink:href');
    if (!source) return;
    const replacement = await resolveEpubResource(book, source, contents);
    if (replacement) {
      image.setAttribute('href', replacement);
      image.setAttribute('xlink:href', replacement);
    }
  }));

  return images;
};

async function buildEpubSearchIndex(book: EpubResourceBook): Promise<EpubSearchSectionIndex[]> {
  await book.ready;
  const sections: EpubSearchSection[] = [];
  (book.spine as unknown as { each: (callback: (section: EpubSearchSection) => void) => void })
    .each((section) => sections.push(section));

  const index: EpubSearchSectionIndex[] = [];
  const loadSection = book.load.bind(book);
  for (const section of sections) {
    try {
      await section.load(loadSection);
      const text = extractDomText(section.document.body || section.document);
      if (!text.trim()) continue;
      let title = '';
      try {
        title = book.navigation.get(section.href)?.label?.trim() || '';
      } catch {
        // A section may not have a navigation entry.
      }
      index.push({
        index: section.index,
        href: section.href,
        title: title || `Section ${section.index + 1}`,
        text,
      });
    } catch {
      // Continue indexing other readable spine items if one section is malformed.
    } finally {
      try {
        section.unload();
      } catch {
        // Releasing an already unloaded EPUB section is harmless.
      }
    }
  }
  return index;
}

export const EpubReader = forwardRef<EpubReaderHandle, EpubReaderProps>(
  function EpubReader(
    { fileData, settings, initialCfi, onProgressUpdate, onToggleControls, readerZoom = 1, onZoomGesture, onZoomTo },
    ref
  ) {
    const viewerRef = useRef<HTMLDivElement>(null);
    const renditionRef = useRef<Rendition | null>(null);
    const [loading, setLoading] = useState(true);
    const isDoubleSided = settings.readingMode === 'vertical';
    const isPaginated = settings.readingMode === 'paginated' || isDoubleSided;
    const isScrolled = settings.readingMode === 'scroll';
    const bookRef = useRef<ReturnType<typeof ePub> | null>(null);
    const epubSearchIndexRef = useRef<Promise<EpubSearchSectionIndex[]> | null>(null);
    const latestCfiRef = useRef(initialCfi);
    const pendingProgressRef = useRef<number | null>(null);
    const locationsReadyRef = useRef(false);
    const lastPercentageRef = useRef(0);
    const fileIdentityRef = useRef(fileData);

    const onProgressUpdateRef = useRef(onProgressUpdate);
    onProgressUpdateRef.current = onProgressUpdate;

    const onToggleControlsRef = useRef(onToggleControls);
    onToggleControlsRef.current = onToggleControls;

    const onZoomGestureRef = useRef(onZoomGesture);
    onZoomGestureRef.current = onZoomGesture;
    const onZoomToRef = useRef(onZoomTo);
    onZoomToRef.current = onZoomTo;
    const readerZoomRef = useRef(readerZoom);
    readerZoomRef.current = readerZoom;
    const zoomCfiRef = useRef<string | null>(null);
    const zoomWheelDocumentsRef = useRef(new WeakSet<Document>());

    const initialCfiRef = useRef(initialCfi);

    useEffect(() => {
      initialCfiRef.current = initialCfi;
      if (!latestCfiRef.current) latestCfiRef.current = initialCfi;
    }, [initialCfi]);

    // Apply themes to epubjs rendition
    const applyTheme = useCallback(
      (rendition: Rendition) => {
        let bg = '#ffffff';
        let color = '#1a1a1a';
        if (settings.theme === 'dark') {
          bg = '#1a1a1a';
          color = '#e4e4e7';
        } else if (settings.theme === 'sepia') {
          bg = '#faf6eb';
          color = '#3d3226';
        }

        rendition.themes.default({
          html: {
            'box-sizing': 'border-box !important',
            'touch-action': 'pan-x pan-y !important',
          },
          body: {
            background: `${bg} !important`,
            color: `${color} !important`,
            'font-family': `${settings.fontFamily} !important`,
            'font-size': `${settings.fontSize * readerZoom}px !important`,
            'line-height': `${settings.lineHeight} !important`,
            'text-align': `${settings.textAlign} !important`,
            'letter-spacing': `${settings.letterSpacing}px !important`,
            'word-spacing': `${settings.wordSpacing}px !important`,
            'box-sizing': 'border-box !important',
            'touch-action': 'pan-x pan-y !important',
            margin: '0 !important',
            padding: `0 ${settings.contentMargin}px !important`,
          },
          'html *': {
            'box-sizing': 'border-box !important',
          },
          'html, body': {
            width: '100% !important',
            'max-width': '100% !important',
            overflow: 'hidden !important',
            'overflow-wrap': 'anywhere !important',
          },
          '::selection': {
            background: 'rgba(250, 204, 21, 0.42) !important',
            color: 'inherit !important',
          },
          '::highlight(webx-search-result)': {
            'background-color': 'rgba(250, 204, 21, 0.42) !important',
            color: 'inherit !important',
          },
          'body > *:not(img):not(svg):not(video):not(canvas)': {
            'max-width': '100% !important',
          },
          p: {
            'margin-bottom': `${settings.paragraphSpacing}em !important`,
            'text-indent': `${settings.textIndent}em !important`,
          },
          'img, svg, video, canvas, figure, table': {
            'break-inside': 'avoid !important',
            'page-break-inside': 'avoid !important',
          },
          'img, svg, video, canvas': {
            display: 'block !important',
            width: 'auto !important',
            // Fit only the horizontal axis. The intrinsic height remains
            // available, so portrait art is not compressed and landscape art
            // cannot be clipped by the iframe's horizontal viewport.
            'max-width': '100% !important',
            'max-height': 'none !important',
            height: 'auto !important',
            'object-fit': 'initial !important',
            margin: '1em auto !important',
          },
          figure: {
            'max-width': '100% !important',
            margin: '1em auto !important',
          },
          a: {
            color: 'var(--color-accent) !important',
          },
        });
      },
      [settings, readerZoom]
    );
    const applyThemeRef = useRef(applyTheme);
    applyThemeRef.current = applyTheme;

    const searchBook = useCallback(async (query: string): Promise<ReaderSearchResult[]> => {
      const book = bookRef.current;
      const normalizedQuery = query.trim();
      if (!book || normalizedQuery.length < 2) return [];
      if (!epubSearchIndexRef.current) {
        epubSearchIndexRef.current = buildEpubSearchIndex(book).catch((error: unknown) => {
          epubSearchIndexRef.current = null;
          throw error;
        });
      }

      const index = await epubSearchIndexRef.current;
      const results: ReaderSearchResult[] = [];
      for (const section of index) {
        const matches = findTextMatches(section.text, normalizedQuery, 100 - results.length);
        matches.forEach((match, matchIndex) => {
          results.push({
            chapterId: section.href,
            chapterTitle: section.title,
            ...createTextExcerpt(section.text, match),
            offset: match.start,
            matchIndex,
            href: section.href,
          });
        });
        if (results.length >= 100) break;
      }
      return results;
    }, []);

    const goToSearchMatch = useCallback(async (href: string, query: string, matchIndex: number) => {
      const book = bookRef.current;
      const rendition = renditionRef.current;
      if (!book || !rendition) return;
      const section = book.spine.get(href) as unknown as EpubSearchSection | undefined;
      if (!section) return;

      let cfi: string | undefined;
      try {
        await section.load(book.load.bind(book));
        const range = findTextRange(section.document.body || section.document, query, matchIndex);
        if (range) cfi = section.cfiFromRange(range);
      } finally {
        try {
          section.unload();
        } catch {
          // The section may already be released if it was not in the cache.
        }
      }

      if (!cfi || bookRef.current !== book || renditionRef.current !== rendition) return;
      latestCfiRef.current = cfi;
      await rendition.display(cfi);
      const visibleRange = rendition.getRange(cfi);
      if (visibleRange) showTransientSearchHighlight(visibleRange);
    }, []);

    useImperativeHandle(ref, () => ({
      goToHref: (href: string) => {
        if (renditionRef.current) {
          renditionRef.current.display(href);
        }
      },
      goToCfi: (cfi: string) => {
        if (renditionRef.current) {
          latestCfiRef.current = cfi;
          renditionRef.current.display(cfi);
        }
      },
      goToProgress: (fraction: number) => {
        const book = bookRef.current;
        const rendition = renditionRef.current;
        const clamped = Math.min(1, Math.max(0, fraction));
        if (!book || !rendition || !locationsReadyRef.current) {
          pendingProgressRef.current = clamped;
          return;
        }
        const cfi = book.locations.cfiFromPercentage(clamped);
        if (cfi) {
          latestCfiRef.current = cfi;
          void rendition.display(cfi);
        }
      },
      search: searchBook,
      goToSearchMatch,
    }), [goToSearchMatch, searchBook]);

    // Initialize epub.js book and rendition
    useEffect(() => {
      if (!viewerRef.current || !fileData) return;
      let active = true;
      setLoading(true);

      if (fileIdentityRef.current !== fileData) {
        fileIdentityRef.current = fileData;
        latestCfiRef.current = initialCfiRef.current;
        lastPercentageRef.current = 0;
        pendingProgressRef.current = null;
      }
      const book = ePub(fileData);
      bookRef.current = book;
      epubSearchIndexRef.current = null;
      locationsReadyRef.current = false;
      const rendition = book.renderTo(viewerRef.current, {
        width: '100%',
        height: '100%',
        // The continuous manager keeps adjacent spine sections in the same
        // native scroll surface. The default manager only mounts one section,
        // which makes a long EPUB feel like a sequence of page turns.
        manager: isScrolled ? 'continuous' : 'default',
        flow: isScrolled ? 'scrolled' : 'paginated',
        spread: isDoubleSided ? 'always' : 'none',
        // epub.js creates its manager asynchronously in attachTo(). Passing
        // these at construction time is important; mutating rendition.manager
        // immediately after renderTo() is too early and leaves virtualization
        // enabled in continuous mode. Keeping the spine mounted makes the
        // native scroll origin stable in both directions.
        ...(isScrolled
          ? { offset: Number.MAX_SAFE_INTEGER, offsetDelta: Number.MAX_SAFE_INTEGER }
          : {}),
        allowScriptedContent: false,
      });

      renditionRef.current = rendition;

      // Resolve image references while the spine document is still being
      // serialized. This runs before epub.js measures columns, unlike the
      // rendition content hook which runs after the initial view layout.
      book.spine.hooks.content.register(async (document: Document, section: { index?: number }) => {
        await prepareEpubImageSources(book, {
          document,
          sectionIndex: section.index,
        });
      });

      applyThemeRef.current(rendition);

      // epub.js runs its built-in image adjustment before the publication is
      // laid out. Some EPUBs therefore receive a zero/too-small max-height
      // and their images become invisible. Re-apply the reader constraints at
      // the content-document level after epub.js's own content hooks, while
      // also recovering common lazy-image attributes used by EPUB exports.
      rendition.hooks.content.register(async (contents: EpubContent) => {
        const document = contents.document;
        if (!document) return;

        // EPUB content lives in same-origin iframes, so its wheel events do
        // not bubble to the outer reader stage. Intercept browser zoom in each
        // content document and preserve the text point beneath the pointer.
        if (!zoomWheelDocumentsRef.current.has(document)) {
          zoomWheelDocumentsRef.current.add(document);
          const contentWindow = document.defaultView;
          let pinchStart: { distance: number; zoom: number } | null = null;
          let pendingPinchZoom: { zoom: number; point?: { x: number; y: number } } | null = null;
          let pinchZoomFrame: number | null = null;
          let lastPinchZoomAt = 0;

          const captureZoomCfi = (x: number, y: number) => {
            const position = document.caretPositionFromPoint?.(x, y);
            const range = position
              ? document.createRange()
              : document.caretRangeFromPoint?.(x, y) ?? null;
            if (position && range) {
              range.setStart(position.offsetNode, position.offset);
              range.collapse(true);
            }
            zoomCfiRef.current = null;
            if (!range || !contents.cfiFromRange) return;
            try {
              zoomCfiRef.current = contents.cfiFromRange(range);
            } catch {
              zoomCfiRef.current = null;
            }
          };

          const flushPinchZoom = () => {
            const frameWindow = contentWindow;
            if (!frameWindow) return;
            if (pendingPinchZoom && frameWindow.performance.now() - lastPinchZoomAt < 40) {
              pinchZoomFrame = frameWindow.requestAnimationFrame(flushPinchZoom);
              return;
            }
            pinchZoomFrame = null;
            const pending = pendingPinchZoom;
            pendingPinchZoom = null;
            if (!pending) return;
            lastPinchZoomAt = frameWindow.performance.now();
            onZoomToRef.current?.(pending.zoom, pending.point);
          };

          contentWindow?.addEventListener('wheel', (event: WheelEvent) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            event.stopImmediatePropagation();

            captureZoomCfi(event.clientX, event.clientY);

            const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
              ? event.deltaY * 16
              : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                ? event.deltaY * (document.defaultView?.innerHeight || window.innerHeight)
                : event.deltaY;
            onZoomGestureRef.current?.(delta);
          }, { capture: true, passive: false });

          contentWindow?.addEventListener('touchstart', (event: TouchEvent) => {
            if (event.touches.length < 2) return;
            const first = event.touches[0];
            const second = event.touches[1];
            if (!first || !second) return;
            pinchStart = {
              distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
              zoom: readerZoomRef.current,
            };
            event.stopImmediatePropagation();
          }, { capture: true, passive: true });

          contentWindow?.addEventListener('touchmove', (event: TouchEvent) => {
            if (!pinchStart || event.touches.length < 2) return;
            const first = event.touches[0];
            const second = event.touches[1];
            if (!first || !second) return;
            if (event.cancelable) event.preventDefault();
            event.stopImmediatePropagation();

            const x = (first.clientX + second.clientX) / 2;
            const y = (first.clientY + second.clientY) / 2;
            captureZoomCfi(x, y);
            const frame = document.defaultView?.frameElement as HTMLElement | null;
            const frameRect = frame?.getBoundingClientRect();
            const point = frameRect
              ? { x: frameRect.left + x, y: frameRect.top + y }
              : undefined;
            const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
            if (pinchStart.distance > 0) {
              pendingPinchZoom = { zoom: pinchStart.zoom * distance / pinchStart.distance, point };
              if (pinchZoomFrame === null && contentWindow) {
                pinchZoomFrame = contentWindow.requestAnimationFrame(flushPinchZoom);
              }
            }
          }, { capture: true, passive: false });

          const finishPinch = (event: TouchEvent) => {
            if (!pinchStart) return;
            event.stopImmediatePropagation();
            if (event.touches.length < 2) pinchStart = null;
          };
          contentWindow?.addEventListener('touchend', finishPinch, { capture: true, passive: true });
          contentWindow?.addEventListener('touchcancel', finishPinch, { capture: true, passive: true });
        }

        const images = await prepareEpubImageSources(book, contents);
        await Promise.all(images.map(async (image) => {
          image.setAttribute('loading', 'eager');
          image.setAttribute('decoding', 'sync');
          await waitForImageLayout(image);
        }));

        document.querySelectorAll('img, svg, svg image, video, canvas').forEach((media) => {
          const element = media as HTMLElement;
          element.style.setProperty('display', 'block', 'important');
          element.style.setProperty('width', 'auto', 'important');
          element.style.setProperty('height', 'auto', 'important');
          element.style.setProperty('max-width', '100%', 'important');
          element.style.setProperty('max-height', 'none', 'important');
          element.style.setProperty('object-fit', 'initial', 'important');
          element.style.setProperty('break-inside', 'avoid', 'important');
          element.style.setProperty('page-break-inside', 'avoid', 'important');
        });

        document.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote').forEach((block) => {
          const element = block as HTMLElement;
          element.style.setProperty('max-width', '100%', 'important');
          element.style.setProperty('overflow-wrap', 'anywhere', 'important');
        });
      });

      // Display as soon as the first section is ready. Generating a location
      // index can be expensive for large books and must not block reading.
      book.ready
        .then(() => rendition.display(latestCfiRef.current || initialCfiRef.current || undefined))
        .then(() => {
          if (active) setLoading(false);
        })
        .catch((err) => {
          console.warn('Could not display initial EPUB location:', err);
          if (active) setLoading(false);
        });

      // Build the index in the background for accurate percentage progress.
      book.ready
        .then(() => book.locations.generate(1000))
        .then(() => {
          if (!active) return;
          locationsReadyRef.current = true;
          const pending = pendingProgressRef.current;
          if (pending === null) return;
          pendingProgressRef.current = null;
          const cfi = book.locations.cfiFromPercentage(pending);
          if (cfi) {
            latestCfiRef.current = cfi;
            void rendition.display(cfi);
          }
        })
        .catch(() => undefined);

      // Track location changes
      rendition.on('relocated', (location: Location) => {
        if (location && location.start) {
          const cfi = location.start.cfi;
          const indexedPercentage = locationsReadyRef.current
            ? book.locations.percentageFromCfi(cfi)
            : undefined;
          const spineLength = Number((book.spine as unknown as { length?: number })?.length ?? 0);
          const spinePercentage = spineLength > 1 && typeof location.start.index === 'number'
            ? location.start.index / (spineLength - 1)
            : undefined;
          const percentage = indexedPercentage ?? spinePercentage ?? lastPercentageRef.current;
          latestCfiRef.current = cfi;
          lastPercentageRef.current = Math.min(1, Math.max(0, percentage));
          onProgressUpdateRef.current(cfi, lastPercentageRef.current, location.start.href);
        }
      });

      // Attach click event to iframe
      rendition.on('click', () => {
        onToggleControlsRef.current?.();
      });

      return () => {
        active = false;
        if (bookRef.current === book) bookRef.current = null;
        if (renditionRef.current === rendition) renditionRef.current = null;
        locationsReadyRef.current = false;
        try {
          rendition.destroy();
          book.destroy();
        } catch {
          // ignore cleanup errors
        }
      };
    }, [fileData, isScrolled, isDoubleSided]);

    // Update themes when settings change
    useEffect(() => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      applyTheme(rendition);

      const zoomCfi = zoomCfiRef.current;
      zoomCfiRef.current = null;
      if (!zoomCfi) return;
      const frame = requestAnimationFrame(() => {
        if (renditionRef.current === rendition) void rendition.display(zoomCfi);
      });
      return () => cancelAnimationFrame(frame);
    }, [applyTheme]);

    const prevPage = () => {
      if (renditionRef.current) {
        void renditionRef.current.prev();
      }
    };

    const nextPage = () => {
      if (renditionRef.current) {
        void renditionRef.current.next();
      }
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!isPaginated) return;
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        prevPage();
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        nextPage();
      }
    };

    return (
      <div
        className={styles.container}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        autoFocus
      >
        {loading && (
          <div className={styles.loading}>
            <div className={styles.spinner} />
            <span>Loading publication…</span>
          </div>
        )}

        <div
          ref={viewerRef}
          className={`${styles.viewer} ${isScrolled ? styles.scrollViewer : styles.paginatedViewer}`}
          data-reader-viewport={isScrolled ? 'epub-vertical-scroll' : 'epub-paginated'}
          style={{ '--epub-page-margin': `${Math.max(32, settings.contentMargin + 12)}px` } as CSSProperties}
        />

        {isPaginated && (
          <>
            <div
              className={`${styles.navZone} ${styles.navLeft}`}
              onClick={prevPage}
              title="Previous Page"
              role="button"
              tabIndex={-1}
            >
              <div className={styles.navButton}>
                <ChevronLeft size={20} />
              </div>
            </div>

            <div
              className={`${styles.navZone} ${styles.navRight}`}
              onClick={nextPage}
              title="Next Page"
              role="button"
              tabIndex={-1}
            >
              <div className={styles.navButton}>
                <ChevronRight size={20} />
              </div>
            </div>
          </>
        )}
      </div>
    );
  }
);
