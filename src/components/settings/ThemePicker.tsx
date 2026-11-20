import { useId } from 'react';
import { Check } from 'lucide-react';
import { APP_THEME_OPTIONS, type ThemeName } from '../../types/book';
import styles from './ThemePicker.module.css';

interface ThemePickerProps {
  theme: ThemeName;
  onChange: (theme: ThemeName) => void;
}

export function ThemePicker({ theme, onChange }: ThemePickerProps) {
  const groupName = useId();

  return (
    <fieldset className={styles.picker}>
      <legend>Application Theme</legend>
      <div className={styles.grid}>
        {APP_THEME_OPTIONS.map(({ value, label }) => (
          <label key={value} className={styles.option}>
            <input
              className={styles.radio}
              type="radio"
              name={groupName}
              value={value}
              checked={theme === value}
              onChange={() => onChange(value)}
            />
            <span className={styles.preview} data-theme={value} aria-hidden="true">
              <span className={styles.previewHeader}>
                <span className={styles.previewBrand} />
                <span className={styles.previewSearch} />
              </span>
              <span className={styles.previewLibrary}>
                <span className={styles.previewTitle} />
                <span className={styles.previewBooks}><span /><span /><span /></span>
              </span>
            </span>
            <span className={styles.caption}>
              <span>{label}</span>
              <span className={styles.indicator} aria-hidden="true">
                {theme === value && <Check size={12} strokeWidth={2.5} />}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
