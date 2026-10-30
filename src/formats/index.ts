/**
 * Formats subsystem entry point for WebXReader.
 *
 * Provides a clean separation of concerns between format-specific code
 * (parsers, definitions, capabilities, and engines) and universal reader/library code.
 */

// Format registry and lookup utilities
export {
  getFormat,
  getRequiredFormat,
  detectFormatFromFilename,
  getAllFormats,
  getAllSupportedExtensions,
  getAcceptAttribute,
  getFormatMimeType,
  isFixedLayout,
  formatSupportsFeature,
} from './registry';

// Format types
export type {
  FormatCategory,
  FormatCapabilities,
  FormatImportContext,
  FormatParsedData,
  FormatDefinition,
} from './types';

// Format definitions
export { txtFormat } from './definitions/txt';
export { markdownFormat } from './definitions/markdown';
export { htmlFormat } from './definitions/html';
export { rtfFormat } from './definitions/rtf';
export { fb2Format } from './definitions/fb2';
export { epubFormat } from './definitions/epub';
export { pdfFormat } from './definitions/pdf';
export { cbzFormat } from './definitions/cbz';

// Dedicated reader engine types (engines themselves are lazy loaded on demand)
export type { CbzReaderHandle, CbzZoomAnchor } from './engines/CbzReader';
export type { PdfReaderHandle, PdfZoomAnchor } from './engines/PdfReader';
export type { EpubReaderHandle } from './engines/EpubReader';
