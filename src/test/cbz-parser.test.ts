import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseCbz, naturalCompare } from '../core/parsing/cbz-parser';

// Minimal 1x1 transparent GIF bytes
const DUMMY_IMAGE = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
  0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

describe('CBZ Parser', () => {
  it('correctly sorts image filenames naturally', () => {
    const filenames = ['page10.jpg', 'page2.jpg', 'page1.jpg', 'page20.jpg', 'page3.jpg'];
    filenames.sort(naturalCompare);
    expect(filenames).toEqual(['page1.jpg', 'page2.jpg', 'page3.jpg', 'page10.jpg', 'page20.jpg']);
  });

  it('rejects archive with no valid images', async () => {
    const zip = new JSZip();
    zip.file('readme.txt', 'Just some notes');
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });

    await expect(parseCbz(buffer)).rejects.toThrow('No readable image files found in the CBZ archive.');
  });

  it('ignores __MACOSX, .DS_Store, and hidden files', async () => {
    const zip = new JSZip();
    zip.file('__MACOSX/._page1.jpg', DUMMY_IMAGE);
    zip.file('.DS_Store', 'junk');
    zip.file('Thumbs.db', 'cache');
    zip.file('01.jpg', DUMMY_IMAGE);
    zip.file('02.jpg', DUMMY_IMAGE);

    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    const result = await parseCbz(buffer);

    expect(result.totalPages).toBe(2);
    expect(result.pageFileNames).toEqual(['01.jpg', '02.jpg']);
  });

  it('parses ComicInfo.xml metadata and manga reading direction', async () => {
    const zip = new JSZip();
    zip.file('01.png', DUMMY_IMAGE);
    zip.file('02.png', DUMMY_IMAGE);

    const comicInfoXml = `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>Dawn of the World</Title>
  <Series>One Piece</Series>
  <Number>1</Number>
  <Writer>Eiichiro Oda</Writer>
  <Summary>Luffy begins his journey to become the Pirate King.</Summary>
  <Publisher>Shueisha</Publisher>
  <Year>1997</Year>
  <Month>7</Month>
  <Day>22</Day>
  <Manga>YesAndRightToLeft</Manga>
</ComicInfo>`;

    zip.file('ComicInfo.xml', comicInfoXml);
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    const result = await parseCbz(buffer);

    expect(result.metadata.title).toBe('One Piece #1: Dawn of the World');
    expect(result.metadata.author).toBe('Eiichiro Oda');
    expect(result.metadata.description).toBe('Luffy begins his journey to become the Pirate King.');
    expect(result.metadata.publisher).toBe('Shueisha');
    expect(result.metadata.publicationDate).toBe('1997-07-22');
    expect(result.readingDirection).toBe('rtl');
  });

  it('builds table of contents from ComicInfo.xml bookmarks', async () => {
    const zip = new JSZip();
    zip.file('01.png', DUMMY_IMAGE);
    zip.file('02.png', DUMMY_IMAGE);
    zip.file('03.png', DUMMY_IMAGE);
    zip.file('04.png', DUMMY_IMAGE);

    const comicInfoXml = `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo>
  <Title>Super Comic</Title>
  <Pages>
    <Page Image="0" Type="FrontCover" Bookmark="Cover" />
    <Page Image="1" Bookmark="Chapter 1: Arrival" />
    <Page Image="3" Bookmark="Chapter 2: Climax" />
  </Pages>
</ComicInfo>`;

    zip.file('ComicInfo.xml', comicInfoXml);
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    const result = await parseCbz(buffer);

    expect(result.tableOfContents.length).toBe(3);
    expect(result.tableOfContents[0].title).toBe('Cover');
    expect(result.tableOfContents[0].href).toBe('1');
    expect(result.tableOfContents[1].title).toBe('Chapter 1: Arrival');
    expect(result.tableOfContents[1].href).toBe('2');
    expect(result.tableOfContents[2].title).toBe('Chapter 2: Climax');
    expect(result.tableOfContents[2].href).toBe('4');
  });

  it('builds table of contents from nested directory folders when no bookmarks exist', async () => {
    const zip = new JSZip();
    zip.file('Chapter 1/01.jpg', DUMMY_IMAGE);
    zip.file('Chapter 1/02.jpg', DUMMY_IMAGE);
    zip.file('Chapter 2/01.jpg', DUMMY_IMAGE);
    zip.file('Chapter 2/02.jpg', DUMMY_IMAGE);

    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    const result = await parseCbz(buffer);

    expect(result.tableOfContents.length).toBe(2);
    expect(result.tableOfContents[0].title).toBe('Chapter 1');
    expect(result.tableOfContents[0].href).toBe('1');
    expect(result.tableOfContents[1].title).toBe('Chapter 2');
    expect(result.tableOfContents[1].href).toBe('3');
  });
});
