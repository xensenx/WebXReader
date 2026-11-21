export function getPageRasterScale(
  width: number,
  height: number,
  preferredScale: number,
  maxDimension: number,
  maxPixels: number,
) {
  return Math.min(
    preferredScale,
    maxDimension / Math.max(1, width, height),
    Math.sqrt(maxPixels / Math.max(1, width * height)),
  );
}
