import { describe, it, expect, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { importFile } from '../features/import/import-service';
import { clearDatabase, listBooks, getBookContent } from '../core/storage/database';

const DUMMY_IMAGE = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
  0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

describe('CBZ Import Integration', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('successfully imports a .cbz archive with metadata and stores original binary', async () => {
    const zip = new JSZip();
    zip.file('01.jpg', DUMMY_IMAGE);
    zip.file('02.jpg', DUMMY_IMAGE);
    zip.file('03.jpg', DUMMY_IMAGE);

    const comicInfo = `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo>
  <Title>The Golden Age</Title>
  <Series>Berserk</Series>
  <Number>3</Number>
  <Writer>Kentaro Miura</Writer>
  <Manga>YesAndRightToLeft</Manga>
</ComicInfo>`;
    zip.file('ComicInfo.xml', comicInfo);

    const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' });
    const file = new File([zipBuffer], 'berserk_vol3.cbz', {
      type: 'application/vnd.comicbook+zip',
    });

    const result = await importFile(file);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.book.sourceFormat).toBe('cbz');
    expect(result.book.title).toBe('Berserk #3: The Golden Age');
    expect(result.book.author).toBe('Kentaro Miura');
    expect(result.book.identifiers?.readingDirection).toBe('rtl');

    const books = await listBooks();
    expect(books.length).toBe(1);
    expect(books[0].id).toBe(result.book.id);

    const content = await getBookContent(result.book.id);
    expect(content).toBeDefined();
    expect(content?.format).toBe('cbz');
    expect(content?.originalFile).toBeDefined();
    expect(content?.originalFile?.byteLength).toBe(zipBuffer.byteLength);
  });
});
