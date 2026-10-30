/**
 * Amazon Kindle Format 8 (.azw3, .kf8) parser for WebXReader.
 * Decodes Palm Database (PDB) containers, identifies KF8 / MOBI8 sections (including
 * standalone AZW3 and dual-format hybrid files), parses the FDST (Flow Directory Section Table),
 * decompresses PalmDOC LZ77 streams, resolves embedded images and cover art, and splits chapters.
 */

import type { Chapter, BookMetadata } from '../../types/book';
import { generateId } from '../../utils';
import { sanitizeReaderHtml } from './sanitize-reader-html';
import { decompressPalmDocLZ77 } from './mobi-parser';

/** Result of parsing an AZW3 / KF8 document */
export interface Azw3ParseResult {
  chapters: Chapter[];
  metadata: Partial<BookMetadata>;
  rawText: string;
  coverImage?: string;
}

/** Options for AZW3 parsing */
export interface Azw3ParseOptions {
  /** Whether to auto-detect and split chapters. Defaults to true. */
  autoDetectChapters?: boolean;
  /** Fallback encoding if not specified in KF8 header. Defaults to 'utf-8'. */
  defaultEncoding?: string;
}

/** Internal PDB record metadata */
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
 * Strips trailing metadata entries from a MOBI/KF8 record block based on extraRecordDataFlags.
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

  if (extraRecordDataFlags & 1) {
    const off = size - num - 1;
    if (off >= 0) {
      num += (data[off] & 0x03) + 1;
    }
  }

  return num;
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
    .replace(/<\/section>/gi, '\n')
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
  const headingMatch = html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (headingMatch && headingMatch[1]) {
    const titleText = htmlToPlainText(headingMatch[1]).trim();
    if (titleText.length > 0 && titleText.length < 150) {
      return titleText;
    }
  }

  const boldParaMatch = html.match(/<p[^>]*>\s*<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>\s*<\/p>/i);
  if (boldParaMatch && boldParaMatch[1]) {
    const titleText = htmlToPlainText(boldParaMatch[1]).trim();
    if (titleText.length > 0 && titleText.length < 150) {
      return titleText;
    }
  }

  return fallbackTitle;
}

interface ParsedExth {
  author?: string;
  publisher?: string;
  description?: string;
  isbn?: string;
  date?: string;
  language?: string;
  title?: string;
  coverOffset?: number;
  kf8BoundaryOffset?: number;
  kf8CoverUri?: string;
}

/**
 * Parses the EXTH metadata header from a MOBI/KF8 record buffer.
 */
function parseExthHeader(record: Uint8Array, mobiHeaderLength: number): ParsedExth {
  const exth: ParsedExth = {};
  const exthOffset = 16 + mobiHeaderLength;
  if (record.length < exthOffset + 12) return exth;

  // Magic 'EXTH'
  if (
    record[exthOffset] !== 0x45 ||
    record[exthOffset + 1] !== 0x58 ||
    record[exthOffset + 2] !== 0x54 ||
    record[exthOffset + 3] !== 0x48
  ) {
    return exth;
  }

  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
  const exthLength = view.getUint32(exthOffset + 4, false);
  const exthRecordCount = view.getUint32(exthOffset + 8, false);

  let pos = exthOffset + 12;
  const exthEnd = Math.min(exthOffset + exthLength, record.length);

  for (let i = 0; i < exthRecordCount && pos + 8 <= exthEnd; i++) {
    const recordType = view.getUint32(pos, false);
    const recordLength = view.getUint32(pos + 4, false);
    if (recordLength < 8 || pos + recordLength > exthEnd) break;

    const recordData = record.subarray(pos + 8, pos + recordLength);
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
      case 106: // Publishing Date
        exth.date = strVal;
        break;
      case 115: // Language
        exth.language = strVal;
        break;
      case 121: // KF8 Boundary Offset (points to KF8 section in dual files)
        if (recordData.length >= 4) {
          const dv = new DataView(recordData.buffer, recordData.byteOffset, recordData.byteLength);
          exth.kf8BoundaryOffset = dv.getUint32(0, false);
        }
        break;
      case 129: // KF8 Cover URI
        exth.kf8CoverUri = strVal;
        break;
      case 201: // Cover Offset
        if (recordData.length >= 4) {
          const dv = new DataView(recordData.buffer, recordData.byteOffset, recordData.byteLength);
          exth.coverOffset = dv.getUint32(0, false);
        }
        break;
      case 503: // Title
        exth.title = strVal;
        break;
    }
  }

  return exth;
}

/**
 * Parses an Amazon Kindle Format 8 (.azw3, .kf8) binary file into chapters and metadata.
 *
 * @param buffer ArrayBuffer containing the AZW3/KF8 file.
 * @param options Parse configuration options.
 */
