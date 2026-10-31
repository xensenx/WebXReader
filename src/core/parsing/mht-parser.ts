/**
 * MHTML / MHT (MIME Encapsulation of Aggregate HTML Documents) Parser for WebXReader.
 *
 * Implements RFC 2557 / RFC 822 / RFC 2047 standard MIME multipart parsing:
 * 1. Robust header parsing with multiline continuation unfolding and RFC 2047 encoded-word decoding
 * 2. Character set decoding (UTF-8, Windows-1252, ISO-8859-1, GBK, Shift-JIS)
 * 3. Base64 and Quoted-Printable body decoding
 * 4. Automatic extraction and inlining of embedded CSS, images, and fonts into self-contained HTML
 * 5. Extraction of document title, author, date, description, cover image, and semantic TOC chapters
 */

import type { Chapter, BookMetadata } from '../../types/book';
import { generateId } from '../../utils';
import { sanitizeReaderHtml } from './sanitize-reader-html';

export interface MhtParseOptions {
  autoDetectChapters?: boolean;
  defaultCharset?: string;
}

export interface MhtMetadata extends Partial<BookMetadata> {
  date?: string;
  sourceUrl?: string;
}

export interface MhtParseResult {
  chapters: Chapter[];
  metadata: MhtMetadata;
  coverImage?: string;
  rawText: string;
  fullHtml: string;
}

interface MhtResource {
  contentType: string;
  dataUrl?: string;
  text?: string;
  location?: string;
  contentId?: string;
}

interface ParsedMimePart {
  headers: Map<string, string>;
  contentType: string;
  charset?: string;
  transferEncoding: string;
  location?: string;
  contentId?: string;
  bodyBytes: Uint8Array;
  bodyRaw: string;
}

/**
 * Decodes RFC 2047 encoded-words in MIME headers (e.g. "=?utf-8?B?...?=" or "=?utf-8?Q?...?=").
 */
export function decodeRfc2047(header: string | undefined): string {
  if (!header || !header.includes('=?')) return header || '';

  return header.replace(/=\?([^?]+)\?([BbQq])\?([^?]+)\?=/g, (match, charset, encoding, text) => {
    try {
      const enc = encoding.toUpperCase();
      if (enc === 'B') {
        const clean = text.replace(/[\r\n\s]/g, '');
        const binary = atob(clean);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return new TextDecoder(charset).decode(bytes);
      } else if (enc === 'Q') {
        // In Q encoding, '_' represents a space character (0x20)
        const qp = text.replace(/_/g, '=20');
        const bytes: number[] = [];
        let i = 0;
        while (i < qp.length) {
          if (qp[i] === '=' && i + 2 < qp.length) {
            const hex = qp.slice(i + 1, i + 3);
            if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
              bytes.push(parseInt(hex, 16));
              i += 3;
              continue;
            }
          }
          bytes.push(qp.charCodeAt(i) & 0xff);
          i++;
        }
        return new TextDecoder(charset).decode(new Uint8Array(bytes));
      }
    } catch {
      return match;
    }
    return match;
  });
}

/**
 * Parses MIME headers with RFC 822 folding (unfolding lines starting with space or tab).
 */
export function parseMimeHeaders(headerText: string): Map<string, string> {
  const headers = new Map<string, string>();
  // Unfold folded header lines
  const unfolded = headerText.replace(/\r?\n[ \t]+/g, ' ');
  const lines = unfolded.split(/\r?\n/);

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const name = line.slice(0, colonIdx).trim().toLowerCase();
      const rawValue = line.slice(colonIdx + 1).trim();
      const value = decodeRfc2047(rawValue);
      headers.set(name, value);
    }
  }

  return headers;
}

/**
 * Parses Content-Type header value into primary MIME type and parameter map (charset, boundary, etc.).
 */
