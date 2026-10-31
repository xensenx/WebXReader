/**
 * DjVu format definition (.djvu, .djv).
 */

import type { FormatDefinition, FormatParsedData } from '../types';
import { readFileAsArrayBuffer } from '../../utils';
import { parseDjvu } from '../../core/parsing/djvu-parser';

export const djvuFormat: FormatDefinition = {
  id: 'djvu',
  label: 'DjVu Document',
  extensions: ['djvu', 'djv'],
  mimeTypes: ['image/vnd.djvu', 'image/x-djvu'],
  category: 'fixed-layout',
  requiresOriginalFile: true,
  capabilities: {
    continuousScroll: true,
    paginated: true,
    doubleSided: false,
    zoom: true,
    search: true,
    customTypography: false,
  },
  async parse(file: File): Promise<FormatParsedData> {
    const arrayBuffer = await readFileAsArrayBuffer(file);
    const { metadata, tableOfContents, coverImage, rawText } = await parseDjvu(arrayBuffer);

    return {
      metadata,
      tableOfContents,
      originalFile: arrayBuffer,
      coverImage,
      rawText,
    };
  },
};
