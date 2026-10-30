/**
 * Mobipocket / Kindle (.mobi, .prc, .azw) parser for WebXReader.
 * Decodes Palm Database (PDB) containers, parses PalmDOC and MOBI/EXTH headers,
 * decompresses PalmDOC LZ77 streams, extracts cover art, and splits reflowable chapters.
 */

import type { Chapter, BookMetadata } from '../../types/book';
import { generateId } from '../../utils';
import { sanitizeReaderHtml } from './sanitize-reader-html';

/** Result of parsing a MOBI document */
export interface MobiParseResult {
  chapters: Chapter[];
  metadata: Partial<BookMetadata>;
  rawText: string;
  coverImage?: string;
}

/** Options for MOBI parsing */
export interface MobiParseOptions {
  /** Whether to auto-detect and split chapters. Defaults to true. */
  autoDetectChapters?: boolean;
  /** Fallback encoding if not specified in MOBI header. Defaults to 'utf-8'. */
  defaultEncoding?: string;
}

/** Internal PDB record entry */
interface PdbRecord {
  offset: number;
  attributes: number;
  uniqueId: number;
}

/**
 * Converts a Uint8Array into a Base64 string in chunks to prevent call-stack limits.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/**
 * Determines image MIME type from binary magic bytes.
 */
function detectImageMimeType(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  // GIF: 47 49 46 (GIF)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  // WebP: 52 49 46 46 (RIFF) ... 57 45 42 50 (WEBP)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  // BMP: 42 4D (BM)
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp';
  }

  return null;
}

/**
 * Calculates the byte size of trailing metadata entries appended to a MOBI text record.
 * Based on Calibre and libmobi specification.
 */
function getTrailingBytesSize(data: Uint8Array, extraRecordDataFlags: number): number {
  let num = 0;
  const size = data.length;
  let flags = extraRecordDataFlags >> 1;

  while (flags > 0) {
    if (flags & 1) {
      let bitpos = 0;
      let result = 0;
      let psize = size - num;
      while (psize > 0) {
        const v = data[psize - 1];
        result |= (v & 0x7f) << bitpos;
        bitpos += 7;
        psize -= 1;
        if ((v & 0x80) !== 0 || bitpos >= 28 || psize === 0) {
          break;
        }
      }
      num += result;
    }
    flags >>= 1;
  }

  // Bit 0 specifies multibyte character trailing bytes
  if (extraRecordDataFlags & 1) {
    const off = size - num - 1;
    if (off >= 0) {
      num += (data[off] & 0x03) + 1;
    }
  }

  return num;
}

/**
 * Decompresses a PalmDOC LZ77 compressed byte buffer.
 *
 * Byte tokens:
 * - 0x00: Literal 0x00
 * - 0x01..0x08: Copy next N bytes literally
 * - 0x09..0x7F: Single literal byte
 * - 0x80..0xBF: 2-byte token ((b1 << 8) | b2) & 0x3FFF -> 11-bit distance, 3-bit length (+3)
 * - 0xC0..0xFF: Space (0x20) followed by (b ^ 0x80)
 */
export function decompressPalmDocLZ77(src: Uint8Array): Uint8Array {
  const dst: number[] = [];
  let i = 0;
  const len = src.length;

  while (i < len) {
    const control = src[i++];

    if (control === 0x00) {
      dst.push(0);
    } else if (control >= 0x01 && control <= 0x08) {
      const count = control;
      for (let k = 0; k < count && i < len; k++) {
        dst.push(src[i++]);
      }
    } else if (control >= 0x09 && control <= 0x7f) {
      dst.push(control);
    } else if (control >= 0x80 && control <= 0xbf) {
      if (i >= len) break;
      const b2 = src[i++];
      const compound = ((control << 8) | b2) & 0x3fff;
      const distance = compound >> 3;
      const count = (compound & 0x07) + 3;
      const start = dst.length - distance;

      if (start < 0 || distance === 0) {
        throw new Error('Corrupted or encrypted PalmDOC LZ77 stream: invalid backwards distance');
      }

      for (let k = 0; k < count; k++) {
        dst.push(dst[start + k]);
      }
    } else {
      // 0xC0..0xFF: Type C Space + (control ^ 0x80)
      dst.push(0x20);
      dst.push(control ^ 0x80);
    }
  }

  return new Uint8Array(dst);
}

