/**
 * LibraryView component: the primary home screen of WebXReader.
 */

import { useState, useMemo, useEffect, useLayoutEffect, useRef, type DragEvent } from 'react';
import {
  getLibraryViewState,
  saveLibraryViewState,
  updateLibraryScroll,
} from '../../features/library/library-state';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Settings as SettingsIcon,
  Upload,
  BookX,
  SearchX,
  ArrowRight,
  Archive,
  CheckCircle,
  Circle,
  Trash2,
} from 'lucide-react';
import { useBooks } from '../../hooks/useBooks';
import { useSettingsContext } from '../../app/providers/SettingsContext';
import { updateBook, updateBookAndCover } from '../../core/storage/database';
import { downloadOriginalBook } from '../../features/export/backup-service';
import type {
  Book,
  LibraryFilter,
} from '../../types/book';

import { BookCard } from './BookCard';
import { BookList } from './BookList';
import { LibraryToolbar } from './LibraryToolbar';
import { ImportDialog } from './ImportDialog';
import { BookDetailsDialog } from './BookDetailsDialog';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { EmptyState } from '../common/EmptyState';
import { Button } from '../common/Button';

import styles from './LibraryView.module.css';

export function LibraryView() {
  const navigate = useNavigate();
  const { books, loading, refreshBooks, removeBook, removeBooks, toggleFavorite, updateReadingStatus, toggleArchive } = useBooks();
  const { settings, updateSettings } = useSettingsContext();

  // Synchronously load saved library state (survives reader visits, format switches & page refreshes)
  const initialSavedStateRef = useRef(getLibraryViewState());
  const isRestoredRef = useRef(false);
  const isNavigatingRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);

  // Search, filter, and sort state
  const [searchQuery, setSearchQuery] = useState(() => initialSavedStateRef.current.searchQuery);
  const [filter, setFilter] = useState<LibraryFilter>(() => initialSavedStateRef.current.filter);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(() => new Set());

  // Dialog states
  const [importOpen, setImportOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[] | null>(null);
  const [detailsBook, setDetailsBook] = useState<Book | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Book | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Global drag-and-drop overlay
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const sortField = settings.librarySortField === 'lastOpenedAt' ? 'custom' : settings.librarySortField;
  const sortDirection = settings.librarySortDirection;

  // Custom book ordering state for drag-and-drop
  const [customOrder, setCustomOrder] = useState<string[]>(() => settings.customBookOrder ?? []);
  const [draggingBookId, setDraggingBookId] = useState<string | null>(null);
  const draggedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (settings.customBookOrder && settings.customBookOrder.length > 0) {
      setCustomOrder(settings.customBookOrder);
    }
  }, [settings.customBookOrder]);

  // Layout preference
  const layout = settings.libraryLayout || 'grid';
  const handleLayoutChange = (newLayout: 'grid' | 'list') => {
    updateSettings({ libraryLayout: newLayout });
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
    let result = [...books];

    // Filter
    switch (filter) {
      case 'reading':
        result = result.filter((b) => b.readingStatus === 'reading' && !b.archived);
        break;
      case 'unread':
        result = result.filter((b) => b.readingStatus === 'unread' && !b.archived);
        break;
      case 'completed':
        result = result.filter((b) => b.readingStatus === 'completed' && !b.archived);
        break;
      case 'favorites':
        result = result.filter((b) => b.favorite && !b.archived);
        break;
      case 'archived':
        result = result.filter((b) => b.archived);
        break;
      case 'all':
      default:
        result = result.filter((b) => !b.archived);
        break;
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q) ||
          (b.userTags && b.userTags.some((t) => t.toLowerCase().includes(q))) ||
          (b.originalFilename && b.originalFilename.toLowerCase().includes(q)) ||
          b.sourceFormat.toLowerCase().includes(q)
      );
    }

    // Sorting
    if (sortField === 'custom') {
      const orderMap = new Map(customOrder.map((id, index) => [id, index]));
      result.sort((a, b) => {
        const orderA = orderMap.has(a.id) ? orderMap.get(a.id)! : 999999;
        const orderB = orderMap.has(b.id) ? orderMap.get(b.id)! : 999999;
        if (orderA !== orderB) return orderA - orderB;
        return b.importedAt - a.importedAt;
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
  }, [books, filter, searchQuery, sortField, sortDirection, customOrder]);

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

    if (targetY <= 0 && !targetBookId) {
      isRestoredRef.current = true;
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

      if (targetY > 0 && maxScroll >= targetY) {
        window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior });
        isRestoredRef.current = true;
        return;
      }

      if (maxScroll > 0 && targetY > 0) {
        window.scrollTo({ top: Math.min(targetY, maxScroll), behavior: 'instant' as ScrollBehavior });
      }

      if (attempts < maxAttempts) {
        frameId = requestAnimationFrame(attemptRestore);
      } else {
        if (targetY > 0 && maxScroll >= targetY) {
          window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior });
        } else if (targetCard) {
          targetCard.scrollIntoView({ block: 'center', behavior: 'instant' });
        } else if (targetY > 0) {
          window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior });
        }
        isRestoredRef.current = true;
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

  const handleFilterChange = (newFilter: LibraryFilter) => {
    setFilter(newFilter);
    saveLibraryViewState({ filter: newFilter, scrollY: 0, lastOpenedBookId: null });
  };

  // Custom drag-and-drop book reordering handlers
  const handleBookDragStart = (id: string, e: DragEvent<HTMLDivElement>) => {
    draggedIdRef.current = id;
    setDraggingBookId(id);
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.setData('application/x-webxreader-book', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleBookDragOver = (targetId: string, e: DragEvent<HTMLDivElement>) => {
    if (!draggedIdRef.current || draggedIdRef.current === targetId) return;
    if (e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('application/x-webxreader-book')) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    if (sortField !== 'custom') {
      updateSettings({ librarySortField: 'custom' });
    }

    setCustomOrder((prevOrder) => {
      const sourceId = draggedIdRef.current;
      if (!sourceId) return prevOrder;

      const allVisibleIds = filteredBooks.map((b) => b.id);
      let baseOrder = prevOrder.filter((id) => allVisibleIds.includes(id));
      for (const id of allVisibleIds) {
        if (!baseOrder.includes(id)) {
          baseOrder.push(id);
        }
      }

      const fromIdx = baseOrder.indexOf(sourceId);
      const toIdx = baseOrder.indexOf(targetId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prevOrder;

      const next = [...baseOrder];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const handleBookDragEnd = () => {
    const sourceId = draggedIdRef.current;
    draggedIdRef.current = null;
    setDraggingBookId(null);

    if (sourceId) {
      updateSettings({
        librarySortField: 'custom',
        customBookOrder: customOrder,
      });
    }
  };

  const handleBookDrop = (_targetId: string, e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('application/x-webxreader-book')) {
      e.preventDefault();
      e.stopPropagation();
      handleBookDragEnd();
    }
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
      filter,
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

  // Drag and drop events on entire window/main
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('application/x-webxreader-book')) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    // Only deactivate if leaving the container itself
    if (e.currentTarget === e.target) {
      setIsDraggingOver(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
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
    >
      {/* App Header */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <img
            src="/webxreader.svg"
            alt=""
            className={styles.brandLogo}
            aria-hidden="true"
          />
          <span>WebXReader</span>
        </div>

        <div className={styles.headerActions}>
          <button
            className={styles.iconButton}
            onClick={() => navigate('/settings')}
            title="Application Settings & Backup"
            aria-label="Settings"
            type="button"
          >
            <SettingsIcon size={20} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className={styles.main}>
        {/* Continue Reading Section */}
        {continueBook && filter === 'all' && !searchQuery && (
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
              {continueBook.coverImage ? (
                <img
                  src={continueBook.coverImage}
                  alt=""
                  className={styles.continueCover}
                />
              ) : (
                <div className={styles.continueFallbackCover}>
                  {continueBook.title.trim().charAt(0).toUpperCase()}
                </div>
              )}
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
          filter={filter}
          onFilterChange={handleFilterChange}
          sortField={sortField}
          onSortFieldChange={(field) => updateSettings({ librarySortField: field })}
          sortDirection={sortDirection}
          onToggleSortDirection={() =>
            updateSettings({ librarySortDirection: sortDirection === 'asc' ? 'desc' : 'asc' })
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

        {/* Books Content / Empty States */}
        {!loading && books.length === 0 && (
          <EmptyState
            icon={BookOpen}
            title="Your Library is Empty"
            description="Import a book or comic in EPUB, PDF, CBZ, TXT, Markdown, or HTML format to get started. All books stay safely on your device."
            action={{
              label: 'Import First Book',
              onClick: () => {
                setDroppedFiles(null);
                setImportOpen(true);
              },
            }}
          />
        )}

        {!loading && books.length > 0 && filteredBooks.length === 0 && searchQuery && (
          <EmptyState
            icon={SearchX}
            title="No Results Found"
            description={`No books matched "${searchQuery}". Try searching by another keyword.`}
            action={{
              label: 'Clear Search',
              onClick: () => handleSearchChange(''),
            }}
          />
        )}

        {!loading && books.length > 0 && filteredBooks.length === 0 && !searchQuery && (
          <EmptyState
            icon={BookX}
            title={`No ${filter} books`}
            description={`You don't have any books matching the "${filter}" filter.`}
            action={{
              label: 'Show All Books',
              onClick: () => handleFilterChange('all'),
            }}
          />
        )}

        {!loading && filteredBooks.length > 0 && (
          <>
            {layout === 'grid' ? (
              <div className={styles.bookGrid} role="feed" aria-label="Book library">
                {filteredBooks.map((book) => (
                  <BookCard
                    key={book.id}
                    book={book}
                    progress={book.readingProgress}
                    onOpen={handleOpenBook}
                    onEdit={handleEditBook}
                    onToggleFavorite={toggleFavorite}
                    onUpdateStatus={updateReadingStatus}
                    onToggleArchive={toggleArchive}
                    onExport={handleExportBook}
                    onDelete={(b) => setDeleteTarget(b)}
                    selectionMode={selectionMode}
                    selected={selectedBookIds.has(book.id)}
                    onToggleSelection={toggleBookSelection}
                    draggable={!selectionMode}
                    isDragging={draggingBookId === book.id}
                    onDragStart={(e) => handleBookDragStart(book.id, e)}
                    onDragOver={(e) => handleBookDragOver(book.id, e)}
                    onDrop={(e) => handleBookDrop(book.id, e)}
                    onDragEnd={handleBookDragEnd}
                  />
                ))}
              </div>
            ) : (
              <div className={styles.bookList} role="feed" aria-label="Book library">
                {filteredBooks.map((book) => (
                  <BookList
                    key={book.id}
                    book={book}
                    progress={book.readingProgress}
                    onOpen={handleOpenBook}
                    onEdit={handleEditBook}
                    onToggleFavorite={toggleFavorite}
                    onUpdateStatus={updateReadingStatus}
                    onToggleArchive={toggleArchive}
                    onExport={handleExportBook}
                    onDelete={(b) => setDeleteTarget(b)}
                    selectionMode={selectionMode}
                    selected={selectedBookIds.has(book.id)}
                    onToggleSelection={toggleBookSelection}
                    draggable={!selectionMode}
                    isDragging={draggingBookId === book.id}
                    onDragStart={(e) => handleBookDragStart(book.id, e)}
                    onDragOver={(e) => handleBookDragOver(book.id, e)}
                    onDrop={(e) => handleBookDrop(book.id, e)}
                    onDragEnd={handleBookDragEnd}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Drag and Drop Overlay */}
      {isDraggingOver && (
        <div className={styles.dragOverlay}>
          <div className={styles.dragCard}>
            <Upload size={48} />
            <span>Drop book or comic file to import</span>
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
