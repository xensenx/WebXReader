import { describe, it, expect } from 'vitest';
import {
  parseMht,
  decodeRfc2047,
  parseMimeHeaders,
  decodeQuotedPrintableToBytes,
  decodeTextWithCharset,
  inlineMhtmlResources,
  splitHtmlIntoChapters,
} from '../core/parsing/mht-parser';

// Sample 1x1 valid transparent PNG base64
const SAMPLE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Sample 1x1 valid JPEG base64
const SAMPLE_JPEG_BASE64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

describe('MHTML / MHT Parser', () => {
  describe('RFC 2047 Header Decoding', () => {
    it('decodes base64 encoded subjects', () => {
      expect(decodeRfc2047('=?utf-8?B?V2ViWFJlYWRlcg==?=')).toBe('WebXReader');
      expect(decodeRfc2047('=?utf-8?B?5pel5pys6Kqe?=')).toBe('日本語');
    });

    it('decodes Q-encoded subjects with spaces', () => {
      expect(decodeRfc2047('=?utf-8?Q?WebXReader=20Guide?=')).toBe('WebXReader Guide');
      expect(decodeRfc2047('=?utf-8?Q?The_Great_Gatsby?=')).toBe('The Great Gatsby');
    });

    it('returns plain text when not RFC 2047 encoded', () => {
      expect(decodeRfc2047('Normal Plain Title')).toBe('Normal Plain Title');
      expect(decodeRfc2047(undefined)).toBe('');
    });
  });

  describe('MIME Header Parsing', () => {
    it('parses standard headers and unfolds multiline headers', () => {
      const rawHeaders = `From: <Saved by WebXReader>
Subject: Long Title That
 Was Folded On The Next Line
Content-Type: multipart/related;
 boundary="----=_NextPart_000_1234"
Date: Wed, 12 Oct 2022 14:32:00 +0000`;

      const headers = parseMimeHeaders(rawHeaders);
      expect(headers.get('from')).toBe('<Saved by WebXReader>');
      expect(headers.get('subject')).toBe('Long Title That Was Folded On The Next Line');
      expect(headers.get('content-type')).toContain('boundary="----=_NextPart_000_1234"');
      expect(headers.get('date')).toBe('Wed, 12 Oct 2022 14:32:00 +0000');
    });
  });

  describe('Quoted-Printable Decoding', () => {
    it('decodes soft line breaks and hex escapes to text', () => {
      const qp = 'Hello=20World!=20This is=\r\n a continuation line with a hyphen=2Dtest.';
      const bytes = decodeQuotedPrintableToBytes(qp);
      const text = decodeTextWithCharset(bytes, 'utf-8');

      expect(text).toBe('Hello World! This is a continuation line with a hyphen-test.');
    });
  });

  describe('Resource Inlining', () => {
    it('inlines stylesheets, img src, and background urls', () => {
      const resourceMap = new Map();
      resourceMap.set('https://example.com/style.css', {
        contentType: 'text/css',
        text: 'body { color: #111; }',
      });
      resourceMap.set('https://example.com/cover.png', {
        contentType: 'image/png',
        dataUrl: `data:image/png;base64,${SAMPLE_PNG_BASE64}`,
      });
      resourceMap.set('cid:banner@img', {
        contentType: 'image/jpeg',
        dataUrl: `data:image/jpeg;base64,${SAMPLE_JPEG_BASE64}`,
      });

      const html = `<html>
<head>
  <link rel="stylesheet" href="https://example.com/style.css">
</head>
<body style="background: url('https://example.com/cover.png')">
  <img src="https://example.com/cover.png" alt="Cover">
  <img src="cid:banner@img" alt="Banner">
</body>
</html>`;

      const inlined = inlineMhtmlResources(html, resourceMap, 'https://example.com/index.html');

      expect(inlined).toContain('<style data-mhtml-inlined="true">');
      expect(inlined).toContain('body { color: #111; }');
      expect(inlined).toContain(`src="data:image/png;base64,${SAMPLE_PNG_BASE64}"`);
      expect(inlined).toContain(`src="data:image/jpeg;base64,${SAMPLE_JPEG_BASE64}"`);
      expect(inlined).toContain(`url("data:image/png;base64,${SAMPLE_PNG_BASE64}")`);
    });
  });

  describe('Full MHT File Parsing', () => {
    const entity = (type: string, body: string, headers: string[] = []) =>
      [`Content-Type: ${type}`, ...headers, '', body].join('\n');
    const multipart = (type: string, boundary: string, parts: string[], headers: string[] = []) =>
      entity(`${type}; boundary=${boundary}`, parts.map((part) => `--${boundary}\n${part}\n`).join('') +
        `--${boundary}--`, headers);
    const image = (type: string, data: string, location: string) =>
      entity(type, data, ['Content-Transfer-Encoding: base64', `Content-Location: ${location}`]);

    it('selects a start container and resolves references only in its own and enclosing scopes', async () => {
      const location = 'https://example.com/cover.png?a=1&b=2';
      const inner = multipart('multipart/alternative', 'alternative', [
        entity('text/html', `<h3 id="heading"><span id="chapter-target">Main</span><img src="${location.replace('&', '&amp;')}"></h3>` +
          '<img src=local.png><img src=hidden.png>'),
        image('image/png', SAMPLE_PNG_BASE64, 'local.png'),
        multipart('multipart/related', 'child', [image('image/jpeg', SAMPLE_JPEG_BASE64, 'hidden.png')]),
      ], ['Content-ID: <root>']);
      const archive = multipart('multipart/related; start="<root>"', 'outer', [
        entity('text/html', '<p>Auxiliary HTML</p>'),
        inner,
        image('image/png', SAMPLE_PNG_BASE64, location),
        image('image/jpeg', SAMPLE_JPEG_BASE64, 'local.png'),
        multipart('multipart/related', 'sibling', [image('image/jpeg', SAMPLE_JPEG_BASE64, location)]),
      ]);
      const result = await parseMht(archive);

      expect(result.chapters[0].title).toBe('Main');
      const template = document.createElement('template');
      template.innerHTML = result.chapters[0].content ?? '';
      expect(template.content.querySelector('h3#heading #chapter-target')?.textContent).toBe('Main');
      const sources = Array.from(template.content.querySelectorAll('img'), (img) => img.getAttribute('src'));
      expect(sources).toEqual([`data:image/png;base64,${SAMPLE_PNG_BASE64}`,
        `data:image/png;base64,${SAMPLE_PNG_BASE64}`, null]);
      expect(result.rawText).not.toContain('Auxiliary HTML');
    });

    it('falls back to plain text when the preferred HTML sanitizes to an empty body', async () => {
      const archive = multipart('multipart/related; start="<root>"', 'outer', [
        entity('text/html', '<p>Auxiliary HTML</p>'),
        multipart('multipart/alternative', 'alternative', [
          entity('text/plain', 'Readable fallback'),
          entity('text/html', '<html><head><title>Empty page</title></head><body>&nbsp;<img src=missing.png></body></html>'),
        ], ['Content-ID: <root>']),
      ]);
      expect((await parseMht(archive)).rawText).toBe('Readable fallback');
    });

    it('keeps an image-only HTML alternative after resolving its quoted or unquoted source', async () => {
      for (const src of ['"cover&amp;art.png"', "'cover&amp;art.png'", 'cover&amp;art.png']) {
        const archive = multipart('multipart/related', 'outer', [
          entity('text/html', `<img src=${src}>`),
          entity('text/plain', 'Plain fallback'),
          image('image/png', SAMPLE_PNG_BASE64, 'cover&art.png'),
        ]);
        const result = await parseMht(archive);
        expect(result.rawText).toBe('');
        expect(result.chapters[0].content).toContain(`src="data:image/png;base64,${SAMPLE_PNG_BASE64}"`);
      }
    });

    it('ends each leading comment at its first terminator when sniffing generic parts', async () => {
      const archive = multipart('multipart/alternative', 'parts', [
        entity('application/octet-stream', '<!-- comment --> stray --><p>Not a document start</p>'),
        entity('text/plain', 'Plain fallback'),
      ]);
      expect((await parseMht(archive)).rawText).toBe('Plain fallback');
      expect((await parseMht('<!-- first --><!-- second --><p>Readable page</p>')).rawText).toBe('Readable page');
    });

    it('keeps captioned tables and rows intact while splitting at outside headings', async () => {
      const { chapters } = await parseMht(entity('text/html',
        '<h2>Tables</h2><table width="200"><caption>Single value</caption><tr><td>42</td></tr></table>' +
        '<table><tbody><tr><td><h3>Row 1</h3></td></tr><tr><td><h3>Row 2</h3></td></tr></tbody></table>' +
        '<h2>After tables</h2><p>Continue reading</p>'));

      expect(chapters.map(({ title }) => title)).toEqual(['Tables', 'After tables']);
      const template = document.createElement('template');
      template.innerHTML = chapters[0].content ?? '';
      expect(template.content.querySelector('table > caption')?.textContent).toBe('Single value');
      expect(template.content.querySelectorAll('table > tbody > tr')).toHaveLength(3);
      expect(template.content.querySelectorAll('tbody h3')).toHaveLength(2);
    });

    it('parses a multi-part MHT web archive into chapters, metadata, and inlined assets', async () => {
      const mhtContent = `From: Frank Herbert <author@arrakis.org>
Snapshot-Content-Location: https://example.com/dune.html
Subject: =?utf-8?Q?Dune=20Chronicles?=
Date: Sun, 15 Jan 2023 12:00:00 -0000
MIME-Version: 1.0
Content-Type: multipart/related;
\ttype="text/html";
\tboundary="----=_NextPart_000_DUNE_1234"

------=_NextPart_000_DUNE_1234
Content-Type: text/html; charset="utf-8"
Content-Transfer-Encoding: quoted-printable
Content-Location: https://example.com/dune.html

<!DOCTYPE html>
<html>
<head>
  <title>Dune Chronicles</title>
  <meta name="author" content="Frank Herbert">
  <meta name="description" content="A science fiction masterpiece.">
  <link rel="stylesheet" href="https://example.com/styles/main.css">
</head>
<body>
  <h1>Book One: Dune</h1>
  <p>A beginning is the time for taking the most delicate care.</p>
  <img src="https://example.com/images/cover.jpg" alt="Book Cover">
  <h2>The Arrakis Transfer</h2>
  <p>Duke Leto Atreides prepared his house for the perilous voyage.</p>
</body>
</html>

------=_NextPart_000_DUNE_1234
Content-Type: text/css; charset="utf-8"
Content-Transfer-Encoding: 7bit
Content-Location: https://example.com/styles/main.css

body { font-family: 'Georgia', serif; }
h1 { color: #8b0000; }

------=_NextPart_000_DUNE_1234
Content-Type: image/jpeg
Content-Transfer-Encoding: base64
Content-Location: https://example.com/images/cover.jpg

${SAMPLE_JPEG_BASE64}

------=_NextPart_000_DUNE_1234--
`;

      const result = await parseMht(mhtContent);

      expect(result.metadata.title).toBe('Dune Chronicles');
      expect(result.metadata.author).toBe('Frank Herbert');
      expect(result.metadata.description).toBe('A science fiction masterpiece.');
      expect(result.metadata.date).toBe('Sun, 15 Jan 2023 12:00:00 -0000');
      expect(result.metadata.sourceUrl).toBe('https://example.com/dune.html');

      expect(result.coverImage).toBeDefined();
      expect(result.coverImage).toContain('data:image/jpeg;base64,');

      expect(result.chapters.length).toBeGreaterThanOrEqual(2);
      expect(result.chapters[0].title).toBe('Book One: Dune');
      expect(result.chapters[1].title).toBe('The Arrakis Transfer');

      expect(result.rawText).toContain('A beginning is the time for taking the most delicate care.');
      expect(result.rawText).toContain('Duke Leto Atreides prepared his house');

      // Verify asset inlining in fullHtml
      expect(result.fullHtml).toContain('<style data-mhtml-inlined="true">');
      expect(result.fullHtml).toContain("font-family: 'Georgia', serif;");
      expect(result.fullHtml).toContain(`src="data:image/jpeg;base64,${SAMPLE_JPEG_BASE64}"`);
    });

    it('parses MHT with CID (Content-ID) references', async () => {
      const mhtCidContent = `From: <Saved by Blink>
Subject: Web Article
Content-Type: multipart/related; boundary="----=_Boundary_XYZ"

------=_Boundary_XYZ
Content-Type: text/html; charset="utf-8"
Content-Transfer-Encoding: 7bit
Content-Location: http://localhost/page.html

<html>
<body>
  <h1>CID Referenced Document</h1>
  <p>Here is an inline logo:</p>
  <img src="cid:logo123@webxreader" alt="Logo">
</body>
</html>

------=_Boundary_XYZ
Content-Type: image/png
Content-Transfer-Encoding: base64
Content-ID: <logo123@webxreader>
Content-Location: http://localhost/logo.png

${SAMPLE_PNG_BASE64}

------=_Boundary_XYZ--
`;

      const result = await parseMht(mhtCidContent);

      expect(result.metadata.title).toBe('Web Article');
      expect(result.coverImage).toContain('data:image/png;base64,');
      expect(result.fullHtml).toContain(`src="data:image/png;base64,${SAMPLE_PNG_BASE64}"`);
      expect(result.chapters.length).toBe(1);
      expect(result.chapters[0].title).toBe('CID Referenced Document');
      expect(result.chapters[0].content).toContain(`src="data:image/png;base64,${SAMPLE_PNG_BASE64}"`);
    });

    it('parses single-page MHT without headings as a single chapter', async () => {
      const mhtSingle = `Subject: Brief Note
Content-Type: multipart/related; boundary="----=_Part_1"

------=_Part_1
Content-Type: text/html; charset="utf-8"
Content-Transfer-Encoding: 7bit

<html>
<body>
  <p>Just a short paragraph with no headings.</p>
</body>
</html>

------=_Part_1--
`;

      const result = await parseMht(mhtSingle);
      expect(result.metadata.title).toBe('Brief Note');
      expect(result.chapters.length).toBe(1);
      expect(result.chapters[0].title).toBe('Brief Note');
      expect(result.rawText).toContain('Just a short paragraph with no headings.');
    });

    it('rejects empty input or missing boundary delimiter', async () => {
      await expect(parseMht('')).rejects.toThrow(/file is empty/i);
      await expect(parseMht('Just some text without headers')).rejects.toThrow(/missing top-level MIME/i);
      await expect(
        parseMht(`Content-Type: multipart/related\n\nNo boundary here`)
      ).rejects.toThrow(/boundary delimiter not found/i);
    });

    it('reads single-part HTML with a UTF-8 BOM and quoted-printable encoding', async () => {
      const archive = new TextEncoder().encode(
        '\uFEFFContent-Type: text/html; charset=utf-8\r\n' +
        'Content-Transfer-Encoding: quoted-printable\r\n\r\n' +
        '<title>Caf=C3=A9</title><p>One document.</p>',
      );
      const result = await parseMht(archive);
      expect(result.metadata.title).toBe('Caf\u00e9');
      expect(result.rawText).toContain('One document.');
    });

    it('reads standalone HTML and treats a single text/plain body as literal text', async () => {
      expect((await parseMht('<html><body><p>Saved page</p></body></html>')).rawText).toContain('Saved page');
      const plain = await parseMht('Content-Type: text/plain\n\nThis is <literal>\nSecond line.');
      expect(plain.chapters[0].content).toContain('&lt;literal&gt;<br>Second line.');
    });

    it('recovers missing and stale boundaries at the start of MIME lines', async () => {
      for (const parameter of ['', '; boundary=wrong']) {
        const result = await parseMht([
          `Content-Type: multipart/related${parameter}`,
          '',
          'Preamble with --unrelated-prose',
          '--actual',
          'Content-Type: text/html',
          '',
          '<p>Keep --actual inside the content.</p>',
          '--actual--',
          'Ignore this epilogue.',
        ].join('\r'));
        expect(result.rawText).toBe('Keep --actual inside the content.');
      }
    });

    it('finds nested HTML in a message envelope and honors the outer start Content-ID', async () => {
      const result = await parseMht([
        'Content-Type: multipart/related; boundary="outer;with.punctuation"; start="<root@example>"',
        '',
        '--outer;with.punctuation',
        'Content-Type: text/html',
        '',
        '<title>Auxiliary page</title><p>Auxiliary text</p>',
        '--outer;with.punctuation',
        'Content-Type: message/rfc822',
        '',
        'Content-Type: multipart/alternative; boundary=inner',
        '',
        '--inner',
        'Content-Type: text/plain',
        '',
        'Fallback text',
        '--inner',
        'Content-Type: text/html',
        'Content-ID: <root@example>',
        '',
        '<title>Main page</title><p>Main text</p>',
        '--inner--',
        '--outer;with.punctuation--',
      ].join('\r\n'));
      expect(result.metadata.title).toBe('Main page');
      expect(result.rawText).toContain('Main text');
    });

    it('recognizes HTML stored in a generic MIME part without using image parts as the document', async () => {
      const result = await parseMht([
        'Content-Type: multipart/related; boundary=parts',
        'Snapshot-Content-Location: https://example.com/cover.png',
        '',
        '--parts',
        'Content-Type: image/png',
        'Content-Location: https://example.com/cover.png',
        'Content-Transfer-Encoding: base64',
        '',
        SAMPLE_PNG_BASE64,
        '--parts',
        'Content-Type: application/octet-stream',
        '',
        '<!DOCTYPE html><html><title>Recovered</title><p>Chapter text</p></html>',
        '--parts--',
      ].join('\n'));
      expect(result.metadata.title).toBe('Recovered');
      expect(result.coverImage).toContain(SAMPLE_PNG_BASE64);
    });

    it('splits nested headings in complex real-world HTML structures', () => {
      const nestedHtml = `
<div class="main-container">
  <article>
    <header><h1>First Article</h1></header>
    <section><p>Some introductory paragraph content here.</p></section>
  </article>
  <div class="content-body">
    <h2>Sub-Section 1</h2>
    <p>Details about sub section 1.</p>
    <h2>Sub-Section 2</h2>
    <p>Details about sub section 2.</p>
  </div>
</div>`;
      const chapters = splitHtmlIntoChapters(nestedHtml, 'My Document');
      expect(chapters.length).toBe(3);
      expect(chapters[0].title).toBe('First Article');
      expect(chapters[1].title).toBe('Sub-Section 1');
      expect(chapters[2].title).toBe('Sub-Section 2');
    });

    it('reflows fixed-layout tables and skips empty headings while preserving data tables', async () => {
      const archive = 'Content-Type: text/html\n\n' +
        '<h2>About the author</h2><table width="359" height="40"><tr>' +
        '<td id="bio" height="40"><table width="200" height="10"><tr><td>' +
        '<p>All the prose stays in the reading flow.</p></td></tr></table></td></tr></table>' +
        '<h2>&nbsp;</h2><h2>Facts</h2><table height="50"><tr><th>Name</th><th>Value</th></tr>' +
        '<tr><td width="190">Year</td><td>1970</td></tr></table>';
      const { chapters } = await parseMht(archive);

      expect(chapters.map(({ title }) => title)).toEqual(['About the author', 'Facts']);
      expect(chapters[0].content).toContain('<span id="bio"></span>');
      expect(chapters[0].content).toContain('All the prose stays in the reading flow.');
      expect(chapters[0].content).not.toContain('<table');
      expect(chapters[1].content).toContain('<th>Value</th>');
      expect(chapters[1].content).not.toMatch(/(?:height|width)=/);
    });

    it('keeps image payloads out of chapter length calculations', () => {
      const image = '<img src="data:image/png;base64,' + SAMPLE_PNG_BASE64.repeat(600) + '">';
      const chapters = splitHtmlIntoChapters('<h1>Illustrations</h1><p>Intro</p>' + image + '<p>End</p>');
      expect(chapters).toHaveLength(1);
      expect(chapters[0].title).toBe('Illustrations');
      expect(chapters[0].content).toContain(image);
    });

    it('chunks oversized HTML without headings into readable chapters', () => {
      const longHtml = '<div>' + '<p>A paragraph of text that repeats to create a long document.</p>'.repeat(600) + '</div>';
      expect(longHtml.length).toBeGreaterThan(30000);

      const chapters = splitHtmlIntoChapters(longHtml, 'Long Book');
      expect(chapters.length).toBeGreaterThan(1);
      expect(chapters[0].title).toBe('Long Book');
      expect(chapters[1].title).toBe('Part 2');
    });
  });
});
