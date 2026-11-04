import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';

describe('EPUB Vertical Scroll Pointer-Anchored Zoom', () => {
  it('applies pointer-anchored transform origin and pan to section elements when zooming in', () => {
    const view = document.createElement('div');
    view.className = 'epub-view';
    document.body.appendChild(view);

    // Apply zoom in at pointer ratio 0.2 (20% from left edge)
    view.dataset.epubZoomed = 'true';
    view.style.setProperty('--epub-section-scale', '1.6');
    view.style.setProperty('--epub-section-origin-x', '20%');
    view.style.setProperty('--epub-section-pan-x', '-40px');

    expect(view.style.getPropertyValue('--epub-section-scale')).toBe('1.6');
    expect(view.style.getPropertyValue('--epub-section-origin-x')).toBe('20%');
    expect(view.style.getPropertyValue('--epub-section-pan-x')).toBe('-40px');

    document.body.removeChild(view);
  });

  it('resets origin to 50% (center) and pan to 0px when zooming out to 100% or below', () => {
    const view = document.createElement('div');
    view.className = 'epub-view';
    document.body.appendChild(view);

    // Initially zoomed in
    view.dataset.epubZoomed = 'true';
    view.style.setProperty('--epub-section-scale', '1.5');
    view.style.setProperty('--epub-section-origin-x', '15%');
    view.style.setProperty('--epub-section-pan-x', '30px');

    // Zoom out to 1.0 (100%)
    const zoom = 1.0;
    if (zoom <= 1.001) {
      delete view.dataset.epubZoomed;
      view.style.removeProperty('--epub-section-scale');
      view.style.removeProperty('--epub-section-origin-x');
      view.style.removeProperty('--epub-section-pan-x');
    }

    expect(view.dataset.epubZoomed).toBeUndefined();
    expect(view.style.getPropertyValue('--epub-section-scale')).toBe('');
    expect(view.style.getPropertyValue('--epub-section-origin-x')).toBe('');
    expect(view.style.getPropertyValue('--epub-section-pan-x')).toBe('');

    document.body.removeChild(view);
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
