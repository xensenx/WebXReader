import type { RefObject } from 'react';
import { BookCoverImage } from './BookCoverImage';
import type { BookDragPreview } from './useBookReorder';
import styles from './LibraryView.module.css';

export function BookReorderPreview({ preview, previewRef }: {
  preview: BookDragPreview | null;
  previewRef: RefObject<HTMLDivElement | null>;
}) {
  if (!preview) return null;
  return (
    <div
      ref={previewRef}
      className={styles.bookDragPreview}
      style={{
        width: `${preview.width}px`,
        height: `${preview.height}px`,
        transform: `translate3d(${preview.left}px, ${preview.top}px, 0)`,
      }}
      aria-hidden="true"
    >
      <BookCoverImage
        book={preview.book}
        alt="" className={styles.bookDragPreviewImage} draggable={false}
        placeholder={
          <div className={styles.bookDragPreviewFallback}>
            <span>{preview.book.title.trim().charAt(0).toUpperCase()}</span>
            {preview.width > 72 && <small>{preview.book.sourceFormat.toUpperCase()}</small>}
          </div>
        }
      />
    </div>
  );
}
