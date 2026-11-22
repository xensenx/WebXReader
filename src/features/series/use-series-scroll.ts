import { useLayoutEffect } from 'react';

const positions = new Map<string, number>();
const scrollKey = (seriesId?: string) => seriesId === undefined
  ? 'webxreader.series-scroll.overview'
  : `webxreader.series-scroll.detail.${seriesId}`;

export function saveSeriesScroll(seriesId?: string) {
  const key = scrollKey(seriesId);
  const top = Math.max(0, window.scrollY, document.scrollingElement?.scrollTop ?? 0);
  positions.set(key, top);
  try { sessionStorage.setItem(key, String(top)); } catch { /* The in-memory position is still available. */ }
}

function readSeriesScroll(seriesId?: string) {
  const key = scrollKey(seriesId);
  const inMemory = positions.get(key);
  if (inMemory !== undefined) return inMemory;
  try {
    const top = Number(sessionStorage.getItem(key));
    return Number.isFinite(top) && top > 0 ? top : 0;
  } catch { return 0; }
}

export function useSeriesScroll(seriesId: string | undefined, ready: boolean) {
  useLayoutEffect(() => {
    if (!ready) return;
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    // Restore after the volume rows have mounted and established the page height.
    window.scrollTo({ top: readSeriesScroll(seriesId), behavior: 'instant' });
    let frame: number | null = null;
    const track = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        saveSeriesScroll(seriesId);
      });
    };
    window.addEventListener('scroll', track, { passive: true });
    return () => {
      window.removeEventListener('scroll', track);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [seriesId, ready]);
}
