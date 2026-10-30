/**
 * Legacy Microsoft Word 97-2004 (.doc) binary parser.
 * Reads OLE2 Compound File Binary Format (CFBF), extracts the WordDocument stream
 * and piece table (Plcfpcd), resolves Unicode & CP1252 text, parses OLE summary metadata,
 * and converts content into clean, reflowable reader chapters.
 */

import CFB from 'cfb';
import type { Chapter, BookMetadata } from '../../types/book';
import { sanitizeReaderHtml } from './sanitize-reader-html';

export interface DocParseOptions {
  autoDetectChapters?: boolean;
}

export interface DocParseResult {
  chapters: Chapter[];
  metadata: Partial<BookMetadata>;
  rawText: string;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

/**
 * Escapes HTML characters for safe text insertion.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Parses standard OLE PropertySet stream (e.g. \x05SummaryInformation)
 * for title, author, subject, keywords, and comments.
 */
function parseSummaryInformation(data: Uint8Array): {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  comments?: string;
} {
  const result: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    comments?: string;
  } = {};

  if (!data || data.length < 48) return result;

  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const numSections = view.getUint32(24, true);
    if (numSections === 0) return result;

    const sectionOffset = view.getUint32(44, true);
    if (sectionOffset + 8 > data.length) return result;

    const secView = new DataView(data.buffer, data.byteOffset + sectionOffset, data.byteLength - sectionOffset);
    const numProps = secView.getUint32(4, true);

    for (let i = 0; i < numProps && 8 + i * 8 + 8 <= data.length - sectionOffset; i++) {
      const propId = secView.getUint32(8 + i * 8, true);
      const offset = secView.getUint32(8 + i * 8 + 4, true);
      if (offset + 4 > data.length - sectionOffset) continue;

      const propType = secView.getUint32(offset, true);
      let strVal = '';

      if (propType === 30) {
        // VT_LPSTR (ANSI null-terminated)
        const strLen = secView.getUint32(offset + 4, true);
        const strBytes = data.subarray(sectionOffset + offset + 8, sectionOffset + offset + 8 + strLen);
        strVal = new TextDecoder('windows-1252').decode(strBytes).replace(/\0+$/, '').trim();
      } else if (propType === 31) {
        // VT_LPWSTR (UTF-16LE null-terminated)
        const charLen = secView.getUint32(offset + 4, true);
        const strBytes = data.subarray(sectionOffset + offset + 8, sectionOffset + offset + 8 + charLen * 2);
        strVal = new TextDecoder('utf-16le').decode(strBytes).replace(/\0+$/, '').trim();
      }

      if (strVal) {
        switch (propId) {
          case 2:
            result.title = strVal;
            break;
          case 3:
            result.subject = strVal;
            break;
          case 4:
            result.author = strVal;
            break;
          case 5:
            result.keywords = strVal;
            break;
          case 6:
            result.comments = strVal;
            break;
        }
      }
    }
  } catch {
    // Ignore metadata parsing errors
  }

  return result;
}

/**
 * Converts Word binary document text into clean semantic HTML.
 */
function convertDocTextToHtml(rawDocText: string): string {
  // Replace page/section breaks (Form Feed 0x0C) with marker
  const withPageBreaks = rawDocText.replace(/\x0C/g, '\n<!--doc-pagebreak-->\n');

  // Split into paragraphs by \r\n, \r, or \n
  const lines = withPageBreaks.split(/\r\n|\r|\n/);
  const htmlParts: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === '<!--doc-pagebreak-->') {
      htmlParts.push('<!--doc-pagebreak-->');
      continue;
    }

    // Check if line represents table cells delimited by \x07
    if (trimmed.includes('\x07')) {
      const cells = trimmed
        .split('\x07')
        .map((c) => c.replace(/[\x00-\x08\x0E-\x1F]/g, '').trim())
        .filter((c) => c.length > 0);

      if (cells.length > 0) {
        const rowHtml = cells
          .map((c) => `<td>${escapeHtml(c).replace(/\x0B/g, '<br />')}</td>`)
          .join('');
        htmlParts.push(`<table><tr>${rowHtml}</tr></table>`);
        continue;
      }
    }

    // Regular paragraph: strip Word binary control characters
    // Escape HTML first, then convert \x0B (soft break Shift+Enter) to <br />
    const escaped = escapeHtml(trimmed.replace(/[\x00-\x08\x0E-\x1F]/g, '')).replace(/\x0B/g, '<br />');
    const plainTextForHeadingCheck = trimmed.replace(/[\x00-\x1F]/g, '').trim();

    if (!plainTextForHeadingCheck) continue;

    // Detect heading candidates: short text without sentence terminators
    const isHeading =
      plainTextForHeadingCheck.length < 60 &&
      !plainTextForHeadingCheck.endsWith('.') &&
      !plainTextForHeadingCheck.endsWith(',') &&
      /^(?:chapter\s+\d+|part\s+\d+|section\s+\d+|prologue|epilogue|[A-Z0-9\s:—–-]+)$/i.test(plainTextForHeadingCheck);

    if (isHeading) {
      htmlParts.push(`<h2>${escaped}</h2>`);
    } else {
      htmlParts.push(`<p>${escaped}</p>`);
    }
  }

  return htmlParts.join('\n');
}

