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
import { HuffReader } from './huffcdic';

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

/**
 * Checks if a PDB record is a dual-format 'BOUNDARY' delimiter record.
 */
function isBoundaryRecord(record: Uint8Array): boolean {
  if (record.length < 8) return false;
  return (
    record[0] === 0x42 && // 'B'
    record[1] === 0x4f && // 'O'
    record[2] === 0x55 && // 'U'
    record[3] === 0x4e && // 'N'
    record[4] === 0x44 && // 'D'
    record[5] === 0x41 && // 'A'
    record[6] === 0x52 && // 'R'
    record[7] === 0x59    // 'Y'
  );
}

/**
 * Checks if a PDB record contains a MOBI header starting at offset 16.
 */
function isMobiHeader(record: Uint8Array): boolean {
  if (record.length < 40) return false;
  return (
    record[16] === 0x4d && // 'M'
    record[17] === 0x4f && // 'O'
    record[18] === 0x42 && // 'B'
    record[19] === 0x49    // 'I'
  );
}

/**
 * Validates whether decompressed rawML bytes represent readable text or HTML markup
 * rather than unreadable binary ciphertext or corrupted random data.
 */
function isReadableText(raw: Uint8Array): boolean {
  if (raw.length === 0) return false;
  const sample = raw.subarray(0, Math.min(raw.length, 2048));
  let decoded = '';
  try {
    decoded = new TextDecoder('utf-8').decode(sample);
  } catch {
    try {
      decoded = new TextDecoder('windows-1252').decode(sample);
    } catch {
      return false;
    }
  }

  // Check for common HTML/XML markup tags
  if (/<(?:html|head|body|div|p|span|section|article|h[1-6]|mbp|a|table|\?xml)/i.test(decoded)) {
    return true;
  }

  // Check printable character ratio
  let printable = 0;
  for (let i = 0; i < decoded.length; i++) {
    const c = decoded.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 65533)) {
      printable++;
    }
  }
  return decoded.length > 0 && printable / decoded.length >= 0.75;
}

/**
 * Attempts to decompress a series of PDB text records into rawML bytes.
 * Returns null if decompression fails or if compression is unsupported.
 */

/**
 * Resolves HuffReader instance for HUFF/CDIC-compressed books (compression 17480).
 */
function findHuffReader(
  headerRecIndex: number,
  huffOffsetCand: number,
  huffCountCand: number,
  getRecord: (idx: number) => Uint8Array | null,
  numTotalRecords: number
): HuffReader | null {
  let huffRecord: Uint8Array | null = null;
  const cdicRecords: Uint8Array[] = [];

  // Candidate 1: headerRecIndex + huffOffsetCand
  if (huffOffsetCand > 0 && headerRecIndex + huffOffsetCand < numTotalRecords) {
    const cand = getRecord(headerRecIndex + huffOffsetCand);
    if (cand && cand.length >= 8 && cand[0] === 0x48 && cand[1] === 0x55 && cand[2] === 0x46 && cand[3] === 0x46) {
      huffRecord = cand;
      const count = huffCountCand > 0 ? huffCountCand : 32;
      for (let j = 1; j < count && headerRecIndex + huffOffsetCand + j < numTotalRecords; j++) {
        const cdicCand = getRecord(headerRecIndex + huffOffsetCand + j);
        if (cdicCand && cdicCand.length >= 8 && cdicCand[0] === 0x43 && cdicCand[1] === 0x44 && cdicCand[2] === 0x49 && cdicCand[3] === 0x43) {
          cdicRecords.push(cdicCand);
        } else {
          break;
        }
      }
    }
  }

  // Candidate 2: huffOffsetCand absolute
  if (!huffRecord && huffOffsetCand > 0 && huffOffsetCand < numTotalRecords) {
    const cand = getRecord(huffOffsetCand);
    if (cand && cand.length >= 8 && cand[0] === 0x48 && cand[1] === 0x55 && cand[2] === 0x46 && cand[3] === 0x46) {
      huffRecord = cand;
      const count = huffCountCand > 0 ? huffCountCand : 32;
      for (let j = 1; j < count && huffOffsetCand + j < numTotalRecords; j++) {
        const cdicCand = getRecord(huffOffsetCand + j);
        if (cdicCand && cdicCand.length >= 8 && cdicCand[0] === 0x43 && cdicCand[1] === 0x44 && cdicCand[2] === 0x49 && cdicCand[3] === 0x43) {
          cdicRecords.push(cdicCand);
        } else {
          break;
        }
      }
    }
  }

  // Candidate 3: Scan all records in PDB for 'HUFF'
  if (!huffRecord) {
    for (let i = 0; i < numTotalRecords; i++) {
      const rec = getRecord(i);
      if (rec && rec.length >= 8 && rec[0] === 0x48 && rec[1] === 0x55 && rec[2] === 0x46 && rec[3] === 0x46) {
        huffRecord = rec;
        for (let j = i + 1; j < numTotalRecords; j++) {
          const cdicRec = getRecord(j);
          if (cdicRec && cdicRec.length >= 8 && cdicRec[0] === 0x43 && cdicRec[1] === 0x44 && cdicRec[2] === 0x49 && cdicRec[3] === 0x43) {
            cdicRecords.push(cdicRec);
          } else {
            break;
          }
        }
        break;
      }
    }
  }

  if (huffRecord && cdicRecords.length > 0) {
    try {
      return new HuffReader(huffRecord, cdicRecords);
    } catch {
      return null;
    }
  }

  return null;
}

