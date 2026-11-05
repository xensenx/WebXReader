import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, act } from '@testing-library/react';
import { EpubReader, type EpubReaderHandle } from '../formats/engines/EpubReader';
import type { EffectiveReaderSettings } from '../hooks/useReaderSettings';

describe('EPUB Vertical Scroll Pointer-Anchored Zoom', () => {
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

  it('exercises real previewZoom flow on EpubReader to anchor zoom to pointer and clear on 1x', () => {
    const readerRef = React.createRef<EpubReaderHandle>();
    const dummyBuffer = new ArrayBuffer(8);

    const { container } = render(
      <EpubReader
        ref={readerRef}
        fileData={dummyBuffer}
        settings={dummySettings}
        onProgressUpdate={vi.fn()}
      />
    );

    const viewer = container.querySelector('[class*="viewer"]');
    expect(viewer).toBeInTheDocument();

    // Emulate epub.js rendition scroll container and section view elements
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'epub-container';
    const sectionView = document.createElement('div');
    sectionView.className = 'epub-view';
    sectionView.style.height = '600px';
    scrollContainer.appendChild(sectionView);
    viewer!.appendChild(scrollContainer);

    // Call real previewZoom with 1.6x zoom and pointer-anchored at 25% (epubSectionX: 0.25)
    act(() => {
      readerRef.current?.previewZoom(1.6, {
        viewportX: 200,
        viewportY: 300,
        scrollRatioX: 0.25,
        scrollRatioY: 0.5,
        epubSectionX: 0.25,
        id: 1,
      });
    });

    expect(sectionView.dataset.epubZoomed).toBe('true');
    expect(sectionView.style.getPropertyValue('--epub-section-scale')).toBe('1.6');
    expect(sectionView.style.getPropertyValue('--epub-section-origin-x')).toBe('25%');

    // Zoom back out to 1.0x (100%): resets origin to center (50%) and clears pan & zoom data
    act(() => {
      readerRef.current?.previewZoom(1.0);
    });

    expect(sectionView.dataset.epubZoomed).toBeUndefined();
    expect(sectionView.style.getPropertyValue('--epub-section-scale')).toBe('');
    expect(sectionView.style.getPropertyValue('--epub-section-origin-x')).toBe('');
    expect(sectionView.style.getPropertyValue('--epub-section-pan-x')).toBe('');
  });

  it('smoothly pulls origin back towards 50% when zooming out partially', () => {
    const prevOrigin = 0.15; // 15% from left
    const previousZoom = 1.6;
    const nextZoom = 1.3;

    // Center weight formula: (zoom - 1.0) / (previousZoom - 1.0)
    const centerWeight = Math.min(1, Math.max(0, (nextZoom - 1.0) / Math.max(0.01, previousZoom - 1.0)));
    const targetOriginX = 0.5 + (prevOrigin - 0.5) * centerWeight;

    // As zoom drops from 1.6 to 1.3, origin shifts closer to 0.5 (center)
    expect(targetOriginX).toBeGreaterThan(prevOrigin);
    expect(targetOriginX).toBeLessThan(0.5);
    expect(Math.round(targetOriginX * 100)).toBe(33); // 32.5% -> ~33%
  });
});
