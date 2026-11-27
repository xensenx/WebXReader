import type { Book, BookSeries } from '../../types/book';

type VolumeBook = Pick<Book, 'id' | 'title' | 'originalFilename' | 'identifiers'>;

const labeledNumber = /(?:^|[^\p{L}\p{N}])(?:(?:vol(?:ume)?|book|tome|issue|v)[.\s_:#-]*|#\s*)(\d+(?:[.,]\d+)?)(?![\p{L}\p{N}]|[.,]\d)/iu;
const trailingNumber = /(?:^|[\s._-])(\d+(?:\.\d+)?)\s*$/u;
const leadingNumber = /^\s*(\d+(?:\.\d+)?)[\s_-]+\p{L}/u;

export function volumeFilenameStem(filename?: string): string {
  return typeof filename === 'string' ? filename.replace(/\.[a-z][a-z\d]*$/i, '') : '';
}

/** Return a candidate series title when this text contains a volume designation. */
export function stripVolumeNumber(text: string): { name: string; labeled: boolean } | undefined {
  const label = labeledNumber.exec(text);
  if (label) {
    const before = text.slice(0, label.index).replace(/[\s._:–—([-]+$/u, '');
    const after = text.slice(label.index + label[0].length).replace(/^[\s._:–—)\]-]+/u, '');
    return { name: before || after, labeled: true };
  }
  const suffix = trailingNumber.exec(text);
  if (suffix) return { name: text.slice(0, suffix.index).replace(/[\s._:–—-]+$/u, ''), labeled: false };
  const prefix = leadingNumber.exec(text);
  if (prefix) return { name: text.trim().slice(prefix[1].length).replace(/^[\s_-]+/u, ''), labeled: false };
  return undefined;
}

function readNumber(value?: string): number | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:[.,]\d+)?$/.test(text)) return undefined;
  const number = Number(text.replace(',', '.'));
  return Number.isFinite(number) ? number : undefined;
}

export function getBookVolumeNumber(book: VolumeBook, series?: BookSeries): number | undefined {
  const filename = volumeFilenameStem(book.originalFilename);
  const title = book.title;
  const labels = series?.volumeNumbers;
  return readNumber(book.identifiers?.volume)
    ?? readNumber(labeledNumber.exec(filename)?.[1])
    ?? readNumber(labeledNumber.exec(title)?.[1])
    ?? (labels && Object.hasOwn(labels, book.id) ? labels[book.id] : undefined)
    ?? readNumber(trailingNumber.exec(filename)?.[1])
    ?? readNumber(trailingNumber.exec(title)?.[1])
    ?? readNumber(leadingNumber.exec(filename)?.[1])
    ?? readNumber(leadingNumber.exec(title)?.[1]);
}

/** Put unnumbered volumes last and retain the current order of ties. */
export function sortVolumesByNumber(books: readonly VolumeBook[], series: BookSeries): string[] | null {
  const volumes = books.map((book) => ({ id: book.id, number: getBookVolumeNumber(book, series) }));
  if (!volumes.some(({ number }) => number !== undefined)) return null;
  return volumes.sort((left, right) => {
    if (left.number === undefined) return right.number === undefined ? 0 : 1;
    if (right.number === undefined) return -1;
    return left.number - right.number;
  }).map(({ id }) => id);
}

export function getVolumeLabel(series: BookSeries, book: VolumeBook, index: number): string {
  return `Volume ${getBookVolumeNumber(book, series) ?? index + 1}`;
}
