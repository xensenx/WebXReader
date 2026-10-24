/**
 * SettingsView: application preferences, typography defaults, keyboard shortcuts, and backup/restore.
 */

import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Moon,
  Database,
  Keyboard,
  Download,
  Upload,
  Trash2,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';

import { useSettingsContext } from '../../app/providers/SettingsContext';
import {
  getStorageEstimate,
  requestPersistentStorage,
  clearDatabase,
} from '../../core/storage/database';
import {
  downloadLibraryBackup,
  restoreLibraryBackup,
} from '../../features/export/backup-service';
import { formatFileSize } from '../../utils';
import type { ThemeName, ReadingMode } from '../../types/book';

import { Button } from '../common/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';

import styles from './SettingsView.module.css';

export function SettingsView() {
  const navigate = useNavigate();
  const { settings, updateSettings, resetSettings } = useSettingsContext();

  const [storageInfo, setStorageInfo] = useState<{ usage: number; quota: number } | null>(null);
  const [persistent, setPersistent] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function checkStorage() {
      const est = await getStorageEstimate();
      setStorageInfo(est);

      if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
        const isPersisted = await navigator.storage.persisted();
        setPersistent(isPersisted);
      }
    }
    checkStorage();
  }, []);

  const handleRequestPersistent = async () => {
    const granted = await requestPersistentStorage();
    setPersistent(granted);
    if (granted) {
      setStatusMessage('Persistent storage granted by browser.');
    } else {
      setStatusMessage('Browser could not grant persistent storage.');
    }
  };

  const handleBackupExport = async () => {
    try {
      await downloadLibraryBackup();
      setStatusMessage('Backup file downloaded.');
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleBackupRestore = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await restoreLibraryBackup(file);
      setStatusMessage(
        `Restored ${result.booksRestored} books. ${
          result.errors.length > 0 ? `(${result.errors.length} skipped)` : ''
        }`
      );
    } catch (err) {
      alert(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleClearDatabase = async () => {
    try {
      await clearDatabase();
      await resetSettings();
      setClearConfirmOpen(false);
      navigate('/');
    } catch (err) {
      alert(`Failed to clear database: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const storageUsagePercent =
    storageInfo && storageInfo.quota > 0
      ? Math.round((storageInfo.usage / storageInfo.quota) * 100)
      : 0;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button
          className={styles.backBtn}
          onClick={() => navigate('/')}
          title="Back to Library"
          aria-label="Back to Library"
          type="button"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className={styles.title}>Settings & Library Data</h1>
      </header>

      <main className={styles.main}>
        {statusMessage && (
          <div className={styles.infoBox} role="status">
            {statusMessage}
          </div>
        )}

        {/* Appearance & Themes */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <Moon size={18} />
            <h2 className={styles.cardTitle}>Appearance & Reading Defaults</h2>
          </div>

          <div className={styles.row}>
            <div className={styles.rowCol}>
              <span className={styles.rowLabel}>Application Theme</span>
              <span className={styles.rowDesc}>Global color palette for reader and library</span>
            </div>
            <select
              className={styles.select}
              value={settings.theme}
              onChange={(e) => updateSettings({ theme: e.target.value as ThemeName })}
              aria-label="Application Theme"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="sepia">Warm Sepia</option>
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.rowCol}>
              <span className={styles.rowLabel}>Default Reading Mode</span>
              <span className={styles.rowDesc}>Preferred layout for newly opened books</span>
            </div>
            <select
              className={styles.select}
              value={settings.defaultReadingMode}
              onChange={(e) =>
                updateSettings({ defaultReadingMode: e.target.value as ReadingMode })
              }
              aria-label="Default Reading Mode"
            >
              <option value="scroll">Vertical Scroll</option>
              <option value="paginated">Pages</option>
              <option value="vertical">Double Sided</option>
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.rowCol}>
              <span className={styles.rowLabel}>Plain Text (.txt) Chapter Detection</span>
              <span className={styles.rowDesc}>
                Automatically detect headings like "Chapter 1" during import
              </span>
            </div>
            <input
              type="checkbox"
              checked={settings.autoDetectChapters}
              onChange={(e) => updateSettings({ autoDetectChapters: e.target.checked })}
              style={{ width: '18px', height: '18px', accentColor: 'var(--color-accent)' }}
              aria-label="Plain Text Chapter Detection"
            />
          </div>

          <div className={styles.row}>
            <div className={styles.rowCol}>
              <span className={styles.rowLabel}>Large import warning</span>
              <span className={styles.rowDesc}>Show a notice while processing files above this size.</span>
            </div>
            <label className={styles.numberField}>
              <input
                type="number"
                min={1}
                max={5000}
                step={1}
                value={settings.importSizeWarningMB}
                onChange={(event) =>
                  updateSettings({
                    importSizeWarningMB: Math.min(5000, Math.max(1, Number(event.target.value) || 1)),
                  })
                }
                aria-label="Large import warning size in megabytes"
              />
              <span>MB</span>
            </label>
          </div>
        </div>

        {/* Keyboard Shortcuts Reference */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <Keyboard size={18} />
            <h2 className={styles.cardTitle}>Keyboard Shortcuts</h2>
          </div>

          <div className={styles.shortcutGrid}>
            <div className={styles.shortcutItem}>
              <span>Toggle Controls</span>
              <span className={styles.kbd}>H</span>
            </div>
            <div className={styles.shortcutItem}>
              <span>Toggle Fullscreen</span>
              <span className={styles.kbd}>F</span>
            </div>
            <div className={styles.shortcutItem}>
              <span>Table of Contents</span>
              <span className={styles.kbd}>T</span>
            </div>
            <div className={styles.shortcutItem}>
              <span>Bookmarks Panel</span>
              <span className={styles.kbd}>B</span>
            </div>
            <div className={styles.shortcutItem}>
              <span>Reader Settings</span>
              <span className={styles.kbd}>S</span>
            </div>
            <div className={styles.shortcutItem}>
              <span>Search in Book</span>
              <span className={styles.kbd}>/</span>
            </div>
            <div className={styles.shortcutItem}>
              <span>Next Page</span>
              <span className={styles.kbd}>→ / Space</span>
            </div>
            <div className={styles.shortcutItem}>
              <span>Previous Page</span>
              <span className={styles.kbd}>←</span>
            </div>
            <div className={styles.shortcutItem}>
              <span>Close Drawers</span>
              <span className={styles.kbd}>Esc</span>
            </div>
          </div>
        </div>

        {/* Storage & Local-First Privacy */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <ShieldCheck size={18} />
            <h2 className={styles.cardTitle}>Local Storage & Privacy</h2>
          </div>

          <div className={styles.infoBox}>
            <strong>100% Local-First Promise:</strong> WebXReader never sends your novel
            contents, reading history, or personal annotations to any remote server or cloud
            storage. Everything is stored directly inside your browser's IndexedDB.
          </div>

          {storageInfo && (
            <div>
              <div className={styles.row}>
                <span className={styles.rowLabel}>Browser Storage Usage</span>
                <span className={styles.rowDesc}>
                  {formatFileSize(storageInfo.usage)} of {formatFileSize(storageInfo.quota)} (
                  {storageUsagePercent}%)
                </span>
              </div>
              <div className={styles.storageBar}>
                <div
                  className={styles.storageFill}
                  style={{ width: `${Math.min(100, storageUsagePercent)}%` }}
                />
              </div>
            </div>
          )}

          <div className={styles.row}>
            <div className={styles.rowCol}>
              <span className={styles.rowLabel}>Persistent Storage Status</span>
              <span className={styles.rowDesc}>
                {persistent
                  ? 'Active: Your browser has marked your library as persistent.'
                  : 'Best-effort: Storage may be evicted by the browser under extreme disk pressure.'}
              </span>
            </div>
            {!persistent && (
              <Button variant="secondary" size="sm" onClick={handleRequestPersistent}>
                Request Persistence
              </Button>
            )}
          </div>
        </div>

        {/* Backup and Restore */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <Database size={18} />
            <h2 className={styles.cardTitle}>Backup & Library Restoration</h2>
          </div>

          <div className={styles.row}>
            <div className={styles.rowCol}>
              <span className={styles.rowLabel}>Export Library Backup</span>
              <span className={styles.rowDesc}>
                Save a versioned JSON backup of your books, content, reading progress, bookmarks, and settings.
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<Download size={15} />}
              onClick={handleBackupExport}
            >
              Export JSON
            </Button>
          </div>

          <div className={styles.row}>
            <div className={styles.rowCol}>
              <span className={styles.rowLabel}>Restore Library Backup</span>
              <span className={styles.rowDesc}>
                Restore books and personal reading data from a previously saved WebXReader JSON file. Existing books are left untouched.
              </span>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleBackupRestore}
                style={{ display: 'none' }}
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<Upload size={15} />}
                onClick={() => fileInputRef.current?.click()}
              >
                Restore JSON
              </Button>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--color-border-light)', paddingTop: 'var(--space-4)' }}>
            <div className={styles.row}>
              <div className={styles.rowCol}>
                <span className={styles.rowLabel} style={{ color: 'var(--color-danger)' }}>
                  Clear All Stored Library Data
                </span>
                <span className={styles.rowDesc}>
                  Permanently erase all books, reading progress, and settings from this browser.
                </span>
              </div>
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 size={15} />}
                onClick={() => setClearConfirmOpen(true)}
              >
                Clear Database
              </Button>
            </div>
          </div>
        </div>

        {/* Reset Defaults */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw size={14} />}
            onClick={() => {
              resetSettings();
              setStatusMessage('Application settings reset to defaults.');
            }}
          >
            Reset Presentation Settings
          </Button>
        </div>
      </main>

      {/* Clear Database Confirmation Dialog */}
      <ConfirmDialog
        isOpen={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        onConfirm={handleClearDatabase}
        title="Clear All Library Data?"
        message="This action will permanently delete all imported books, reading progress, bookmarks, annotations, and settings from your browser. This action cannot be undone."
        confirmLabel="Erase Everything"
        variant="danger"
      />
    </div>
  );
}
