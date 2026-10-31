/**
 * Standalone JPEG Image format definition (.jpg, .jpeg).
 *
 * Provides a dedicated image reading surface with zoom, pan, fit modes,
 * EXIF orientation rendering, and image collection navigation.
 */

import type { FormatDefinition, FormatParsedData, FormatImportContext } from '../types';
import { readFileAsArrayBuffer } from '../../utils';
import { parseImage } from '../../core/parsing/image-parser';

export const jpegFormat: FormatDefinition = {
  id: 'jpeg',
  label: 'JPEG Image',
  extensions: ['jpg', 'jpeg'],
  mimeTypes: [
    'image/jpeg',
    'image/jpg',
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
    const parsed = await parseImage(buffer, { filename: file.name, expectedFormat: 'jpeg' });

    return {
      metadata: parsed.metadata,
      tableOfContents: parsed.tableOfContents,
      coverImage: parsed.coverImage,
      originalFile: parsed.originalFile,
    };
  },
};
