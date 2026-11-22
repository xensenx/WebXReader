import { useId } from 'react';
import { ArrowDownUp, CheckSquare, GripVertical, Plus, SlidersHorizontal } from 'lucide-react';
import { SERIES_SORT_OPTIONS, type SeriesBrowserState, type SeriesEntry, type SeriesSortField } from '../../features/series/series-browser';
import { Button } from '../common/Button';
import { DropdownSelect } from '../common/DropdownSelect';
import { SearchInput } from '../common/SearchInput';
import styles from '../library/LibraryToolbar.module.css';
import { SeriesFilterPanel } from './SeriesFilterPanel';
import seriesStyles from './SeriesToolbar.module.css';

interface SeriesToolbarProps {
  entries: readonly SeriesEntry[];
  state: SeriesBrowserState;
  onChange: (patch: Partial<SeriesBrowserState>) => void;
  count: number;
  selectionMode: boolean;
  onSelect: () => void;
  reorderMode: boolean;
  onReorder: () => void;
  onCreate: () => void;
  canCreate: boolean;
}

const sortOptions = [...SERIES_SORT_OPTIONS];

export function SeriesToolbar({ entries, state, onChange, count, selectionMode, onSelect, reorderMode, onReorder, onCreate, canCreate }: SeriesToolbarProps) {
  const panelId = useId();
  const triggerId = `${panelId}-trigger`;
  const activeCount = Object.values(state.filters).filter((value) => value.length > 0).length;
  const direction = state.sortDirection === 'asc' ? 'desc' : 'asc';
  const directionLabel = state.sortField === 'custom'
    ? state.sortDirection === 'asc' ? 'Reverse custom order' : 'Use custom order'
    : `Sort ${direction === 'asc' ? 'ascending' : 'descending'}`;

  return (
    <div className={styles.toolbar} onKeyDown={(event) => {
      if (event.key === 'Escape' && state.filtersOpen && !event.defaultPrevented) {
        onChange({ filtersOpen: false });
        document.getElementById(triggerId)?.focus();
      }
    }}>
      <div className={styles.controls}>
        <div className={styles.searchGroup}>
          <div className={styles.searchContainer}>
            <SearchInput value={state.query} onChange={(query) => onChange({ query })} placeholder="Search series" />
          </div>
          <Button id={triggerId} type="button" variant="secondary" icon={<SlidersHorizontal size={16} />}
            aria-expanded={state.filtersOpen} aria-controls={state.filtersOpen ? panelId : undefined}
            className={activeCount ? styles.activeFilterButton : undefined} onClick={() => onChange({ filtersOpen: !state.filtersOpen })}>
            Filters {activeCount > 0 && <span className={styles.filterCount}>{activeCount}</span>}
          </Button>
        </div>
        <div className={`${styles.tools} ${seriesStyles.tools}`}>
          <div className={`${styles.sortGroup} ${seriesStyles.sortGroup}`} role="group" aria-label="Sorting">
            <DropdownSelect className={styles.sortSelect} value={state.sortField} options={sortOptions}
              onChange={(value) => onChange({ sortField: value as SeriesSortField, sortDirection: value === 'createdAt' ? 'desc' : 'asc' })} ariaLabel="Sort series by" />
            <button className={styles.sortDirection} type="button" aria-label={directionLabel} title={directionLabel}
              onClick={() => onChange({ sortDirection: direction })}><ArrowDownUp size={16} /></button>
          </div>
          <Button className={styles.selectButton} type="button" variant="secondary" icon={<CheckSquare size={16} />}
            onClick={onSelect} aria-pressed={selectionMode} disabled={!count && !selectionMode}>{selectionMode ? 'Done' : 'Select'}</Button>
          {state.sortField === 'custom' && (
            <Button className={styles.selectButton} type="button" variant="secondary" icon={<GripVertical size={16} />}
              onClick={onReorder} aria-pressed={reorderMode} disabled={count < 2 && !reorderMode}>{reorderMode ? 'Done reordering' : 'Reorder'}</Button>
          )}
        </div>
        <Button className={styles.importButton} type="button" variant="primary" icon={<Plus size={17} />}
          aria-label="Create series" title="Create series" onClick={onCreate} disabled={!canCreate}>
          <span className={styles.importLabel}>Create series</span>
        </Button>
      </div>
      {state.filtersOpen && <SeriesFilterPanel id={panelId} entries={entries} filters={state.filters} count={count} activeCount={activeCount}
        onChange={(filters) => onChange({ filters })} />}
    </div>
  );
}
