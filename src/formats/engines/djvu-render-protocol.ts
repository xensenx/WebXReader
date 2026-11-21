import { getPageRasterScale } from './page-raster-budget';

export interface DjvuPageSize {
  width: number;
  height: number;
}

export const DEFAULT_DJVU_PAGE_SIZE: DjvuPageSize = { width: 800, height: 1100 };

export interface DjvuRaster extends DjvuPageSize {
  pixels: ArrayBuffer;
}

export type DjvuRequest =
  | { kind: 'open'; fileData: ArrayBuffer }
  | { kind: 'sizes' }
  | { kind: 'size'; page: number }
  | { kind: 'render'; page: number; dpi: number }
  | { kind: 'search'; query: string }
  | { kind: 'cancelSearch' };

export type DjvuMessage = DjvuRequest & { id: number };

export type DjvuResponse = { id: number } & (
  | { value: unknown }
  | { error: string }
);

// Limit both dimensions and pixel count. A pixel count alone still permits a
// long, narrow scan to exceed browser canvas limits.
export function getDjvuRasterDpi(size: DjvuPageSize, displayScale: number, pixelRatio: number): number {
  const scale = getPageRasterScale(
    size.width, size.height, Math.min(3.125, displayScale * Math.min(pixelRatio, 2)), 3200, 3_000_000,
  );
  return Math.max(1, Math.floor(96 * scale));
}
