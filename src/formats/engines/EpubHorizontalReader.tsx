/**
 * EPUB Horizontal Scroll Reader component.
 *
 * Presents the publication in a continuous horizontal scroll layout where
 * text paginates naturally across structured page sheets with CSS multi-column
 * layout, header chapter titles, page numbering, responsive dimensions,
 * vertical-wheel-to-horizontal-scroll translation, chevrons, and keyboard navigation.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useMemo,
} from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import ePub from 'epubjs';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { EffectiveReaderSettings } from '../../hooks/useReaderSettings';
import type { ReaderSearchResult } from '../../components/reader/search-types';
import {
  createTextExcerpt,
  findTextMatches,
} from '../../utils/text-search';
import { getEpubImageSectionLayout } from './epub-image-layout';
import {
  buildEpubThemeCss,
  getEpubSheetColors,
  buildEpubSearchIndex,
  withoutFragment,
  isInlineOrNetworkUrl,
  resolveEpubResource,
  type EpubReaderHandle,
  type EpubZoomAnchor,
  type EpubResourceBook,
  type EpubSearchSection,
  type EpubSearchSectionIndex,
} from './EpubReader';
import {
  calculateFlipBookDimensions,
  type FlipBookDimensions,
} from './epub-flipbook-dimensions';
import {
  sanitizeReaderHtml,
  escapeHtml,
  escapeAttr,
} from '../../core/parsing/sanitize-reader-html';
import { scopeCss } from './EpubDoubleSidedReader';
import styles from './EpubHorizontalReader.module.css';

export interface HorizontalPageInfo {
  globalIndex: number;
  sectionIndex: number;
  sectionHref: string;
  chapterTitle: string;
  columnPageIndex: number;
  totalSectionPages: number;
  isImageOnly: boolean;
  imageSrc?: string;
  imageHtml?: string;
  cfi: string;
  htmlContent: string;
  authorStyles?: string;
}

interface ParsedSection {
  index: number;
  href: string;
  title: string;
  cfi: string;
  isImageOnly: boolean;
  imageSrc?: string;
  imageHtml?: string;
  htmlContent: string;
  textContent: string;
  authorStyles?: string;
}

interface EpubHorizontalReaderProps {
  fileData: ArrayBuffer;
  settings: EffectiveReaderSettings;
  initialCfi?: string;
  initialProgressFraction?: number;
  initialHref?: string;
  onProgressUpdate: (cfi: string, progressFraction: number, href?: string) => void;
  onToggleControls?: () => void;
  readerZoom?: number;
  zoomAnchor?: EpubZoomAnchor;
  onZoomGesture?: (deltaY: number, point?: { x: number; y: number }) => void;
  onZoomTo?: (zoom: number, point?: { x: number; y: number }) => void;
}

const PAGE_GAP = 24;

/**
 * Robustly resolves the target page index when switching from another reading mode
 * (e.g. Double Sided or Vertical Scroll) by testing CFI, spine index, chapter href,
 * and fractional progress in order of specificity.
 */
export function findTargetHorizontalPage(
  pages: HorizontalPageInfo[],
  targetCfi?: string,
  targetProgress?: number,
  targetHref?: string,
  book?: EpubResourceBook | null,
  previousPages?: HorizontalPageInfo[]
): number {
  if (pages.length === 0) return 0;

  // 1. Integer page index passed directly from re-layout of existing horizontal pages
  if (
    typeof targetProgress === 'number' &&
    targetProgress >= 1 &&
    targetProgress === Math.floor(targetProgress)
  ) {
    if (previousPages && previousPages[targetProgress]) {
      const prevInfo = previousPages[targetProgress];
      const matchIdx = pages.findIndex(
        (p) =>
          p.sectionIndex === prevInfo.sectionIndex &&
          p.columnPageIndex === Math.min(p.totalSectionPages - 1, prevInfo.columnPageIndex)
      );
      if (matchIdx >= 0) return matchIdx;
      const secIdx = pages.findIndex((p) => p.sectionIndex === prevInfo.sectionIndex);
      if (secIdx >= 0) return secIdx;
    }
    return Math.min(pages.length - 1, Math.max(0, targetProgress));
  }

  // 2. Try CFI matching
  if (targetCfi) {
    // 2a. Fast extraction of spine index from EPUB CFI pattern /6/(even_number)
    const spineMatch = targetCfi.match(/\/6\/(\d+)/);
    if (spineMatch) {
      const spineSecNum = parseInt(spineMatch[1], 10);
      const spineIdx = Math.floor(spineSecNum / 2) - 1;
      const matchIdx = pages.findIndex((p) => p.sectionIndex === spineIdx);
      if (matchIdx >= 0) return matchIdx;
    }

    // 2b. Query epub.js spine index
    if (book) {
      try {
        const spineSec = book.spine.get(targetCfi) as { index?: number; href?: string } | null;
        if (spineSec && typeof spineSec.index === 'number') {
          const matchIdx = pages.findIndex((p) => p.sectionIndex === spineSec.index);
          if (matchIdx >= 0) return matchIdx;
        }
        if (spineSec?.href) {
          const cleanHref = withoutFragment(spineSec.href).trim();
          const matchIdx = pages.findIndex((p) =>
            withoutFragment(p.sectionHref).includes(cleanHref) ||
            cleanHref.includes(withoutFragment(p.sectionHref))
          );
          if (matchIdx >= 0) return matchIdx;
        }
      } catch {}
    }

    // 2c. Substring match against page CFI or sectionHref
    const matchIdx = pages.findIndex(
      (p) =>
        (p.cfi && (targetCfi.includes(p.cfi) || p.cfi.includes(targetCfi))) ||
        (p.sectionHref && (targetCfi.includes(p.sectionHref) || p.sectionHref.includes(targetCfi)))
    );
    if (matchIdx >= 0) return matchIdx;
  }

  // 3. Try chapter href matching
  if (targetHref) {
    const cleanHref = withoutFragment(targetHref).trim();
    if (cleanHref) {
      const matchIdx = pages.findIndex((p) =>
        withoutFragment(p.sectionHref).includes(cleanHref) ||
        cleanHref.includes(withoutFragment(p.sectionHref))
      );
      if (matchIdx >= 0) return matchIdx;
    }
  }

  // 4. Try fractional targetProgress (e.g. 0.5 for 50% read)
  if (typeof targetProgress === 'number' && targetProgress >= 0 && targetProgress <= 1) {
    return Math.min(
      pages.length - 1,
      Math.max(0, Math.floor(targetProgress * (pages.length - 1)))
    );
  }

  return 0;
}

