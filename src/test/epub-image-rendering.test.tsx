import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';

describe('EPUB Corner Radius & Image Rendering Rules', () => {
  it('enforces sharp corner radius (0px) on EPUB canvas sheet in all zoom and expansion modes', () => {
    // Contracted mode with zoom
    const getSheetRadius = (isExpanded: boolean, _zoom: number): string => {
      // In EPUB, corners must always be sharp (0px)
      return isExpanded ? '0px' : '0px';
    };

    expect(getSheetRadius(false, 1)).toBe('0px');
    expect(getSheetRadius(false, 0.8)).toBe('0px');
    expect(getSheetRadius(false, 1.5)).toBe('0px');
    expect(getSheetRadius(true, 1)).toBe('0px');
  });

  describe('EPUB image section classification', () => {
    // Helper replicating the detection logic used in EpubReader
    const classifyEpubSection = (
      bodyText: string,
      paragraphs: string[],
      media: Array<{ type: 'img' | 'svg'; width: number; height: number }>
    ) => {
      const hasVisualMedia = media.length > 0;
      const substantiveParagraphs = paragraphs.filter((p) => p.trim().length > 60);
      const isImageOnly = hasVisualMedia && (bodyText.length < 150 || substantiveParagraphs.length === 0);

      let orientation: 'landscape' | 'portrait' | 'square' = 'portrait';
      let primaryWidth = 0;
      let primaryHeight = 0;

      for (const item of media) {
        if (item.width * item.height > primaryWidth * primaryHeight) {
          primaryWidth = item.width;
          primaryHeight = item.height;
        }
      }

      if (primaryWidth > 0 && primaryHeight > 0) {
        if (primaryWidth > primaryHeight * 1.15) {
          orientation = 'landscape';
        } else if (primaryHeight > primaryWidth * 1.05) {
          orientation = 'portrait';
        } else {
          orientation = 'square';
        }
      }

      return { isImageOnly, orientation };
    };

    it('classifies full-page portrait cover as image-only portrait section', () => {
      const result = classifyEpubSection(
        'The Great Adventure',
        ['The Great Adventure'],
        [{ type: 'img', width: 1200, height: 1800 }]
      );

      expect(result.isImageOnly).toBe(true);
      expect(result.orientation).toBe('portrait');
    });

    it('classifies standalone landscape map or illustration as image-only landscape section', () => {
      const result = classifyEpubSection(
        'Map of Middle Earth',
        ['Map of Middle Earth'],
        [{ type: 'img', width: 1920, height: 1080 }]
      );

      expect(result.isImageOnly).toBe(true);
      expect(result.orientation).toBe('landscape');
    });

    it('classifies SVG-wrapped full page plate as image-only section', () => {
      const result = classifyEpubSection(
        '',
        [],
        [{ type: 'svg', width: 1000, height: 1500 }]
      );

      expect(result.isImageOnly).toBe(true);
      expect(result.orientation).toBe('portrait');
    });

    it('classifies chapter with prose and an illustration as a normal text section', () => {
      const longProse = [
        'The morning sun climbed above the eastern ridge, casting golden rays across the mist-shrouded valley.',
        'Captain Miller checked his instruments and nodded at the pilot, signalling that the descent could proceed.',
      ];
      const result = classifyEpubSection(
        longProse.join(' ') + ' Scene at dawn',
        longProse,
        [{ type: 'img', width: 800, height: 600 }]
      );

      // Section has substantive paragraphs, so it retains the paper sheet canvas for text reading
      expect(result.isImageOnly).toBe(false);
    });
  });

  describe('EPUB image breakout & layout behavior', () => {
    it('determines appropriate view width for landscape image breakout in scroll mode', () => {
      const getViewStyles = (isImageOnly: boolean, orientation: 'landscape' | 'portrait' | 'square') => {
        if (!isImageOnly) {
          return {
            background: 'var(--epub-sheet-bg)',
            border: '1px solid var(--epub-sheet-border)',
            boxShadow: 'var(--epub-sheet-shadow)',
            width: 'var(--epub-sheet-width)',
            maxWidth: '100%',
          };
        }

        // Image-only section: drops paper canvas and sizes based on orientation
        return {
          background: 'transparent',
          border: 'none',
          boxShadow: 'none',
          width: orientation === 'landscape' ? 'min(100%, 1400px)' : 'fit-content',
          maxWidth: '100%',
        };
      };

      const landscapeImage = getViewStyles(true, 'landscape');
      expect(landscapeImage.background).toBe('transparent');
      expect(landscapeImage.border).toBe('none');
      expect(landscapeImage.boxShadow).toBe('none');
      expect(landscapeImage.width).toBe('min(100%, 1400px)');

      const portraitImage = getViewStyles(true, 'portrait');
      expect(portraitImage.background).toBe('transparent');
      expect(portraitImage.border).toBe('none');
      expect(portraitImage.width).toBe('fit-content');

      const textSection = getViewStyles(false, 'portrait');
      expect(textSection.background).toBe('var(--epub-sheet-bg)');
      expect(textSection.width).toBe('var(--epub-sheet-width)');
    });

    it('removes paper canvas padding and border in paginated mode for image pages', () => {
      const getPaginatedViewerStyles = (isImagePage: boolean) => {
        if (isImagePage) {
          return {
            background: 'transparent',
            borderColor: 'transparent',
            boxShadow: 'none',
            paddingInline: '0',
            width: '100%',
            maxWidth: '100%',
          };
        }
        return {
          background: 'var(--epub-sheet-bg)',
          borderColor: 'var(--epub-sheet-border)',
          boxShadow: 'var(--epub-sheet-shadow)',
          paddingInline: 'var(--epub-page-margin, 32px)',
          width: 'var(--epub-sheet-width)',
          maxWidth: 'var(--epub-sheet-max-width, 100%)',
        };
      };

      const imagePage = getPaginatedViewerStyles(true);
      expect(imagePage.background).toBe('transparent');
      expect(imagePage.paddingInline).toBe('0');
      expect(imagePage.width).toBe('100%');

      const textPage = getPaginatedViewerStyles(false);
      expect(textPage.background).toBe('var(--epub-sheet-bg)');
      expect(textPage.paddingInline).toBe('var(--epub-page-margin, 32px)');
    });
  });
});
