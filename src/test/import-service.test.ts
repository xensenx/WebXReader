import { describe, it, expect, beforeEach } from 'vitest';
import { importFile } from '../features/import/import-service';
import { clearDatabase, listBooks } from '../core/storage/database';

describe('Import Service', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('rejects unsupported file formats', async () => {
    const file = new File(['binary content'], 'novel.exe', { type: 'application/octet-stream' });
    const result = await importFile(file);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Unsupported file type');
    }
  });

  it('successfully imports a plain text (.txt) novel', async () => {
    const txtContent = `Chapter 1: The Outset\n\nIt began in the quiet valley.\n\nChapter 2: The Ascent\n\nThe mountains loomed overhead.`;
    const file = new File([txtContent], 'adventure.txt', { type: 'text/plain' });

    const result = await importFile(file, { autoDetectChapters: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.book.title).toBe('adventure');
      expect(result.book.totalChapters).toBe(2);
      expect(result.isDuplicate).toBe(false);
    }

    const books = await listBooks();
    expect(books.length).toBe(1);
    expect(books[0].sourceFormat).toBe('txt');
  });

  it('identifies duplicate file imports by content hash', async () => {
    const txtContent = `A unique story text that will be tested for duplicates.`;
    const file1 = new File([txtContent], 'story.txt', { type: 'text/plain' });
    const file2 = new File([txtContent], 'story_copy.txt', { type: 'text/plain' });

    const first = await importFile(file1);
    expect(first.success).toBe(true);

    const second = await importFile(file2, { forceImport: false });
    expect(second.success).toBe(true);
    if (second.success) {
      expect(second.isDuplicate).toBe(true);
      expect(second.existingBookId).toBeDefined();
    }
  });

  it('persists book cover properly when available', async () => {
    const mdContent = `# Chapter 1\nSome test story markdown`;
    const file = new File([mdContent], 'book_with_cover.md', { type: 'text/markdown' });

    const result = await importFile(file);
    expect(result.success).toBe(true);
    if (result.success) {
      // Books without an extracted cover should have undefined, not a broken UUID
      expect(result.book.coverImage).toBeUndefined();
    }
  });

  it('successfully identifies and accepts a PDF novel', async () => {
    // Valid minimal PDF header
    const pdfData = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n115\n%%EOF`;
    const file = new File([pdfData], 'sample_novel.pdf', { type: 'application/pdf' });

    const result = await importFile(file);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.book.sourceFormat).toBe('pdf');
      expect(result.book.title).toBe('sample novel');
    }
  });
});
