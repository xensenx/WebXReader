import { FORMAT_OPTIONS, getTitleInitial, getTitleInitialOptions, READING_STATUSES } from '../library/library-filters';
import type { BookFormat, BookSeries, ReadingStatus, SortDirection } from '../../types/book';
import type { LibraryBook } from '../../hooks/useBooks';
import { summarizeSeries } from './series';

export const SERIES_SORT_OPTIONS = [
  { value: 'custom', label: 'Custom order' },
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'createdAt', label: 'Recently created' },
  { value: 'progress', label: 'Reading progress' },
  { value: 'volumes', label: 'Volume count' },
] as const;

export type SeriesSortField = (typeof SERIES_SORT_OPTIONS)[number]['value'];

export interface SeriesFilters {
  statuses: ReadingStatus[];
  formats: BookFormat[];
  tags: string[];
  initial: string;
  author: string;
  order: '' | 'numbered' | 'custom';
  size: '' | 'empty' | 'short' | 'long';
}

export const DEFAULT_SERIES_FILTERS: SeriesFilters = {
  statuses: [], formats: [], tags: [], initial: '', author: '', order: '', size: '',
};

export interface SeriesBrowserState {
  query: string;
  filters: SeriesFilters;
  filtersOpen: boolean;
  sortField: SeriesSortField;
  sortDirection: SortDirection;
  customOrder: string[];
}

export interface SeriesEntry {
  series: BookSeries;
  volumes: LibraryBook[];
  progress: number;
  status: ReadingStatus;
}

const normalize = (value?: string) => value?.trim().normalize('NFC').toLowerCase() ?? '';
const storageKey = 'webxreader.series-browser.v1';

export function createSeriesEntry(series: BookSeries, volumes: LibraryBook[]): SeriesEntry {
  const { fraction, completed, total } = summarizeSeries(volumes);
  const status = total > 0 && completed === total ? 'completed' : fraction > 0 ? 'reading' : 'unread';
  return { series, volumes, progress: fraction, status };
}

export function getSeriesFilterOptions(entries: readonly SeriesEntry[], filters: SeriesFilters) {
  const distinctOptions = (values: string[], selected: string[]) => {
    const labels = new Map(selected.filter(Boolean).map((value) => [value, value]));
    for (const label of values) {
      const value = normalize(label);
      if (value) labels.set(value, label);
    }
    return [...labels].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  };
  return {
    authors: distinctOptions(entries.map(({ series }) => series.author ?? ''), [filters.author]),
    tags: distinctOptions(entries.flatMap(({ series }) => series.tags ?? []), filters.tags),
    initials: getTitleInitialOptions(entries.map(({ series }) => series.title), filters.initial),
  };
}

export function filterSeries(entries: readonly SeriesEntry[], filters: SeriesFilters, query: string) {
  const search = normalize(query);
  return entries.filter(({ series, volumes, status }) => {
    if (filters.statuses.length && !filters.statuses.includes(status)) return false;
    if (filters.formats.length && !volumes.some(({ sourceFormat }) => filters.formats.includes(sourceFormat))) return false;
    if (filters.tags.length && !series.tags?.some((tag) => filters.tags.includes(normalize(tag)))) return false;
    if (filters.initial && filters.initial !== getTitleInitial(series.title)) return false;
    if (filters.author && filters.author !== normalize(series.author)) return false;
    if (filters.order && filters.order !== (series.volumeNumbers ? 'numbered' : 'custom')) return false;
    const size = !volumes.length ? 'empty' : volumes.length <= 10 ? 'short' : 'long';
    if (filters.size && filters.size !== size) return false;
    return !search || [series.title, series.author, series.description, ...(series.tags ?? []), ...volumes.map((book) => book.title)]
      .some((value) => normalize(value).includes(search));
  });
}

export function sortSeries(entries: readonly SeriesEntry[], field: SeriesSortField, direction: SortDirection, customOrder: readonly string[]) {
  const position = new Map(customOrder.map((id, index) => [id, index]));
  return [...entries].sort((a, b) => {
    let compare = 0;
    switch (field) {
      case 'custom': compare = (position.get(a.series.id) ?? position.size) - (position.get(b.series.id) ?? position.size); break;
      case 'author': compare = (a.series.author ?? '').localeCompare(b.series.author ?? ''); break;
      case 'createdAt': compare = (a.series.createdAt ?? 0) - (b.series.createdAt ?? 0); break;
      case 'progress': compare = a.progress - b.progress; break;
      case 'volumes': compare = a.volumes.length - b.volumes.length; break;
    }
    return (compare || a.series.title.localeCompare(b.series.title)) * (direction === 'asc' ? 1 : -1);
  });
}

export function readSeriesBrowserState(): SeriesBrowserState {
  const defaults: SeriesBrowserState = {
    query: '', filters: DEFAULT_SERIES_FILTERS, filtersOpen: false, sortField: 'custom', sortDirection: 'asc', customOrder: [],
  };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<SeriesBrowserState> | null;
    if (!saved) return defaults;
    const filters = saved.filters;
    const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
    return {
      query: typeof saved.query === 'string' ? saved.query : '',
      filtersOpen: saved.filtersOpen === true,
      sortField: SERIES_SORT_OPTIONS.find(({ value }) => value === saved.sortField)?.value ?? defaults.sortField,
      sortDirection: saved.sortDirection === 'desc' ? 'desc' : 'asc',
      customOrder: [...new Set(strings(saved.customOrder))],
      filters: {
        statuses: READING_STATUSES.map(({ value }) => value).filter((value) => strings(filters?.statuses).includes(value)),
        formats: FORMAT_OPTIONS.map(({ value }) => value).filter((value) => strings(filters?.formats).includes(value)),
        tags: strings(filters?.tags), initial: typeof filters?.initial === 'string' ? filters.initial : '',
        author: typeof filters?.author === 'string' ? filters.author : '',
        order: filters?.order === 'numbered' || filters?.order === 'custom' ? filters.order : '',
        size: filters?.size === 'empty' || filters?.size === 'short' || filters?.size === 'long' ? filters.size : '',
      },
    };
  } catch {
    return defaults;
  }
}

export function saveSeriesBrowserState(state: SeriesBrowserState) {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* Keep using in-memory controls. */ }
}
