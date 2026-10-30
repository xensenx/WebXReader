/**
 * Mobipocket / Kindle format definition (.mobi, .prc, .azw).
 */

import type { FormatDefinition, FormatParsedData, FormatImportContext } from '../types';
import { readFileAsArrayBuffer } from '../../utils';
import { parseMobi } from '../../core/parsing/mobi-parser';
import type { Chapter } from '../../types/book';

export const mobiFormat: FormatDefinition = {
  id: 'mobi',
  label: 'Mobipocket / Kindle (MOBI)',
  extensions: ['mobi', 'prc', 'azw'],
  mimeTypes: [
    'application/x-mobipocket-ebook',
    'application/vnd.amazon.mobi8-ebook',
    'application/x-palm-database',
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
    const { chapters, metadata, rawText, coverImage } = await parseMobi(buffer, {
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
