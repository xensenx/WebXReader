import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { importFile } from '../features/import/import-service';
import { clearDatabase, listBooks, getBookContent } from '../core/storage/database';

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

  it('successfully imports a Rich Text (.rtf) novel with chapters and formatting', async () => {
    const rtfContent = `{\\rtf1\\ansi\\ansicpg1252
{\\info{\\title Starlight Chronicles}{\\author Alex Mercer}}
\\pard\\qc\\b\\fs32 Title: Starlight Chronicles\\b0\\par
\\page
\\pard\\b Chapter 1: The Launch\\b0\\par
\\pard The rocket engines roared to life.\\par
\\page
\\pard\\b Chapter 2: Orbit\\b0\\par
\\pard Silence fell as weightlessness took hold.\\par
}`;
    const file = new File([rtfContent], 'starlight.rtf', { type: 'application/rtf' });

    const result = await importFile(file, { autoDetectChapters: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.book.title).toBe('Starlight Chronicles');
      expect(result.book.author).toBe('Alex Mercer');
      expect(result.book.sourceFormat).toBe('rtf');
      expect(result.book.totalChapters).toBe(3);
      expect(result.isDuplicate).toBe(false);
    }

    const books = await listBooks();
    expect(books.length).toBe(1);
    expect(books[0].sourceFormat).toBe('rtf');

    const content = await getBookContent(result.success ? result.book.id : '');
    expect(content?.format).toBe('rtf');
    expect(content?.chapters?.length).toBe(3);
    expect(content?.chapters?.[1]?.title).toContain('The Launch');
  });

  it('successfully imports a FictionBook (.fb2) novel with metadata and chapters', async () => {
    const fb2Content = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    <title-info>
      <genre>adventure</genre>
      <author><first-name>Arthur</first-name><last-name>Conan Doyle</last-name></author>
      <book-title>The Lost World</book-title>
    </title-info>
  </description>
  <body>
    <section>
      <title><p>Chapter 1: There Are Heroisms All Round Us</p></title>
      <p>Mr. Hungerton, her father, really was the most flippant person.</p>
    </section>
    <section>
      <title><p>Chapter 2: Try Your Luck with Professor Challenger</p></title>
      <p>I always felt that a man should be ready for adventure.</p>
    </section>
  </body>
</FictionBook>`;
    const file = new File([fb2Content], 'lost_world.fb2', { type: 'application/x-fictionbook+xml' });

    const result = await importFile(file, { autoDetectChapters: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.book.title).toBe('The Lost World');
      expect(result.book.author).toBe('Arthur Conan Doyle');
      expect(result.book.sourceFormat).toBe('fb2');
      expect(result.book.totalChapters).toBe(2);
      expect(result.isDuplicate).toBe(false);
    }

    const books = await listBooks();
    expect(books.length).toBe(1);
    expect(books[0].sourceFormat).toBe('fb2');

    const content = await getBookContent(result.success ? result.book.id : '');
    expect(content?.format).toBe('fb2');
    expect(content?.chapters?.length).toBe(2);
    expect(content?.chapters?.[0]?.title).toContain('Chapter 1');
  });

  it('successfully imports a Mobipocket / Kindle (.mobi) novel with metadata and chapters', async () => {
    const fixturePath = path.resolve(__dirname, '../../fixtures/sample-novel.mobi');
    const buffer = fs.readFileSync(fixturePath);
    const file = new File([buffer], 'sample-novel.mobi', { type: 'application/x-mobipocket-ebook' });

    const result = await importFile(file, { autoDetectChapters: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.book.title).toBe('The Sign of the Four');
      expect(result.book.author).toBe('Sir Arthur Conan Doyle');
      expect(result.book.sourceFormat).toBe('mobi');
      expect(result.book.totalChapters).toBe(4);
      expect(result.book.coverImage).toBeDefined();
    }

    const books = await listBooks();
    expect(books.length).toBe(1);
    expect(books[0].sourceFormat).toBe('mobi');

    const content = await getBookContent(result.success ? result.book.id : '');
    expect(content?.format).toBe('mobi');
    expect(content?.chapters?.length).toBe(4);
    expect(content?.chapters?.[1]?.title).toContain('The Science of Deduction');
  });

  it('successfully imports an Amazon Kindle Format 8 (.azw3) novel with metadata and chapters', async () => {
    const fixturePath = path.resolve(__dirname, '../../fixtures/sample-novel.azw3');
    const buffer = fs.readFileSync(fixturePath);
    const file = new File([buffer], 'sample-novel.azw3', { type: 'application/vnd.amazon.mobi8-ebook' });

    const result = await importFile(file, { autoDetectChapters: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.book.title).toBe('A Study in Scarlet');
      expect(result.book.author).toBe('Sir Arthur Conan Doyle');
      expect(result.book.sourceFormat).toBe('azw3');
      expect(result.book.totalChapters).toBe(4);
      expect(result.book.coverImage).toBeDefined();
    }

    const books = await listBooks();
    expect(books.length).toBe(1);
    expect(books[0].sourceFormat).toBe('azw3');

    const content = await getBookContent(result.success ? result.book.id : '');
    expect(content?.format).toBe('azw3');
    expect(content?.chapters?.length).toBe(4);
    expect(content?.chapters?.[1]?.title).toContain('Mr. Sherlock Holmes');
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
