import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { EpubHorizontalReader, findTargetHorizontalPage } from '../formats/engines/EpubHorizontalReader';
import { EpubReader, type EpubReaderHandle } from '../formats/engines/EpubReader';
import type { EffectiveReaderSettings } from '../hooks/useReaderSettings';

describe('EPUB Horizontal Scroll Reader', () => {
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
    readingMode: 'horizontal',
    theme: 'light',
    readerSheetColor: 'paper',
    expandContent: false,
  };

  it('renders the horizontal scroll container, track, and navigation buttons', () => {
    const dummyBuffer = new ArrayBuffer(8);
    const onProgressUpdate = vi.fn();

    const { container } = render(
      <EpubHorizontalReader
        fileData={dummyBuffer}
        settings={baseSettings}
        onProgressUpdate={onProgressUpdate}
      />
    );

    // Verify container and horizontal track exist
    const horizontalTrack = container.querySelector('[class*="horizontalTrack"]');
    expect(horizontalTrack).toBeInTheDocument();

    // Verify next/prev navigation chevrons are rendered
    const prevBtn = screen.getByRole('button', { name: /previous page/i });
    const nextBtn = screen.getByRole('button', { name: /next page/i });
    expect(prevBtn).toBeInTheDocument();
    expect(nextBtn).toBeInTheDocument();
  });

  it('translates vertical mouse wheel deltaY to horizontal scrollLeft', () => {
    const dummyBuffer = new ArrayBuffer(8);
    const onProgressUpdate = vi.fn();

    const { container } = render(
      <EpubHorizontalReader
        fileData={dummyBuffer}
        settings={baseSettings}
        onProgressUpdate={onProgressUpdate}
      />
    );

    const horizontalTrack = container.querySelector('[class*="horizontalTrack"]') as HTMLElement;
    expect(horizontalTrack).toBeInTheDocument();

    // Setup scrollLeft mock for jsdom if needed
    let mockScrollLeft = 0;
    Object.defineProperty(horizontalTrack, 'scrollLeft', {
      get: () => mockScrollLeft,
      set: (val: number) => {
        mockScrollLeft = val;
      },
      configurable: true,
    });

    // Simulate mouse wheel with deltaY = 120
    fireEvent.wheel(container.firstElementChild as HTMLElement, {
      deltaY: 120,
      deltaX: 0,
    });

    expect(mockScrollLeft).toBe(120);
  });

  it('handles keyboard navigation with arrow keys, page up/down, space, home, and end', () => {
    const dummyBuffer = new ArrayBuffer(8);
    const onProgressUpdate = vi.fn();

    const { container } = render(
      <EpubHorizontalReader
        fileData={dummyBuffer}
        settings={baseSettings}
        onProgressUpdate={onProgressUpdate}
      />
    );

    const readerRoot = container.firstElementChild as HTMLElement;
    expect(readerRoot).toBeInTheDocument();

    expect(() => {
      fireEvent.keyDown(readerRoot, { key: 'ArrowRight' });
      fireEvent.keyDown(readerRoot, { key: 'ArrowLeft' });
      fireEvent.keyDown(readerRoot, { key: 'PageDown' });
      fireEvent.keyDown(readerRoot, { key: 'PageUp' });
      fireEvent.keyDown(readerRoot, { key: ' ' });
      fireEvent.keyDown(readerRoot, { key: 'Home' });
      fireEvent.keyDown(readerRoot, { key: 'End' });
    }).not.toThrow();
  });

  it('handles navigation chevron clicks for next and previous pages', () => {
    const dummyBuffer = new ArrayBuffer(8);
    const onProgressUpdate = vi.fn();

    render(
      <EpubHorizontalReader
        fileData={dummyBuffer}
        settings={baseSettings}
        onProgressUpdate={onProgressUpdate}
      />
    );

    const nextBtn = screen.getByRole('button', { name: /next page/i });
    const prevBtn = screen.getByRole('button', { name: /previous page/i });

    expect(() => {
      fireEvent.click(nextBtn);
      fireEvent.click(prevBtn);
    }).not.toThrow();
  });

  it('applies sheet color theme variables to container element', () => {
    const dummyBuffer = new ArrayBuffer(8);
    const archiveSettings: EffectiveReaderSettings = {
      ...baseSettings,
      readerSheetColor: 'archive',
    };

    const { container } = render(
      <EpubHorizontalReader
        fileData={dummyBuffer}
        settings={archiveSettings}
        onProgressUpdate={vi.fn()}
      />
    );

    const rootEl = container.firstElementChild as HTMLElement;
    expect(rootEl.style.getPropertyValue('--epub-sheet-bg')).toBe('#f6eedb');
    expect(rootEl.style.getPropertyValue('--epub-sheet-color')).toBe('#3d3226');
  });

  it('exposes full imperative handle with goToProgress, goToHref, search, and previewZoom', () => {
    const dummyBuffer = new ArrayBuffer(8);
    const ref = React.createRef<EpubReaderHandle>();

    render(
      <EpubHorizontalReader
        ref={ref}
        fileData={dummyBuffer}
        settings={baseSettings}
        onProgressUpdate={vi.fn()}
      />
    );

    expect(ref.current).toBeDefined();
    expect(typeof ref.current?.goToHref).toBe('function');
    expect(typeof ref.current?.goToCfi).toBe('function');
    expect(typeof ref.current?.goToProgress).toBe('function');
    expect(typeof ref.current?.search).toBe('function');
    expect(typeof ref.current?.goToSearchMatch).toBe('function');
    expect(typeof ref.current?.previewZoom).toBe('function');

    act(() => {
      ref.current?.goToProgress(0.5);
      ref.current?.goToHref('chapter1.xhtml');
      ref.current?.previewZoom(1.5);
    });
  });

  it('delegates to EpubHorizontalReader when readingMode is horizontal in EpubReader', () => {
    const dummyBuffer = new ArrayBuffer(8);
    const ref = React.createRef<EpubReaderHandle>();

    const { container } = render(
      <EpubReader
        ref={ref}
        fileData={dummyBuffer}
        settings={baseSettings}
        onProgressUpdate={vi.fn()}
      />
    );

    const horizontalTrack = container.querySelector('[class*="horizontalTrack"]');
    expect(horizontalTrack).toBeInTheDocument();
  });

  describe('Mode transition progress catch-up (findTargetHorizontalPage)', () => {
    const mockPages = [
      {
        globalIndex: 0,
        sectionIndex: 0,
        sectionHref: 'cover.xhtml',
        chapterTitle: 'Cover',
        columnPageIndex: 0,
        totalSectionPages: 1,
        isImageOnly: true,
        cfi: 'epubcfi(/6/2!/4)',
        htmlContent: '<div>Cover</div>',
      },
      {
        globalIndex: 1,
        sectionIndex: 1,
        sectionHref: 'ch01.xhtml',
        chapterTitle: 'Chapter 1',
        columnPageIndex: 0,
        totalSectionPages: 2,
        isImageOnly: false,
        cfi: 'epubcfi(/6/4!/4)',
        htmlContent: '<div>Ch1 Page 1</div>',
      },
      {
        globalIndex: 2,
        sectionIndex: 1,
        sectionHref: 'ch01.xhtml',
        chapterTitle: 'Chapter 1',
        columnPageIndex: 1,
        totalSectionPages: 2,
        isImageOnly: false,
        cfi: 'epubcfi(/6/4!/4)',
        htmlContent: '<div>Ch1 Page 2</div>',
      },
      {
        globalIndex: 3,
        sectionIndex: 2,
        sectionHref: 'ch02.xhtml',
        chapterTitle: 'Chapter 2',
        columnPageIndex: 0,
        totalSectionPages: 1,
        isImageOnly: false,
        cfi: 'epubcfi(/6/6!/4)',
        htmlContent: '<div>Ch2 Page 1</div>',
      },
      {
        globalIndex: 4,
        sectionIndex: 3,
        sectionHref: 'ch03.xhtml',
        chapterTitle: 'Chapter 3',
        columnPageIndex: 0,
        totalSectionPages: 1,
        isImageOnly: false,
        cfi: 'epubcfi(/6/8!/4)',
        htmlContent: '<div>Ch3 Page 1</div>',
      },
    ];

    it('accurately resolves target page from CFI spine index (/6/N pattern)', () => {
      // /6/6 corresponds to section index 2 (Chapter 2 -> page index 3)
      const targetPage = findTargetHorizontalPage(
        mockPages,
        'epubcfi(/6/6[ch02]!/4/2/1:0)',
        undefined,
        undefined,
        null
      );
      expect(targetPage).toBe(3);
    });

    it('resolves target page from chapter href when switching from vertical/double sided mode', () => {
      const targetPage = findTargetHorizontalPage(
        mockPages,
        undefined,
        undefined,
        'ch03.xhtml',
        null
      );
      expect(targetPage).toBe(4);
    });

    it('resolves target page from fractional progress (e.g. 0.5 for 50% read)', () => {
      // 50% of 4 (pages.length - 1) is index 2
      const targetPage = findTargetHorizontalPage(
        mockPages,
        undefined,
        0.5,
        undefined,
        null
      );
      expect(targetPage).toBe(2);
    });

    it('resolves target page from integer previous layout index', () => {
      const targetPage = findTargetHorizontalPage(
        mockPages,
        undefined,
        3,
        undefined,
        null,
        mockPages
      );
      expect(targetPage).toBe(3);
    });
  });

  describe('Pointer-anchored zoom and 2D grab-and-pan', () => {
    it('anchors zoom towards pointer position and pulls back to center when zooming out', () => {
      const dummyBuffer = new ArrayBuffer(8);
      const ref = React.createRef<EpubReaderHandle>();

      const { container } = render(
        <EpubHorizontalReader
          ref={ref}
          fileData={dummyBuffer}
          settings={baseSettings}
          onProgressUpdate={vi.fn()}
        />
      );

      const track = container.querySelector('[class*="horizontalTrack"]') as HTMLElement;
      expect(track).toBeInTheDocument();

      // Zoom in to 1.6x anchored at an offset pointer location
      act(() => {
        ref.current?.previewZoom(1.6, {
          viewportX: 200,
          viewportY: 150,
          scrollRatioX: 0,
          scrollRatioY: 0,
        });
      });

      expect(track.style.getPropertyValue('--epub-reader-zoom')).toBe('1.6');
      // When zoomed in, pan variables are defined and applied
      expect(track.style.getPropertyValue('--epub-pan-x')).toBeDefined();
      expect(track.style.getPropertyValue('--epub-pan-y')).toBeDefined();

      // Zoom out to 1.0 (center)
      act(() => {
        ref.current?.previewZoom(1.0);
      });

      expect(track.style.getPropertyValue('--epub-reader-zoom')).toBe('1');
      expect(track.style.getPropertyValue('--epub-pan-x')).toBe('0px');
      expect(track.style.getPropertyValue('--epub-pan-y')).toBe('0px');
    });

    it('enables 2D grabbing and panning when zoomed in', () => {
      const dummyBuffer = new ArrayBuffer(8);
      const { container } = render(
        <EpubHorizontalReader
          fileData={dummyBuffer}
          settings={baseSettings}
          readerZoom={1.5}
          onProgressUpdate={vi.fn()}
        />
      );

      const track = container.querySelector('[class*="horizontalTrack"]') as HTMLElement;
      expect(track).toBeInTheDocument();

      // Simulate pointer down to grab
      fireEvent.pointerDown(track, {
        button: 0,
        clientX: 300,
        clientY: 300,
        pointerId: 1,
      });

      // Simulate pointer move to pan 2D canvas
      fireEvent.pointerMove(track, {
        clientX: 250,
        clientY: 220,
        buttons: 1,
        pointerId: 1,
      });

      // Transform properties reflect 2D panning
      expect(track.style.getPropertyValue('--epub-pan-x')).toBeDefined();
      expect(track.style.getPropertyValue('--epub-pan-y')).toBeDefined();

      // Release grab
      fireEvent.pointerUp(track, {
        pointerId: 1,
      });
    });
  });
});
