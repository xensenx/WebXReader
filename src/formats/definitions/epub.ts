/**
 * EPUB format definition (.epub).
 */

import type { FormatDefinition, FormatParsedData } from '../types';
import { readFileAsArrayBuffer } from '../../utils';
import { parseEpub } from '../../core/parsing/epub-parser';

export const epubFormat: FormatDefinition = {
  id: 'epub',
  label: 'EPUB Book',
  extensions: ['epub'],
  mimeTypes: ['application/epub+zip'],
  category: 'reflowable',
  requiresOriginalFile: true,
  capabilities: {
    continuousScroll: true,
    paginated: true,
    doubleSided: false,
    zoom: true,
    search: true,
    customTypography: true,
  },
  async parse(file: File): Promise<FormatParsedData> {
    const arrayBuffer = await readFileAsArrayBuffer(file);
    const { metadata, tableOfContents, coverImage } = await parseEpub(arrayBuffer);

    return {
      metadata,
      tableOfContents,
      originalFile: arrayBuffer,
      coverImage,
    };
  },
};
