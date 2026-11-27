import { parseSevenZipComic } from './sevenzip-extractor';

/** Parse a CBR (Comic Book RAR) archive. */
export function parseCbr(arrayBuffer: ArrayBuffer) {
  return parseSevenZipComic(arrayBuffer, 'cbr');
}