/**
 * Parses a legacy Microsoft Word 97-2004 (.doc) file buffer into chapters, metadata, and raw text.
 */
export async function parseDoc(
  data: ArrayBuffer | Uint8Array,
  options: DocParseOptions = {}
): Promise<DocParseResult> {
  const bytes =
    data instanceof Uint8Array
      ? data
      : new Uint8Array(data);

  if (bytes.length < 512) {
    throw new Error('Not a valid DOC file: file is smaller than CFBF header (512 bytes).');
  }

  // 1. Verify OLE2 Compound File Header Magic (0xD0CF11E0A1B11AE1)
  if (
    bytes[0] !== 0xd0 ||
    bytes[1] !== 0xcf ||
    bytes[2] !== 0x11 ||
    bytes[3] !== 0xe0 ||
    bytes[4] !== 0xa1 ||
    bytes[5] !== 0xb1 ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0xe1
  ) {
    throw new Error('Not a valid DOC file: missing OLE2 Compound Document header signature.');
  }

  // 2. Parse CFBF Container using CFB
  let cfb: CFB.CFB$Container;
  try {
    cfb = CFB.read(bytes, { type: 'array' });
  } catch (err) {
    throw new Error(`Failed to parse OLE2 Compound Document: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Locate WordDocument stream
  const wordDocEntry = CFB.find(cfb, 'WordDocument');
  if (!wordDocEntry || !wordDocEntry.content) {
    throw new Error('Invalid DOC file: WordDocument stream not found inside OLE container.');
  }

  const wordDoc = new Uint8Array(wordDocEntry.content);
  if (wordDoc.length < 0x01a6) {
    throw new Error('Corrupted DOC file: WordDocument stream is smaller than File Information Block (FIB).');
  }

  const fibView = new DataView(wordDoc.buffer, wordDoc.byteOffset, wordDoc.byteLength);

  // Magic validation (0xa5ec for Word 97-2004, 0xa5dc for Word 95)
  const fibMagic = fibView.getUint16(0, true);
  if (fibMagic !== 0xa5ec && fibMagic !== 0xa5dc) {
    throw new Error(`Invalid DOC file: unrecognized Word FIB magic (0x${fibMagic.toString(16)}).`);
  }

  // Check password encryption
  const flags = fibView.getUint16(0x000a, true);
  if ((flags & 0x0100) !== 0) {
    throw new Error(
      'This Microsoft Word (.doc) document is protected with password encryption and cannot be read directly. ' +
      'Please remove the password protection in Microsoft Word before importing.'
    );
  }

  // Determine Table Stream (1Table or 0Table)
  const isTable1 = (flags & 0x0200) !== 0;
  const tableStreamName = isTable1 ? '1Table' : '0Table';
  const tableEntry = CFB.find(cfb, tableStreamName);

  if (!tableEntry || !tableEntry.content) {
    throw new Error(`Invalid DOC file: ${tableStreamName} stream not found inside OLE container.`);
  }

  const tableStream = new Uint8Array(tableEntry.content);
  const tableView = new DataView(tableStream.buffer, tableStream.byteOffset, tableStream.byteLength);

  // Read FIB pointers
  const fcClx = fibView.getUint32(0x01a2, true);
  const lcbClx = fibView.getUint32(0x01a6, true);
  const ccpText = fibView.getUint32(0x004c, true);

  if (fcClx >= tableStream.length) {
    throw new Error('Corrupted DOC file: Clx piece table offset exceeds Table stream size.');
  }

  // 4. Walk Clx to locate Plcfpcd (Piece Descriptor Table)
  let pos = fcClx;
  const clxEnd = Math.min(fcClx + lcbClx, tableStream.length);

  while (pos < clxEnd) {
    const clxt = tableView.getUint8(pos);
    if (clxt === 1) {
      // Prc (Property Container), skip cb bytes
      pos++;
      if (pos + 2 > clxEnd) break;
      const cb = tableView.getUint16(pos, true);
      pos += 2 + cb;
    } else if (clxt === 2) {
      // Plcfpcd found!
      pos++;
      break;
    } else {
      break;
    }
  }

  if (pos + 4 > clxEnd) {
    throw new Error('Corrupted DOC file: failed to locate Plcfpcd piece table.');
  }

  const lcbPlcfpcd = tableView.getUint32(pos, true);
  pos += 4;
  const pieceCount = Math.floor((lcbPlcfpcd - 4) / 12);

  if (pieceCount <= 0 || pos + (pieceCount + 1) * 4 + pieceCount * 8 > tableStream.length) {
    throw new Error('Corrupted DOC file: invalid or empty piece descriptor table.');
  }

  // 5. Reassemble Text from Piece Descriptors
  const textPieces: string[] = [];

  for (let i = 0; i < pieceCount; i++) {
    const cpStart = tableView.getUint32(pos + i * 4, true);
    const cpEnd = tableView.getUint32(pos + (i + 1) * 4, true);
    const pcdOffset = pos + (pieceCount + 1) * 4 + i * 8;
    const fc = tableView.getUint32(pcdOffset + 2, true);

    const isAnsi = (fc & 0x40000000) !== 0;
    const actualFc = isAnsi ? (fc & ~0x40000000) / 2 : fc;
    const charLen = cpEnd - cpStart;
    const byteLen = isAnsi ? charLen : charLen * 2;

    if (actualFc + byteLen <= wordDoc.length && charLen > 0) {
      const slice = wordDoc.subarray(actualFc, actualFc + byteLen);
      try {
        if (isAnsi) {
          textPieces.push(new TextDecoder('windows-1252').decode(slice));
        } else {
          textPieces.push(new TextDecoder('utf-16le').decode(slice));
        }
      } catch {
        // Fallback
        textPieces.push(new TextDecoder('utf-8').decode(slice));
      }
    }
  }

  const fullRawText = textPieces.join('');
  const mainText = ccpText > 0 && ccpText <= fullRawText.length
    ? fullRawText.slice(0, ccpText)
    : fullRawText;

  // 6. Extract Metadata from \x05SummaryInformation
  const summaryEntry = CFB.find(cfb, '\x05SummaryInformation');
  const summaryProps = summaryEntry && summaryEntry.content
    ? parseSummaryInformation(new Uint8Array(summaryEntry.content))
    : {};

  const metadata: Partial<BookMetadata> = {
    title: summaryProps.title,
    author: summaryProps.author,
    description: summaryProps.subject || summaryProps.comments,
  };

  // 7. Convert to HTML and Detect Chapters
  const autoDetectChapters = options.autoDetectChapters ?? true;
  const fullHtml = convertDocTextToHtml(mainText);

  let chapters: Chapter[] = [];

  if (autoDetectChapters) {
    let rawSections: string[] = [];

    if (fullHtml.includes('<!--doc-pagebreak-->')) {
      rawSections = fullHtml.split('<!--doc-pagebreak-->');
    } else if (/<h2[^>]*>/i.test(fullHtml)) {
      rawSections = fullHtml.split(/(?=<h2[^>]*>)/i);
    } else {
      rawSections = [fullHtml];
    }

    let order = 0;
    for (const section of rawSections) {
      const trimmed = section.trim();
      if (!trimmed) continue;

      let title = `Chapter ${order + 1}`;
      const hMatch = trimmed.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
      if (hMatch) {
        title = hMatch[1].replace(/<[^>]+>/g, '').trim();
      } else {
        const pMatch = trimmed.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        if (pMatch) {
          const pText = pMatch[1].replace(/<[^>]+>/g, '').trim();
          if (pText.length > 0 && pText.length <= 60) {
            title = pText;
          }
        }
      }

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

  if (chapters.length === 0) {
    const defaultTitle = metadata.title || 'Document';
    const singleContent = fullHtml.replace(/<!--doc-pagebreak-->/g, '<hr class="page-break" />');
    chapters = [
      {
        id: generateId(),
        title: defaultTitle,
        level: 0,
        order: 0,
        content: sanitizeReaderHtml(singleContent),
      },
    ];
  }

  // Clean rawText for searching / progress calculation
  const cleanRawText = mainText
    .replace(/[\x00-\x08\x0B-\x1F]/g, ' ')
    .replace(/\r\n|\r|\n/g, '\n')
    .trim();

  return {
    chapters,
    metadata,
    rawText: cleanRawText,
  };
}
