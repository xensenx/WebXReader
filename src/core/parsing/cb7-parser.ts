import { parseSevenZipComic } from './sevenzip-extractor';

/** Parse a CB7 (Comic Book 7z) archive. */
export function parseCb7(arrayBuffer: ArrayBuffer) {
  return parseSevenZipComic(arrayBuffer, 'cb7');
}
