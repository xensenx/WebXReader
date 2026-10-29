/**
 * PDF format definition (.pdf).
 */

import type { FormatDefinition, FormatParsedData } from '../types';
import { readFileAsArrayBuffer } from '../../utils';
import { parsePdf } from '../../core/parsing/pdf-parser';

export const pdfFormat: FormatDefinition = {
  id: 'pdf',
  label: 'PDF Document',
  extensions: ['pdf'],
  mimeTypes: ['application/pdf'],
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
    const { metadata, tableOfContents, coverImage } = await parsePdf(arrayBuffer);

    return {
      metadata,
      tableOfContents,
      originalFile: arrayBuffer,
      coverImage,
    };
  },
};
