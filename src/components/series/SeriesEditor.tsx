import { useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { RotateCcw, Upload } from 'lucide-react';
import type { BookSeries } from '../../types/book';
import type { LibraryBook } from '../../hooks/useBooks';
import { useSettingsContext } from '../../app/providers/useSettingsContext';
import { SERIES_DESCRIPTION_LIMIT, SERIES_TAGS_LIMIT, SERIES_TITLE_LIMIT } from '../../features/series/series';
import { suggestSeriesMetadata } from '../../features/series/series-metadata';
import { prepareCoverFile } from '../../utils/cover-image';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { SeriesBookPicker } from './SeriesBookPicker';
import { SeriesCover } from './SeriesCover';
import styles from './SeriesView.module.css';

interface SeriesEditorProps {
  initial: BookSeries;
  isNew: boolean;
  options: LibraryBook[];
  onSave: (series: BookSeries) => Promise<void>;
  onClose: () => void;
}

export function SeriesEditor({ initial, isNew, options, onSave, onClose }: SeriesEditorProps) {
  const { settings } = useSettingsContext();
  const [titleOverride, setTitle] = useState(isNew ? null : initial.title);
  const [authorOverride, setAuthor] = useState(isNew ? null : initial.author ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [tagsOverride, setTags] = useState(isNew ? null : initial.tags?.join(', ') ?? '');
  const [coverImage, setCoverImage] = useState(initial.coverImage);
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverError, setCoverError] = useState('');
  const coverInput = useRef<HTMLInputElement>(null);
  const [bookIds, setBookIds] = useState(initial.bookIds);
  const [stage, setStage] = useState<'start' | 'picker' | 'details'>(isNew && !initial.bookIds.length ? 'start' : 'details');
  const selectButton = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const focusSelection = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const byId = useMemo(() => new Map(options.map((book) => [book.id, book])), [options]);
  const suggested = useMemo(() => {
    if (!isNew) return null;
    return suggestSeriesMetadata(bookIds.flatMap((id) => {
      const book = byId.get(id);
      return book ? [book] : [];
    }));
  }, [bookIds, byId, isNew]);
  const title = titleOverride ?? suggested?.title ?? '';
  const author = authorOverride ?? suggested?.author ?? '';
  const tags = tagsOverride ?? suggested?.tags ?? '';

  useLayoutEffect(() => {
    if (stage === 'picker') return;
    if (stage === 'start' || focusSelection.current) {
      focusSelection.current = false;
      selectButton.current?.focus();
    } else if (isNew) {
      nameInput.current?.focus();
    }
  }, [stage, isNew]);

  async function uploadCover(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setCoverLoading(true);
    setCoverError('');
    try {
      setCoverImage((await prepareCoverFile(file)).data);
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : 'Could not load this cover image.');
    } finally {
      setCoverLoading(false);
    }
  }

  function cancelPicker() {
    focusSelection.current = true;
    setStage(isNew && !bookIds.length ? 'start' : 'details');
  }

  function applySelection(ids: string[]) {
    setBookIds(ids);
    focusSelection.current = !isNew;
    setStage('details');
  }

  function closeModal() {
    if (stage === 'picker') cancelPicker();
    else if (!saving && !coverLoading) onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || coverLoading || (isNew && !bookIds.length)) return;
    setSaving(true);
    setError('');
    try {
      await onSave({ ...initial, title, author, description, tags: tags.split(','), coverImage, bookIds,
        ...(initial.volumeNumbers && { volumeOrder: 'custom' }) });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save the series.');
      setSaving(false);
    }
  }

  return (
    <Modal isOpen onClose={closeModal} title={stage === 'picker' ? 'Select books' : isNew ? 'Create series' : 'Edit series'}
      size={stage === 'picker' ? 'xl' : stage === 'start' ? 'sm' : 'lg'}>
      {stage === 'start' && (
        <div className={styles.selectionStart}>
          <p>Books stay in the order you select them. You can rearrange them later.</p>
          <Button ref={selectButton} type="button" variant="primary" onClick={() => setStage('picker')}>Select</Button>
        </div>
      )}
      {stage === 'picker' && (
        <SeriesBookPicker books={options} selectedIds={bookIds} initialLayout={settings.libraryLayout}
          requireSelection={isNew} onApply={applySelection} onCancel={cancelPicker} />
      )}
      {stage === 'details' && (
        <form className={styles.editor} onSubmit={submit}>
          <section className={styles.bookSelection} aria-label="Series books">
            <div>
              <h3>Books</h3>
              <p>{bookIds.length} selected</p>
            </div>
            <Button ref={selectButton} type="button" disabled={saving || coverLoading} onClick={() => setStage('picker')}>Select</Button>
          </section>
          <div className={styles.fields}>
            <label className={styles.nameField}>
              Series name
              <input ref={nameInput} required maxLength={SERIES_TITLE_LIMIT} value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              Author
              <input maxLength={SERIES_TITLE_LIMIT} value={author} onChange={(event) => setAuthor(event.target.value)} />
            </label>
            <label>
              Tags (comma separated)
              <input maxLength={SERIES_TAGS_LIMIT} value={tags} onChange={(event) => setTags(event.target.value)} />
            </label>
            <label>
              Synopsis
              <textarea rows={2} maxLength={SERIES_DESCRIPTION_LIMIT} value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
            <section className={styles.coverEditor} aria-label="Series cover">
              <SeriesCover customCover={coverImage} firstVolume={byId.get(bookIds[0])} className={styles.coverPreview} alt="Series cover preview" />
              <div>
                <h3>Series cover</h3>
                <p>{coverImage ? 'Custom cover' : 'Uses the first volume’s cover.'}</p>
                <div className={styles.coverActions}>
                  <Button type="button" size="sm" icon={<Upload size={14} />} loading={coverLoading} disabled={saving}
                    onClick={() => coverInput.current?.click()}>Upload</Button>
                  {coverImage && (
                    <Button type="button" variant="ghost" size="sm" icon={<RotateCcw size={14} />} disabled={coverLoading || saving}
                      onClick={() => { setCoverImage(undefined); setCoverError(''); }}>Use first volume cover</Button>
                  )}
                </div>
                <input type="file" accept="image/*" hidden ref={coverInput} aria-label="Choose a series cover image from your device" onChange={uploadCover} />
                {coverError && <p className={styles.error} role="alert">{coverError}</p>}
              </div>
            </section>
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.actions}>
            <Button type="button" onClick={onClose} disabled={coverLoading || saving}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving} disabled={coverLoading}>{isNew ? 'Create series' : 'Save changes'}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
