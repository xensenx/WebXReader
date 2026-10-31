/**
 * CBR Comic Book RAR format definition (.cbr).
 */

import type { FormatDefinition, FormatParsedData } from '../types';
import { readFileAsArrayBuffer } from '../../utils';
import { parseCbr } from '../../core/parsing/cbr-parser';

export const cbrFormat: FormatDefinition = {
  id: 'cbr',
  label: 'Comic Book RAR (CBR)',
  extensions: ['cbr'],
  mimeTypes: [
    'application/vnd.comicbook-rar',
    'application/x-cbr',
    'application/x-rar',
    'application/x-rar-compressed',
  ],
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
    const { metadata, tableOfContents, coverImage, readingDirection } = await parseCbr(arrayBuffer);

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
