import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseAzw3 } from '../core/parsing/azw3-parser';

describe('AZW3 & Kindle Format 8 (KF8) Parser', () => {
  const fixturePath = path.resolve(__dirname, '../../fixtures/sample-novel.azw3');

  describe('Standalone AZW3 Parsing from Fixture', () => {
    it('successfully parses fixtures/sample-novel.azw3 with complete metadata, cover, and chapters', async () => {
      const buffer = fs.readFileSync(fixturePath);
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

      const result = await parseAzw3(arrayBuffer, { autoDetectChapters: true });

      // Verify metadata
      expect(result.metadata.title).toBe('A Study in Scarlet');
      expect(result.metadata.author).toBe('Sir Arthur Conan Doyle');
      expect(result.metadata.publisher).toBe('Ward, Lock & Co.');
      expect(result.metadata.publicationDate).toBe('1887');
      expect(result.metadata.identifiers?.isbn).toBe('978-0-14-043908-3');
      expect(result.metadata.language).toBe('en');
      expect(result.metadata.description).toContain('Sherlock Holmes');

      // Verify cover
      expect(result.coverImage).toBeDefined();
      expect(result.coverImage).toContain('data:image/png;base64,');

      // Verify chapters (Title page + 3 chapters)
      expect(result.chapters.length).toBe(4);
      expect(result.chapters[0].title).toBe('A Study in Scarlet');
      expect(result.chapters[1].title).toBe('Chapter 1: Mr. Sherlock Holmes');
      expect(result.chapters[2].title).toBe('Chapter 2: The Science of Deduction');
      expect(result.chapters[3].title).toBe('Chapter 3: The Lauriston Garden Mystery');

      // Verify sanitized HTML content
      expect(result.chapters[1].content).toContain('Fifth Northumberland Fusiliers');
      expect(result.chapters[1].content).not.toContain('<script');
      expect(result.chapters[1].content).not.toContain('<img');

      // Verify rawText
      expect(result.rawText).toContain('Sherlock Holmes');
      expect(result.rawText).toContain('221B, Baker Street');
    });

    it('returns a single comprehensive chapter when autoDetectChapters is false', async () => {
      const buffer = fs.readFileSync(fixturePath);
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

      const result = await parseAzw3(arrayBuffer, { autoDetectChapters: false });

      expect(result.chapters.length).toBe(1);
      expect(result.chapters[0].title).toBe('A Study in Scarlet');
      expect(result.chapters[0].content).toContain('Mr. Sherlock Holmes');
      expect(result.chapters[0].content).toContain('The Science of Deduction');
      expect(result.chapters[0].content).toContain('The Lauriston Garden Mystery');
    });
  });

  describe('Dual-Format MOBI/KF8 Hybrid Handling', () => {
    it('detects EXTH tag 121 and extracts the high-fidelity KF8 section instead of MOBI7 fallback', async () => {
      // Create minimal dual format binary
      const mobi7Html = '<html><body><h1>Legacy MOBI7</h1></body></html>';
      const kf8Xhtml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>KF8 Masterpiece</title></head>
<body>
  <h1>KF8 Masterpiece</h1>
  <p>By High Fidelity Author</p>
  <div style="page-break-before:always"></div>
  <h2>Chapter 1: The Modern Stream</h2>
  <p>Extracted from KF8 section.</p>
</body>
</html>`;

      const m7Buf = Buffer.from(mobi7Html, 'utf-8');
      const kf8Buf = Buffer.from(kf8Xhtml, 'utf-8');

      // KF8 Record 0
      const kf8MobiHeader = Buffer.alloc(248, 0);
      kf8MobiHeader.write('MOBI', 0, 4, 'ascii');
      kf8MobiHeader.writeUInt32BE(248, 4);
      kf8MobiHeader.writeUInt32BE(2, 8);
      kf8MobiHeader.writeUInt32BE(65001, 12);
      kf8MobiHeader.writeUInt32BE(8, 20); // fileVersion = 8

      const kf8Title = Buffer.from('KF8 Masterpiece', 'utf-8');
      const kf8PalmDoc = Buffer.alloc(16);
      kf8PalmDoc.writeUInt16BE(1, 0); // compression: 1
      kf8PalmDoc.writeUInt32BE(kf8Buf.length, 4);
      kf8PalmDoc.writeUInt16BE(1, 8);

      const rec3_kf8Record0 = Buffer.concat([kf8PalmDoc, kf8MobiHeader, kf8Title]);

      // MOBI 7 Record 0 with tag 121 = 3
      const m7MobiHeader = Buffer.alloc(248, 0);
      m7MobiHeader.write('MOBI', 0, 4, 'ascii');
      m7MobiHeader.writeUInt32BE(248, 4);
      m7MobiHeader.writeUInt32BE(2, 8);
      m7MobiHeader.writeUInt32BE(65001, 12);
      m7MobiHeader.writeUInt32BE(6, 20); // fileVersion = 6
      m7MobiHeader.writeUInt32BE(0x40, 112); // EXTH present

      const exthEntry = Buffer.alloc(12);
      exthEntry.writeUInt32BE(121, 0); // tag 121
      exthEntry.writeUInt32BE(12, 4);
      exthEntry.writeUInt32BE(3, 8); // kf8 starts at record index 3

      const exthHdr = Buffer.alloc(12);
      exthHdr.write('EXTH', 0, 4, 'ascii');
      exthHdr.writeUInt32BE(24, 4);
      exthHdr.writeUInt32BE(1, 8);

      const m7ExthBlock = Buffer.concat([exthHdr, exthEntry]);
      const m7PalmDoc = Buffer.alloc(16);
      m7PalmDoc.writeUInt16BE(1, 0);
      m7PalmDoc.writeUInt32BE(m7Buf.length, 4);
      m7PalmDoc.writeUInt16BE(1, 8);

      const rec0_m7Record0 = Buffer.concat([m7PalmDoc, m7MobiHeader, m7ExthBlock]);
      const rec1_m7Text = m7Buf;
      const rec2_boundary = Buffer.from('BOUNDARY');
      const rec4_kf8Text = kf8Buf;

      const allRecs = [rec0_m7Record0, rec1_m7Text, rec2_boundary, rec3_kf8Record0, rec4_kf8Text];
      const numRecords = allRecs.length;

      const pdbHeader = Buffer.alloc(78);
      pdbHeader.write('Dual Book', 0, 'ascii');
      pdbHeader.write('BOOK', 60, 4, 'ascii');
      pdbHeader.write('MOBI', 64, 4, 'ascii');
      pdbHeader.writeUInt16BE(numRecords, 76);

      const recordListSize = numRecords * 8;
      let curOff = 78 + recordListSize + 2;
      const recordHeaders = Buffer.alloc(recordListSize);
      for (let i = 0; i < numRecords; i++) {
        recordHeaders.writeUInt32BE(curOff, i * 8);
        recordHeaders.writeUInt8(0, i * 8 + 4);
        curOff += allRecs[i].length;
      }

      const dualBinary = Buffer.concat([pdbHeader, recordHeaders, Buffer.alloc(2, 0), ...allRecs]);
      const arrayBuffer = dualBinary.buffer.slice(dualBinary.byteOffset, dualBinary.byteOffset + dualBinary.byteLength);

      const result = await parseAzw3(arrayBuffer, { autoDetectChapters: true });

      // Verifies it parsed the KF8 chapter rather than the MOBI 7 fallback
      expect(result.chapters.length).toBe(2);
      expect(result.chapters[1].title).toBe('Chapter 1: The Modern Stream');
      expect(result.chapters[1].content).toContain('Extracted from KF8 section.');
      expect(result.rawText).not.toContain('Legacy MOBI7');
    });
  });

  describe('Error Handling and Safety', () => {
    it('throws when buffer is smaller than PDB header', async () => {
      const tinyBuffer = new ArrayBuffer(50);
      await expect(parseAzw3(tinyBuffer)).rejects.toThrow('file size is smaller than PDB header');
    });

    it('throws when database reports zero records', async () => {
      const emptyPdb = new Uint8Array(100);
      const view = new DataView(emptyPdb.buffer);
      view.setUint16(76, 0, false);
      await expect(parseAzw3(emptyPdb.buffer)).rejects.toThrow('database contains zero records');
    });

    it('throws when file is protected by DRM encryption', async () => {
      const data = new Uint8Array(200);
      const view = new DataView(data.buffer);
      view.setUint16(76, 1, false);
      view.setUint32(78, 100, false);

      view.setUint16(100, 2, false); // compression
      view.setUint32(104, 100, false);
      view.setUint16(108, 1, false);
      view.setUint16(110, 4096, false);
      view.setUint16(112, 2, false); // encryptionType = 2 (DRM)

      await expect(parseAzw3(data.buffer)).rejects.toThrow('protected with DRM encryption');
    });

    it('throws when compression type is unsupported', async () => {
      const data = new Uint8Array(200);
      const view = new DataView(data.buffer);
      view.setUint16(76, 1, false);
      view.setUint32(78, 100, false);

      view.setUint16(100, 17480, false); // HUFF/CDIC
      view.setUint32(104, 100, false);
      view.setUint16(108, 1, false);
      view.setUint16(110, 4096, false);
      view.setUint16(112, 0, false);

      await expect(parseAzw3(data.buffer)).rejects.toThrow('Unsupported AZW3 compression type');
    });
  });
});
