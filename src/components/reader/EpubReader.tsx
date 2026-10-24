/**
 * EPUB Reader component powered by epub.js.
 */

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import type { CSSProperties } from 'react';
import ePub from 'epubjs';
import type { Rendition, Location } from 'epubjs';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { EffectiveReaderSettings } from '../../hooks/useReaderSettings';
import styles from './EpubReader.module.css';

export interface EpubReaderHandle {
  goToHref: (href: string) => void;
  goToCfi: (cfi: string) => void;
  goToProgress: (fraction: number) => void;
}

interface EpubReaderProps {
  fileData: ArrayBuffer;
  settings: EffectiveReaderSettings;
  initialCfi?: string;
  onProgressUpdate: (cfi: string, progressFraction: number, href?: string) => void;
  onToggleControls?: () => void;
  readerZoom?: number;
}

type EpubContent = {
  document?: Document;
  sectionIndex?: number;
};

type EpubResourceBook = ReturnType<typeof ePub>;

type EpubResources = {
  get: (path: string) => string | Promise<string | undefined> | undefined;
  urls?: string[];
};

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

export const EpubReader = forwardRef<EpubReaderHandle, EpubReaderProps>(
  function EpubReader(
    { fileData, settings, initialCfi, onProgressUpdate, onToggleControls, readerZoom = 1 },
    ref
  ) {
    const viewerRef = useRef<HTMLDivElement>(null);
    const renditionRef = useRef<Rendition | null>(null);
    const [loading, setLoading] = useState(true);
    const isDoubleSided = settings.readingMode === 'vertical';
    const isPaginated = settings.readingMode === 'paginated' || isDoubleSided;
    const isScrolled = settings.readingMode === 'scroll';
    const bookRef = useRef<ReturnType<typeof ePub> | null>(null);
    const latestCfiRef = useRef(initialCfi);
    const pendingProgressRef = useRef<number | null>(null);
    const locationsReadyRef = useRef(false);
    const lastPercentageRef = useRef(0);
    const fileIdentityRef = useRef(fileData);

    const onProgressUpdateRef = useRef(onProgressUpdate);
    onProgressUpdateRef.current = onProgressUpdate;

    const onToggleControlsRef = useRef(onToggleControls);
    onToggleControlsRef.current = onToggleControls;

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
    }));

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
      if (renditionRef.current) {
        applyTheme(renditionRef.current);
      }
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
