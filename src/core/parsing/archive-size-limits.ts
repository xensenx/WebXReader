import { MEGABYTE } from '../storage/storage-limits';

export const ARCHIVE_TOTAL_BYTES = 300 * MEGABYTE;
// Comic pages are often already compressed. Leave room above the 500 MB input limit.
export const COMIC_ARCHIVE_TOTAL_BYTES = 768 * MEGABYTE;
