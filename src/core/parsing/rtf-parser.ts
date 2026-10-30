/**
 * Robust, zero-dependency RTF (Rich Text Format) parser for WebXReader.
 * Converts RTF documents into structured chapters with metadata,
 * supporting unicode, font tables, color tables, tables, and typography.
 */

import type { Chapter, BookMetadata } from '../../types/book';
import { generateId, escapeHtml } from '../../utils';
import { sanitizeReaderHtml } from './sanitize-reader-html';

/** Result of parsing an RTF document */
export interface RtfParseResult {
  chapters: Chapter[];
  metadata: Partial<BookMetadata>;
  rawText: string;
}

/** Options for RTF parsing */
export interface RtfParseOptions {
  /** Whether to auto-detect chapter breaks/headings. Defaults to true. */
  autoDetectChapters?: boolean;
  /** Fallback code page if not declared in the RTF header. Defaults to 1252. */
  defaultCodePage?: number;
}

/** Windows-1252 mapping for bytes 0x80 to 0x9F */
const CP1252_MAP: Record<number, number> = {
  0x80: 0x20AC, // €
  0x82: 0x201A, // ‚
  0x83: 0x0192, // ƒ
  0x84: 0x201E, // „
  0x85: 0x2026, // …
  0x86: 0x2020, // †
  0x87: 0x2021, // ‡
  0x88: 0x02C6, // ˆ
  0x89: 0x2030, // ‰
  0x8A: 0x0160, // Š
  0x8B: 0x2039, // ‹
  0x8C: 0x0152, // Œ
  0x8E: 0x017D, // Ž
  0x91: 0x2018, // ‘
  0x92: 0x2019, // ’
  0x93: 0x201C, // “
  0x94: 0x201D, // ”
  0x95: 0x2022, // •
  0x96: 0x2013, // –
  0x97: 0x2014, // —
  0x98: 0x02DC, // ˜
  0x99: 0x2122, // ™
  0x9A: 0x0161, // š
  0x9B: 0x203A, // ›
  0x9C: 0x0153, // œ
  0x9E: 0x017E, // ž
  0x9F: 0x0178, // Ÿ
};

function decodeCp1252Byte(byte: number): string {
  if (byte >= 0x80 && byte <= 0x9F) {
    const unicode = CP1252_MAP[byte];
    return unicode ? String.fromCharCode(unicode) : String.fromCharCode(byte);
  }
  return String.fromCharCode(byte);
}

/** Character styling flags in RTF state */
interface RtfCharFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  subscript: boolean;
  superscript: boolean;
  fontSize: number; // half-points, e.g. 24 = 12pt
}

/** Checks whether two character formats are identical */
function areFormatsEqual(a: RtfCharFormat, b: RtfCharFormat): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.subscript === b.subscript &&
    a.superscript === b.superscript &&
    a.fontSize === b.fontSize
  );
}

/** Paragraph formatting in RTF state */
interface RtfParaFormat {
  align: 'left' | 'center' | 'right' | 'justify';
  headingLevel: number; // 0 = normal, 1 = h1, 2 = h2, 3 = h3
}

/** Complete state for an RTF group */
interface RtfGroupState {
  charFormat: RtfCharFormat;
  paraFormat: RtfParaFormat;
  destination: string | null;
  unicodeSkipCount: number;
}

const DEFAULT_CHAR_FORMAT: RtfCharFormat = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  subscript: false,
  superscript: false,
  fontSize: 24,
};

const DEFAULT_PARA_FORMAT: RtfParaFormat = {
  align: 'left',
  headingLevel: 0,
};

/** Text run accumulated inside a paragraph */
interface TextSpan {
  text: string;
  format: RtfCharFormat;
}

/** Block element in an RTF document */
type RtfBlock =
  | { type: 'paragraph'; align: 'left' | 'center' | 'right' | 'justify'; headingLevel: number; spans: TextSpan[] }
  | { type: 'table'; rows: TextSpan[][][] }
  | { type: 'pageBreak' }
  | { type: 'sectionBreak' };

