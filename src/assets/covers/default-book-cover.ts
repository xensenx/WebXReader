import { DEFAULT_TXT_COVER } from './txt-default-cover';
import htmlCover from './html-default-cover.svg?raw';
import markdownCover from './md-default-cover.svg?raw';
import mhtCover from './mht-default-cover.svg?raw';

const asSvgDataUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const defaultCovers = new Map<string, string>([
  ['txt', DEFAULT_TXT_COVER],
  ['html', asSvgDataUrl(htmlCover)],
  ['markdown', asSvgDataUrl(markdownCover)],
  ['mht', asSvgDataUrl(mhtCover)],
]);

export function getDefaultBookCover(format?: string): string | undefined {
  return format ? defaultCovers.get(format) : undefined;
}

export function getBookCoverUrl(book?: { coverImage?: string; sourceFormat?: string } | null): string | undefined {
  return book?.coverImage || getDefaultBookCover(book?.sourceFormat);
}
