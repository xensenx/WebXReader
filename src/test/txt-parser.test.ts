import { describe, it, expect } from 'vitest';
import { parseTxt } from '../core/parsing/txt-parser';

describe('TXT Parser', () => {
  it('normalizes CRLF line endings and strips UTF-8 BOM', () => {
    const rawWithBomAndCrlf = '\uFEFFLine 1\r\nLine 2\r\nLine 3';
    const result = parseTxt(rawWithBomAndCrlf, { autoDetect: false });

    expect(result.rawText).toBe('Line 1\nLine 2\nLine 3');
    expect(result.chapters.length).toBe(1);
    expect(result.chapters[0].content).toContain('<p>Line 1 Line 2 Line 3</p>');
  });

  it('detects Chapter X headings in plain text', () => {
    const text = `Title of the Book\nAuthor Name\n\nChapter 1: The First Step\n\nIt was a dark and stormy night.\n\nChapter 2: The Journey Continues\n\nThe sun rose over the hills.`;

    const result = parseTxt(text, { autoDetect: true });

    expect(result.chapters.length).toBeGreaterThanOrEqual(2);
    expect(result.chapters.some((c) => c.title.includes('Chapter 1'))).toBe(true);
    expect(result.chapters.some((c) => c.title.includes('Chapter 2'))).toBe(true);
  });

  it('detects ALL CAPS headings surrounded by blank lines', () => {
    const text = `\nPROLOGUE\n\nIn the beginning there was light.\n\nTHE AWAKENING\n\nHe opened his eyes slowly.`;

    const result = parseTxt(text, { autoDetect: true });

    expect(result.chapters.length).toBe(2);
    expect(result.chapters[0].title).toBe('PROLOGUE');
    expect(result.chapters[1].title).toBe('THE AWAKENING');
  });

  it('returns a single chapter when chapter detection is disabled', () => {
    const text = `Chapter 1\n\nHello\n\nChapter 2\n\nWorld`;
    const result = parseTxt(text, { autoDetect: false });

    expect(result.chapters.length).toBe(1);
    expect(result.chapters[0].title).toBe('Full Text');
  });

  it('handles empty text gracefully', () => {
    const result = parseTxt('', { autoDetect: true });
    expect(result.chapters.length).toBe(1);
    expect(result.chapters[0].content).toBe('');
  });
});
