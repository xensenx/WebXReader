/**
 * LibraryToolbar component for searching, filtering, sorting, and layout switching.
 */

import type { ChangeEvent } from 'react';
import {
  Upload,
  LayoutGrid,
  List,
  ArrowDownUp,
} from 'lucide-react';
import type {
  LibraryLayout,
  LibraryFilter,
  SortField,
  SortDirection,
} from '../../types/book';
import { SearchInput } from '../common/SearchInput';
import { Button } from '../common/Button';
import styles from './LibraryToolbar.module.css';

interface LibraryToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filter: LibraryFilter;
  onFilterChange: (filter: LibraryFilter) => void;
  sortField: SortField;
  onSortFieldChange: (field: SortField) => void;
  sortDirection: SortDirection;
  onToggleSortDirection: () => void;
  layout: LibraryLayout;
  onLayoutChange: (layout: LibraryLayout) => void;
  onImportClick: () => void;
}

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: 'all', label: 'All Books' },
  { id: 'reading', label: 'Reading' },
  { id: 'unread', label: 'Unread' },
  { id: 'completed', label: 'Completed' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'archived', label: 'Archived' },
];

export function LibraryToolbar({
  searchQuery,
  onSearchChange,
  filter,
  onFilterChange,
  sortField,
  onSortFieldChange,
  sortDirection,
  onToggleSortDirection,
  layout,
  onLayoutChange,
  onImportClick,
}: LibraryToolbarProps) {
  const handleSortChange = (e: ChangeEvent<HTMLSelectElement>) => {
    onSortFieldChange(e.target.value as SortField);
  };

  return (
    <div className={styles.toolbar}>
      <div className={styles.topRow}>
        <div className={styles.searchContainer}>
          <SearchInput
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="Search by title, author, or tags…"
          />
        </div>

        <div className={styles.actionsRight}>
          <Button
            variant="primary"
            icon={<Upload size={16} />}
            onClick={onImportClick}
          >
            Import Book
          </Button>
        </div>
      </div>

      <div className={styles.controlsRow}>
        <div className={styles.filtersGroup} role="tablist" aria-label="Library filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              className={`${styles.filterChip} ${
                filter === f.id ? styles.filterChipActive : ''
              }`}
              onClick={() => onFilterChange(f.id)}
              type="button"
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className={styles.sortingGroup}>
          <label htmlFor="sort-select" className="sr-only">
            Sort books by
          </label>
          <select
            id="sort-select"
            value={sortField}
            onChange={handleSortChange}
            className={styles.select}
            aria-label="Sort books by"
          >
            <option value="lastOpenedAt">Recently Read</option>
            <option value="importedAt">Recently Added</option>
            <option value="title">Title</option>
            <option value="author">Author</option>
          </select>

          <button
            className={styles.iconBtn}
            onClick={onToggleSortDirection}
            title={`Sort ${sortDirection === 'asc' ? 'Descending' : 'Ascending'}`}
            aria-label={`Sort ${sortDirection === 'asc' ? 'Descending' : 'Ascending'}`}
            type="button"
          >
            <ArrowDownUp size={14} />
          </button>

          <div className={styles.divider} />

          <button
            className={`${styles.iconBtn} ${layout === 'grid' ? styles.iconBtnActive : ''}`}
            onClick={() => onLayoutChange('grid')}
            title="Grid view"
            aria-label="Grid view"
            aria-pressed={layout === 'grid'}
            type="button"
          >
            <LayoutGrid size={15} />
          </button>

          <button
            className={`${styles.iconBtn} ${layout === 'list' ? styles.iconBtnActive : ''}`}
            onClick={() => onLayoutChange('list')}
            title="List view"
            aria-label="List view"
            aria-pressed={layout === 'list'}
            type="button"
          >
            <List size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
