/**
 * SettingsView: browser-style master-detail layout for application preferences,
 * reading defaults, keyboard shortcuts, local storage & privacy, and backup/restoration.
 */

import { useState, useEffect, useRef, type ChangeEvent, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Palette,
  BookOpen,
  Keyboard,
  ShieldCheck,
  Database,
  Download,
  Upload,
  Trash2,
  RotateCcw,
} from 'lucide-react';

import { useSettingsContext } from '../../app/providers/SettingsContext';
import { clearLibraryViewState } from '../../features/library/library-state';
import {
  getStorageEstimate,
  getSettings,
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
import { DropdownSelect } from '../common/DropdownSelect';
import { ConfirmDialog } from '../common/ConfirmDialog';
import styles from './SettingsView.module.css';

export type SettingsSectionId =
  | 'appearance'
  | 'reading-options'
  | 'keyboard-shortcuts'
  | 'storage-privacy'
  | 'backup-restoration';

export interface SettingsSectionItem {
  id: SettingsSectionId;
  label: string;
  icon: typeof Palette;
  description: string;
}

export const SETTINGS_SECTIONS: SettingsSectionItem[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    icon: Palette,
    description: 'Customize application themes and visual styling',
  },
  {
    id: 'reading-options',
    label: 'Reading options',
    icon: BookOpen,
    description: 'Default reading layout, chapter detection, and import limits',
  },
  {
    id: 'keyboard-shortcuts',
    label: 'Keyboard shortcuts',
    icon: Keyboard,
    description: 'Quick navigation and reader control hotkeys',
  },
  {
    id: 'storage-privacy',
    label: 'Local storage and privacy',
    icon: ShieldCheck,
    description: 'Browser quota, persistence status, and local data policy',
  },
  {
    id: 'backup-restoration',
    label: 'Backup and restoration',
    icon: Database,
    description: 'Export, import, reset preferences, or wipe library data',
  },
];

