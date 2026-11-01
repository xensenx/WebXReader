/**
 * Plain text format definition (.txt).
 */

import type { FormatDefinition, FormatParsedData, FormatImportContext } from '../types';
import { readFileAsText } from '../../utils';
import { parseTxt } from '../../core/parsing/txt-parser';
import type { Chapter } from '../../types/book';
import { DEFAULT_TXT_COVER } from '../../assets/covers/txt-default-cover';

export const txtFormat: FormatDefinition = {
  id: 'txt',
  label: 'Plain Text',
  extensions: ['txt'],
  mimeTypes: ['text/plain'],
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
    const { chapters } = parseTxt(text, {
      autoDetect: context.autoDetectChapters ?? true,
    });

    const tableOfContents: Chapter[] = chapters.map((ch) => ({
      id: ch.id,
      title: ch.title,
      level: ch.level,
      order: ch.order,
    }));

    return {
      metadata: {},
      tableOfContents,
      chapters,
      rawText: text,
      coverImage: DEFAULT_TXT_COVER,
    };
  },
};
