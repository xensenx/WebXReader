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
import { epubFormat } from './definitions/epub';
import { pdfFormat } from './definitions/pdf';
import { cbzFormat } from './definitions/cbz';
import { getFileExtension } from '../utils';

/** Master registry mapping format ID to definition */
const FORMAT_REGISTRY = new Map<BookFormat, FormatDefinition>([
  ['txt', txtFormat],
  ['markdown', markdownFormat],
  ['html', htmlFormat],
  ['rtf', rtfFormat],
  ['epub', epubFormat],
  ['pdf', pdfFormat],
  ['cbz', cbzFormat],
]);

/** Extension-to-format lookup cache */
const EXTENSION_TO_FORMAT_MAP = new Map<string, FormatDefinition>();
FORMAT_REGISTRY.forEach((def) => {
  def.extensions.forEach((ext) => {
    EXTENSION_TO_FORMAT_MAP.set(ext.toLowerCase(), def);
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
  const ext = getFileExtension(filename).toLowerCase();
  return EXTENSION_TO_FORMAT_MAP.get(ext) ?? null;
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
 * Generates an accept string for HTML file inputs (e.g. ".txt,.epub,.pdf,.cbz,...").
 */
export function getAcceptAttribute(): string {
  return getAllSupportedExtensions()
    .map((ext) => `.${ext}`)
    .join(',');
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
