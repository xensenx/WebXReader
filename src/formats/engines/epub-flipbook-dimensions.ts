/**
 * Sizing & responsive dimensions calculations for the EPUB Double-Sided FlipBook Reader.
 */

export interface FlipBookDimensions {
  containerWidth: number;
  containerHeight: number;
  pageWidth: number;
  pageHeight: number;
  printableW: number;
  printableH: number;
  pageInnerPadding: number;
  headerHeight: number;
  footerHeight: number;
  isPortrait: boolean;
}

export const PAGE_ASPECT_RATIO = 1.42; // standard book page height / width
export const HEADER_HEIGHT = 32;
export const FOOTER_HEIGHT = 32;

export function calculateFlipBookDimensions(
  containerWidth: number,
  containerHeight: number,
  maxContentWidth?: number,
  contentMargin?: number
): FlipBookDimensions {
  const availW = Math.max(320, containerWidth - 48);
  const availH = Math.max(400, containerHeight - 48);

  const isPortrait = availW < 680;
  let pageWidth: number;
  let pageHeight: number;

  if (isPortrait) {
    const targetW = Math.min(availW, 600);
    if (targetW * PAGE_ASPECT_RATIO <= availH) {
      pageWidth = Math.floor(targetW);
      pageHeight = Math.floor(pageWidth * PAGE_ASPECT_RATIO);
    } else {
      pageHeight = Math.floor(availH);
      pageWidth = Math.floor(pageHeight / PAGE_ASPECT_RATIO);
    }
  } else {
    // Spread mode: two pages side-by-side
    const maxHalfW = Math.min(
      availW / 2,
      Math.max(340, (maxContentWidth || 800) * 0.95)
    );
    if (maxHalfW * PAGE_ASPECT_RATIO <= availH) {
      pageWidth = Math.floor(maxHalfW);
      pageHeight = Math.floor(pageWidth * PAGE_ASPECT_RATIO);
    } else {
      pageHeight = Math.floor(availH);
      pageWidth = Math.floor(pageHeight / PAGE_ASPECT_RATIO);
      if (pageWidth * 2 > availW) {
        pageWidth = Math.floor(availW / 2);
        pageHeight = Math.floor(pageWidth * PAGE_ASPECT_RATIO);
      }
    }
  }

  pageWidth = Math.max(260, Math.min(1000, pageWidth));
  pageHeight = Math.max(380, Math.min(1400, pageHeight));

  const pageInnerPadding = Math.max(16, Math.min(48, contentMargin || 28));
  const printableW = Math.max(180, pageWidth - pageInnerPadding * 2);
  const printableH = Math.max(240, pageHeight - pageInnerPadding * 2 - HEADER_HEIGHT - FOOTER_HEIGHT);

  return {
    containerWidth,
    containerHeight,
    pageWidth,
    pageHeight,
    printableW,
    printableH,
    pageInnerPadding,
    headerHeight: HEADER_HEIGHT,
    footerHeight: FOOTER_HEIGHT,
    isPortrait,
  };
}
