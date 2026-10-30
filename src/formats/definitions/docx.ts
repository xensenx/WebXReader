/**
 * Microsoft Word Open XML (.docx) format definition.
 */

import type { FormatDefinition, FormatParsedData, FormatImportContext } from '../types';
import { readFileAsArrayBuffer } from '../../utils';
import { parseDocx } from '../../core/parsing/docx-parser';
import type { Chapter } from '../../types/book';

export const docxFormat: FormatDefinition = {
  id: 'docx',
  label: 'Word Document (DOCX)',
  extensions: ['docx'],
  mimeTypes: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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
    const { chapters, metadata, rawText, coverImage } = await parseDocx(buffer, {
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
      coverImage,
    };
  },
};
