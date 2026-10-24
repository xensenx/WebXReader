/**
 * BookDetailsDialog for inspecting and editing book metadata.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import type { Book } from '../../types/book';
import { formatDate, formatFileSize } from '../../utils';
import styles from './BookDetailsDialog.module.css';

interface BookDetailsDialogProps {
  book: Book | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedBook: Book) => Promise<void>;
}

export function BookDetailsDialog({
  book,
  isOpen,
  onClose,
  onSave,
}: BookDetailsDialogProps) {
  const [title, setTitle] = useState(book?.title ?? '');
  const [author, setAuthor] = useState(book?.author || '');
  const [description, setDescription] = useState(book?.description || '');
  const [tagsInput, setTagsInput] = useState((book?.userTags || []).join(', '));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!book) return;
    setTitle(book.title);
    setAuthor(book.author || '');
    setDescription(book.description || '');
    setTagsInput((book.userTags || []).join(', '));
  }, [book]);

  if (!book) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const parsedTags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const updated: Book = {
        ...book,
        title: title.trim() || book.title,
        author: author.trim(),
        description: description.trim(),
        userTags: parsedTags,
        updatedAt: Date.now(),
      };

      await onSave(updated);
      onClose();
    } catch (err) {
      console.error('Failed to save book details:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Book Details & Metadata" size="md">
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.topSection}>
          <div className={styles.coverBox}>
            {book.coverImage ? (
              <img src={book.coverImage} alt="" className={styles.coverImg} />
            ) : (
              <div className={styles.fallbackCover}>
                {book.title.trim().charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          <div className={styles.primaryFields}>
            <div className={styles.field}>
              <label htmlFor="edit-title" className={styles.label}>
                Title
              </label>
              <input
                id="edit-title"
                type="text"
                className={styles.input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="edit-author" className={styles.label}>
                Author
              </label>
              <input
                id="edit-author"
                type="text"
                className={styles.input}
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor="edit-description" className={styles.label}>
            Description / Synopsis
          </label>
          <textarea
            id="edit-description"
            className={styles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add book synopsis or notes…"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="edit-tags" className={styles.label}>
            Tags (comma separated)
          </label>
          <input
            id="edit-tags"
            type="text"
            className={styles.input}
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="fantasy, web novel, favorites"
          />
        </div>

        <div className={styles.infoGrid}>
          <div className={styles.infoItem}>
            <span>Format:</span>
            <span className={styles.infoValue}>{book.sourceFormat.toUpperCase()}</span>
          </div>
          <div className={styles.infoItem}>
            <span>File Size:</span>
            <span className={styles.infoValue}>{formatFileSize(book.fileSize)}</span>
          </div>
          <div className={styles.infoItem}>
            <span>Chapters:</span>
            <span className={styles.infoValue}>{book.totalChapters}</span>
          </div>
          <div className={styles.infoItem}>
            <span>Imported:</span>
            <span className={styles.infoValue}>{formatDate(book.importedAt)}</span>
          </div>
          <div className={styles.infoItem}>
            <span>Status:</span>
            <span className={styles.infoValue}>{book.readingStatus}</span>
          </div>
          {book.lastOpenedAt && (
            <div className={styles.infoItem}>
              <span>Last Read:</span>
              <span className={styles.infoValue}>{formatDate(book.lastOpenedAt)}</span>
            </div>
          )}
        </div>

        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
