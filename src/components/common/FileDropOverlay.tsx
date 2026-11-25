import { Upload } from 'lucide-react';
import styles from './FileDropOverlay.module.css';

export function FileDropOverlay() {
  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <Upload size={48} aria-hidden="true" />
        <span>Drop book, comic, or image to import</span>
      </div>
    </div>
  );
}
