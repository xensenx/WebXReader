import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Layers, Plus } from 'lucide-react';
import { addBooksToSeries, listSeries } from '../../core/storage/database';
import type { BookSeries } from '../../types/book';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import styles from './AddToSeriesDialog.module.css';

interface AddToSeriesDialogProps {
  bookIds: readonly string[] | null;
  onClose: () => void;
  onCreateSeries: (bookIds: readonly string[]) => void;
  onAdded: (series: BookSeries) => void;
}

export function AddToSeriesDialog({ bookIds, onClose, onCreateSeries, onAdded }: AddToSeriesDialogProps) {
  const [series, setSeries] = useState<BookSeries[] | null>(null);
  const [seriesId, setSeriesId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSeries(null);
    setSeriesId('');
    setError('');
    if (!bookIds) return;
    let active = true;
    listSeries().then((items) => {
      if (active) setSeries(items.sort((left, right) => left.title.localeCompare(right.title)));
    }, () => {
      if (active) setError('Could not load your series.');
    });
    return () => { active = false; };
  }, [bookIds]);

  const membership = useMemo(() => new Map(series?.flatMap((item) =>
    item.bookIds.map((id) => [id, item.id] as const))), [series]);
  const hasConflict = Boolean(bookIds && seriesId && bookIds.some((id) => {
    const current = membership.get(id);
    return current && current !== seriesId;
  }));
  const addCount = bookIds?.filter((id) => !membership.has(id)).length ?? 0;
  const selectedCount = bookIds?.length ?? 0;
  const canAdd = Boolean(seriesId && addCount && !hasConflict && !saving);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAdd || !bookIds) return;
    setSaving(true);
    setError('');
    try {
      const saved = await addBooksToSeries(seriesId, bookIds);
      onAdded(saved);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not add the selected books.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={bookIds !== null} onClose={() => { if (!saving) onClose(); }} title="Add to series" size="sm">
      <form className={styles.form} onSubmit={submit}>
        {series && series.length > 0 && (
          <fieldset className={styles.choices}>
            <legend>Choose a series</legend>
            <div className={styles.list}>
              {series.map((item) => (
                <label className={styles.option} key={item.id}>
                  <Layers size={17} aria-hidden="true" />
                  <span><strong>{item.title}</strong><small>{item.bookIds.length} {item.bookIds.length === 1 ? 'volume' : 'volumes'}</small></span>
                  <input type="radio" name="series-destination" value={item.id} checked={seriesId === item.id} disabled={saving}
                    onChange={() => { setSeriesId(item.id); setError(''); }} />
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {series?.length === 0 && <p className={styles.note}>You haven’t created a series yet.</p>}
        {!series && !error && <p className={styles.note} role="status">Loading series…</p>}
        {hasConflict && <p className={styles.note}>A selected book belongs to another series. Remove it from that series before adding it here.</p>}
        {seriesId && !hasConflict && !addCount && <p className={styles.note}>The selected {selectedCount === 1 ? 'book is' : 'books are'} already in this series.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
          {series && bookIds?.length && addCount === bookIds.length ? (
            <Button type="button" variant={series.length ? 'secondary' : 'primary'} icon={<Plus size={16} />}
              disabled={saving} onClick={() => onCreateSeries(bookIds)}>
              Create series
            </Button>
          ) : null}
          {series?.length !== 0 && (
            <Button type="submit" variant="primary" loading={saving} disabled={!canAdd}>Add to series</Button>
          )}
        </div>
      </form>
    </Modal>
  );
}
