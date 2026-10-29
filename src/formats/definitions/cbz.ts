/**
 * CBZ Comic Book Zip format definition (.cbz).
 */

import type { FormatDefinition, FormatParsedData } from '../types';
import { readFileAsArrayBuffer } from '../../utils';
import { parseCbz } from '../../core/parsing/cbz-parser';

export const cbzFormat: FormatDefinition = {
  id: 'cbz',
  label: 'Comic Book Zip (CBZ)',
  extensions: ['cbz'],
  mimeTypes: ['application/vnd.comicbook+zip', 'application/x-cbz'],
  category: 'fixed-layout',
  requiresOriginalFile: true,
  capabilities: {
    continuousScroll: true,
    paginated: true,
    doubleSided: true,
    zoom: true,
    search: false,
    readingDirection: true,
    fitMode: true,
    pageGap: true,
    customTypography: false,
  },
  async parse(file: File): Promise<FormatParsedData> {
    const arrayBuffer = await readFileAsArrayBuffer(file);
    const { metadata, tableOfContents, coverImage, readingDirection } = await parseCbz(arrayBuffer);

    const identifiers = { ...(metadata.identifiers || {}) };
    if (readingDirection) {
      identifiers.readingDirection = readingDirection;
    }

    return {
      metadata: {
        ...metadata,
        identifiers,
      },
      tableOfContents,
      originalFile: arrayBuffer,
      coverImage,
    };
  },
};
