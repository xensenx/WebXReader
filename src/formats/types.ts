/**
 * Unified type definitions for WebXReader book formats.
 *
 * Each format supported by the application defines its capabilities,
 * file extensions, MIME types, parser behavior, and presentation model.
 */

import type { BookFormat, Chapter } from '../types/book';

/** High-level layout model for reader engine selection */
export type FormatCategory = 'reflowable' | 'fixed-layout';

/** Fine-grained feature support flags for reader UI controls */
export interface FormatCapabilities {
  /** Supports continuous vertical scrolling */
  continuousScroll: boolean;
  /** Supports single-page paginated mode */
  paginated: boolean;
  /** Supports double-sided book spreads */
  doubleSided: boolean;
  /** Supports interactive zoom (compositor preview & anchor pivot) */
  zoom: boolean;
  /** Supports in-book full text search */
  search: boolean;
  /** Supports reading direction toggling (LTR vs RTL Manga) */
  readingDirection?: boolean;
  /** Supports page fit modes (contain, fit width, fit height) */
  fitMode?: boolean;
  /** Supports page gap / spacing adjustment */
  pageGap?: boolean;
  /** Supports custom fonts, line height, text size, and paragraph margins */
  customTypography?: boolean;
}

/** Configuration and options passed to format parsers during import */
export interface FormatImportContext {
  autoDetectChapters?: boolean;
  textEncoding?: string;
}

/** Standardized output returned by a format parser */
export interface FormatParsedData {
  metadata: {
    title?: string;
    author?: string;
    description?: string;
    publisher?: string;
    publishDate?: string;
    publicationDate?: string;
    language?: string;
    series?: string;
    volume?: number;
    issueNumber?: string;
    identifiers?: Record<string, string>;
  };
  tableOfContents: Chapter[];
  chapters?: Chapter[];
  rawText?: string;
  originalFile?: ArrayBuffer;
  coverImage?: string;
}

/** Complete descriptor and parser contract for a supported format */
export interface FormatDefinition {
  /** Unique format identifier matching BookFormat */
  id: BookFormat;
  /** Human-readable display name */
  label: string;
  /** Supported file extensions (without leading dot, lowercase) */
  extensions: string[];
  /** Standard MIME types */
  mimeTypes: string[];
  /** Layout category (reflowable or fixed-layout) */
  category: FormatCategory;
  /** Whether the original binary file (ArrayBuffer) must be preserved in IndexedDB */
  requiresOriginalFile?: boolean;
  /** Feature capability matrix */
  capabilities: FormatCapabilities;
  /** Parses a File and returns normalized metadata and content structures */
  parse: (file: File, context: FormatImportContext) => Promise<FormatParsedData>;
}
