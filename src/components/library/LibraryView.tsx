/**
 * LibraryView component: the primary home screen of WebXReader.
 */

import { useState, useMemo, type DragEvent } from 'react';
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
  Trash2,
} from 'lucide-react';
import { useBooks } from '../../hooks/useBooks';
import { useSettingsContext } from '../../app/providers/SettingsContext';
import { updateBook } from '../../core/storage/database';
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

  // Search, filter, and sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>('all');
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

  const sortField = settings.librarySortField;
  const sortDirection = settings.librarySortDirection;

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
          (b.originalFilename && b.originalFilename.toLowerCase().includes(q))
      );
    }

    // Sorting
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
          comparison = a.importedAt - b.importedAt;
          break;
        case 'lastOpenedAt':
        default:
          comparison = (a.lastOpenedAt ?? 0) - (b.lastOpenedAt ?? 0);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [books, filter, searchQuery, sortField, sortDirection]);

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

  const updateSelectedBooks = async (changes: Partial<Pick<Book, 'archived' | 'readingStatus'>>) => {
    try {
      const updatedAt = Date.now();
      for (const book of selectedBooks) {
        const { readingProgress: _readingProgress, ...storedBook } = book;
        await updateBook({ ...storedBook, ...changes, updatedAt });
      }
      clearSelection();
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

  // Book action handlers
  const handleOpenBook = (id: string) => {
    navigate(`/read/${id}`);
  };

  const handleEditBook = (book: Book) => {
    setDetailsBook(book);
  };

  const handleSaveBookDetails = async (updated: Book) => {
    const storedBook = { ...updated } as Book & { readingProgress?: number };
    delete storedBook.readingProgress;
    await updateBook(storedBook);
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
    if (e.dataTransfer.types.includes('Files')) {
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
          onSearchChange={setSearchQuery}
          filter={filter}
          onFilterChange={setFilter}
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
                onClick={() => updateSelectedBooks({
                  readingStatus: selectedBooks.every((book) => book.readingStatus === 'completed') ? 'unread' : 'completed',
                })}
                disabled={selectedBooks.length === 0}
              >
                {selectedBooks.length > 0 && selectedBooks.every((book) => book.readingStatus === 'completed') ? 'Mark unread' : 'Mark completed'}
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
            description="Import a web novel in EPUB, PDF, TXT, Markdown, or HTML format to get started. All books stay safely on your device."
            action={{
              label: 'Import First Novel',
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
              onClick: () => setSearchQuery(''),
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
              onClick: () => setFilter('all'),
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
            <span>Drop novel file to import</span>
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
