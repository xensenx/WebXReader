import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useReaderZoom,
  clampReaderZoom,
  getWheelDeltaPixels,
  getTouchZoomGesture,
  MIN_READER_ZOOM,
  MAX_READER_ZOOM,
  MIN_PDF_ZOOM,
  MAX_PDF_ZOOM,
} from '../components/reader/hooks/useReaderZoom';

describe('useReaderZoom Hook and Math Helpers', () => {
  it('clamps zoom within bounds for reflowable formats', () => {
    expect(clampReaderZoom(0.1, false)).toBe(MIN_READER_ZOOM);
    expect(clampReaderZoom(5.0, false)).toBe(MAX_READER_ZOOM);
    expect(clampReaderZoom(1.456, false)).toBe(1.46);
  });

  it('clamps zoom continuously within bounds for fixed-layout formats', () => {
    expect(clampReaderZoom(0.1, true)).toBe(MIN_PDF_ZOOM);
    expect(clampReaderZoom(10.0, true)).toBe(MAX_PDF_ZOOM);
    expect(clampReaderZoom(1.45678, true)).toBe(1.45678);
  });

  it('calculates wheel delta in pixels for line, page, and pixel modes', () => {
    const pixelEvent = { deltaMode: WheelEvent.DOM_DELTA_PIXEL, deltaY: 50 } as WheelEvent;
    expect(getWheelDeltaPixels(pixelEvent)).toBe(50);

    const lineEvent = { deltaMode: WheelEvent.DOM_DELTA_LINE, deltaY: 3 } as WheelEvent;
    expect(getWheelDeltaPixels(lineEvent)).toBe(48);

    const viewport = { clientHeight: 800 } as HTMLElement;
    const pageEvent = { deltaMode: WheelEvent.DOM_DELTA_PAGE, deltaY: 2 } as WheelEvent;
    expect(getWheelDeltaPixels(pageEvent, viewport)).toBe(1600);
  });

  it('calculates touch gesture pinch distance and center point', () => {
    const touchList = [
      { clientX: 100, clientY: 100 },
      { clientX: 100, clientY: 200 },
    ] as unknown as TouchList;

    const gesture = getTouchZoomGesture(touchList);
    expect(gesture).not.toBeNull();
    expect(gesture?.distance).toBe(100);
    expect(gesture?.point).toEqual({ x: 100, y: 150 });
  });

  it('manages reader zoom state, zoomBy, zoomTo, and resetZoom', () => {
    const stageElement = document.createElement('div');
    const stageRef = { current: stageElement };

    const { result } = renderHook(() =>
      useReaderZoom({
        sourceFormat: 'epub',
        readerStageRef: stageRef,
      })
    );

    expect(result.current.readerZoom).toBe(1);

    // Zoom in
    act(() => {
      result.current.zoomBy(1.2);
    });
    expect(result.current.readerZoom).toBeCloseTo(1.2, 2);

    // Zoom to specific target
    act(() => {
      result.current.zoomTo(2.0);
    });
    expect(result.current.readerZoom).toBe(2);

    // Reset zoom
    act(() => {
      result.current.resetZoom();
    });
    expect(result.current.readerZoom).toBe(1);
    expect(result.current.readerZoomRef.current).toBe(1);
  });
});