/**
 * Parses an RTF document string into HTML blocks and metadata.
 */
export function parseRtf(rtfContent: string, options: RtfParseOptions = {}): RtfParseResult {
  const { autoDetectChapters = true } = options;

  // Verify header
  const trimmed = rtfContent.trimStart();
  if (!trimmed.startsWith('{\\rtf')) {
    throw new Error('Invalid RTF document: missing {\\rtf header');
  }

  // State
  const metadata: Partial<BookMetadata> = {};
  const blocks: RtfBlock[] = [];
  let currentSpans: TextSpan[] = [];
  let currentParaFormat: RtfParaFormat = { ...DEFAULT_PARA_FORMAT };
  let inTable = false;
  let currentTableRows: TextSpan[][][] = [];
  let currentTableRow: TextSpan[][] = [];
  let currentTableCell: TextSpan[] = [];

  const stateStack: RtfGroupState[] = [];
  let currentState: RtfGroupState = {
    charFormat: { ...DEFAULT_CHAR_FORMAT },
    paraFormat: { ...DEFAULT_PARA_FORMAT },
    destination: null,
    unicodeSkipCount: 1,
  };

  // Ignored destinations
  const IGNORED_DESTINATIONS = new Set([
    'fonttbl',
    'colortbl',
    'stylesheet',
    'filetbl',
    'listtable',
    'listoverridetable',
    'generator',
    'themedata',
    'colorschememapping',
    'datastore',
    'xmlnstbl',
    'pict',
    'object',
    'header',
    'footer',
    'headerl',
    'headerr',
    'headerf',
    'footerl',
    'footerr',
    'footerf',
    'latentstyles',
  ]);

  let infoField: 'title' | 'author' | 'doccomm' | 'subject' | 'keywords' | null = null;
  let infoFieldBuffer = '';

  const flushParagraph = () => {
    if (currentSpans.length > 0) {
      blocks.push({
        type: 'paragraph',
        align: currentParaFormat.align,
        headingLevel: currentParaFormat.headingLevel,
        spans: currentSpans,
      });
      currentSpans = [];
    }
  };

  const flushTableCell = () => {
    currentTableRow.push(currentTableCell);
    currentTableCell = [];
  };

  const flushTableRow = () => {
    if (currentTableCell.length > 0) {
      flushTableCell();
    }
    if (currentTableRow.length > 0) {
      currentTableRows.push(currentTableRow);
      currentTableRow = [];
    }
  };

  const flushTable = () => {
    flushTableRow();
    if (currentTableRows.length > 0) {
      blocks.push({
        type: 'table',
        rows: currentTableRows,
      });
      currentTableRows = [];
    }
    inTable = false;
  };

  const appendText = (text: string) => {
    if (currentState.destination && IGNORED_DESTINATIONS.has(currentState.destination)) {
      return;
    }
    if (infoField) {
      infoFieldBuffer += text;
      return;
    }
    if (text.length === 0) return;

    const targetSpans = inTable ? currentTableCell : currentSpans;
    const lastSpan = targetSpans[targetSpans.length - 1];

    if (lastSpan && areFormatsEqual(lastSpan.format, currentState.charFormat)) {
      lastSpan.text += text;
    } else {
      targetSpans.push({
        text,
        format: { ...currentState.charFormat },
      });
    }
  };

  const len = rtfContent.length;
  let i = 0;

  while (i < len) {
    const char = rtfContent[i];

    if (char === '{') {
      stateStack.push({
        charFormat: { ...currentState.charFormat },
        paraFormat: { ...currentState.paraFormat },
        destination: currentState.destination,
        unicodeSkipCount: currentState.unicodeSkipCount,
      });
      i++;
      continue;
    }

    if (char === '}') {
      if (infoField) {
        const val = infoFieldBuffer.trim();
        if (infoField === 'title' && val) metadata.title = val;
        if (infoField === 'author' && val) metadata.author = val;
        if ((infoField === 'doccomm' || infoField === 'subject') && val && !metadata.description) {
          metadata.description = val;
        }
        if (infoField === 'keywords' && val) {
          metadata.identifiers = { ...(metadata.identifiers || {}), keywords: val };
        }
        infoField = null;
        infoFieldBuffer = '';
      }

      if (stateStack.length > 0) {
        currentState = stateStack.pop()!;
      }
      i++;
      continue;
    }

    if (char === '\\') {
      i++;
      if (i >= len) break;

      const nextChar = rtfContent[i];

      // Control symbols
      if (nextChar === '\\' || nextChar === '{' || nextChar === '}') {
        appendText(nextChar);
        i++;
        continue;
      }
      if (nextChar === '~') {
        appendText('\u00A0'); // non-breaking space
        i++;
        continue;
      }
      if (nextChar === '-') {
        appendText('\u00AD'); // soft hyphen
        i++;
        continue;
      }
      if (nextChar === '_') {
        appendText('\u2011'); // non-breaking hyphen
        i++;
        continue;
      }
      if (nextChar === '*') {
        // Ignorable destination prefix: \*\controlword
        i++;
        currentState.destination = '*';
        continue;
      }
      if (nextChar === '\n' || nextChar === '\r') {
        if (inTable) {
          flushTableCell();
        } else {
          flushParagraph();
        }
        i++;
        continue;
      }

      // Hex character escape: \'hh
      if (nextChar === "'") {
        i++;
        const hex = rtfContent.slice(i, i + 2);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          const byteVal = parseInt(hex, 16);
          appendText(decodeCp1252Byte(byteVal));
          i += 2;
        }
        continue;
      }

      // Control word: letters followed by optional signed integer
      let wordStart = i;
      while (i < len && /[a-zA-Z]/.test(rtfContent[i])) {
        i++;
      }
      const word = rtfContent.slice(wordStart, i);

      let param: number | null = null;
      let paramStart = i;
      if (i < len && (rtfContent[i] === '-' || /[0-9]/.test(rtfContent[i]))) {
        i++;
        while (i < len && /[0-9]/.test(rtfContent[i])) {
          i++;
        }
        param = parseInt(rtfContent.slice(paramStart, i), 10);
      }

      // Optional delimiter space after control word
      if (i < len && rtfContent[i] === ' ') {
        i++;
      }

      // Handle control words
      switch (word) {
        // Character formatting
        case 'b':
          currentState.charFormat.bold = param !== 0;
          break;
        case 'i':
          currentState.charFormat.italic = param !== 0;
          break;
        case 'ul':
        case 'uld':
        case 'uldb':
        case 'ulw':
          currentState.charFormat.underline = param !== 0;
          break;
        case 'ulnone':
        case 'ul0':
          currentState.charFormat.underline = false;
          break;
        case 'strike':
        case 'striketh':
          currentState.charFormat.strike = param !== 0;
          break;
        case 'super':
          currentState.charFormat.superscript = true;
          currentState.charFormat.subscript = false;
          break;
        case 'sub':
          currentState.charFormat.subscript = true;
          currentState.charFormat.superscript = false;
          break;
        case 'nosupersub':
          currentState.charFormat.subscript = false;
          currentState.charFormat.superscript = false;
          break;
        case 'fs':
          if (param !== null) {
            currentState.charFormat.fontSize = param;
          }
          break;
        case 'plain':
          currentState.charFormat = { ...DEFAULT_CHAR_FORMAT };
          break;

        // Paragraph formatting
        case 'par':
          if (inTable) {
            flushTableCell();
          } else {
            flushParagraph();
          }
          break;
        case 'line':
          appendText('\n');
          break;
        case 'tab':
          appendText('\t');
          break;
        case 'bullet':
          appendText('• ');
          break;
        case 'emdash':
          appendText('—');
          break;
        case 'endash':
          appendText('–');
          break;
        case 'ldblquote':
          appendText('“');
          break;
        case 'rdblquote':
          appendText('”');
          break;
        case 'lquote':
          appendText('‘');
          break;
        case 'rquote':
          appendText('’');
          break;
        case 'ql':
          currentState.paraFormat.align = 'left';
          currentParaFormat.align = 'left';
          break;
        case 'qc':
          currentState.paraFormat.align = 'center';
          currentParaFormat.align = 'center';
          break;
        case 'qr':
          currentState.paraFormat.align = 'right';
          currentParaFormat.align = 'right';
          break;
        case 'qj':
          currentState.paraFormat.align = 'justify';
          currentParaFormat.align = 'justify';
          break;
        case 's':
          // Heading style (e.g. \s1 = h1, \s2 = h2)
          if (param !== null && param >= 1 && param <= 4) {
            currentState.paraFormat.headingLevel = param;
            currentParaFormat.headingLevel = param;
          }
          break;
        case 'pard':
          if (inTable) {
            flushTable();
          }
          currentState.paraFormat = { ...DEFAULT_PARA_FORMAT };
          currentParaFormat = { ...DEFAULT_PARA_FORMAT };
          break;

        // Section & Page breaks
        case 'page':
          if (inTable) {
            flushTable();
          } else {
            flushParagraph();
          }
          blocks.push({ type: 'pageBreak' });
          break;
        case 'sect':
          if (inTable) {
            flushTable();
          } else {
            flushParagraph();
          }
          blocks.push({ type: 'sectionBreak' });
          break;

        // Table controls
        case 'trowd':
          if (!inTable) {
            flushParagraph();
            inTable = true;
          } else {
            flushTableRow();
          }
          break;
        case 'cell':
          flushTableCell();
          break;
        case 'row':
          flushTableRow();
          break;

        // Unicode character: \uN
        case 'u':
          if (param !== null) {
            let codePoint = param;
            if (codePoint < 0) {
              codePoint += 65536;
            }
            appendText(String.fromCodePoint(codePoint));

            // Skip unicodeSkipCount replacement chars
            let skipped = 0;
            while (skipped < currentState.unicodeSkipCount && i < len) {
              if (rtfContent[i] === '\\') {
                if (rtfContent.slice(i, i + 2) === "\\'") {
                  i += 4; // \'hh
                  skipped++;
                } else {
                  break;
                }
              } else if (rtfContent[i] === '{' || rtfContent[i] === '}') {
                break;
              } else {
                i++;
                skipped++;
              }
            }
          }
          break;
        case 'uc':
          if (param !== null) {
            currentState.unicodeSkipCount = param;
          }
          break;

        // Destinations & Metadata
        case 'fonttbl':
        case 'colortbl':
        case 'stylesheet':
        case 'pict':
        case 'object':
        case 'generator':
          currentState.destination = word;
          break;

        case 'title':
        case 'author':
        case 'doccomm':
        case 'subject':
        case 'keywords':
          infoField = word;
          infoFieldBuffer = '';
          break;
      }
      continue;
    }

    // Normal text characters: collect run
    let textStart = i;
    while (i < len && rtfContent[i] !== '\\' && rtfContent[i] !== '{' && rtfContent[i] !== '}') {
      if (rtfContent[i] === '\r' || rtfContent[i] === '\n') {
        if (i > textStart) {
          appendText(rtfContent.slice(textStart, i));
        }
        i++;
        textStart = i;
      } else {
        i++;
      }
    }
    if (i > textStart) {
      appendText(rtfContent.slice(textStart, i));
    }
  }

  // Flush remaining buffers
  if (inTable) {
    flushTable();
  } else {
    flushParagraph();
  }

  return assembleChapters(blocks, metadata, autoDetectChapters);
}

