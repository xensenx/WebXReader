/** Book details and metadata editor. */

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { AlertTriangle, ImagePlus, Link2, RotateCcw, Trash2, Upload } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import type { Book } from '../../types/book';
import { formatDate, formatFileSize } from '../../utils';
import {
  getCoverImageDimensions,
  importCoverFromUrl,
  prepareCoverFile,
  type CoverImageResult,
} from '../../utils/cover-image';
import { DEFAULT_TXT_COVER } from '../../assets/covers/txt-default-cover';
import styles from './BookDetailsDialog.module.css';

interface BookDetailsDialogProps {
  book: Book | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedBook: Book) => Promise<void>;
}

function getImageError(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not load this cover image.';
}

export function BookDetailsDialog({ book, isOpen, onClose, onSave }: BookDetailsDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(book?.title ?? '');
  const [author, setAuthor] = useState(book?.author || '');
  const [description, setDescription] = useState(book?.description || '');
  const [tagsInput, setTagsInput] = useState((book?.userTags || []).join(', '));
  const [coverImage, setCoverImage] = useState(book?.coverImage || (book?.sourceFormat === 'txt' ? DEFAULT_TXT_COVER : ''));
  const [coverUrl, setCoverUrl] = useState('');
  const [coverDimensions, setCoverDimensions] = useState<{ width: number; height: number } | null>(null);
  const [coverNotice, setCoverNotice] = useState('');
  const [coverError, setCoverError] = useState('');
  const [formError, setFormError] = useState('');
  const [coverLoading, setCoverLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!book) return;
    setTitle(book.title);
    setAuthor(book.author || '');
    setDescription(book.description || '');
    setTagsInput((book.userTags || []).join(', '));
    setCoverImage(book.coverImage || (book.sourceFormat === 'txt' ? DEFAULT_TXT_COVER : ''));
    setCoverUrl(/^https?:\/\//i.test(book.coverImage || '') ? book.coverImage || '' : '');
    setCoverDimensions(null);
    setCoverNotice('');
    setCoverError('');
    setFormError('');
    if (fileInputRef.current) fileInputRef.current.value = '';

  }, [book]);

  useEffect(() => {
    if (!coverImage) {
      setCoverDimensions(null);
      return;
    }
    let active = true;
    getCoverImageDimensions(coverImage)
      .then((dimensions) => {
        if (active) setCoverDimensions(dimensions);
      })
      .catch(() => {
        if (active) setCoverDimensions(null);
      });
    return () => {
      active = false;
    };
  }, [coverImage]);

  if (!book) return null;

  const originalCoverImage = book.originalCoverImage !== undefined
    ? book.originalCoverImage
    : (book.sourceFormat === 'txt' ? DEFAULT_TXT_COVER : (book.coverImage ?? null));
  const canResetCover = coverImage !== (originalCoverImage || '');
  const resetLabel = originalCoverImage ? 'Reset to original' : 'Reset to default';

  const applyCover = (result: CoverImageResult) => {
    setCoverImage(result.data);
    setCoverDimensions({ width: result.width, height: result.height });
    setCoverError('');
    setCoverNotice(result.isRemote
      ? 'This host does not allow local importing, so the original image link will be used.'
      : 'A resized copy is ready and will be stored in your library.');
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setCoverLoading(true);
    setCoverError('');
    setCoverNotice('');
    try {
      applyCover(await prepareCoverFile(file));
      setCoverUrl('');
    } catch (error) {
      setCoverError(getImageError(error));
    } finally {
      setCoverLoading(false);
    }
  };

  const handleImportFromUrl = async () => {
    setCoverLoading(true);
    setCoverError('');
    setCoverNotice('');
    try {
      applyCover(await importCoverFromUrl(coverUrl));
    } catch (error) {
      setCoverError(getImageError(error));
    } finally {
      setCoverLoading(false);
    }
  };

  const handleRemoveCover = () => {
    setCoverImage('');
    setCoverUrl('');
    setCoverDimensions(null);
    setCoverNotice('The book will use its title-based placeholder cover.');
    setCoverError('');
  };

  const handleResetCover = () => {
    const original = originalCoverImage || '';
    setCoverImage(original);
    setCoverUrl(/^https?:\/\//i.test(original) ? original : '');
    setCoverDimensions(null);
    setCoverNotice(original
      ? 'The cover from the original import has been restored.'
      : 'This book was imported without a cover, so its title placeholder will be used.');
    setCoverError('');
  };

  const ratio = coverDimensions ? coverDimensions.width / coverDimensions.height : null;
  const needsCropNotice = ratio !== null && (ratio < 0.55 || ratio > 0.85);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const parsedTags = tagsInput
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
      const coverWasChanged = coverImage !== (book.coverImage || '');

      const updated: Book = {
        ...book,
        title: title.trim() || book.title,
        author: author.trim(),
        description: description.trim(),
        coverImage: coverImage || undefined,
        originalCoverImage: book.originalCoverImage === undefined
          ? (coverWasChanged ? (book.coverImage ?? null) : undefined)
          : book.originalCoverImage,
        userTags: parsedTags,
        updatedAt: Date.now(),
      };

      await onSave(updated);
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not save the book changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Details" size="md">
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.topSection}>
          <div className={styles.primaryFields}>
            <div className={styles.field}>
              <label htmlFor="edit-title" className={styles.label}>Title</label>
              <input
                id="edit-title"
                type="text"
                className={styles.input}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="edit-author" className={styles.label}>Author</label>
              <input
                id="edit-author"
                type="text"
                className={styles.input}
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
              />
            </div>

          </div>
        </div>

        <section className={styles.coverSource} aria-label="Choose a cover image">
          <div className={styles.coverEditor}>
            <div className={styles.coverBox}>
              {coverImage ? (
                <img src={coverImage} alt={`Cover for ${title || book.title}`} className={styles.coverImg} />
              ) : (
                <div className={styles.fallbackCover}>
                  <ImagePlus size={24} aria-hidden="true" />
                  <span>{(title || book.title).trim().charAt(0).toUpperCase()}</span>
                </div>
              )}
            </div>

            <div className={styles.coverContent}>
              <div className={styles.coverSourceHeading}>
                <h3 className={styles.sectionTitle}>Book cover</h3>
                <p className={styles.sectionDescription}>Portrait 2:3 works best (about 1200 × 1800 px).</p>
              </div>
              <div className={styles.coverActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  icon={<Upload size={14} />}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={coverLoading}
                >
                  Upload
                </Button>
                {canResetCover && (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    icon={<RotateCcw size={14} />}
                    onClick={handleResetCover}
                    title={resetLabel}
                    aria-label={resetLabel}
                  >
                    {resetLabel}
                  </Button>
                )}
                {coverImage && (
                  <Button variant="ghost" size="sm" type="button" icon={<Trash2 size={14} />} onClick={handleRemoveCover}>
                    Remove
                  </Button>
                )}
              </div>
              <input
                ref={fileInputRef}
                className={styles.fileInput}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                tabIndex={-1}
                aria-label="Choose a cover image from your device"
              />
              <div className={styles.urlRow}>
                <label htmlFor="cover-image-url" className={styles.visuallyHidden}>Direct image URL</label>
                <input
                  id="cover-image-url"
                  type="url"
                  className={styles.input}
                  value={coverUrl}
                  onChange={(event) => setCoverUrl(event.target.value)}
                  placeholder="Paste a direct image URL"
                  autoComplete="url"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  icon={<Link2 size={14} />}
                  loading={coverLoading}
                  disabled={!coverUrl.trim()}
                  onClick={handleImportFromUrl}
                >
                  Use image
                </Button>
              </div>
              <p className={styles.coverHelp}>
                Square or unusually wide or tall images work, but the portrait thumbnail may crop the edges.
              </p>
              {coverDimensions && (
                <p className={styles.dimensions}>
                  Image size: {coverDimensions.width} × {coverDimensions.height} px
                </p>
              )}
            </div>
          </div>
          {needsCropNotice && (
            <div className={styles.coverWarning} role="status">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>This image is outside the recommended portrait shape and will be cropped to fit the library cover.</span>
            </div>
          )}
          {coverNotice && <p className={styles.coverNotice} role="status">{coverNotice}</p>}
          {coverError && <p className={styles.errorMessage} role="alert">{coverError}</p>}
        </section>

        <div className={styles.field}>
          <label htmlFor="edit-description" className={styles.label}>Description / Synopsis</label>
          <textarea
            id="edit-description"
            className={styles.textarea}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add book synopsis or notes…"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="edit-tags" className={styles.label}>Tags (comma separated)</label>
          <input
            id="edit-tags"
            type="text"
            className={styles.input}
            value={tagsInput}
            onChange={(event) => setTagsInput(event.target.value)}
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
            <span>{book.sourceFormat === 'cbz' ? 'Pages:' : 'Chapters:'}</span>
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

        {formError && <p className={styles.errorMessage} role="alert">{formError}</p>}

        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose} type="button">Cancel</Button>
          <Button variant="primary" type="submit" disabled={saving || coverLoading}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