export async function parseAzw3(
  buffer: ArrayBuffer,
  options: Azw3ParseOptions = {}
): Promise<Azw3ParseResult> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  if (bytes.length < 78) {
    throw new Error('Not a valid AZW3/KF8 file: file size is smaller than PDB header (78 bytes).');
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
    throw new Error('Invalid AZW3/KF8 file: database contains zero records.');
  }

  if (bytes.length < 78 + numRecords * 8) {
    throw new Error('Truncated AZW3/KF8 file: record list header exceeds file bounds.');
  }

  // 2. Read Record Offsets
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

  function getRecordData(index: number): Uint8Array | null {
    if (index < 0 || index >= numRecords) return null;
    const start = recordsMeta[index].offset;
    const end = index + 1 < numRecords ? recordsMeta[index + 1].offset : bytes.length;
    if (start > bytes.length || end > bytes.length || start >= end) {
      return null;
    }
    return bytes.subarray(start, end);
  }

  // 3. Locate KF8 Section
  // For standalone AZW3/KF8 files, KF8 is at Record 0.
  // For dual-format hybrid files, Record 0 has EXTH tag 121 pointing to the KF8 section.
  const record0 = getRecordData(0);
  if (!record0 || record0.length < 16) {
    throw new Error('Invalid AZW3/KF8 file: Record 0 is missing or corrupted.');
  }

  let kf8RecordIndex = 0;
  let primaryExth: ParsedExth = {};

  if (record0.length >= 40) {
    const isMobi =
      record0[16] === 0x4d &&
      record0[17] === 0x4f &&
      record0[18] === 0x42 &&
      record0[19] === 0x49;

    if (isMobi) {
      const dv0 = new DataView(record0.buffer, record0.byteOffset, record0.byteLength);
      const mobiHeaderLen = dv0.getUint32(20, false);
      const exthFlags = record0.length >= 16 + 116 ? dv0.getUint32(16 + 112, false) : 0;

      if (exthFlags & 0x40) {
        primaryExth = parseExthHeader(record0, mobiHeaderLen);
        if (
          primaryExth.kf8BoundaryOffset !== undefined &&
          primaryExth.kf8BoundaryOffset > 0 &&
          primaryExth.kf8BoundaryOffset < numRecords
        ) {
          kf8RecordIndex = primaryExth.kf8BoundaryOffset;
        }
      }
    }
  }

  // 4. Inspect KF8 Control Block
  const kf8Rec0 = getRecordData(kf8RecordIndex);
  if (!kf8Rec0 || kf8Rec0.length < 16) {
    throw new Error('Invalid AZW3/KF8 file: KF8 control record is missing or corrupted.');
  }

  const kf8View = new DataView(kf8Rec0.buffer, kf8Rec0.byteOffset, kf8Rec0.byteLength);
  const compression = kf8View.getUint16(0, false);
  const textRecordCount = kf8View.getUint16(8, false);
  const encryptionType = kf8View.getUint16(12, false);

  if (encryptionType !== 0) {
    throw new Error('This AZW3 / Kindle Format 8 book is protected with DRM encryption and cannot be read.');
  }

  if (compression !== 1 && compression !== 2) {
    throw new Error(`Unsupported AZW3 compression type (${compression}). Only PalmDOC LZ77 is supported.`);
  }

  let textEncoding = 65001;
  let firstImageIndex = -1;
  let fdstRecordIndex = -1;
  let exthFlags = 0;
  let extraRecordDataFlags = 0;
  let mobiFullName = '';
  let mobiHeaderLength = 0;

  const isKf8Mobi =
    kf8Rec0.length >= 20 &&
    kf8Rec0[16] === 0x4d &&
    kf8Rec0[17] === 0x4f &&
    kf8Rec0[18] === 0x42 &&
    kf8Rec0[19] === 0x49;

  if (isKf8Mobi && kf8Rec0.length >= 40) {
    mobiHeaderLength = kf8View.getUint32(20, false);
    textEncoding = kf8View.getUint32(28, false);

    if (kf8Rec0.length >= 16 + 72) {
      const fullNameOffset = kf8View.getUint32(16 + 68, false);
      const fullNameLength = kf8View.getUint32(16 + 72, false);
      if (fullNameOffset + fullNameLength <= kf8Rec0.length) {
        const titleBytes = kf8Rec0.subarray(fullNameOffset, fullNameOffset + fullNameLength);
        try {
          mobiFullName = new TextDecoder(textEncoding === 1252 ? 'windows-1252' : 'utf-8').decode(titleBytes).trim();
        } catch {
          mobiFullName = new TextDecoder('utf-8').decode(titleBytes).trim();
        }
      }
    }

    if (kf8Rec0.length >= 16 + 96) {
      firstImageIndex = kf8View.getUint32(16 + 92, false);
    }

    if (kf8Rec0.length >= 16 + 116) {
      exthFlags = kf8View.getUint32(16 + 112, false);
    }

    // FDST Table record index at offset 196 of Record 0 = 16 + 180
    if (kf8Rec0.length >= 16 + 184) {
      const fdstCandidate = kf8View.getUint32(196, false);
      if (fdstCandidate !== 0xffffffff && fdstCandidate < numRecords) {
        fdstRecordIndex = fdstCandidate;
      }
    }

    // extraRecordDataFlags at offset 242 from MOBI header = 16 + 242
    if (mobiHeaderLength >= 244 && kf8Rec0.length >= 16 + 244) {
      extraRecordDataFlags = kf8View.getUint16(16 + 242, false);
    }
  }

  // Parse KF8 EXTH block
  const kf8Exth = (exthFlags & 0x40 && mobiHeaderLength > 0)
    ? parseExthHeader(kf8Rec0, mobiHeaderLength)
    : {};

  // Merge EXTH (prefer KF8 EXTH over Record 0 fallback EXTH)
  const exth: ParsedExth = { ...primaryExth, ...kf8Exth };

  // 5. Decompress Text Records (rawML)
  const decompressedChunks: Uint8Array[] = [];
  const maxTextRecords = Math.min(textRecordCount, numRecords - kf8RecordIndex - 1);

  for (let r = 1; r <= maxTextRecords; r++) {
    const rec = getRecordData(kf8RecordIndex + r);
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

  const totalLength = decompressedChunks.reduce((acc, c) => acc + c.length, 0);
  const rawMl = new Uint8Array(totalLength);
  let chunkOffset = 0;
  for (const chunk of decompressedChunks) {
    rawMl.set(chunk, chunkOffset);
    chunkOffset += chunk.length;
  }

  // 6. Resolve FDST (Flow Directory Section Table)
  // Flow 0 is the main XHTML document; subsequent flows contain CSS or SVG assets
  let xhtmlBytes = rawMl;

  if (fdstRecordIndex !== -1) {
    const fdstRecord = getRecordData(fdstRecordIndex);
    if (fdstRecord && fdstRecord.length >= 12) {
      // Magic 'FDST'
      if (
        fdstRecord[0] === 0x46 &&
        fdstRecord[1] === 0x44 &&
        fdstRecord[2] === 0x53 &&
        fdstRecord[3] === 0x54
      ) {
        const fdstView = new DataView(fdstRecord.buffer, fdstRecord.byteOffset, fdstRecord.byteLength);
        const flowCount = fdstView.getUint32(8, false);
        if (flowCount > 0 && fdstRecord.length >= 12 + flowCount * 8) {
          const start0 = fdstView.getUint32(12, false);
          const end0 = fdstView.getUint32(16, false);
          if (end0 > start0 && end0 <= rawMl.length) {
            xhtmlBytes = rawMl.subarray(start0, end0);
          }
        }
      }
    }
  }

  // 7. Decode XHTML String
  let decodedXhtml = '';
  const encodingToUse = options.defaultEncoding || (textEncoding === 1252 ? 'windows-1252' : 'utf-8');

  try {
    decodedXhtml = new TextDecoder(encodingToUse).decode(xhtmlBytes);
  } catch {
    try {
      decodedXhtml = new TextDecoder('utf-8').decode(xhtmlBytes);
    } catch {
      decodedXhtml = new TextDecoder('windows-1252').decode(xhtmlBytes);
    }
  }

  // 8. Extract Cover Image
  let coverImage: string | undefined;
  if (firstImageIndex >= 0 && firstImageIndex < numRecords) {
    let coverRecordIdx = firstImageIndex;

    if (exth.coverOffset !== undefined) {
      coverRecordIdx = firstImageIndex + exth.coverOffset;
    } else if (exth.kf8CoverUri) {
      const match = exth.kf8CoverUri.match(/(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > 0) coverRecordIdx = firstImageIndex + num - 1;
      }
    }

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

  // Normalize page break indicators in KF8 HTML
  let normalizedHtml = decodedXhtml
    .replace(/<div[^>]*style=["'][^"']*page-break-(?:before|after)\s*:\s*always[^"']*["'][^>]*>\s*<\/div>/gi, '<!--azw3-pagebreak-->')
    .replace(/<mbp:pagebreak\s*\/?>/gi, '<!--azw3-pagebreak-->')
    .replace(/<guide[\s\S]*?<\/guide>/gi, '')
    .replace(/<idx:entry[\s\S]*?<\/idx:entry>/gi, '');

  if (autoDetectChapters) {
    let rawSections: string[] = [];

    if (normalizedHtml.includes('<!--azw3-pagebreak-->')) {
      rawSections = normalizedHtml.split('<!--azw3-pagebreak-->');
    } else {
      // Split on semantic HTML5 <section> boundaries or heading tags
      const hasSections = /<section[^>]*>/i.test(normalizedHtml);
      const hasHeadings = /<h[12][^>]*>[\s\S]*?<\/h[12]>/i.test(normalizedHtml);

      if (hasSections) {
        rawSections = normalizedHtml.split(/(?=<section[^>]*>)/i);
      } else if (hasHeadings) {
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
      if (plainText.length === 0 && !/<(?:p|div|h[1-6]|table|blockquote|section|article)/i.test(sectionHtml)) {
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
  const resolvedTitle = exth.title || mobiFullName || pdbName || 'Untitled AZW3 Book';
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

  const rawText = htmlToPlainText(decodedXhtml);

  return {
    chapters,
    metadata,
    rawText,
    coverImage,
  };
}
