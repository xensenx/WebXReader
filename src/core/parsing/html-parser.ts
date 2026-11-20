/**
 * HTML parser for WebXReader.
 * Sanitizes HTML content and extracts chapters from heading elements.
 */

import type { Chapter, BookMetadata } from '../../types/book';
import { generateId } from '../../utils';
import { sanitizeReaderHtml } from './sanitize-reader-html';

/** Result of parsing an HTML file */
export interface HtmlParseResult {
  chapters: Chapter[];
  metadata: Partial<BookMetadata>;
}

/**
 * Extracts the document title from an HTML string.
 */
function extractTitle(html: string): string | undefined {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    // Decode HTML entities in the title
    const temp = document.createElement('div');
    temp.innerHTML = titleMatch[1].trim();
    return temp.textContent || undefined;
  }
  return undefined;
}

/**
 * Extracts metadata from HTML meta tags.
 */
function extractMetadata(html: string): Partial<BookMetadata> {
  const metadata: Partial<BookMetadata> = {};

  const title = extractTitle(html);
  if (title) {
    metadata.title = title;
  }

  // Extract meta tags
  const metaRegex = /<meta\s+(?:[^>]*?\s+)?(?:name|property)\s*=\s*["']([^"']+)["'][^>]*?\s+content\s*=\s*["']([^"']+)["'][^>]*\/?>/gi;
  const metaRegexReverse = /<meta\s+(?:[^>]*?\s+)?content\s*=\s*["']([^"']+)["'][^>]*?\s+(?:name|property)\s*=\s*["']([^"']+)["'][^>]*\/?>/gi;

  const metaTags = new Map<string, string>();

  let match: RegExpExecArray | null;
  while ((match = metaRegex.exec(html)) !== null) {
    metaTags.set(match[1].toLowerCase(), match[2]);
  }
  while ((match = metaRegexReverse.exec(html)) !== null) {
    metaTags.set(match[2].toLowerCase(), match[1]);
  }

  if (metaTags.has('author')) {
    metadata.author = metaTags.get('author');
  }
  if (metaTags.has('description')) {
    metadata.description = metaTags.get('description');
  }
  if (metaTags.has('language') || metaTags.has('dc.language')) {
    metadata.language = metaTags.get('language') || metaTags.get('dc.language');
  }
  if (metaTags.has('publisher') || metaTags.has('dc.publisher')) {
    metadata.publisher = metaTags.get('publisher') || metaTags.get('dc.publisher');
  }

  return metadata;
}

/** Extract body content with the HTML parser, including implicit body tags. */
function extractBody(html: string): string {
  const inertDocument = document.implementation.createHTMLDocument();
  inertDocument.documentElement.innerHTML = html;
  return inertDocument.body.innerHTML;
}

/**
 * Splits sanitized HTML content by h1/h2 heading elements into chapters.
 */
export function splitByHeadings(html: string, documentTitle?: string, headingsSelector = 'h1, h2'): Chapter[] {
  const container = document.createElement('div');
  container.innerHTML = html;

  const chapters: Chapter[] = [];
  const range = document.createRange();
  range.selectNodeContents(container);
  let title: string | undefined;
  let level = 0;
  let headingId: string | undefined;

  const appendChapter = () => {
    const fragment = document.createElement('div');
    fragment.append(range.cloneContents());
    if (!title && !fragment.textContent?.trim() && !fragment.querySelector('img, hr, table')) return;
    if (headingId) {
      const anchor = document.createElement('span');
      anchor.id = headingId;
      fragment.prepend(anchor);
    }
    chapters.push({
      id: generateId(),
      title: title ?? documentTitle ?? 'Full Text',
      content: fragment.innerHTML.trim(),
      level,
      order: chapters.length,
    });
  };

  const headings = container.querySelectorAll(headingsSelector);
  for (const heading of headings) {
    // Chapter boundaries must not cut through a preserved table.
    if (heading.closest('table')) continue;
    const headingTitle = heading.textContent?.trim();
    const keepHeading = heading.tagName === 'H3';
    if (!headingTitle && !(keepHeading && heading.querySelector('img[src]'))) continue;
    range.setEndBefore(heading);
    appendChapter();
    if (keepHeading) {
      range.setStartBefore(heading);
      headingId = undefined;
    } else {
      range.setStartAfter(heading);
      headingId = heading.id;
    }
    title = headingTitle || documentTitle || 'Full Text';
    level = Number(heading.tagName[1]) - 1;
  }

  range.setEnd(container, container.childNodes.length);
  appendChapter();
  return chapters;
}

/**
 * Parses an HTML string into chapters and metadata.
 * Sanitizes the HTML to remove scripts, event handlers, and unsafe content.
 *
 * @param htmlText - Raw HTML content
 * @returns Parsed chapters and metadata
 */
export function parseHtml(htmlText: string): HtmlParseResult {
  // Extract metadata before sanitization (meta tags get stripped)
  const metadata = extractMetadata(htmlText);

  // Extract body content
  const bodyContent = extractBody(htmlText);

  // Sanitize the HTML
  const cleanHtml = sanitizeReaderHtml(bodyContent);
  const template = document.createElement('template');
  template.innerHTML = cleanHtml;
  if (!template.content.textContent?.trim() && !template.content.querySelector('hr, table')) {
    throw new Error('No readable HTML body found. This file may require JavaScript to display its content.');
  }

  // Split into chapters
  const chapters = splitByHeadings(cleanHtml, metadata.title, 'h1, h2, h3');

  // If no chapters from headings, return all content as single chapter
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
