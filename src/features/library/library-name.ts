export const LIBRARY_NAME_LIMIT = 64;

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : null;

export function libraryNameCharacters(value: string): string[] {
  return segmenter ? Array.from(segmenter.segment(value), ({ segment }) => segment) : Array.from(value);
}

export function normalizeLibraryName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const name = value.replace(/[\r\n]+/g, ' ').trim();
  return libraryNameCharacters(name).slice(0, LIBRARY_NAME_LIMIT).join('').trimEnd();
}
