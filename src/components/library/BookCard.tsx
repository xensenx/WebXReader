/**
 * BookCard component for grid view in the library.
 */

import { useState, useRef, useEffect, type MouseEvent } from 'react';
import {
  MoreVertical,
  BookOpen,
  Info,
  Star,
  CheckCircle,
  Archive,
  Download,
  Trash2,
  Clock,
} from 'lucide-react';
import type { Book, ReadingStatus } from '../../types/book';
import { formatDate } from '../../utils';
import styles from './BookCard.module.css';

interface BookCardProps {
  book: Book;
  progress?: number;
  onOpen: (id: string) => void;
  onEdit: (book: Book) => void;
  onToggleFavorite: (id: string) => void;
  onUpdateStatus: (id: string, status: ReadingStatus) => void;
  onToggleArchive: (id: string) => void;
  onExport: (id: string) => void;
  onDelete: (book: Book) => void;
}

export function BookCard({
  book,
  progress,
  onOpen,
  onEdit,
  onToggleFavorite,
  onUpdateStatus,
  onToggleArchive,
  onExport,
  onDelete,
}: BookCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close menu when clicking outside
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

  const handleMenuClick = (e: MouseEvent) => {
    e.stopPropagation();
    setMenuOpen((prev) => !prev);
  };

  const handleAction = (e: MouseEvent, action: () => void) => {
    e.stopPropagation();
    setMenuOpen(false);
    action();
  };

  // Determine reading progress percentage if available
  const progressPercent = progress === undefined
    ? book.readingStatus === 'completed' ? 100 : book.readingStatus === 'unread' ? 0 : null
    : Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <div
      className={styles.card}
      onClick={() => onOpen(book.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(book.id);
        }
      }}
      aria-label={`${book.title} by ${book.author || 'Unknown'}`}
    >
      <div className={styles.coverContainer}>
        {book.coverImage ? (
          <img
            src={book.coverImage}
            alt=""
            className={styles.coverImage}
            loading="lazy"
          />
        ) : (
          <div className={styles.fallbackCover}>
            <div className={styles.fallbackInitial}>
              {book.title.trim().charAt(0).toUpperCase()}
            </div>
            <span className={styles.fallbackFormat}>{book.sourceFormat}</span>
          </div>
        )}

        <div className={styles.badges}>
          <span className={styles.formatBadge}>{book.sourceFormat}</span>
        </div>

        {book.favorite && (
          <div className={styles.favoriteBadge} title="Favorite">
            <Star size={14} fill="#f59e0b" />
          </div>
        )}

        {progressPercent !== null && (
          <div className={styles.progressBarContainer}>
            <div
              className={styles.progressBarFill}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>

      <div className={styles.content}>
        <h4 className={styles.title} title={book.title}>
          {book.title}
        </h4>
        <p className={styles.author} title={book.author || 'Unknown Author'}>
          {book.author || 'Unknown Author'}
        </p>

        <div className={styles.footer}>
          <div className={styles.metaInfo}>
            {book.lastOpenedAt ? (
              <>
                <Clock size={12} />
                <span>{formatDate(book.lastOpenedAt)}</span>
              </>
            ) : (
              <span>{book.readingStatus}</span>
            )}
          </div>
          {progressPercent !== null && progressPercent > 0 && progressPercent < 100 && (
            <span className={styles.progressLabel}>{progressPercent}%</span>
          )}

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
        </div>
      </div>

      {menuOpen && (
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
            <span>Details</span>
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
                  book.readingStatus === 'completed' ? 'unread' : 'completed'
                )
              )
            }
            role="menuitem"
            type="button"
          >
            <CheckCircle size={14} />
            <span>
              {book.readingStatus === 'completed'
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
