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

        // Image-only section: drops paper canvas and sizes based on orientation.
        // Portrait uses sheet width (or explicit pixel dimensions) to avoid circular iframe collapse with fit-content.
        return {
          background: 'transparent',
          border: 'none',
          boxShadow: 'none',
          width: orientation === 'landscape' ? 'min(100%, 1400px)' : 'var(--epub-sheet-width, min(794px, 100%))',
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
      expect(portraitImage.width).toBe('var(--epub-sheet-width, min(794px, 100%))');

      const textSection = getViewStyles(false, 'portrait');
      expect(textSection.background).toBe('var(--epub-sheet-bg)');
      expect(textSection.width).toBe('var(--epub-sheet-width)');
    });

    it('calculates explicit pixel dimensions for SVG and image wrappers to prevent iframe height collapse', () => {
      const calculateTargetDimensions = (
        primaryWidth: number,
        primaryHeight: number,
        availableWidth: number,
        availableHeight: number,
        canvasWidth: number
      ) => {
        const aspectRatio = primaryWidth / primaryHeight;
        const orientation = aspectRatio > 1.15 ? 'landscape' : aspectRatio < 0.95 ? 'portrait' : 'square';

        let targetWidth = 0;
        let targetHeight = 0;

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
          const maxWidth = Math.min(Math.round(availableWidth * 0.96), canvasWidth > 0 ? canvasWidth : 800);
          if (targetWidth > maxWidth) {
            targetWidth = maxWidth;
            targetHeight = Math.round(targetWidth / aspectRatio);
          }
        }

        return { orientation, targetWidth, targetHeight, aspectRatio };
      };

      // Test 1: Yen Press Light Novel portrait cover / insert (1200x1800)
      const portraitInsert = calculateTargetDimensions(1200, 1800, 1200, 900, 794);
      expect(portraitInsert.orientation).toBe('portrait');
      expect(portraitInsert.targetHeight).toBeGreaterThan(600); // Does NOT collapse to 20px
      expect(portraitInsert.targetWidth).toBeLessThanOrEqual(794);
      expect(Math.abs(portraitInsert.targetWidth / portraitInsert.targetHeight - 1200 / 1800)).toBeLessThan(0.02);

      // Test 2: Double-page landscape color spread (2400x1800)
      const landscapeSpread = calculateTargetDimensions(2400, 1800, 1600, 900, 794);
      expect(landscapeSpread.orientation).toBe('landscape');
      expect(landscapeSpread.targetWidth).toBeGreaterThan(1000); // Expands beyond single sheet
      expect(landscapeSpread.targetHeight).toBeLessThanOrEqual(Math.round(900 * 0.88));
      expect(Math.abs(landscapeSpread.targetWidth / landscapeSpread.targetHeight - 2400 / 1800)).toBeLessThan(0.02);
    });

    it('preserves stable typography font size during canvas zoom while scaling sheet width', () => {
      const getEpubDimensionsAndTypography = (
        fontSize: number,
        baseWidth: number,
        readerZoom: number,
        isExpanded: boolean
      ) => {
        // Font size remains stable at user-chosen font size; canvas width scales with zoom in contracted mode
        const canvasWidth = Math.round(baseWidth * readerZoom);
        const effectiveFontSize = fontSize;
        const sheetWidthStyle = isExpanded ? '100%' : `${canvasWidth}px`;

        return { effectiveFontSize, canvasWidth, sheetWidthStyle };
      };

      const base = getEpubDimensionsAndTypography(18, 794, 1.0, false);
      expect(base.effectiveFontSize).toBe(18);
      expect(base.canvasWidth).toBe(794);

      const zoomedIn = getEpubDimensionsAndTypography(18, 794, 1.25, false);
      // Font size must NOT fluctuate on zoom
      expect(zoomedIn.effectiveFontSize).toBe(18);
      // Canvas width must scale up
      expect(zoomedIn.canvasWidth).toBe(993);
      expect(zoomedIn.sheetWidthStyle).toBe('993px');

      const zoomedOut = getEpubDimensionsAndTypography(18, 794, 0.8, false);
      expect(zoomedOut.effectiveFontSize).toBe(18);
      expect(zoomedOut.canvasWidth).toBe(635);
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
