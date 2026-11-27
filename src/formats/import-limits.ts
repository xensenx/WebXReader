import type { BookFormat } from '../types/book';
import { MEGABYTE } from '../core/storage/storage-limits';

export const FORMAT_IMPORT_LIMITS = [
  { label: 'Comics', formats: ['cbz', 'cbr', 'cb7'], megabytes: 500 },
  { label: 'PDF and DjVu', formats: ['pdf', 'djvu'], megabytes: 200 },
  {
    label: 'Ebooks, other documents, web, archives and images',
    formats: ['epub', 'mobi', 'azw3', 'fb2', 'docx', 'doc', 'rtf', 'txt', 'markdown', 'html', 'mht', 'zip', 'rar', 'png', 'jpeg'],
    megabytes: 100,
  },
] as const satisfies ReadonlyArray<{ label: string; formats: readonly BookFormat[]; megabytes: number }>;

const limitsByFormat = new Map<BookFormat, number>();
for (const group of FORMAT_IMPORT_LIMITS) {
  for (const format of group.formats) limitsByFormat.set(format, group.megabytes * MEGABYTE);
}

export const getFormatImportLimit = (format: BookFormat) => limitsByFormat.get(format) ?? 100 * MEGABYTE;
