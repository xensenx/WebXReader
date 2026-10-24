/**
 * Backup and Export Service for WebXReader.
 * Provides functions to export/restore backups and download original book files.
 */

import { exportBackup, restoreBackup, getBook, getBookContent } from '../../core/storage/database';
import type { BackupData } from '../../types/book';

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
  const backup = await exportBackup();
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `webxreader-backup-${dateStr}.json`;
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, filename);
}

/**
 * Restores a library from a JSON backup file.
 */
export async function restoreLibraryBackup(file: File): Promise<{ booksRestored: number; errors: string[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = reader.result as string;
        const data = JSON.parse(text) as BackupData;
        const result = await restoreBackup(data);
        resolve(result);
      } catch (err) {
        reject(new Error(`Failed to parse backup file: ${(err as Error).message}`));
      }
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
  const [book, content] = await Promise.all([getBook(bookId), getBookContent(bookId)]);
  if (!book || !content) {
    throw new Error('Book or book content not found');
  }

  let blob: Blob;
  const filename = book.originalFilename || `${book.title}.${book.sourceFormat}`;

  if (content.originalFile) {
    const mimeTypes: Record<string, string> = {
      epub: 'application/epub+zip',
      pdf: 'application/pdf',
      txt: 'text/plain',
      markdown: 'text/markdown',
      html: 'text/html',
    };
    const type = mimeTypes[book.sourceFormat] || 'application/octet-stream';
    blob = new Blob([content.originalFile], { type });
  } else if (content.rawText) {
    blob = new Blob([content.rawText], { type: 'text/plain;charset=utf-8' });
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
  } else {
    throw new Error('No exportable content available for this book.');
  }

  downloadBlob(blob, filename);
  return true;
}