function tryDecompressRecords(
  startIndex: number,
  recordCount: number,
  compression: number,
  extraRecordDataFlags: number,
  getRecord: (idx: number) => Uint8Array | null,
  numTotalRecords: number,
  huffReader?: HuffReader | null
): Uint8Array | null {
  const decompressedChunks: Uint8Array[] = [];
  const maxRecords = Math.min(recordCount, numTotalRecords - startIndex - 1);
  if (maxRecords <= 0) return null;

  for (let r = 1; r <= maxRecords; r++) {
    const rec = getRecord(startIndex + r);
    if (!rec) break;

    const trailingSize = getTrailingBytesSize(rec, extraRecordDataFlags);
    const contentPayload = trailingSize > 0 && trailingSize < rec.length
      ? rec.subarray(0, rec.length - trailingSize)
      : rec;

    try {
      if (compression === 2) {
        decompressedChunks.push(decompressPalmDocLZ77(contentPayload));
      } else if (compression === 1) {
        decompressedChunks.push(contentPayload);
      } else if (compression === 17480 && huffReader) {
        decompressedChunks.push(huffReader.unpack(contentPayload));
      } else {
        return null;
      }
    } catch {
      return null; // Corrupted or encrypted block
    }
  }

  if (decompressedChunks.length === 0) return null;
  const totalLength = decompressedChunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of decompressedChunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
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
 * Parses EXTH extended metadata section from a record block.
 */
function parseExthHeader(record: Uint8Array, mobiHeaderLength: number): ParsedExth {
  const exth: ParsedExth = {};
  const exthOffset = 16 + mobiHeaderLength;

  if (
    record.length < exthOffset + 12 ||
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

  const record0 = getRecordData(0);
  if (!record0 || record0.length < 16) {
    throw new Error('Invalid AZW3/KF8 file: Record 0 is missing or corrupted.');
  }

  // 3. Locate KF8 Section
  // For standalone AZW3/KF8 files, KF8 is at Record 0 (mobi_version >= 8).
  // For dual-format hybrid files, Record 0 has EXTH tag 121 pointing to BOUNDARY or KF8,
  // or a BOUNDARY record exists separating MOBI 7 from KF8.
  let kf8RecordIndex = -1;
  let primaryExth: ParsedExth = {};

  if (isMobiHeader(record0)) {
    const dv0 = new DataView(record0.buffer, record0.byteOffset, record0.byteLength);
    const mobiVersion = dv0.getUint32(36, false);
    if (mobiVersion >= 8) {
      kf8RecordIndex = 0;
    } else {
      // Record 0 is MOBI 7 / legacy. Check EXTH tag 121
      const mobiHeaderLen = dv0.getUint32(20, false);
      const exthFlags = record0.length >= 16 + 116 ? dv0.getUint32(16 + 112, false) : 0;
      if (exthFlags & 0x40) {
        primaryExth = parseExthHeader(record0, mobiHeaderLen);
        const bOffset = primaryExth.kf8BoundaryOffset;
        if (bOffset !== undefined && bOffset > 0 && bOffset < numRecords) {
          const bRec = getRecordData(bOffset);
          if (bRec && isBoundaryRecord(bRec)) {
            // In KindleGen dual files, tag 121 points directly to the BOUNDARY record.
            // The KF8 control block is located at bOffset + 1.
            if (bOffset + 1 < numRecords) {
              kf8RecordIndex = bOffset + 1;
            }
          } else if (bOffset > 0) {
            const prevRec = getRecordData(bOffset - 1);
            if (prevRec && isBoundaryRecord(prevRec)) {
              // In Calibre dual files, tag 121 points to KF8 header (bOffset - 1 is BOUNDARY).
              kf8RecordIndex = bOffset;
            } else if (bRec && isMobiHeader(bRec)) {
              kf8RecordIndex = bOffset;
            }
          }
        }
      }
    }
  }

  // Strategy 2: If KF8 section not yet identified, scan for 'BOUNDARY' marker
  if (kf8RecordIndex < 0) {
    for (let i = 0; i < numRecords; i++) {
      const rec = getRecordData(i);
      if (rec && isBoundaryRecord(rec)) {
        if (i + 1 < numRecords) {
          const nextRec = getRecordData(i + 1);
          if (nextRec && (isMobiHeader(nextRec) || nextRec.length >= 16)) {
            kf8RecordIndex = i + 1;
            break;
          }
        }
      }
    }
  }

  // Strategy 3: Scan all records for ANY record with 'MOBI' identifier and mobi_version >= 8
  if (kf8RecordIndex < 0) {
    for (let i = 0; i < numRecords; i++) {
      const rec = getRecordData(i);
      if (rec && isMobiHeader(rec)) {
        const dv = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
        const version = dv.getUint32(36, false);
        if (version >= 8) {
          kf8RecordIndex = i;
          break;
        }
      }
    }
  }

  // Fallback: If no separate KF8 section found, use Record 0
  if (kf8RecordIndex < 0) {
    kf8RecordIndex = 0;
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
  const isDrmFlagged = encryptionType !== 0;

  let textEncoding = 65001;
  let firstImageIndex = -1;
  let fdstRecordIndex = -1;
  let exthFlags = 0;
  let extraRecordDataFlags = 0;
  let mobiFullName = '';
  let mobiHeaderLength = 0;

  const isKf8Mobi = isMobiHeader(kf8Rec0);

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
      const candIdx = kf8View.getUint32(16 + 92, false);
      if (candIdx !== 0xffffffff) {
        if (kf8RecordIndex + candIdx < numRecords && detectImageMimeType(getRecordData(kf8RecordIndex + candIdx) ?? new Uint8Array(0))) {
          firstImageIndex = kf8RecordIndex + candIdx;
        } else if (candIdx < numRecords && detectImageMimeType(getRecordData(candIdx) ?? new Uint8Array(0))) {
          firstImageIndex = candIdx;
        } else {
          firstImageIndex = kf8RecordIndex > 0 ? kf8RecordIndex + candIdx : candIdx;
        }
      }
    }

    if (kf8Rec0.length >= 16 + 116) {
      exthFlags = kf8View.getUint32(16 + 112, false);
    }

    // FDST Table record index at offset 196 of Record 0 = 16 + 180
    if (kf8Rec0.length >= 16 + 184) {
      const fdstCandidate = kf8View.getUint32(196, false);
      if (fdstCandidate !== 0xffffffff) {
        if (kf8RecordIndex + fdstCandidate < numRecords) {
          const cand = getRecordData(kf8RecordIndex + fdstCandidate);
          if (cand && cand.length >= 4 && cand[0] === 0x46 && cand[1] === 0x44 && cand[2] === 0x53 && cand[3] === 0x54) {
            fdstRecordIndex = kf8RecordIndex + fdstCandidate;
          }
        }
        if (fdstRecordIndex === -1 && fdstCandidate < numRecords) {
          const cand = getRecordData(fdstCandidate);
          if (cand && cand.length >= 4 && cand[0] === 0x46 && cand[1] === 0x44 && cand[2] === 0x53 && cand[3] === 0x54) {
            fdstRecordIndex = fdstCandidate;
          }
        }
      }
    }

    if (fdstRecordIndex === -1) {
      for (let i = kf8RecordIndex + 1; i < numRecords; i++) {
        const cand = getRecordData(i);
        if (cand && cand.length >= 4 && cand[0] === 0x46 && cand[1] === 0x44 && cand[2] === 0x53 && cand[3] === 0x54) {
          fdstRecordIndex = i;
          break;
        }
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

  // Locate HUFF/CDIC reader if compression is 17480 (HUFF/CDIC)
  let huffOffsetCandidate = 0;
  let huffCountCandidate = 0;
  if (kf8Rec0.length >= 16 + 120) {
    huffOffsetCandidate = kf8View.getUint32(16 + 112, false);
    huffCountCandidate = kf8View.getUint32(16 + 116, false);
  }

  let huffReader: HuffReader | null = null;
  if (compression === 17480) {
    huffReader = findHuffReader(kf8RecordIndex, huffOffsetCandidate, huffCountCandidate, getRecordData, numRecords);
  }

  // 5. Decompress Text Records (rawML)
  let rawMl = tryDecompressRecords(
    kf8RecordIndex,
    textRecordCount,
    compression,
    extraRecordDataFlags,
    getRecordData,
    numRecords,
    huffReader
  );

  let usedFallbackMobi7 = false;

  // In dual-format files, if KF8 decompression fails or yields unreadable ciphertext,
  // attempt to fall back to the MOBI 7 (Record 0) stream if available
  if ((!rawMl || !isReadableText(rawMl)) && kf8RecordIndex > 0 && record0.length >= 16) {
    const dv0 = new DataView(record0.buffer, record0.byteOffset, record0.byteLength);
    const m7Comp = dv0.getUint16(0, false);
    const m7Count = dv0.getUint16(8, false);
    let m7ExtraFlags = 0;
    if (isMobiHeader(record0)) {
      const m7HeaderLen = dv0.getUint32(20, false);
      if (m7HeaderLen >= 244 && record0.length >= 16 + 244) {
        m7ExtraFlags = dv0.getUint16(16 + 242, false);
      }
    }
    const m7Raw = tryDecompressRecords(0, m7Count, m7Comp, m7ExtraFlags, getRecordData, numRecords);
    if (m7Raw && isReadableText(m7Raw)) {
      rawMl = m7Raw;
      usedFallbackMobi7 = true;
    }
  }

  // If content is still missing or unreadable
  if (!rawMl || !isReadableText(rawMl)) {
    if (isDrmFlagged) {
      throw new Error(
        'This AZW3 / Kindle Format 8 book is protected with Amazon Kindle DRM encryption and cannot be read directly. ' +
        'To read this book in WebXReader, the DRM must be removed (for example, by converting the book using Calibre with the DeDRM plugin).'
      );
    }
    if (compression !== 1 && compression !== 2 && compression !== 17480) {
      throw new Error(`Unsupported AZW3 compression type (${compression}). WebXReader supports standard PalmDOC LZ77, HUFF/CDIC, and uncompressed KF8 books.`);
    }
    throw new Error('Failed to decompress AZW3 file: the book appears corrupted or contains unsupported records.');
  }

  // 6. Resolve FDST (Flow Directory Section Table)
  // Flow 0 is the main XHTML document; subsequent flows contain CSS or SVG assets
  let xhtmlBytes = rawMl;

  if (!usedFallbackMobi7 && fdstRecordIndex !== -1) {
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
