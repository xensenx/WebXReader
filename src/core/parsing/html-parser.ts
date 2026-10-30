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

/**
 * Extracts the body content from a full HTML document.
 * If no <body> tag is found, returns the original HTML.
 */
function extractBody(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
}

/**
 * Splits sanitized HTML content by h1/h2 heading elements into chapters.
 */
function splitByHeadings(html: string): Chapter[] {
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

  // Split into chapters
  const chapters = splitByHeadings(cleanHtml);

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
