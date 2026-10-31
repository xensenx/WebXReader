/**
 * Standalone PNG Image format definition (.png).
 *
 * Provides a dedicated image reading surface with zoom, pan, fit modes,
 * alpha transparency support, and image collection navigation.
 */

import type { FormatDefinition, FormatParsedData, FormatImportContext } from '../types';
import { readFileAsArrayBuffer } from '../../utils';
import { parseImage } from '../../core/parsing/image-parser';

export const pngFormat: FormatDefinition = {
  id: 'png',
  label: 'PNG Image',
  extensions: ['png'],
  mimeTypes: [
    'image/png',
    'image/x-png',
  ],
  category: 'fixed-layout',
  requiresOriginalFile: true,
  capabilities: {
    continuousScroll: true,
    paginated: true,
    doubleSided: false,
    zoom: true,
    search: false,
    readingDirection: false,
    fitMode: true,
    pageGap: false,
    customTypography: false,
  },
  async parse(file: File, _context: FormatImportContext): Promise<FormatParsedData> {
    const buffer = await readFileAsArrayBuffer(file);
    const parsed = await parseImage(buffer, { filename: file.name, expectedFormat: 'png' });

    return {
      metadata: parsed.metadata,
      tableOfContents: parsed.tableOfContents,
      coverImage: parsed.coverImage,
      originalFile: parsed.originalFile,
    };
  },
};
