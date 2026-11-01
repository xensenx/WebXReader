/**
 * BookList component for list view in the library.
 */

import { useState, useRef, useEffect, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  MoreVertical,
  BookOpen,
  Info,
  Star,
  CheckCircle,
  Archive,
  Download,
  Trash2,
  Check,
} from 'lucide-react';
import type { Book, ReadingStatus } from '../../types/book';
import { formatDate } from '../../utils';
import styles from './BookList.module.css';

interface BookListProps {
  book: Book;
  progress?: number;
  onOpen: (id: string) => void;
  onEdit: (book: Book) => void;
  onToggleFavorite: (id: string) => void;
  onUpdateStatus: (id: string, status: ReadingStatus) => void;
  onToggleArchive: (id: string) => void;
  onExport: (id: string) => void;
  onDelete: (book: Book) => void;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelection: (id: string) => void;
  isDragging?: boolean;
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  shouldSuppressClick?: () => boolean;
}

export function BookList({
  book,
  progress,
  onOpen,
  onEdit,
  onToggleFavorite,
  onUpdateStatus,
  onToggleArchive,
  onExport,
  onDelete,
  selectionMode,
  selected,
  onToggleSelection,
  isDragging,
  onPointerDown,
  shouldSuppressClick,
}: BookListProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(e: globalThis.MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  useEffect(() => {
    if (selectionMode) setMenuOpen(false);
  }, [selectionMode]);

  const handleMenuClick = (e: MouseEvent) => {
    e.stopPropagation();
    setMenuOpen((prev) => !prev);
  };

  const handleAction = (e: MouseEvent, action: () => void) => {
    e.stopPropagation();
    setMenuOpen(false);
    action();
  };

  const handleRowClick = () => {
    if (shouldSuppressClick?.()) return;
    if (selectionMode) {
      onToggleSelection(book.id);
      return;
    }
    onOpen(book.id);
  };

  const getStatusClass = () => {
    switch (book.readingStatus) {
      case 'completed':
        return styles.statusCompleted;
      case 'reading':
        return styles.statusReading;
      default:
        return styles.statusUnread;
    }
  };

  const progressPercent = progress === undefined
    ? book.readingStatus === 'completed' ? 100 : book.readingStatus === 'unread' ? 0 : null
    : Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const isCompleted = book.readingStatus === 'completed';

  return (
    <div
      className={`${styles.row} ${selected ? styles.rowSelected : ''} ${isDragging ? styles.rowDragging : ''}`}
      data-book-id={book.id}
      onPointerDown={onPointerDown}
      onClick={handleRowClick}
      onContextMenu={(e) => e.preventDefault()}
      role={selectionMode ? 'checkbox' : 'button'}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleRowClick();
        }
      }}
      aria-label={`${book.title} by ${book.author || 'Unknown'}`}
      aria-checked={selectionMode ? selected : undefined}
    >
      {selectionMode && (
        <span className={`${styles.selectionIndicator} ${selected ? styles.selectionIndicatorSelected : ''}`} aria-hidden="true">
          {selected && <Check size={14} />}
        </span>
      )}
      <div className={styles.thumbnailContainer} data-drag-preview>
        {book.coverImage ? (
          <img
            src={book.coverImage}
            alt=""
            className={styles.thumbnail}
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className={styles.fallbackThumbnail}>
            {book.title.trim().charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      <div className={styles.info}>
        <div className={styles.titleRow}>
          <span className={styles.title} title={book.title}>
            {book.title}
          </span>
          {book.favorite && (
            <Star size={14} fill="#f59e0b" className={styles.favoriteIcon} />
          )}
        </div>
        <span className={styles.author} title={book.author || 'Unknown'}>
          {book.author || 'Unknown Author'}
        </span>
      </div>

      <div className={styles.metaCol}>
        <span className={styles.formatTag}>{book.sourceFormat}</span>
        <span className={`${styles.statusTag} ${getStatusClass()}`}>
          {book.readingStatus}
        </span>
        {progressPercent !== null && <span className={styles.progressText}>{progressPercent}% read</span>}
      </div>

      <div className={styles.dateCol}>
        {book.lastOpenedAt
          ? formatDate(book.lastOpenedAt)
          : formatDate(book.importedAt)}
      </div>

      {!selectionMode && (
        <button
          ref={buttonRef}
          className={styles.menuButton}
          onClick={handleMenuClick}
          aria-label={`Actions for ${book.title}`}
          aria-expanded={menuOpen}
          type="button"
        >
          <MoreVertical size={16} />
        </button>
      )}

      {menuOpen && !selectionMode && (
        <div ref={menuRef} className={styles.dropdown} role="menu">
          <button
            className={styles.menuItem}
            onClick={(e) => handleAction(e, () => onOpen(book.id))}
            role="menuitem"
            type="button"
          >
            <BookOpen size={14} />
            <span>Read</span>
          </button>

          <button
            className={styles.menuItem}
            onClick={(e) => handleAction(e, () => onEdit(book))}
            role="menuitem"
            type="button"
          >
            <Info size={14} />
            <span>Edit Details</span>
          </button>

          <button
            className={styles.menuItem}
            onClick={(e) => handleAction(e, () => onToggleFavorite(book.id))}
            role="menuitem"
            type="button"
          >
            <Star
              size={14}
              fill={book.favorite ? '#f59e0b' : 'none'}
              color={book.favorite ? '#f59e0b' : 'currentColor'}
            />
            <span>{book.favorite ? 'Remove Favorite' : 'Favorite'}</span>
          </button>

          <button
            className={styles.menuItem}
            onClick={(e) =>
              handleAction(e, () =>
                onUpdateStatus(
                  book.id,
                  isCompleted ? 'unread' : 'completed'
                )
              )
            }
            role="menuitem"
            type="button"
          >
            <CheckCircle size={14} />
            <span>
              {isCompleted
                ? 'Mark as Unread'
                : 'Mark as Completed'}
            </span>
          </button>

          <button
            className={styles.menuItem}
            onClick={(e) => handleAction(e, () => onToggleArchive(book.id))}
            role="menuitem"
            type="button"
          >
            <Archive size={14} />
            <span>{book.archived ? 'Unarchive' : 'Archive'}</span>
          </button>

          <button
            className={styles.menuItem}
            onClick={(e) => handleAction(e, () => onExport(book.id))}
            role="menuitem"
            type="button"
          >
            <Download size={14} />
            <span>Export File</span>
          </button>

          <div className={styles.menuDivider} />

          <button
            className={`${styles.menuItem} ${styles.menuItemDanger}`}
            onClick={(e) => handleAction(e, () => onDelete(book))}
            role="menuitem"
            type="button"
          >
            <Trash2 size={14} />
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  );
}

