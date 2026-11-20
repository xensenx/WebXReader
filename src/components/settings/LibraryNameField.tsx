import { useId, useState, type FormEvent } from 'react';
import { LIBRARY_NAME_LIMIT, libraryNameCharacters } from '../../features/library/library-name';
import { Button } from '../common/Button';
import styles from './SettingsView.module.css';

interface LibraryNameFieldProps {
  value: string;
  onSave: (value: string) => Promise<void>;
}

export function LibraryNameField({ value, onSave }: LibraryNameFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const inputValue = draft ?? value;
  const name = inputValue.trim();
  const length = libraryNameCharacters(name).length;
  const tooLong = length > LIBRARY_NAME_LIMIT;

  // The settings value updates optimistically, so a failed save can still match it.
  const canSave = !saving && !tooLong && (name !== value || saveFailed);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await onSave(name);
      setDraft(null);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.libraryNameForm} onSubmit={handleSubmit}>
      <div className={styles.rowCol}>
        <label className={styles.rowLabel} htmlFor={id}>Name your library</label>
        <p className={styles.rowDesc} id={`${id}-hint`}>Shown at the top of your library. Leave it blank to hide it.</p>
      </div>
      <div className={styles.libraryNameControls}>
        <input
          id={id}
          className={styles.libraryNameInput}
          type="text"
          value={inputValue}
          dir="auto"
          autoComplete="off"
          readOnly={saving}
          aria-invalid={tooLong || undefined}
          aria-describedby={`${id}-hint ${id}-count`}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" disabled={!canSave}>Save name</Button>
      </div>
      <p className={tooLong ? styles.libraryNameError : styles.rowDesc} id={`${id}-count`} aria-live="polite">
        {length}/{LIBRARY_NAME_LIMIT} characters{tooLong ? '. Shorten the name to save it.' : ''}
      </p>
      {saveFailed && <p className={styles.libraryNameError} role="alert">Could not save the library name. Please try again.</p>}
    </form>
  );
}
