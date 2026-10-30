/**
 * Legacy Microsoft Word 97-2004 (.doc) format definition.
 */

import type { FormatDefinition, FormatParsedData, FormatImportContext } from '../types';
import { readFileAsArrayBuffer } from '../../utils';
import { parseDoc } from '../../core/parsing/doc-parser';
import type { Chapter } from '../../types/book';

export const docFormat: FormatDefinition = {
  id: 'doc',
  label: 'Word Document (DOC)',
  extensions: ['doc'],
  mimeTypes: [
    'application/msword',
    'application/vnd.ms-word',
    'application/x-msword',
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
    const { chapters, metadata, rawText } = await parseDoc(buffer, {
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
