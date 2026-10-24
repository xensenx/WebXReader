/**
 * TableOfContents drawer for chapter navigation.
 */

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { Chapter } from '../../types/book';
import styles from './TableOfContents.module.css';

interface TableOfContentsProps {
  isOpen: boolean;
  onClose: () => void;
  chapters: Chapter[];
  currentChapterId?: string;
  onSelectChapter: (chapterId: string) => void;
}

export function TableOfContents({
  isOpen,
  onClose,
  chapters,
  currentChapterId,
  onSelectChapter,
}: TableOfContentsProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
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

  // Flatten nested chapters for rendering while preserving level
  const flattenChapters = (list: Chapter[]): { chapter: Chapter; depth: number }[] => {
    const res: { chapter: Chapter; depth: number }[] = [];
    function traverse(items: Chapter[], depth: number) {
      for (const item of items) {
        res.push({ chapter: item, depth });
        if (item.children && item.children.length > 0) {
          traverse(item.children, depth + 1);
        }
      }
    }
    traverse(list, 0);
    return res;
  };

  const flattened = flattenChapters(chapters);

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Table of Contents"
    >
      <div ref={panelRef} className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.title}>Table of Contents</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close table of contents"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <ul className={styles.chapterList}>
          {flattened.length === 0 ? (
            <li className={styles.emptyState}>No chapters available</li>
          ) : (
            flattened.map(({ chapter, depth }) => {
              const isActive = chapter.id === currentChapterId;
              return (
                <li key={chapter.id}>
                  <button
                    className={`${styles.chapterItem} ${
                      isActive ? styles.chapterItemActive : ''
                    }`}
                    style={{ paddingLeft: `${16 + depth * 16}px` }}
                    onClick={() => {
                      onSelectChapter(chapter.id);
                      onClose();
                    }}
                    type="button"
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span>{chapter.title || 'Untitled Chapter'}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
