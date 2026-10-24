/**
 * Markdown parser for WebXReader.
 * Parses Markdown files into chapters using heading hierarchy,
 * with optional YAML frontmatter metadata extraction.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Chapter, BookMetadata } from '../../types/book';
import { generateId } from '../../utils';

/** Result of parsing a Markdown file */
export interface MarkdownParseResult {
  chapters: Chapter[];
  metadata: Partial<BookMetadata>;
}

/**
 * Extracts YAML frontmatter from Markdown content.
 * Frontmatter is delimited by --- at the start of the file.
 *
 * @returns Parsed metadata and the remaining Markdown content
 */
function extractFrontmatter(markdown: string): {
  metadata: Partial<BookMetadata>;
  content: string;
} {
  const trimmed = markdown.trimStart();
  if (!trimmed.startsWith('---')) {
    return { metadata: {}, content: markdown };
  }

  const endIndex = trimmed.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { metadata: {}, content: markdown };
  }

  const frontmatterBlock = trimmed.slice(3, endIndex).trim();
  const content = trimmed.slice(endIndex + 4).trim();
  const metadata: Partial<BookMetadata> = {};

  // Simple YAML key: value parser (handles common frontmatter fields)
  const lines = frontmatterBlock.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim().toLowerCase();
    let value = line.slice(colonIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    switch (key) {
      case 'title':
        metadata.title = value;
        break;
      case 'author':
      case 'by':
        metadata.author = value;
        break;
      case 'description':
      case 'summary':
      case 'abstract':
        metadata.description = value;
        break;
      case 'language':
      case 'lang':
        metadata.language = value;
        break;
      case 'publisher':
        metadata.publisher = value;
        break;
      case 'date':
      case 'publication_date':
      case 'published':
        metadata.publicationDate = value;
        break;
      case 'isbn':
        metadata.identifiers = { ...(metadata.identifiers || {}), isbn: value };
        break;
    }
  }

  return { metadata, content };
}

/**
 * Splits HTML content by heading tags (h1, h2) into chapters.
 */
function splitHtmlByHeadings(html: string): Chapter[] {
  // Use a temporary DOM element to parse the HTML
  const container = document.createElement('div');
  container.innerHTML = html;

  const chapters: Chapter[] = [];
  let currentContent: string[] = [];
  let currentTitle: string | null = null;
  let currentLevel = 0;

  const flushChapter = () => {
    const content = currentContent.join('').trim();
    if (currentTitle !== null || content.length > 0) {
      chapters.push({
        id: generateId(),
        title: currentTitle || 'Untitled Section',
        content,
        level: currentLevel,
        order: chapters.length,
      });
    }
    currentContent = [];
  };

  for (const node of Array.from(container.childNodes)) {
    const element = node as Element;
    const tagName = element.tagName?.toUpperCase();

    if (tagName === 'H1' || tagName === 'H2') {
      flushChapter();
      currentTitle = element.textContent?.trim() || 'Untitled Section';
      currentLevel = tagName === 'H1' ? 0 : 1;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      currentContent.push((element as HTMLElement).outerHTML);
    } else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      currentContent.push(`<p>${node.textContent.trim()}</p>`);
    }
  }

  // Flush the last chapter
  flushChapter();

  return chapters;
}

/**
 * Parses a Markdown string into chapters and metadata.
 *
 * @param markdownText - Raw Markdown content
 * @returns Parsed chapters and metadata
 */
export function parseMarkdown(markdownText: string): MarkdownParseResult {
  const { metadata, content } = extractFrontmatter(markdownText);

  // Parse Markdown to HTML
  const rawHtml = marked.parse(content, { async: false }) as string;

  // Sanitize the HTML
  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li',
      'blockquote', 'pre', 'code',
      'a', 'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'hr', 'div', 'span', 'sup', 'sub',
      'figure', 'figcaption',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel'],
    // Imported Markdown is displayed without fetching arbitrary remote
    // resources or embedding executable/media content.
    FORBID_TAGS: ['img', 'iframe', 'object', 'embed', 'video', 'audio', 'source'],
  });

  // Split into chapters by headings
  const chapters = splitHtmlByHeadings(cleanHtml);

  // If no chapters were detected (no headings), return all content as single chapter
  if (chapters.length === 0) {
    return {
      chapters: [
        {
          id: generateId(),
          title: metadata.title || 'Full Text',
          content: cleanHtml,
          level: 0,
          order: 0,
        },
      ],
      metadata,
    };
  }

  return { chapters, metadata };
}
