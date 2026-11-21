/**
 * DOCX (Office Open XML Word Document) parser.
 * Converts Microsoft Word (.docx) documents into structured, reflowable chapters,
 * extracts Dublin Core metadata, and extracts embedded media/cover art.
 */

import mammoth from 'mammoth';
import JSZip from 'jszip';
import { openBudgetedZip, readZipEntryLimited, ZIP_LIMITS } from './zip-budget';
import { generateId } from '../../utils';
import { embeddedRasterUrl } from './embedded-raster';
import type { Chapter, BookMetadata } from '../../types/book';
import { sanitizeBookChapter } from './sanitize-reader-html';
import { splitByHeadings } from './html-parser';

export interface DocxParseOptions {
  autoDetectChapters?: boolean;
}

export interface DocxParseResult {
  chapters: Chapter[];
  metadata: Partial<BookMetadata>;
  rawText: string;
  coverImage?: string;
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
 * Extracts metadata from docProps/core.xml in a DOCX zip archive.
 */
async function extractDocxMetadata(zip: JSZip): Promise<{ metadata: Partial<BookMetadata>; coverImage?: string }> {
  const metadata: Partial<BookMetadata> = {};
  let coverImage: string | undefined;

  // 1. Read docProps/core.xml
  const coreFile = zip.file('docProps/core.xml');
  if (coreFile) {
    try {
      const xml = new TextDecoder().decode(await readZipEntryLimited(coreFile, 1024 * 1024));
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const getTag = (tag: string) => doc.getElementsByTagNameNS('*', tag)[0]?.textContent?.trim() || undefined;

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

  // Prefer the package thumbnail, then fall back to the first readable image.
  const coverPaths = Object.keys(zip.files).filter((path) =>
    /^(?:docProps\/thumbnail|word\/media\/[^/]+)\.(?:png|jpe?g|gif|webp)$/i.test(path));
  coverPaths.sort((a, b) => Number(b.startsWith('docProps/')) - Number(a.startsWith('docProps/')) || a.localeCompare(b));
  for (const path of coverPaths.slice(0, 8)) {
    try {
      const entry = zip.file(path);
      if (entry) coverImage = embeddedRasterUrl(await readZipEntryLimited(entry, ZIP_LIMITS.coverBytes));
      if (coverImage) break;
    } catch {
      // Optional cover may be too large or damaged.
    }
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
    zip = await openBudgetedZip(buffer);
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
    let imageBudget = 24 * 1024 * 1024;
    const htmlResult = await mammoth.convertToHtml(mammothInput, {
      convertImage: mammoth.images.imgElement(async (image) => {
        const src = embeddedRasterUrl(new Uint8Array(await image.readAsArrayBuffer()));
        if (!src || src.length > imageBudget) return { src: '' };
        imageBudget -= src.length;
        return { src };
      }),
    });
    html = htmlResult.value;

    const textResult = await mammoth.extractRawText(mammothInput);
    rawText = textResult.value;
  } catch (err) {
    throw new Error(`Failed to parse DOCX document body: ${err instanceof Error ? err.message : String(err)}`);
  }

  const cleanHtml = sanitizeBookChapter(html, 'docx');
  const title = metadata.title || 'Document';
  const chapters = (options.autoDetectChapters ?? true) && /<h[1-3]\b/i.test(cleanHtml)
    ? splitByHeadings(cleanHtml, title, 'h1, h2, h3')
    : [];
  if (chapters.length === 0) {
    chapters.push({ id: generateId(), title, level: 0, order: 0, content: cleanHtml });
  }

  return {
    chapters,
    metadata,
    rawText: rawText || htmlToPlainText(html),
    coverImage,
  };
}
