import { useId, useState, type FormEvent } from 'react';
import { GIGABYTE, MEGABYTE, normalizeStorageLimit } from '../../core/storage/storage-limits';
import { useSettingsContext } from '../../app/providers/useSettingsContext';
import { FORMAT_IMPORT_LIMITS } from '../../formats/import-limits';
import { Button } from '../common/Button';
import styles from './SettingsView.module.css';

const units = { MB: MEGABYTE, GB: GIGABYTE } as const;
type Unit = keyof typeof units;
type LimitDraft = { amount: string; unit: Unit };

function limitDraft(bytes: number | null | undefined, defaultUnit: Unit): LimitDraft {
  const unit = bytes == null ? defaultUnit : bytes >= GIGABYTE ? 'GB' : 'MB';
  return { amount: bytes == null ? '' : String(bytes / units[unit]), unit };
}

function draftBytes({ amount, unit }: LimitDraft) {
  if (!amount) return null;
  return normalizeStorageLimit(Math.round(Number(amount) * units[unit])) ?? undefined;
}

function LimitInput({ label, hint, draft, change }: {
  label: string;
  hint: string;
  draft: LimitDraft;
  change: (draft: LimitDraft) => void;
}) {
  const id = useId();
  return (
    <div className={styles.row}>
      <div className={styles.rowCol}>
        <label className={styles.rowLabel} htmlFor={id}>{label}</label>
        <span className={styles.rowDesc} id={`${id}-hint`}>{hint}</span>
      </div>
      <div className={styles.numberField}>
        <input id={id} type="number" inputMode="decimal" min={0} step="any"
          aria-describedby={`${id}-hint`} placeholder="No limit" value={draft.amount}
          onChange={(event) => change({ ...draft, amount: event.target.value })} />
        <select aria-label={`${label} unit`} value={draft.unit} onChange={(event) => change({
          ...draft, unit: event.target.value === 'GB' ? 'GB' : 'MB',
        })}>
          <option>MB</option>
          <option>GB</option>
        </select>
      </div>
    </div>
  );
}

export function StorageLimitFields() {
  const { settings, updateSettings } = useSettingsContext();
  const [fileDraft, setFileDraft] = useState<LimitDraft | null>(null);
  const [libraryDraft, setLibraryDraft] = useState<LimitDraft | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const file = fileDraft ?? limitDraft(settings.importFileLimitBytes, 'MB');
  const library = libraryDraft ?? limitDraft(settings.librarySizeLimitBytes, 'GB');
  const importFileLimitBytes = draftBytes(file);
  const librarySizeLimitBytes = draftBytes(library);
  const invalid = importFileLimitBytes === undefined || librarySizeLimitBytes === undefined;
  const changed = importFileLimitBytes !== settings.importFileLimitBytes || librarySizeLimitBytes !== settings.librarySizeLimitBytes;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (invalid || state === 'saving') return;
    setState('saving');
    try {
      await updateSettings({ importFileLimitBytes, librarySizeLimitBytes });
      setFileDraft(null);
      setLibraryDraft(null);
      setState('saved');
    } catch {
      setState('failed');
    }
  }

  return (
    <form className={styles.storageLimits} onSubmit={save}>
      <fieldset disabled={state === 'saving'}>
        <legend className={styles.rowLabel}>Storage limits</legend>
        <LimitInput label="Per-file limit" hint="Leave blank to use each format’s maximum." draft={file}
          change={(next) => { setFileDraft(next); setState('idle'); }} />
        <LimitInput label="Total library limit" hint="Applies to new imports and backup restores. Leave blank for no library limit." draft={library}
          change={(next) => { setLibraryDraft(next); setState('idle'); }} />
        <div className={styles.row}>
          <span className={invalid || state === 'failed' ? styles.libraryNameError : styles.rowDesc} role="status">
            {invalid ? 'Enter a positive size or leave the field blank.' :
              state === 'saved' ? 'Storage limits saved.' : state === 'failed' ? 'Could not save storage limits. Try again.' : ''}
          </span>
          <Button type="submit" size="sm" disabled={invalid || (!changed && state !== 'failed')} loading={state === 'saving'}>Save limits</Button>
        </div>
      </fieldset>
      <details className={styles.formatLimits}>
        <summary>Maximum file sizes by format</summary>
        <dl>
          {FORMAT_IMPORT_LIMITS.map(({ label, megabytes }) => (
            <div className={styles.row} key={label}><dt>{label}</dt><dd>{megabytes} MB</dd></div>
          ))}
        </dl>
      </details>
    </form>
  );
}
