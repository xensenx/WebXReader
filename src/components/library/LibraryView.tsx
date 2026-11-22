/**
 * LibraryView component: the primary home screen of WebXReader.
 */

import {
  useState,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  type DragEvent as ReactDragEvent,
} from 'react';
import {
  getLibraryViewState,
  saveLibraryViewState,
  updateLibraryScroll,
} from '../../features/library/library-state';
import { countLibraryFilters, DEFAULT_LIBRARY_FILTERS, filterLibraryBooks, type LibraryFilters } from '../../features/library/library-filters';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Upload,
  BookX,
  SearchX,
  ArrowRight,
  Archive,
  CheckCircle,
  Circle,
  Layers,
  Trash2,
} from 'lucide-react';
import { useBooks } from '../../hooks/useBooks';
import { useSettingsContext } from '../../app/providers/SettingsContext';
import { updateBook, updateBookAndCover } from '../../core/storage/database';
import { downloadOriginalBook } from '../../features/export/backup-service';
import type {
  Book,
} from '../../types/book';

import { BookCard } from './BookCard';
import { BookList } from './BookList';
import { LibraryToolbar } from './LibraryToolbar';
import { ImportDialog } from './ImportDialog';
import { BookDetailsDialog } from './BookDetailsDialog';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { EmptyState } from '../common/EmptyState';
import { Button } from '../common/Button';
import { MainPageHeader } from '../common/MainPageHeader';
import { AddToSeriesDialog } from '../series/AddToSeriesDialog';

import { BookCoverImage } from './BookCoverImage';
import { BookReorderPreview } from './BookReorderPreview';
import { useBookReorder } from './useBookReorder';
import styles from './LibraryView.module.css';

