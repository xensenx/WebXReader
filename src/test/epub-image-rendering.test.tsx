import { describe, expect, it } from 'vitest';
import {
  calculateEpubImageSectionLayout,
  getEpubImageSectionLayout,
} from '../formats/engines/epub-image-layout';

describe('EPUB image section layout', () => {
  const viewport = {
    availableWidth: 1200,
    availableHeight: 900,
    canvasWidth: 794,
  };

  it('fits portrait covers inside the reader canvas while preserving their aspect ratio', () => {
    const layout = calculateEpubImageSectionLayout({
      ...viewport,
      hasVisualMedia: true,
      paragraphs: ['A short cover title'],
      nonImageText: 'A short cover title',
      mediaDimensions: [{ width: 1200, height: 1800 }],
    });

    expect(layout).toMatchObject({ isImageOnly: true, orientation: 'portrait' });
    expect(layout.targetWidth).toBeLessThanOrEqual(viewport.canvasWidth);
    expect(Math.abs(layout.targetWidth! / layout.targetHeight! - 2 / 3)).toBeLessThan(0.002);
  });

  it('fits landscape artwork to the viewport height without losing its aspect ratio', () => {
    const layout = calculateEpubImageSectionLayout({
      ...viewport,
      availableWidth: 1600,
      hasVisualMedia: true,
      paragraphs: [],
      nonImageText: 'Fold-out map',
      mediaDimensions: [{ width: 2400, height: 1800 }],
    });

    expect(layout).toMatchObject({ isImageOnly: true, orientation: 'landscape' });
    expect(layout.targetWidth).toBeGreaterThan(1000);
    expect(layout.targetHeight).toBeLessThanOrEqual(Math.round(viewport.availableHeight * 0.88));
    expect(Math.abs(layout.targetWidth! / layout.targetHeight! - 4 / 3)).toBeLessThan(0.002);
  });

  it('keeps illustrated prose in the normal text layout', () => {
    const layout = calculateEpubImageSectionLayout({
      ...viewport,
      hasVisualMedia: true,
      paragraphs: [
        'The morning sun climbed above the eastern ridge and filled the mist-covered valley with gold.',
      ],
      nonImageText: 'The morning sun climbed above the eastern ridge and filled the mist-covered valley with gold.',
      mediaDimensions: [{ width: 800, height: 600 }],
    });

    expect(layout).toEqual({ isImageOnly: false, orientation: 'landscape' });
    expect(layout.targetWidth).toBeUndefined();
  });

  it('uses SVG viewBox dimensions when classifying standalone illustrations', () => {
    const epubDocument = document.implementation.createHTMLDocument('EPUB section');
    epubDocument.body.innerHTML = '<svg viewBox="0 0 1000 1500"><image width="1000" height="1500" /></svg>';

    const layout = getEpubImageSectionLayout(epubDocument, viewport);

    expect(layout).toMatchObject({ isImageOnly: true, orientation: 'portrait' });
    expect(layout.targetWidth).toBeGreaterThan(0);
    expect(layout.targetHeight).toBeGreaterThan(layout.targetWidth!);
  });

  it('does not mark a text-only section as image-only', () => {
    const layout = calculateEpubImageSectionLayout({
      ...viewport,
      hasVisualMedia: false,
      paragraphs: ['A paragraph with more than sixty characters that would otherwise qualify.'],
      nonImageText: 'Some chapter text.',
      mediaDimensions: [],
    });

    expect(layout.isImageOnly).toBe(false);
    expect(layout.targetWidth).toBeUndefined();
  });
});