/**
 * Converts formatted text spans into HTML.
 */
function spansToHtml(spans: TextSpan[]): string {
  let html = '';
  for (const span of spans) {
    let text = escapeHtml(span.text);
    // Replace tabs with spacing span
    text = text.replace(/\t/g, '<span class="rtf-tab">&emsp;</span>');
    // Replace linebreaks with <br/>
    text = text.replace(/\n/g, '<br/>');

    if (!text) continue;

    let wrapped = text;
    if (span.format.bold) wrapped = `<strong>${wrapped}</strong>`;
    if (span.format.italic) wrapped = `<em>${wrapped}</em>`;
    if (span.format.underline) wrapped = `<u>${wrapped}</u>`;
    if (span.format.strike) wrapped = `<s>${wrapped}</s>`;
    if (span.format.superscript) wrapped = `<sup>${wrapped}</sup>`;
    if (span.format.subscript) wrapped = `<sub>${wrapped}</sub>`;

    // Font size relative styling for notable sizes
    if (span.format.fontSize >= 40) {
      wrapped = `<span class="rtf-size-xl">${wrapped}</span>`;
    } else if (span.format.fontSize >= 30) {
      wrapped = `<span class="rtf-size-lg">${wrapped}</span>`;
    }

    html += wrapped;
  }
  return html;
}

