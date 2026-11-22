/**
 * LibraryToolbar component for searching, filtering, sorting, and layout switching.
 */

import { useId } from 'react';
import {
  Upload,
  SlidersHorizontal,
  CheckSquare,
  ArrowDownUp,
} from 'lucide-react';
import type {
  LibraryLayout,
  Book,
  SortField,
  SortDirection,
} from '../../types/book';
import { SearchInput } from '../common/SearchInput';
import { Button } from '../common/Button';
import { DropdownSelect } from '../common/DropdownSelect';
import type { LibraryFilters } from '../../features/library/library-filters';
import { LibraryFilterPanel } from './LibraryFilterPanel';
import { LibraryLayoutControls } from './LibraryLayoutControls';
import styles from './LibraryToolbar.module.css';

interface LibraryToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  books: readonly Book[];
  filters: LibraryFilters;
  filtersOpen: boolean;
  onFiltersOpenChange: (open: boolean) => void;
  onFilterChange: (filters: LibraryFilters) => void;
  activeFilterCount: number;
  resultCount: number;
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

const SORT_OPTIONS = [
  { value: 'custom', label: 'Custom Order' },
  { value: 'importedAt', label: 'Recently Added' },
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
];

export function LibraryToolbar({
  searchQuery,
  onSearchChange,
  books,
  filters,
  filtersOpen,
  onFiltersOpenChange,
  onFilterChange,
  activeFilterCount,
  resultCount,
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
  const panelId = useId();
  const triggerId = `${panelId}-trigger`;
  const sortDirectionLabel = sortField === 'custom'
    ? sortDirection === 'asc' ? 'Reverse Custom Order' : 'Use Custom Order'
    : `Sort ${sortDirection === 'asc' ? 'Descending' : 'Ascending'}`;

  return (
    <div className={styles.toolbar} onKeyDown={(event) => {
      if (event.key === 'Escape' && filtersOpen && !event.defaultPrevented) {
        onFiltersOpenChange(false);
        document.getElementById(triggerId)?.focus();
      }
    }}>
      <div className={styles.controls}>
        <div className={styles.searchGroup}>
          <div className={styles.searchContainer}>
            <SearchInput
              value={searchQuery}
              onChange={onSearchChange}
              placeholder="Search by title, author, or tags"
            />
          </div>
          <Button
            id={triggerId}
            type="button"
            variant="secondary"
            icon={<SlidersHorizontal size={16} />}
            aria-expanded={filtersOpen}
            aria-controls={filtersOpen ? panelId : undefined}
            className={activeFilterCount > 0 ? styles.activeFilterButton : undefined}
            onClick={() => onFiltersOpenChange(!filtersOpen)}
          >
            Filters
            {activeFilterCount > 0 && <span className={styles.filterCount}>{activeFilterCount}</span>}
          </Button>
        </div>

        <div className={styles.tools}>
          <div className={styles.sortGroup} role="group" aria-label="Sorting">
            <DropdownSelect
              className={styles.sortSelect}
              value={sortField}
              options={SORT_OPTIONS}
              onChange={(value) => onSortFieldChange(value as SortField)}
              ariaLabel="Sort books by"
            />
            <button
              className={styles.sortDirection}
              onClick={onToggleSortDirection}
              title={sortDirectionLabel}
              aria-label={sortDirectionLabel}
              type="button"
            >
              <ArrowDownUp size={16} />
            </button>
          </div>

          <Button
            className={styles.selectButton}
            variant="secondary"
            type="button"
            icon={<CheckSquare size={16} />}
            onClick={onToggleSelectionMode}
            aria-pressed={selectionMode}
          >
            {selectionMode ? 'Done' : 'Select'}
          </Button>

          <LibraryLayoutControls layout={layout} onLayoutChange={onLayoutChange} />
        </div>

        <Button
          className={styles.importButton}
          variant="primary"
          type="button"
          icon={<Upload size={16} />}
          aria-label="Import Book"
          title="Import Book"
          onClick={onImportClick}
        >
          <span className={styles.importLabel}>Import Book</span>
        </Button>
      </div>

      {filtersOpen && (
        <LibraryFilterPanel id={panelId} books={books} filters={filters} onChange={onFilterChange}
          activeCount={activeFilterCount} resultCount={resultCount} />
      )}
    </div>
  );
}
