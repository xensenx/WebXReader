/**
 * HTML document format definition (.html, .htm, .xhtml).
 */

import type { FormatDefinition, FormatParsedData, FormatImportContext } from '../types';
import { readFileAsText } from '../../utils';
import { parseHtml } from '../../core/parsing/html-parser';
import type { Chapter } from '../../types/book';

export const htmlFormat: FormatDefinition = {
  id: 'html',
  label: 'HTML Document',
  extensions: ['html', 'htm', 'xhtml'],
  mimeTypes: ['text/html', 'application/xhtml+xml'],
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
    const { chapters, metadata } = parseHtml(text);

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
      rawText: text,
    };
  },
};
