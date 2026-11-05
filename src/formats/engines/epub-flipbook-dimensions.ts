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

/**
 * Calculates responsive dimensions for two-page spread or single-page portrait layout.
 *
 * @param containerWidth - Available container client width
 * @param containerHeight - Available container client height
 * @param maxContentWidth - User preference max content width limit
 * @param contentMargin - Page inner padding margin
 * @returns Computed dimensions guaranteed to fit within the container viewport
 */
export function calculateFlipBookDimensions(
  containerWidth: number,
  containerHeight: number,
  maxContentWidth?: number,
  contentMargin?: number
): FlipBookDimensions {
  const marginX = containerWidth > 120 ? 48 : 8;
  const marginY = containerHeight > 120 ? 48 : 8;
  const availW = Math.max(80, containerWidth - marginX);
  const availH = Math.max(100, containerHeight - marginY);

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
      Math.max(120, (maxContentWidth || 800) * 0.95)
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

  // Ensure dimensions never exceed container viewport
  if (isPortrait) {
    if (pageWidth > containerWidth) {
      pageWidth = containerWidth;
      pageHeight = Math.floor(pageWidth * PAGE_ASPECT_RATIO);
    }
    if (pageHeight > containerHeight) {
      pageHeight = containerHeight;
      pageWidth = Math.max(1, Math.floor(pageHeight / PAGE_ASPECT_RATIO));
    }
  } else {
    if (pageWidth * 2 > containerWidth) {
      pageWidth = Math.floor(containerWidth / 2);
      pageHeight = Math.floor(pageWidth * PAGE_ASPECT_RATIO);
    }
    if (pageHeight > containerHeight) {
      pageHeight = containerHeight;
      pageWidth = Math.max(1, Math.floor(pageHeight / PAGE_ASPECT_RATIO));
    }
  }

  const pageInnerPadding = Math.min(
    Math.max(8, contentMargin ?? 24),
    Math.max(4, Math.floor(pageWidth * 0.08))
  );

  const headerH = Math.min(HEADER_HEIGHT, Math.max(16, Math.floor(pageHeight * 0.06)));
  const footerH = Math.min(FOOTER_HEIGHT, Math.max(16, Math.floor(pageHeight * 0.06)));

  const printableW = Math.max(20, pageWidth - pageInnerPadding * 2);
  const printableH = Math.max(20, pageHeight - pageInnerPadding * 2 - headerH - footerH);

  return {
    containerWidth,
    containerHeight,
    pageWidth,
    pageHeight,
    printableW,
    printableH,
    pageInnerPadding,
    headerHeight: headerH,
    footerHeight: footerH,
    isPortrait,
  };
}
