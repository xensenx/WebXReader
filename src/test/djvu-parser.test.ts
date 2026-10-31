import { describe, it, expect } from 'vitest';
import { parseDjvu } from '../core/parsing/djvu-parser';

function createTestDjvu({
  width = 120,
  height = 240,
  dpi = 150,
  antText,
  navText,
  txtText,
  invalidMagic = false,
  tooSmall = false,
}: {
  width?: number;
  height?: number;
  dpi?: number;
  antText?: string;
  navText?: string;
  txtText?: string;
  invalidMagic?: boolean;
  tooSmall?: boolean;
} = {}): Uint8Array {
  if (tooSmall) {
    return new Uint8Array([0x41, 0x54, 0x26]);
  }

  // 1. INFO chunk payload: 10 bytes
  const infoPayload = Buffer.alloc(10);
  infoPayload.writeUInt16BE(width, 0);
  infoPayload.writeUInt16BE(height, 2);
  infoPayload.writeUInt8(26, 4); // minor version
  infoPayload.writeUInt8(0, 5);  // major version
  infoPayload.writeUInt16LE(dpi, 6);
  infoPayload.writeUInt8(22, 8); // gamma
  infoPayload.writeUInt8(0, 9);  // flags

  const infoChunk = Buffer.alloc(8 + 10);
  infoChunk.write('INFO', 0);
  infoChunk.writeUInt32BE(10, 4);
  infoPayload.copy(infoChunk, 8);

  const chunks: Buffer[] = [infoChunk];

  // 2. Optional ANTa annotation chunk
  if (antText) {
    const antBuf = Buffer.from(antText, 'utf-8');
    const paddedLen = antBuf.length + (antBuf.length % 2);
    const antChunk = Buffer.alloc(8 + paddedLen);
    antChunk.write('ANTa', 0);
    antChunk.writeUInt32BE(antBuf.length, 4);
    antBuf.copy(antChunk, 8);
    chunks.push(antChunk);
  }

  // 3. Optional NAVM navigation / bookmarks chunk
  if (navText) {
    const navBuf = Buffer.from(navText, 'utf-8');
    const paddedLen = navBuf.length + (navBuf.length % 2);
    const navChunk = Buffer.alloc(8 + paddedLen);
    navChunk.write('NAVM', 0);
    navChunk.writeUInt32BE(navBuf.length, 4);
    navBuf.copy(navChunk, 8);
    chunks.push(navChunk);
  }

  // 4. Optional TXTa raw text chunk
  if (txtText) {
    const txtBuf = Buffer.from(txtText, 'utf-8');
    const paddedLen = txtBuf.length + (txtBuf.length % 2);
    const txtChunk = Buffer.alloc(8 + paddedLen);
    txtChunk.write('TXTa', 0);
    txtChunk.writeUInt32BE(txtBuf.length, 4);
    txtBuf.copy(txtChunk, 8);
    chunks.push(txtChunk);
  }

  const allChunks = Buffer.concat(chunks);
  const formPayload = Buffer.concat([Buffer.from('DJVU'), allChunks]);
  const formHeader = Buffer.alloc(8);
  formHeader.write('FORM', 0);
  formHeader.writeUInt32BE(formPayload.length, 4);

  const magic = invalidMagic ? Buffer.from('XXXX') : Buffer.from('AT&T');
  return new Uint8Array(Buffer.concat([magic, formHeader, formPayload]));
}

describe('DjVu Parser', () => {
  it('parses basic single-page DjVu document and checks page count', async () => {
    const djvuData = createTestDjvu({ width: 150, height: 300, dpi: 100 });
    const result = await parseDjvu(djvuData);

    expect(result.totalPages).toBe(1);
    expect(result.tableOfContents).toHaveLength(1);
    expect(result.tableOfContents[0].title).toBe('Page 1');
  });

  it('extracts metadata from ANTa annotation chunks', async () => {
    const antText = '(metadata (title "Treatise on Natural Philosophy") (author "Lord Kelvin") (year "1867") (comment "Foundational physics treatise"))';
    const djvuData = createTestDjvu({ antText });
    const result = await parseDjvu(djvuData);

    expect(result.metadata.title).toBe('Treatise on Natural Philosophy');
    expect(result.metadata.author).toBe('Lord Kelvin');
    expect(result.metadata.publicationDate).toBe('1867');
    expect(result.metadata.description).toBe('Foundational physics treatise');
  });

  it('extracts bookmarks / table of contents from NAVM chunk', async () => {
    const navText = '(bookmarks ("Kinematics" "#1") ("Dynamical Principles" "#1"))';
    const djvuData = createTestDjvu({ navText });
    const result = await parseDjvu(djvuData);

    expect(result.tableOfContents.length).toBeGreaterThanOrEqual(2);
    expect(result.tableOfContents[0].title).toBe('Kinematics');
    expect(result.tableOfContents[1].title).toBe('Dynamical Principles');
  });

  it('falls back to page-based chapters when no bookmarks are present', async () => {
    const djvuData = createTestDjvu();
    const result = await parseDjvu(djvuData);

    expect(result.tableOfContents).toHaveLength(1);
    expect(result.tableOfContents[0].title).toBe('Page 1');
  });

  it('rejects files smaller than header signature', async () => {
    const smallData = createTestDjvu({ tooSmall: true });
    await expect(parseDjvu(smallData)).rejects.toThrow(/smaller than DjVu header signature/i);
  });

  it('rejects files missing AT&T/FORM DjVu signature', async () => {
    const invalidData = createTestDjvu({ invalidMagic: true });
    await expect(parseDjvu(invalidData)).rejects.toThrow(/missing AT&T\/FORM/i);
  });
});
