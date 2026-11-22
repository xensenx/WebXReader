import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Search, Upload, X } from 'lucide-react';
import type { Book, BookSeries } from '../../types/book';
import { SERIES_DESCRIPTION_LIMIT, SERIES_TAGS_LIMIT, SERIES_TITLE_LIMIT } from '../../features/series/series';
import { prepareCoverFile } from '../../utils/cover-image';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { SeriesCover } from './SeriesCover';
import styles from './SeriesView.module.css';

interface SeriesEditorProps {
  initial: BookSeries;
  isNew: boolean;
  options: Book[];
  onSave: (series: BookSeries) => Promise<void>;
  onClose: () => void;
}

export function SeriesEditor({ initial, isNew, options, onSave, onClose }: SeriesEditorProps) {
  const [title, setTitle] = useState(initial.title);
  const [author, setAuthor] = useState(initial.author ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [tags, setTags] = useState(initial.tags?.join(', ') ?? '');
  const [coverImage, setCoverImage] = useState(initial.coverImage);
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverError, setCoverError] = useState('');
  const coverInput = useRef<HTMLInputElement>(null);
  const [bookIds, setBookIds] = useState(initial.bookIds);
  const [numbered, setNumbered] = useState(Boolean(initial.volumeNumbers));
  const [numbers, setNumbers] = useState(() => new Map(initial.bookIds.map((id, index) =>
    [id, String(initial.volumeNumbers?.[id] ?? index + 1)])));
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const byId = useMemo(() => new Map(options.map((book) => [book.id, book])), [options]);
  const selected = new Set(bookIds);
  const phrase = query.trim().toLocaleLowerCase();
  const available = options.filter((book) => !selected.has(book.id) &&
    `${book.title} ${book.author}`.toLocaleLowerCase().includes(phrase));
  const firstId = numbered
    ? [...bookIds].sort((a, b) => Number(numbers.get(a)) - Number(numbers.get(b)))[0]
    : bookIds[0];

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

  function addBook(id: string) {
    const highest = bookIds.reduce((max, bookId) => Math.max(max, Number(numbers.get(bookId)) || 0), 0);
    setNumbers((previous) => new Map(previous).set(id, String(highest + 1)));
    setBookIds([...bookIds, id]);
  }

  function moveBook(index: number, offset: number) {
    const next = [...bookIds];
    const target = index + offset;
    [next[index], next[target]] = [next[target], next[index]];
    setBookIds(next);
  }

  function changeOrder(useNumbers: boolean) {
    if (!useNumbers && numbered) {
      setBookIds([...bookIds].sort((left, right) => Number(numbers.get(left)) - Number(numbers.get(right))));
    } else if (useNumbers && !numbered) {
      setNumbers(new Map(bookIds.map((id, index) => [id, String(index + 1)])));
    }
    setNumbered(useNumbers);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || coverLoading) return;
    setSaving(true);
    setError('');
    try {
      const volumeNumbers = numbered ? Object.fromEntries(bookIds.map((id) => {
        const number = numbers.get(id)?.trim();
        return [id, number ? Number(number) : NaN];
      })) : undefined;
      await onSave({ ...initial, title, author, description, tags: tags.split(','), coverImage, bookIds, volumeNumbers });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save the series.');
      setSaving(false);
    }
  }

  return (
    <Modal isOpen onClose={() => { if (!saving && !coverLoading) onClose(); }} title={isNew ? 'Create series' : 'Edit series'} size="lg">
      <form className={styles.editor} onSubmit={submit}>
        <div className={styles.fields}>
          <label>
            Series name
            <input required maxLength={SERIES_TITLE_LIMIT} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            Reading order
            <select value={numbered ? 'numbered' : 'custom'} onChange={(event) => changeOrder(event.target.value === 'numbered')}>
              <option value="custom">Custom order</option>
              <option value="numbered">Volume number</option>
            </select>
          </label>
          <label>
            Author
            <input maxLength={SERIES_TITLE_LIMIT} value={author} onChange={(event) => setAuthor(event.target.value)} />
          </label>
          <label>
            Tags (comma separated)
            <input maxLength={SERIES_TAGS_LIMIT} value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>
          <label className={styles.descriptionField}>
            Synopsis
            <textarea rows={3} maxLength={SERIES_DESCRIPTION_LIMIT} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
        </div>

        <section className={styles.coverEditor} aria-label="Series cover">
          <SeriesCover customCover={coverImage} firstVolume={byId.get(firstId)} className={styles.coverPreview} alt="Series cover preview" />
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

        <div className={styles.editorLists}>
          <section aria-label="Available books">
            <h3>Add books</h3>
            <label className={styles.search}>
              <Search size={16} aria-hidden="true" />
              <input type="search" aria-label="Search available books" placeholder="Search by title or author" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <ul className={styles.editorList}>
              {available.map((book) => (
                <li key={book.id}>
                  <button type="button" className={styles.addBook} aria-label={`Add ${book.title}`} onClick={() => addBook(book.id)}>
                    <span><strong>{book.title}</strong><small>{book.author}</small></span>
                    <Plus size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
              {!available.length && <li className={styles.muted}>{phrase ? 'No matching books.' : 'No books available to add.'}</li>}
            </ul>
          </section>
          <section aria-label="Selected books">
            <h3>In this series ({bookIds.length})</h3>
            <ol className={styles.editorList}>
              {bookIds.map((id, index) => {
                const title = byId.get(id)?.title ?? 'Unavailable book';
                return (
                  <li key={id} className={styles.editVolume}>
                    {numbered ? (
                      <input className={styles.volumeNumber} type="number" step="any" min="0" required
                        aria-label={`Volume number for ${title}`} value={numbers.get(id) ?? ''}
                        onChange={(event) => setNumbers(new Map(numbers).set(id, event.target.value))} />
                    ) : <span className={styles.index}>{index + 1}</span>}
                    <span className={styles.volumeTitle}>{title}</span>
                    {!numbered && (
                      <div className={styles.orderControls}>
                        <Button type="button" variant="ghost" size="sm" icon={<ArrowUp size={14} />} aria-label={`Move ${title} up`}
                          onClick={() => moveBook(index, -1)} disabled={!index} />
                        <Button type="button" variant="ghost" size="sm" icon={<ArrowDown size={14} />} aria-label={`Move ${title} down`}
                          onClick={() => moveBook(index, 1)} disabled={index === bookIds.length - 1} />
                      </div>
                    )}
                    <Button type="button" variant="ghost" size="sm" icon={<X size={16} />} aria-label={`Remove ${title}`}
                      onClick={() => setBookIds(bookIds.filter((bookId) => bookId !== id))} />
                  </li>
                );
              })}
              {!bookIds.length && <li className={styles.muted}>Choose books to set your reading order.</li>}
            </ol>
          </section>
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          <Button type="button" onClick={onClose} disabled={coverLoading || saving}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={coverLoading}>{isNew ? 'Create series' : 'Save changes'}</Button>
        </div>
      </form>
    </Modal>
  );
}
