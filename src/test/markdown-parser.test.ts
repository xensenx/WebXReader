import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../core/parsing/markdown-parser';

describe('Markdown Parser', () => {
  it('extracts YAML frontmatter metadata', () => {
    const md = `---
title: The Starry Crown
author: Selene Blackwood
language: en
publisher: Lunar Books
---

# Chapter 1

The night was clear.`;

    const result = parseMarkdown(md);
    expect(result.metadata.title).toBe('The Starry Crown');
    expect(result.metadata.author).toBe('Selene Blackwood');
    expect(result.metadata.publisher).toBe('Lunar Books');
    expect(result.chapters.length).toBe(1);
    expect(result.chapters[0].title).toBe('Chapter 1');
  });

  it('splits sections into chapters by H1 / H2 headings', () => {
    const md = `# Part One\n\nFirst paragraph.\n\n# Part Two\n\nSecond paragraph.`;
    const result = parseMarkdown(md);

    expect(result.chapters.length).toBe(2);
    expect(result.chapters[0].title).toBe('Part One');
    expect(result.chapters[1].title).toBe('Part Two');
  });

  it('sanitizes unsafe script tags from markdown HTML', () => {
    const md = `# Safe Heading\n\n<script>alert("hack")</script>\n\nSafe paragraph with <a href="javascript:alert(1)">bad link</a>.`;
    const result = parseMarkdown(md);

    expect(result.chapters[0].content).not.toContain('<script>');
    expect(result.chapters[0].content).not.toContain('javascript:alert');
  });
});
