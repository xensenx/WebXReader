/**
 * DOCX (Office Open XML Word Document) parser.
 * Converts Microsoft Word (.docx) documents into structured, reflowable chapters,
 * extracts Dublin Core metadata, and extracts embedded media/cover art.
 */

import mammoth from 'mammoth';
import JSZip from 'jszip';
import type { Chapter, BookMetadata } from '../../types/book';
import { sanitizeReaderHtml } from './sanitize-reader-html';

export interface DocxParseOptions {
  autoDetectChapters?: boolean;
}

export interface DocxParseResult {
  chapters: Chapter[];
  metadata: Partial<BookMetadata>;
  rawText: string;
  coverImage?: string;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

/**
 * Extracts plain text from an HTML snippet for title generation.
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .trim();
}

/**
 * Derives a clean chapter title from section HTML.
 */
function extractTitleFromSection(html: string, defaultTitle: string): string {
  const hMatch = html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (hMatch) {
    const title = htmlToPlainText(hMatch[1]);
    if (title.length > 0 && title.length <= 120) {
      return title;
    }
  }

  const pMatch = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (pMatch) {
    const text = htmlToPlainText(pMatch[1]);
    if (text.length > 0 && text.length <= 80) {
      return text;
    }
  }

  return defaultTitle;
}

/**
 * Extracts metadata from docProps/core.xml in a DOCX zip archive.
 */
async function extractDocxMetadata(zip: JSZip): Promise<{ metadata: Partial<BookMetadata>; coverImage?: string }> {
  const metadata: Partial<BookMetadata> = {};
  let coverImage: string | undefined;

  // 1. Read docProps/core.xml
  const coreFile = zip.file('docProps/core.xml');
  if (coreFile) {
    try {
      const xml = await coreFile.async('text');
      const getTag = (tag: string): string | undefined => {
        const regex = new RegExp(`<(?:[a-zA-Z0-9]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9]+:)?${tag}>`, 'i');
        const match = xml.match(regex);
        return match ? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : undefined;
      };

      const title = getTag('title');
      const creator = getTag('creator');
      const description = getTag('description') || getTag('subject');
      const created = getTag('created');
      const language = getTag('language');

      if (title) metadata.title = title;
      if (creator) metadata.author = creator;
      if (description) metadata.description = description;
      if (created) metadata.publicationDate = created.split('T')[0];
      if (language) metadata.language = language;
    } catch {
      // Ignore corrupted metadata
    }
  }

  // 2. Extract potential cover image from word/media/
  try {
    const mediaFiles: string[] = [];
    zip.forEach((relativePath) => {
      if (relativePath.startsWith('word/media/') && /\.(png|jpe?g|webp|gif)$/i.test(relativePath)) {
        mediaFiles.push(relativePath);
      }
    });

    // Sort to prefer first image
    mediaFiles.sort();
    if (mediaFiles.length > 0) {
      const firstImg = zip.file(mediaFiles[0]);
      if (firstImg) {
        const base64 = await firstImg.async('base64');
        const ext = mediaFiles[0].split('.').pop()?.toLowerCase();
        const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        coverImage = `data:${mime};base64,${base64}`;
      }
    }
  } catch {
    // Ignore image extraction failure
  }

  return { metadata, coverImage };
}

/**
 * Parses a DOCX (.docx) file buffer into chapters, metadata, and raw text.
 */
export async function parseDocx(
  data: ArrayBuffer | Uint8Array,
  options: DocxParseOptions = {}
): Promise<DocxParseResult> {
  const buffer =
    data instanceof Uint8Array
      ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
      : data;

  if (buffer.byteLength < 4) {
    throw new Error('Not a valid DOCX file: file is smaller than ZIP header.');
  }

  // 1. Verify ZIP Magic Bytes ('PK\x03\x04')
  const headerBytes = new Uint8Array(buffer, 0, 4);
  if (headerBytes[0] !== 0x50 || headerBytes[1] !== 0x4b || headerBytes[2] !== 0x03 || headerBytes[3] !== 0x04) {
    throw new Error('Not a valid DOCX file: missing ZIP header signature.');
  }

  // 2. Open ZIP Package and extract Dublin Core metadata
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    throw new Error(`Failed to read DOCX package: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!zip.file('word/document.xml')) {
    throw new Error('Not a valid DOCX file: missing word/document.xml entry in archive.');
  }

  const { metadata, coverImage } = await extractDocxMetadata(zip);

  // 3. Convert DOCX to rich semantic HTML using mammoth
  let html = '';
  let rawText = '';
  const mammothInput = {
    arrayBuffer: buffer,
    buffer: typeof Buffer !== 'undefined' ? Buffer.from(buffer) : (buffer as unknown as Uint8Array),
  };
  try {
    const htmlResult = await mammoth.convertToHtml(mammothInput);
    html = htmlResult.value;

    const textResult = await mammoth.extractRawText(mammothInput);
    rawText = textResult.value;
  } catch (err) {
    throw new Error(`Failed to parse DOCX document body: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. Split into Chapters
  const autoDetectChapters = options.autoDetectChapters ?? true;
  let chapters: Chapter[] = [];

  if (autoDetectChapters) {
    // Check if HTML contains explicit headings (h1, h2)
    const hasH1 = /<h1[^>]*>/i.test(html);
    const hasH2 = /<h2[^>]*>/i.test(html);

    if (hasH1 || hasH2) {
      // Split on heading boundaries
      const splitRegex = hasH1 ? /(?=<h1[^>]*>)/i : /(?=<h2[^>]*>)/i;
      const sections = html.split(splitRegex);

      let order = 0;
      for (const section of sections) {
        const trimmed = section.trim();
        if (!trimmed) continue;

        const title = extractTitleFromSection(trimmed, `Chapter ${order + 1}`);
        chapters.push({
          id: generateId(),
          title,
          level: 0,
          order,
          content: sanitizeReaderHtml(trimmed),
        });
        order++;
      }
    }
  }

  // Fallback: If no chapters detected or autoDetectChapters is false, wrap full HTML in a single chapter
  if (chapters.length === 0) {
    const defaultTitle = metadata.title || 'Document';
    chapters = [
      {
        id: generateId(),
        title: defaultTitle,
        level: 0,
        order: 0,
        content: sanitizeReaderHtml(html),
      },
    ];
  }

  return {
    chapters,
    metadata,
    rawText: rawText || htmlToPlainText(html),
    coverImage,
  };
}
