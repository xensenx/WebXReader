import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { PaginatedReader } from '../components/reader/PaginatedReader';
import { ScrollReader } from '../components/reader/ScrollReader';
import type { EffectiveReaderSettings } from '../hooks/useReaderSettings';
import type { Chapter } from '../types/book';

describe('ScrollReader Canvas Zoom & Layout Modes', () => {
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
    theme: 'dark',
    readerSheetColor: 'paper',
    expandContent: false,
  };

  const dummyChapters: Chapter[] = [
    {
      id: 'ch-1',
      title: 'Chapter 1: The Beginning',
      content: '<p>This is plain text content for testing canvas scaling.</p>',
      level: 0,
      order: 0,
    },
  ];

  it('scales canvas width proportionally when zoomed out below 100% in Contracted Mode', () => {
    const { container } = render(
      <ScrollReader
        chapters={dummyChapters}
        settings={dummySettings}
        onProgressUpdate={vi.fn()}
        zoom={0.8}
      />
    );

    const sheet = container.querySelector('[class*="boundedSheet"]') as HTMLElement;
    expect(sheet).toBeInTheDocument();
    // 720 * 0.8 = 576px
    expect(sheet.style.width).toBe('576px');
    expect(sheet.style.fontSize).toBe('14.4px');
  });

  it('scales canvas width proportionally when zoomed in above 100% in Contracted Mode', () => {
    const { container } = render(
      <ScrollReader
        chapters={dummyChapters}
        settings={dummySettings}
        onProgressUpdate={vi.fn()}
        zoom={1.5}
      />
    );

    const sheet = container.querySelector('[class*="boundedSheet"]') as HTMLElement;
    expect(sheet).toBeInTheDocument();
    // 720 * 1.5 = 1080px
    expect(sheet.style.width).toBe('1080px');
    expect(sheet.style.minWidth).toBe('1080px');
    expect(sheet.style.fontSize).toBe('27px');
  });

  it('keeps the mounted MHT image when zoom changes', () => {
    const chapters = [{ ...dummyChapters[0], content: '<img src="data:image/png;base64,AAAA" alt="Archive image">' }];
    const onProgressUpdate = vi.fn();
    const { getByAltText, rerender } = render(
      <ScrollReader format="mht" chapters={chapters} settings={dummySettings} onProgressUpdate={onProgressUpdate} />
    );
    const image = getByAltText('Archive image');
    rerender(<ScrollReader format="mht" chapters={chapters} settings={dummySettings} onProgressUpdate={onProgressUpdate} zoom={0.6} />);
    expect(getByAltText('Archive image')).toBe(image);
  });

  it('uses full width 100% when in Expanded Mode regardless of zoom', () => {
    const { container } = render(
      <ScrollReader
        chapters={dummyChapters}
        settings={{ ...dummySettings, expandContent: true }}
        onProgressUpdate={vi.fn()}
        zoom={0.8}
      />
    );

    const expanded = container.querySelector('[class*="expandedContent"]') as HTMLElement;
    expect(expanded).toBeInTheDocument();
    expect(expanded.style.width).toBe('100%');
    expect(expanded.style.maxWidth).toBe('100%');
    expect(expanded.style.fontSize).toBe('14.4px');
  });
});

it('retains the saved paginated position through MHT image remeasurements', () => {
  const width = 400;
  let trackWidth = width;
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => trackWidth);
  try {
    const onProgressUpdate = vi.fn();
    const { container, getByAltText } = render(
      <PaginatedReader format="mht"
        chapters={[{ id: 'saved', title: 'Saved', order: 0, level: 0,
          content: '<img src="data:image/png;base64,AAAA" alt="Loaded"><img src="data:image/png;base64,BBBB" alt="Failed">' }]}
        settings={{ fontFamily: 'serif', fontSize: 18, lineHeight: 1.7, paragraphSpacing: 1,
          letterSpacing: 0, wordSpacing: 0, textAlign: 'left', textIndent: 0, maxContentWidth: 720,
          contentMargin: 0, readingMode: 'scroll', theme: 'dark', readerSheetColor: 'paper', expandContent: false }}
        initialPageIndex={2} initialProgressFraction={0.5} onProgressUpdate={onProgressUpdate}
      />,
    );
    expect(onProgressUpdate).not.toHaveBeenCalled();
    fireEvent.error(getByAltText('Failed'));
    act(() => vi.advanceTimersToNextFrame());
    expect(onProgressUpdate).not.toHaveBeenCalled();

    trackWidth = 5 * width;
    fireEvent.load(getByAltText('Loaded'));
    act(() => vi.advanceTimersToNextFrame());
    expect(container.querySelector('[data-reader-viewport]')?.scrollLeft).toBe(2 * width);
    expect(onProgressUpdate.mock.calls).toEqual([['saved', 0.5, 2]]);
  } finally {
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});
