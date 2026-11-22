import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { summarizeSeries } from '../../features/series/series';
import { saveSeriesScroll } from '../../features/series/use-series-scroll';
import type { LibraryBook } from '../../hooks/useBooks';
import type { BookSeries } from '../../types/book';
import { Button } from '../common/Button';
import { SeriesCover } from './SeriesCover';
import { SeriesProgress } from './SeriesProgress';
import { SeriesVolumeList } from './SeriesVolumeList';
import styles from './SeriesDetail.module.css';

interface SeriesDetailProps {
  series: BookSeries;
  volumes: LibraryBook[];
  onEdit: () => void;
  onRemove: () => void;
  onReorder: (ids: string[]) => Promise<void>;
}

export function SeriesDetail({ series, volumes, onEdit, onRemove, onReorder }: SeriesDetailProps) {
  const { fraction, completed, total } = summarizeSeries(volumes);
  return (
    <>
      <nav className={styles.actions} aria-label="Series navigation">
        <Link to="/series" className={styles.back} onClick={() => saveSeriesScroll(series.id)}>
          <ArrowLeft size={17} aria-hidden="true" /> All series
        </Link>
        <Button type="button" variant="secondary" size="sm" icon={<Pencil size={15} />} onClick={onEdit}>Edit series</Button>
        <Button type="button" variant="ghost" size="sm" icon={<Trash2 size={16} />} aria-label="Delete series" onClick={onRemove} />
      </nav>

      <header className={styles.hero}>
        <SeriesCover customCover={series.coverImage} firstVolume={volumes[0]} decorative className={styles.backdrop} alt="" />
        <div className={styles.heroContent}>
          <SeriesCover customCover={series.coverImage} firstVolume={volumes[0]} className={styles.poster} alt="" />
          <div className={styles.metadata}>
            <h1>{series.title}</h1>
            {series.author && <p className={styles.author}>{series.author}</p>}
            {series.description && <p className={styles.synopsis}>{series.description}</p>}
            {Boolean(series.tags?.length) && (
              <ul className={styles.tags} aria-label="Series tags">
                {series.tags?.map((tag) => <li key={tag}>{tag}</li>)}
              </ul>
            )}
            <div className={styles.progress}>
              <p>{completed} of {total} volumes completed</p>
              <SeriesProgress title={series.title} fraction={fraction} />
            </div>
          </div>
        </div>
      </header>

      <SeriesVolumeList key={series.id} series={series} volumes={volumes} onReorder={onReorder} />
    </>
  );
}
