import { describe, it, expect } from 'vitest';
import { parseCbr } from '../core/parsing/cbr-parser';
import { parseCb7 } from '../core/parsing/cb7-parser';
import { detectComicFormat } from '../core/parsing/comic-archive';
import { openComicArchiveSession } from '../core/parsing/sevenzip-extractor';
import { SAMPLE_JPEG, createSyntheticRar, createSyntheticCb7 } from './comic-test-helpers';

describe('Comic Formats: CBR & CB7 Support', () => {
  it('detects comic format from binary headers correctly', async () => {
    const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
    const rarBytes = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
    const sevenZipBytes = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
    const unknownBytes = Buffer.from([0x00, 0x01, 0x02, 0x03]);

    expect(detectComicFormat(zipBytes)).toBe('cbz');
    expect(detectComicFormat(rarBytes)).toBe('cbr');
    expect(detectComicFormat(sevenZipBytes)).toBe('cb7');
    expect(detectComicFormat(unknownBytes)).toBe('unknown');
  });

  describe('CB7 Parser (.cb7, .7z)', () => {
    it('parses a basic .cb7 archive and extracts sorted pages', async () => {
      const cb7Data = await createSyntheticCb7([
        { name: 'page10.jpg', content: SAMPLE_JPEG },
        { name: 'page2.jpg', content: SAMPLE_JPEG },
        { name: 'page1.jpg', content: SAMPLE_JPEG },
      ]);

      const result = await parseCb7(cb7Data);
      expect(result.totalPages).toBe(3);
      // Natural sort verification: page1, page2, page10
      expect(result.pageFileNames).toEqual(['page1.jpg', 'page2.jpg', 'page10.jpg']);
      expect(result.tableOfContents.length).toBeGreaterThan(0);
      expect(result.coverImage).toBeDefined();
    });

    it('extracts ComicInfo.xml metadata and manga reading direction from .cb7', async () => {
      const comicInfoXml = Buffer.from(`
        <ComicInfo>
          <Title>The Final Battle</Title>
          <Series>Attack on Titan</Series>
          <Number>34</Number>
          <Volume>4</Volume>
          <Writer>Hajime Isayama</Writer>
          <Manga>YesAndRightToLeft</Manga>
        </ComicInfo>
      `);

      const cb7Data = await createSyntheticCb7([
        { name: '01.png', content: SAMPLE_JPEG },
        { name: '02.png', content: SAMPLE_JPEG },
        { name: 'ComicInfo.xml', content: comicInfoXml },
      ]);

      const result = await parseCb7(cb7Data);
      expect(result.metadata.title).toBe('Attack on Titan Vol. 4 #34: The Final Battle');
      expect(result.metadata.author).toBe('Hajime Isayama');
      expect(result.readingDirection).toBe('rtl');
    });

    it('rejects .cb7 archive when no image files are present', async () => {
      const cb7Data = await createSyntheticCb7([
        { name: 'readme.txt', content: Buffer.from('No images here') },
      ]);

      await expect(parseCb7(cb7Data)).rejects.toThrow(/No readable image files found/i);
    });
  });

  describe('CBR Parser (.cbr, .rar)', () => {
    it('parses a valid RAR4 .cbr archive and extracts pages', async () => {
      const cbrData = createSyntheticRar([
        { name: 'p02.jpg', content: SAMPLE_JPEG },
        { name: 'p01.jpg', content: SAMPLE_JPEG },
      ]);

      const result = await parseCbr(cbrData);
      expect(result.totalPages).toBe(2);
      expect(result.pageFileNames).toEqual(['p01.jpg', 'p02.jpg']);
      expect(result.coverImage).toBeDefined();
    });

    it('extracts ComicInfo.xml metadata from .cbr', async () => {
      const comicInfoXml = Buffer.from(`
        <ComicInfo>
          <Title>Year One</Title>
          <Series>Batman</Series>
          <Number>404</Number>
          <Writer>Frank Miller</Writer>
          <Penciller>David Mazzucchelli</Penciller>
          <Summary>The origin story of the Dark Knight.</Summary>
        </ComicInfo>
      `);

      const cbrData = createSyntheticRar([
        { name: 'cover.jpg', content: SAMPLE_JPEG },
        { name: 'page1.jpg', content: SAMPLE_JPEG },
        { name: 'ComicInfo.xml', content: comicInfoXml },
      ]);

      const result = await parseCbr(cbrData);
      expect(result.metadata.title).toBe('Batman #404: Year One');
      expect(result.metadata.author).toContain('Frank Miller');
      expect(result.metadata.author).toContain('David Mazzucchelli (Art)');
      expect(result.metadata.description).toBe('The origin story of the Dark Knight.');
    });

    it('rejects .cbr archive when no image files are found', async () => {
      const cbrData = createSyntheticRar([
        { name: 'notes.txt', content: Buffer.from('Just text') },
      ]);

      await expect(parseCbr(cbrData)).rejects.toThrow(/No readable image files found/i);
    });
  });

  describe('Interactive Comic Archive Session', () => {
    it('opens a comic archive session, reads page blobs, and closes cleanly', async () => {
      const cb7Data = await createSyntheticCb7([
        { name: 'ch1/01.jpg', content: SAMPLE_JPEG },
        { name: 'ch1/02.jpg', content: SAMPLE_JPEG },
      ]);

      const session = await openComicArchiveSession(cb7Data, 'cb7');
      expect(session.pageNames.length).toBe(2);

      const blob0 = await session.getPageBlob(0);
      expect(blob0).toBeDefined();
      expect(blob0?.size).toBeGreaterThan(0);

      const data1 = await session.getPageData(1);
      expect(data1).toBeDefined();
      expect(data1?.length).toBeGreaterThan(0);

      // Verify out of bounds handling
      const blobInvalid = await session.getPageBlob(99);
      expect(blobInvalid).toBeUndefined();

      // Clean closure
      session.close();
      const afterClose = await session.getPageBlob(0);
      expect(afterClose).toBeUndefined();
    });
  });
});
