import type { BookFormat } from '../types/book';

export function usesScrollSheetLayout(format?: BookFormat): boolean {
  return format === 'txt' || format === 'html' || format === 'markdown' || format === 'mht';
}
