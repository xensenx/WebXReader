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
  detectFormatFromMimeType,
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
export { mobiFormat } from './definitions/mobi';
export { azw3Format } from './definitions/azw3';
export { docxFormat } from './definitions/docx';
export { docFormat } from './definitions/doc';
export { epubFormat } from './definitions/epub';
export { pdfFormat } from './definitions/pdf';
export { cbzFormat } from './definitions/cbz';
export { cbrFormat } from './definitions/cbr';
export { cb7Format } from './definitions/cb7';
export { djvuFormat } from './definitions/djvu';
export { mhtFormat } from './definitions/mht';
export { zipFormat } from './definitions/zip';
export { rarFormat } from './definitions/rar';
export { pngFormat } from './definitions/png';
export { jpegFormat } from './definitions/jpeg';

export type { ImageReaderProps, ImageReaderHandle, ImageZoomAnchor } from './engines/ImageReader';
export type { ZipReaderProps, ArchiveReaderProps } from './engines/ZipReader';

// Dedicated reader engine types (engines themselves are lazy loaded on demand)
export type { CbzReaderHandle, CbzZoomAnchor } from './engines/CbzReader';
export type { CbzReaderHandle as ComicReaderHandle, CbzZoomAnchor as ComicZoomAnchor } from './engines/CbzReader';
export type { PdfReaderHandle, PdfZoomAnchor } from './engines/PdfReader';
export type { EpubReaderHandle } from './engines/EpubReader';
export type { DjvuReaderHandle, DjvuZoomAnchor } from './engines/DjvuReader';
