/**
 * ZIP Archive container format definition (.zip).
 *
 * Treats ZIP as a general-purpose archive container capable of holding
 * nested e-books, documents, and images. Decompresses files on-demand
 * for reading in existing engines.
 */

import type { FormatDefinition, FormatParsedData, FormatImportContext } from '../types';
import { readFileAsArrayBuffer } from '../../utils';
import { parseZip } from '../../core/parsing/zip-parser';

export const zipFormat: FormatDefinition = {
  id: 'zip',
  label: 'ZIP Archive',
  extensions: ['zip'],
  mimeTypes: [
    'application/zip',
    'application/x-zip-compressed',
    'multipart/x-zip',
  ],
  category: 'fixed-layout',
  requiresOriginalFile: true,
  capabilities: {
    continuousScroll: true,
    paginated: true,
    doubleSided: true,
    zoom: true,
    search: true,
    readingDirection: true,
    fitMode: true,
  },
  async parse(file: File, _context: FormatImportContext): Promise<FormatParsedData> {
    const buffer = await readFileAsArrayBuffer(file);
    const parsed = await parseZip(buffer, { filename: file.name });

    return {
      metadata: parsed.metadata,
      tableOfContents: parsed.tableOfContents,
      coverImage: parsed.coverImage,
      originalFile: buffer,
    };
  },
};
