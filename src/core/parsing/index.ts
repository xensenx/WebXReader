/**
 * Re-exports all parsers for WebXReader.
 */

export { parseTxt } from './txt-parser';
export type { TxtParseResult, TxtParseOptions } from './txt-parser';

export { parseMarkdown } from './markdown-parser';
export type { MarkdownParseResult } from './markdown-parser';

export { parseHtml } from './html-parser';
export type { HtmlParseResult } from './html-parser';

export { parseEpub } from './epub-parser';
export type { EpubParseResult } from './epub-parser';

export { parsePdf } from './pdf-parser';
export type { PdfParseResult } from './pdf-parser';

export { parseCbz } from './cbz-parser';
export type { CbzParseResult } from './cbz-parser';

export { parseRtf } from './rtf-parser';
export type { RtfParseResult, RtfParseOptions } from './rtf-parser';

export { parseFb2 } from './fb2-parser';
export type { Fb2ParseResult, Fb2ParseOptions } from './fb2-parser';

export { parseMobi, decompressPalmDocLZ77 } from './mobi-parser';
export type { MobiParseResult, MobiParseOptions } from './mobi-parser';
