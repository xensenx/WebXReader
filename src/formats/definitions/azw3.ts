/**
 * Amazon Kindle Format 8 (.azw3, .kf8) definition.
 */

import type { FormatDefinition, FormatParsedData, FormatImportContext } from '../types';
import { readFileAsArrayBuffer } from '../../utils';
import { parseAzw3 } from '../../core/parsing/azw3-parser';
import type { Chapter } from '../../types/book';

export const azw3Format: FormatDefinition = {
  id: 'azw3',
  label: 'Kindle Format 8 (AZW3)',
  extensions: ['azw3', 'kf8'],
  mimeTypes: [
    'application/vnd.amazon.mobi8-ebook',
    'application/x-mobi8-ebook',
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
    const { chapters, metadata, rawText, coverImage } = await parseAzw3(buffer, {
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
