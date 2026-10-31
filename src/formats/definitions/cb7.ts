/**
 * CB7 Comic Book 7z format definition (.cb7, .7z).
 */

import type { FormatDefinition, FormatParsedData } from '../types';
import { readFileAsArrayBuffer } from '../../utils';
import { parseCb7 } from '../../core/parsing/cb7-parser';

export const cb7Format: FormatDefinition = {
  id: 'cb7',
  label: 'Comic Book 7z (CB7)',
  extensions: ['cb7', '7z'],
  mimeTypes: [
    'application/x-cb7',
    'application/x-cb7-compressed',
    'application/x-7z-compressed',
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
    const { metadata, tableOfContents, coverImage, readingDirection } = await parseCb7(arrayBuffer);

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
