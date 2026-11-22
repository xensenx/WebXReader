import { FORMAT_OPTIONS, READING_STATUSES } from '../../features/library/library-filters';
import { DEFAULT_SERIES_FILTERS, getSeriesFilterOptions, type SeriesEntry, type SeriesFilters } from '../../features/series/series-browser';
import { Button } from '../common/Button';
import { DropdownSelect } from '../common/DropdownSelect';
import { FilterChips } from '../library/LibraryFilterPanel';
import styles from '../library/LibraryFilterPanel.module.css';

interface SeriesFilterPanelProps {
  id: string;
  entries: readonly SeriesEntry[];
  filters: SeriesFilters;
  onChange: (filters: SeriesFilters) => void;
  count: number;
  activeCount: number;
}

const ORDER_OPTIONS = [
  { value: '', label: 'Any reading order' }, { value: 'numbered', label: 'Volume numbers' }, { value: 'custom', label: 'Custom reading order' },
];
const SIZE_OPTIONS = [
  { value: '', label: 'Any volume count' }, { value: 'empty', label: 'No volumes' },
  { value: 'short', label: '1–10 volumes' }, { value: 'long', label: '11 or more volumes' },
];

export function SeriesFilterPanel({ id, entries, filters, onChange, count, activeCount }: SeriesFilterPanelProps) {
  const options = getSeriesFilterOptions(entries, filters);
  const set = <K extends keyof SeriesFilters>(key: K, value: SeriesFilters[K]) => onChange({ ...filters, [key]: value });
  return (
    <section id={id} className={styles.panel} aria-labelledby={`${id}-title`}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 id={`${id}-title`}>Filters</h2>
          <span className={styles.resultCount} role="status">{count} series found</span>
        </div>
        <Button type="button" size="sm" variant="ghost" disabled={!activeCount} onClick={() => onChange(DEFAULT_SERIES_FILTERS)}>Clear filters</Button>
      </div>
      <FilterChips label="Series progress" options={READING_STATUSES} selected={filters.statuses} onChange={(value) => set('statuses', value)} />
      <FilterChips label="Volume formats" options={FORMAT_OPTIONS} selected={filters.formats} onChange={(value) => set('formats', value)} />
      {options.tags.length > 0 && <FilterChips label="Series tags" options={options.tags} selected={filters.tags} onChange={(value) => set('tags', value)} scrollable />}
      <fieldset className={styles.group}>
        <legend>Title starts with</legend>
        <div className={styles.chips}>
          {['', ...options.initials].map((initial) => (
            <label className={`${styles.chip} ${styles.letter}`} key={initial}>
              <input type="radio" name={`${id}-initial`} checked={filters.initial === initial} onChange={() => set('initial', initial)}
                aria-label={initial === '#' ? 'Numbers and symbols' : initial || 'Any initial'} />
              <span>{initial || 'Any'}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className={styles.metadata}>
        <div className={styles.group}>
          <span className={styles.fieldLabel}>Author</span>
          <DropdownSelect ariaLabel="Filter series by author" value={filters.author}
            options={[{ value: '', label: 'All authors' }, ...options.authors]} onChange={(value) => set('author', value)} />
        </div>
        <div className={styles.group}>
          <span className={styles.fieldLabel}>Reading order</span>
          <DropdownSelect ariaLabel="Filter series by reading order" value={filters.order} options={ORDER_OPTIONS}
            onChange={(value) => set('order', value as SeriesFilters['order'])} />
        </div>
        <div className={styles.group}>
          <span className={styles.fieldLabel}>Volume count</span>
          <DropdownSelect ariaLabel="Filter series by volume count" value={filters.size} options={SIZE_OPTIONS}
            onChange={(value) => set('size', value as SeriesFilters['size'])} />
        </div>
      </div>
    </section>
  );
}