export const EpubHorizontalReader = forwardRef<EpubReaderHandle, EpubHorizontalReaderProps>(
  function EpubHorizontalReader(
    {
      fileData,
      settings,
      initialCfi,
      initialProgressFraction,
      initialHref,
      onProgressUpdate,
      onToggleControls,
      readerZoom = 1,
      zoomAnchor,
      onZoomGesture,
      onZoomTo,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollTrackRef = useRef<HTMLDivElement>(null);

    const [loading, setLoading] = useState(true);
    const [pages, setPages] = useState<HorizontalPageInfo[]>([]);
    const [activePageIndex, setActivePageIndex] = useState(0);
    const [dimensions, setDimensions] = useState<FlipBookDimensions | null>(null);
    const [isPanning, setIsPanning] = useState(false);
    const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

    const activePageIndexRef = useRef(0);
    activePageIndexRef.current = activePageIndex;

    const pagesRef = useRef<HorizontalPageInfo[]>([]);
    pagesRef.current = pages;

    const dimensionsRef = useRef<FlipBookDimensions | null>(null);
    dimensionsRef.current = dimensions;

    const bookRef = useRef<EpubResourceBook | null>(null);
    const parsedSectionsRef = useRef<ParsedSection[]>([]);
    const initialCfiRef = useRef(initialCfi);
    const initialProgressFractionRef = useRef(initialProgressFraction);
    const initialHrefRef = useRef(initialHref);
    const latestCfiRef = useRef(initialCfi);

    // Initial transition & scroll synchronization refs
    const pendingScrollPageRef = useRef<number | null>(null);
    const isInitialLayoutRef = useRef<boolean>(true);

    // Zoom & pan management refs
    const currentZoomRef = useRef<number>(readerZoom);
    currentZoomRef.current = readerZoom;

    const panRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    panRef.current = pan;

    const pointerPosRef = useRef<{ clientX: number; clientY: number } | null>(null);
    const dragStartRef = useRef<{ x: number; y: number; scrollLeft: number }>({ x: 0, y: 0, scrollLeft: 0 });
    const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const isMouseDownRef = useRef(false);
    const hasDraggedRef = useRef(false);

    const settingsRef = useRef(settings);
    settingsRef.current = settings;

    const onProgressUpdateRef = useRef(onProgressUpdate);
    onProgressUpdateRef.current = onProgressUpdate;

    const epubSearchIndexRef = useRef<Promise<EpubSearchSectionIndex[]> | null>(null);
    const themeCssRef = useRef<string>('');
    const authorStylesRef = useRef<string>('');

    const sheetColors = getEpubSheetColors(settings.readerSheetColor);
    const { sheetBg, sheetFg, sheetBorder } = sheetColors;

    /**
     * Programmatically scrolls to a specific page index with progress synchronization.
     */
    const turnToPage = useCallback(
      (pageIdx: number, smooth: boolean = true) => {
        const track = scrollTrackRef.current;
        const dims = dimensionsRef.current;
        const currentPages = pagesRef.current;
        if (!track || !dims || currentPages.length === 0) return;

        const safeIdx = Math.max(0, Math.min(currentPages.length - 1, pageIdx));
        const stride = dims.pageWidth + PAGE_GAP;
        const targetScrollLeft = safeIdx * stride;

        activePageIndexRef.current = safeIdx;
        setActivePageIndex(safeIdx);

        track.scrollTo({
          left: targetScrollLeft,
          behavior: smooth ? 'smooth' : 'auto',
        });

        const currentInfo = currentPages[safeIdx];
        const progress = currentPages.length > 1
          ? (safeIdx >= currentPages.length - 1 ? 1 : Math.min(1, Math.max(0, (safeIdx + 1) / currentPages.length)))
          : 1;

        if (currentInfo?.cfi) {
          latestCfiRef.current = currentInfo.cfi;
        }
        onProgressUpdateRef.current(
          currentInfo?.cfi || '',
          progress,
          currentInfo?.sectionHref
        );
      },
      []
    );

    /**
     * Lays out parsed sections into structured page sheets for horizontal scrolling.
     */
    const layoutPages = useCallback(
      (
        sections: ParsedSection[],
        dims: FlipBookDimensions,
        currentSettings: EffectiveReaderSettings,
        targetProgress?: number
      ) => {
        const colors = getEpubSheetColors(currentSettings.readerSheetColor);
        const themeCss = buildEpubThemeCss(
          currentSettings,
          colors,
          currentSettings.fontSize,
          0,
          currentSettings.letterSpacing,
          currentSettings.wordSpacing,
          `.${styles.columnSlider}`
        );
        themeCssRef.current = themeCss;

        const measureThemeCss = buildEpubThemeCss(
          currentSettings,
          colors,
          currentSettings.fontSize,
          0,
          currentSettings.letterSpacing,
          currentSettings.wordSpacing,
          `.${styles.measureRoot}`
        );

        // Offscreen container for multi-column pagination measurement
        const measureContainer = document.createElement('div');
        measureContainer.className = styles.measureRoot;
        measureContainer.style.width = `${dims.printableW}px`;
        measureContainer.style.height = `${dims.printableH}px`;
        measureContainer.style.columnWidth = `${dims.printableW}px`;
        measureContainer.style.columnGap = '0px';
        measureContainer.style.columnFill = 'auto';
        document.body.appendChild(measureContainer);

        const newPages: HorizontalPageInfo[] = [];
        let combinedAuthorStyles = '';

        for (const sec of sections) {
          if (sec.authorStyles) {
            combinedAuthorStyles += sec.authorStyles + '\n';
          }

          if (sec.isImageOnly) {
            newPages.push({
              globalIndex: newPages.length,
              sectionIndex: sec.index,
              sectionHref: sec.href,
              chapterTitle: sec.title,
              columnPageIndex: 0,
              totalSectionPages: 1,
              isImageOnly: true,
              imageSrc: sec.imageSrc,
              imageHtml: sec.imageHtml,
              cfi: sec.cfi,
              htmlContent: sec.imageHtml || (sec.imageSrc ? `<img src="${escapeAttr(sec.imageSrc)}" class="${styles.fullImage}" alt="" />` : sec.htmlContent),
              authorStyles: sec.authorStyles,
            });
          } else {
            let sectionPagesCount = 1;
            try {
              const scopedSecAuthor = sec.authorStyles
                ? `<style>${scopeCss(sec.authorStyles, `.${styles.measureRoot}`)}</style>`
                : '';
              measureContainer.innerHTML = `<style>${measureThemeCss}</style>${scopedSecAuthor}${sec.htmlContent}`;
              const scrollW = measureContainer.scrollWidth;
              if (scrollW > dims.printableW) {
                sectionPagesCount = Math.max(1, Math.ceil(scrollW / dims.printableW));
              } else {
                sectionPagesCount = Math.max(1, Math.ceil(sec.textContent.length / 900));
              }
            } catch {
              sectionPagesCount = Math.max(1, Math.ceil(sec.textContent.length / 900));
            }

            for (let colIdx = 0; colIdx < sectionPagesCount; colIdx++) {
              newPages.push({
                globalIndex: newPages.length,
                sectionIndex: sec.index,
                sectionHref: sec.href,
                chapterTitle: sec.title,
                columnPageIndex: colIdx,
                totalSectionPages: sectionPagesCount,
                isImageOnly: false,
                cfi: sec.cfi,
                htmlContent: sec.htmlContent,
                authorStyles: sec.authorStyles,
              });
            }
          }
        }

        if (document.body.contains(measureContainer)) {
          document.body.removeChild(measureContainer);
        }

        authorStylesRef.current = combinedAuthorStyles;

        // Ensure at least one page
        if (newPages.length === 0) {
          newPages.push({
            globalIndex: 0,
            sectionIndex: 0,
            sectionHref: '',
            chapterTitle: 'Publication',
            columnPageIndex: 0,
            totalSectionPages: 1,
            isImageOnly: false,
            cfi: '',
            htmlContent: '<div style="padding:24px;text-align:center;">Publication loaded</div>',
          });
        }

        const previousPages = pagesRef.current;

        // Calculate starting page accurately across mode changes
        const initialPage = findTargetHorizontalPage(
          newPages,
          initialCfiRef.current,
          typeof targetProgress === 'number'
            ? targetProgress
            : initialProgressFractionRef.current,
          initialHrefRef.current,
          bookRef.current,
          previousPages
        );

        activePageIndexRef.current = initialPage;
        setActivePageIndex(initialPage);
        pendingScrollPageRef.current = initialPage;
        isInitialLayoutRef.current = true;

        setPages(newPages);
        pagesRef.current = newPages;

        // Notify initial progress
        const initialInfo = newPages[initialPage];
        const initialFrac = newPages.length > 1
          ? (initialPage >= newPages.length - 1 ? 1 : Math.min(1, Math.max(0, (initialPage + 1) / newPages.length)))
          : 1;

        if (initialInfo?.cfi) {
          latestCfiRef.current = initialInfo.cfi;
        }
        onProgressUpdateRef.current(
          initialInfo?.cfi || '',
          initialFrac,
          initialInfo?.sectionHref
        );
      },
      []
    );

    // Immediate scroll alignment after React commits page elements to DOM
    useLayoutEffect(() => {
      if (pages.length === 0 || !dimensionsRef.current) return;
      const targetPage = pendingScrollPageRef.current;
      if (targetPage === null) return;
      pendingScrollPageRef.current = null;

      const track = scrollTrackRef.current;
      if (!track) return;

      const stride = dimensionsRef.current.pageWidth + PAGE_GAP;
      track.style.scrollSnapType = 'none';
      track.style.scrollBehavior = 'auto';
      track.scrollLeft = targetPage * stride;

      requestAnimationFrame(() => {
        if (track) {
          track.style.scrollSnapType = 'x mandatory';
          track.style.scrollBehavior = '';
          isInitialLayoutRef.current = false;
        }
      });
    }, [pages, dimensions]);

    /**
     * Parses publication spine sections once per fileData.
     */
    useEffect(() => {
      let isMounted = true;
      setLoading(true);

      const initBook = async () => {
        if (!containerRef.current || !fileData) return;

        try {
          const containerRect = containerRef.current.getBoundingClientRect();
          const dims = calculateFlipBookDimensions(
            containerRect.width || window.innerWidth,
            containerRect.height || window.innerHeight,
            settingsRef.current.maxContentWidth,
            settingsRef.current.contentMargin
          );
          setDimensions(dims);
          dimensionsRef.current = dims;

          let book = bookRef.current;
          if (!book) {
            book = ePub(fileData);
            bookRef.current = book;
          }
          await book.ready;

          // Build navigation title map
          const titleMap = new Map<string, string>();
          try {
            const nav = await book.loaded.navigation;
            const walk = (items: Array<{ href: string; label: string; subitems?: unknown[] }>) => {
              for (const item of items) {
                if (item.href) titleMap.set(withoutFragment(item.href), item.label.trim());
                if (item.subitems && Array.isArray(item.subitems)) {
                  walk(item.subitems as Array<{ href: string; label: string; subitems?: unknown[] }>);
                }
              }
            };
            if (nav?.toc) walk(nav.toc);
          } catch {
            // Navigation may be missing
          }

          const spineSections: EpubSearchSection[] = [];
          (book.spine as unknown as { each: (callback: (section: EpubSearchSection) => void) => void })
            .each((section) => spineSections.push(section));

          const parsedList: ParsedSection[] = [];

          for (const section of spineSections) {
            try {
              await section.load(book.load.bind(book));
              const doc = section.document;
              if (!doc) continue;
              const body = doc.body || doc.getElementsByTagName('body')[0] || doc.documentElement;
              if (!body) continue;

              let authorStyles = '';
              try {
                const styleTags = Array.from(doc.querySelectorAll('style'));
                for (const st of styleTags) {
                  if (st.textContent) authorStyles += st.textContent + '\n';
                }
              } catch {}

              const chapterTitle =
                titleMap.get(withoutFragment(section.href)) ||
                doc.title ||
                `Chapter ${section.index + 1}`;

              const num = (section.index + 1) * 2;
              const sectionCfi = `epubcfi(/6/${num}!/4)`;

              // Check if image-only section (covers, illustrations)
              const imgEl = doc.querySelector('img') || doc.getElementsByTagName('img')[0];
              const svgImgEl = doc.querySelector('image') || doc.getElementsByTagName('image')[0];
              const svgEl = doc.querySelector('svg') || doc.getElementsByTagName('svg')[0];

              let imageSrc = '';
              if (imgEl) imageSrc = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '';
              else if (svgImgEl) imageSrc = svgImgEl.getAttribute('href') || svgImgEl.getAttribute('xlink:href') || '';

              const textContent = body.textContent?.trim() || '';
              let isImageOnly = Boolean(imgEl || svgImgEl || svgEl) && textContent.length < 60;

              if (!isImageOnly) {
                try {
                  const imageLayout = getEpubImageSectionLayout(doc, {
                    availableWidth: dims.pageWidth,
                    availableHeight: dims.pageHeight,
                    canvasWidth: dims.pageWidth,
                  });
                  if (imageLayout.isImageOnly) isImageOnly = true;
                } catch {
                  // ignore
                }
              }

              // Resolve image URL
              if (imageSrc && !isInlineOrNetworkUrl(imageSrc)) {
                try {
                  const resolved = await resolveEpubResource(book, imageSrc, {
                    document: doc,
                    sectionIndex: section.index,
                  });
                  if (resolved) imageSrc = resolved;
                } catch {
                  // ignore
                }
              }

              let imageHtml = '';
              if (isImageOnly) {
                if (svgEl) {
                  const innerSvgImgs = [
                    ...Array.from(svgEl.getElementsByTagName('image')),
                    ...Array.from(svgEl.getElementsByTagName('img')),
                  ];
                  for (const sImg of innerSvgImgs) {
                    const h = sImg.getAttribute('href') || sImg.getAttribute('xlink:href') || sImg.getAttribute('src');
                    if (h && !isInlineOrNetworkUrl(h)) {
                      try {
                        const r = await resolveEpubResource(book, h, { document: doc, sectionIndex: section.index });
                        if (r) {
                          sImg.setAttribute('href', r);
                          sImg.setAttribute('xlink:href', r);
                          sImg.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', r);
                          sImg.setAttributeNS('http://www.w3.org/1999/xlink', 'href', r);
                          if (!imageSrc) imageSrc = r;
                        }
                      } catch {}
                    }
                  }
                  imageHtml = svgEl.outerHTML;
                } else if (imageSrc) {
                  imageHtml = `<img src="${escapeAttr(imageSrc)}" class="${styles.fullImage}" alt="" />`;
                }
              } else {
                // Resolve images within chapter body
                const bodyImgs = [
                  ...Array.from(body.getElementsByTagName('img')),
                  ...Array.from(body.getElementsByTagName('image')),
                ];
                for (const bImg of bodyImgs) {
                  const src = bImg.getAttribute('src') || bImg.getAttribute('href') || bImg.getAttribute('xlink:href');
                  if (src && !isInlineOrNetworkUrl(src)) {
                    try {
                      const r = await resolveEpubResource(book, src, { document: doc, sectionIndex: section.index });
                      if (r) {
                        if (bImg.tagName.toLowerCase() === 'image') {
                          bImg.setAttribute('href', r);
                          bImg.setAttribute('xlink:href', r);
                        } else {
                          bImg.setAttribute('src', r);
                        }
                      }
                    } catch {}
                  }
                }
              }

              parsedList.push({
                index: section.index,
                href: section.href,
                title: chapterTitle,
                cfi: sectionCfi,
                isImageOnly,
                imageSrc: imageSrc || undefined,
                imageHtml,
                htmlContent: body.innerHTML,
                textContent,
                authorStyles,
              });
            } catch (err) {
              console.warn('Failed to parse spine section:', section.href, err);
            } finally {
              try {
                section.unload();
              } catch {
                // ignore
              }
            }
          }

          if (!isMounted) return;

          parsedSectionsRef.current = parsedList;
          layoutPages(parsedList, dims, settingsRef.current, initialProgressFractionRef.current);
        } catch (err) {
          console.error('Failed to parse EPUB publication in horizontal reader:', err);
        } finally {
          if (isMounted) setLoading(false);
        }
      };

      void initBook();

      return () => {
        isMounted = false;
      };
    }, [fileData, layoutPages]);

    // Re-layout when typography settings change without re-reading the publication
    useEffect(() => {
      if (parsedSectionsRef.current.length === 0 || !dimensionsRef.current) return;
      layoutPages(
        parsedSectionsRef.current,
        dimensionsRef.current,
        settings,
        activePageIndexRef.current
      );
    }, [
      settings.fontSize,
      settings.lineHeight,
      settings.paragraphSpacing,
      settings.fontFamily,
      settings.readerSheetColor,
      settings.contentMargin,
      settings.letterSpacing,
      settings.wordSpacing,
      settings.textAlign,
      settings.textIndent,
      settings.maxContentWidth,
      layoutPages,
    ]);

    // Responsive ResizeObserver
    useEffect(() => {
      if (!containerRef.current) return;
      let resizeTimer: number | undefined;

      const handleResize = () => {
        if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
          if (!containerRef.current || parsedSectionsRef.current.length === 0) return;
          const rect = containerRef.current.getBoundingClientRect();
          const prev = dimensionsRef.current;
          if (
            !prev ||
            Math.abs(rect.width - prev.containerWidth) > 32 ||
            Math.abs(rect.height - prev.containerHeight) > 32
          ) {
            const dims = calculateFlipBookDimensions(
              rect.width || window.innerWidth,
              rect.height || window.innerHeight,
              settingsRef.current.maxContentWidth,
              settingsRef.current.contentMargin
            );
            setDimensions(dims);
            dimensionsRef.current = dims;
            layoutPages(
              parsedSectionsRef.current,
              dims,
              settingsRef.current,
              activePageIndexRef.current
            );
          }
        }, 220);
      };

      const observer = typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(handleResize)
        : null;

      if (observer && containerRef.current) {
        observer.observe(containerRef.current);
      } else {
        window.addEventListener('resize', handleResize);
      }

      return () => {
        if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
        if (observer) observer.disconnect();
        window.removeEventListener('resize', handleResize);
      };
    }, [layoutPages]);

    // Track scroll listener to synchronize active page & progress
    const handleScroll = useCallback(() => {
      if (isInitialLayoutRef.current || pendingScrollPageRef.current !== null) {
        return;
      }
      const track = scrollTrackRef.current;
      const dims = dimensionsRef.current;
      const currentPages = pagesRef.current;
      if (!track || !dims || currentPages.length === 0) return;

      const stride = dims.pageWidth + PAGE_GAP;
      const scrollLeft = track.scrollLeft;
      const newIndex = Math.max(0, Math.min(currentPages.length - 1, Math.round(scrollLeft / stride)));

      if (newIndex !== activePageIndexRef.current) {
        activePageIndexRef.current = newIndex;
        setActivePageIndex(newIndex);

        const currentInfo = currentPages[newIndex];
        const progress = currentPages.length > 1
          ? (newIndex >= currentPages.length - 1 ? 1 : Math.min(1, Math.max(0, (newIndex + 1) / currentPages.length)))
          : 1;

        if (currentInfo?.cfi) {
          latestCfiRef.current = currentInfo.cfi;
        }
        onProgressUpdateRef.current(
          currentInfo?.cfi || '',
          progress,
          currentInfo?.sectionHref
        );
      }
    }, []);

    // Zoom & pan calculations for pointer-anchored zooming and 2D canvas pan
    const calculateMaxPan = useCallback((zoomLevel: number) => {
      const container = containerRef.current;
      const dims = dimensionsRef.current;
      if (!container || !dims || zoomLevel <= 1.001) {
        return { maxX: 0, maxY: 0 };
      }
      const viewportW = container.clientWidth || window.innerWidth;
      const viewportH = container.clientHeight || window.innerHeight;
      const pageW = dims.pageWidth;
      const pageH = dims.pageHeight;
      const scaledW = pageW * zoomLevel;
      const scaledH = pageH * zoomLevel;
      const overflowX = Math.max(0, (scaledW - viewportW) / 2);
      const overflowY = Math.max(0, (scaledH - viewportH) / 2);

      const maxX = overflowX + (viewportW * (zoomLevel - 1)) / 2 + 100;
      const maxY = Math.max(60, overflowY + 60);
      return { maxX, maxY };
    }, []);

    const applyTransform = useCallback((panX: number, panY: number, zoom: number) => {
      const track = scrollTrackRef.current;
      if (!track) return;
      track.style.setProperty('--epub-pan-x', `${panX}px`);
      track.style.setProperty('--epub-pan-y', `${panY}px`);
      track.style.setProperty('--epub-reader-zoom', String(zoom));
    }, []);

    const previewZoom = useCallback(
      (zoom: number, anchor?: EpubZoomAnchor) => {
        const container = containerRef.current;
        const track = scrollTrackRef.current;
        const prevZoom = currentZoomRef.current;

        if (zoom <= 1.001) {
          // Zoom out to 100% or less: reset to center and 0 pan
          panRef.current = { x: 0, y: 0 };
          setPan({ x: 0, y: 0 });
          applyTransform(0, 0, zoom);
          if (track) {
            track.style.scrollSnapType = 'x mandatory';
          }
          currentZoomRef.current = zoom;
          return;
        }

        if (track) {
          track.style.scrollSnapType = 'none';
        }

        const { maxX, maxY } = calculateMaxPan(zoom);

        if (zoom > prevZoom) {
          // Zooming IN: anchor towards pointer position anywhere user points
          let px = 0;
          let py = 0;
          let hasPoint = false;

          if (container) {
            const rect = container.getBoundingClientRect();
            if (
              anchor &&
              typeof anchor.viewportX === 'number' &&
              typeof anchor.viewportY === 'number'
            ) {
              px = rect.left + anchor.viewportX;
              py = rect.top + anchor.viewportY;
              hasPoint = true;
            } else if (pointerPosRef.current) {
              px = pointerPosRef.current.clientX;
              py = pointerPosRef.current.clientY;
              hasPoint = true;
            }

            if (hasPoint) {
              const cx = rect.left + rect.width / 2;
              const cy = rect.top + rect.height / 2;
              const dx = px - cx;
              const dy = py - cy;
              const factor = zoom / Math.max(1, prevZoom) - 1;

              const targetX = panRef.current.x - dx * factor;
              const targetY = panRef.current.y - dy * factor;
              const clampedX = Math.max(-maxX, Math.min(maxX, targetX));
              const clampedY = Math.max(-maxY, Math.min(maxY, targetY));

              panRef.current = { x: clampedX, y: clampedY };
              setPan({ x: clampedX, y: clampedY });
              applyTransform(clampedX, clampedY, zoom);
            } else {
              const clampedX = Math.max(-maxX, Math.min(maxX, panRef.current.x));
              const clampedY = Math.max(-maxY, Math.min(maxY, panRef.current.y));
              panRef.current = { x: clampedX, y: clampedY };
              setPan({ x: clampedX, y: clampedY });
              applyTransform(clampedX, clampedY, zoom);
            }
          } else {
            applyTransform(0, 0, zoom);
          }
        } else {
          // Zooming OUT (zoom < prevZoom): smoothly pull pan back towards (0, 0) center
          const centerRatio = Math.max(0, (zoom - 1.0) / Math.max(0.01, prevZoom - 1.0));
          const targetX = panRef.current.x * centerRatio;
          const targetY = panRef.current.y * centerRatio;
          const clampedX = Math.max(-maxX, Math.min(maxX, targetX));
          const clampedY = Math.max(-maxY, Math.min(maxY, targetY));

          panRef.current = { x: clampedX, y: clampedY };
          setPan({ x: clampedX, y: clampedY });
          applyTransform(clampedX, clampedY, zoom);
        }

        currentZoomRef.current = zoom;
      },
      [applyTransform, calculateMaxPan]
    );

    useEffect(() => {
      previewZoom(readerZoom, zoomAnchor);
    }, [readerZoom, zoomAnchor, previewZoom]);

    // Translate vertical mouse wheel to horizontal track scroll or 2D pan
    const handleWheel = useCallback(
      (e: React.WheelEvent<HTMLDivElement>) => {
        if (e.ctrlKey || e.metaKey) {
          if (onZoomGesture) {
            e.preventDefault();
            onZoomGesture(e.deltaY, { x: e.clientX, y: e.clientY });
          }
          return;
        }

        if (readerZoom > 1) {
          // 2D Pan with mouse wheel / trackpad when zoomed in
          e.preventDefault();
          const { maxX, maxY } = calculateMaxPan(readerZoom);
          const newX = Math.max(-maxX, Math.min(maxX, panRef.current.x - e.deltaX));
          const newY = Math.max(-maxY, Math.min(maxY, panRef.current.y - e.deltaY));
          panRef.current = { x: newX, y: newY };
          setPan({ x: newX, y: newY });
          applyTransform(newX, newY, readerZoom);
          return;
        }

        const track = scrollTrackRef.current;
        if (!track) return;

        // If vertical scroll delta is dominant, scroll horizontally
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          track.scrollLeft += e.deltaY;
        }
      },
      [readerZoom, onZoomGesture, calculateMaxPan, applyTransform]
    );

    // Mouse drag-to-scroll & 2D grab-to-pan handlers
    const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest(`.${styles.navZone}`)) return;

      const track = scrollTrackRef.current;
      if (!track) return;

      isMouseDownRef.current = true;
      hasDraggedRef.current = false;
      dragStartRef.current = { x: e.clientX, y: e.clientY, scrollLeft: track.scrollLeft };
      panStartRef.current = { ...panRef.current };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {}
    }, []);

    const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
      pointerPosRef.current = { clientX: e.clientX, clientY: e.clientY };

      if (!isMouseDownRef.current) return;
      if (e.buttons === 0) {
        isMouseDownRef.current = false;
        setIsPanning(false);
        return;
      }

      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasDraggedRef.current = true;
        setIsPanning(true);
      }

      if (readerZoom > 1) {
        // 2D Pan when zoomed in: grab and move smoothly in both dimensions
        const { maxX, maxY } = calculateMaxPan(readerZoom);
        const newX = Math.max(-maxX, Math.min(maxX, panStartRef.current.x + dx));
        const newY = Math.max(-maxY, Math.min(maxY, panStartRef.current.y + dy));
        panRef.current = { x: newX, y: newY };
        applyTransform(newX, newY, readerZoom);
      } else {
        // Horizontal scroll drag when at 100%
        const track = scrollTrackRef.current;
        if (track) {
          track.scrollLeft = dragStartRef.current.scrollLeft - dx;
        }
      }
    }, [readerZoom, calculateMaxPan, applyTransform]);

    const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
      if (!isMouseDownRef.current) return;
      isMouseDownRef.current = false;
      setIsPanning(false);

      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}

      if (hasDraggedRef.current) {
        setPan({ ...panRef.current });
        setTimeout(() => {
          hasDraggedRef.current = false;
        }, 80);
      }
    }, []);

    const scrollPrev = useCallback(() => {
      turnToPage(Math.max(0, activePageIndexRef.current - 1));
    }, [turnToPage]);

    const scrollNext = useCallback(() => {
      turnToPage(Math.min(pagesRef.current.length - 1, activePageIndexRef.current + 1));
    }, [turnToPage]);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        scrollPrev();
      } else if (
        event.key === 'ArrowRight' ||
        event.key === 'PageDown' ||
        event.key === ' '
      ) {
        event.preventDefault();
        scrollNext();
      } else if (event.key === 'Home') {
        event.preventDefault();
        turnToPage(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        turnToPage(pagesRef.current.length - 1);
      }
    };

    // Forward imperative handle
    useImperativeHandle(
      ref,
      () => ({
        goToHref: (href: string) => {
          const target = withoutFragment(href).trim();
          if (!target) return;
          const pageIdx = pagesRef.current.findIndex((p) =>
            withoutFragment(p.sectionHref).includes(target) ||
            target.includes(withoutFragment(p.sectionHref))
          );
          if (pageIdx >= 0) {
            turnToPage(pageIdx);
          }
        },
        goToCfi: (cfi: string) => {
          latestCfiRef.current = cfi;
          let spineSec: { index: number; href: string } | null = null;
          try {
            spineSec = bookRef.current ? (bookRef.current.spine.get(cfi) as any) : null;
          } catch {}

          const pageIdx = pagesRef.current.findIndex(
            (p) =>
              (spineSec && p.sectionIndex === spineSec.index) ||
              (p.cfi && (cfi.includes(p.cfi) || p.cfi.includes(cfi))) ||
              (p.sectionHref && (cfi.includes(p.sectionHref) || p.sectionHref.includes(cfi)))
          );
          if (pageIdx >= 0) {
            turnToPage(pageIdx);
          }
        },
        goToProgress: (fraction: number) => {
          if (pagesRef.current.length === 0) return;
          const target = Math.min(
            pagesRef.current.length - 1,
            Math.max(0, Math.floor(fraction * (pagesRef.current.length - 1)))
          );
          turnToPage(target);
        },
        search: async (query: string): Promise<ReaderSearchResult[]> => {
          const book = bookRef.current;
          const normalized = query.trim();
          if (!book || normalized.length < 2) return [];

          if (!epubSearchIndexRef.current) {
            epubSearchIndexRef.current = buildEpubSearchIndex(book);
          }
          const index = await epubSearchIndexRef.current;
          const results: ReaderSearchResult[] = [];

          for (const section of index) {
            const matches = findTextMatches(
              section.text,
              normalized,
              100 - results.length
            );
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
        },
        goToSearchMatch: async (href: string) => {
          const target = withoutFragment(href).trim();
          if (!target) return;
          const pageIdx = pagesRef.current.findIndex((p) =>
            withoutFragment(p.sectionHref).includes(target)
          );
          if (pageIdx >= 0) {
            turnToPage(pageIdx);
          }
        },
        previewZoom: (zoom: number, anchor?: EpubZoomAnchor) => {
          previewZoom(zoom, anchor);
        },
      }),
      [turnToPage, previewZoom]
    );

    // Padding on sides of horizontal track to center pages comfortably
    const trackPadding = useMemo(() => {
      if (!dimensions) return 48;
      const viewportW = dimensions.containerWidth || window.innerWidth;
      return Math.max(32, Math.floor((viewportW - dimensions.pageWidth) / 2));
    }, [dimensions]);

    return (
      <div
        ref={containerRef}
        className={`${styles.container} ${readerZoom > 1 ? styles.isZoomed : ''} ${isPanning ? styles.isPanning : ''}`}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        onPointerMove={(e) => {
          pointerPosRef.current = { clientX: e.clientX, clientY: e.clientY };
        }}
        tabIndex={0}
        autoFocus
        style={
          {
            '--epub-sheet-bg': sheetBg,
            '--epub-sheet-color': sheetFg,
            '--epub-sheet-border': sheetBorder,
            '--horizontal-track-pad': `${trackPadding}px`,
            '--page-gap': `${PAGE_GAP}px`,
            '--epub-pan-x': `${pan.x}px`,
            '--epub-pan-y': `${pan.y}px`,
            '--epub-reader-zoom': String(readerZoom),
          } as CSSProperties
        }
      >
        {/* Scoped CSS styling for rendered typography & author styles */}
        {themeCssRef.current && (
          <style>{themeCssRef.current}</style>
        )}
        {authorStylesRef.current && (
          <style>{scopeCss(authorStylesRef.current, `.${styles.columnSlider}`)}</style>
        )}

        {loading && (
          <div className={styles.loading}>
            <div className={styles.spinner} />
            <span>Preparing horizontal scroll…</span>
          </div>
        )}

        {/* Horizontal Continuous Page Track */}
        <div
          ref={scrollTrackRef}
          className={`${styles.horizontalTrack} ${isPanning ? styles.isPanningTrack : ''}`}
          onScroll={handleScroll}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onClick={(e) => {
            if (hasDraggedRef.current) return;
            if (e.target === scrollTrackRef.current && onToggleControls) {
              onToggleControls();
            }
          }}
        >
          {dimensions &&
            pages.map((page, idx) => {
              // Virtualized render window: render full page if within active or scroll index +/- 5 pages
              const stride = dimensions.pageWidth + PAGE_GAP;
              const scrollIdx = scrollTrackRef.current
                ? Math.max(0, Math.min(pages.length - 1, Math.round(scrollTrackRef.current.scrollLeft / Math.max(1, stride))))
                : activePageIndex;
              const isRendered = Math.abs(idx - activePageIndex) <= 5 || Math.abs(idx - scrollIdx) <= 5;
              const isActive = idx === activePageIndex;

              return (
                <div
                  key={page.globalIndex}
                  className={styles.pageSlot}
                  data-page-index={page.globalIndex}
                  style={{
                    width: `${dimensions.pageWidth}px`,
                    height: `${dimensions.pageHeight}px`,
                  }}
                  onDoubleClick={(e) => {
                    if (readerZoom <= 1) {
                      onZoomTo?.(1.6, { x: e.clientX, y: e.clientY });
                    } else {
                      onZoomTo?.(1);
                    }
                  }}
                  onClick={(e) => {
                    if (hasDraggedRef.current) return;
                    const target = e.target as HTMLElement;
                    const anchor = target.closest('a');
                    if (anchor) {
                      const href = anchor.getAttribute('href');
                      if (href) {
                        e.preventDefault();
                        const targetPath = withoutFragment(href).trim();
                        if (targetPath) {
                          const targetPage = pagesRef.current.findIndex(
                            (p) =>
                              withoutFragment(p.sectionHref).includes(targetPath) ||
                              targetPath.includes(withoutFragment(p.sectionHref))
                          );
                          if (targetPage >= 0) turnToPage(targetPage);
                        }
                      }
                      return;
                    }

                    // Clicking near margins / center toggles reader chrome
                    if (onToggleControls) {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
                      if (ratio >= 0.35 && ratio <= 0.65) {
                        onToggleControls();
                      }
                    }
                  }}
                >
                  {isRendered ? (
                    <div
                      className={`${styles.pageCard} ${isActive ? styles.pageActive : ''}`}
                      style={{
                        width: `${dimensions.pageWidth}px`,
                        height: `${dimensions.pageHeight}px`,
                      }}
                    >
                      {page.isImageOnly ? (
                        <div className={styles.imageWrapper}>
                          {page.imageSrc ? (
                            <img
                              src={escapeAttr(page.imageSrc)}
                              className={styles.fullImage}
                              alt={escapeAttr(page.chapterTitle || '')}
                            />
                          ) : (
                            <div
                              dangerouslySetInnerHTML={{
                                __html: sanitizeReaderHtml(page.imageHtml || page.htmlContent || '', {
                                  allowImages: true,
                                  allowSvg: true,
                                }),
                              }}
                            />
                          )}
                        </div>
                      ) : (
                        <>
                          {page.chapterTitle && (
                            <div className={styles.pageHeader}>
                              {escapeHtml(page.chapterTitle)}
                            </div>
                          )}
                          <div
                            className={styles.pageInner}
                            style={{
                              top: `${dimensions.headerHeight + dimensions.pageInnerPadding}px`,
                              left: `${dimensions.pageInnerPadding}px`,
                              width: `${dimensions.printableW}px`,
                              height: `${dimensions.printableH}px`,
                            }}
                          >
                            <div
                              className={styles.columnSlider}
                              style={{
                                height: `${dimensions.printableH}px`,
                                columnWidth: `${dimensions.printableW}px`,
                                columnGap: '0px',
                                columnFill: 'auto',
                                transform: `translateX(-${page.columnPageIndex * dimensions.printableW}px)`,
                              }}
                              dangerouslySetInnerHTML={{
                                __html: sanitizeReaderHtml(page.htmlContent, {
                                  allowImages: true,
                                  allowSvg: true,
                                }),
                              }}
                            />
                          </div>
                          <div className={styles.pageFooter}>
                            {page.globalIndex + 1}
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div
                      className={styles.pagePlaceholder}
                      style={{
                        width: `${dimensions.pageWidth}px`,
                        height: `${dimensions.pageHeight}px`,
                      }}
                    />
                  )}
                </div>
              );
            })}
        </div>

        {/* Previous page navigation button */}
        <div
          className={`${styles.navZone} ${styles.navLeft}`}
          onClick={(e) => {
            e.stopPropagation();
            scrollPrev();
          }}
          title="Previous Page"
          role="button"
          tabIndex={0}
          aria-label="Previous Page"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              scrollPrev();
            }
          }}
        >
          <div className={styles.navButton}>
            <ChevronLeft size={22} />
          </div>
        </div>

        {/* Next page navigation button */}
        <div
          className={`${styles.navZone} ${styles.navRight}`}
          onClick={(e) => {
            e.stopPropagation();
            scrollNext();
          }}
          title="Next Page"
          role="button"
          tabIndex={0}
          aria-label="Next Page"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              scrollNext();
            }
          }}
        >
          <div className={styles.navButton}>
            <ChevronRight size={22} />
          </div>
        </div>
      </div>
    );
  }
);
