import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReaderSettings } from '../components/reader/ReaderSettings';
import type { EffectiveReaderSettings } from '../hooks/useReaderSettings';
import { getPdfDisplayScale } from '../formats/engines/PdfPageView';
import { formatSupportsFeature } from '../formats';

describe('PDF Reader Enhancements', () => {
  const dummySettings: EffectiveReaderSettings = {
    fontFamily: 'Georgia, serif',
    fontSize: 18,
    lineHeight: 1.7,
    paragraphSpacing: 1.0,
    letterSpacing: 0,
    wordSpacing: 0,
    textAlign: 'left',
    textIndent: 0,
    maxContentWidth: 720,
    contentMargin: 24,
    readingMode: 'scroll',
    theme: 'light',
    readerSheetColor: 'paper',
    expandContent: false,
  };

  describe('Format Capabilities for PDF', () => {
    it('supports double-sided book spreads', () => {
      expect(formatSupportsFeature('pdf', 'doubleSided')).toBe(true);
    });

    it('supports continuous horizontal scrolling', () => {
      expect(formatSupportsFeature('pdf', 'horizontalScroll')).toBe(true);
    });

    it('supports continuous vertical scrolling and single-page modes', () => {
      expect(formatSupportsFeature('pdf', 'continuousScroll')).toBe(true);
      expect(formatSupportsFeature('pdf', 'paginated')).toBe(true);
    });
  });

  describe('ReaderSettings component for PDF', () => {
    it('renders all 4 reading modes: Vertical Scroll, Horizontal Scroll, Pages, and Double Sided for PDF', () => {
      const handleUpdate = vi.fn();
      const { rerender } = render(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={dummySettings}
          onUpdate={handleUpdate}
          onReset={vi.fn()}
          format="pdf"
          fixedLayout
        />
      );

      const scrollBtn = screen.getByRole('button', { name: /vertical scroll/i });
      const horizontalBtn = screen.getByRole('button', { name: /horizontal scroll/i });
      const pagesBtn = screen.getByRole('button', { name: /^pages$/i });
      const doubleSidedBtn = screen.getByRole('button', { name: /double sided/i });

      expect(scrollBtn).toBeInTheDocument();
      expect(horizontalBtn).toBeInTheDocument();
      expect(pagesBtn).toBeInTheDocument();
      expect(doubleSidedBtn).toBeInTheDocument();

      // Double-sided is enabled and operable for PDF
      expect(doubleSidedBtn).not.toBeDisabled();

      // Click Horizontal Scroll
      fireEvent.click(horizontalBtn);
      expect(handleUpdate).toHaveBeenCalledWith({ readingMode: 'horizontal' });

      // Click Double Sided
      fireEvent.click(doubleSidedBtn);
      expect(handleUpdate).toHaveBeenCalledWith({ readingMode: 'vertical' });

      // Click Pages
      fireEvent.click(pagesBtn);
      expect(handleUpdate).toHaveBeenCalledWith({ readingMode: 'paginated' });

      // Rerender with readingMode: 'horizontal'
      rerender(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={{ ...dummySettings, readingMode: 'horizontal' }}
          onUpdate={handleUpdate}
          onReset={vi.fn()}
          format="pdf"
          fixedLayout
        />
      );

      expect(horizontalBtn.className).toMatch(/modeBtnActive/);
      expect(scrollBtn.className).not.toMatch(/modeBtnActive/);
      expect(pagesBtn.className).not.toMatch(/modeBtnActive/);
      expect(doubleSidedBtn.className).not.toMatch(/modeBtnActive/);

      // Rerender with readingMode: 'vertical'
      rerender(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={{ ...dummySettings, readingMode: 'vertical' }}
          onUpdate={handleUpdate}
          onReset={vi.fn()}
          format="pdf"
          fixedLayout
        />
      );

      expect(doubleSidedBtn.className).toMatch(/modeBtnActive/);
      expect(pagesBtn.className).not.toMatch(/modeBtnActive/);
      expect(horizontalBtn.className).not.toMatch(/modeBtnActive/);
      expect(scrollBtn.className).not.toMatch(/modeBtnActive/);
    });
  });

  describe('getPdfDisplayScale responsive geometry', () => {
    it('scales page to fit available width in vertical scroll mode', () => {
      // 612 pt wide page in 800px viewport
      // avail width = 800 - 32 = 768. Fit scale = 768 / 612 = 1.2549
      const scale = getPdfDisplayScale(612, 800, 1.0, 'scroll', 792, 1000);
      expect(scale).toBeCloseTo(768 / 612, 2);
    });

    it('scales page to fit viewport height and width in horizontal mode', () => {
      // 612 x 792 pt page in 1200 x 800 px viewport
      // availW = 1200 - 48 = 1152; availH = 800 - 48 = 752
      // scaleW = 1152 / 612 = 1.882; scaleH = 752 / 792 = 0.949
      // fitScale = Math.min(1.882, 0.949) = 0.949
      const scale = getPdfDisplayScale(612, 1200, 1.0, 'horizontal', 792, 800);
      expect(scale).toBeCloseTo(752 / 792, 2);
    });

    it('scales page to fit half viewport width in double-sided spread mode', () => {
      // 612 x 792 pt page in 1600 x 900 px viewport
      // availW = (1600 - 64) / 2 = 768; availH = 900 - 48 = 852
      // scaleW = 768 / 612 = 1.2549; scaleH = 852 / 792 = 1.0757
      // fitScale = Math.min(1.2549, 1.0757) = 1.0757
      const scale = getPdfDisplayScale(612, 1600, 1.0, 'vertical', 792, 900);
      expect(scale).toBeCloseTo(852 / 792, 2);
    });

    it('multiplies by readerZoom smoothly', () => {
      const baseScale = getPdfDisplayScale(612, 800, 1.0, 'scroll', 792, 1000);
      const zoomedScale = getPdfDisplayScale(612, 800, 1.5, 'scroll', 792, 1000);
      expect(zoomedScale).toBeCloseTo(baseScale * 1.5, 2);
    });
  });
});
