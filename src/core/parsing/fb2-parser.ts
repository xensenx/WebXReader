/**
 * FictionBook 2 (.fb2) parser for WebXReader.
 * Converts FB2 XML documents (including .fb2.zip archives) into structured
 * chapters, extracts metadata, covers, tables, poems, and footnotes.
 */

import JSZip from 'jszip';
import type { Chapter, BookMetadata } from '../../types/book';
import { generateId, escapeHtml } from '../../utils';
import { sanitizeReaderHtml } from './sanitize-reader-html';

/** Result of parsing an FB2 document */
export interface Fb2ParseResult {
  chapters: Chapter[];
  metadata: Partial<BookMetadata>;
  rawText: string;
  coverImage?: string;
}

/** Options for FB2 parsing */
export interface Fb2ParseOptions {
  /** Whether to auto-detect and split chapters. Defaults to true. */
  autoDetectChapters?: boolean;
  /** Whether to append footnotes (<body name="notes">) as a reference chapter. Defaults to true. */
  includeNotes?: boolean;
  /** Fallback encoding if not specified in XML declaration. Defaults to 'utf-8'. */
  defaultEncoding?: string;
}

/**
 * Extracts raw XML string from a string, ArrayBuffer, or zipped FB2 file.
 */
async function extractXmlString(
  input: string | ArrayBuffer,
  defaultEncoding = 'utf-8'
): Promise<string> {
  if (typeof input === 'string') {
    return input;
  }

  const bytes = new Uint8Array(input);

  // Check if it's a ZIP archive (starts with PK\x03\x04)
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    const zip = await JSZip.loadAsync(input);
    // Find the first .fb2 or .xml file in the archive
    let fb2File = Object.values(zip.files).find(
      (f) => !f.dir && (f.name.toLowerCase().endsWith('.fb2') || f.name.toLowerCase().endsWith('.xml'))
    );
    if (!fb2File) {
      // Fallback to first non-directory file
      fb2File = Object.values(zip.files).find((f) => !f.dir);
    }
    if (!fb2File) {
      throw new Error('Invalid FB2 archive: no files found inside ZIP');
    }
    const unzippedBuffer = await fb2File.async('arraybuffer');
    return extractXmlString(unzippedBuffer, defaultEncoding);
  }

  // Detect encoding from initial XML declaration
  const headerSlice = bytes.subarray(0, Math.min(bytes.length, 500));
  let headerAscii = '';
  for (let i = 0; i < headerSlice.length; i++) {
    headerAscii += String.fromCharCode(headerSlice[i]);
  }

  const encodingMatch = headerAscii.match(/<\?xml[^>]*encoding=["']([^"']+)["']/i);
  const declaredEncoding = encodingMatch ? encodingMatch[1].trim() : defaultEncoding;

  try {
    const decoder = new TextDecoder(declaredEncoding);
    return decoder.decode(bytes);
  } catch {
    // Fallback to UTF-8 or windows-1251
    try {
      const decoder = new TextDecoder('utf-8');
      return decoder.decode(bytes);
    } catch {
      const decoder = new TextDecoder('windows-1251');
      return decoder.decode(bytes);
    }
  }
}

/**
 * Normalizes and parses XML with DOMParser, attempting repair on common errors.
 */
function parseXmlDocument(xmlString: string): Document {
  // Strip null bytes and non-printable control characters that break XML parsers
  // eslint-disable-next-line no-control-regex
  const cleanXml = xmlString.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  const parser = new DOMParser();
  let doc = parser.parseFromString(cleanXml, 'application/xml');

  if (doc.querySelector('parsererror')) {
    // Attempt repair for unescaped ampersands common in legacy FB2
    const repaired = cleanXml.replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[a-fA-F0-9]+);)/g, '&amp;');
    doc = parser.parseFromString(repaired, 'application/xml');
    if (doc.querySelector('parsererror')) {
      throw new Error('Invalid FictionBook XML structure: parsing error');
    }
  }

  return doc;
}

/**
 * Extracts metadata from the <description> block of an FB2 document.
 */
