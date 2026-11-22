import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Check, GripVertical, Layers, SearchX, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DEFAULT_SERIES_FILTERS, filterSeries, readSeriesBrowserState, saveSeriesBrowserState, sortSeries,
  type SeriesBrowserState, type SeriesEntry } from '../../features/series/series-browser';
import { getSeriesPath } from '../../features/series/series';
import { saveSeriesScroll } from '../../features/series/use-series-scroll';
import { Button } from '../common/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { SeriesCover } from './SeriesCover';
import { SeriesProgress } from './SeriesProgress';
import { SeriesToolbar } from './SeriesToolbar';
import styles from './SeriesView.module.css';

interface SeriesBrowserProps {
  entries: SeriesEntry[];
  waiting: boolean;
  canCreate: boolean;
  onCreate: () => void;
  onDelete: (ids: string[]) => Promise<void>;
}

export function SeriesBrowser({ entries, waiting, canCreate, onCreate, onDelete }: SeriesBrowserProps) {
  const [state, setState] = useState(readSeriesBrowserState);
  const [selectionMode, setSelectionMode] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const draggedSeries = useRef<string | null>(null);
  const { query, filters, sortField, sortDirection, customOrder } = state;
  const visible = useMemo(() => sortSeries(filterSeries(entries, filters, query), sortField, sortDirection, customOrder),
    [entries, filters, query, sortField, sortDirection, customOrder]);
  const allVisibleSelected = visible.length > 0 && visible.every(({ series }) => selected.has(series.id));
  const reordering = reorderMode && sortField === 'custom';

  useEffect(() => { saveSeriesBrowserState(state); }, [state]);

  function update(patch: Partial<SeriesBrowserState>) {
    if (patch.sortField && patch.sortField !== 'custom') setReorderMode(false);
    setState((previous) => ({ ...previous, ...patch }));
  }

  function toggleSelection(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVisibleSelection() {
    const next = new Set(selected);
    for (const { series } of visible) {
      if (allVisibleSelected) next.delete(series.id);
      else next.add(series.id);
    }
    setSelected(next);
  }

  function move(id: string, targetId: string) {
    const visibleIds = visible.map(({ series }) => series.id);
    const from = visibleIds.indexOf(id);
    const to = visibleIds.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    const visibleSet = new Set(visibleIds);
    visibleIds.splice(from, 1);
    visibleIds.splice(to, 0, id);
    if (sortDirection === 'desc') visibleIds.reverse();
    const order = sortSeries(entries, 'custom', 'asc', customOrder).map(({ series }) => series.id);
    let slot = 0;
    update({ customOrder: order.map((id) => visibleSet.has(id) ? visibleIds[slot++] : id) });
  }

  async function removeSelected() {
    setDeleting(true);
    setError('');
    try {
      await onDelete([...selected]);
      update({ customOrder: customOrder.filter((id) => !selected.has(id)) });
      setSelected(new Set());
    } catch {
      setError('Could not delete the selected series.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <SeriesToolbar entries={entries} state={state} onChange={update} count={visible.length} canCreate={canCreate} onCreate={onCreate}
        selectionMode={selectionMode} onSelect={() => { setSelectionMode(!selectionMode); setReorderMode(false); setSelected(new Set()); }}
        reorderMode={reordering} onReorder={() => { setReorderMode(!reordering); setSelectionMode(false); setSelected(new Set()); }} />
      {selectionMode && (
        <div className={styles.selectionBar} role="toolbar" aria-label="Selected series actions">
          <strong aria-live="polite">{selected.size} selected</strong>
          <Button size="sm" type="button" onClick={toggleVisibleSelection} disabled={!visible.length}>
            {allVisibleSelected ? 'Deselect visible' : 'Select visible'}
          </Button>
          <Button size="sm" type="button" variant="danger" icon={<Trash2 size={14} />} disabled={!selected.size || deleting}
            onClick={() => setConfirmDelete(true)}>Delete</Button>
          <Button size="sm" type="button" variant="ghost" disabled={!selected.size || deleting} onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {!waiting && entries.length > 0 && !visible.length && (
        <section className={styles.empty}>
          <SearchX size={26} aria-hidden="true" />
          <h2>No matching series</h2>
          <Button type="button" size="sm" onClick={() => update({ query: '', filters: DEFAULT_SERIES_FILTERS })}>Clear search and filters</Button>
        </section>
      )}
      {!waiting && !entries.length && canCreate && (
        <section className={styles.empty}>
          <Layers size={26} aria-hidden="true" />
          <h2>No series yet</h2>
          <p>Group books from your library and read them in order.</p>
        </section>
      )}
      {visible.length > 0 && (
        <section className={styles.rows} aria-label="Your series">
          {visible.map(({ series, volumes, progress }, index) => {
            const checked = selected.has(series.id);
            const content = (
              <>
                <SeriesCover customCover={series.coverImage} firstVolume={volumes[0]} className={styles.cardCover} alt="" loading="lazy" decoding="async" draggable={false} />
                <div className={styles.cardInfo}>
                  <h2>{series.title}</h2>
                  <span>{volumes.length} {volumes.length === 1 ? 'volume' : 'volumes'}{series.author && ` · ${series.author}`}</span>
                </div>
                <div className={styles.cardProgress}><SeriesProgress title={series.title} fraction={progress} /></div>
              </>
            );
            return (
              <article className={styles.seriesCard} key={series.id} data-selected={checked || undefined}
                onDragOver={reordering ? (event) => { if (draggedSeries.current) event.preventDefault(); } : undefined}
                onDrop={reordering ? (event) => {
                  if (draggedSeries.current === null) return;
                  event.preventDefault();
                  move(draggedSeries.current, series.id);
                  draggedSeries.current = null;
                } : undefined}>
                {selectionMode ? (
                  <button type="button" role="checkbox" aria-label={series.title} aria-checked={checked} className={styles.cardLink}
                    onClick={() => toggleSelection(series.id)}>{content}<span className={styles.selectionMark}>{checked && <Check size={14} />}</span></button>
                ) : (
                  <Link className={styles.cardLink} to={getSeriesPath(series.id)} onClick={() => saveSeriesScroll()}>
                    {content}{!reordering && <ArrowRight size={17} className={styles.cardArrow} aria-hidden="true" />}
                  </Link>
                )}
                {reordering && (
                  <div className={styles.reorderControls}>
                    <span className={styles.dragHandle} draggable aria-hidden="true" title="Drag to reorder"
                      onDragStart={(event) => {
                        draggedSeries.current = series.id;
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', series.id);
                      }} onDragEnd={() => { draggedSeries.current = null; }}><GripVertical size={16} /></span>
                    <Button size="sm" variant="ghost" type="button" icon={<ArrowUp size={16} />} aria-label={`Move ${series.title} up`}
                      disabled={index === 0} onClick={() => move(series.id, visible[index - 1].series.id)} />
                    <Button size="sm" variant="ghost" type="button" icon={<ArrowDown size={16} />} aria-label={`Move ${series.title} down`}
                      disabled={index === visible.length - 1} onClick={() => move(series.id, visible[index + 1].series.id)} />
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}
      <ConfirmDialog isOpen={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => { void removeSelected(); }}
        title={`Delete ${selected.size} series?`}
        message="The books and their reading progress will stay in your library." confirmLabel="Delete" variant="danger" />
    </>
  );
}
