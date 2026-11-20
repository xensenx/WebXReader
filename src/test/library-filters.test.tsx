import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { LibraryToolbar } from '../components/library/LibraryToolbar';
import { countLibraryFilters, DEFAULT_LIBRARY_FILTERS, filterLibraryBooks } from '../features/library/library-filters';
import type { Book } from '../types/book';

function book(overrides: Partial<Book>): Book {
  return {
    id: 'book', title: 'Archive guide', sourceFormat: 'epub', readingStatus: 'unread',
    userTags: ['Guide'], favorite: false, archived: false, userRating: null,
    author: 'A. Writer', language: 'en', publisher: 'Test Press', description: '',
    publicationDate: '', identifiers: {}, originalFilename: 'guide.epub', fileSize: 0,
    contentHash: '', importedAt: 0, updatedAt: 0, lastOpenedAt: null, tableOfContents: [],
    totalChapters: 0,
    ...overrides,
  };
}

const books = [
  book({ id: 'a', title: '\u00c9tude', userTags: [' Fiction '], favorite: true }),
  book({ id: 'b', title: 'Echo', sourceFormat: 'pdf', userTags: ['notes'] }),
  book({ id: 'c', title: 'Evening', sourceFormat: 'html', userTags: ['fiction'], archived: true }),
  book({ id: 'd', title: '1984', sourceFormat: 'pdf', userTags: [], readingStatus: 'completed' }),
];

describe('Library filters', () => {
  it('combines groups with search and allows alternatives within formats and tags', () => {
    expect(filterLibraryBooks(books, {
      ...DEFAULT_LIBRARY_FILTERS,
      statuses: ['unread'],
      formats: ['epub', 'pdf'],
      tags: ['fiction', 'notes'],
      initial: 'E',
      author: 'a. writer',
    }, 'writer').map(({ id }) => id)).toEqual(['a', 'b']);

    expect(filterLibraryBooks(books, {
      ...DEFAULT_LIBRARY_FILTERS,
      archive: 'archived',
      tags: ['fiction'],
    }, '').map(({ id }) => id)).toEqual(['c']);

    expect(filterLibraryBooks(books, {
      ...DEFAULT_LIBRARY_FILTERS,
      initial: '#',
      rating: 'unrated',
    }, '').map(({ id }) => id)).toEqual(['d']);
  });

  it('opens the panel, lists all formats, applies filters, and restores focus on Escape', () => {
    function Toolbar() {
      const [filters, setFilters] = useState(DEFAULT_LIBRARY_FILTERS);
      const [open, setOpen] = useState(false);
      return (
        <LibraryToolbar
          books={books} filters={filters} onFilterChange={setFilters} filtersOpen={open} onFiltersOpenChange={setOpen}
          resultCount={filterLibraryBooks(books, filters, '').length} activeFilterCount={countLibraryFilters(filters)}
          searchQuery="" onSearchChange={vi.fn()} sortField="title" onSortFieldChange={vi.fn()}
          sortDirection="asc" onToggleSortDirection={vi.fn()} layout="grid" onLayoutChange={vi.fn()}
          onImportClick={vi.fn()} selectionMode={false} onToggleSelectionMode={vi.fn()}
        />
      );
    }

    render(<Toolbar />);
    const trigger = screen.getByRole('button', { name: 'Filters' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    const panel = screen.getByRole('region', { name: 'Filters' });
    const formats = within(panel).getByRole('group', { name: 'Formats' });
    expect(within(formats).getAllByRole('checkbox')).toHaveLength(20);
    fireEvent.click(within(formats).getByRole('checkbox', { name: 'PDF' }));
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Unread' }));
    expect(within(panel).getByRole('status')).toHaveTextContent('1 book');

    fireEvent.keyDown(within(formats).getByRole('checkbox', { name: 'PDF' }), { key: 'Escape' });
    expect(panel).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('status')).toHaveTextContent('3 books');
  });
});
