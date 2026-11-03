export type EpubImageOrientation = 'landscape' | 'portrait' | 'square';

export type EpubSectionImageInfo = {
  isImageOnly: boolean;
  orientation: EpubImageOrientation;
  targetWidth?: number;
  targetHeight?: number;
};

type EpubMediaDimensions = {
  width: number;
  height: number;
};

export type EpubImageSectionLayoutInput = {
  hasVisualMedia: boolean;
  paragraphs: readonly string[];
  nonImageText: string;
  mediaDimensions: readonly EpubMediaDimensions[];
  availableWidth: number;
  availableHeight: number;
  canvasWidth: number;
};

const positiveNumber = (value: string | null | undefined) => {
  if (!value || value.trim().endsWith('%')) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const largerDimensions = (current: EpubMediaDimensions, candidate: EpubMediaDimensions) =>
  candidate.width > 0 && candidate.height > 0 &&
  candidate.width * candidate.height > current.width * current.height
    ? candidate
    : current;

export function getEpubImageSectionLayout(
  document: Document,
  viewport: Pick<EpubImageSectionLayoutInput, 'availableWidth' | 'availableHeight' | 'canvasWidth'>
): EpubSectionImageInfo {
  const body = document.body;
  const images = Array.from(document.querySelectorAll('img'));
  const svgs = Array.from(document.querySelectorAll('svg'));
  const paragraphs = Array.from(document.querySelectorAll('p, blockquote, article, section > p'))
    .filter((element) => !element.querySelector('img, svg'))
    .map((element) => (element.textContent || '').trim());
  const nonImageText = Array.from(body?.childNodes || [])
    .filter((node) => node.nodeName !== 'FIGURE' && node.nodeName !== 'SVG' && node.nodeName !== 'IMG')
    .map((node) => node.textContent || '')
    .join(' ')
    .trim();

  const mediaDimensions: EpubMediaDimensions[] = [];
  for (const svg of svgs) {
    const viewBox = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    if (viewBox?.length === 4) {
      mediaDimensions.push({ width: viewBox[2] || 0, height: viewBox[3] || 0 });
    }

    const svgWidth = positiveNumber(svg.getAttribute('width'));
    const svgHeight = positiveNumber(svg.getAttribute('height'));
    if (svgWidth > 0 && svgHeight > 0) mediaDimensions.push({ width: svgWidth, height: svgHeight });

    svg.querySelectorAll('image').forEach((image) => {
      const width = positiveNumber(image.getAttribute('width'));
      const height = positiveNumber(image.getAttribute('height'));
      if (width > 0 && height > 0) mediaDimensions.push({ width, height });
    });
  }

  for (const image of images) {
    const width = image.naturalWidth || positiveNumber(image.getAttribute('width')) || image.clientWidth;
    const height = image.naturalHeight || positiveNumber(image.getAttribute('height')) || image.clientHeight;
    if (width > 0 && height > 0) mediaDimensions.push({ width, height });
  }

  return calculateEpubImageSectionLayout({
    ...viewport,
    hasVisualMedia: images.length > 0 || svgs.length > 0,
    paragraphs,
    nonImageText,
    mediaDimensions,
  });
}

export function calculateEpubImageSectionLayout(input: EpubImageSectionLayoutInput): EpubSectionImageInfo {
  const { hasVisualMedia, paragraphs, nonImageText, mediaDimensions } = input;
  const substantiveParagraphs = paragraphs.filter((text) => text.length > 60);
  const isImageOnly = hasVisualMedia && substantiveParagraphs.length === 0 && nonImageText.length < 200;
  const primary = mediaDimensions.reduce<EpubMediaDimensions>(largerDimensions, { width: 0, height: 0 });

  let orientation: EpubImageOrientation = 'portrait';
  let aspectRatio = 0.67;
  if (primary.width > 0 && primary.height > 0) {
    aspectRatio = primary.width / primary.height;
    orientation = aspectRatio > 1.15 ? 'landscape' : aspectRatio < 0.95 ? 'portrait' : 'square';
  }

  if (!isImageOnly) return { isImageOnly, orientation };

  const availableWidth = input.availableWidth > 0 ? input.availableWidth : 1200;
  const availableHeight = input.availableHeight > 0 ? input.availableHeight : 800;
  let targetWidth: number;
  let targetHeight: number;

  if (orientation === 'landscape') {
    targetWidth = Math.min(Math.round(availableWidth * 0.96), 1400);
    targetHeight = Math.round(targetWidth / aspectRatio);
    const maxHeight = Math.round(availableHeight * 0.88);
    if (targetHeight > maxHeight) {
      targetHeight = maxHeight;
      targetWidth = Math.round(targetHeight * aspectRatio);
    }
  } else {
    targetHeight = Math.min(Math.round(availableHeight * 0.90), 1200);
    targetWidth = Math.round(targetHeight * aspectRatio);
    const maxWidth = Math.min(
      Math.round(availableWidth * 0.96),
      input.canvasWidth > 0 ? input.canvasWidth : 800
    );
    if (targetWidth > maxWidth) {
      targetWidth = maxWidth;
      targetHeight = Math.round(targetWidth / aspectRatio);
    }
  }

  return { isImageOnly, orientation, targetWidth, targetHeight };
}
