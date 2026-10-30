import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseRtf } from '../core/parsing/rtf-parser';

describe('RTF Parser', () => {
  it('parses basic styled RTF document with bold, italic, underline and strike', () => {
    const rtf = `{\\rtf1\\ansi\\ansicpg1252\\deff0
{\\fonttbl{\\f0 Calibri;}}
\\pard This is \\b bold\\b0 , \\i italic\\i0 , \\ul underlined\\ul0 , and \\strike strikethrough\\strike0  text.\\par
}`;

    const result = parseRtf(rtf);
    expect(result.chapters).toHaveLength(1);
    const content = result.chapters[0].content;

    expect(content).toContain('<strong>bold</strong>');
    expect(content).toContain('<em>italic</em>');
    expect(content).toContain('<u>underlined</u>');
    expect(content).toContain('<s>strikethrough</s>');
    expect(result.rawText).toContain('This is bold, italic, underlined, and strikethrough text.');
  });

  it('extracts metadata from \\info block', () => {
    const rtf = `{\\rtf1\\ansi
{\\info{\\title Journey to the Stars}{\\author Arthur C. Clarke}{\\doccomm A classic sci-fi novel}{\\keywords space, stars}}
\\pard Preamble text.\\par
}`;

    const result = parseRtf(rtf);
    expect(result.metadata.title).toBe('Journey to the Stars');
    expect(result.metadata.author).toBe('Arthur C. Clarke');
    expect(result.metadata.description).toBe('A classic sci-fi novel');
    expect(result.metadata.identifiers?.keywords).toBe('space, stars');
  });

  it('decodes unicode character escapes and hex bytes correctly', () => {
    const rtf = `{\\rtf1\\ansi\\ansicpg1252
\\pard \\u8220?Caf\\'e9\\u8221? \\emdash wonderful.\\par
}`;

    const result = parseRtf(rtf);
    const content = result.chapters[0].content;
    expect(content).toContain('“Café”');
    expect(content).toContain('—');
    expect(content).toContain('wonderful');
  });

  it('handles negative 16-bit unicode escapes', () => {
    const rtf = `{\\rtf1\\ansi\\uc1
\\pard Test \\u8217?s escape.\\par
}`;

    const result = parseRtf(rtf);
    expect(result.chapters[0].content).toContain('’s');
  });

  it('parses tables into structured HTML table elements', () => {
    const rtf = `{\\rtf1\\ansi
\\pard Chapter with a table:\\par
\\trowd\\cellx1000\\cellx2000
Header 1\\cell Header 2\\cell\\row
\\trowd\\cellx1000\\cellx2000
Value A\\cell Value B\\cell\\row
\\pard Text after table.\\par
}`;

    const result = parseRtf(rtf);
    const content = result.chapters[0].content;
    expect(content).toContain('<table class="rtf-table">');
    expect(content).toContain('<td>Header 1</td>');
    expect(content).toContain('<td>Header 2</td>');
    expect(content).toContain('<td>Value A</td>');
    expect(content).toContain('<td>Value B</td>');
  });

  it('preserves paragraph alignment classes', () => {
    const rtf = `{\\rtf1\\ansi
\\pard\\qc Centered Title\\par
\\pard\\qr Right aligned date\\par
\\pard\\qj Justified body paragraph.\\par
}`;

    const result = parseRtf(rtf);
    const content = result.chapters[0].content;
    expect(content).toContain('class="rtf-align-center"');
    expect(content).toContain('class="rtf-align-right"');
    expect(content).toContain('class="rtf-align-justify"');
  });

  it('detects multiple chapters by headings and page breaks', () => {
    const rtf = `{\\rtf1\\ansi
{\\info{\\title Novel with Chapters}}
\\pard\\qc\\b\\fs36 Title Page\\b0\\par
\\page
\\pard\\b\\fs28 Chapter 1: The Beginning\\b0\\fs24\\par
\\pard It was a dark and stormy night.\\par
\\page
\\pard\\b\\fs28 Chapter 2: The Journey\\b0\\fs24\\par
\\pard The road ahead was long.\\par
}`;

    const result = parseRtf(rtf, { autoDetectChapters: true });
    expect(result.chapters.length).toBeGreaterThanOrEqual(2);

    const titles = result.chapters.map((c) => c.title);
    expect(titles.some((t) => t.includes('Chapter 1'))).toBe(true);
    expect(titles.some((t) => t.includes('Chapter 2'))).toBe(true);
  });

  it('respects autoDetectChapters = false to return a single full document', () => {
    const rtf = `{\\rtf1\\ansi
\\pard Chapter 1\\par
\\pard Content 1\\par
\\page
\\pard Chapter 2\\par
\\pard Content 2\\par
}`;

    const result = parseRtf(rtf, { autoDetectChapters: false });
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].content).toContain('Chapter 1');
    expect(result.chapters[0].content).toContain('Chapter 2');
  });

  it('sanitizes any unsafe tags or scripts into safe inert markup', () => {
    const rtf = `{\\rtf1\\ansi
\\pard Safe text <script>alert("xss")</script> and <img src="x" onerror="alert(1)">\\par
}`;

    const result = parseRtf(rtf);
    const content = result.chapters[0].content;
    expect(content).not.toContain('<script');
    expect(content).not.toContain('<img');
    expect(content).toContain('&lt;script&gt;');
    expect(content).toContain('Safe text');
  });

  it('throws an error for non-RTF content', () => {
    expect(() => parseRtf('This is not an RTF file.')).toThrow('missing {\\rtf header');
  });

  it('correctly parses the sample RTF fixture file with metadata, chapters, and table', () => {
    const fixturePath = path.resolve(__dirname, '../../fixtures/sample-novel.rtf');
    const fixtureContent = fs.readFileSync(fixturePath, 'utf8');

    const result = parseRtf(fixtureContent, { autoDetectChapters: true });
    expect(result.metadata.author).toBe('Evelyn Vance');
    expect(result.chapters.length).toBeGreaterThanOrEqual(3);

    const chapterTitles = result.chapters.map((c) => c.title);
    expect(chapterTitles.some((t) => t.includes('Chapter 1'))).toBe(true);
    expect(chapterTitles.some((t) => t.includes('Chapter 2'))).toBe(true);
    expect(chapterTitles.some((t) => t.includes('Chapter 3'))).toBe(true);

    const allHtml = result.chapters.map((c) => c.content).join('\n');
    expect(allHtml).toContain('<table class="rtf-table">');
    expect(allHtml).toContain('Temporal Flux');
  });
});
