import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_LIBRARY_FILTERS, filterLibraryBooks } from '../../features/library/library-filters';
import { getBookVolumeNumber } from '../../features/series/volume-order';
import type { LibraryBook } from '../../hooks/useBooks';
import type { LibraryLayout } from '../../types/book';
import { Button } from '../common/Button';
import { SearchInput } from '../common/SearchInput';
import { BookCard } from '../library/BookCard';
import { BookList } from '../library/BookList';
import { LibraryLayoutControls } from '../library/LibraryLayoutControls';
import libraryStyles from '../library/LibraryView.module.css';
import styles from './SeriesBookPicker.module.css';

const pickerFilters = { ...DEFAULT_LIBRARY_FILTERS, archive: 'all' } as const;

interface SeriesBookPickerProps {
  books: readonly LibraryBook[];
  selectedIds: readonly string[];
  initialLayout: LibraryLayout;
  requireSelection: boolean;
  onApply: (ids: string[]) => void;
  onCancel: () => void;
}

export function SeriesBookPicker({ books, selectedIds, initialLayout, requireSelection, onApply, onCancel }: SeriesBookPickerProps) {
  const [layout, setLayout] = useState(initialLayout);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState(() => [...selectedIds]);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const positions = useMemo(() => new Map(selection.map((id, index) => [id, index + 1])), [selection]);
  const visibleBooks = useMemo(() => filterLibraryBooks(books, pickerFilters, query), [books, query]);

  useLayoutEffect(() => {
    searchRef.current?.focus();
  }, []);

  function toggleBook(id: string) {
    setSelection((current) => current.includes(id) ? current.filter((bookId) => bookId !== id) : [...current, id]);
  }

  const Item = layout === 'grid' ? BookCard : BookList;
  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <SearchInput inputRef={searchRef} value={query} placeholder="Search title or filename"
          onChange={(value) => {
            setQuery(value);
            if (scrollRef.current) scrollRef.current.scrollTop = 0;
          }} />
        <LibraryLayoutControls layout={layout} onLayoutChange={setLayout} label="Book picker layout" />
      </div>
      <div className={styles.scroll} ref={scrollRef}>
        {visibleBooks.length ? (
          <div className={layout === 'grid' ? `${libraryStyles.bookGrid} ${styles.grid}` : libraryStyles.bookList}
            role="group" aria-label="Available books">
            {visibleBooks.map((book) => {
              const position = positions.get(book.id);
              const volume = getBookVolumeNumber(book);
              return <Item key={book.id} book={book} progress={book.readingProgress} onOpen={toggleBook}
                volumeLabel={volume === undefined ? undefined : `Volume ${volume}`} selectionMode selected={position !== undefined}
                selectionIndex={position} showSourceDetails onToggleSelection={toggleBook} />;
            })}
          </div>
        ) : <p className={styles.empty}>{query.trim() ? 'No matching books.' : 'No books available to select.'}</p>}
      </div>
      <div className={styles.footer}>
        <span className={styles.count} role="status">{selection.length} selected</span>
        <Button type="button" onClick={onCancel}>Cancel</Button>
        <Button type="button" variant="primary" disabled={requireSelection && selection.length === 0}
          onClick={() => onApply(selection)}>Use selected books</Button>
      </div>
    </div>
  );
}
