/**
 * BookmarkPanel for viewing, adding, and jumping to bookmarks.
 */

import { useEffect, useRef, type MouseEvent } from 'react';
import { X, Bookmark as BookmarkIcon, Plus, Trash2 } from 'lucide-react';
import type { Bookmark } from '../../types/book';
import { formatDate } from '../../utils';
import { Button } from '../common/Button';
import styles from './BookmarkPanel.module.css';

interface BookmarkPanelProps {
  isOpen: boolean;
  onClose: () => void;
  bookmarks: Bookmark[];
  currentChapterId?: string;
  currentPosition?: number;
  onAddBookmark: () => void;
  onRemoveBookmark: (id: string) => void;
  onSelectBookmark: (bookmark: Bookmark) => void;
}

export function BookmarkPanel({
  isOpen,
  onClose,
  bookmarks,
  onAddBookmark,
  onRemoveBookmark,
  onSelectBookmark,
}: BookmarkPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleDelete = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    onRemoveBookmark(id);
  };

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Bookmarks"
    >
      <div ref={panelRef} className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.title}>Bookmarks</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close bookmarks panel"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <div className={styles.addSection}>
          <Button
            variant="primary"
            icon={<Plus size={16} />}
            onClick={onAddBookmark}
            style={{ width: '100%' }}
          >
            Bookmark Current Position
          </Button>
        </div>

        <div className={styles.bookmarkList}>
          {bookmarks.length === 0 ? (
            <div className={styles.emptyState}>
              <BookmarkIcon size={32} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
              <p>No bookmarks yet.</p>
              <p style={{ fontSize: 'var(--text-xs)', opacity: 0.8, marginTop: '4px' }}>
                Save your favorite passages or places you want to return to.
              </p>
            </div>
          ) : (
            bookmarks.map((bm) => (
              <div
                key={bm.id}
                className={styles.bookmarkCard}
                onClick={() => {
                  onSelectBookmark(bm);
                  onClose();
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onSelectBookmark(bm);
                    onClose();
                  }
                }}
              >
                <div className={styles.cardHeader}>
                  <span className={styles.cardTitle}>
                    {bm.label || `Bookmark at ${Math.round((bm.position || 0) * 100)}%`}
                  </span>
                  <button
                    className={styles.deleteButton}
                    onClick={(e) => handleDelete(e, bm.id)}
                    title="Delete bookmark"
                    aria-label="Delete bookmark"
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {bm.selectedText && (
                  <p className={styles.excerpt}>"{bm.selectedText}"</p>
                )}

                <div className={styles.cardFooter}>
                  <span>{formatDate(bm.createdAt)}</span>
                  <span>{Math.round((bm.position || 0) * 100)}%</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
