/**
 * CB7 (Comic Book 7z) parser for WebXReader.
 * Uses 7-Zip WebAssembly engine to extract images and ComicInfo.xml metadata.
 */

import type { ComicParseResult } from './comic-archive';
import {
  parseComicInfoXml,
  buildTableOfContents,
  extractCoverDataUrl,
  getImageMimeType,
} from './comic-archive';
import { extractComicArchive } from './sevenzip-extractor';

export async function parseCb7(arrayBuffer: ArrayBuffer): Promise<ComicParseResult> {
  const { imagePaths, comicInfoXml, files } = await extractComicArchive(arrayBuffer, 'cb7');

  const { metadata, readingDirection, coverImageIndex, bookmarks } = comicInfoXml
    ? parseComicInfoXml(comicInfoXml)
    : { metadata: {}, bookmarks: [] };

  const tableOfContents = buildTableOfContents(imagePaths, bookmarks);

  let coverPath = imagePaths[0];
  if (
    coverImageIndex !== undefined &&
    coverImageIndex >= 0 &&
    coverImageIndex < imagePaths.length
  ) {
    coverPath = imagePaths[coverImageIndex];
  }

  const coverData = files.get(coverPath);
  const coverImage = coverData
    ? await extractCoverDataUrl(coverData, getImageMimeType(coverPath))
    : undefined;

  return {
    metadata,
    tableOfContents,
    coverImage,
    totalPages: imagePaths.length,
    readingDirection,
    pageFileNames: imagePaths,
  };
}