function extractMetadata(doc: Document): {
  metadata: Partial<BookMetadata>;
  coverImage?: string;
} {
  const metadata: Partial<BookMetadata> = {};
  const titleInfo = doc.querySelector('FictionBook > description > title-info');
  const publishInfo = doc.querySelector('FictionBook > description > publish-info');

  // Title
  const titleElem = titleInfo?.querySelector('book-title');
  if (titleElem?.textContent?.trim()) {
    metadata.title = titleElem.textContent.trim();
  }

  // Authors
  const authorNodes = titleInfo ? Array.from(titleInfo.querySelectorAll('author')) : [];
  const authorNames: string[] = [];
  for (const author of authorNodes) {
    const firstName = author.querySelector('first-name')?.textContent?.trim() || '';
    const middleName = author.querySelector('middle-name')?.textContent?.trim() || '';
    const lastName = author.querySelector('last-name')?.textContent?.trim() || '';
    const nickname = author.querySelector('nickname')?.textContent?.trim() || '';

    const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');
    if (fullName) {
      authorNames.push(fullName);
    } else if (nickname) {
      authorNames.push(nickname);
    }
  }
  if (authorNames.length > 0) {
    metadata.author = authorNames.join(', ');
  }

  // Description / Annotation
  const annotationElem = titleInfo?.querySelector('annotation');
  if (annotationElem) {
    metadata.description = annotationElem.textContent?.trim() || '';
  }

  // Language
  const langElem = titleInfo?.querySelector('lang');
  if (langElem?.textContent?.trim()) {
    metadata.language = langElem.textContent.trim();
  }

  // Publication date
  const dateElem = titleInfo?.querySelector('date') || publishInfo?.querySelector('year');
  if (dateElem?.textContent?.trim()) {
    metadata.publicationDate = dateElem.textContent.trim();
  }

  // Publisher
  const publisherElem = publishInfo?.querySelector('publisher');
  if (publisherElem?.textContent?.trim()) {
    metadata.publisher = publisherElem.textContent.trim();
  }

  // Identifiers: ISBN, genres, series
  const identifiers: Record<string, string> = {};
  const isbnElem = publishInfo?.querySelector('isbn');
  if (isbnElem?.textContent?.trim()) {
    identifiers.isbn = isbnElem.textContent.trim();
  }

  const genreNodes = titleInfo ? Array.from(titleInfo.querySelectorAll('genre')) : [];
  const genres = genreNodes
    .map((g) => g.textContent?.trim())
    .filter((g): g is string => Boolean(g));
  if (genres.length > 0) {
    identifiers.genre = genres.join(', ');
  }

  const sequenceElem = titleInfo?.querySelector('sequence');
  if (sequenceElem) {
    const seriesName = sequenceElem.getAttribute('name');
    const seriesNum = sequenceElem.getAttribute('number');
    if (seriesName) {
      identifiers.series = seriesNum ? `${seriesName} #${seriesNum}` : seriesName;
    }
  }

  if (Object.keys(identifiers).length > 0) {
    metadata.identifiers = identifiers;
  }

  // Cover image extraction
  let coverImage: string | undefined;
  const coverImageElem = titleInfo?.querySelector('coverpage image');
  const coverHref =
    coverImageElem?.getAttribute('l:href') ||
    coverImageElem?.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
    coverImageElem?.getAttribute('xlink:href') ||
    coverImageElem?.getAttribute('href');

  if (coverHref) {
    const binaryId = coverHref.replace(/^#/, '');
    const binaries = Array.from(doc.querySelectorAll('FictionBook > binary'));
    const matchingBinary = binaries.find(
      (b) => b.getAttribute('id')?.toLowerCase() === binaryId.toLowerCase()
    );

    if (matchingBinary) {
      const contentType = matchingBinary.getAttribute('content-type') || 'image/jpeg';
      const base64Data = matchingBinary.textContent?.replace(/\s+/g, '') || '';
      if (base64Data) {
        coverImage = `data:${contentType};base64,${base64Data}`;
      }
    }
  }

  return { metadata, coverImage };
}

/**
 * Converts inline elements of an FB2 node to HTML.
 */
function renderInlineContent(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtml(node.textContent || '');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const elem = node as Element;
  const tagName = elem.tagName.toLowerCase().replace(/^.*:/, '');
  const inner = Array.from(elem.childNodes).map(renderInlineContent).join('');

  switch (tagName) {
    case 'strong':
    case 'b':
      return `<strong>${inner}</strong>`;
    case 'emphasis':
    case 'em':
    case 'i':
      return `<em>${inner}</em>`;
    case 'strikethrough':
    case 's':
    case 'del':
      return `<s>${inner}</s>`;
    case 'sub':
      return `<sub>${inner}</sub>`;
    case 'sup':
      return `<sup>${inner}</sup>`;
    case 'code':
      return `<code>${inner}</code>`;
    case 'style':
      return `<span class="fb2-style">${inner}</span>`;
    case 'a': {
      const href =
        elem.getAttribute('l:href') ||
        elem.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
        elem.getAttribute('xlink:href') ||
        elem.getAttribute('href') ||
        '';
      return `<a href="${escapeHtml(href)}">${inner}</a>`;
    }
    default:
      return inner;
  }
}

/**
 * Converts block-level elements of an FB2 node to HTML.
 */
function renderBlockContent(elem: Element): string {
  const tagName = elem.tagName.toLowerCase().replace(/^.*:/, '');

  switch (tagName) {
    case 'p':
      return `<p>${renderInlineContent(elem)}</p>`;
    case 'subtitle':
      return `<h3 class="fb2-subtitle">${renderInlineContent(elem)}</h3>`;
    case 'empty-line':
      return '<div class="fb2-empty-line" aria-hidden="true">&nbsp;</div>';
    case 'epigraph': {
      const inner = Array.from(elem.children).map(renderBlockContent).join('\n');
      return `<blockquote class="fb2-epigraph">${inner}</blockquote>`;
    }
    case 'cite': {
      const inner = Array.from(elem.children).map(renderBlockContent).join('\n');
      return `<blockquote class="fb2-cite">${inner}</blockquote>`;
    }
    case 'text-author':
      return `<p class="fb2-author"><em>${renderInlineContent(elem)}</em></p>`;
    case 'poem': {
      const stanzas = Array.from(elem.children).map(renderBlockContent).join('\n');
      return `<div class="fb2-poem">${stanzas}</div>`;
    }
    case 'stanza': {
      const verses = Array.from(elem.children).map(renderBlockContent).join('\n');
      return `<div class="fb2-stanza">${verses}</div>`;
    }
    case 'v':
      return `<p class="fb2-verse">${renderInlineContent(elem)}</p>`;
    case 'table': {
      const rows = Array.from(elem.querySelectorAll('tr'))
        .map((tr) => {
          const cells = Array.from(tr.children)
            .map((cell) => {
              const tag = cell.tagName.toLowerCase();
              const cellTag = tag === 'th' ? 'th' : 'td';
              return `<${cellTag}>${renderInlineContent(cell)}</${cellTag}>`;
            })
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('');
      return `<table class="fb2-table"><tbody>${rows}</tbody></table>`;
    }
    default:
      // If it has children, render them
      if (elem.children.length > 0) {
        return Array.from(elem.children).map(renderBlockContent).join('\n');
      }
      return renderInlineContent(elem);
  }
}

/**
 * Extracts title text from a section or body <title> element.
 */
function extractTitleFromElement(elem: Element | null | undefined): string | null {
  if (!elem) return null;
  const pTags = Array.from(elem.querySelectorAll('p'));
  if (pTags.length > 0) {
    return pTags
      .map((p) => p.textContent?.trim())
      .filter(Boolean)
      .join(' - ');
  }
  return elem.textContent?.trim() || null;
}

/**
 * Recursively collects chapters from an FB2 <section> element.
 */
function collectSectionChapters(
  section: Element,
  level: number,
  orderRef: { count: number }
): Chapter[] {
  const titleElem = Array.from(section.children).find(
    (c) => c.tagName.toLowerCase().replace(/^.*:/, '') === 'title'
  );
  const title = extractTitleFromElement(titleElem) || `Section ${orderRef.count + 1}`;

  // Find child sections vs direct block content
  const childSections = Array.from(section.children).filter(
    (c) => c.tagName.toLowerCase().replace(/^.*:/, '') === 'section'
  );

  const directContentElems = Array.from(section.children).filter((c) => {
    const name = c.tagName.toLowerCase().replace(/^.*:/, '');
    return name !== 'title' && name !== 'section';
  });

  const chapters: Chapter[] = [];

  // If section has direct content before child sections, emit it
  if (directContentElems.length > 0 || childSections.length === 0) {
    const html = directContentElems.map(renderBlockContent).join('\n');
    chapters.push({
      id: generateId(),
      title,
      content: sanitizeReaderHtml(html),
      level,
      order: orderRef.count++,
    });
  }

  // Process nested child sections
  for (const childSec of childSections) {
    const subChapters = collectSectionChapters(childSec, level + 1, orderRef);
    chapters.push(...subChapters);
  }

  return chapters;
}

/**
 * Parses an FB2 document (XML string or ArrayBuffer) into chapters and metadata.
 */
export async function parseFb2(
  input: string | ArrayBuffer,
  options: Fb2ParseOptions = {}
): Promise<Fb2ParseResult> {
  const { autoDetectChapters = true, includeNotes = true, defaultEncoding = 'utf-8' } = options;

  const xmlString = await extractXmlString(input, defaultEncoding);
  const doc = parseXmlDocument(xmlString);

  const { metadata, coverImage } = extractMetadata(doc);

  // Locate primary body (body without name="notes")
  const bodies = Array.from(doc.querySelectorAll('FictionBook > body'));
  const mainBody =
    bodies.find((b) => {
      const name = b.getAttribute('name')?.toLowerCase();
      return name !== 'notes' && name !== 'comments';
    }) || bodies[0];

  const chapters: Chapter[] = [];
  const orderRef = { count: 0 };

  if (mainBody) {
    if (!autoDetectChapters) {
      // Single chapter combining all children of main body
      const allHtml = Array.from(mainBody.children).map(renderBlockContent).join('\n');
      chapters.push({
        id: generateId(),
        title: metadata.title || 'Full Document',
        content: sanitizeReaderHtml(allHtml),
        level: 0,
        order: orderRef.count++,
      });
    } else {
      // 1. Preamble (epigraph, book title, or intro paragraphs before first section)
      const directTopElems = Array.from(mainBody.children).filter(
        (c) => c.tagName.toLowerCase().replace(/^.*:/, '') !== 'section'
      );
      const topSections = Array.from(mainBody.children).filter(
        (c) => c.tagName.toLowerCase().replace(/^.*:/, '') === 'section'
      );

      if (directTopElems.length > 0 && topSections.length > 0) {
        const preambleHtml = directTopElems.map(renderBlockContent).join('\n');
        if (preambleHtml.trim()) {
          const topTitleElem = directTopElems.find(
            (c) => c.tagName.toLowerCase().replace(/^.*:/, '') === 'title'
          );
          const preambleTitle =
            extractTitleFromElement(topTitleElem) || metadata.title || 'Introduction';

          chapters.push({
            id: generateId(),
            title: preambleTitle,
            content: sanitizeReaderHtml(preambleHtml),
            level: 0,
            order: orderRef.count++,
          });
        }
      }

      // 2. Sections
      if (topSections.length > 0) {
        for (const section of topSections) {
          const sectionChapters = collectSectionChapters(section, 0, orderRef);
          chapters.push(...sectionChapters);
        }
      } else if (chapters.length === 0) {
        // Main body had no sections and no preamble; render whatever is in body
        const html = Array.from(mainBody.children).map(renderBlockContent).join('\n');
        chapters.push({
          id: generateId(),
          title: metadata.title || 'Full Document',
          content: sanitizeReaderHtml(html),
          level: 0,
          order: orderRef.count++,
        });
      }
    }
  }

  // 3. Footnotes / Notes body (<body name="notes">)
  if (includeNotes) {
    const notesBody = bodies.find((b) => {
      const name = b.getAttribute('name')?.toLowerCase();
      return name === 'notes' || name === 'comments';
    });

    if (notesBody) {
      const notesSections = Array.from(notesBody.querySelectorAll('section'));
      if (notesSections.length > 0) {
        let notesHtml = '<div class="fb2-notes-list">';
        for (const note of notesSections) {
          const noteId = note.getAttribute('id') || '';
          const title = extractTitleFromElement(note.querySelector('title')) || noteId;
          const content = Array.from(note.children)
            .filter((c) => c.tagName.toLowerCase() !== 'title')
            .map(renderBlockContent)
            .join('\n');

          notesHtml += `<div class="fb2-note-entry" id="note-${noteId}">
            <p><strong>[${escapeHtml(title)}]</strong></p>
            ${content}
          </div>`;
        }
        notesHtml += '</div>';

        chapters.push({
          id: generateId(),
          title: 'Footnotes & Endnotes',
          content: sanitizeReaderHtml(notesHtml),
          level: 0,
          order: orderRef.count++,
        });
      }
    }
  }

  // Extract raw text from main body for text search
  const rawText = mainBody?.textContent?.replace(/\s+/g, ' ').trim() || '';

  return {
    chapters,
    metadata,
    rawText,
    coverImage,
  };
}
