import { LayoutGrid, List } from 'lucide-react';
import type { LibraryLayout } from '../../types/book';
import styles from './LibraryToolbar.module.css';

export function LibraryLayoutControls({ layout, onLayoutChange, label = 'Library layout' }: {
  layout: LibraryLayout;
  onLayoutChange: (layout: LibraryLayout) => void;
  label?: string;
}) {
  return (
    <div className={styles.viewGroup} role="group" aria-label={label}>
      <button
        className={styles.viewButton}
        onClick={() => onLayoutChange('grid')}
        title="Grid view"
        aria-label="Grid view"
        aria-pressed={layout === 'grid'}
        type="button"
      >
        <LayoutGrid size={16} />
      </button>
      <button
        className={styles.viewButton}
        onClick={() => onLayoutChange('list')}
        title="List view"
        aria-label="List view"
        aria-pressed={layout === 'list'}
        type="button"
      >
        <List size={16} />
      </button>
    </div>
  );
}
