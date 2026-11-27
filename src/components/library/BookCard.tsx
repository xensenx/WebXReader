/**
 * BookCard component for grid view in the library.
 */

import { useState, useRef, useEffect, type MouseEvent } from 'react';
import {
  MoreVertical,
  Layers,
  Info,
  Star,
  CheckCircle,
  Archive,
  Download,
  Trash2,
  Clock,
  Check,
} from 'lucide-react';
import type { BookItemProps } from './book-item-props';
import { formatDate } from '../../utils';
import { BookCoverImage } from './BookCoverImage';
import styles from './BookCard.module.css';

export function BookCard({
  book,
  progress,
  onOpen,
  actions,
  volumeLabel,
  selectionMode,
  selected,
  selectionIndex,
  showSourceDetails,
  onToggleSelection,
  isDragging,
  onPointerDown,
  shouldSuppressClick,
}: BookItemProps) {
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

  const handleCardClick = () => {
    if (shouldSuppressClick?.()) return;
    if (selectionMode) {
      onToggleSelection?.(book.id);
      return;
    }
    onOpen(book.id);
  };

  // Determine reading progress percentage if available
  const progressPercent = progress === undefined
    ? book.readingStatus === 'completed' ? 100 : book.readingStatus === 'unread' ? 0 : null
    : Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const isCompleted = book.readingStatus === 'completed';

  return (
    <div
      className={`${styles.card} ${selected ? styles.cardSelected : ''} ${isDragging ? styles.cardDragging : ''} ${showSourceDetails ? styles.sourceDetails : ''}`}
      data-book-id={book.id}
      onPointerDown={onPointerDown}
      onClick={handleCardClick}
      onContextMenu={(e) => e.preventDefault()}
      role={selectionMode ? 'checkbox' : 'button'}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick();
        }
      }}
      aria-label={`${book.title} by ${book.author || 'Unknown'}`}
      aria-checked={selectionMode ? selected : undefined}
      aria-description={selectionIndex === undefined ? undefined : `Selection position ${selectionIndex}`}
    >
      <div className={styles.coverContainer} data-drag-preview>
        <BookCoverImage
          book={book}
          alt=""
          className={styles.coverImage}
          loading="lazy"
          draggable={false}
          placeholder={
            <div className={styles.fallbackCover}>
              <div className={styles.fallbackInitial}>
                {book.title.trim().charAt(0).toUpperCase()}
              </div>
              <span className={styles.fallbackFormat}>{book.sourceFormat}</span>
            </div>
          }
        />

        {selectionMode && (
          <span className={`${styles.selectionIndicator} ${selected ? styles.selectionIndicatorSelected : ''}`} aria-hidden="true">
            {selected && (selectionIndex ?? <Check size={14} />)}
          </span>
        )}

        <div className={`${styles.badges} ${selectionMode ? styles.badgesSelectionMode : ''}`}>
          <span className={styles.formatBadge}>{book.sourceFormat}</span>
          {volumeLabel && <span className={styles.formatBadge}>{volumeLabel}</span>}
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
        {showSourceDetails && book.originalFilename && <p className={styles.filename}>{book.originalFilename}</p>}

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

          {actions && !selectionMode && (
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
        </div>
      </div>

      {actions && menuOpen && !selectionMode && (
        <div ref={menuRef} className={styles.dropdown} role="menu">
          <button
            className={styles.menuItem}
            onClick={(e) => handleAction(e, () => {
              buttonRef.current?.focus();
              actions.onAddToSeries(book.id);
            })}
            role="menuitem"
            type="button"
          >
            <Layers size={14} />
            <span>Add to series</span>
          </button>

          <button
            className={styles.menuItem}
            onClick={(e) => handleAction(e, () => actions.onEdit(book))}
            role="menuitem"
            type="button"
          >
            <Info size={14} />
            <span>Edit Details</span>
          </button>

          <button
            className={styles.menuItem}
            onClick={(e) => handleAction(e, () => actions.onToggleFavorite(book.id))}
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
                actions.onUpdateStatus(
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
            onClick={(e) => handleAction(e, () => actions.onToggleArchive(book.id))}
            role="menuitem"
            type="button"
          >
            <Archive size={14} />
            <span>{book.archived ? 'Unarchive' : 'Archive'}</span>
          </button>

          <button
            className={styles.menuItem}
            onClick={(e) => handleAction(e, () => actions.onExport(book.id))}
            role="menuitem"
            type="button"
          >
            <Download size={14} />
            <span>Export File</span>
          </button>

          <div className={styles.menuDivider} />

          <button
            className={`${styles.menuItem} ${styles.menuItemDanger}`}
            onClick={(e) => handleAction(e, () => actions.onDelete(book))}
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

