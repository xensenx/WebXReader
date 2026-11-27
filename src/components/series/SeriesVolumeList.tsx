import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown01 } from 'lucide-react';
import { getVolumeProgress } from '../../features/series/series';
import { getVolumeLabel, sortVolumesByNumber } from '../../features/series/volume-order';
import { saveSeriesScroll } from '../../features/series/use-series-scroll';
import type { LibraryBook } from '../../hooks/useBooks';
import type { BookSeries, LibraryLayout } from '../../types/book';
import { Button } from '../common/Button';
import { BookCard } from '../library/BookCard';
import { BookList } from '../library/BookList';
import { BookReorderPreview } from '../library/BookReorderPreview';
import { LibraryLayoutControls } from '../library/LibraryLayoutControls';
import libraryStyles from '../library/LibraryView.module.css';
import { useBookReorder } from '../library/useBookReorder';
import styles from './SeriesDetail.module.css';

interface SeriesVolumeListProps {
  series: BookSeries;
  volumes: LibraryBook[];
  onReorder: (ids: string[]) => Promise<void>;
}

const layoutPreference = 'webxreader.series-volume-layout';

function readLayout(): LibraryLayout {
  try { return localStorage.getItem(layoutPreference) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
}

export function SeriesVolumeList({ series, volumes, onReorder }: SeriesVolumeListProps) {
  const navigate = useNavigate();
  const [layout, setLayout] = useState(readLayout);
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const books = useMemo(() => {
    if (!pendingOrder) return volumes;
    const byId = new Map(volumes.map((book) => [book.id, book]));
    return pendingOrder.map((id) => byId.get(id)).filter((book): book is LibraryBook => Boolean(book));
  }, [pendingOrder, volumes]);
  function saveOrder(order: string[], successNotice = '') {
    setPendingOrder(order);
    setError('');
    setNotice('');
    void onReorder(order).then(() => setNotice(successNotice)).catch((error: unknown) => {
      setError(error instanceof Error ? error.message : 'Could not save the volume order.');
    }).finally(() => setPendingOrder(null));
  }

  const reorder = useBookReorder({ books, layout, enabled: !pendingOrder && volumes.length > 1, onCommit: saveOrder });

  function sortNumerically() {
    const order = sortVolumesByNumber(books, series);
    if (!order) {
      setNotice('No volume numbers found.');
    } else if (order.every((id, index) => id === books[index].id)) {
      setNotice('Volumes are already in number order.');
    } else {
      saveOrder(order, 'Volumes sorted by number.');
    }
  }

  function changeLayout(value: LibraryLayout) {
    setLayout(value);
    try { localStorage.setItem(layoutPreference, value); } catch { /* Keep the active layout in memory. */ }
  }

  function openVolume(id: string) {
    saveSeriesScroll(series.id);
    navigate('/read/' + id, { state: { fromSeries: series.id } });
  }

  const Item = layout === 'grid' ? BookCard : BookList;

  return (
    <section className={styles.volumes} aria-labelledby="series-volumes-title">
      <div className={styles.volumesHeading}>
        <h2 id="series-volumes-title">Volumes</h2>
        <div className={styles.volumeActions}>
          <Button type="button" size="sm" icon={<ArrowDown01 size={16} />} onClick={sortNumerically}
            disabled={volumes.length < 2 || pendingOrder !== null || Boolean(reorder.draggingBookId)}>Sort by volume number</Button>
          <LibraryLayoutControls layout={layout} onLayoutChange={changeLayout} label="Volume layout" />
        </div>
      </div>
      {error && <p className={styles.orderError} role="alert">{error}</p>}
      {notice && <p className={styles.orderNotice} role="status">{notice}</p>}
      {books.length ? (
        <div {...reorder.pointerHandlers}>
          <div ref={reorder.bookItemsRef} className={layout === 'grid' ? libraryStyles.bookGrid : styles.volumeList} role="feed" aria-label="Series volumes">
            {reorder.orderedBooks.map((book, index) => (
              <Item key={book.id} book={book} progress={getVolumeProgress(book)}
                volumeLabel={getVolumeLabel(series, book, index)}
                onOpen={openVolume} isDragging={reorder.draggingBookId === book.id}
                onPointerDown={(event) => reorder.handleBookPointerDown(book.id, event)}
                shouldSuppressClick={reorder.shouldSuppressBookClick} />
            ))}
          </div>
          <BookReorderPreview preview={reorder.dragPreview} previewRef={reorder.dragPreviewElementRef} />
        </div>
      ) : <p className={styles.empty}>No books in this series.</p>}
    </section>
  );
}
