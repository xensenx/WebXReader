import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
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
    theme: 'light',
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
