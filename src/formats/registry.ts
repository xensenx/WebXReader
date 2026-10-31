/**
 * Central registry for all book formats supported by WebXReader.
 *
 * Provides format resolution, capability queries, MIME mapping,
 * and file acceptance lists for import dropzones and file dialogs.
 */

import type { BookFormat } from '../types/book';
import type { FormatCapabilities, FormatDefinition } from './types';
import { txtFormat } from './definitions/txt';
import { markdownFormat } from './definitions/markdown';
import { htmlFormat } from './definitions/html';
import { rtfFormat } from './definitions/rtf';
import { fb2Format } from './definitions/fb2';
import { mobiFormat } from './definitions/mobi';
import { azw3Format } from './definitions/azw3';
import { docxFormat } from './definitions/docx';
import { docFormat } from './definitions/doc';
import { epubFormat } from './definitions/epub';
import { pdfFormat } from './definitions/pdf';
import { cbzFormat } from './definitions/cbz';
import { cbrFormat } from './definitions/cbr';
import { cb7Format } from './definitions/cb7';
import { djvuFormat } from './definitions/djvu';
import { mhtFormat } from './definitions/mht';
import { zipFormat } from './definitions/zip';
import { rarFormat } from './definitions/rar';
import { pngFormat } from './definitions/png';
import { jpegFormat } from './definitions/jpeg';
import { getFileExtension } from '../utils';

/** Master registry mapping format ID to definition */
const FORMAT_REGISTRY = new Map<BookFormat, FormatDefinition>([
  ['txt', txtFormat],
  ['markdown', markdownFormat],
  ['html', htmlFormat],
  ['rtf', rtfFormat],
  ['fb2', fb2Format],
  ['mobi', mobiFormat],
  ['azw3', azw3Format],
  ['docx', docxFormat],
  ['doc', docFormat],
  ['epub', epubFormat],
  ['pdf', pdfFormat],
  ['cbz', cbzFormat],
  ['cbr', cbrFormat],
  ['cb7', cb7Format],
  ['djvu', djvuFormat],
  ['mht', mhtFormat],
  ['zip', zipFormat],
  ['rar', rarFormat],
  ['png', pngFormat],
  ['jpeg', jpegFormat],
]);

/** Extension-to-format lookup cache */
const EXTENSION_TO_FORMAT_MAP = new Map<string, FormatDefinition>();
/** MIME-to-format lookup cache */
const MIME_TO_FORMAT_MAP = new Map<string, FormatDefinition>();

FORMAT_REGISTRY.forEach((def) => {
  def.extensions.forEach((ext) => {
    EXTENSION_TO_FORMAT_MAP.set(ext.toLowerCase(), def);
  });
  def.mimeTypes.forEach((mime) => {
    MIME_TO_FORMAT_MAP.set(mime.toLowerCase(), def);
  });
});

/**
 * Retrieve a format definition by ID.
 */
export function getFormat(id: BookFormat | string | undefined): FormatDefinition | undefined {
  if (!id) return undefined;
  return FORMAT_REGISTRY.get(id as BookFormat);
}

/**
 * Retrieve a required format definition or throw.
 */
export function getRequiredFormat(id: BookFormat): FormatDefinition {
  const def = FORMAT_REGISTRY.get(id);
  if (!def) {
    throw new Error(`Unsupported book format: ${id}`);
  }
  return def;
}

/**
 * Detects format definition from a filename or file extension.
 */
export function detectFormatFromFilename(filename: string): FormatDefinition | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.fb2.zip')) {
    return fb2Format;
  }
  const ext = getFileExtension(filename).toLowerCase();
  return EXTENSION_TO_FORMAT_MAP.get(ext) ?? null;
}

/**
 * Detects format definition from a MIME type string.
 */
export function detectFormatFromMimeType(mimeType?: string | null): FormatDefinition | null {
  if (!mimeType) return null;
  const normalized = mimeType.toLowerCase().trim();
  return MIME_TO_FORMAT_MAP.get(normalized) ?? null;
}

/**
 * Returns all registered format definitions.
 */
export function getAllFormats(): FormatDefinition[] {
  return Array.from(FORMAT_REGISTRY.values());
}

/**
 * Returns all supported file extensions without leading dots.
 */
export function getAllSupportedExtensions(): string[] {
  return Array.from(EXTENSION_TO_FORMAT_MAP.keys());
}

/**
 * Generates an accept string for HTML file inputs (e.g. ".txt,.epub,...,image/*,image/png,...").
 * Providing both extensions and MIME types ensures Windows and mobile browser file dialogs allow images.
 */
export function getAcceptAttribute(): string {
  const extensions = getAllSupportedExtensions().map((ext) => `.${ext}`);
  const mimeTypes = Array.from(MIME_TO_FORMAT_MAP.keys());
  return Array.from(new Set([...extensions, ...mimeTypes, 'image/*'])).join(',');
}

/**
 * Resolves standard MIME type for exporting or downloading a book format.
 */
export function getFormatMimeType(format: BookFormat | string): string {
  const def = FORMAT_REGISTRY.get(format as BookFormat);
  return def?.mimeTypes[0] || 'application/octet-stream';
}

/**
 * Checks if a format belongs to the fixed-layout category (PDF, CBZ comics).
 */
export function isFixedLayout(format?: BookFormat | string): boolean {
  if (!format) return false;
  const def = FORMAT_REGISTRY.get(format as BookFormat);
  return def?.category === 'fixed-layout';
}

/**
 * Checks if a format supports a specific UI capability.
 */
export function formatSupportsFeature(
  format: BookFormat | string | undefined,
  feature: keyof FormatCapabilities
): boolean {
  if (!format) return false;
  const def = FORMAT_REGISTRY.get(format as BookFormat);
  return Boolean(def?.capabilities[feature]);
}
