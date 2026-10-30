import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseMobi, decompressPalmDocLZ77 } from '../core/parsing/mobi-parser';

describe('MOBI & PalmDOC Parser', () => {
  describe('PalmDOC LZ77 Decompressor', () => {
    it('decompresses unmodified ASCII literals (0x09 - 0x7F)', () => {
      const input = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
      const output = decompressPalmDocLZ77(input);
      expect(new TextDecoder().decode(output)).toBe('Hello');
    });

    it('decompresses literal runs (0x01 - 0x08)', () => {
      // 0x03 followed by 3 bytes
      const input = new Uint8Array([0x03, 0x41, 0x42, 0x43]);
      const output = decompressPalmDocLZ77(input);
      expect(new TextDecoder().decode(output)).toBe('ABC');
    });

    it('decompresses space-character pairs (0xC0 - 0xFF)', () => {
      // 0xC0 to 0xFF produces space + (b ^ 0x80)
      // 'w' is 0x77. 0x77 ^ 0x80 = 0xF7.
      const input = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xf7, 0x6f, 0x72, 0x6c, 0x64]);
      const output = decompressPalmDocLZ77(input);
      expect(new TextDecoder().decode(output)).toBe('Hello world');
    });

    it('decompresses length-distance back-references (0x80 - 0xBF)', () => {
      // "ABCD" + back reference to "ABCD"
      // "ABCD" = 4 bytes: 0x41, 0x42, 0x43, 0x44
      // Back reference: distance 4, length 4
      // compound = 0x8000 | (dist << 3) | (len - 3) = 0x8000 | (4 << 3) | 1 = 0x8021
      const input = new Uint8Array([0x41, 0x42, 0x43, 0x44, 0x80, 0x21]);
      const output = decompressPalmDocLZ77(input);
      expect(new TextDecoder().decode(output)).toBe('ABCDABCD');
    });

    it('handles empty input gracefully', () => {
      const output = decompressPalmDocLZ77(new Uint8Array(0));
      expect(output.length).toBe(0);
    });
  });

  describe('MOBI Parsing from Fixture', () => {
    const fixturePath = path.resolve(__dirname, '../../fixtures/sample-novel.mobi');

    it('successfully parses fixtures/sample-novel.mobi with complete metadata and chapters', async () => {
      const buffer = fs.readFileSync(fixturePath);
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

      const result = await parseMobi(arrayBuffer, { autoDetectChapters: true });

      // Verify metadata
      expect(result.metadata.title).toBe('The Sign of the Four');
      expect(result.metadata.author).toBe('Sir Arthur Conan Doyle');
      expect(result.metadata.publisher).toBe('Spencer Blackett');
      expect(result.metadata.publicationDate).toBe('1890');
      expect(result.metadata.identifiers?.isbn).toBe('978-0-14-043907-6');
      expect(result.metadata.language).toBe('en');
      expect(result.metadata.description).toContain('Sherlock Holmes');

      // Verify cover
      expect(result.coverImage).toBeDefined();
      expect(result.coverImage).toContain('data:image/png;base64,');

      // Verify chapters
      expect(result.chapters.length).toBe(4); // Front matter + Chapter 1 + Chapter 2 + Chapter 3
      expect(result.chapters[0].title).toBe('The Sign of the Four');
      expect(result.chapters[1].title).toBe('Chapter 1: The Science of Deduction');
      expect(result.chapters[2].title).toBe('Chapter 2: The Statement of the Case');
      expect(result.chapters[3].title).toBe('Chapter 3: In Quest of a Solution');

      // Verify sanitized HTML content
      expect(result.chapters[1].content).toContain('Sherlock Holmes took his bottle');
      expect(result.chapters[1].content).not.toContain('<script');
      expect(result.chapters[1].content).not.toContain('<img');

      // Verify rawText
      expect(result.rawText).toContain('Sherlock Holmes took his bottle');
      expect(result.rawText).toContain('Miss Mary Morstan');
    });

    it('respects autoDetectChapters = false by returning a single comprehensive chapter', async () => {
      const buffer = fs.readFileSync(fixturePath);
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

      const result = await parseMobi(arrayBuffer, { autoDetectChapters: false });

      expect(result.chapters.length).toBe(1);
      expect(result.chapters[0].title).toBe('The Sign of the Four');
      expect(result.chapters[0].content).toContain('The Science of Deduction');
      expect(result.chapters[0].content).toContain('The Statement of the Case');
      expect(result.chapters[0].content).toContain('In Quest of a Solution');
    });
  });

  describe('Error Handling and Safety', () => {
    it('throws when file buffer is smaller than PDB header', async () => {
      const tinyBuffer = new ArrayBuffer(50);
      await expect(parseMobi(tinyBuffer)).rejects.toThrow('file size is smaller than PDB header');
    });

    it('throws when PDB reports zero records', async () => {
      const emptyPdb = new Uint8Array(100);
      const view = new DataView(emptyPdb.buffer);
      view.setUint16(76, 0, false); // 0 records
      await expect(parseMobi(emptyPdb.buffer)).rejects.toThrow('database contains zero records');
    });

    it('throws a helpful DRM error when encryptionType is non-zero', async () => {
      // Build a minimal header with encryptionType = 2 (Mobipocket DRM)
      const data = new Uint8Array(200);
      const view = new DataView(data.buffer);
      view.setUint16(76, 1, false); // 1 record
      view.setUint32(78, 100, false); // record 0 at offset 100

      // Record 0: PalmDOC header at offset 100
      view.setUint16(100, 2, false); // compression: 2
      view.setUint32(104, 100, false); // textLength
      view.setUint16(108, 1, false); // textRecordCount
      view.setUint16(110, 4096, false); // recordSize
      view.setUint16(112, 2, false); // encryptionType = 2 (DRM)

      await expect(parseMobi(data.buffer)).rejects.toThrow('protected with DRM encryption');
    });

    it('throws an error when compression algorithm is unsupported (e.g. HUFF/CDIC)', async () => {
      const data = new Uint8Array(200);
      const view = new DataView(data.buffer);
      view.setUint16(76, 1, false);
      view.setUint32(78, 100, false);

      view.setUint16(100, 17480, false); // HUFF/CDIC compression
      view.setUint32(104, 100, false);
      view.setUint16(108, 1, false);
      view.setUint16(110, 4096, false);
      view.setUint16(112, 0, false); // no DRM

      await expect(parseMobi(data.buffer)).rejects.toThrow('Unsupported MOBI compression type (17480)');
    });
  });
});
