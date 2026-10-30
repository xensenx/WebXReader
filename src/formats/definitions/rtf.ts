/**
 * Rich Text Format definition (.rtf).
 */

import type { FormatDefinition, FormatParsedData, FormatImportContext } from '../types';
import { readFileAsText } from '../../utils';
import { parseRtf } from '../../core/parsing/rtf-parser';
import type { Chapter } from '../../types/book';

export const rtfFormat: FormatDefinition = {
  id: 'rtf',
  label: 'Rich Text Format',
  extensions: ['rtf'],
  mimeTypes: ['application/rtf', 'text/rtf'],
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
    const text = await readFileAsText(file, context.textEncoding);
    const { chapters, metadata, rawText } = parseRtf(text, {
      autoDetectChapters: context.autoDetectChapters ?? true,
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
    };
  },
};
