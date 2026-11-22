import { getAllFormats } from '../../formats/registry';
import type { Book, BookFormat, ReadingStatus } from '../../types/book';

export const READING_STATUSES = [
  { value: 'unread', label: 'Unread' },
  { value: 'reading', label: 'Reading' },
  { value: 'completed', label: 'Completed' },
] satisfies { value: ReadingStatus; label: string }[];

export const FORMAT_OPTIONS = getAllFormats()
  .map(({ id, extensions, label }) => ({ value: id, label: extensions[0].toUpperCase(), title: label }))
  .sort((a, b) => a.label.localeCompare(b.label));

export const METADATA_FIELDS = [
  { key: 'author', label: 'Author', all: 'All authors' },
  { key: 'language', label: 'Language', all: 'All languages' },
  { key: 'publisher', label: 'Publisher', all: 'All publishers' },
] as const;

export type MetadataFilter = typeof METADATA_FIELDS[number]['key'];

export interface LibraryFilters extends Record<MetadataFilter, string> {
  archive: 'active' | 'archived' | 'all';
  statuses: ReadingStatus[];
  favorite: boolean;
  formats: BookFormat[];
  tags: string[];
  initial: string;
  rating: string;
}

export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = {
  archive: 'active',
  statuses: [],
  favorite: false,
  formats: [],
  tags: [],
  initial: '',
  author: '',
  language: '',
  publisher: '',
  rating: '',
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item)))] : [];
}

export function restoreLibraryFilters(value: unknown, legacy: unknown): LibraryFilters {
  if (!value || typeof value !== 'object') {
    return {
      ...DEFAULT_LIBRARY_FILTERS,
      archive: legacy === 'archived' ? 'archived' : 'active',
      favorite: legacy === 'favorites',
      statuses: READING_STATUSES.filter(({ value }) => value === legacy).map(({ value }) => value),
    };
  }

  const saved = value as Record<string, unknown>;
  const formats = new Set(strings(saved.formats));
  const statuses = new Set(strings(saved.statuses));
  return {
    archive: saved.archive === 'archived' || saved.archive === 'all' ? saved.archive : 'active',
    favorite: saved.favorite === true,
    formats: FORMAT_OPTIONS.filter(({ value }) => formats.has(value)).map(({ value }) => value),
    statuses: READING_STATUSES.filter(({ value }) => statuses.has(value)).map(({ value }) => value),
    tags: strings(saved.tags),
    initial: typeof saved.initial === 'string' ? saved.initial : '',
    author: typeof saved.author === 'string' ? saved.author : '',
    language: typeof saved.language === 'string' ? saved.language : '',
    publisher: typeof saved.publisher === 'string' ? saved.publisher : '',
    rating: typeof saved.rating === 'string' && /^(?:unrated|[1-5])$/.test(saved.rating) ? saved.rating : '',
  };
}

export function countLibraryFilters(filters: LibraryFilters): number {
  return [filters.archive !== 'active', filters.favorite, filters.statuses.length, filters.formats.length,
    filters.tags.length, filters.initial, filters.rating, filters.author, filters.language, filters.publisher]
    .filter(Boolean).length;
}

const normalize = (value?: string) => value?.trim().normalize('NFC').toLowerCase() ?? '';

export function getTitleInitial(title: string): string {
  const letter = /^\p{L}/u.exec(title.trim().normalize('NFD'))?.[0];
  return letter?.toUpperCase() ?? '#';
}

export function getTitleInitialOptions(titles: readonly string[], selected = ''): string[] {
  return [...new Set([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...titles.map(getTitleInitial), selected, '#'])]
    .filter(Boolean)
    .sort((a, b) => a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b));
}

export function getLibraryFilterOptions(books: readonly Book[], filters: LibraryFilters) {
  function options(values: Iterable<string>, selected: readonly string[]) {
    const labels = new Map(selected.filter(Boolean).map((value) => [value, value]));
    for (const label of values) {
      const value = normalize(label);
      if (value) labels.set(value, label.trim());
    }
    return [...labels].map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
  return {
    tags: options(books.flatMap((book) => book.userTags ?? []), filters.tags),
    author: options(books.map((book) => book.author), [filters.author]),
    language: options(books.map((book) => book.language), [filters.language]),
    publisher: options(books.map((book) => book.publisher), [filters.publisher]),
    initials: getTitleInitialOptions(books.map((book) => book.title), filters.initial),
  };
}

export function filterLibraryBooks<T extends Book>(books: readonly T[], filters: LibraryFilters, query: string): T[] {
  const search = normalize(query);
  const statuses = new Set(filters.statuses);
  const formats = new Set(filters.formats);
  const tags = new Set(filters.tags);
  const metadata = METADATA_FIELDS.filter(({ key }) => filters[key]);

  return books.filter((book) => {
    if (filters.archive !== 'all' && Boolean(book.archived) !== (filters.archive === 'archived')) return false;
    if (statuses.size && !statuses.has(book.readingStatus)) return false;
    if (formats.size && !formats.has(book.sourceFormat)) return false;
    if (filters.favorite && !book.favorite) return false;
    if (filters.initial && getTitleInitial(book.title) !== filters.initial) return false;
    if (filters.rating === 'unrated' && (book.userRating ?? 0) > 0) return false;
    if (filters.rating && filters.rating !== 'unrated' && book.userRating !== Number(filters.rating)) return false;
    if (metadata.some(({ key }) => normalize(book[key]) !== filters[key])) return false;

    const bookTags = book.userTags ?? [];
    if (tags.size && !bookTags.some((tag) => tags.has(normalize(tag)))) return false;
    return !search || [book.title, book.author, book.originalFilename, book.sourceFormat, ...bookTags]
      .some((value) => normalize(value).includes(search));
  });
}
