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

      await expect(parseAzw3(data.buffer)).rejects.toThrow(/protected with (?:Amazon Kindle )?DRM encryption/i);
    });

    it('throws when compression type is unsupported', async () => {
      const data = new Uint8Array(200);
      const view = new DataView(data.buffer);
      view.setUint16(76, 1, false);
      view.setUint32(78, 100, false);

      view.setUint16(100, 9999, false); // Unknown compression
      view.setUint32(104, 100, false);
      view.setUint16(108, 1, false);
      view.setUint16(110, 4096, false);
      view.setUint16(112, 0, false);

      await expect(parseAzw3(data.buffer)).rejects.toThrow('Unsupported AZW3 compression type');
    });


    it('successfully parses AZW3 with HUFF/CDIC compression (type 17480)', async () => {
      // Build CDIC record
      const phrase0 = Buffer.from('<h1>HUFF KF8 Masterpiece</h1>');
      const phrase1 = Buffer.from('<p>Compressed via HuffDic</p>');

      const cdic = Buffer.alloc(16 + 4 + (2 + phrase0.length) + (2 + phrase1.length));
      cdic.write('CDIC', 0, 4, 'ascii');
      cdic.writeUInt32BE(0x10, 4);
      cdic.writeUInt32BE(2, 8); // phrases = 2
      cdic.writeUInt32BE(2, 12); // bits = 2
      cdic.writeUInt16BE(4, 16);
      cdic.writeUInt16BE(4 + 2 + phrase0.length, 18);

      cdic.writeUInt16BE(phrase0.length, 20);
      phrase0.copy(cdic, 22);

      const p1Off = 20 + 2 + phrase0.length;
      cdic.writeUInt16BE(phrase1.length, p1Off);
      phrase1.copy(cdic, p1Off + 2);

      // Build HUFF record
      const off1 = 24;
      const off2 = 24 + 256 * 4;
      const huff = Buffer.alloc(off2 + 64 * 4, 0);
      huff.write('HUFF', 0, 4, 'ascii');
      huff.writeUInt32BE(0x18, 4);
      huff.writeUInt32BE(off1, 8);
      huff.writeUInt32BE(off2, 12);

      huff.writeUInt32BE((0 << 8) | 0x80 | 8, off1 + 0 * 4); // 0x00 -> phrase0
      huff.writeUInt32BE((2 << 8) | 0x80 | 8, off1 + 1 * 4); // 0x01 -> phrase1

      // KF8 Record 0
      const kf8MobiHeader = Buffer.alloc(248, 0);
      kf8MobiHeader.write('MOBI', 0, 4, 'ascii');
      kf8MobiHeader.writeUInt32BE(248, 4);
      kf8MobiHeader.writeUInt32BE(2, 8);
      kf8MobiHeader.writeUInt32BE(65001, 12);
      kf8MobiHeader.writeUInt32BE(8, 20); // fileVersion = 8

      const kf8PalmDoc = Buffer.alloc(16);
      kf8PalmDoc.writeUInt16BE(17480, 0); // compression: 17480 (HUFF/CDIC)
      kf8PalmDoc.writeUInt32BE(phrase0.length + phrase1.length, 4);
      kf8PalmDoc.writeUInt16BE(1, 8); // 1 text record
      kf8PalmDoc.writeUInt16BE(0, 12); // encryptionType: 0

      const rec0 = Buffer.concat([kf8PalmDoc, kf8MobiHeader]);
      const rec1_text = Buffer.from([0x00, 0x01]); // expands to phrase0 + phrase1
      const rec2_huff = huff;
      const rec3_cdic = cdic;

      const allRecs = [rec0, rec1_text, rec2_huff, rec3_cdic];
      const numRecords = allRecs.length;

      const pdbHeader = Buffer.alloc(78);
      pdbHeader.write('Huff Book', 0, 'ascii');
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

      const binary = Buffer.concat([pdbHeader, recordHeaders, Buffer.alloc(2, 0), ...allRecs]);
      const arrayBuffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);

      const result = await parseAzw3(arrayBuffer, { autoDetectChapters: true });
      expect(result.chapters.length).toBeGreaterThanOrEqual(1);
      expect(result.chapters[0].content).toContain('HUFF KF8 Masterpiece');
      expect(result.rawText).toContain('Compressed via HuffDic');
    });
    it('handles dual-format KindleGen files where EXTH tag 121 points directly to the BOUNDARY record with non-zero padding', async () => {
      // In real KindleGen dual files, tag 121 points directly to BOUNDARY (not KF8 header),
      // and BOUNDARY often has trailing bytes/padding where byte 12 is non-zero.
      const mobi7Html = '<html><body><h1>MOBI7 Front</h1></body></html>';
      const kf8Xhtml = '<?xml version="1.0" encoding="utf-8"?><html><body><h1>KindleGen KF8</h1><p>Real Dual Format Book</p></body></html>';

      const m7Buf = Buffer.from(mobi7Html, 'utf-8');
      const kf8Buf = Buffer.from(kf8Xhtml, 'utf-8');

      // MOBI 7 Record 0 with tag 121 = 2 (pointing to BOUNDARY at record 2!)
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
      exthEntry.writeUInt32BE(2, 8); // kf8BoundaryOffset points to record 2 (BOUNDARY)!

      const exthHdr = Buffer.alloc(12);
      exthHdr.write('EXTH', 0, 4, 'ascii');
      exthHdr.writeUInt32BE(24, 4);
      exthHdr.writeUInt32BE(1, 8);

      const m7PalmDoc = Buffer.alloc(16);
      m7PalmDoc.writeUInt16BE(1, 0);
      m7PalmDoc.writeUInt32BE(m7Buf.length, 4);
      m7PalmDoc.writeUInt16BE(1, 8);

      const rec0_m7Record0 = Buffer.concat([m7PalmDoc, m7MobiHeader, exthHdr, exthEntry]);
      const rec1_m7Text = m7Buf;

      // Record 2: BOUNDARY record (16 bytes, byte 12 is non-zero 0x02 to simulate the previous bug)
      const rec2_boundary = Buffer.alloc(16, 0);
      rec2_boundary.write('BOUNDARY', 0, 8, 'ascii');
      rec2_boundary.writeUInt16BE(2, 12); // byte 12 is non-zero!

      // Record 3: Actual KF8 Record 0
      const kf8MobiHeader = Buffer.alloc(248, 0);
      kf8MobiHeader.write('MOBI', 0, 4, 'ascii');
      kf8MobiHeader.writeUInt32BE(248, 4);
      kf8MobiHeader.writeUInt32BE(2, 8);
      kf8MobiHeader.writeUInt32BE(65001, 12);
      kf8MobiHeader.writeUInt32BE(8, 20); // fileVersion = 8

      const kf8PalmDoc = Buffer.alloc(16);
      kf8PalmDoc.writeUInt16BE(1, 0); // compression: 1
      kf8PalmDoc.writeUInt32BE(kf8Buf.length, 4);
      kf8PalmDoc.writeUInt16BE(1, 8);
      kf8PalmDoc.writeUInt16BE(0, 12); // encryptionType: 0

      const rec3_kf8Record0 = Buffer.concat([kf8PalmDoc, kf8MobiHeader]);
      const rec4_kf8Text = kf8Buf;

      const allRecs = [rec0_m7Record0, rec1_m7Text, rec2_boundary, rec3_kf8Record0, rec4_kf8Text];
      const numRecords = allRecs.length;

      const pdbHeader = Buffer.alloc(78);
      pdbHeader.write('Dual KindleGen Book', 0, 'ascii');
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
      expect(result.chapters.length).toBeGreaterThanOrEqual(1);
      expect(result.chapters[0].content).toContain('KindleGen KF8');
      expect(result.rawText).toContain('Real Dual Format Book');
    });

    it('does not throw DRM false positive when encryptionType is 1 or non-zero but text records decompress cleanly', async () => {
      const html = '<html><body><h1>De-obfuscated Book</h1><p>Clean text content</p></body></html>';
      const htmlBuf = Buffer.from(html, 'utf-8');

      const kf8MobiHeader = Buffer.alloc(248, 0);
      kf8MobiHeader.write('MOBI', 0, 4, 'ascii');
      kf8MobiHeader.writeUInt32BE(248, 4);
      kf8MobiHeader.writeUInt32BE(2, 8);
      kf8MobiHeader.writeUInt32BE(65001, 12);
      kf8MobiHeader.writeUInt32BE(8, 20); // fileVersion = 8

      const kf8PalmDoc = Buffer.alloc(16);
      kf8PalmDoc.writeUInt16BE(1, 0); // compression: 1
      kf8PalmDoc.writeUInt32BE(htmlBuf.length, 4);
      kf8PalmDoc.writeUInt16BE(1, 8);
      kf8PalmDoc.writeUInt16BE(1, 12); // encryptionType = 1 (legacy / flag)

      const rec0 = Buffer.concat([kf8PalmDoc, kf8MobiHeader]);
      const rec1 = htmlBuf;
      const allRecs = [rec0, rec1];
      const numRecords = allRecs.length;

      const pdbHeader = Buffer.alloc(78);
      pdbHeader.write('Type1 Book', 0, 'ascii');
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

      const binary = Buffer.concat([pdbHeader, recordHeaders, Buffer.alloc(2, 0), ...allRecs]);
      const arrayBuffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);

      // Should decompress and parse without throwing DRM error
      const result = await parseAzw3(arrayBuffer, { autoDetectChapters: true });
      expect(result.chapters.length).toBeGreaterThanOrEqual(1);
      expect(result.chapters[0].content).toContain('De-obfuscated Book');
    });

    it('falls back to MOBI 7 when KF8 section text is encrypted in a dual-format file', async () => {
      const mobi7Html = '<html><body><h1>MOBI7 Fallback Success</h1><p>Readable fallback chapter</p></body></html>';
      const m7Buf = Buffer.from(mobi7Html, 'utf-8');

      // MOBI 7 Record 0 with tag 121 = 2
      const m7MobiHeader = Buffer.alloc(248, 0);
      m7MobiHeader.write('MOBI', 0, 4, 'ascii');
      m7MobiHeader.writeUInt32BE(248, 4);
      m7MobiHeader.writeUInt32BE(2, 8);
      m7MobiHeader.writeUInt32BE(65001, 12);
      m7MobiHeader.writeUInt32BE(6, 20);
      m7MobiHeader.writeUInt32BE(0x40, 112);

      const exthEntry = Buffer.alloc(12);
      exthEntry.writeUInt32BE(121, 0);
      exthEntry.writeUInt32BE(12, 4);
      exthEntry.writeUInt32BE(2, 8); // points to BOUNDARY

      const exthHdr = Buffer.alloc(12);
      exthHdr.write('EXTH', 0, 4, 'ascii');
      exthHdr.writeUInt32BE(24, 4);
      exthHdr.writeUInt32BE(1, 8);

      const m7PalmDoc = Buffer.alloc(16);
      m7PalmDoc.writeUInt16BE(1, 0);
      m7PalmDoc.writeUInt32BE(m7Buf.length, 4);
      m7PalmDoc.writeUInt16BE(1, 8);

      const rec0_m7Record0 = Buffer.concat([m7PalmDoc, m7MobiHeader, exthHdr, exthEntry]);
      const rec1_m7Text = m7Buf;

      const rec2_boundary = Buffer.alloc(16, 0);
      rec2_boundary.write('BOUNDARY', 0, 8, 'ascii');

      // KF8 Record 0 with encryptionType = 2
      const kf8MobiHeader = Buffer.alloc(248, 0);
      kf8MobiHeader.write('MOBI', 0, 4, 'ascii');
      kf8MobiHeader.writeUInt32BE(248, 4);
      kf8MobiHeader.writeUInt32BE(2, 8);
      kf8MobiHeader.writeUInt32BE(65001, 12);
      kf8MobiHeader.writeUInt32BE(8, 20);

      const kf8PalmDoc = Buffer.alloc(16);
      kf8PalmDoc.writeUInt16BE(2, 0); // compression: 2
      kf8PalmDoc.writeUInt32BE(100, 4);
      kf8PalmDoc.writeUInt16BE(1, 8);
      kf8PalmDoc.writeUInt16BE(2, 12); // DRM encrypted!

      const rec3_kf8Record0 = Buffer.concat([kf8PalmDoc, kf8MobiHeader]);
      // Encrypted ciphertext that fails PalmDOC LZ77 decompression
      const rec4_kf8EncryptedText = Buffer.from([0x81, 0x01, 0x82, 0x02, 0x83, 0x03]);

      const allRecs = [rec0_m7Record0, rec1_m7Text, rec2_boundary, rec3_kf8Record0, rec4_kf8EncryptedText];
      const numRecords = allRecs.length;

      const pdbHeader = Buffer.alloc(78);
      pdbHeader.write('Dual Fallback Book', 0, 'ascii');
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
      expect(result.chapters.length).toBeGreaterThanOrEqual(1);
      expect(result.chapters[0].content).toContain('MOBI7 Fallback Success');
    });
  });
});
