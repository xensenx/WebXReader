import type { BookSeries, ReadingStatus } from '../../types/book';

export interface SeriesBookProgress {
  readingStatus: ReadingStatus;
  readingProgress: number;
}

export const SERIES_TITLE_LIMIT = 120;
export const SERIES_DESCRIPTION_LIMIT = 4000;
export const SERIES_TAGS_LIMIT = 300;
export const BOOK_COMPLETION_THRESHOLD = 0.98;

export function getSeriesPath(seriesId: string): string {
  return `/series/${encodeURIComponent(seriesId)}`;
}

function getSeriesMetadata(input: Partial<BookSeries>) {
  const metadata: Pick<BookSeries, 'author' | 'description' | 'tags' | 'coverImage'> = {};
  const author = typeof input.author === 'string' ? input.author.trim().slice(0, SERIES_TITLE_LIMIT) : '';
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, SERIES_DESCRIPTION_LIMIT) : '';
  if (author) metadata.author = author;
  if (description) metadata.description = description;
  if (Array.isArray(input.tags)) {
    const text = input.tags.filter((tag) => typeof tag === 'string').join(',').slice(0, SERIES_TAGS_LIMIT);
    const tags = [...new Set(text.split(',').map((tag) => tag.trim()).filter(Boolean))];
    if (tags.length) metadata.tags = tags;
  }
  if (typeof input.coverImage === 'string' && input.coverImage.length <= 8 * 1024 * 1024 &&
      /^data:image\/(?:webp|png|jpeg);base64,[a-z0-9+/]/i.test(input.coverImage)) {
    metadata.coverImage = input.coverImage;
  }
  return metadata;
}

/** Validate and sort entries before storage, including backup imports. */
export function normalizeSeries(value: unknown): BookSeries {
  if (!value || typeof value !== 'object') throw new Error('Invalid series.');
  const { id, title, bookIds, volumeNumbers, volumeOrder, createdAt } = value as Partial<BookSeries>;
  if (typeof id !== 'string' || !id || typeof title !== 'string' || !title.trim() || title.trim().length > SERIES_TITLE_LIMIT) {
    throw new Error('Enter a series name up to 120 characters.');
  }
  if (!Array.isArray(bookIds) || bookIds.some((bookId) => typeof bookId !== 'string' || !bookId) ||
      new Set(bookIds).size !== bookIds.length) {
    throw new Error('Each book can only appear once in a series.');
  }
  const series = { id, title: title.trim(), ...getSeriesMetadata(value as Partial<BookSeries>),
    ...(typeof createdAt === 'number' && Number.isFinite(createdAt) && createdAt >= 0 ? { createdAt } : {}) };
  if (volumeNumbers === undefined) return { ...series, bookIds: [...bookIds] };
  if (!volumeNumbers || typeof volumeNumbers !== 'object') throw new Error('Enter valid volume numbers.');

  const idsWithLabels = volumeOrder === 'custom' ? bookIds.filter((bookId) => Object.hasOwn(volumeNumbers, bookId)) : bookIds;
  const numbered = idsWithLabels.map((bookId) => ({
    bookId,
    number: Object.hasOwn(volumeNumbers, bookId) ? volumeNumbers[bookId] : NaN,
  }));
  if (numbered.some((volume) => !Number.isFinite(volume.number) || volume.number < 0)) {
    throw new Error('Enter a non-negative number for every volume.');
  }
  if (new Set(numbered.map((volume) => volume.number)).size !== numbered.length) {
    throw new Error('Use a different number for each volume.');
  }
  if (volumeOrder === 'custom') {
    return { ...series, bookIds: [...bookIds], ...(numbered.length && {
      volumeOrder, volumeNumbers: Object.fromEntries(numbered.map(({ bookId, number }) => [bookId, number])),
    }) };
  }
  numbered.sort((left, right) => left.number - right.number);
  return {
    ...series, bookIds: numbered.map((volume) => volume.bookId),
    volumeNumbers: Object.fromEntries(numbered.map(({ bookId, number }) => [bookId, number])),
  };
}

/** Append each new book once, in the order supplied by the library. */
export function appendSeriesBooks(series: BookSeries, bookIds: readonly string[]): BookSeries {
  const currentIds = new Set(series.bookIds);
  const additions = [...new Set(bookIds)].filter((id) => !currentIds.has(id));
  const nextIds = [...series.bookIds, ...additions];
  if (!series.volumeNumbers || series.volumeOrder === 'custom') return { ...series, bookIds: nextIds };

  const volumeNumbers = new Map(Object.entries(series.volumeNumbers));
  const lastId = series.bookIds.at(-1);
  let number = lastId ? volumeNumbers.get(lastId)! : 0;
  for (const id of additions) {
    // Preserve a distinct next number even when the existing number exceeds safe integer precision.
    number += Math.max(1, number * Number.EPSILON);
    if (!Number.isFinite(number)) throw new Error('The next volume number is too large. Edit the series numbers and try again.');
    volumeNumbers.set(id, number);
  }
  return { ...series, bookIds: nextIds, volumeNumbers: Object.fromEntries(volumeNumbers) };
}

export function reorderSeriesVolumes(series: BookSeries, bookIds: readonly string[]): BookSeries {
  const nextIds = new Set(bookIds);
  if (nextIds.size !== bookIds.length || bookIds.length !== series.bookIds.length ||
      series.bookIds.some((id) => !nextIds.has(id))) {
    throw new Error('The volumes in this series have changed. Reopen the series and try again.');
  }
  return { ...series, bookIds: [...bookIds], ...(series.volumeNumbers && { volumeOrder: 'custom' }) };
}

export function getVolumeProgress(book: SeriesBookProgress): number {
  if (book.readingStatus === 'completed') return 1;
  return Number.isFinite(book.readingProgress) ? Math.max(0, Math.min(1, book.readingProgress)) : 0;
}

export function summarizeSeries(books: readonly SeriesBookProgress[]) {
  let progress = 0;
  let completed = 0;
  for (const book of books) {
    const fraction = getVolumeProgress(book);
    progress += fraction;
    if (fraction === 1) completed++;
  }
  return { fraction: books.length ? progress / books.length : 0, completed, total: books.length };
}
