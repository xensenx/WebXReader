/**
 * LibraryToolbar component for searching, filtering, sorting, and layout switching.
 */

import {
  Upload,
  CheckSquare,
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
import { DropdownSelect } from '../common/DropdownSelect';
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
  selectionMode: boolean;
  onToggleSelectionMode: () => void;
}

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: 'all', label: 'All Books' },
  { id: 'reading', label: 'Reading' },
  { id: 'unread', label: 'Unread' },
  { id: 'completed', label: 'Completed' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'archived', label: 'Archived' },
];

const SORT_OPTIONS = [
  { value: 'lastOpenedAt', label: 'Recently Read' },
  { value: 'importedAt', label: 'Recently Added' },
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
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
  selectionMode,
  onToggleSelectionMode,
}: LibraryToolbarProps) {
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
          <DropdownSelect
            className={styles.sortSelect}
            value={sortField}
            options={SORT_OPTIONS}
            onChange={(value) => onSortFieldChange(value as SortField)}
            ariaLabel="Sort books by"
          />

          <Button
            variant="secondary"
            icon={<CheckSquare size={16} />}
            onClick={onToggleSelectionMode}
            aria-pressed={selectionMode}
          >
            {selectionMode ? 'Done' : 'Select'}
          </Button>

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
