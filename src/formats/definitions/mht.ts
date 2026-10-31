/**
 * MHTML Web Archive format definition (.mht, .mhtml).
 */

import type { FormatDefinition, FormatParsedData, FormatImportContext } from '../types';
import { readFileAsArrayBuffer } from '../../utils';
import { parseMht } from '../../core/parsing/mht-parser';
import type { Chapter } from '../../types/book';

export const mhtFormat: FormatDefinition = {
  id: 'mht',
  label: 'MHTML Web Archive',
  extensions: ['mht', 'mhtml'],
  mimeTypes: [
    'message/rfc822',
    'multipart/related',
    'application/x-mimearchive',
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
    const { chapters, metadata, coverImage, rawText } = await parseMht(buffer, {
      autoDetectChapters: context.autoDetectChapters,
      defaultCharset: context.textEncoding,
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
      coverImage,
      rawText,

    };
  },
};
