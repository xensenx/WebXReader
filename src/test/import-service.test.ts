import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import CFB from 'cfb';
import { SAMPLE_JPEG, createSyntheticRar, createSyntheticCb7 } from './comic-test-helpers';
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
  it('successfully imports a Word document (.docx)', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Modern Word Document Testing</w:t></w:r></w:p>
  </w:body>
</w:document>`);

    const docxBuf = await zip.generateAsync({ type: 'uint8array' });
    const file = new File([docxBuf as unknown as BlobPart], 'modern_test.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    const result = await importFile(file);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.book.sourceFormat).toBe('docx');
      expect(result.book.title).toBe('modern test');
      expect(result.book.totalChapters).toBeGreaterThanOrEqual(1);
    }

    const books = await listBooks();
    expect(books.length).toBe(1);
    expect(books[0].sourceFormat).toBe('docx');
  });

  it('successfully imports a legacy Word document (.doc)', async () => {
    const cfb = CFB.utils.cfb_new();
    const text = 'Legacy Word Document Testing';
    const wordDoc = Buffer.alloc(0x0400 + text.length * 2);
    wordDoc.writeUInt16LE(0xa5ec, 0); // FIB magic
    wordDoc.writeUInt16LE(0x0200, 0x000a); // 1Table flag

    const textOffset = 0x0250;
    const textBuf = Buffer.from(text, 'latin1');
    textBuf.copy(wordDoc, textOffset);
    const compressedFc = (textOffset * 2) | 0x40000000;

    const clxBuf = Buffer.alloc(1 + 4 + 16);
    clxBuf.writeUInt8(0x02, 0);
    clxBuf.writeUInt32LE(16, 1);
    clxBuf.writeUInt32LE(0, 5);
    clxBuf.writeUInt32LE(text.length, 9);
    clxBuf.writeUInt16LE(0, 13);
    clxBuf.writeUInt32LE(compressedFc, 15);
    clxBuf.writeUInt16LE(0, 19);

    wordDoc.writeUInt32LE(0, 0x01a2);
    wordDoc.writeUInt32LE(clxBuf.length, 0x01a6);

    CFB.utils.cfb_add(cfb, '/WordDocument', wordDoc);
    CFB.utils.cfb_add(cfb, '/1Table', clxBuf);

    const docBytes = CFB.write(cfb, { type: 'buffer' });
    const file = new File([docBytes], 'legacy_test.doc', { type: 'application/msword' });

    const result = await importFile(file);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.book.sourceFormat).toBe('doc');
      expect(result.book.title).toBe('legacy test');
      expect(result.book.totalChapters).toBeGreaterThanOrEqual(1);
    }

    const books = await listBooks();
    expect(books.length).toBe(1);
    expect(books[0].sourceFormat).toBe('doc');
  });

  it('successfully imports a DjVu document (.djvu)', async () => {
    const infoPayload = Buffer.alloc(10);
    infoPayload.writeUInt16BE(100, 0);
    infoPayload.writeUInt16BE(200, 2);
    infoPayload.writeUInt8(26, 4);
    infoPayload.writeUInt8(0, 5);
    infoPayload.writeUInt16LE(100, 6);
    infoPayload.writeUInt8(22, 8);
    infoPayload.writeUInt8(0, 9);

    const infoChunk = Buffer.alloc(8 + 10);
    infoChunk.write('INFO', 0);
    infoChunk.writeUInt32BE(10, 4);
    infoPayload.copy(infoChunk, 8);

    const formPayload = Buffer.concat([Buffer.from('DJVU'), infoChunk]);
    const formHeader = Buffer.alloc(8);
    formHeader.write('FORM', 0);
    formHeader.writeUInt32BE(formPayload.length, 4);

    const djvuBytes = Buffer.concat([Buffer.from('AT&T'), formHeader, formPayload]);
    const file = new File([djvuBytes], 'sample_scanned_book.djvu', { type: 'image/vnd.djvu' });

    const result = await importFile(file);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.book.sourceFormat).toBe('djvu');
      expect(result.book.title).toBe('sample scanned book');
      expect(result.book.totalChapters).toBe(1);
    }

    const books = await listBooks();
    expect(books.length).toBe(1);
    expect(books[0].sourceFormat).toBe('djvu');
  });
  it('successfully imports a Comic Book RAR (.cbr)', async () => {
    const comicInfoXml = Buffer.from(
      `<?xml version="1.0"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Title>The Heroic Awakening</Title>
  <Series>WebX Heroes</Series>
  <Writer>Stan Lee</Writer>
</ComicInfo>`,
      'utf8'
    );

    const rarBuffer = createSyntheticRar([
      { name: 'ComicInfo.xml', content: comicInfoXml },
      { name: '001_cover.jpg', content: SAMPLE_JPEG },
      { name: '002_page.jpg', content: SAMPLE_JPEG },
    ]);

    const file = new File([rarBuffer], 'heroes_issue_1.cbr', { type: 'application/vnd.comicbook-rar' });
    const result = await importFile(file);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.book.sourceFormat).toBe('cbr');
      expect(result.book.title).toBe('WebX Heroes: The Heroic Awakening');
      expect(result.book.author).toBe('Stan Lee');
      expect(result.book.totalChapters).toBe(2);
    }

    const books = await listBooks();
    expect(books.length).toBe(1);
    expect(books[0].sourceFormat).toBe('cbr');
  });

  it('successfully imports a Comic Book 7-Zip (.cb7)', async () => {
    const comicInfoXml = Buffer.from(
      `<?xml version="1.0"?>
<ComicInfo>
  <Title>Cyber Dimension</Title>
  <Writer>Yukito Kishiro</Writer>
</ComicInfo>`,
      'utf8'
    );

    const cb7Buffer = await createSyntheticCb7([
      { name: 'ComicInfo.xml', content: comicInfoXml },
      { name: 'page_01.jpg', content: SAMPLE_JPEG },
      { name: 'page_02.jpg', content: SAMPLE_JPEG },
      { name: 'page_03.jpg', content: SAMPLE_JPEG },
    ]);

    const file = new File([cb7Buffer], 'cyber_dimension.cb7', { type: 'application/x-cb7' });
    const result = await importFile(file);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.book.sourceFormat).toBe('cb7');
      expect(result.book.title).toBe('Cyber Dimension');
      expect(result.book.author).toBe('Yukito Kishiro');
      expect(result.book.totalChapters).toBe(3);
    }

    const books = await listBooks();
    expect(books.length).toBe(1);
    expect(books[0].sourceFormat).toBe('cb7');
  });
});
