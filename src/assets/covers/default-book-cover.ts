import type { Book, BookFormat } from '../../types/book';

const coverFilenames = {
  azw3: 'azw3', cb7: 'cb7', cbr: 'cbr', cbz: 'cbz', djvu: 'djvu',
  doc: 'doc', docx: 'docx', epub: 'epub', fb2: 'fb2', html: 'html',
  jpeg: 'jpeg', markdown: 'md', mht: 'mht', mobi: 'mobi', pdf: 'pdf',
  png: 'png', rar: 'rar', rtf: 'rtf', txt: 'txt', zip: 'zip',
} satisfies Record<BookFormat, string>;

const legacySvgPrefix = 'data:image/svg+xml;utf8,';
// Previous app versions persisted four built-in covers as encoded SVG.
// Fingerprint their normalized markup without shipping the old assets.
const legacyCoverFingerprints = new Map([
  [4814, 0x65bd424c],
  [4815, 0x6eef5432],
  [5445, 0x4bf92ebf],
  [5449, 0xf88a3b24],
  [5452, 0x0abfe2b8],
]);

function isLegacyCover(cover: string): boolean {
  if (!cover.startsWith(legacySvgPrefix) || cover.length > 22000) return false;
  try {
    const svg = decodeURIComponent(cover.slice(legacySvgPrefix.length)).replace(/\r\n/g, '\n');
    const fingerprint = legacyCoverFingerprints.get(svg.length);
    if (fingerprint === undefined) return false;
    let hash = 2166136261;
    for (let index = 0; index < svg.length; index++) {
      hash = Math.imul(hash ^ svg.charCodeAt(index), 16777619);
    }
    return (hash >>> 0) === fingerprint;
  } catch {
    return false;
  }
}

export function getStoredBookCover(cover?: string | null): string | undefined {
  return cover && !isLegacyCover(cover) ? cover : undefined;
}

export function getDefaultBookCover(format: BookFormat): string | undefined {
  const filename = coverFilenames[format];
  return typeof filename === 'string' ? `${import.meta.env.BASE_URL}covers/${filename}-default-cover.svg` : undefined;
}

export type BookCover = Pick<Book, 'coverImage' | 'originalCoverImage' | 'sourceFormat'>;

export function getBookCoverSources(book: BookCover): string[] {
  const preferred = getStoredBookCover(book.coverImage);
  const original = preferred ? getStoredBookCover(book.originalCoverImage) : undefined;
  const fallback = getDefaultBookCover(book.sourceFormat);
  return [...new Set([preferred, original, fallback].filter((source): source is string => Boolean(source)))];
}
