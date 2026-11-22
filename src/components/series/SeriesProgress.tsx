import styles from './SeriesView.module.css';

export function SeriesProgress({ title, fraction }: { title: string; fraction: number }) {
  return (
    <div className={styles.seriesProgress}>
      <progress max={1} value={fraction} aria-label={`${title} series progress`} />
      <strong>{Math.round(fraction * 100)}%</strong>
    </div>
  );
}
