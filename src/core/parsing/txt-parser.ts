/**
 * TXT file parser for WebXReader.
 * Parses plain text files into chapters with configurable chapter detection.
 */

import type { Chapter } from '../../types/book';
import { generateId, escapeHtml } from '../../utils';

/** Result of parsing a TXT file */
export interface TxtParseResult {
  chapters: Chapter[];
  rawText: string;
}

/** Options for TXT parsing */
export interface TxtParseOptions {
  /** Whether to auto-detect chapter headings. Defaults to true. */
  autoDetect?: boolean;
}

/**
 * Regex patterns for chapter heading detection.
 * Each pattern is tested against a trimmed line.
 */
const CHAPTER_PATTERNS: RegExp[] = [
  // "Chapter X", "CHAPTER X", with optional title after colon or dash
  /^(?:chapter)\s+(\d+|[IVXLCDM]+)(?:\s*[:\-–—]\s*(.+))?$/i,
  // "Part X", "PART X", with optional title
  /^(?:part)\s+(\d+|[IVXLCDM]+)(?:\s*[:\-–—]\s*(.+))?$/i,
  // Roman numeral on its own line: "I.", "II.", "III.", etc.
  /^([IVXLCDM]+)\.$/,
  // Numbered on its own line: "1.", "2.", etc.
  /^(\d+)\.$/,
];

/**
 * Checks if a line is an ALL CAPS standalone heading.
 * Must be at least 3 characters, all uppercase letters (and spaces/punctuation),
 * and surrounded by blank lines.
 */
function isAllCapsHeading(
  line: string,
  prevLine: string | undefined,
  nextLine: string | undefined
): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3) return false;

  // Must be surrounded by blank lines (or be at start/end of text)
  const prevIsBlank = prevLine === undefined || prevLine.trim() === '';
  const nextIsBlank = nextLine === undefined || nextLine.trim() === '';
  if (!prevIsBlank || !nextIsBlank) return false;

  // Must contain at least one letter
  if (!/[A-Z]/.test(trimmed)) return false;

  // All letters must be uppercase; allow spaces, punctuation, digits
  return /^[A-Z0-9\s\-–—:;,.!?'"""'']+$/.test(trimmed);
}

/**
 * Tests whether a line matches any chapter heading pattern.
 * Returns the detected title or null if no match.
 */
function detectChapterTitle(
  line: string,
  prevLine: string | undefined,
  nextLine: string | undefined
): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  for (const pattern of CHAPTER_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      // If there's a title component (e.g., "Chapter 1: The Beginning")
      if (match[2]) {
        return `${trimmed}`;
      }
      return trimmed;
    }
  }

  // Check for ALL CAPS standalone heading
  if (isAllCapsHeading(trimmed, prevLine, nextLine)) {
    return trimmed;
  }

  return null;
}

/**
 * Normalizes line endings and strips UTF-8 BOM.
 */
function normalizeText(text: string): string {
  // Strip UTF-8 BOM (U+FEFF)
  let normalized = text.startsWith('\uFEFF') ? text.slice(1) : text;
  // Normalize line endings: \r\n and \r → \n
  normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized;
}

/**
 * Converts a block of plain text into HTML paragraphs.
 * Blank lines separate paragraphs. Each paragraph is wrapped in <p> tags.
 */
function textToHtml(text: string): string {
  const lines = text.split('\n');
  const paragraphs: string[] = [];
  let currentParagraph: string[] = [];

  for (const line of lines) {
    if (line.trim() === '') {
      if (currentParagraph.length > 0) {
        paragraphs.push(`<p>${escapeHtml(currentParagraph.join(' '))}</p>`);
        currentParagraph = [];
      }
    } else {
      currentParagraph.push(line.trim());
    }
  }

  // Flush remaining paragraph
  if (currentParagraph.length > 0) {
    paragraphs.push(`<p>${escapeHtml(currentParagraph.join(' '))}</p>`);
  }

  return paragraphs.join('\n');
}

/**
 * Parses a plain text string into chapters.
 *
 * @param text - Raw text content of the file
 * @param options - Parsing options
 * @returns Parsed chapters and raw text
 */
export function parseTxt(text: string, options: TxtParseOptions = {}): TxtParseResult {
  const { autoDetect = true } = options;
  const rawText = normalizeText(text);

  if (!autoDetect) {
    return {
      chapters: [
        {
          id: generateId(),
          title: 'Full Text',
          content: textToHtml(rawText),
          level: 0,
          order: 0,
        },
      ],
      rawText,
    };
  }

  const lines = rawText.split('\n');

  // First pass: identify chapter break positions
  interface ChapterBreak {
    lineIndex: number;
    title: string;
  }

  const breaks: ChapterBreak[] = [];

  for (let i = 0; i < lines.length; i++) {
    const prevLine = i > 0 ? lines[i - 1] : undefined;
    const nextLine = i < lines.length - 1 ? lines[i + 1] : undefined;
    const title = detectChapterTitle(lines[i], prevLine, nextLine);

    if (title !== null) {
      breaks.push({ lineIndex: i, title });
    }
  }

  // If no chapters detected, return entire text as single chapter
  if (breaks.length === 0) {
    return {
      chapters: [
        {
          id: generateId(),
          title: 'Full Text',
          content: textToHtml(rawText),
          level: 0,
          order: 0,
        },
      ],
      rawText,
    };
  }

  const chapters: Chapter[] = [];

  // If there's content before the first chapter heading, create a preamble chapter
  if (breaks[0].lineIndex > 0) {
    const preambleLines = lines.slice(0, breaks[0].lineIndex);
    const preambleText = preambleLines.join('\n').trim();
    if (preambleText.length > 0) {
      chapters.push({
        id: generateId(),
        title: 'Preamble',
        content: textToHtml(preambleText),
        level: 0,
        order: 0,
      });
    }
  }

  // Create chapters from breaks
  for (let i = 0; i < breaks.length; i++) {
    const startLine = breaks[i].lineIndex + 1; // Start after the heading line
    const endLine = i < breaks.length - 1 ? breaks[i + 1].lineIndex : lines.length;
    const chapterLines = lines.slice(startLine, endLine);
    const chapterText = chapterLines.join('\n').trim();

    chapters.push({
      id: generateId(),
      title: breaks[i].title,
      content: textToHtml(chapterText),
      level: 0,
      order: chapters.length,
    });
  }

  return { chapters, rawText };
}
