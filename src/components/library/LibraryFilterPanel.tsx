import { useMemo } from 'react';
import type { Book } from '../../types/book';
import {
  DEFAULT_LIBRARY_FILTERS,
  FORMAT_OPTIONS,
  METADATA_FIELDS,
  READING_STATUSES,
  getLibraryFilterOptions,
  type LibraryFilters,
} from '../../features/library/library-filters';
import { Button } from '../common/Button';
import { DropdownSelect } from '../common/DropdownSelect';
import styles from './LibraryFilterPanel.module.css';

interface FilterPanelProps {
  id: string;
  books: readonly Book[];
  filters: LibraryFilters;
  onChange: (filters: LibraryFilters) => void;
  activeCount: number;
  resultCount: number;
}

interface ChipOptionsProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string; title?: string }[];
  selected: readonly T[];
  onChange: (next: T[]) => void;
  scrollable?: boolean;
}

function FilterChips<T extends string>({ label, options, selected, onChange, scrollable }: ChipOptionsProps<T>) {
  return (
    <fieldset className={styles.group}>
      <legend>{label}</legend>
      <div className={`${styles.chips} ${scrollable ? styles.scrollable : ''}`}>
        {options.map(({ value, label, title }) => {
          const checked = selected.includes(value);
          return (
            <label className={styles.chip} key={value} title={title}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onChange(checked ? selected.filter((item) => item !== value) : [...selected, value])}
              />
              <span>{label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const ARCHIVE_OPTIONS = [
  { value: 'active', label: 'All Books' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'Include Archived' },
] as const;

const RATING_OPTIONS = [
  { value: '', label: 'Any rating' },
  { value: 'unrated', label: 'Unrated' },
  ...[5, 4, 3, 2, 1].map((rating) => ({ value: String(rating), label: rating === 1 ? '1 star' : `${rating} stars` })),
];

export function LibraryFilterPanel({ id, books, filters, onChange, activeCount, resultCount }: FilterPanelProps) {
  const options = useMemo(() => getLibraryFilterOptions(books, filters), [books, filters]);
  const set = <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) =>
    onChange({ ...filters, [key]: value });
  const archiveGroup = `${id}-archive`;

  return (
    <section id={id} className={styles.panel} aria-labelledby={`${id}-title`}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 id={`${id}-title`}>Filters</h2>
          <span className={styles.resultCount} role="status">
            {resultCount} {resultCount === 1 ? 'book' : 'books'}
          </span>
        </div>
        <Button type="button" size="sm" variant="ghost" disabled={!activeCount}
          onClick={() => onChange(DEFAULT_LIBRARY_FILTERS)}>
          Clear filters
        </Button>
      </div>

      <div className={styles.overview}>
        <fieldset className={styles.group}>
          <legend>Collection</legend>
          <div className={styles.chips}>
            {ARCHIVE_OPTIONS.map(({ value, label }) => (
              <label className={styles.chip} key={value}>
                <input type="radio" name={archiveGroup} checked={filters.archive === value}
                  onChange={() => set('archive', value)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <FilterChips label="Reading status" options={READING_STATUSES} selected={filters.statuses}
          onChange={(value) => set('statuses', value)} />
        <fieldset className={styles.group}>
          <legend>Favorites</legend>
          <div className={styles.chips}>
            <label className={styles.chip}>
              <input type="checkbox" checked={filters.favorite} onChange={(event) => set('favorite', event.target.checked)} />
              <span>Favorites only</span>
            </label>
          </div>
        </fieldset>
      </div>

      <FilterChips label="Formats" options={FORMAT_OPTIONS} selected={filters.formats}
        onChange={(value) => set('formats', value)} />

      <fieldset className={styles.group}>
        <legend>Title starts with</legend>
        <div className={styles.chips}>
          {['', ...options.initials].map((initial) => (
            <label className={`${styles.chip} ${styles.letter}`} key={initial}>
              <input type="radio" name={`${id}-title-initial`} checked={filters.initial === initial}
                onChange={() => set('initial', initial)}
                aria-label={initial === '#' ? 'Numbers and symbols' : initial || 'Any initial'} />
              <span>{initial || 'Any'}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {options.tags.length > 0 && (
        <FilterChips label="Tags" options={options.tags} selected={filters.tags} onChange={(value) => set('tags', value)} scrollable />
      )}

      <div className={styles.metadata}>
        {METADATA_FIELDS.map(({ key, label, all }) => (
          <div className={styles.group} key={key}>
            <span className={styles.fieldLabel}>{label}</span>
            <DropdownSelect ariaLabel={label} value={filters[key]}
              options={[{ value: '', label: all }, ...options[key]]} onChange={(value) => set(key, value)} />
          </div>
        ))}
        <div className={styles.group}>
          <span className={styles.fieldLabel}>Rating</span>
          <DropdownSelect ariaLabel="Rating" value={filters.rating} options={RATING_OPTIONS}
            onChange={(value) => set('rating', value)} />
        </div>
      </div>
    </section>
  );
}