/**
 * Strips basic HTML tags and decodes common HTML entities for plain text extraction.
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extracts chapter title from raw section HTML or returns a fallback title.
 */
function extractTitleFromSectionHtml(html: string, fallbackTitle: string): string {
  // Look for first heading (h1..h6)
  const headingMatch = html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (headingMatch && headingMatch[1]) {
    const titleText = htmlToPlainText(headingMatch[1]).trim();
    if (titleText.length > 0 && titleText.length < 150) {
      return titleText;
    }
  }

  // Look for bold title paragraph: <p ...><b>Title</b></p>
  const boldParaMatch = html.match(/<p[^>]*>\s*<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>\s*<\/p>/i);
  if (boldParaMatch && boldParaMatch[1]) {
    const titleText = htmlToPlainText(boldParaMatch[1]).trim();
    if (titleText.length > 0 && titleText.length < 150) {
      return titleText;
    }
  }

  return fallbackTitle;
}

/**
 * Parses MOBI/PalmDOC binary file into structured chapters and metadata.
 *
 * @param buffer ArrayBuffer of the MOBI/PalmDOC file.
 * @param options MOBI parse configuration options.
 */
export async function parseMobi(
  buffer: ArrayBuffer,
  options: MobiParseOptions = {}
): Promise<MobiParseResult> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  if (bytes.length < 78) {
    throw new Error('Not a valid MOBI file: file size is smaller than PDB header (78 bytes).');
  }

  // 1. Read PDB Header
  let pdbName = '';
  for (let i = 0; i < 32; i++) {
    if (bytes[i] === 0) break;
    pdbName += String.fromCharCode(bytes[i]);
  }
  pdbName = pdbName.trim();

  const numRecords = view.getUint16(76, false);
  if (numRecords === 0) {
    throw new Error('Invalid MOBI/PDB file: database contains zero records.');
  }

  if (bytes.length < 78 + numRecords * 8) {
    throw new Error('Truncated MOBI/PDB file: record list header exceeds file bounds.');
  }

  // 2. Read PDB Record Offsets
  const recordsMeta: PdbRecord[] = [];
  for (let i = 0; i < numRecords; i++) {
    const offset = view.getUint32(78 + i * 8, false);
    const attributes = view.getUint8(78 + i * 8 + 4);
    const uniqueId =
      (view.getUint8(78 + i * 8 + 5) << 16) |
      (view.getUint8(78 + i * 8 + 6) << 8) |
      view.getUint8(78 + i * 8 + 7);

    recordsMeta.push({ offset, attributes, uniqueId });
  }

  // Helper to slice a record
  function getRecordData(index: number): Uint8Array | null {
    if (index < 0 || index >= numRecords) return null;
    const start = recordsMeta[index].offset;
    const end = index + 1 < numRecords ? recordsMeta[index + 1].offset : bytes.length;
    if (start > bytes.length || end > bytes.length || start >= end) {
      return null;
    }
    return bytes.subarray(start, end);
  }

  // 3. Inspect Record 0 (Control Record)
  const record0 = getRecordData(0);
  if (!record0 || record0.length < 16) {
    throw new Error('Invalid MOBI/PalmDOC file: Record 0 is missing or corrupted.');
  }

  const rec0View = new DataView(record0.buffer, record0.byteOffset, record0.byteLength);
  const compression = rec0View.getUint16(0, false);
  const textRecordCount = rec0View.getUint16(8, false);
  const encryptionType = rec0View.getUint16(12, false);
  const isDrmFlagged = encryptionType !== 0;

  if (compression !== 1 && compression !== 2) {
    throw new Error(`Unsupported MOBI compression type (${compression}). Only PalmDOC LZ77 is supported.`);
  }

  // 4. Inspect MOBI Header (Starts at offset 16 of Record 0)
  let textEncoding = 65001; // Default to UTF-8
  let firstImageIndex = -1;
  let exthFlags = 0;
  let extraRecordDataFlags = 0;
  let mobiFullName = '';

  const isMobi =
    record0.length >= 20 &&
    record0[16] === 0x4d && // 'M'
    record0[17] === 0x4f && // 'O'
    record0[18] === 0x42 && // 'B'
    record0[19] === 0x49; // 'I'

  let mobiHeaderLength = 0;

  if (isMobi && record0.length >= 40) {
    mobiHeaderLength = rec0View.getUint32(20, false);
    textEncoding = rec0View.getUint32(28, false);

    // Full Name Offset & Length
    if (record0.length >= 16 + 72) {
      const fullNameOffset = rec0View.getUint32(16 + 68, false);
      const fullNameLength = rec0View.getUint32(16 + 72, false);
      if (fullNameOffset + fullNameLength <= record0.length) {
        const titleBytes = record0.subarray(fullNameOffset, fullNameOffset + fullNameLength);
        try {
          mobiFullName = new TextDecoder(textEncoding === 1252 ? 'windows-1252' : 'utf-8').decode(titleBytes).trim();
        } catch {
          mobiFullName = new TextDecoder('utf-8').decode(titleBytes).trim();
        }
      }
    }

    // firstImageIndex at offset 108 of Record 0 = 16 + 92
    if (record0.length >= 16 + 96) {
      firstImageIndex = rec0View.getUint32(16 + 92, false);
    }

    // exthFlags at offset 128 of Record 0 = 16 + 112
    if (record0.length >= 16 + 116) {
      exthFlags = rec0View.getUint32(16 + 112, false);
    }

    // extraRecordDataFlags at offset 242 from MOBI header (16 + 242 = 258 from Record 0)
    if (mobiHeaderLength >= 244 && record0.length >= 16 + 244) {
      extraRecordDataFlags = rec0View.getUint16(16 + 242, false);
    }
  }

  // 5. Parse EXTH Header (if bit 0x40 is set in exthFlags)
  interface ExthMetadata {
    author?: string;
    publisher?: string;
    description?: string;
    isbn?: string;
    subject?: string;
    date?: string;
    language?: string;
    title?: string;
    coverOffset?: number;
  }
  const exth: ExthMetadata = {};

  if (isMobi && exthFlags & 0x40 && mobiHeaderLength > 0) {
    const exthOffset = 16 + mobiHeaderLength;
    if (
      record0.length >= exthOffset + 12 &&
      record0[exthOffset] === 0x45 && // 'E'
      record0[exthOffset + 1] === 0x58 && // 'X'
      record0[exthOffset + 2] === 0x54 && // 'T'
      record0[exthOffset + 3] === 0x48 // 'H'
    ) {
      const exthLength = rec0View.getUint32(exthOffset + 4, false);
      const exthRecordCount = rec0View.getUint32(exthOffset + 8, false);

      let pos = exthOffset + 12;
      const exthEnd = Math.min(exthOffset + exthLength, record0.length);

      for (let i = 0; i < exthRecordCount && pos + 8 <= exthEnd; i++) {
        const recordType = rec0View.getUint32(pos, false);
        const recordLength = rec0View.getUint32(pos + 4, false);
        if (recordLength < 8 || pos + recordLength > exthEnd) break;

        const recordData = record0.subarray(pos + 8, pos + recordLength);
        pos += recordLength;

        const strVal = new TextDecoder('utf-8').decode(recordData).trim();

        switch (recordType) {
          case 100: // Author
            exth.author = strVal;
            break;
          case 101: // Publisher
            exth.publisher = strVal;
            break;
          case 103: // Description
            exth.description = strVal;
            break;
          case 104: // ISBN
            exth.isbn = strVal;
            break;
          case 105: // Subject / Genre
            exth.subject = strVal;
            break;
          case 106: // Publishing Date
            exth.date = strVal;
            break;
          case 115: // Language
            exth.language = strVal;
            break;
          case 201: // Cover Offset
            if (recordData.length >= 4) {
              const dv = new DataView(recordData.buffer, recordData.byteOffset, recordData.byteLength);
              exth.coverOffset = dv.getUint32(0, false);
            }
            break;
          case 503: // Updated Title
            exth.title = strVal;
            break;
        }
      }
    }
  }

  // 6. Decompress Text Records (Records 1 to textRecordCount)
  const decompressedChunks: Uint8Array[] = [];
  const maxTextRecords = Math.min(textRecordCount, numRecords - 1);

  for (let r = 1; r <= maxTextRecords; r++) {
    const rec = getRecordData(r);
    if (!rec) break;

    const trailingSize = getTrailingBytesSize(rec, extraRecordDataFlags);
    const contentPayload = trailingSize > 0 && trailingSize < rec.length
      ? rec.subarray(0, rec.length - trailingSize)
      : rec;

    if (compression === 2) {
      decompressedChunks.push(decompressPalmDocLZ77(contentPayload));
    } else {
      decompressedChunks.push(contentPayload);
    }
  }

  // Concatenate decompressed chunks
  const totalLength = decompressedChunks.reduce((acc, c) => acc + c.length, 0);
  const fullBytes = new Uint8Array(totalLength);
  let chunkOffset = 0;
  for (const chunk of decompressedChunks) {
    fullBytes.set(chunk, chunkOffset);
    chunkOffset += chunk.length;
  }

  // Verify decompressed content
  let hasValidContent = false;
  if (decompressedChunks.length > 0 && fullBytes.length > 0) {
    const sample = fullBytes.subarray(0, Math.min(fullBytes.length, 2048));
    let sampleText = '';
    try {
      sampleText = new TextDecoder('utf-8').decode(sample);
    } catch {
      try { sampleText = new TextDecoder('windows-1252').decode(sample); } catch {}
    }
    if (/<(?:html|head|body|div|p|span|section|article|h[1-6]|mbp|a|table|\?xml)/i.test(sampleText)) {
      hasValidContent = true;
    } else {
      let printable = 0;
      for (let i = 0; i < sampleText.length; i++) {
        const c = sampleText.charCodeAt(i);
        if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 65533)) printable++;
      }
      if (sampleText.length > 0 && printable / sampleText.length >= 0.75) hasValidContent = true;
    }
  }

  if (!hasValidContent) {
    if (isDrmFlagged) {
      throw new Error(
        'This MOBI book is protected with DRM encryption and cannot be read directly. ' +
        'To read this book in WebXReader, the DRM must be removed (for example, by converting the book using Calibre with the DeDRM plugin).'
      );
    }
    if (compression !== 1 && compression !== 2) {
      throw new Error(`Unsupported MOBI compression type (${compression}). Only PalmDOC LZ77 is supported.`);
    }
    throw new Error('Failed to decompress MOBI file: the book appears corrupted or unreadable.');
  }

  // 7. Decode HTML/Text Content
  let decodedText = '';
  const encodingToUse = options.defaultEncoding || (textEncoding === 1252 ? 'windows-1252' : 'utf-8');

  try {
    decodedText = new TextDecoder(encodingToUse).decode(fullBytes);
  } catch {
    try {
      decodedText = new TextDecoder('utf-8').decode(fullBytes);
    } catch {
      decodedText = new TextDecoder('windows-1252').decode(fullBytes);
    }
  }

  // If pure PalmDOC (plain text without HTML tags), wrap paragraphs in <p> tags
  if (!isMobi && !/<[a-z][\s\S]*>/i.test(decodedText)) {
    decodedText = decodedText
      .split(/\r?\n\r?\n+/)
      .map((para) => `<p>${para.replace(/\r?\n/g, '<br/>')}</p>`)
      .join('\n');
  }

  // 8. Extract Cover Image
  let coverImage: string | undefined;
  if (firstImageIndex >= 0 && firstImageIndex < numRecords) {
    // If EXTH 201 coverOffset is specified, compute exact cover record index
    const coverRecordIdx = exth.coverOffset !== undefined
      ? firstImageIndex + exth.coverOffset
      : firstImageIndex;

    const coverRec = getRecordData(coverRecordIdx);
    if (coverRec) {
      const mime = detectImageMimeType(coverRec);
      if (mime) {
        coverImage = `data:${mime};base64,${uint8ArrayToBase64(coverRec)}`;
      }
    }
  }

  // 9. Process and Split Chapters
  const autoDetectChapters = options.autoDetectChapters ?? true;
  let chapters: Chapter[] = [];

  // Normalize MOBI pagebreaks into standard marker
  let normalizedHtml = decodedText.replace(/<mbp:pagebreak\s*\/?>/gi, '<!--mobi-pagebreak-->');

  // Strip non-book / idx / guide tags
  normalizedHtml = normalizedHtml
    .replace(/<guide[\s\S]*?<\/guide>/gi, '')
    .replace(/<idx:entry[\s\S]*?<\/idx:entry>/gi, '');

  if (autoDetectChapters) {
    let rawSections: string[] = [];

    if (normalizedHtml.includes('<!--mobi-pagebreak-->')) {
      rawSections = normalizedHtml.split('<!--mobi-pagebreak-->');
    } else {
      // Split on <h1> or <h2> tags if pagebreaks are absent
      const hasHeadings = /<h[12][^>]*>[\s\S]*?<\/h[12]>/i.test(normalizedHtml);
      if (hasHeadings) {
        rawSections = normalizedHtml.split(/(?=<h[12][^>]*>)/i);
      } else {
        rawSections = [normalizedHtml];
      }
    }

    let order = 0;
    for (let sIdx = 0; sIdx < rawSections.length; sIdx++) {
      const sectionHtml = rawSections[sIdx].trim();
      if (!sectionHtml) continue;

      const plainText = htmlToPlainText(sectionHtml);
      // Skip sections that have practically no readable content
      if (plainText.length === 0 && !/<(?:p|div|h[1-6]|table|blockquote)/i.test(sectionHtml)) {
        continue;
      }

      const defaultTitle = order === 0 && !/<h[1-6]/i.test(sectionHtml)
        ? 'Cover & Front Matter'
        : `Chapter ${order + 1}`;

      const title = extractTitleFromSectionHtml(sectionHtml, defaultTitle);
      const cleanHtml = sanitizeReaderHtml(sectionHtml);

      chapters.push({
        id: generateId(),
        title,
        level: 0,
        order,
        content: cleanHtml,
      });

      order++;
    }
  }

  // Fallback: If no chapters detected or autoDetectChapters is false, wrap full content in a single chapter
  if (chapters.length === 0) {
    const singleTitle = exth.title || mobiFullName || pdbName || 'Full Content';
    chapters = [
      {
        id: generateId(),
        title: singleTitle,
        level: 0,
        order: 0,
        content: sanitizeReaderHtml(normalizedHtml),
      },
    ];
  }

  // 10. Metadata Assembly
  const resolvedTitle = exth.title || mobiFullName || pdbName || 'Untitled MOBI Book';
  const resolvedAuthor = exth.author || 'Unknown Author';

  const identifiers: Record<string, string> = {};
  if (exth.isbn) {
    identifiers.isbn = exth.isbn;
  }

  const metadata: Partial<BookMetadata> = {
    title: resolvedTitle,
    author: resolvedAuthor,
    description: exth.description,
    publisher: exth.publisher,
    publicationDate: exth.date,
    identifiers,
    language: exth.language,
  };

  const rawText = htmlToPlainText(decodedText);

  return {
    chapters,
    metadata,
    rawText,
    coverImage,
  };
}