/**
 * Extracts plain text from spans without HTML tags.
 */
function spansToPlainText(spans: TextSpan[]): string {
  return spans.map((s) => s.text).join('');
}

/**
 * Converts an RTF block into an HTML string.
 */
function blockToHtml(block: RtfBlock): string {
  switch (block.type) {
    case 'paragraph': {
      const inner = spansToHtml(block.spans).trim();
      if (!inner) return '';

      const alignClass = block.align !== 'left' ? ` class="rtf-align-${block.align}"` : '';

      if (block.headingLevel === 1) {
        return `<h1${alignClass}>${inner}</h1>`;
      }
      if (block.headingLevel === 2) {
        return `<h2${alignClass}>${inner}</h2>`;
      }
      if (block.headingLevel >= 3) {
        return `<h3${alignClass}>${inner}</h3>`;
      }
      return `<p${alignClass}>${inner}</p>`;
    }
    case 'table': {
      let tableHtml = '<table class="rtf-table"><tbody>';
      for (const row of block.rows) {
        tableHtml += '<tr>';
        for (const cell of row) {
          tableHtml += `<td>${spansToHtml(cell)}</td>`;
        }
        tableHtml += '</tr>';
      }
      tableHtml += '</tbody></table>';
      return tableHtml;
    }
    case 'pageBreak':
      return '<hr class="rtf-page-break" />';
    case 'sectionBreak':
      return '<hr class="rtf-section-break" />';
  }
}

