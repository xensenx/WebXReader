import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { deleteSeriesBatch, listSeries, reorderBooksInSeries, saveSeries } from '../../core/storage/database';
import { createSeriesEntry } from '../../features/series/series-browser';
import { useSeriesScroll } from '../../features/series/use-series-scroll';
import { useBooks, type LibraryBook } from '../../hooks/useBooks';
import type { BookSeries } from '../../types/book';
import { generateId } from '../../utils';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { MainPageHeader } from '../common/MainPageHeader';
import { SeriesBrowser } from './SeriesBrowser';
import { SeriesDetail } from './SeriesDetail';
import { SeriesEditor } from './SeriesEditor';
import styles from './SeriesView.module.css';

export function SeriesView() {
  const navigate = useNavigate();
  const location = useLocation();
  const { seriesId } = useParams<{ seriesId: string }>();
  const { books, loading: booksLoading, error: booksError } = useBooks();
  const [series, setSeries] = useState<BookSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ series: BookSeries; isNew: boolean } | null>(null);
  const [removing, setRemoving] = useState<BookSeries | null>(null);

  useEffect(() => {
    let active = true;
    listSeries().then((items) => {
      if (active) setSeries(items);
    }, () => {
      if (active) setError('Could not load your series.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const booksById = useMemo(() => new Map(books.map((book) => [book.id, book])), [books]);
  const entries = useMemo(() => series.map((item) => createSeriesEntry(item, item.bookIds.map((id) => booksById.get(id))
    .filter((book): book is LibraryBook => Boolean(book)))), [series, booksById]);
  const occupied = useMemo(() => new Map(series.flatMap((item) => item.bookIds.map((id) => [id, item.id] as const))), [series]);
  const waiting = loading || booksLoading;
  const canEdit = !waiting && !booksError;
  const activeEntry = entries.find((item) => item.series.id === seriesId);
  const activeSeries = activeEntry?.series;
  useSeriesScroll(seriesId, !waiting);

  useEffect(() => {
    if (!canEdit || seriesId) return;
    const selection: unknown = location.state?.seriesBookIds;
    if (Array.isArray(selection)) {
      const bookIds = [...new Set(selection.filter((id): id is string => typeof id === 'string' && booksById.has(id) && !occupied.has(id)))];
      setEditor({ series: { id: generateId(), title: '', bookIds }, isNew: true });
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [booksById, canEdit, location.pathname, location.state, navigate, occupied, seriesId]);

  async function save(input: BookSeries) {
    const saved = await saveSeries(editor?.isNew ? { ...input, createdAt: Date.now() } : input);
    setSeries((current) => [...current.filter(({ id }) => id !== saved.id), saved]);
    setEditor(null);
    setError('');
  }

  async function reorder(id: string, bookIds: string[]) {
    const saved = await reorderBooksInSeries(id, bookIds);
    setSeries((current) => current.map((item) => item.id === saved.id ? saved : item));
  }

  async function deleteRows(ids: string[]) {
    await deleteSeriesBatch(ids);
    const removed = new Set(ids);
    setSeries((current) => current.filter(({ id }) => !removed.has(id)));
  }

  async function remove(item: BookSeries) {
    try {
      await deleteRows([item.id]);
      navigate('/series', { replace: true });
    } catch {
      setError('Could not delete the series.');
    }
  }

  return (
    <div className={styles.container}>
      <MainPageHeader />
      <main className={styles.main}>
        {!seriesId && <h1 className={styles.pageTitle}>Series</h1>}
        {(error || booksError) && <p className={styles.error} role="alert">{error || booksError}</p>}
        {!seriesId && (
          <SeriesBrowser entries={waiting ? [] : entries} waiting={waiting} canCreate={canEdit && !error}
            onCreate={() => setEditor({ series: { id: generateId(), title: '', bookIds: [] }, isNew: true })}
            onDelete={deleteRows} />
        )}
        {waiting && <p className={styles.muted} role="status">Loading series...</p>}
        {!waiting && activeEntry && (
          <SeriesDetail series={activeEntry.series} volumes={activeEntry.volumes}
            onEdit={() => setEditor({ series: activeEntry.series, isNew: false })} onRemove={() => setRemoving(activeEntry.series)}
            onReorder={(bookIds) => reorder(activeEntry.series.id, bookIds)} />
        )}
        {!waiting && seriesId && !activeSeries && !error && (
          <section className={styles.empty}>
            <h1>Series unavailable</h1>
            <Link to="/series">All series</Link>
          </section>
        )}
      </main>
      {editor && <SeriesEditor key={editor.series.id} initial={editor.series} isNew={editor.isNew} onClose={() => setEditor(null)} onSave={save}
        options={books.filter((book) => !occupied.has(book.id) || occupied.get(book.id) === editor.series.id)
          .sort((a, b) => a.title.localeCompare(b.title))} />}
      <ConfirmDialog isOpen={Boolean(removing)} onClose={() => setRemoving(null)}
        onConfirm={() => { if (removing) void remove(removing); }} title={`Delete ${removing?.title ?? 'series'}?`}
        message="The books and their reading progress will stay in your library." confirmLabel="Delete series" variant="danger" />
    </div>
  );
}
