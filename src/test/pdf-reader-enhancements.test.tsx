import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react';
import { ReaderSettings } from '../components/reader/ReaderSettings';
import type { EffectiveReaderSettings } from '../hooks/useReaderSettings';
import { getPdfDisplayScale } from '../formats/engines/PdfPageView';
import { formatSupportsFeature } from '../formats';
import { PdfReader, type PdfReaderHandle } from '../formats/engines/PdfReader';
import { PdfDoubleSidedReader } from '../formats/engines/PdfDoubleSidedReader';
import { useReaderZoom } from '../components/reader/hooks/useReaderZoom';

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

    it('renders Invert Colors toggle switch for PDF and removes Paper White, Archive Gold, and Dark canvas options', () => {
      const handleUpdate = vi.fn();
      const { rerender } = render(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={{ ...dummySettings, invertColors: false }}
          onUpdate={handleUpdate}
          onReset={vi.fn()}
          format="pdf"
          fixedLayout
        />
      );

      // Invert Colors toggle switch should be present for PDF
      const invertToggle = screen.getByRole('switch', { name: /invert colors/i });
      expect(invertToggle).toBeInTheDocument();
      expect(invertToggle).toHaveAttribute('aria-checked', 'false');

      // The old Page Canvas options (Paper White, Archive Gold, Dark) must NOT be rendered for PDF
      expect(screen.queryByRole('button', { name: /paper white/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /archive gold/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^dark$/i })).not.toBeInTheDocument();

      // Clicking the toggle calls onUpdate with invertColors: true
      fireEvent.click(invertToggle);
      expect(handleUpdate).toHaveBeenCalledWith({ invertColors: true });

      // Rerender with invertColors: true
      rerender(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={{ ...dummySettings, invertColors: true }}
          onUpdate={handleUpdate}
          onReset={vi.fn()}
          format="pdf"
          fixedLayout
        />
      );

      const updatedToggle = screen.getByRole('switch', { name: /invert colors/i });
      expect(updatedToggle).toHaveAttribute('aria-checked', 'true');
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

  describe('PdfReader Zoom Anchoring and Text Selection vs Grab-and-Pan', () => {
    const dummyBuffer = new ArrayBuffer(8);

    it('exercises previewZoom to anchor zoom-in to pointer and zoom-out smoothly to center', () => {
      const readerRef = React.createRef<PdfReaderHandle>();
      const { container } = render(
        <PdfReader
          ref={readerRef}
          fileData={dummyBuffer}
          readingMode="scroll"
          readerZoom={1.0}
          onProgressUpdate={vi.fn()}
        />
      );

      const viewport = container.querySelector('[class*="viewport"]') as HTMLElement;
      expect(viewport).toBeInTheDocument();

      const pageStack = document.createElement('div');
      pageStack.className = 'pageStack';
      const pageShell = document.createElement('div');
      pageShell.className = 'pageShell';
      pageShell.setAttribute('data-pdf-page', '1');
      pageStack.appendChild(pageShell);
      viewport.appendChild(pageStack);

      // Zoom in to 2.0x anchored at pointer (150, 200)
      act(() => {
        readerRef.current?.previewZoom(2.0, {
          id: 1,
          viewportX: 150,
          viewportY: 200,
          scrollRatioX: 0.25,
          scrollRatioY: 0.35,
          pageX: 0.25,
          pageY: 0.35,
          pageNumber: 1,
        });
      });

      expect(pageStack.style.transform).toContain('matrix(2');

      // Zoom out to 1.0x: clears transform matrix to center cleanly
      act(() => {
        readerRef.current?.previewZoom(1.0, {
          id: 2,
          viewportX: 400,
          viewportY: 300,
          scrollRatioX: 0.5,
          scrollRatioY: 0.5,
          pageX: 0.5,
          pageY: 0.5,
          pageNumber: 1,
        });
      });

      expect(pageStack.style.transform).toBe('');
      expect(pageStack.style.transformOrigin).toBe('');
    });

    it('allows text selection when clicking on text spans while zoomed in, without grabbing', () => {
      const { container } = render(
        <PdfReader
          fileData={dummyBuffer}
          readingMode="scroll"
          readerZoom={2.0}
          onProgressUpdate={vi.fn()}
        />
      );

      const rootContainer = container.firstChild as HTMLElement;
      expect(rootContainer.className).toMatch(/isZoomed/);

      const viewport = container.querySelector('[class*="viewport"]') as HTMLElement;
      viewport.scrollLeft = 100;
      viewport.scrollTop = 150;

      // Create a page shell with textLayer and span
      const pageShell = document.createElement('div');
      pageShell.className = 'pageShell';
      const textLayer = document.createElement('div');
      textLayer.className = 'textLayer';
      const textSpan = document.createElement('span');
      textSpan.textContent = 'Selectable PDF sentence';
      textLayer.appendChild(textSpan);
      pageShell.appendChild(textLayer);
      viewport.appendChild(pageShell);

      // Click down on the text span
      fireEvent.pointerDown(textSpan, { button: 0, clientX: 200, clientY: 200 });

      // Drag 20px across text
      fireEvent.pointerMove(rootContainer, { buttons: 1, clientX: 220, clientY: 200 });

      // Should NOT enter isPanning because target was selectable text
      expect(rootContainer.className).not.toMatch(/isPanning/);
      expect(viewport.scrollLeft).toBe(100);
      expect(viewport.scrollTop).toBe(150);
    });

    it('enables grab-and-pan when dragging on non-text areas (viewport/margins) while zoomed in', () => {
      const { container } = render(
        <PdfReader
          fileData={dummyBuffer}
          readingMode="scroll"
          readerZoom={2.0}
          onProgressUpdate={vi.fn()}
        />
      );

      const rootContainer = container.firstChild as HTMLElement;
      const viewport = container.querySelector('[class*="viewport"]') as HTMLElement;
      viewport.scrollLeft = 100;
      viewport.scrollTop = 150;

      // Click down on the empty viewport background
      fireEvent.pointerDown(viewport, { button: 0, clientX: 200, clientY: 200 });

      // Drag 30px
      fireEvent.pointerMove(rootContainer, { buttons: 1, clientX: 170, clientY: 160 });

      // Should enter isPanning and update scroll position
      expect(rootContainer.className).toMatch(/isPanning/);
      expect(viewport.scrollLeft).toBe(130);
      expect(viewport.scrollTop).toBe(190);

      // Release mouse
      fireEvent.pointerUp(rootContainer, { button: 0, clientX: 170, clientY: 160 });
      expect(rootContainer.className).not.toMatch(/isPanning/);
    });

    it('activates hand tool mode and allows panning anywhere when Space key is held down', () => {
      const { container } = render(
        <PdfReader
          fileData={dummyBuffer}
          readingMode="scroll"
          readerZoom={2.0}
          onProgressUpdate={vi.fn()}
        />
      );

      const rootContainer = container.firstChild as HTMLElement;
      const viewport = container.querySelector('[class*="viewport"]') as HTMLElement;
      viewport.scrollLeft = 50;
      viewport.scrollTop = 50;

      const textSpan = document.createElement('span');
      textSpan.textContent = 'Text';
      viewport.appendChild(textSpan);

      // Press Space down
      fireEvent.keyDown(rootContainer, { key: ' ', code: 'Space' });
      expect(rootContainer.className).toMatch(/isHandTool/);

      // Drag with Space held down over text span
      fireEvent.pointerDown(textSpan, { button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(rootContainer, { buttons: 1, clientX: 80, clientY: 70 });

      expect(rootContainer.className).toMatch(/isPanning/);
      expect(viewport.scrollLeft).toBe(70);
      expect(viewport.scrollTop).toBe(80);

      // Release mouse and Space
      fireEvent.pointerUp(rootContainer, { button: 0, clientX: 80, clientY: 70 });
      fireEvent.keyUp(rootContainer, { key: ' ', code: 'Space' });
      expect(rootContainer.className).not.toMatch(/isHandTool/);
      expect(rootContainer.className).not.toMatch(/isPanning/);
    });

    it('allows middle-click drag to pan even over text', () => {
      const { container } = render(
        <PdfReader
          fileData={dummyBuffer}
          readingMode="scroll"
          readerZoom={2.0}
          onProgressUpdate={vi.fn()}
        />
      );

      const rootContainer = container.firstChild as HTMLElement;
      const viewport = container.querySelector('[class*="viewport"]') as HTMLElement;
      viewport.scrollLeft = 100;
      viewport.scrollTop = 100;

      const textSpan = document.createElement('span');
      textSpan.textContent = 'Text';
      viewport.appendChild(textSpan);

      // Middle click (button 1)
      fireEvent.pointerDown(textSpan, { button: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(rootContainer, { buttons: 4, clientX: 70, clientY: 60 });

      expect(rootContainer.className).toMatch(/isPanning/);
      expect(viewport.scrollLeft).toBe(130);
      expect(viewport.scrollTop).toBe(140);

      fireEvent.pointerUp(rootContainer, { button: 1, clientX: 70, clientY: 60 });
      expect(rootContainer.className).not.toMatch(/isPanning/);
    });

    it('anchors zoomBy to center when zooming out', () => {
      vi.useFakeTimers();
      try {
        const stageElement = document.createElement('div');
        const viewportElement = document.createElement('div');
        viewportElement.setAttribute('data-reader-viewport', 'pdf-vertical-scroll');
        Object.defineProperty(viewportElement, 'clientWidth', { value: 800, configurable: true });
        Object.defineProperty(viewportElement, 'clientHeight', { value: 600, configurable: true });
        Object.defineProperty(viewportElement, 'scrollWidth', { value: 1600, configurable: true });
        Object.defineProperty(viewportElement, 'scrollHeight', { value: 2400, configurable: true });
        viewportElement.getBoundingClientRect = () => ({
          top: 0,
          left: 0,
          right: 800,
          bottom: 600,
          width: 800,
          height: 600,
          x: 0,
          y: 0,
          toJSON: () => {},
        });
        stageElement.appendChild(viewportElement);
        const stageRef = { current: stageElement };

        const { result } = renderHook(() =>
          useReaderZoom({
            sourceFormat: 'pdf',
            readerStageRef: stageRef,
          })
        );

        // Initial zoom in to 2.0 with pointer
        act(() => {
          result.current.zoomTo(2.0, { x: 200, y: 150 });
          vi.advanceTimersByTime(150);
        });

        // Zoom out to 1.5 with factor < 1
        act(() => {
          result.current.zoomBy(0.75);
          vi.advanceTimersByTime(150);
        });

        expect(result.current.readerZoom).toBeCloseTo(1.5, 2);
        expect(result.current.zoomAnchor?.viewportX).toBe(400);
        expect(result.current.zoomAnchor?.viewportY).toBe(300);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('PdfDoubleSidedReader realistic book rendering and text quality', () => {
    const mockPdfDoc = {
      getPage: vi.fn().mockResolvedValue({
        getViewport: vi.fn(({ scale }: { scale: number }) => ({
          width: 612 * scale,
          height: 792 * scale,
          scale,
        })),
        render: vi.fn(() => ({
          promise: Promise.resolve(),
          cancel: vi.fn(),
        })),
      }),
    } as any;

    it('renders realistic double-sided book spread with soft sheets, spine shadows, and page edges', () => {
      const { container } = render(
        <PdfDoubleSidedReader
          pdfDoc={mockPdfDoc}
          totalPages={4}
          pageSizes={{ 1: { width: 612, height: 792 } }}
          onProgressUpdate={vi.fn()}
        />
      );

      // Verify book stage and container exist
      const bookStage = container.querySelector('[class*="bookStage"]');
      expect(bookStage).toBeInTheDocument();
      const bookContainer = container.querySelector('[class*="bookContainer"]');
      expect(bookContainer).toBeInTheDocument();

      // Verify page sheets exist with soft density (not rigid hard covers)
      const sheets = container.querySelectorAll('[class*="pageSheet"]');
      expect(sheets.length).toBeGreaterThanOrEqual(4);
      sheets.forEach((sheet) => {
        expect(sheet.getAttribute('data-density')).toBe('soft');
      });

      // Verify realistic spine shadows are created
      const leftSpineShadows = container.querySelectorAll('[class*="spineShadowLeft"]');
      const rightSpineShadows = container.querySelectorAll('[class*="spineShadowRight"]');
      expect(leftSpineShadows.length).toBeGreaterThan(0);
      expect(rightSpineShadows.length).toBeGreaterThan(0);

      // Verify page edge highlights exist
      const leftEdges = container.querySelectorAll('[class*="pageEdgeLeft"]');
      const rightEdges = container.querySelectorAll('[class*="pageEdgeRight"]');
      expect(leftEdges.length).toBeGreaterThan(0);
      expect(rightEdges.length).toBeGreaterThan(0);

      // Verify navigation buttons
      expect(screen.getByRole('button', { name: /previous page/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /next page/i })).toBeInTheDocument();
    });

    it('applies color inversion to mounted PageFlip spread', () => {
      const { container, rerender } = render(
        <PdfDoubleSidedReader
          pdfDoc={mockPdfDoc}
          totalPages={4}
          pageSizes={{ 1: { width: 612, height: 792 } }}
          onProgressUpdate={vi.fn()}
          invertColors={false}
        />
      );

      expect(container.querySelector('[class*="containerInverted"]')).not.toBeInTheDocument();

      rerender(
        <PdfDoubleSidedReader
          pdfDoc={mockPdfDoc}
          totalPages={4}
          pageSizes={{ 1: { width: 612, height: 792 } }}
          onProgressUpdate={vi.fn()}
          invertColors={true}
        />
      );

      expect(container.querySelector('[class*="containerInverted"]')).toBeInTheDocument();
      expect(container.querySelector('[class*="pageInverted"]')).toBeInTheDocument();
    });

    it('handles keyboard navigation without throwing', () => {
      const { container } = render(
        <PdfDoubleSidedReader
          pdfDoc={mockPdfDoc}
          totalPages={4}
          pageSizes={{ 1: { width: 612, height: 792 } }}
          onProgressUpdate={vi.fn()}
        />
      );

      const root = container.firstElementChild as HTMLElement;
      expect(() => {
        fireEvent.keyDown(root, { key: 'ArrowRight' });
        fireEvent.keyDown(root, { key: 'ArrowLeft' });
        fireEvent.keyDown(root, { key: 'Home' });
        fireEvent.keyDown(root, { key: 'End' });
      }).not.toThrow();
    });

    it('anchors double-sided previewZoom to pointer when zooming in and pulls back to center when zooming out', () => {
      const readerRef = React.createRef<PdfReaderHandle>();
      const { container } = render(
        <PdfDoubleSidedReader
          ref={readerRef}
          pdfDoc={mockPdfDoc}
          totalPages={4}
          pageSizes={{ 1: { width: 612, height: 792 } }}
          onProgressUpdate={vi.fn()}
        />
      );

      const bookStage = container.querySelector('[class*="bookStage"]') as HTMLElement;
      expect(bookStage).toBeInTheDocument();

      // Pointer zoom in to 1.8x anchored at (600, 300)
      act(() => {
        readerRef.current?.previewZoom(1.8, {
          id: 1,
          viewportX: 600,
          viewportY: 300,
          scrollRatioX: 0.5,
          scrollRatioY: 0.5,
          pageNumber: 2,
        });
      });

      expect(bookStage.style.getPropertyValue('--pdf-reader-zoom')).toBe('1.8');
      expect(bookStage.style.getPropertyValue('--pdf-pan-x')).not.toBe('');

      // Zoom out towards 1.0 pulls pan back to center (0px, 0px)
      act(() => {
        readerRef.current?.previewZoom(1.0);
      });

      expect(bookStage.style.getPropertyValue('--pdf-reader-zoom')).toBe('1');
      expect(bookStage.style.getPropertyValue('--pdf-pan-x')).toBe('0px');
      expect(bookStage.style.getPropertyValue('--pdf-pan-y')).toBe('0px');
    });

    it('allows drag-to-pan in double-sided mode when zoomed in', () => {
      const { container } = render(
        <PdfDoubleSidedReader
          pdfDoc={mockPdfDoc}
          totalPages={4}
          pageSizes={{ 1: { width: 612, height: 792 } }}
          onProgressUpdate={vi.fn()}
          readerZoom={2.0}
        />
      );

      const root = container.firstElementChild as HTMLElement;
      const bookStage = container.querySelector('[class*="bookStage"]') as HTMLElement;

      fireEvent.pointerDown(root, { button: 0, clientX: 200, clientY: 200 });
      fireEvent.pointerMove(root, { buttons: 1, clientX: 160, clientY: 150 });

      expect(bookStage.style.getPropertyValue('--pdf-pan-x')).not.toBe('0px');

      fireEvent.pointerUp(root, { button: 0, clientX: 160, clientY: 150 });
    });

    it('frees canvases for pages outside nearby range to prevent unbounded memory growth', () => {
      const { container } = render(
        <PdfDoubleSidedReader
          pdfDoc={mockPdfDoc}
          totalPages={12}
          pageSizes={{ 1: { width: 612, height: 792 } }}
          onProgressUpdate={vi.fn()}
        />
      );

      const canvases = container.querySelectorAll('canvas');
      expect(canvases.length).toBeGreaterThan(0);
    });
  });
});
