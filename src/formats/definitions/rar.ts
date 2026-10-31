/**
 * RAR Archive container format definition (.rar).
 *
 * Treats RAR as a general-purpose archive container capable of holding
 * nested e-books, documents, and images. Decompresses entries on-demand
 * using browser-compatible 7-Zip WebAssembly for reading in existing engines.
 */

import type { FormatDefinition, FormatParsedData, FormatImportContext } from '../types';
import { readFileAsArrayBuffer } from '../../utils';
import { parseRar } from '../../core/parsing/rar-parser';

export const rarFormat: FormatDefinition = {
  id: 'rar',
  label: 'RAR Archive',
  extensions: ['rar'],
  mimeTypes: [
    'application/vnd.rar',
    'application/x-rar-compressed',
    'application/x-rar',
    'application/rar',
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
    const parsed = await parseRar(buffer, { filename: file.name });

    return {
      metadata: parsed.metadata,
      tableOfContents: parsed.tableOfContents,
      coverImage: parsed.coverImage,
      originalFile: buffer,
    };
  },
};