export function SettingsView() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { settings, updateSettings, resetSettings } = useSettingsContext();

  const sectionParam = searchParams.get('section') as SettingsSectionId | null;
  const initialSection =
    sectionParam && SETTINGS_SECTIONS.some((s) => s.id === sectionParam)
      ? sectionParam
      : 'appearance';

  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const [storageInfo, setStorageInfo] = useState<{ usage: number; quota: number } | null>(null);
  const [persistent, setPersistent] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const param = searchParams.get('section') as SettingsSectionId | null;
    if (param && SETTINGS_SECTIONS.some((s) => s.id === param)) {
      setActiveSection(param);
    }
  }, [searchParams]);

  const handleSelectSection = (id: SettingsSectionId) => {
    setActiveSection(id);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('section', id);
        return next;
      },
      { replace: true }
    );
  };

  const handleNavKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIndex = (index + 1) % SETTINGS_SECTIONS.length;
      const nextSection = SETTINGS_SECTIONS[nextIndex];
      handleSelectSection(nextSection.id);
      document.getElementById(`tab-${nextSection.id}`)?.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIndex = (index - 1 + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length;
      const prevSection = SETTINGS_SECTIONS[prevIndex];
      handleSelectSection(prevSection.id);
      document.getElementById(`tab-${prevSection.id}`)?.focus();
    }
  };

  useEffect(() => {
    let active = true;
    async function checkStorage() {
      const est = await getStorageEstimate();
      if (!active) return;
      setStorageInfo(est);

      if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
        const isPersisted = await navigator.storage.persisted();
        if (active) setPersistent(isPersisted);
      }
    }
    checkStorage();
    return () => {
      active = false;
    };
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
      const restoredSettings = await getSettings();
      if (restoredSettings) await updateSettings(restoredSettings);
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

  const handleResetSettings = async () => {
    try {
      await resetSettings();
      clearLibraryViewState();
      setResetConfirmOpen(false);
      setStatusMessage('Site preferences reset to factory defaults.');
    } catch (err) {
      alert(`Failed to reset site preferences: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleClearDatabase = async () => {
    try {
      await clearDatabase();
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
        {/* Left Side: Navigation Tabs */}
        <nav className={styles.sidebar} aria-label="Settings sections">
          <div role="tablist" aria-orientation="vertical" className={styles.navGroup}>
            {SETTINGS_SECTIONS.map((section, index) => {
              const isActive = activeSection === section.id;
              const Icon = section.icon;

              return (
                <button
                  key={section.id}
                  id={`tab-${section.id}`}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`panel-${section.id}`}
                  className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
                  onClick={() => handleSelectSection(section.id)}
                  onKeyDown={(e) => handleNavKeyDown(e, index)}
                  type="button"
                >
                  <Icon size={18} className={styles.navIcon} aria-hidden="true" />
                  <span className={styles.navLabel}>{section.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Right Side: Active Section Content Pane */}
        <div
          role="tabpanel"
          id={`panel-${activeSection}`}
          aria-labelledby={`tab-${activeSection}`}
          className={styles.contentPane}
        >
          {statusMessage && (
            <div className={styles.infoBox} role="status">
              {statusMessage}
            </div>
          )}

          {/* 1. Appearance */}
          {activeSection === 'appearance' && (
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <Palette size={18} aria-hidden="true" />
                <div className={styles.cardTitleGroup}>
                  <h2 className={styles.cardTitle}>Appearance</h2>
                  <p className={styles.cardDesc}>Customize application themes and visual styling</p>
                </div>
              </div>

              <div className={styles.row}>
                <div className={styles.rowCol}>
                  <span className={styles.rowLabel}>Application Theme</span>
                  <span className={styles.rowDesc}>Global color palette for reader and library</span>
                </div>
                <DropdownSelect
                  className={styles.select}
                  value={settings.theme}
                  onChange={(value) => updateSettings({ theme: value as ThemeName })}
                  ariaLabel="Application Theme"
                  options={[
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                    { value: 'sepia', label: 'Warm Sepia' },
                  ]}
                />
              </div>
            </div>
          )}

          {/* 2. Reading options */}
          {activeSection === 'reading-options' && (
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <BookOpen size={18} aria-hidden="true" />
                <div className={styles.cardTitleGroup}>
                  <h2 className={styles.cardTitle}>Reading Options</h2>
                  <p className={styles.cardDesc}>
                    Default reading layout, chapter detection, and import limits
                  </p>
                </div>
              </div>

              <div className={styles.row}>
                <div className={styles.rowCol}>
                  <span className={styles.rowLabel}>Default Reading Mode</span>
                  <span className={styles.rowDesc}>Preferred layout for newly opened books</span>
                </div>
                <DropdownSelect
                  className={styles.select}
                  value={settings.defaultReadingMode}
                  onChange={(value) => updateSettings({ defaultReadingMode: value as ReadingMode })}
                  ariaLabel="Default Reading Mode"
                  options={[
                    { value: 'scroll', label: 'Vertical Scroll' },
                    { value: 'horizontal', label: 'Horizontal Scroll' },
                    { value: 'paginated', label: 'Pages' },
                    { value: 'vertical', label: 'Double Sided' },
                  ]}
                />
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
                  <span className={styles.rowLabel}>Rich Text (.rtf) Chapter Detection</span>
                  <span className={styles.rowDesc}>
                    Automatically detect sections, page breaks, and headings during RTF import
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoDetectChaptersRtf ?? true}
                  onChange={(e) => updateSettings({ autoDetectChaptersRtf: e.target.checked })}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--color-accent)' }}
                  aria-label="Rich Text Chapter Detection"
                />
              </div>

              <div className={styles.row}>
                <div className={styles.rowCol}>
                  <span className={styles.rowLabel}>FictionBook (.fb2) Footnotes</span>
                  <span className={styles.rowDesc}>
                    Include endnotes and footnotes as a reference chapter in the Table of Contents
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.fb2IncludeNotes ?? true}
                  onChange={(e) => updateSettings({ fb2IncludeNotes: e.target.checked })}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--color-accent)' }}
                  aria-label="FictionBook Footnotes"
                />
              </div>

              <div className={styles.row}>
                <div className={styles.rowCol}>
                  <span className={styles.rowLabel}>Kindle / MOBI (.mobi) Chapter Detection</span>
                  <span className={styles.rowDesc}>
                    Automatically split chapters on page breaks and headings during MOBI import
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoDetectChaptersMobi ?? true}
                  onChange={(e) => updateSettings({ autoDetectChaptersMobi: e.target.checked })}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--color-accent)' }}
                  aria-label="MOBI Chapter Detection"
                />
              </div>

              <div className={styles.row}>
                <div className={styles.rowCol}>
                  <span className={styles.rowLabel}>Kindle Format 8 (.azw3, .kf8) Chapter Detection</span>
                  <span className={styles.rowDesc}>
                    Automatically split chapters on HTML5 page breaks, sections, and headings during AZW3 import
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoDetectChaptersAzw3 ?? true}
                  onChange={(e) => updateSettings({ autoDetectChaptersAzw3: e.target.checked })}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--color-accent)' }}
                  aria-label="AZW3 Chapter Detection"
                />
              </div>

              <div className={styles.row}>
                <div className={styles.rowCol}>
                  <span className={styles.rowLabel}>Word Document (.docx) Chapter Detection</span>
                  <span className={styles.rowDesc}>
                    Automatically split chapters on headings and page breaks during DOCX import
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoDetectChaptersDocx ?? true}
                  onChange={(e) => updateSettings({ autoDetectChaptersDocx: e.target.checked })}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--color-accent)' }}
                  aria-label="DOCX Chapter Detection"
                />
              </div>

              <div className={styles.row}>
                <div className={styles.rowCol}>
                  <span className={styles.rowLabel}>Word 97-2004 (.doc) Chapter Detection</span>
                  <span className={styles.rowDesc}>
                    Automatically split chapters on page breaks and section breaks during DOC import
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoDetectChaptersDoc ?? true}
                  onChange={(e) => updateSettings({ autoDetectChaptersDoc: e.target.checked })}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--color-accent)' }}
                  aria-label="DOC Chapter Detection"
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
                        importSizeWarningMB: Math.min(
                          5000,
                          Math.max(1, Number(event.target.value) || 1)
                        ),
                      })
                    }
                    aria-label="Large import warning size in megabytes"
                  />
                  <span>MB</span>
                </label>
              </div>
            </div>
          )}

          {/* 3. Keyboard shortcuts */}
          {activeSection === 'keyboard-shortcuts' && (
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <Keyboard size={18} aria-hidden="true" />
                <div className={styles.cardTitleGroup}>
                  <h2 className={styles.cardTitle}>Keyboard Shortcuts</h2>
                  <p className={styles.cardDesc}>Quick navigation and reader control hotkeys</p>
                </div>
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
          )}

          {/* 4. Local storage and privacy */}
          {activeSection === 'storage-privacy' && (
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <ShieldCheck size={18} aria-hidden="true" />
                <div className={styles.cardTitleGroup}>
                  <h2 className={styles.cardTitle}>Local Storage & Privacy</h2>
                  <p className={styles.cardDesc}>
                    Browser quota, persistence status, and local data policy
                  </p>
                </div>
              </div>

              <div className={styles.infoBox}>
                <strong>100% Local-First Promise:</strong> WebXReader never sends your novel
                contents, reading history, or personal annotations to any remote server or cloud
                storage. Your books and reading data live in IndexedDB; general site preferences are
                stored separately in browser local storage and remain when you clear library data.
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
          )}

          {/* 5. Backup and restoration */}
          {activeSection === 'backup-restoration' && (
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <Database size={18} aria-hidden="true" />
                <div className={styles.cardTitleGroup}>
                  <h2 className={styles.cardTitle}>Backup & Restoration</h2>
                  <p className={styles.cardDesc}>
                    Export, import, reset preferences, or wipe library data
                  </p>
                </div>
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
                      Clear Library Data
                    </span>
                    <span className={styles.rowDesc}>
                      Permanently erase books, reading progress, bookmarks, annotations, and book-specific reader settings. General site preferences stay saved.
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

              <div
                style={{
                  borderTop: '1px solid var(--color-border-light)',
                  paddingTop: 'var(--space-4)',
                  marginTop: 'var(--space-4)',
                }}
              >
                <div className={styles.row}>
                  <div className={styles.rowCol}>
                    <span className={styles.rowLabel} style={{ color: 'var(--color-danger)' }}>
                      Reset Site Preferences
                    </span>
                    <span className={styles.rowDesc}>
                      Restore all site appearance, typography, layout, custom book arrangement, and reader preferences back to factory defaults. Your library books, bookmarks, and reading progress remain intact.
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<RotateCcw size={15} />}
                    onClick={() => setResetConfirmOpen(true)}
                  >
                    Reset Preferences
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Reset Preferences Confirmation Dialog */}
      <ConfirmDialog
        isOpen={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        onConfirm={handleResetSettings}
        title="Reset Site Preferences?"
        message="This restores all appearance, typography, reading defaults, and custom shelf arrangements back to initial settings. Your imported books, bookmarks, and reading progress will NOT be touched."
        confirmLabel="Reset Preferences"
        variant="danger"
      />

      {/* Clear Database Confirmation Dialog */}
      <ConfirmDialog
        isOpen={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        onConfirm={handleClearDatabase}
        title="Clear Library Data?"
        message="This permanently deletes imported books, reading progress, bookmarks, annotations, covers, and book-specific reader settings. General site preferences are stored separately in browser local storage and will remain saved."
        confirmLabel="Clear Library Data"
        variant="danger"
      />
    </div>
  );
}
