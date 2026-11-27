import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useSettingsContext } from '../../app/providers/useSettingsContext';
import { getLibraryFileSize, getStorageEstimate, getStoragePersistence, requestPersistentStorage } from '../../core/storage/database';
import { formatFileSize } from '../../utils';
import { Button } from '../common/Button';
import { StorageLimitFields } from './StorageLimitFields';
import styles from './SettingsView.module.css';

interface StorageUsage {
  librarySize: number | null;
  browser: Awaited<ReturnType<typeof getStorageEstimate>>;
  persistent: boolean | null;
}

export function StorageSettings() {
  const { settings } = useSettingsContext();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const [result, setResult] = useState('');
  const limit = settings.librarySizeLimitBytes;

  useEffect(() => {
    let active = true;
    void Promise.all([getLibraryFileSize().catch(() => null), getStorageEstimate(), getStoragePersistence()])
      .then(([librarySize, browser, persistent]) => {
        if (active) setUsage({ librarySize, browser, persistent });
      });
    return () => { active = false; };
  }, [refresh]);

  async function requestPersistence() {
    setRequesting(true);
    try {
      const granted = await requestPersistentStorage();
      if (granted) setUsage((previous) => previous && { ...previous, persistent: true });
      setResult(granted ? 'Persistent storage granted.' : 'The browser declined persistent storage.');
      setRefresh((value) => value + 1);
    } catch {
      setResult('The browser could not request persistent storage.');
    } finally {
      setRequesting(false);
    }
  }

  const browser = usage?.browser;
  const librarySize = usage?.librarySize;
  const usagePercent = browser ? Math.min(100, (browser.usage / browser.quota) * 100) : 0;
  const canRequest = typeof navigator.storage?.persist === 'function';

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <ShieldCheck size={18} aria-hidden="true" />
        <div className={styles.cardTitleGroup}>
          <h2 className={styles.cardTitle}>Local Storage & Privacy</h2>
          <p className={styles.cardDesc}>Library size, browser storage, and persistence</p>
        </div>
      </div>

      <div className={styles.infoBox}>
        <strong>100% Local-First Promise:</strong> WebXReader keeps your books, reading history, and annotations on this device.
        The browser manages storage for each site address separately.
      </div>

      <div className={styles.row}>
        <div className={styles.rowCol}>
          <span className={styles.rowLabel}>Total library size</span>
          <span className={styles.rowDesc}>
            {librarySize != null ? formatFileSize(librarySize) : usage ? 'Usage unavailable' : 'Calculating…'}
            {' · Original file sizes, including archived books'}
          </span>
          {limit != null && librarySize != null && (
            <span className={styles.rowDesc}>
              {librarySize > limit ? `${formatFileSize(librarySize - limit)} over your limit` : `${formatFileSize(limit - librarySize)} left under your limit`}
            </span>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={() => setRefresh((value) => value + 1)}>Refresh usage</Button>
      </div>

      <div>
        <div className={styles.rowCol}>
          <span className={styles.rowLabel}>Browser storage</span>
          <span className={styles.rowDesc}>{browser
            ? `${formatFileSize(browser.usage)} used · ${formatFileSize(Math.max(0, browser.quota - browser.usage))} estimated available of ${formatFileSize(browser.quota)}`
            : usage ? 'This browser could not provide a storage estimate.' : 'Checking browser quota…'}</span>
        </div>
        {browser && <div className={styles.storageBar} role="meter" aria-label="Browser storage usage"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usagePercent)}>
          <div className={styles.storageFill} style={{ width: `${usagePercent}%` }} />
        </div>}
      </div>

      <StorageLimitFields />

      <div className={styles.row}>
        <div className={styles.rowCol}>
          <span className={styles.rowLabel}>Persistent Storage Status</span>
          <span className={styles.rowDesc}>{usage?.persistent === true
            ? 'Active. The browser protects this site from automatic eviction under storage pressure.'
            : usage?.persistent === false ? 'Best effort. The browser may clear data under storage pressure.'
            : usage ? 'Persistence status unavailable in this browser.' : 'Checking persistence…'}</span>
          {result && <span className={styles.rowDesc} role="status">{result}</span>}
        </div>
        {canRequest && usage && usage.persistent !== true && (
          <Button variant="secondary" size="sm" loading={requesting} onClick={() => void requestPersistence()}>
            Request persistence
          </Button>
        )}
      </div>
    </div>
  );
}
