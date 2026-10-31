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
        parseMht(`Content-Type: text/plain\n\nNo boundary here`)
      ).rejects.toThrow(/boundary delimiter not found/i);
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
