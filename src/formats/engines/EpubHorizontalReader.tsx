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
  onProgressUpdate: (cfi: string, progressFraction: number, href?: string) => void;
  onToggleControls?: () => void;
  readerZoom?: number;
  zoomAnchor?: EpubZoomAnchor;
  onZoomGesture?: (deltaY: number, point?: { x: number; y: number }) => void;
  onZoomTo?: (zoom: number, point?: { x: number; y: number }) => void;
}

const PAGE_GAP = 24;

export const EpubHorizontalReader = forwardRef<EpubReaderHandle, EpubHorizontalReaderProps>(
  function EpubHorizontalReader(
    {
      fileData,
      settings,
      initialCfi,
      onProgressUpdate,
      onToggleControls,
      readerZoom = 1,
      zoomAnchor: _zoomAnchor,
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

    const activePageIndexRef = useRef(0);
    activePageIndexRef.current = activePageIndex;

    const pagesRef = useRef<HorizontalPageInfo[]>([]);
    pagesRef.current = pages;

    const dimensionsRef = useRef<FlipBookDimensions | null>(null);
    dimensionsRef.current = dimensions;

    const bookRef = useRef<EpubResourceBook | null>(null);
    const parsedSectionsRef = useRef<ParsedSection[]>([]);
    const initialCfiRef = useRef(initialCfi);
    const latestCfiRef = useRef(initialCfi);

    const settingsRef = useRef(settings);
    settingsRef.current = settings;

    const onProgressUpdateRef = useRef(onProgressUpdate);
    onProgressUpdateRef.current = onProgressUpdate;

    const epubSearchIndexRef = useRef<Promise<EpubSearchSectionIndex[]> | null>(null);
    const themeCssRef = useRef<string>('');
    const authorStylesRef = useRef<string>('');

    const dragStartRef = useRef<{ x: number; scrollLeft: number }>({ x: 0, scrollLeft: 0 });
    const isMouseDownRef = useRef(false);
    const hasDraggedRef = useRef(false);

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
        setPages(newPages);
        pagesRef.current = newPages;

        // Calculate starting page
        let initialPage = 0;
        if (typeof targetProgress === 'number' && newPages.length > 0) {
          if (targetProgress >= 1 && targetProgress === Math.floor(targetProgress)) {
            const prevPageInfo = previousPages[targetProgress];
            if (prevPageInfo) {
              const matchIdx = newPages.findIndex(
                (p) =>
                  p.sectionIndex === prevPageInfo.sectionIndex &&
                  p.columnPageIndex === Math.min(p.totalSectionPages - 1, prevPageInfo.columnPageIndex)
              );
              if (matchIdx >= 0) {
                initialPage = matchIdx;
              } else {
                const secMatchIdx = newPages.findIndex((p) => p.sectionIndex === prevPageInfo.sectionIndex);
                initialPage = secMatchIdx >= 0 ? secMatchIdx : Math.min(newPages.length - 1, Math.max(0, targetProgress));
              }
            } else {
              initialPage = Math.min(newPages.length - 1, Math.max(0, targetProgress));
            }
          } else if (targetProgress >= 0 && targetProgress <= 1) {
            initialPage = Math.min(
              newPages.length - 1,
              Math.max(0, Math.floor(targetProgress * (newPages.length - 1)))
            );
          }
        } else if (initialCfiRef.current && newPages.length > 0) {
          const targetCfi = initialCfiRef.current;
          let spineSec: { index: number; href: string } | null = null;
          try {
            spineSec = bookRef.current ? (bookRef.current.spine.get(targetCfi) as any) : null;
          } catch {}

          const matchedIndex = newPages.findIndex(
            (p) =>
              (spineSec && p.sectionIndex === spineSec.index) ||
              (p.cfi && (targetCfi.includes(p.cfi) || p.cfi.includes(targetCfi))) ||
              (p.sectionHref && (targetCfi.includes(p.sectionHref) || p.sectionHref.includes(targetCfi)))
          );
          if (matchedIndex >= 0) initialPage = matchedIndex;
        }

        activePageIndexRef.current = initialPage;
        setActivePageIndex(initialPage);

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

        // Scroll track to initial page
        requestAnimationFrame(() => {
          if (scrollTrackRef.current) {
            const stride = dims.pageWidth + PAGE_GAP;
            scrollTrackRef.current.scrollTo({
              left: initialPage * stride,
              behavior: 'auto',
            });
          }
        });
      },
      []
    );

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
          layoutPages(parsedList, dims, settingsRef.current);
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

    // Translate vertical mouse wheel to horizontal track scroll
    const handleWheel = useCallback(
      (e: React.WheelEvent<HTMLDivElement>) => {
        if (e.ctrlKey || e.metaKey) {
          if (onZoomGesture) {
            e.preventDefault();
            onZoomGesture(e.deltaY, { x: e.clientX, y: e.clientY });
          }
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
      [onZoomGesture]
    );

    // Mouse drag-to-scroll handlers
    const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest(`.${styles.navZone}`)) return;

      const track = scrollTrackRef.current;
      if (!track) return;

      isMouseDownRef.current = true;
      hasDraggedRef.current = false;
      dragStartRef.current = { x: e.clientX, scrollLeft: track.scrollLeft };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {}
    }, []);

    const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
      if (!isMouseDownRef.current) return;
      if (e.buttons === 0) {
        isMouseDownRef.current = false;
        setIsPanning(false);
        return;
      }

      const dx = e.clientX - dragStartRef.current.x;
      if (Math.abs(dx) > 3) {
        hasDraggedRef.current = true;
        setIsPanning(true);
      }

      const track = scrollTrackRef.current;
      if (track) {
        track.scrollLeft = dragStartRef.current.scrollLeft - dx;
      }
    }, []);

    const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
      if (!isMouseDownRef.current) return;
      isMouseDownRef.current = false;
      setIsPanning(false);

      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}

      if (hasDraggedRef.current) {
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
        previewZoom: (zoom: number) => {
          if (scrollTrackRef.current) {
            scrollTrackRef.current.style.setProperty(
              '--epub-reader-zoom',
              String(zoom)
            );
          }
        },
      }),
      [turnToPage]
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
        tabIndex={0}
        autoFocus
        style={
          {
            '--epub-sheet-bg': sheetBg,
            '--epub-sheet-color': sheetFg,
            '--epub-sheet-border': sheetBorder,
            '--horizontal-track-pad': `${trackPadding}px`,
            '--page-gap': `${PAGE_GAP}px`,
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
              // Virtualized render window: render full page if within active +/- 4 pages
              const isRendered = Math.abs(idx - activePageIndex) <= 4;
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
