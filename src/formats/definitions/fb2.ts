/**
 * FictionBook 2 format definition (.fb2).
 */

import type { FormatDefinition, FormatParsedData, FormatImportContext } from '../types';
import { readFileAsArrayBuffer } from '../../utils';
import { parseFb2 } from '../../core/parsing/fb2-parser';
import type { Chapter } from '../../types/book';

export const fb2Format: FormatDefinition = {
  id: 'fb2',
  label: 'FictionBook (FB2)',
  extensions: ['fb2'],
  mimeTypes: [
    'application/x-fictionbook+xml',
    'application/x-fictionbook',
    'text/xml',
  ],
  category: 'reflowable',
  capabilities: {
    continuousScroll: true,
    paginated: true,
    doubleSided: true,
    zoom: false,
    search: true,
    customTypography: true,
  },
  async parse(file: File, context: FormatImportContext): Promise<FormatParsedData> {
    const buffer = await readFileAsArrayBuffer(file);
    const { chapters, metadata, rawText, coverImage } = await parseFb2(buffer, {
      autoDetectChapters: context.autoDetectChapters ?? true,
      defaultEncoding: context.textEncoding,
    });

    const tableOfContents: Chapter[] = chapters.map((ch) => ({
      id: ch.id,
      title: ch.title,
      level: ch.level,
      order: ch.order,
    }));

    return {
      metadata,
      tableOfContents,
      chapters,
      rawText,
      coverImage,
    };
  },
};
