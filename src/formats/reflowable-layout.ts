import type { BookFormat } from '../types/book';

export function usesScrollSheetLayout(format?: BookFormat): boolean {
  return format === 'txt' || format === 'html' || format === 'markdown' || format === 'mht'
    || format === 'mobi' || format === 'azw3' || format === 'fb2'
    || format === 'docx' || format === 'doc' || format === 'rtf';
}