export function LibraryView() {
  const navigate = useNavigate();
  const { books, loading, refreshBooks, removeBook, removeBooks, toggleFavorite, updateReadingStatus, toggleArchive } = useBooks();
  const { settings, updateSettings } = useSettingsContext();

  const applySettings = (partial: Parameters<typeof updateSettings>[0]) => {
    // The settings hook already logs persistence failures.
    void updateSettings(partial).catch(() => {});
  };

  // Synchronously load saved library state (survives reader visits, format switches & page refreshes)
  const initialSavedStateRef = useRef(getLibraryViewState());
  const isRestoredRef = useRef(false);
  const isNavigatingRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);

  // Search, filter, and sort state
  const [searchQuery, setSearchQuery] = useState(() => initialSavedStateRef.current.searchQuery);
  const [filters, setFilters] = useState(() => initialSavedStateRef.current.filters);
  const [filtersOpen, setFiltersOpen] = useState(() => initialSavedStateRef.current.filtersOpen);
  const activeFilterCount = countLibraryFilters(filters);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(() => new Set());

  // Dialog states
  const [importOpen, setImportOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[] | null>(null);
  const [detailsBook, setDetailsBook] = useState<Book | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Book | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [seriesBookIds, setSeriesBookIds] = useState<string[] | null>(null);
  const [seriesNotice, setSeriesNotice] = useState('');

  // Global drag-and-drop overlay
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const sortField = settings.librarySortField === 'lastOpenedAt' ? 'custom' : settings.librarySortField;
  const sortDirection = settings.librarySortDirection;

  // Custom book ordering state for drag-and-drop
  const [customOrder, setCustomOrder] = useState<string[]>(() => settings.customBookOrder ?? []);
  useEffect(() => {
    if (settings.customBookOrder && settings.customBookOrder.length > 0) {
      setCustomOrder(settings.customBookOrder);
    }
  }, [settings.customBookOrder]);

  // Layout preference
  const layout = settings.libraryLayout || 'grid';
  const handleLayoutChange = (newLayout: 'grid' | 'list') => {
    applySettings({ libraryLayout: newLayout });
  };

  // Find most recent book to "Continue Reading"
  const continueBook = useMemo(() => {
    const readingBooks = books
      .filter((b) => !b.archived && (b.readingStatus === 'reading' || (b.lastOpenedAt && b.lastOpenedAt > 0)))
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
    return readingBooks[0] || null;
  }, [books]);

  // Filtered & sorted book collection
  const filteredBooks = useMemo(() => {
    const result = filterLibraryBooks(books, filters, searchQuery);

    // Sorting
    if (sortField === 'custom') {
      const orderMap = new Map(customOrder.map((id, index) => [id, index]));
      result.sort((a, b) => {
        const orderA = orderMap.has(a.id) ? orderMap.get(a.id)! : 999999;
        const orderB = orderMap.has(b.id) ? orderMap.get(b.id)! : 999999;
        const comparison = orderA !== orderB ? orderA - orderB : b.importedAt - a.importedAt;
        return sortDirection === 'desc'
          ? -comparison
          : comparison;
      });
    } else {
      result.sort((a, b) => {
        let comparison = 0;
        switch (sortField) {
          case 'title':
            comparison = a.title.localeCompare(b.title);
            break;
          case 'author':
            comparison = (a.author || '').localeCompare(b.author || '');
            break;
          case 'importedAt':
          default:
            comparison = a.importedAt - b.importedAt;
            break;
        }
        return sortDirection === 'asc' ? comparison : -comparison;
      });
    }

    return result;
  }, [books, filters, searchQuery, sortField, sortDirection, customOrder]);

  const reorder = useBookReorder({
    books: filteredBooks, layout, enabled: !selectionMode,
    onCommit: (order) => {
      const nextCustomOrder = sortDirection === 'desc' ? [...order].reverse() : order;
      setCustomOrder(nextCustomOrder);
      applySettings({ librarySortField: 'custom', customBookOrder: nextCustomOrder });
    },
  });

  const selectedBooks = useMemo(
    () => books.filter((book) => selectedBookIds.has(book.id)),
    [books, selectedBookIds]
  );
  const allVisibleBooksSelected = filteredBooks.length > 0 &&
    filteredBooks.every((book) => selectedBookIds.has(book.id));

  const toggleSelectionMode = () => {
    const nextMode = !selectionMode;
    setSelectionMode(nextMode);
    if (!nextMode) clearSelection();
  };

  const toggleBookSelection = (id: string) => {
    setSelectedBookIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedBookIds((previous) => {
      const next = new Set(previous);
      if (allVisibleBooksSelected) filteredBooks.forEach((book) => next.delete(book.id));
      else filteredBooks.forEach((book) => next.add(book.id));
      return next;
    });
  };

  const clearSelection = () => setSelectedBookIds(new Set());

  const openSeriesPicker = (bookIds: string[]) => {
    setSeriesNotice('');
    setSeriesBookIds(bookIds);
  };

  const updateSelectedBooks = async (
    changes: Partial<Pick<Book, 'archived' | 'readingStatus'>>,
    clearAfterUpdate = true,
  ) => {
    try {
      const updatedAt = Date.now();
      for (const book of selectedBooks) {
        const { readingProgress: _readingProgress, ...storedBook } = book;
        await updateBook({ ...storedBook, ...changes, updatedAt });
      }
      if (clearAfterUpdate) clearSelection();
      await refreshBooks();
    } catch (err) {
      await refreshBooks();
      alert(`Could not update selected books: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDeleteSelected = async () => {
    try {
      await removeBooks(selectedBooks.map((book) => book.id));
      clearSelection();
    } catch (err) {
      alert(`Could not delete selected books: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Prevent browser's premature scroll snapping on navigation
  useEffect(() => {
    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  // Track window scroll position after restoration has completed
  useEffect(() => {
    isNavigatingRef.current = false;

    const onScroll = () => {
      if (isNavigatingRef.current || !isRestoredRef.current) return;
      if (scrollRafRef.current !== null) return;

      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null;
        if (!isNavigatingRef.current && isRestoredRef.current) {
          const currentY = Math.max(
            window.scrollY || 0,
            document.documentElement.scrollTop || 0,
            document.body.scrollTop || 0
          );
          updateLibraryScroll(currentY);
        }
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      isNavigatingRef.current = true;
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Restore scroll position when books are ready
  useLayoutEffect(() => {
    if (loading) return;
    if (isRestoredRef.current) return;

    const targetY = initialSavedStateRef.current.scrollY;
    const targetBookId = initialSavedStateRef.current.lastOpenedBookId;

    // If target position is at the top (scrollY <= 0), stay at the top and do not scroll down
    if (targetY <= 0) {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
      isRestoredRef.current = true;
      if (targetBookId) {
        saveLibraryViewState({ lastOpenedBookId: null });
      }
      return;
    }

    let frameId: number | null = null;
    let attempts = 0;
    const maxAttempts = 15;

    const attemptRestore = () => {
      attempts++;
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

      // Find target book card if available for dual-anchoring
      const targetCard = targetBookId
        ? document.querySelector<HTMLElement>(`[data-book-id="${targetBookId}"]`)
        : null;

      if (maxScroll >= targetY) {
        window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior });
        isRestoredRef.current = true;
        if (targetBookId) {
          saveLibraryViewState({ lastOpenedBookId: null });
        }
        return;
      }

      if (maxScroll > 0) {
        window.scrollTo({ top: Math.min(targetY, maxScroll), behavior: 'instant' as ScrollBehavior });
      }

      if (attempts < maxAttempts) {
        frameId = requestAnimationFrame(attemptRestore);
      } else {
        if (maxScroll >= targetY) {
          window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior });
        } else if (targetCard) {
          targetCard.scrollIntoView({ block: 'center', behavior: 'instant' });
        } else {
          window.scrollTo({ top: Math.min(targetY, maxScroll), behavior: 'instant' as ScrollBehavior });
        }
        isRestoredRef.current = true;
        if (targetBookId) {
          saveLibraryViewState({ lastOpenedBookId: null });
        }
      }
    };

    attemptRestore();

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [loading, filteredBooks.length]);

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    saveLibraryViewState({ searchQuery: query, scrollY: 0, lastOpenedBookId: null });
  };

  const handleFilterChange = (next: LibraryFilters) => {
    setFilters(next);
    saveLibraryViewState({ filters: next, scrollY: 0, lastOpenedBookId: null });
  };

  const handleFiltersOpenChange = (open: boolean) => {
    setFiltersOpen(open);
    saveLibraryViewState({ filtersOpen: open });
  };

  // Book action handlers
  const handleOpenBook = (id: string) => {
    isNavigatingRef.current = true;
    isRestoredRef.current = false;
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }

    const currentY = Math.max(
      window.scrollY || 0,
      document.documentElement.scrollTop || 0,
      document.body.scrollTop || 0
    );

    saveLibraryViewState({
      scrollY: currentY,
      lastOpenedBookId: id,
      searchQuery,
      filters,
    });
    navigate(`/read/${id}`);
  };

  const handleEditBook = (book: Book) => {
    setDetailsBook(book);
  };

  const handleSaveBookDetails = async (updated: Book) => {
    const storedBook = { ...updated } as Book & { readingProgress?: number };
    delete storedBook.readingProgress;
    await updateBookAndCover(storedBook, storedBook.coverImage);
    await refreshBooks();
  };

  const handleExportBook = async (id: string) => {
    try {
      await downloadOriginalBook(id);
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDeleteConfirm = async () => {
    if (deleteTarget) {
      await removeBook(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  const bookActions = {
    onAddToSeries: (id: string) => openSeriesPicker([id]),
    onEdit: handleEditBook,
    onToggleFavorite: toggleFavorite,
    onUpdateStatus: updateReadingStatus,
    onToggleArchive: toggleArchive,
    onExport: handleExportBook,
    onDelete: setDeleteTarget,
  };

  // Drag and drop events on entire window/main
  const handleDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('application/x-webxreader-book')) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    // Only deactivate if leaving the container itself
    if (e.currentTarget === e.target) {
      setIsDraggingOver(false);
    }
  };

  const handleDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (reorder.draggingBookId || e.dataTransfer.types.includes('application/x-webxreader-book')) return;
    if (e.dataTransfer.types.includes('Files') && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setDroppedFiles(Array.from(e.dataTransfer.files));
      setImportOpen(true);
    }
  };

  return (
    <div
      className={styles.container}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      {...reorder.pointerHandlers}
    >
      <MainPageHeader libraryName={settings.libraryName} />

      {/* Main Content Area */}
      <main className={styles.main}>
        {/* Continue Reading Section */}
        {continueBook && activeFilterCount === 0 && !searchQuery.trim() && (
          <section
            className={styles.continueSection}
            onClick={() => handleOpenBook(continueBook.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleOpenBook(continueBook.id);
            }}
            aria-label={`Continue reading ${continueBook.title}`}
          >
            <div className={styles.continueLeft}>
              <BookCoverImage
                book={continueBook}
                alt=""
                className={styles.continueCover}
                placeholder={
                  <div className={styles.continueFallbackCover}>
                    {continueBook.title.trim().charAt(0).toUpperCase()}
                  </div>
                }
              />
              <div className={styles.continueInfo}>
                <span className={styles.continueTag}>Continue Reading</span>
                <h3 className={styles.continueTitle}>{continueBook.title}</h3>
                <span className={styles.continueAuthor}>
                  {continueBook.author || 'Unknown Author'}
                </span>
              </div>
            </div>

            <Button
              variant="primary"
              size="sm"
              icon={<ArrowRight size={14} />}
              onClick={(e) => {
                e.stopPropagation();
                handleOpenBook(continueBook.id);
              }}
            >
              Resume
            </Button>
          </section>
        )}

        {/* Toolbar */}
        <LibraryToolbar
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          filters={filters}
          filtersOpen={filtersOpen}
          onFiltersOpenChange={handleFiltersOpenChange}
          books={books}
          resultCount={filteredBooks.length}
          activeFilterCount={activeFilterCount}
          onFilterChange={handleFilterChange}
          sortField={sortField}
          onSortFieldChange={(field) => applySettings({ librarySortField: field })}
          sortDirection={sortDirection}
          onToggleSortDirection={() =>
            applySettings({ librarySortDirection: sortDirection === 'asc' ? 'desc' : 'asc' })
          }
          layout={layout}
          onLayoutChange={handleLayoutChange}
          selectionMode={selectionMode}
          onToggleSelectionMode={toggleSelectionMode}
          onImportClick={() => {
            setDroppedFiles(null);
            setImportOpen(true);
          }}
        />

        {selectionMode && (
          <div className={styles.selectionToolbar} role="toolbar" aria-label="Selected book actions">
            <div className={styles.selectionSummary} aria-live="polite">
              <strong>{selectedBooks.length}</strong>
              <span>{selectedBooks.length === 1 ? 'book selected' : 'books selected'}</span>
            </div>
            <div className={styles.selectionActions}>
              <Button
                size="sm"
                variant="secondary"
                onClick={toggleVisibleSelection}
                disabled={filteredBooks.length === 0}
              >
                {allVisibleBooksSelected ? 'Deselect visible' : 'Select visible'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<Archive size={14} />}
                onClick={() => updateSelectedBooks({ archived: !selectedBooks.every((book) => book.archived) })}
                disabled={selectedBooks.length === 0}
              >
                {selectedBooks.length > 0 && selectedBooks.every((book) => book.archived) ? 'Unarchive' : 'Archive'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<CheckCircle size={14} />}
                onClick={() => updateSelectedBooks({ readingStatus: 'completed' }, false)}
                disabled={!selectedBooks.some((book) => book.readingStatus !== 'completed')}
              >
                Mark completed
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<Circle size={14} />}
                onClick={() => updateSelectedBooks({ readingStatus: 'unread' }, false)}
                disabled={!selectedBooks.some((book) => book.readingStatus !== 'unread')}
              >
                Mark unread
              </Button>
              <Button size="sm" variant="secondary" icon={<Layers size={14} />} disabled={!selectedBooks.length}
                onClick={() => openSeriesPicker([...selectedBookIds])}>
                Add to series
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 size={14} />}
                onClick={() => setBulkDeleteOpen(true)}
                disabled={selectedBooks.length === 0}
              >
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={clearSelection} disabled={selectedBooks.length === 0}>
                Clear
              </Button>
            </div>
          </div>
        )}

        {seriesNotice && <p className={styles.seriesNotice} role="status">{seriesNotice}</p>}

        {/* Books Content / Empty States */}
        {!loading && books.length === 0 && (
          <EmptyState
            icon={BookOpen}
            title="Your Library is Empty"
            description="Import a book, comic, document, or image to get started. All items stay safely on your device."
            action={{
              label: 'Import First Book',
              onClick: () => {
                setDroppedFiles(null);
                setImportOpen(true);
              },
            }}
          />
        )}

        {!loading && books.length > 0 && filteredBooks.length === 0 && searchQuery.trim() && (
          <EmptyState
            icon={SearchX}
            title="No Results Found"
            description={activeFilterCount
              ? 'No books match this search and the selected filters.'
              : `No books matched "${searchQuery}". Try another keyword.`}
            action={{
              label: 'Clear Search',
              onClick: () => handleSearchChange(''),
            }}
          />
        )}

        {!loading && books.length > 0 && filteredBooks.length === 0 && !searchQuery.trim() && (
          <EmptyState
            icon={BookX}
            title={activeFilterCount ? 'No Matching Books' : 'No Active Books'}
            description={activeFilterCount ? 'Try removing one or more filters.' : 'Your books are in the archive.'}
            action={{
              label: activeFilterCount ? 'Clear Filters' : 'Show Archived Books',
              onClick: () => handleFilterChange(activeFilterCount
                ? DEFAULT_LIBRARY_FILTERS
                : { ...DEFAULT_LIBRARY_FILTERS, archive: 'archived' }),
            }}
          />
        )}

        {!loading && filteredBooks.length > 0 && (
          <>
            {layout === 'grid' ? (
              <div ref={reorder.bookItemsRef} className={styles.bookGrid} role="feed" aria-label="Book library">
                {reorder.orderedBooks.map((book) => (
                  <BookCard
                    key={book.id}
                    book={book}
                    progress={book.readingProgress}
                    onOpen={handleOpenBook}
                    actions={bookActions}
                    selectionMode={selectionMode}
                    selected={selectedBookIds.has(book.id)}
                    onToggleSelection={toggleBookSelection}
                    isDragging={reorder.draggingBookId === book.id}
                    onPointerDown={selectionMode ? undefined : (e) => reorder.handleBookPointerDown(book.id, e)}
                    shouldSuppressClick={reorder.shouldSuppressBookClick}
                  />
                ))}
              </div>
            ) : (
              <div ref={reorder.bookItemsRef} className={styles.bookList} role="feed" aria-label="Book library">
                {reorder.orderedBooks.map((book) => (
                  <BookList
                    key={book.id}
                    book={book}
                    progress={book.readingProgress}
                    onOpen={handleOpenBook}
                    actions={bookActions}
                    selectionMode={selectionMode}
                    selected={selectedBookIds.has(book.id)}
                    onToggleSelection={toggleBookSelection}
                    isDragging={reorder.draggingBookId === book.id}
                    onPointerDown={selectionMode ? undefined : (e) => reorder.handleBookPointerDown(book.id, e)}
                    shouldSuppressClick={reorder.shouldSuppressBookClick}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <BookReorderPreview preview={reorder.dragPreview} previewRef={reorder.dragPreviewElementRef} />

      {/* Drag and Drop Overlay */}
      {isDraggingOver && (
        <div className={styles.dragOverlay}>
          <div className={styles.dragCard}>
            <Upload size={48} />
            <span>Drop book, comic, or image to import</span>
          </div>
        </div>
      )}

      {/* Import Dialog */}
      <ImportDialog
        isOpen={importOpen}
        onClose={() => {
          setImportOpen(false);
          setDroppedFiles(null);
        }}
        initialFiles={droppedFiles}
        onImportSuccess={async (_newBook, openDirectly) => {
          await refreshBooks();
          if (openDirectly) {
            handleOpenBook(_newBook.id);
          }
        }}
        onOpenExisting={(id) => handleOpenBook(id)}
      />

      {/* Book Details Dialog */}
      <BookDetailsDialog
        book={detailsBook}
        isOpen={Boolean(detailsBook)}
        onClose={() => setDetailsBook(null)}
        onSave={handleSaveBookDetails}
      />

      <AddToSeriesDialog bookIds={seriesBookIds} onClose={() => setSeriesBookIds(null)}
        onAdded={(series) => {
          setSeriesBookIds(null);
          setSeriesNotice(`Added to ${series.title}.`);
        }}
        onCreateSeries={(bookIds) => navigate('/series', { state: { seriesBookIds: bookIds } })} />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Book"
        message={`Are you sure you want to delete "${deleteTarget?.title}"? All associated reading progress, bookmarks, and annotations will be permanently deleted from this device.`}
        confirmLabel="Delete Permanently"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleDeleteSelected}
        title={`Delete ${selectedBooks.length} ${selectedBooks.length === 1 ? 'book' : 'books'}?`}
        message={`This will permanently delete ${selectedBooks.length === 1 ? 'this book' : 'these books'} and all associated reading progress, bookmarks, and annotations from this device.`}
        confirmLabel="Delete Permanently"
        variant="danger"
      />
    </div>
  );
}

