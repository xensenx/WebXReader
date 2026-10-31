import { describe, it, expect } from 'vitest';
import {
  parseRar,
  openRarArchiveSession,
} from '../core/parsing/rar-parser';
import { createSyntheticRar, SAMPLE_JPEG } from './comic-test-helpers';

describe('RAR Archive Parser & Session Manager', () => {
  describe('Input Validation & Security', () => {
    it('rejects empty or truncated input buffer', async () => {
      await expect(parseRar(new ArrayBuffer(0))).rejects.toThrow(/file is empty/i);
      await expect(parseRar(new Uint8Array([1, 2, 3]).buffer)).rejects.toThrow(/not a valid RAR/i);
    });

    it('rejects non-RAR files with descriptive message', async () => {
      const dummy = Buffer.from('Not a real RAR file content');
      await expect(parseRar(dummy.buffer)).rejects.toThrow(/not a valid RAR archive/i);
    });
  });

  describe('Full RAR Parsing & Directory Tree', () => {
    it('parses a structured RAR archive preserving folders, metadata, and cover thumbnail', async () => {
      const rarBuffer = createSyntheticRar([
        { name: 'Novels/SciFi/foundation.txt', content: Buffer.from('Isaac Asimov - Foundation text') },
        { name: 'Novels/dune.txt', content: Buffer.from('Frank Herbert - Dune text') },
        { name: 'cover.jpg', content: SAMPLE_JPEG },
        { name: 'docs/notes.pdf', content: Buffer.from('%PDF-1.4 dummy stream') },
        { name: 'tools/setup.exe', content: Buffer.from('MZ binary executable') },
      ]);

      const result = await parseRar(rarBuffer, { filename: 'SciFi_Library.rar' });

      expect(result.metadata.title).toBe('SciFi_Library');
      expect(result.metadata.totalFiles).toBe(5);
      expect(result.coverImage).toContain('data:image/jpeg;base64,');

      // Verify entry types
      const txtEntry = result.entries.find((e) => e.name === 'dune.txt');
      expect(txtEntry).toBeDefined();
      expect(txtEntry?.kind).toBe('txt');
      expect(txtEntry?.isSupported).toBe(true);

      const pdfEntry = result.entries.find((e) => e.name === 'notes.pdf');
      expect(pdfEntry).toBeDefined();
      expect(pdfEntry?.kind).toBe('pdf');
      expect(pdfEntry?.isSupported).toBe(true);

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

    it('filters out macOS metadata and hidden files', async () => {
      const rarBuffer = createSyntheticRar([
        { name: '__MACOSX/._story.txt', content: Buffer.from('mac metadata') },
        { name: '.DS_Store', content: Buffer.from('desktop services') },
        { name: 'story.txt', content: Buffer.from('Real story content') },
      ]);

      const result = await parseRar(rarBuffer, { filename: 'CleanArchive.rar' });

      expect(result.metadata.totalFiles).toBe(1);
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].name).toBe('story.txt');
    });
  });

  describe('Interactive RAR Archive Session (On-Demand Extraction)', () => {
    it('allows on-demand extraction of text, arraybuffer, and blobs', async () => {
      const storyText = 'In a hole in the ground there lived a hobbit.';
      const rarBuffer = createSyntheticRar([
        { name: 'hobbit.txt', content: Buffer.from(storyText, 'utf8') },
        { name: 'illustration.jpg', content: SAMPLE_JPEG },
      ]);

      const session = await openRarArchiveSession(rarBuffer, { filename: 'Tolkien.rar' });

      expect(session.entries.length).toBe(2);

      // Extract text on-demand
      const extractedText = await session.getEntryText('hobbit.txt');
      expect(extractedText).toBe(storyText);

      // Extract array buffer on-demand
      const extractedBuffer = await session.getEntryData('hobbit.txt');
      expect(extractedBuffer.byteLength).toBe(Buffer.from(storyText).byteLength);

      // Extract blob on-demand
      const extractedBlob = await session.getEntryBlob('illustration.jpg', 'image/jpeg');
      expect(extractedBlob).toBeInstanceOf(Blob);
      expect(extractedBlob.type).toBe('image/jpeg');
      expect(extractedBlob.size).toBe(SAMPLE_JPEG.byteLength);

      // Query non-existent entry throws
      await expect(session.getEntryText('nonexistent.txt')).rejects.toThrow(/not found/i);

      // Close session
      session.close();
    });
  });
});
