import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { parseFb2 } from '../core/parsing/fb2-parser';

describe('FictionBook (FB2) Parser', () => {
  const minimalFb2 = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <genre>science_fiction</genre>
      <author>
        <first-name>Arthur</first-name>
        <middle-name>C.</middle-name>
        <last-name>Clarke</last-name>
      </author>
      <book-title>Rendezvous with Rama</book-title>
      <annotation>
        <p>A giant alien cylinder enters the solar system.</p>
      </annotation>
      <date>1973</date>
      <lang>en</lang>
      <coverpage>
        <image l:href="#cover.jpg"/>
      </coverpage>
    </title-info>
    <publish-info>
      <publisher>Gollancz</publisher>
      <year>1973</year>
      <isbn>0-575-01587-X</isbn>
    </publish-info>
  </description>
  <body>
    <title>
      <p>Rendezvous with Rama</p>
    </title>
    <epigraph>
      <p>Any sufficiently advanced technology is indistinguishable from magic.</p>
      <text-author>Arthur C. Clarke</text-author>
    </epigraph>
    <section>
      <title>
        <p>Chapter 1: Spaceguard</p>
      </title>
      <p>Sooner or later, it was bound to happen.</p>
      <poem>
        <stanza>
          <v>Stars like diamond dust,</v>
          <v>Floating in the silent deep.</v>
        </stanza>
      </poem>
      <p>The radar station on Mars sounded the alert.</p>
    </section>
    <section>
      <title>
        <p>Chapter 2: Rama and Sita</p>
      </title>
      <p>The object was first catalogued with celestial metrics:</p>
      <table>
        <tr>
          <th>Metric</th>
          <th>Value</th>
        </tr>
        <tr>
          <td>Diameter</td>
          <td>20 km</td>
        </tr>
      </table>
      <p>Commander Norton prepared his crew.</p>
    </section>
  </body>
  <body name="notes">
    <section id="n1">
      <title><p>1</p></title>
      <p>Spaceguard was the planetary defense system.</p>
    </section>
  </body>
  <binary id="cover.jpg" content-type="image/jpeg">
    /9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=
  </binary>
</FictionBook>`;

  it('extracts complete metadata, authors, and cover image from FB2 XML', async () => {
    const result = await parseFb2(minimalFb2);

    expect(result.metadata.title).toBe('Rendezvous with Rama');
    expect(result.metadata.author).toBe('Arthur C. Clarke');
    expect(result.metadata.description).toContain('alien cylinder enters');
    expect(result.metadata.language).toBe('en');
    expect(result.metadata.publisher).toBe('Gollancz');
    expect(result.metadata.publicationDate).toBe('1973');
    expect(result.metadata.identifiers?.isbn).toBe('0-575-01587-X');
    expect(result.metadata.identifiers?.genre).toContain('science_fiction');

    expect(result.coverImage).toBeDefined();
    expect(result.coverImage).toContain('data:image/jpeg;base64,');
  });

  it('parses chapters, epigraphs, poems, and tables into semantic HTML', async () => {
    const result = await parseFb2(minimalFb2);

    expect(result.chapters.length).toBeGreaterThanOrEqual(3);

    const chapterTitles = result.chapters.map((c) => c.title);
    expect(chapterTitles.some((t) => t.includes('Chapter 1'))).toBe(true);
    expect(chapterTitles.some((t) => t.includes('Chapter 2'))).toBe(true);
    expect(chapterTitles.some((t) => t.includes('Footnotes & Endnotes'))).toBe(true);

    const fullHtml = result.chapters.map((c) => c.content).join('\n');
    expect(fullHtml).toContain('class="fb2-poem"');
    expect(fullHtml).toContain('class="fb2-verse"');
    expect(fullHtml).toContain('class="fb2-table"');
    expect(fullHtml).toContain('class="fb2-epigraph"');
    expect(fullHtml).toContain('Spaceguard');
  });

  it('supports nested section hierarchies with parent and child levels', async () => {
    const nestedFb2 = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    <title-info><book-title>Nested Novel</book-title></title-info>
  </description>
  <body>
    <section>
      <title><p>Part I: The Ascent</p></title>
      <p>Part I preamble content.</p>
      <section>
        <title><p>Chapter 1.1</p></title>
        <p>Section 1 text.</p>
      </section>
      <section>
        <title><p>Chapter 1.2</p></title>
        <p>Section 2 text.</p>
      </section>
    </section>
  </body>
</FictionBook>`;

    const result = await parseFb2(nestedFb2);
    expect(result.chapters.length).toBe(3);

    expect(result.chapters[0].title).toBe('Part I: The Ascent');
    expect(result.chapters[0].level).toBe(0);

    expect(result.chapters[1].title).toBe('Chapter 1.1');
    expect(result.chapters[1].level).toBe(1);

    expect(result.chapters[2].title).toBe('Chapter 1.2');
    expect(result.chapters[2].level).toBe(1);
  });

  it('respects autoDetectChapters = false by returning a single unified chapter', async () => {
    const result = await parseFb2(minimalFb2, { autoDetectChapters: false, includeNotes: false });
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].content).toContain('Chapter 1');
    expect(result.chapters[0].content).toContain('Chapter 2');
  });

  it('can parse a compressed .fb2.zip file archive', async () => {
    const zip = new JSZip();
    zip.file('book.fb2', minimalFb2);
    const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' });

    const result = await parseFb2(zipBuffer);
    expect(result.metadata.title).toBe('Rendezvous with Rama');
    expect(result.chapters.length).toBeGreaterThanOrEqual(2);
  });

  it('sanitizes unsafe tags or attributes', async () => {
    const unsafeFb2 = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description><title-info><book-title>Safe Book</book-title></title-info></description>
  <body>
    <section>
      <title><p>Chapter 1</p></title>
      <p>Harmless text <script>alert("hacked")</script> with <img src="x" onerror="alert(1)" /></p>
    </section>
  </body>
</FictionBook>`;

    const result = await parseFb2(unsafeFb2);
    const content = result.chapters[0].content;
    expect(content).not.toContain('<script');
    expect(content).not.toContain('<img');
    expect(content).not.toContain('onerror');
    expect(content).toContain('Harmless text');
  });

  it('parses the sample fixture file fixtures/sample-novel.fb2 correctly', async () => {
    const fixturePath = path.resolve(__dirname, '../../fixtures/sample-novel.fb2');
    const fixtureContent = fs.readFileSync(fixturePath, 'utf8');

    const result = await parseFb2(fixtureContent);
    expect(result.metadata.title).toBe('The Galactic Beacon');
    expect(result.metadata.author).toBe('Isaac Asimov');
    expect(result.coverImage).toBeDefined();

    const titles = result.chapters.map((c) => c.title);
    expect(titles.some((t) => t.includes('Chapter 1'))).toBe(true);
    expect(titles.some((t) => t.includes('Chapter 2'))).toBe(true);
    expect(titles.some((t) => t.includes('Footnotes'))).toBe(true);
  });
});
