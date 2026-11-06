import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { EpubHorizontalReader } from '../formats/engines/EpubHorizontalReader';
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
});