export function parseContentType(headerValue: string): {
  mimeType: string;
  charset?: string;
  boundary?: string;
  parameters: Map<string, string>;
} {
  const parameters = new Map<string, string>();
  const parts = headerValue.split(';');
  const mimeType = parts[0].trim().toLowerCase();

  for (let i = 1; i < parts.length; i++) {
    const param = parts[i].trim();
    const eqIdx = param.indexOf('=');
    if (eqIdx > 0) {
      const key = param.slice(0, eqIdx).trim().toLowerCase();
      let val = param.slice(eqIdx + 1).trim();
      // Strip quotes if present
      val = val.replace(/^["']|["']$/g, '');
      parameters.set(key, val);
    }
  }

  return {
    mimeType,
    charset: parameters.get('charset'),
    boundary: parameters.get('boundary'),
    parameters,
  };
}

/**
 * Decodes Quoted-Printable encoded string into raw bytes.
 */
export function decodeQuotedPrintableToBytes(qpString: string): Uint8Array {
  // 1. Remove soft line breaks (equals sign followed by newline)
  const cleaned = qpString.replace(/=(?:\r\n|\r|\n)/g, '');
  const bytes: number[] = [];
  let i = 0;

  while (i < cleaned.length) {
    const c = cleaned[i];
    if (c === '=' && i + 2 < cleaned.length) {
      const hex = cleaned.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 3;
        continue;
      }
    }
    bytes.push(cleaned.charCodeAt(i) & 0xff);
    i++;
  }

  return new Uint8Array(bytes);
}

/**
 * Decodes bytes to string using specified charset with robust fallbacks.
 */
export function decodeTextWithCharset(bytes: Uint8Array, charset = 'utf-8'): string {
  const normCharset = charset.toLowerCase().replace(/^["']|["']$/g, '').trim();
  try {
    const decoder = new TextDecoder(normCharset);
    return decoder.decode(bytes);
  } catch {
    try {
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return new TextDecoder('latin1').decode(bytes);
    }
  }
}

/**
 * Converts a byte array to Latin1 binary string preserving exact byte values (0x00 to 0xFF).
 */
export function bufferToLatin1String(buf: Uint8Array): string {
  let str = '';
  const chunkSize = 16384;
  for (let i = 0; i < buf.length; i += chunkSize) {
    const slice = buf.subarray(i, i + chunkSize);
    str += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return str;
}

/**
 * Converts Latin1 string to byte array.
 */
export function latin1StringToBuffer(str: string): Uint8Array {
  const buf = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    buf[i] = str.charCodeAt(i) & 0xff;
  }
  return buf;
}

/**
 * Resolves a URL or CID against the resource map with multiple lookup strategies.
 */
function findResource(url: string, resourceMap: Map<string, MhtResource>, baseUrl?: string): MhtResource | null {
  if (!url) return null;
  const cleanUrl = url.trim();

  // 1. CID lookup: cid:part1@example.com
  if (cleanUrl.toLowerCase().startsWith('cid:')) {
    const cid = cleanUrl.slice(4).trim();
    return resourceMap.get(cid) || resourceMap.get(`<${cid}>`) || resourceMap.get(`cid:${cid}`) || null;
  }

  // 2. Direct exact match
  if (resourceMap.has(cleanUrl)) {
    return resourceMap.get(cleanUrl) || null;
  }

  // 3. Resolve relative to baseUrl if available
  if (baseUrl) {
    try {
      const resolved = new URL(cleanUrl, baseUrl).href;
      if (resourceMap.has(resolved)) {
        return resourceMap.get(resolved) || null;
      }
    } catch {
      // ignore URL resolution error
    }
  }

  // 4. Filename / basename match (e.g. "header.png" from "https://example.com/assets/header.png")
  const filename = cleanUrl.split(/[/\\]/).pop()?.split('?')[0].split('#')[0];
  if (filename && resourceMap.has(filename)) {
    return resourceMap.get(filename) || null;
  }

  // 5. Clean without query/hash
  const stripped = cleanUrl.split('?')[0].split('#')[0];
  if (resourceMap.has(stripped)) {
    return resourceMap.get(stripped) || null;
  }

  return null;
}

/**
 * Inlines external resources (images, stylesheets, fonts) into the root HTML as data URIs and inline styles.
 */
export function inlineMhtmlResources(html: string, resourceMap: Map<string, MhtResource>, baseUrl?: string): string {
  // 1. Inline <link rel="stylesheet" href="..."> tags
  let result = html.replace(
    /<link\b([^>]*?)href=["']([^"']+)["']([^>]*?)>/gi,
    (match, _before, href, _after) => {
      const isStylesheet = /rel=["'](?:stylesheet|alternate stylesheet)["']/i.test(match);
      if (!isStylesheet) return match;

      const res = findResource(href, resourceMap, baseUrl);
      if (res && res.text) {
        return `<style data-mhtml-inlined="true">\n/* Inlined from ${href} */\n${res.text}\n</style>`;
      }
      return match;
    }
  );

  // 2. Inline <img> tags
  result = result.replace(
    /<img\b([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi,
    (match, before, src, after) => {
      const res = findResource(src, resourceMap, baseUrl);
      if (res && res.dataUrl) {
        return `<img${before}src="${res.dataUrl}"${after}>`;
      }
      return match;
    }
  );

  // 3. Inline <source srcset="..."> tags (for <picture>)
  result = result.replace(
    /<source\b([^>]*?)srcset=["']([^"']+)["']([^>]*?)>/gi,
    (_match, before, srcset, after) => {
      const parts = srcset.split(',').map((part: string) => {
        const trimmed = part.trim();
        const spaceIdx = trimmed.indexOf(' ');
        const url = spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed;
        const descriptor = spaceIdx > 0 ? trimmed.slice(spaceIdx) : '';
        const res = findResource(url, resourceMap, baseUrl);
        return res && res.dataUrl ? `${res.dataUrl}${descriptor}` : part;
      });
      return `<source${before}srcset="${parts.join(', ')}"${after}>`;
    }
  );

  // 4. Inline CSS url(...) in <style> blocks and style attributes
  result = result.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (match, url) => {
    // Avoid double-inlining already inlined data URIs
    if (url.startsWith('data:')) return match;
    const res = findResource(url, resourceMap, baseUrl);
    if (res && res.dataUrl) {
      return `url("${res.dataUrl}")`;
    }
    return match;
  });

  return result;
}

/**
 * Extracts metadata from the inlined HTML.
 */
function extractMetadataFromHtml(html: string): MhtMetadata {
  const metadata: MhtMetadata = {};

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const raw = titleMatch[1].replace(/<[^>]+>/g, '').trim();
    if (raw) metadata.title = raw;
  }

  const metaAuthor = html.match(/<meta\b[^>]*?\b(?:name|property)=["'](?:author|dc\.creator)["'][^>]*?\bcontent=["']([^"']+)["']/i) ||
    html.match(/<meta\b[^>]*?\bcontent=["']([^"']+)["'][^>]*?\b(?:name|property)=["'](?:author|dc\.creator)["']/i);
  if (metaAuthor) {
    metadata.author = metaAuthor[1].trim();
  }

  const metaDesc = html.match(/<meta\b[^>]*?\b(?:name|property)=["'](?:description|og:description)["'][^>]*?\bcontent=["']([^"']+)["']/i) ||
    html.match(/<meta\b[^>]*?\bcontent=["']([^"']+)["'][^>]*?\b(?:name|property)=["'](?:description|og:description)["']/i);
  if (metaDesc) {
    metadata.description = metaDesc[1].trim();
  }

  const metaDate = html.match(/<meta\b[^>]*?\b(?:name|property)=["'](?:date|article:published_time|dc\.date)["'][^>]*?\bcontent=["']([^"']+)["']/i) ||
    html.match(/<meta\b[^>]*?\bcontent=["']([^"']+)["'][^>]*?\b(?:name|property)=["'](?:date|article:published_time|dc\.date)["']/i);
  if (metaDate) {
    metadata.date = metaDate[1].trim();
  }

  const metaLang = html.match(/<html\b[^>]*?\blang=["']([^"']+)["']/i) ||
    html.match(/<meta\b[^>]*?\b(?:name|property)=["'](?:language|dc\.language)["'][^>]*?\bcontent=["']([^"']+)["']/i);
  if (metaLang) {
    metadata.language = metaLang[1].trim();
  }

  return metadata;
}

/**
 * Extracts plain text from HTML content for text search and word count.
 */
function extractRawText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits HTML content into structured chapters based on heading tags (h1, h2, h3).
 */
function chunkHtmlByBlocks(html: string, maxChunkLength = 25000): string[] {
  if (html.length <= maxChunkLength) {
    return [html];
  }

  const chunks: string[] = [];
  const blockRegex = /<\/(?:p|div|section|article|blockquote|table)>/gi;
  let currentChunkStart = 0;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(html)) !== null) {
    const splitPoint = match.index + match[0].length;
    if (splitPoint - currentChunkStart >= maxChunkLength) {
      const chunk = html.slice(currentChunkStart, splitPoint).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }
      currentChunkStart = splitPoint;
    }
  }

  if (currentChunkStart < html.length) {
    const remaining = html.slice(currentChunkStart).trim();
    if (remaining.length > 0) {
      if (chunks.length > 0 && remaining.length < 5000) {
        chunks[chunks.length - 1] += '\n' + remaining;
      } else {
        chunks.push(remaining);
      }
    }
  }

  return chunks.length > 0 ? chunks : [html];
}

export function splitHtmlIntoChapters(cleanHtml: string, documentTitle?: string): Chapter[] {
  // Use DOM parser if available
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<div>${cleanHtml}</div>`, 'text/html');
      const container = doc.body.firstElementChild || doc.body;

      const chapters: Chapter[] = [];
      let currentContent: string[] = [];
      let currentTitle: string | null = null;
      let currentLevel = 0;

      const flush = () => {
        const content = currentContent.join('').trim();
        if (currentTitle !== null || content.length > 0) {
          chapters.push({
            id: generateId(),
            title: currentTitle || documentTitle || 'Section ' + (chapters.length + 1),
            content: content || '<p></p>',
            level: currentLevel,
            order: chapters.length,
          });
        }
        currentContent = [];
      };

      for (const node of Array.from(container.childNodes)) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          const tag = el.tagName.toUpperCase();
          if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
            flush();
            currentTitle = el.textContent?.trim() || null;
            currentLevel = tag === 'H1' ? 0 : tag === 'H2' ? 1 : 2;
          } else {
            currentContent.push(el.outerHTML);
          }
        } else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
          currentContent.push(`<p>${node.textContent.trim()}</p>`);
        }
      }

      flush();

      if (chapters.length > 1) {
        return chapters;
      }
    } catch {
      // Fall through to regex-based fallback
    }
  }

  // Regex fallback: split by <h1...>, <h2...>
  const headingRegex = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const matches = Array.from(cleanHtml.matchAll(headingRegex));

  if (matches.length > 0) {
    const chapters: Chapter[] = [];

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const matchIndex = match.index ?? 0;

      if (i === 0 && matchIndex > 0) {
        const preamble = cleanHtml.slice(0, matchIndex).trim();
        if (preamble.replace(/<[^>]+>/g, '').trim().length > 0) {
          chapters.push({
            id: generateId(),
            title: documentTitle || 'Introduction',
            content: preamble,
            level: 0,
            order: 0,
          });
        }
      }

      const nextIndex = i + 1 < matches.length ? (matches[i + 1].index ?? cleanHtml.length) : cleanHtml.length;
      const chapterContent = cleanHtml.slice(matchIndex + match[0].length, nextIndex).trim();
      const level = parseInt(match[1], 10) - 1;
      const title = match[2].replace(/<[^>]+>/g, '').trim() || `Section ${chapters.length + 1}`;

      chapters.push({
        id: generateId(),
        title,
        content: chapterContent || '<p></p>',
        level: Math.max(0, level),
        order: chapters.length,
      });
    }

    if (chapters.length > 1 || (chapters.length === 1 && cleanHtml.length <= 35000)) {
      return chapters;
    }
  }

  // Fallback for long documents with no headings: chunk into readable blocks
  if (cleanHtml.length > 30000) {
    const chunks = chunkHtmlByBlocks(cleanHtml, 25000);
    if (chunks.length > 1) {
      return chunks.map((chunk, idx) => ({
        id: generateId(),
        title: idx === 0 && documentTitle ? documentTitle : `Part ${idx + 1}`,
        content: chunk,
        level: 0,
        order: idx,
      }));
    }
  }

  // Fallback: single chapter containing the entire document
  return [
    {
      id: generateId(),
      title: documentTitle || 'Full Document',
      content: cleanHtml,
      level: 0,
      order: 0,
    },
  ];
}

/**
 * Parses an MHT / MHTML web archive from an ArrayBuffer, Uint8Array, or string.
 */
export async function parseMht(
  input: ArrayBuffer | Uint8Array | string,
  options?: MhtParseOptions
): Promise<MhtParseResult> {
  let rawText: string;

  if (typeof input === 'string') {
    rawText = input;
  } else {
    const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    rawText = bufferToLatin1String(u8);
  }

  if (!rawText || rawText.trim().length === 0) {
    throw new Error('The MHTML file is empty.');
  }

  // 1. Separate top-level MIME headers from multipart body
  const blankLineMatch = rawText.match(/\r?\n\r?\n/);
  if (!blankLineMatch || blankLineMatch.index === undefined) {
    throw new Error('Invalid MHTML file: missing top-level MIME header section.');
  }

  const topHeaderStr = rawText.slice(0, blankLineMatch.index);
  const bodyContentStr = rawText.slice(blankLineMatch.index + blankLineMatch[0].length);
  const topHeaders = parseMimeHeaders(topHeaderStr);

  const contentTypeHeader = topHeaders.get('content-type') || '';
  const parsedContentType = parseContentType(contentTypeHeader);

  // Extract boundary token
  let boundary = parsedContentType.boundary;
  if (!boundary) {
    // Fallback: look for the first boundary line in the body starting with "--"
    const firstBoundaryMatch = bodyContentStr.match(/--([^\r\n]+)/);
    if (firstBoundaryMatch) {
      boundary = firstBoundaryMatch[1].trim();
      // Remove trailing "--" if matched closing boundary
      if (boundary.endsWith('--')) boundary = boundary.slice(0, -2);
    }
  }

  if (!boundary) {
    throw new Error('Invalid MHTML archive: boundary delimiter not found.');
  }

  // 2. Split body into individual MIME parts
  const rawParts = bodyContentStr.split('--' + boundary);
  const parsedParts: ParsedMimePart[] = [];

  for (const rawPart of rawParts) {
    const trimmed = rawPart.trim();
    // Skip empty leading segments or end boundary marker ("--")
    if (!trimmed || trimmed === '--' || trimmed.startsWith('--')) continue;

    const partBlank = rawPart.match(/\r?\n\r?\n/);
    if (!partBlank || partBlank.index === undefined) continue;

    const partHeaderStr = rawPart.slice(0, partBlank.index);
    const partBodyStr = rawPart.slice(partBlank.index + partBlank[0].length);
    const partHeaders = parseMimeHeaders(partHeaderStr);

    const partTypeHeader = partHeaders.get('content-type') || 'application/octet-stream';
    const { mimeType, charset } = parseContentType(partTypeHeader);
    const transferEncoding = (partHeaders.get('content-transfer-encoding') || '7bit').toLowerCase().trim();
    const location = partHeaders.get('content-location');
    const contentId = partHeaders.get('content-id')?.replace(/^<|>$/g, '').trim();

    // Decode body data
    let bodyBytes: Uint8Array;
    if (transferEncoding === 'base64') {
      const cleanB64 = partBodyStr.replace(/[\r\n\s]/g, '');
      try {
        const bin = atob(cleanB64);
        bodyBytes = latin1StringToBuffer(bin);
      } catch {
        bodyBytes = new Uint8Array(0);
      }
    } else if (transferEncoding === 'quoted-printable') {
      bodyBytes = decodeQuotedPrintableToBytes(partBodyStr);
    } else {
      bodyBytes = latin1StringToBuffer(partBodyStr);
    }

    parsedParts.push({
      headers: partHeaders,
      contentType: mimeType,
      charset,
      transferEncoding,
      location,
      contentId,
      bodyBytes,
      bodyRaw: partBodyStr,
    });
  }

  if (parsedParts.length === 0) {
    throw new Error('No valid MIME parts found in the MHTML archive.');
  }

  // 3. Identify root HTML document part
  const rootLocation = topHeaders.get('snapshot-content-location') || topHeaders.get('content-location');
  let rootHtmlPart: ParsedMimePart | undefined;

  if (rootLocation) {
    rootHtmlPart = parsedParts.find((p) => p.location && p.location.trim() === rootLocation.trim());
  }

  if (!rootHtmlPart) {
    rootHtmlPart = parsedParts.find((p) => p.contentType === 'text/html' || p.contentType === 'application/xhtml+xml');
  }

  if (!rootHtmlPart) {
    // If no HTML part, check for text/plain
    rootHtmlPart = parsedParts.find((p) => p.contentType === 'text/plain');
  }

  if (!rootHtmlPart) {
    throw new Error('No readable HTML document found in the MHTML archive.');
  }

  // 4. Decode root HTML text
  const rootCharset = rootHtmlPart.charset || options?.defaultCharset || 'utf-8';
  let rootHtml: string;
  if (rootHtmlPart.transferEncoding === 'quoted-printable') {
    rootHtml = decodeTextWithCharset(rootHtmlPart.bodyBytes, rootCharset);
  } else if (rootHtmlPart.transferEncoding === 'base64') {
    rootHtml = decodeTextWithCharset(rootHtmlPart.bodyBytes, rootCharset);
  } else {
    rootHtml = decodeTextWithCharset(rootHtmlPart.bodyBytes, rootCharset);
  }

  // 5. Build resource lookup map for all auxiliary parts
  const resourceMap = new Map<string, MhtResource>();
  let coverImage: string | undefined;

  for (const part of parsedParts) {
    if (part === rootHtmlPart) continue;

    let dataUrl: string | undefined;
    let text: string | undefined;

    if (part.contentType.startsWith('image/')) {
      const cleanB64 = part.transferEncoding === 'base64'
        ? part.bodyRaw.replace(/[\r\n\s]/g, '')
        : btoa(bufferToLatin1String(part.bodyBytes));
      dataUrl = `data:${part.contentType};base64,${cleanB64}`;

      if (!coverImage) {
        coverImage = dataUrl;
      }
    } else if (part.contentType === 'text/css') {
      text = decodeTextWithCharset(part.bodyBytes, part.charset || 'utf-8');
      dataUrl = `data:text/css;charset=utf-8;base64,${btoa(unescape(encodeURIComponent(text)))}`;
    } else if (part.contentType.startsWith('font/') || part.contentType.includes('font')) {
      const cleanB64 = part.transferEncoding === 'base64'
        ? part.bodyRaw.replace(/[\r\n\s]/g, '')
        : btoa(bufferToLatin1String(part.bodyBytes));
      dataUrl = `data:${part.contentType};base64,${cleanB64}`;
    }

    const resource: MhtResource = {
      contentType: part.contentType,
      dataUrl,
      text,
      location: part.location,
      contentId: part.contentId,
    };

    // Index under various key patterns for robust resolution
    if (part.location) {
      resourceMap.set(part.location.trim(), resource);
      // Normalized path without origin
      try {
        const u = new URL(part.location);
        resourceMap.set(u.pathname, resource);
        resourceMap.set(u.pathname.replace(/^\//, ''), resource);
        const fname = u.pathname.split('/').pop();
        if (fname) resourceMap.set(fname, resource);
      } catch {
        const fname = part.location.split(/[/\\]/).pop();
        if (fname) resourceMap.set(fname, resource);
      }
    }

    if (part.contentId) {
      resourceMap.set(part.contentId, resource);
      resourceMap.set(`<${part.contentId}>`, resource);
      resourceMap.set(`cid:${part.contentId}`, resource);
    }
  }

  // 6. Inline external resources into the root HTML
  const baseUrl = rootHtmlPart.location || rootLocation || undefined;
  const inlinedHtml = inlineMhtmlResources(rootHtml, resourceMap, baseUrl);

  // 7. Extract metadata
  const htmlMeta = extractMetadataFromHtml(inlinedHtml);
  const metadata: MhtMetadata = {
    title: htmlMeta.title || topHeaders.get('subject') || undefined,
    author: htmlMeta.author || topHeaders.get('from')?.replace(/^<|>$/g, '').trim() || undefined,
    description: htmlMeta.description || undefined,
    date: htmlMeta.date || topHeaders.get('date') || undefined,
    language: htmlMeta.language || undefined,
    sourceUrl: baseUrl,
  };

  // If coverImage not found yet, check for first resolved <img> in the inlined HTML
  if (!coverImage) {
    const firstImgMatch = inlinedHtml.match(/<img\b[^>]*?src=["'](data:image\/[^"']+)["']/i);
    if (firstImgMatch) {
      coverImage = firstImgMatch[1];
    }
  }

  // 8. Sanitize HTML for reader display
  const cleanBodyHtml = sanitizeReaderHtml(inlinedHtml);

  // 9. Split into chapters
  const chapters = splitHtmlIntoChapters(cleanBodyHtml, metadata.title);
  const plainText = extractRawText(cleanBodyHtml);

  return {
    chapters,
    metadata,
    coverImage,
    rawText: plainText,
    fullHtml: inlinedHtml,
  };
}
