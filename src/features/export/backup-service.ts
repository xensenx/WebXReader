/**
 * Backup and Export Service for WebXReader.
 * Provides functions to export/restore backups and download original book files.
 */

import { exportBackupStream, restoreBackup, getBook, getStoredBookContent } from '../../core/storage/database';
import { MAX_JSON_BACKUP_BYTES } from '../../core/storage/storage-limits';
import type { BackupData } from '../../types/book';
import { getFormatMimeType } from '../../formats';

/**
 * Trigger browser file download from Blob.
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Exports entire library metadata, bookmarks, annotations, progress and settings to a JSON file.
 */
export async function downloadLibraryBackup(): Promise<void> {
  const stream = await exportBackupStream();
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `webxreader-backup-${dateStr}.json`;
  const savePicker = (window as Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }> }).showSaveFilePicker;
  if (savePicker) {
    const handle = await savePicker.call(window, { suggestedName: filename });
    await stream.pipeTo(await handle.createWritable());
  } else {
    downloadBlob(await new Response(stream, { headers: { 'content-type': 'application/json' } }).blob(), filename);
  }
}

/**
 * Restores a library from a JSON backup file.
 */
export async function restoreLibraryBackup(file: File): Promise<{ booksRestored: number; errors: string[] }> {
  if (file.size > MAX_JSON_BACKUP_BYTES) throw new Error('Backup exceeds the 100 MB limit.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      let data: BackupData;
      try {
        data = JSON.parse(reader.result as string) as BackupData;
      } catch (err) {
        reject(new Error(`Failed to parse backup file: ${(err as Error).message}`));
        return;
      }
      restoreBackup(data).then(resolve, reject);
    };
    reader.onerror = () => {
      reject(new Error('Failed to read the backup file.'));
    };
    reader.readAsText(file);
  });
}

/**
 * Exports an individual book in its original format.
 */
export async function downloadOriginalBook(bookId: string): Promise<boolean> {
  const [book, content] = await Promise.all([getBook(bookId), getStoredBookContent(bookId)]);
  if (!book || !content) {
    throw new Error('Book or book content not found');
  }

  let blob: Blob;
  let filename = book.originalFilename || `${book.title}.${book.sourceFormat}`;

  if (content.originalFile) {
    const type = getFormatMimeType(book.sourceFormat);
    blob = content.originalFile instanceof Blob
      ? content.originalFile.slice(0, content.originalFile.size, type)
      : new Blob([content.originalFile], { type });
  } else if (content.rawText) {
    blob = new Blob([content.rawText], { type: 'text/plain;charset=utf-8' });
    if (!filename.toLowerCase().endsWith('.txt')) {
      filename = `${filename.replace(/\.[^/.]+$/, '')}.txt`;
    }
  } else if (content.chapters && content.chapters.length > 0) {
    // Reconstruct plain text from chapters
    const combined = content.chapters
      .map((c) => {
        const title = c.title ? `${c.title}\n\n` : '';
        // Strip basic HTML tags
        const text = (c.content || '').replace(/<[^>]+>/g, '\n').replace(/\n{3,}/g, '\n\n');
        return `${title}${text}`;
      })
      .join('\n\n--- \n\n');
    blob = new Blob([combined], { type: 'text/plain;charset=utf-8' });
    if (!filename.toLowerCase().endsWith('.txt')) {
      filename = `${filename.replace(/\.[^/.]+$/, '')}.txt`;
    }
  } else {
    throw new Error('No exportable content available for this book.');
  }

  downloadBlob(blob, filename);
  return true;
}
