/**
 * Markdown format definition (.md, .markdown).
 */

import type { FormatDefinition, FormatParsedData, FormatImportContext } from '../types';
import { readFileAsText } from '../../utils';
import { parseMarkdown } from '../../core/parsing/markdown-parser';
import type { Chapter } from '../../types/book';

export const markdownFormat: FormatDefinition = {
  id: 'markdown',
  label: 'Markdown',
  extensions: ['md', 'markdown'],
  mimeTypes: ['text/markdown', 'text/x-markdown'],
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
    const { chapters, metadata } = parseMarkdown(text);

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