/**
 * Regular expressions for identifying chapter breaks in paragraph text.
 */
const RTF_CHAPTER_PATTERNS = [
  /^(?:chapter)\s+(\d+|[IVXLCDM]+)(?:\s*[:\-–—]\s*(.+))?$/i,
  /^(?:part|section|book|act)\s+(\d+|[IVXLCDM]+)(?:\s*[:\-–—]\s*(.+))?$/i,
  /^(?:prologue|epilogue|introduction|preface|foreword|conclusion|afterword)$/i,
];

/**
 * Detects if a paragraph represents a chapter heading.
 */
function isChapterHeading(block: RtfBlock): string | null {
  if (block.type !== 'paragraph') return null;

  const plain = spansToPlainText(block.spans).trim();
  if (plain.length === 0 || plain.length > 120) return null;

  // Explicit heading level (\s1, \s2)
  if (block.headingLevel === 1 || block.headingLevel === 2) {
    return plain;
  }

  // Heading pattern matching (Chapter 1, Part 2, etc.)
  for (const pat of RTF_CHAPTER_PATTERNS) {
    if (pat.test(plain)) {
      return plain;
    }
  }

  // Standalone all-caps heading with prominent size or bold
  const isLargeOrBold = block.spans.some((s) => s.format.bold || s.format.fontSize >= 28);
  if (isLargeOrBold && plain.length >= 3 && plain.length <= 60) {
    if (/^[A-Z0-9\s\-–—:;,.!?'"“”]+$/.test(plain) && /[A-Z]/.test(plain)) {
      return plain;
    }
  }

  return null;
}

/**
 * Assembles parsed blocks into chapters and computes rawText.
 */
function assembleChapters(
  blocks: RtfBlock[],
  metadata: Partial<BookMetadata>,
  autoDetectChapters: boolean
): RtfParseResult {
  // Compute overall rawText
  const textPieces: string[] = [];
  for (const b of blocks) {
    if (b.type === 'paragraph') {
      const text = spansToPlainText(b.spans).trim();
      if (text) textPieces.push(text);
    } else if (b.type === 'table') {
      for (const row of b.rows) {
        for (const cell of row) {
          const text = spansToPlainText(cell).trim();
          if (text) textPieces.push(text);
        }
      }
    }
  }
  const rawText = textPieces.join('\n\n');

  // If no chapter auto-detection requested or few blocks, return single chapter
  if (!autoDetectChapters || blocks.length === 0) {
    const fullHtml = blocks.map(blockToHtml).filter(Boolean).join('\n');
    return {
      chapters: [
        {
          id: generateId(),
          title: metadata.title || 'Full Document',
          content: sanitizeReaderHtml(fullHtml),
          level: 0,
          order: 0,
        },
      ],
      metadata,
      rawText,
    };
  }

  // Detect chapter partitions
  interface Partition {
    title: string;
    blocks: RtfBlock[];
  }

  const partitions: Partition[] = [];
  let currentPartition: Partition = {
    title: metadata.title || 'Start',
    blocks: [],
  };

  for (let bIndex = 0; bIndex < blocks.length; bIndex++) {
    const block = blocks[bIndex];

    // Check if this block is a page/section break or heading
    const headingTitle = isChapterHeading(block);
    const isBreak = block.type === 'pageBreak' || block.type === 'sectionBreak';

    if (headingTitle) {
      if (currentPartition.blocks.length > 0) {
        partitions.push(currentPartition);
        currentPartition = {
          title: headingTitle,
          blocks: [block],
        };
      } else {
        currentPartition.title = headingTitle;
        currentPartition.blocks.push(block);
      }
    } else if (isBreak && currentPartition.blocks.length > 2) {
      // Split on page break if current partition already has meaningful content
      partitions.push(currentPartition);
      currentPartition = {
        title: `Section ${partitions.length + 1}`,
        blocks: [],
      };
    } else {
      currentPartition.blocks.push(block);
    }
  }

  if (currentPartition.blocks.length > 0) {
    partitions.push(currentPartition);
  }

  // If only one partition or empty partitions, return single chapter
  const nonEmptyPartitions = partitions.filter((p) => p.blocks.length > 0);
  if (nonEmptyPartitions.length <= 1) {
    const fullHtml = blocks.map(blockToHtml).filter(Boolean).join('\n');
    return {
      chapters: [
        {
          id: generateId(),
          title: metadata.title || 'Full Document',
          content: sanitizeReaderHtml(fullHtml),
          level: 0,
          order: 0,
        },
      ],
      metadata,
      rawText,
    };
  }

  // Build chapter list
  const chapters: Chapter[] = nonEmptyPartitions.map((p, idx) => ({
    id: generateId(),
    title: p.title || `Chapter ${idx + 1}`,
    content: sanitizeReaderHtml(p.blocks.map(blockToHtml).filter(Boolean).join('\n')),
    level: 0,
    order: idx,
  }));

  return {
    chapters,
    metadata,
    rawText,
  };
}
