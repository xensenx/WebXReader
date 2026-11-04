import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  calculateFlipBookDimensions,
} from '../formats/engines/epub-flipbook-dimensions';
import {
  EpubDoubleSidedReader,
} from '../formats/engines/EpubDoubleSidedReader';
import { EpubReader } from '../formats/engines/EpubReader';
import type { EffectiveReaderSettings } from '../hooks/useReaderSettings';

describe('EPUB Double Sided FlipBook Reader', () => {
  const baseSettings: EffectiveReaderSettings = {
    fontFamily: 'Georgia, serif',
    fontSize: 18,
    lineHeight: 1.7,
    paragraphSpacing: 1.0,
    letterSpacing: 0,
    wordSpacing: 0,
    textAlign: 'left',
    textIndent: 0,
    maxContentWidth: 794,
    contentMargin: 24,
    readingMode: 'vertical',
    theme: 'light',
    readerSheetColor: 'paper',
    expandContent: false,
  };

  describe('calculateFlipBookDimensions', () => {
    it('calculates a two-page spread with ~1.42 aspect ratio on desktop viewports', () => {
      const dims = calculateFlipBookDimensions(1400, 900, 794, 24);

      expect(dims.isPortrait).toBe(false);
      expect(dims.pageWidth * 2).toBeLessThanOrEqual(1400);
      expect(dims.pageHeight).toBeLessThanOrEqual(900);

      const ratio = dims.pageHeight / dims.pageWidth;
      expect(Math.abs(ratio - 1.42)).toBeLessThan(0.05);

      expect(dims.printableW).toBe(dims.pageWidth - dims.pageInnerPadding * 2);
      expect(dims.printableH).toBe(
        dims.pageHeight - dims.pageInnerPadding * 2 - dims.headerHeight - dims.footerHeight
      );
      expect(dims.headerHeight).toBe(32);
      expect(dims.footerHeight).toBe(32);
    });

    it('falls back to single-page portrait layout on narrow screens (< 680px)', () => {
      const dims = calculateFlipBookDimensions(500, 800, 794, 20);

      expect(dims.isPortrait).toBe(true);
      expect(dims.pageWidth).toBeLessThanOrEqual(500);
      expect(dims.pageHeight).toBeLessThanOrEqual(800);

      const ratio = dims.pageHeight / dims.pageWidth;
      expect(Math.abs(ratio - 1.42)).toBeLessThan(0.05);
    });

    it('respects contentMargin and maxContentWidth bounds', () => {
      const margin = 36;
      const dims = calculateFlipBookDimensions(1600, 1000, 600, margin);

      expect(dims.pageInnerPadding).toBe(margin);
      expect(dims.printableW).toBe(dims.pageWidth - margin * 2);
    });

    it('clamps to safe minimum dimensions on very small viewports', () => {
      const dims = calculateFlipBookDimensions(200, 300);

      expect(dims.pageWidth).toBeGreaterThanOrEqual(260);
      expect(dims.pageHeight).toBeGreaterThanOrEqual(380);
      expect(dims.printableW).toBeGreaterThan(0);
      expect(dims.printableH).toBeGreaterThan(0);
    });
  });

  describe('EpubDoubleSidedReader component', () => {
    it('renders the book stage, wrapper, and next/prev navigation buttons', () => {
      const dummyBuffer = new ArrayBuffer(8);
      const onProgressUpdate = vi.fn();

      const { container } = render(
        <EpubDoubleSidedReader
          fileData={dummyBuffer}
          settings={baseSettings}
          onProgressUpdate={onProgressUpdate}
        />
      );

      // Verify book stage exists
      const bookStage = container.querySelector('[class*="bookStage"]');
      expect(bookStage).toBeInTheDocument();

      // Verify book wrapper exists
      const bookWrapper = container.querySelector('[class*="bookWrapper"]');
      expect(bookWrapper).toBeInTheDocument();

      // Verify navigation buttons (Previous and Next Page)
      const prevBtn = screen.getByRole('button', { name: /previous page/i });
      const nextBtn = screen.getByRole('button', { name: /next page/i });
      expect(prevBtn).toBeInTheDocument();
      expect(nextBtn).toBeInTheDocument();
    });

    it('handles keyboard navigation with arrow keys and space', () => {
      const dummyBuffer = new ArrayBuffer(8);
      const onProgressUpdate = vi.fn();

      const { container } = render(
        <EpubDoubleSidedReader
          fileData={dummyBuffer}
          settings={baseSettings}
          onProgressUpdate={onProgressUpdate}
        />
      );

      const readerRoot = container.firstElementChild as HTMLElement;
      expect(readerRoot).toBeInTheDocument();

      // ArrowRight, ArrowLeft, PageDown, PageUp, Space key events should not throw
      expect(() => {
        fireEvent.keyDown(readerRoot, { key: 'ArrowRight' });
        fireEvent.keyDown(readerRoot, { key: 'ArrowLeft' });
        fireEvent.keyDown(readerRoot, { key: 'PageDown' });
        fireEvent.keyDown(readerRoot, { key: 'PageUp' });
        fireEvent.keyDown(readerRoot, { key: ' ' });
      }).not.toThrow();
    });

    it('applies sheet colors CSS variables to container', () => {
      const dummyBuffer = new ArrayBuffer(8);
      const archiveSettings: EffectiveReaderSettings = {
        ...baseSettings,
        readerSheetColor: 'archive',
      };

      const { container } = render(
        <EpubDoubleSidedReader
          fileData={dummyBuffer}
          settings={archiveSettings}
          onProgressUpdate={vi.fn()}
        />
      );

      const rootEl = container.firstElementChild as HTMLElement;
      expect(rootEl.style.getPropertyValue('--epub-sheet-bg')).toBe('#f6eedb');
      expect(rootEl.style.getPropertyValue('--epub-sheet-color')).toBe('#3d3226');
    });

    it('renders side focus controls and enables pan when zoomed in', () => {
      const dummyBuffer = new ArrayBuffer(8);
      const onZoomTo = vi.fn();

      const { container } = render(
        <EpubDoubleSidedReader
          fileData={dummyBuffer}
          settings={baseSettings}
          onProgressUpdate={vi.fn()}
          readerZoom={1.5}
          onZoomTo={onZoomTo}
        />
      );

      // Verify side focus pill bar is present when zoomed in
      const focusBar = screen.getByRole('group', { name: /page zoom focus/i });
      expect(focusBar).toBeInTheDocument();

      const leftPageBtn = screen.getByRole('button', { name: /focus left page/i });
      const centerBtn = screen.getByRole('button', { name: /center spread/i });
      const rightPageBtn = screen.getByRole('button', { name: /focus right page/i });

      expect(leftPageBtn).toBeInTheDocument();
      expect(centerBtn).toBeInTheDocument();
      expect(rightPageBtn).toBeInTheDocument();

      // Click Left Page focus
      fireEvent.click(leftPageBtn);
      const bookStage = container.querySelector('[class*="bookStage"]') as HTMLElement;
      expect(bookStage).toBeInTheDocument();
      const panXLeft = bookStage.style.getPropertyValue('--epub-pan-x');
      expect(panXLeft).toBeTruthy();

      // Click Right Page focus
      fireEvent.click(rightPageBtn);
      const panXRight = bookStage.style.getPropertyValue('--epub-pan-x');
      expect(panXRight).toBeTruthy();

      // Click Center focus
      fireEvent.click(centerBtn);
      expect(bookStage.style.getPropertyValue('--epub-pan-x')).toBe('0px');
    });

    it('triggers zoom toggle on double click', () => {
      const dummyBuffer = new ArrayBuffer(8);
      const onZoomTo = vi.fn();

      const { container, rerender } = render(
        <EpubDoubleSidedReader
          fileData={dummyBuffer}
          settings={baseSettings}
          onProgressUpdate={vi.fn()}
          readerZoom={1}
          onZoomTo={onZoomTo}
        />
      );

      const bookWrapper = container.querySelector('[class*="bookWrapper"]') as HTMLElement;
      expect(bookWrapper).toBeInTheDocument();

      // Double click at 100% zoom requests 1.6x zoom
      fireEvent.doubleClick(bookWrapper, { clientX: 300 });
      expect(onZoomTo).toHaveBeenCalledWith(1.6, expect.anything());

      // Re-render zoomed in
      rerender(
        <EpubDoubleSidedReader
          fileData={dummyBuffer}
          settings={baseSettings}
          onProgressUpdate={vi.fn()}
          readerZoom={1.6}
          onZoomTo={onZoomTo}
        />
      );

      // Double click when zoomed in resets to 1.0x
      fireEvent.doubleClick(bookWrapper, { clientX: 300 });
      expect(onZoomTo).toHaveBeenCalledWith(1);
    });

    it('handles mouse wheel pan when zoomed in', () => {
      const dummyBuffer = new ArrayBuffer(8);

      const { container } = render(
        <EpubDoubleSidedReader
          fileData={dummyBuffer}
          settings={baseSettings}
          onProgressUpdate={vi.fn()}
          readerZoom={1.5}
        />
      );

      const readerRoot = container.firstElementChild as HTMLElement;
      expect(() => {
        fireEvent.wheel(readerRoot, { deltaX: 40, deltaY: 20 });
      }).not.toThrow();
    });
  });

  describe('EpubReader integration', () => {
    it('mounts EpubDoubleSidedReader when readingMode is vertical', () => {
      const dummyBuffer = new ArrayBuffer(8);

      const { container } = render(
        <EpubReader
          fileData={dummyBuffer}
          settings={{ ...baseSettings, readingMode: 'vertical' }}
          onProgressUpdate={vi.fn()}
        />
      );

      // Book stage for double-sided flipbook is present
      const bookStage = container.querySelector('[class*="bookStage"]');
      expect(bookStage).toBeInTheDocument();
    });
  });
});
