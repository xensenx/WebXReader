/**
 * EPUB Double-Sided FlipBook Reader component.
 * Features realistic 3D grab-and-turn page peel effects via page-flip,
 * responsive two-page spread / single-page fallback based on screen dimensions,
 * dynamic text rendering on both sides during page turns,
 * and seamless typography & navigation controls.
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import ePub from 'epubjs';
import { PageFlip } from 'page-flip';
import 'page-flip/src/Style/stPageFlip.css';
import {
  ChevronLeft,
  ChevronRight,
  PanelLeft,
  PanelRight,
  AlignCenter,
} from 'lucide-react';
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
import styles from './EpubDoubleSidedReader.module.css';

export type { FlipBookDimensions };

export interface FlipPageInfo {
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
}

interface EpubDoubleSidedReaderProps {
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

export const EpubDoubleSidedReader = forwardRef<EpubReaderHandle, EpubDoubleSidedReaderProps>(
  function EpubDoubleSidedReader(
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
    const bookStageRef = useRef<HTMLDivElement>(null);
    const bookContainerRef = useRef<HTMLDivElement>(null);

    const [loading, setLoading] = useState(true);
    const [currentPageIndex, setCurrentPageIndex] = useState(0);

    // Zoom panning & side focus state
    const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [sideFocus, setSideFocus] = useState<'left' | 'center' | 'right' | 'custom'>('center');
    const [isPanning, setIsPanning] = useState(false);

    const panRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    panRef.current = pan;

    const sideFocusRef = useRef<'left' | 'center' | 'right' | 'custom'>('center');
    sideFocusRef.current = sideFocus;

    const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const isMouseDownRef = useRef(false);
    const hasDraggedRef = useRef(false);

    const bookRef = useRef<EpubResourceBook | null>(null);
    const parsedSectionsRef = useRef<ParsedSection[]>([]);
    const pageFlipRef = useRef<PageFlip | null>(null);
    const pagesRef = useRef<FlipPageInfo[]>([]);
    const pageElementsRef = useRef<HTMLElement[]>([]);
    const renderedPagesSetRef = useRef<Set<number>>(new Set());

    const dimensionsRef = useRef<FlipBookDimensions | null>(null);
    const currentPageIndexRef = useRef(0);
    currentPageIndexRef.current = currentPageIndex;

    const initialCfiRef = useRef(initialCfi);
    const latestCfiRef = useRef(initialCfi);

    const settingsRef = useRef(settings);
    settingsRef.current = settings;

    const onProgressUpdateRef = useRef(onProgressUpdate);
    onProgressUpdateRef.current = onProgressUpdate;

    const epubSearchIndexRef = useRef<Promise<EpubSearchSectionIndex[]> | null>(null);
    const themeCssRef = useRef<string>('');

    const sheetColors = getEpubSheetColors(settings.readerSheetColor);
    const { sheetBg, sheetFg, sheetBorder } = sheetColors;

    /**
     * Dynamically renders page content into the page DOM element.
     */
    const renderPageContent = useCallback(
      (
        pageEl: HTMLElement,
        pageInfo: FlipPageInfo | undefined,
        dimensions: FlipBookDimensions,
        pageIndex: number
      ) => {
        if (!pageInfo) {
          pageEl.innerHTML = '';
          return;
        }

        const isLeftPage = !dimensions.isPortrait && pageIndex % 2 === 0;

        if (pageInfo.isImageOnly) {
          const content = pageInfo.imageSrc
            ? `<img src="${pageInfo.imageSrc}" class="${styles.fullImage}" alt="${pageInfo.chapterTitle || ''}" />`
            : (pageInfo.imageHtml || pageInfo.htmlContent || '');

          pageEl.innerHTML = `
            <div class="${styles.imageWrapper}">
              ${content}
            </div>
            ${
              isLeftPage
                ? `<div class="${styles.spineShadowLeft}"></div><div class="${styles.pageEdgeLeft}"></div>`
                : `<div class="${styles.spineShadowRight}"></div><div class="${styles.pageEdgeRight}"></div>`
            }
          `;
          return;
        }

        const titleHtml = pageInfo.chapterTitle
          ? `<div class="${styles.pageHeader}">${pageInfo.chapterTitle}</div>`
          : '';

        const footerHtml = `
          <div class="${styles.pageFooter}" style="${isLeftPage ? 'text-align: left;' : 'text-align: right;'}">
            ${pageInfo.globalIndex + 1}
          </div>
        `;

        const spineShadows = isLeftPage
          ? `<div class="${styles.spineShadowLeft}"></div><div class="${styles.pageEdgeLeft}"></div>`
          : `<div class="${styles.spineShadowRight}"></div><div class="${styles.pageEdgeRight}"></div>`;

        const styleTag = themeCssRef.current ? `<style>${themeCssRef.current}</style>` : '';

        pageEl.innerHTML = `
          ${styleTag}
          ${titleHtml}
          <div
            class="${styles.pageInner}"
            style="
              top: ${dimensions.headerHeight + dimensions.pageInnerPadding}px;
              left: ${dimensions.pageInnerPadding}px;
              width: ${dimensions.printableW}px;
              height: ${dimensions.printableH}px;
            "
          >
            <div
              class="${styles.columnSlider}"
              style="
                height: ${dimensions.printableH}px;
                column-width: ${dimensions.printableW}px;
                column-gap: 0px;
                column-fill: auto;
                transform: translateX(-${pageInfo.columnPageIndex * dimensions.printableW}px);
              "
            >
              ${pageInfo.htmlContent}
            </div>
          </div>
          ${footerHtml}
          ${spineShadows}
        `;
      },
      []
    );

    /**
     * Updates the dynamic rendering on both sides (spread) for the current active page.
     */
    const renderSpread = useCallback(
      (centerPageIndex: number) => {
        const dimensions = dimensionsRef.current;
        const pages = pagesRef.current;
        const pageElements = pageElementsRef.current;
        if (!dimensions || pages.length === 0 || pageElements.length === 0) return;

        const isPortrait = dimensions.isPortrait;
        const spreadStart = isPortrait
          ? centerPageIndex
          : Math.floor(centerPageIndex / 2) * 2;

        const rangeStart = Math.max(0, spreadStart - 2);
        const rangeEnd = Math.min(pages.length - 1, spreadStart + 3);

        const activePages = new Set<number>();
        for (let i = rangeStart; i <= rangeEnd; i++) {
          activePages.add(i);
          const pageEl = pageElements[i];
          if (!pageEl) continue;

          if (!renderedPagesSetRef.current.has(i)) {
            renderPageContent(pageEl, pages[i], dimensions, i);
            renderedPagesSetRef.current.add(i);
          }
        }

        // Clean up far offscreen pages to keep memory footprint light
        for (const renderedIndex of Array.from(renderedPagesSetRef.current)) {
          if (!activePages.has(renderedIndex)) {
            const pageEl = pageElements[renderedIndex];
            if (pageEl) {
              pageEl.innerHTML = '';
            }
            renderedPagesSetRef.current.delete(renderedIndex);
          }
        }
      },
      [renderPageContent]
    );

    /**
     * Lays out parsed sections into PageFlip pages using current typography & dimensions.
     */
    const layoutFlipBook = useCallback(
      (
        sections: ParsedSection[],
        dimensions: FlipBookDimensions,
        currentSettings: EffectiveReaderSettings,
        targetProgress?: number
      ) => {
        if (!bookContainerRef.current) return;

        const colors = getEpubSheetColors(currentSettings.readerSheetColor);
        const themeCss = buildEpubThemeCss(
          currentSettings,
          colors,
          currentSettings.fontSize,
          0,
          currentSettings.letterSpacing,
          currentSettings.wordSpacing
        );
        themeCssRef.current = themeCss;

        // Offscreen container for multi-column measurement
        const measureContainer = document.createElement('div');
        measureContainer.style.position = 'absolute';
        measureContainer.style.visibility = 'hidden';
        measureContainer.style.pointerEvents = 'none';
        measureContainer.style.left = '-99999px';
        measureContainer.style.top = '-99999px';
        measureContainer.style.width = `${dimensions.printableW}px`;
        measureContainer.style.height = `${dimensions.printableH}px`;
        measureContainer.style.columnWidth = `${dimensions.printableW}px`;
        measureContainer.style.columnGap = '0px';
        measureContainer.style.columnFill = 'auto';
        measureContainer.style.overflow = 'hidden';
        document.body.appendChild(measureContainer);

        const pages: FlipPageInfo[] = [];

        for (const sec of sections) {
          if (sec.isImageOnly) {
            pages.push({
              globalIndex: pages.length,
              sectionIndex: sec.index,
              sectionHref: sec.href,
              chapterTitle: sec.title,
              columnPageIndex: 0,
              totalSectionPages: 1,
              isImageOnly: true,
              imageSrc: sec.imageSrc,
              imageHtml: sec.imageHtml,
              cfi: sec.cfi,
              htmlContent: sec.imageHtml || (sec.imageSrc ? `<img src="${sec.imageSrc}" class="${styles.fullImage}" alt="" />` : sec.htmlContent),
            });
          } else {
            let sectionPagesCount = 1;
            try {
              measureContainer.innerHTML = `<style>${themeCss}</style>${sec.htmlContent}`;
              const scrollW = measureContainer.scrollWidth;
              if (scrollW > dimensions.printableW) {
                sectionPagesCount = Math.max(1, Math.ceil(scrollW / dimensions.printableW));
              } else {
                sectionPagesCount = Math.max(1, Math.ceil(sec.textContent.length / 900));
              }
            } catch {
              sectionPagesCount = Math.max(1, Math.ceil(sec.textContent.length / 900));
            }

            for (let colIdx = 0; colIdx < sectionPagesCount; colIdx++) {
              pages.push({
                globalIndex: pages.length,
                sectionIndex: sec.index,
                sectionHref: sec.href,
                chapterTitle: sec.title,
                columnPageIndex: colIdx,
                totalSectionPages: sectionPagesCount,
                isImageOnly: false,
                cfi: sec.cfi,
                htmlContent: sec.htmlContent,
              });
            }
          }
        }

        if (document.body.contains(measureContainer)) {
          document.body.removeChild(measureContainer);
        }

        // Guarantee at least one page
        if (pages.length === 0) {
          pages.push({
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

        // Balance spreads in two-page mode
        if (!dimensions.isPortrait && pages.length % 2 !== 0) {
          pages.push({
            globalIndex: pages.length,
            sectionIndex: -1,
            sectionHref: '',
            chapterTitle: '',
            columnPageIndex: 0,
            totalSectionPages: 1,
            isImageOnly: false,
            cfi: '',
            htmlContent: '',
          });
        }

        pagesRef.current = pages;

        // Teardown previous PageFlip instance cleanly without removing the root book container
        if (pageFlipRef.current) {
          try {
            // Note: DO NOT call pageFlipRef.current.destroy()!
            // PageFlip's destroy() method calls this.block.remove(), which permanently
            // removes bookContainerRef.current from the DOM, causing the book to vanish on resize!
            const pf = pageFlipRef.current as any;
            if (pf.render) {
              pf.render.render = () => {};
              pf.render.drawFrame = () => {};
            }
            const ui = pf.ui;
            if (ui && typeof ui.destroy === 'function') {
              ui.destroy();
            }
          } catch {
            // ignore
          }
          pageFlipRef.current = null;
        }

        const bookEl = bookContainerRef.current;
        if (!bookEl) return;

        // Ensure bookEl remains connected to bookStageRef in case anything detached it
        if (bookStageRef.current && !bookStageRef.current.contains(bookEl)) {
          bookStageRef.current.appendChild(bookEl);
        }

        bookEl.innerHTML = '';
        renderedPagesSetRef.current.clear();

        // Create page DOM elements for PageFlip
        const pageElements: HTMLElement[] = [];
        for (let i = 0; i < pages.length; i++) {
          const pageEl = document.createElement('div');
          pageEl.className = styles.flipPage;
          pageEl.setAttribute('data-page-index', String(i));
          if (pages[i].isImageOnly) {
            pageEl.setAttribute('data-density', 'hard');
          } else {
            pageEl.setAttribute('data-density', 'soft');
          }
          bookEl.appendChild(pageEl);
          pageElements.push(pageEl);
        }
        pageElementsRef.current = pageElements;

        // Calculate starting page
        let initialPage = 0;
        if (typeof targetProgress === 'number' && pages.length > 0) {
          if (targetProgress >= 1 && targetProgress === Math.floor(targetProgress)) {
            // Integer page index passed directly from previous layout
            const prevPageInfo = pagesRef.current[targetProgress];
            if (prevPageInfo) {
              const matchIdx = pages.findIndex(
                (p) =>
                  p.sectionIndex === prevPageInfo.sectionIndex &&
                  p.columnPageIndex === Math.min(p.totalSectionPages - 1, prevPageInfo.columnPageIndex)
              );
              if (matchIdx >= 0) {
                initialPage = matchIdx;
              } else {
                const secMatchIdx = pages.findIndex((p) => p.sectionIndex === prevPageInfo.sectionIndex);
                if (secMatchIdx >= 0) {
                  initialPage = secMatchIdx;
                } else {
                  initialPage = Math.min(pages.length - 1, Math.max(0, targetProgress));
                }
              }
            } else {
              initialPage = Math.min(pages.length - 1, Math.max(0, targetProgress));
            }
          } else if (targetProgress >= 0 && targetProgress <= 1) {
            // Fractional progress
            initialPage = Math.min(
              pages.length - 1,
              Math.max(0, Math.floor(targetProgress * (pages.length - 1)))
            );
          }
        } else if (initialCfiRef.current && pages.length > 0) {
          const targetCfi = initialCfiRef.current;
          let spineSec: { index: number; href: string } | null = null;
          try {
            spineSec = bookRef.current ? (bookRef.current.spine.get(targetCfi) as any) : null;
          } catch {}

          const matchedIndex = pages.findIndex(
            (p) =>
              (spineSec && p.sectionIndex === spineSec.index) ||
              (p.cfi && (targetCfi.includes(p.cfi) || p.cfi.includes(targetCfi))) ||
              (p.sectionHref && (targetCfi.includes(p.sectionHref) || p.sectionHref.includes(targetCfi)))
          );
          if (matchedIndex >= 0) initialPage = matchedIndex;
        }

        if (!dimensions.isPortrait && initialPage % 2 !== 0) {
          initialPage -= 1;
        }
        if (initialPage < 0) initialPage = 0;

        const spreadWidth = dimensions.isPortrait ? dimensions.pageWidth : dimensions.pageWidth * 2;
        const spreadHeight = dimensions.pageHeight;

        if (bookContainerRef.current) {
          bookContainerRef.current.style.width = `${spreadWidth}px`;
          bookContainerRef.current.style.height = `${spreadHeight}px`;
        }
        if (bookStageRef.current) {
          bookStageRef.current.style.width = `${spreadWidth}px`;
          bookStageRef.current.style.height = `${spreadHeight}px`;
        }

        // Initialize PageFlip
        const pageFlip = new PageFlip(bookEl, {
          width: dimensions.pageWidth,
          height: dimensions.pageHeight,
          size: 'fixed',
          minWidth: dimensions.pageWidth,
          maxWidth: dimensions.pageWidth,
          minHeight: dimensions.pageHeight,
          maxHeight: dimensions.pageHeight,
          drawShadow: true,
          maxShadowOpacity: 0.45,
          showCover: false,
          usePortrait: dimensions.isPortrait,
          startPage: initialPage,
          flippingTime: 650,
          useMouseEvents: true,
          showPageCorners: true,
          disableFlipByClick: true,
          autoSize: false,
        });

        pageFlip.loadFromHTML(pageElements);
        pageFlipRef.current = pageFlip;

        setCurrentPageIndex(initialPage);
        currentPageIndexRef.current = initialPage;
        renderSpread(initialPage);

        // Pre-render pages during drag/fold so user sees both sides dynamically as page turns
        pageFlip.on('changeState', () => {
          renderSpread(currentPageIndexRef.current);
        });

        // Listen for realistic page turn events
        pageFlip.on('flip', (event) => {
          const newIndex = typeof event.data === 'number' ? event.data : (event.data as any).page;
          setCurrentPageIndex(newIndex);
          currentPageIndexRef.current = newIndex;
          renderSpread(newIndex);

          const currentInfo = pagesRef.current[newIndex];
          const progress = pagesRef.current.length > 1
            ? Math.min(1, Math.max(0, (newIndex + 1) / pagesRef.current.length))
            : 1;

          if (currentInfo?.cfi) {
            latestCfiRef.current = currentInfo.cfi;
          }
          onProgressUpdateRef.current(
            currentInfo?.cfi || '',
            progress,
            currentInfo?.sectionHref
          );
        });
      },
      [renderSpread]
    );

    /**
     * Parses the publication's spine and initializes flipbook once per fileData.
     */
    useEffect(() => {
      let isMounted = true;
      setLoading(true);

      const initBook = async () => {
        if (!containerRef.current || !bookContainerRef.current || !fileData) return;

        try {
          const containerRect = containerRef.current.getBoundingClientRect();
          const dimensions = calculateFlipBookDimensions(
            containerRect.width || window.innerWidth,
            containerRect.height || window.innerHeight,
            settingsRef.current.maxContentWidth,
            settingsRef.current.contentMargin
          );
          dimensionsRef.current = dimensions;

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
                    availableWidth: dimensions.pageWidth,
                    availableHeight: dimensions.pageHeight,
                    canvasWidth: dimensions.pageWidth,
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
                  // Resolve any svg image href inside SVG
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
                  imageHtml = `<img src="${imageSrc}" class="${styles.fullImage}" alt="" />`;
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
          layoutFlipBook(parsedList, dimensions, settingsRef.current);
        } catch (err) {
          console.error('Failed to parse EPUB publication:', err);
        } finally {
          if (isMounted) setLoading(false);
        }
      };

      void initBook();

      return () => {
        isMounted = false;
        if (pageFlipRef.current) {
          try {
            const pf = pageFlipRef.current as any;
            if (pf.render) {
              pf.render.render = () => {};
              pf.render.drawFrame = () => {};
            }
            const ui = pf.ui;
            if (ui && typeof ui.destroy === 'function') {
              ui.destroy();
            }
          } catch {
            // ignore
          }
          pageFlipRef.current = null;
        }
      };
    }, [fileData, layoutFlipBook]);

    // Re-layout when typography settings change without re-reading the publication files
    useEffect(() => {
      if (parsedSectionsRef.current.length === 0 || !dimensionsRef.current) return;
      layoutFlipBook(
        parsedSectionsRef.current,
        dimensionsRef.current,
        settings,
        currentPageIndexRef.current
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
      layoutFlipBook,
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
            dimensionsRef.current = dims;
            layoutFlipBook(
              parsedSectionsRef.current,
              dims,
              settingsRef.current,
              currentPageIndexRef.current
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
    }, [layoutFlipBook]);

    // Calculate pan bounds based on container and spread dimensions
    const calculateMaxPan = useCallback(
      (zoomLevel: number = readerZoom) => {
        const dimensions = dimensionsRef.current;
        const container = containerRef.current;
        if (!dimensions || !container) return { maxX: 0, maxY: 0, spreadW: 0, spreadH: 0 };

        const spreadW = dimensions.isPortrait ? dimensions.pageWidth : dimensions.pageWidth * 2;
        const spreadH = dimensions.pageHeight;
        const scaledW = spreadW * zoomLevel;
        const scaledH = spreadH * zoomLevel;
        const viewportW = container.clientWidth || window.innerWidth;
        const viewportH = container.clientHeight || window.innerHeight;

        const sideCenterOffset = dimensions.isPortrait ? 0 : (spreadW / 4) * zoomLevel;
        const overflowX = Math.max(0, (scaledW - viewportW) / 2);
        const maxX = Math.max(sideCenterOffset, overflowX + 60);

        const overflowY = Math.max(0, (scaledH - viewportH) / 2);
        const maxY = overflowY > 0 ? overflowY + 60 : 60;

        return { maxX, maxY, spreadW, spreadH };
      },
      [readerZoom]
    );

    // Focus Left Page, Center Spine, or Right Page when zoomed in
    const focusSide = useCallback(
      (side: 'left' | 'center' | 'right', zoomLevel: number = readerZoom) => {
        const { maxX, spreadW } = calculateMaxPan(zoomLevel);
        let targetX = 0;
        if (side === 'left') {
          // Left page center in spread is at -spreadW/4.
          // Translating by +(spreadW/4) * zoomLevel brings the Left Page to screen center.
          targetX = Math.min(maxX, (spreadW / 4) * zoomLevel);
        } else if (side === 'right') {
          // Right page center in spread is at +spreadW/4.
          // Translating by -(spreadW/4) * zoomLevel brings the Right Page to screen center.
          targetX = Math.max(-maxX, -(spreadW / 4) * zoomLevel);
        } else {
          targetX = 0;
        }

        const newPan = { x: targetX, y: 0 };
        setPan(newPan);
        panRef.current = newPan;
        setSideFocus(side);

        if (bookStageRef.current) {
          bookStageRef.current.style.setProperty('--epub-pan-x', `${targetX}px`);
          bookStageRef.current.style.setProperty('--epub-pan-y', '0px');
        }
      },
      [calculateMaxPan, readerZoom]
    );

    // Apply zoom and adjust pan / side focus
    useEffect(() => {
      if (bookStageRef.current) {
        bookStageRef.current.style.setProperty(
          '--epub-reader-zoom',
          String(readerZoom)
        );
      }

      // PageFlip: allow dragging to pan viewport when zoomed in (> 1);
      // allow realistic page corner peel when at 100% (<= 1)
      if (pageFlipRef.current) {
        try {
          const flipSettings = (pageFlipRef.current as any).getSettings?.();
          if (flipSettings) {
            flipSettings.useMouseEvents = readerZoom <= 1;
          }
        } catch {}
      }

      if (readerZoom <= 1) {
        setPan({ x: 0, y: 0 });
        panRef.current = { x: 0, y: 0 };
        setSideFocus('center');
        if (bookStageRef.current) {
          bookStageRef.current.style.setProperty('--epub-pan-x', '0px');
          bookStageRef.current.style.setProperty('--epub-pan-y', '0px');
        }
      } else {
        const currentFocus = sideFocusRef.current;
        if (currentFocus === 'left' || currentFocus === 'right') {
          focusSide(currentFocus, readerZoom);
        } else if (currentFocus === 'center') {
          focusSide('center', readerZoom);
        } else {
          // Re-clamp custom pan
          const { maxX, maxY } = calculateMaxPan(readerZoom);
          const clampedX = Math.max(-maxX, Math.min(maxX, panRef.current.x));
          const clampedY = Math.max(-maxY, Math.min(maxY, panRef.current.y));
          const newPan = { x: clampedX, y: clampedY };
          setPan(newPan);
          panRef.current = newPan;
          if (bookStageRef.current) {
            bookStageRef.current.style.setProperty('--epub-pan-x', `${clampedX}px`);
            bookStageRef.current.style.setProperty('--epub-pan-y', `${clampedY}px`);
          }
        }
      }
    }, [readerZoom, focusSide, calculateMaxPan]);

    // Drag-to-pan handlers when zoomed in
    const handlePointerDown = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (readerZoom <= 1 || e.button !== 0) return;
        const target = e.target as HTMLElement;
        if (
          target.closest(`.${styles.navZone}`) ||
          target.closest(`.${styles.sideFocusBar}`)
        ) {
          return;
        }

        isMouseDownRef.current = true;
        hasDraggedRef.current = false;
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        panStartRef.current = { ...panRef.current };
        setIsPanning(true);
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {}
      },
      [readerZoom]
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isMouseDownRef.current || readerZoom <= 1) return;

        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;

        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          hasDraggedRef.current = true;
        }

        const { maxX, maxY } = calculateMaxPan(readerZoom);
        const newX = Math.max(-maxX, Math.min(maxX, panStartRef.current.x + dx));
        const newY = Math.max(-maxY, Math.min(maxY, panStartRef.current.y + dy));

        panRef.current = { x: newX, y: newY };
        if (bookStageRef.current) {
          bookStageRef.current.style.setProperty('--epub-pan-x', `${newX}px`);
          bookStageRef.current.style.setProperty('--epub-pan-y', `${newY}px`);
        }
      },
      [readerZoom, calculateMaxPan]
    );

    const handlePointerUp = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isMouseDownRef.current) return;
        isMouseDownRef.current = false;
        setIsPanning(false);

        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {}

        if (hasDraggedRef.current) {
          setPan({ ...panRef.current });
          setSideFocus('custom');
          setTimeout(() => {
            hasDraggedRef.current = false;
          }, 80);
        }
      },
      []
    );

    // Mouse wheel / trackpad scroll pan when zoomed in
    const handleWheel = useCallback(
      (e: React.WheelEvent<HTMLDivElement>) => {
        if (readerZoom <= 1) return;
        if (e.ctrlKey) {
          // Pinch-zoom
          if (onZoomGesture) {
            e.preventDefault();
            onZoomGesture(e.deltaY, { x: e.clientX, y: e.clientY });
          }
          return;
        }

        e.preventDefault();
        const { maxX, maxY } = calculateMaxPan(readerZoom);
        const currentPan = panRef.current;
        const newX = Math.max(-maxX, Math.min(maxX, currentPan.x - e.deltaX));
        const newY = Math.max(-maxY, Math.min(maxY, currentPan.y - e.deltaY));

        panRef.current = { x: newX, y: newY };
        setPan({ x: newX, y: newY });
        setSideFocus('custom');

        if (bookStageRef.current) {
          bookStageRef.current.style.setProperty('--epub-pan-x', `${newX}px`);
          bookStageRef.current.style.setProperty('--epub-pan-y', `${newY}px`);
        }
      },
      [readerZoom, calculateMaxPan, onZoomGesture]
    );

    // Page navigation methods
    const flipPrev = useCallback(() => {
      if (pageFlipRef.current) {
        const current = currentPageIndexRef.current;
        renderSpread(Math.max(0, current - 2));
        pageFlipRef.current.flipPrev();
      }
    }, [renderSpread]);

    const flipNext = useCallback(() => {
      if (pageFlipRef.current) {
        const current = currentPageIndexRef.current;
        renderSpread(Math.min(pagesRef.current.length - 1, current + 2));
        pageFlipRef.current.flipNext();
      }
    }, [renderSpread]);

    const turnToPage = useCallback(
      (pageIdx: number) => {
        if (pageFlipRef.current) {
          const safeIdx = Math.max(
            0,
            Math.min(pagesRef.current.length - 1, pageIdx)
          );
          renderSpread(safeIdx);
          pageFlipRef.current.turnToPage(safeIdx);
        }
      },
      [renderSpread]
    );

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        flipPrev();
      } else if (
        event.key === 'ArrowRight' ||
        event.key === 'PageDown' ||
        event.key === ' '
      ) {
        event.preventDefault();
        flipNext();
      }
    };

    // Imperative handle forwarding
    useImperativeHandle(
      ref,
      () => ({
        goToHref: (href: string) => {
          const target = withoutFragment(href);
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
          const target = withoutFragment(href);
          const pageIdx = pagesRef.current.findIndex((p) =>
            withoutFragment(p.sectionHref).includes(target)
          );
          if (pageIdx >= 0) {
            turnToPage(pageIdx);
          }
        },
        previewZoom: (zoom: number) => {
          if (bookStageRef.current) {
            bookStageRef.current.style.setProperty(
              '--epub-reader-zoom',
              String(zoom)
            );
          }
          if (zoom <= 1) {
            if (bookStageRef.current) {
              bookStageRef.current.style.setProperty('--epub-pan-x', '0px');
              bookStageRef.current.style.setProperty('--epub-pan-y', '0px');
            }
          } else {
            const { maxX, maxY } = calculateMaxPan(zoom);
            const clampedX = Math.max(-maxX, Math.min(maxX, panRef.current.x));
            const clampedY = Math.max(-maxY, Math.min(maxY, panRef.current.y));
            if (bookStageRef.current) {
              bookStageRef.current.style.setProperty('--epub-pan-x', `${clampedX}px`);
              bookStageRef.current.style.setProperty('--epub-pan-y', `${clampedY}px`);
            }
          }
        },
      }),
      [flipPrev, flipNext, turnToPage, calculateMaxPan]
    );

    return (
      <div
        ref={containerRef}
        className={`${styles.container} ${readerZoom > 1 ? styles.isZoomed : ''} ${isPanning ? styles.isPanning : ''}`}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        tabIndex={0}
        autoFocus
        style={
          {
            '--epub-sheet-bg': sheetBg,
            '--epub-sheet-color': sheetFg,
            '--epub-sheet-border': sheetBorder,
          } as CSSProperties
        }
      >
        {loading && (
          <div className={styles.loading}>
            <div className={styles.spinner} />
            <span>Preparing two-page spread…</span>
          </div>
        )}

        <div
          ref={bookStageRef}
          className={`${styles.bookStage} ${isPanning ? styles.isPanningStage : ''}`}
          onClick={(e) => {
            if (hasDraggedRef.current) return;
            if (e.target === bookStageRef.current && onToggleControls) {
              onToggleControls();
            }
          }}
        >
          <div
            ref={bookContainerRef}
            className={styles.bookWrapper}
            onDoubleClick={(e) => {
              if (readerZoom <= 1) {
                if (bookContainerRef.current) {
                  const rect = bookContainerRef.current.getBoundingClientRect();
                  const isLeft = e.clientX < rect.left + rect.width / 2;
                  onZoomTo?.(1.6, { x: e.clientX, y: e.clientY });
                  focusSide(isLeft ? 'left' : 'right', 1.6);
                } else {
                  onZoomTo?.(1.6);
                  focusSide('left', 1.6);
                }
              } else {
                onZoomTo?.(1);
                focusSide('center', 1);
              }
            }}
            onClick={(e) => {
              if (hasDraggedRef.current) return;
              const target = e.target as HTMLElement;
              if (target.tagName.toLowerCase() === 'a') {
                const href = target.getAttribute('href');
                if (href) {
                  e.preventDefault();
                  const targetPage = pagesRef.current.findIndex((p) =>
                    p.sectionHref.includes(withoutFragment(href))
                  );
                  if (targetPage >= 0) turnToPage(targetPage);
                }
                return;
              }

              // Click near the center spine zone (40% - 60% horizontally) toggles controls
              if (bookContainerRef.current && onToggleControls) {
                const rect = bookContainerRef.current.getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
                if (ratio >= 0.4 && ratio <= 0.6) {
                  onToggleControls();
                }
              }
            }}
          />
        </div>

        {/* Previous page navigation button */}
        <div
          className={`${styles.navZone} ${styles.navLeft}`}
          onClick={(e) => {
            e.stopPropagation();
            flipPrev();
          }}
          title="Previous Page"
          role="button"
          tabIndex={0}
          aria-label="Previous Page"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              flipPrev();
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
            flipNext();
          }}
          title="Next Page"
          role="button"
          tabIndex={0}
          aria-label="Next Page"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              flipNext();
            }
          }}
        >
          <div className={styles.navButton}>
            <ChevronRight size={22} />
          </div>
        </div>

        {/* Page Focus Selector when zoomed in on two-page spreads */}
        {readerZoom > 1 && dimensionsRef.current && !dimensionsRef.current.isPortrait && (
          <div className={styles.sideFocusBar} role="group" aria-label="Page zoom focus">
            <button
              type="button"
              className={`${styles.sideFocusBtn} ${sideFocus === 'left' ? styles.sideFocusBtnActive : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                focusSide('left');
              }}
              title="Focus Left Page"
              aria-label="Focus Left Page"
            >
              <PanelLeft size={14} />
              <span>Left Page</span>
            </button>
            <button
              type="button"
              className={`${styles.sideFocusBtn} ${sideFocus === 'center' ? styles.sideFocusBtnActive : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                focusSide('center');
              }}
              title="Center Spread"
              aria-label="Center Spread"
            >
              <AlignCenter size={14} />
              <span>Center</span>
            </button>
            <button
              type="button"
              className={`${styles.sideFocusBtn} ${sideFocus === 'right' ? styles.sideFocusBtnActive : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                focusSide('right');
              }}
              title="Focus Right Page"
              aria-label="Focus Right Page"
            >
              <span>Right Page</span>
              <PanelRight size={14} />
            </button>
          </div>
        )}
      </div>
    );
  }
);
