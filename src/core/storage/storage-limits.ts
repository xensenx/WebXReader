import { formatFileSize } from '../../utils';

export const MEGABYTE = 1024 * 1024;
export const GIGABYTE = 1024 * MEGABYTE;
export const MAX_JSON_BACKUP_BYTES = 100 * MEGABYTE;

export function normalizeStorageLimit(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function libraryLimitError(limit: number, used: number, incoming: number): Error {
  return new Error(
    `Your library limit is ${formatFileSize(limit)}. There is ${formatFileSize(Math.max(0, limit - used))} left for ` +
    `${formatFileSize(incoming)} of new files. Free space in your library or change the limit in Settings → Local storage and privacy.`,
  );
}

export function isStorageQuotaError(error: unknown): boolean {
  return error instanceof Error || error instanceof DOMException ? error.name === 'QuotaExceededError' : false;
}

export const BROWSER_QUOTA_ERROR =
  'The browser could not allocate enough storage. Free browser or device storage and try again.';
