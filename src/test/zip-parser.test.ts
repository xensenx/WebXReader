import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  parseZip,
  detectZipEntryKind,
  sanitizeZipEntryPath,
  formatFileSize,
} from '../core/parsing/zip-parser';

// Sample 1x1 valid PNG base64
const SAMPLE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('ZIP Archive Parser & Security', () => {
  describe('Path Sanitization & Security', () => {
    it('normalizes backslashes and strips leading slashes', () => {
      expect(sanitizeZipEntryPath('\\folder\\sub\\file.txt')).toBe('folder/sub/file.txt');
      expect(sanitizeZipEntryPath('///deep/path.pdf')).toBe('deep/path.pdf');
      expect(sanitizeZipEntryPath('simple.epub')).toBe('simple.epub');
    });

    it('rejects path traversal attempts (.. segments)', () => {
      expect(() => sanitizeZipEntryPath('../secret.txt')).toThrow(/path traversal/i);
      expect(() => sanitizeZipEntryPath('folder/../../etc/passwd')).toThrow(/path traversal/i);
      expect(() => sanitizeZipEntryPath('sub/./file.txt')).toThrow(/path traversal/i);
    });
  });

  describe('Format Detection for Archive Entries', () => {
    it('identifies all WebXReader supported document and image types', () => {
      expect(detectZipEntryKind('book.epub')).toBe('epub');
      expect(detectZipEntryKind('manual.pdf')).toBe('pdf');
      expect(detectZipEntryKind('manga.cbz')).toBe('cbz');
      expect(detectZipEntryKind('comic.cbr')).toBe('cbr');
      expect(detectZipEntryKind('comic.cb7')).toBe('cb7');
      expect(detectZipEntryKind('paper.djvu')).toBe('djvu');
      expect(detectZipEntryKind('article.mhtml')).toBe('mht');
      expect(detectZipEntryKind('novel.fb2')).toBe('fb2');
      expect(detectZipEntryKind('novel.fb2.zip')).toBe('fb2');
      expect(detectZipEntryKind('ebook.mobi')).toBe('mobi');
      expect(detectZipEntryKind('kindle.azw3')).toBe('azw3');
      expect(detectZipEntryKind('document.docx')).toBe('docx');
      expect(detectZipEntryKind('legacy.doc')).toBe('doc');
      expect(detectZipEntryKind('rich.rtf')).toBe('rtf');
      expect(detectZipEntryKind('page.html')).toBe('html');
      expect(detectZipEntryKind('readme.md')).toBe('markdown');
      expect(detectZipEntryKind('notes.txt')).toBe('txt');
      expect(detectZipEntryKind('photo.png')).toBe('image');
      expect(detectZipEntryKind('photo.jpg')).toBe('image');
      expect(detectZipEntryKind('photo.webp')).toBe('image');
      expect(detectZipEntryKind('photo.avif')).toBe('image');
      expect(detectZipEntryKind('program.exe')).toBe('unsupported');
      expect(detectZipEntryKind('data.bin')).toBe('unsupported');
    });
  });

  describe('File Size Formatting', () => {
    it('formats bytes into B, KB, and MB', () => {
      expect(formatFileSize(500)).toBe('500 B');
      expect(formatFileSize(2048)).toBe('2.0 KB');
      expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    });
  });

  describe('Full ZIP Parsing & Tree Construction', () => {
    it('parses a structured ZIP archive preserving folders, metadata, and cover thumbnail', async () => {
      const zip = new JSZip();
      zip.folder('Novels');
      zip.folder('Novels/SciFi');
      zip.file('Novels/SciFi/foundation.epub', 'Dummy EPUB binary content');
      zip.file('Novels/dune.txt', 'Frank Herbert - Dune text content');
      zip.file('cover.png', SAMPLE_PNG_BASE64, { base64: true });
      zip.file('notes.pdf', 'Dummy PDF stream');
      zip.file('setup.exe', 'Binary executable data');

      const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' });
      const result = await parseZip(zipBuffer, { filename: 'SciFi_Collection.zip' });

      expect(result.metadata.title).toBe('SciFi_Collection');
      expect(result.metadata.totalFiles).toBe(5);
      expect(result.metadata.totalFolders).toBe(2);
      expect(result.coverImage).toContain('data:image/png;base64,');

      // Verify entries
      const epubEntry = result.entries.find((e) => e.name === 'foundation.epub');
      expect(epubEntry).toBeDefined();
      expect(epubEntry?.kind).toBe('epub');
      expect(epubEntry?.isSupported).toBe(true);

      const exeEntry = result.entries.find((e) => e.name === 'setup.exe');
      expect(exeEntry).toBeDefined();
      expect(exeEntry?.kind).toBe('unsupported');
      expect(exeEntry?.isSupported).toBe(false);

      // Verify table of contents tree
      expect(result.tableOfContents.length).toBeGreaterThan(0);
      const novelsFolder = result.tableOfContents.find((c) => c.title === 'Novels');
      expect(novelsFolder).toBeDefined();
      expect(novelsFolder?.children?.length).toBeGreaterThan(0);
    });

    it('rejects empty input or corrupted data', async () => {
      await expect(parseZip(new ArrayBuffer(0))).rejects.toThrow(/file is empty/i);
      await expect(parseZip(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/failed to read zip archive/i);
    });

    it('filters out macOS metadata and hidden files', async () => {
      const zip = new JSZip();
      zip.file('__MACOSX/._story.txt', 'mac metadata');
      zip.file('.DS_Store', 'desktop services');
      zip.file('story.txt', 'Real story content');

      const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' });
      const result = await parseZip(zipBuffer, { filename: 'CleanArchive.zip' });

      expect(result.metadata.totalFiles).toBe(1);
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].name).toBe('story.txt');
    });
  });
});
