import { sanitizeBookChapter } from '../../core/parsing/sanitize-reader-html';
import type { BookFormat, Chapter } from '../../types/book';

const cachedChapters = new WeakMap<Chapter, { source?: string; format?: BookFormat; html: string }>();

/** Reuse sanitized chapter HTML when switching layout for the same document. */
export function getReaderChapterHtml(chapter: Chapter, format?: BookFormat) {
  const cached = cachedChapters.get(chapter);
  if (cached && cached.source === chapter.content && cached.format === format) return cached.html;
  const html = sanitizeBookChapter(chapter.content, format);
  cachedChapters.set(chapter, { source: chapter.content, format, html });
  return html;
}
