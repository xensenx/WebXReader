import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ReaderSettings } from '../components/reader/ReaderSettings';
import type { EffectiveReaderSettings } from '../hooks/useReaderSettings';
import { formatSupportsFeature } from '../formats';
import { CbzReader, type CbzReaderHandle } from '../formats/engines/CbzReader';
import { ComicDoubleSidedReader } from '../formats/engines/ComicDoubleSidedReader';

describe('Comic Reader Enhancements (CBZ, CBR, CB7)', () => {
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
    invertColors: false,
    comicReadingDirection: 'ltr',
    comicFitMode: 'contain',
  };

  describe('Format Capabilities for Comic Formats', () => {
    const comicFormats = ['cbz', 'cbr', 'cb7'] as const;

    comicFormats.forEach((fmt) => {
      it(`supports horizontal scroll, double-sided, paginated, and continuous scroll for ${fmt.toUpperCase()}`, () => {
        expect(formatSupportsFeature(fmt, 'horizontalScroll')).toBe(true);
        expect(formatSupportsFeature(fmt, 'doubleSided')).toBe(true);
        expect(formatSupportsFeature(fmt, 'continuousScroll')).toBe(true);
        expect(formatSupportsFeature(fmt, 'paginated')).toBe(true);
        expect(formatSupportsFeature(fmt, 'readingDirection')).toBe(true);
        expect(formatSupportsFeature(fmt, 'fitMode')).toBe(true);
        expect(formatSupportsFeature(fmt, 'zoom')).toBe(true);
      });
    });
  });

  describe('ReaderSettings component for Comic Formats', () => {
    it('renders all 4 reading modes: Vertical Scroll, Horizontal Scroll, Pages, and Double Sided for CBZ', () => {
      const handleUpdate = vi.fn();
      render(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={dummySettings}
          onUpdate={handleUpdate}
          onReset={vi.fn()}
          format="cbz"
          fixedLayout
        />
      );

      expect(screen.getByRole('button', { name: /vertical scroll/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /horizontal scroll/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /pages/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /double sided/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /horizontal scroll/i }));
      expect(handleUpdate).toHaveBeenCalledWith({ readingMode: 'horizontal' });

      fireEvent.click(screen.getByRole('button', { name: /double sided/i }));
      expect(handleUpdate).toHaveBeenCalledWith({ readingMode: 'vertical' });
    });

    it('renders the Invert Colors toggle switch for comic formats and omits sheet color swatches', () => {
      const handleUpdate = vi.fn();
      render(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={dummySettings}
          onUpdate={handleUpdate}
          onReset={vi.fn()}
          format="cbr"
          fixedLayout
        />
      );

      const invertToggle = screen.getByRole('switch', { name: /invert colors/i });
      expect(invertToggle).toBeInTheDocument();
      expect(invertToggle).toHaveAttribute('aria-checked', 'false');

      fireEvent.click(invertToggle);
      expect(handleUpdate).toHaveBeenCalledWith({ invertColors: true });

      // Sheet color swatches should not appear for comic formats
      expect(screen.queryByRole('button', { name: /paper white/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /archive gold/i })).not.toBeInTheDocument();
    });

    it('omits reading direction controls to maintain standard natural page turning', () => {
      const handleUpdate = vi.fn();
      render(
        <ReaderSettings
          isOpen
          onClose={vi.fn()}
          settings={dummySettings}
          onUpdate={handleUpdate}
          onReset={vi.fn()}
          format="cb7"
          fixedLayout
        />
      );

      const ltrBtn = screen.queryByRole('button', { name: /ltr \(western\)/i });
      const rtlBtn = screen.queryByRole('button', { name: /rtl \(manga\)/i });
      expect(ltrBtn).not.toBeInTheDocument();
      expect(rtlBtn).not.toBeInTheDocument();
    });
  });

  describe('CbzReader Zoom Anchoring, Pan & Gestures', () => {
    const dummyBuffer = new ArrayBuffer(8);

    it('exercises previewZoom to anchor zoom-in to pointer and zoom-out smoothly to center', () => {
      const readerRef = React.createRef<CbzReaderHandle>();
      const { container } = render(
        <CbzReader
          ref={readerRef}
          fileData={dummyBuffer}
          readingMode="scroll"
          readerZoom={1.0}
          onProgressUpdate={vi.fn()}
        />
      );

      const viewport = container.querySelector('[class*="viewport"]') as HTMLElement;
      expect(viewport).toBeInTheDocument();

      const pageStack = container.querySelector('[class*="Stack"]') as HTMLElement;
      expect(pageStack).toBeInTheDocument();

      const pageShell = document.createElement('div');
      pageShell.className = 'pageShell';
      pageShell.setAttribute('data-comic-page', '1');
      pageStack.appendChild(pageShell);

      // Zoom in to 2.0x anchored at pointer (200, 150)
      act(() => {
        readerRef.current?.previewZoom(2.0, {
          id: 1,
          viewportX: 200,
          viewportY: 150,
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

    it('activates hand tool mode and allows panning anywhere when Space key is held down', () => {
      const { container } = render(
        <CbzReader
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

      // Press Space down
      fireEvent.keyDown(rootContainer, { key: ' ', code: 'Space' });
      expect(rootContainer.className).toMatch(/isHandTool/);

      // Drag with Space held down
      fireEvent.pointerDown(rootContainer, { button: 0, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(rootContainer, { buttons: 1, clientX: 80, clientY: 70 });

      expect(rootContainer.className).toMatch(/isPanning/);
      expect(viewport.scrollLeft).toBe(70);
      expect(viewport.scrollTop).toBe(80);

      fireEvent.pointerUp(rootContainer, { button: 0, clientX: 80, clientY: 70 });
      expect(rootContainer.className).not.toMatch(/isPanning/);

      // Release Space
      fireEvent.keyUp(rootContainer, { key: ' ', code: 'Space' });
      expect(rootContainer.className).not.toMatch(/isHandTool/);
    });

    it('allows middle-click drag to pan in comic view', () => {
      const { container } = render(
        <CbzReader
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

      // Middle click (button 1)
      fireEvent.pointerDown(rootContainer, { button: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(rootContainer, { buttons: 4, clientX: 70, clientY: 60 });

      expect(rootContainer.className).toMatch(/isPanning/);
      expect(viewport.scrollLeft).toBe(130);
      expect(viewport.scrollTop).toBe(140);

      fireEvent.pointerUp(rootContainer, { button: 1, clientX: 70, clientY: 60 });
      expect(rootContainer.className).not.toMatch(/isPanning/);
    });

    it('applies inverted colors class when invertColors is enabled', () => {
      const { container } = render(
        <CbzReader
          fileData={dummyBuffer}
          readingMode="scroll"
          invertColors={true}
          onProgressUpdate={vi.fn()}
        />
      );

      expect(container.firstChild).toHaveClass(/containerInverted/);
    });

    it('supports horizontal ribbon scroll mode layout and viewport dataset', () => {
      const { container } = render(
        <CbzReader
          fileData={dummyBuffer}
          readingMode="horizontal"
          onProgressUpdate={vi.fn()}
        />
      );

      const viewport = container.querySelector('[class*="viewport"]');
      expect(viewport).toHaveAttribute('data-reader-viewport', 'comic-horizontal-scroll');
      expect(viewport).toHaveAttribute('data-comic-viewport', 'horizontal-scroll');
    });

    it('reports progress when navigating pages in paginated mode without needing a scroll event', () => {
      const onProgress = vi.fn();
      const readerRef = React.createRef<CbzReaderHandle>();
      render(
        <CbzReader
          ref={readerRef}
          fileData={dummyBuffer}
          readingMode="paginated"
          onProgressUpdate={onProgress}
        />
      );

      act(() => {
        readerRef.current?.goToPage(2);
      });

      expect(onProgress).toHaveBeenCalledWith('2', expect.any(Number), 1);
    });

    it('scrolls horizontally on native wheel events in horizontal ribbon mode', () => {
      const { container } = render(
        <CbzReader
          fileData={dummyBuffer}
          readingMode="horizontal"
          onProgressUpdate={vi.fn()}
        />
      );

      const viewport = container.querySelector('[class*="viewport"]') as HTMLElement;
      fireEvent.wheel(viewport, { deltaY: 100 });
      expect(viewport.scrollLeft).toBe(100);
    });

    it('smoothly scales down page stack below 1.0 when zooming out without clearing matrix', async () => {
      const ref = { current: null as any };
      const { container } = render(
        <CbzReader
          ref={ref}
          fileData={dummyBuffer}
          readingMode="scroll"
          readerZoom={1.0}
          onProgressUpdate={vi.fn()}
        />
      );

      const stack = container.querySelector('[class*="Stack"]') as HTMLElement;
      expect(stack).toBeInTheDocument();

      // Zoom out to 0.75
      act(() => {
        ref.current?.previewZoom(0.75, { viewportX: 300, viewportY: 300 });
      });

      expect(stack.style.transform).toContain('matrix(0.75');
    });

    it('stops event propagation on Ctrl+wheel zoom gesture in comic reader', () => {
      const handleZoomGesture = vi.fn();
      const { container } = render(
        <CbzReader
          fileData={dummyBuffer}
          readingMode="scroll"
          onProgressUpdate={vi.fn()}
          onZoomGesture={handleZoomGesture}
        />
      );

      const viewport = container.querySelector('[data-reader-viewport]') as HTMLElement;
      const wheelEvent = new WheelEvent('wheel', {
        ctrlKey: true,
        deltaY: -100,
        clientX: 250,
        clientY: 300,
        bubbles: true,
        cancelable: true,
      });

      const stopPropagationSpy = vi.spyOn(wheelEvent, 'stopPropagation');
      const preventDefaultSpy = vi.spyOn(wheelEvent, 'preventDefault');

      viewport.dispatchEvent(wheelEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();
      expect(handleZoomGesture).toHaveBeenCalledWith(-100, expect.any(Object));
    });
  });

  describe('ComicDoubleSidedReader realistic 3D book spread and physics', () => {
    const mockLoadUrl = vi.fn().mockResolvedValue('blob:http://localhost/mock-comic-page');

    it('renders realistic double-sided comic spread with 3D sheets, spine shadows, and page edges', () => {
      const { container } = render(
        <ComicDoubleSidedReader
          totalPages={6}
          loadUrl={mockLoadUrl}
          pageSizes={{ 1: { width: 800, height: 1200 } }}
          onProgressUpdate={vi.fn()}
        />
      );

      const bookStage = container.querySelector('[class*="bookStage"]');
      expect(bookStage).toBeInTheDocument();
      const bookContainer = container.querySelector('[class*="bookContainer"]');
      expect(bookContainer).toBeInTheDocument();

      // Verify 3D sheets exist with soft density and paint isolation content wrappers
      const sheets = container.querySelectorAll('[class*="pageSheet"]');
      expect(sheets.length).toBeGreaterThanOrEqual(6);
      sheets.forEach((sheet) => {
        expect(sheet.getAttribute('data-density')).toBe('soft');
        expect(sheet.querySelector('[class*="pageContentWrapper"]')).toBeInTheDocument();
      });

      // Verify spine shadows exist
      const leftSpineShadows = container.querySelectorAll('[class*="spineShadowLeft"]');
      const rightSpineShadows = container.querySelectorAll('[class*="spineShadowRight"]');
      expect(leftSpineShadows.length).toBeGreaterThan(0);
      expect(rightSpineShadows.length).toBeGreaterThan(0);

      // Verify page edges exist
      const leftEdges = container.querySelectorAll('[class*="pageEdgeLeft"]');
      const rightEdges = container.querySelectorAll('[class*="pageEdgeRight"]');
      expect(leftEdges.length).toBeGreaterThan(0);
      expect(rightEdges.length).toBeGreaterThan(0);

      // Verify navigation buttons
      expect(screen.getByRole('button', { name: /previous page/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /next page/i })).toBeInTheDocument();
    });

    it('maintains consistent sequential navigation order across double-sided comic spreads', () => {
      render(
        <ComicDoubleSidedReader
          totalPages={6}
          loadUrl={mockLoadUrl}
          pageSizes={{ 1: { width: 800, height: 1200 } }}
          onProgressUpdate={vi.fn()}
        />
      );

      const leftBtn = screen.getByRole('button', { name: /previous page/i });
      const rightBtn = screen.getByRole('button', { name: /next page/i });
      expect(leftBtn).toHaveClass(/navLeft/);
      expect(rightBtn).toHaveClass(/navRight/);
    });

    it('anchors double-sided previewZoom to pointer when zooming in and pulls back to center when zooming out', () => {
      const readerRef = React.createRef<CbzReaderHandle>();
      const { container } = render(
        <ComicDoubleSidedReader
          ref={readerRef}
          totalPages={4}
          loadUrl={mockLoadUrl}
          pageSizes={{ 1: { width: 800, height: 1200 } }}
          onProgressUpdate={vi.fn()}
        />
      );

      const bookStage = container.querySelector('[class*="bookStage"]') as HTMLElement;
      expect(bookStage).toBeInTheDocument();

      // Zoom in to 1.8x anchored at (600, 300)
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

      expect(bookStage.style.getPropertyValue('--comic-reader-zoom')).toBe('1.8');
      expect(bookStage.style.getPropertyValue('--comic-pan-x')).not.toBe('');

      // Zoom out to 1.0x pulls pan back to center (0px, 0px)
      act(() => {
        readerRef.current?.previewZoom(1.0);
      });

      expect(bookStage.style.getPropertyValue('--comic-reader-zoom')).toBe('1');
      expect(bookStage.style.getPropertyValue('--comic-pan-x')).toBe('0px');
      expect(bookStage.style.getPropertyValue('--comic-pan-y')).toBe('0px');
    });

    it('allows drag-to-pan in double-sided comic mode when zoomed in', () => {
      const { container } = render(
        <ComicDoubleSidedReader
          totalPages={4}
          loadUrl={mockLoadUrl}
          pageSizes={{ 1: { width: 800, height: 1200 } }}
          onProgressUpdate={vi.fn()}
          readerZoom={2.0}
        />
      );

      const root = container.firstElementChild as HTMLElement;
      const bookStage = container.querySelector('[class*="bookStage"]') as HTMLElement;

      fireEvent.pointerDown(root, { button: 0, clientX: 200, clientY: 200 });
      fireEvent.pointerMove(root, { buttons: 1, clientX: 160, clientY: 150 });

      expect(bookStage.style.getPropertyValue('--comic-pan-x')).not.toBe('0px');

      fireEvent.pointerUp(root, { button: 0, clientX: 160, clientY: 150 });
    });

    it('applies color inversion to double-sided comic spreads', () => {
      const { container } = render(
        <ComicDoubleSidedReader
          totalPages={4}
          loadUrl={mockLoadUrl}
          pageSizes={{ 1: { width: 800, height: 1200 } }}
          onProgressUpdate={vi.fn()}
          invertColors={true}
        />
      );

      expect(container.firstChild).toHaveClass(/containerInverted/);
      expect(container.querySelector('[class*="pageInverted"]')).toBeInTheDocument();
    });

    it('navigates spreads on keyboard arrow presses in double-sided mode', () => {
      const { container } = render(
        <ComicDoubleSidedReader
          totalPages={8}
          loadUrl={mockLoadUrl}
          pageSizes={{ 1: { width: 800, height: 1200 } }}
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
  });
});
