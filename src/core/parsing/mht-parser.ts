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
import { escapeHtml, sanitizeMhtReaderHtml } from './sanitize-reader-html';
import { splitByHeadings } from './html-parser';

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
  contentType: string;
  charset?: string;
  transferEncoding: string;
  location?: string;
  contentId?: string;
  bodyRaw: string;
  parent?: ParsedMimePart;
  children?: ParsedMimePart[];
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
  const unfolded = headerText.replace(/(?:\r\n|\r|\n)[ \t]+/g, ' ');
  const lines = unfolded.split(/\r\n|\r|\n/);

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0 && /^[a-z0-9-]+$/i.test(line.slice(0, colonIdx))) {
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
  const separator = headerValue.indexOf(';');
  const mimeType = (separator < 0 ? headerValue : headerValue.slice(0, separator)).trim().toLowerCase();
  if (separator >= 0) {
    const parameter = /;\s*([\w-]+)\s*=\s*(?:"((?:\\.|[^"\\])*)"|'([^']*)'|([^;]*))/g;
    for (const [, key, quoted, singleQuoted, unquoted] of headerValue.slice(separator).matchAll(parameter)) {
      const value = quoted?.replace(/\\(.)/g, '$1') ?? singleQuoted ?? unquoted.trim();
      parameters.set(key.toLowerCase(), value);
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
  const bytes = new Uint8Array(qpString.length);
  let written = 0;
  for (let index = 0; index < qpString.length; index++) {
    if (qpString[index] === '=') {
      const next = qpString[index + 1];
      if (next === '\r' || next === '\n') {
        index += next === '\r' && qpString[index + 2] === '\n' ? 2 : 1;
        continue;
      }
      const hex = qpString.slice(index + 1, index + 3);
      if (/^[0-9a-f]{2}$/i.test(hex)) {
        bytes[written++] = parseInt(hex, 16);
        index += 2;
        continue;
      }
    }
    bytes[written++] = qpString.charCodeAt(index);
  }
  return bytes.subarray(0, written);
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
  return inlineResources(html, (url) => findResource(url, resourceMap, baseUrl));
}

function inlineResources(html: string, lookup: (url: string) => MhtResource | null): string {
  // 1. Inline <link rel="stylesheet" href="..."> tags
  let result = html.replace(
    /<link\b([^>]*?)href=["']([^"']+)["']([^>]*?)>/gi,
    (match, _before, href, _after) => {
      const isStylesheet = /rel=["'](?:stylesheet|alternate stylesheet)["']/i.test(match);
      if (!isStylesheet) return match;

      const res = lookup(href);
      if (res && res.text) {
        return `<style data-mhtml-inlined="true">\n/* Inlined from ${href} */\n${res.text}\n</style>`;
      }
      return match;
    }
  );

  // Parse each image tag in an inert template to decode its attribute value.
  const template = document.createElement('template');
  result = result.replace(/<img(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/gi, (match) => {
    template.innerHTML = match;
    const image = template.content.querySelector('img[src]');
    if (!image) return match;
    const res = lookup(image.getAttribute('src') ?? '');
    if (!res?.dataUrl) return match;
    image.setAttribute('src', res.dataUrl);
    return template.innerHTML;
  });

  // 3. Inline <source srcset="..."> tags (for <picture>)
  result = result.replace(
    /<source\b([^>]*?)srcset=["']([^"']+)["']([^>]*?)>/gi,
    (_match, before, srcset, after) => {
      const parts = srcset.split(',').map((part: string) => {
        const trimmed = part.trim();
        const spaceIdx = trimmed.indexOf(' ');
        const url = spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed;
        const descriptor = spaceIdx > 0 ? trimmed.slice(spaceIdx) : '';
        const res = lookup(url);
        return res && res.dataUrl ? `${res.dataUrl}${descriptor}` : part;
      });
      return `<source${before}srcset="${parts.join(', ')}"${after}>`;
    }
  );

  // 4. Inline CSS url(...) in <style> blocks and style attributes
  result = result.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (match, url) => {
    // Avoid double-inlining already inlined data URIs
    if (url.startsWith('data:')) return match;
    const res = lookup(url);
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

/** Split long sections at block boundaries without counting embedded image bytes. */
function chunkHtmlByBlocks(chapter: Chapter, maxTextLength = 25000): Chapter[] {
  const html = chapter.content ?? '';
  if (html.length <= maxTextLength) return [chapter];
  const container = document.createElement('template');
  container.innerHTML = html;
  const root = container.content;
  const textLength = root.textContent?.length ?? 0;
  if (textLength <= maxTextLength) return [chapter];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  range.selectNodeContents(root);
  const chunks: Chapter[] = [];
  let count = 0;
  let remaining = textLength;
  let lastBlock: Element | null = null;
  const append = () => {
    const fragment = document.createElement('template');
    fragment.content.append(range.cloneContents());
    chunks.push({
      ...chapter,
      id: chunks.length ? generateId() : chapter.id,
      title: chunks.length ? `Part ${chunks.length + 1}` : chapter.title,
      content: fragment.innerHTML,
    });
  };
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const block = node.parentElement?.closest('table, ul, ol, blockquote, pre')
      ?? node.parentElement?.closest('p, div, section, article');
    if (count >= maxTextLength && remaining >= 5000 && lastBlock && block !== lastBlock &&
        block && !lastBlock.contains(block) && !block.contains(lastBlock)) {
      range.setEndAfter(lastBlock);
      append();
      range.setStartAfter(lastBlock);
      count = 0;
    }
    const length = node.textContent?.length ?? 0;
    count += length;
    remaining -= length;
    lastBlock = block ?? null;
  }
  if (!chunks.length) return [chapter];
  range.setEnd(root, root.childNodes.length);
  append();
  return chunks;
}

export function splitHtmlIntoChapters(cleanHtml: string, documentTitle?: string): Chapter[] {
  const title = documentTitle || 'Full Document';
  const sections = splitByHeadings(cleanHtml, title, 'h1, h2, h3');
  if (!sections.length) return [{ id: generateId(), title, content: cleanHtml, level: 0, order: 0 }];
  return sections.flatMap((chapter) => chunkHtmlByBlocks(chapter))
    .map((chapter, order) => ({ ...chapter, order }));
}

const MIME_HEADER_SEPARATOR = /\r\n\r\n|\n\n|\r\r/;
const HTML_DOCUMENT_START = /^\s*(?:<\?xml\b[^>]*>\s*)?(?:<!--(?:(?!-->)[\s\S])*-->\s*)*(?:<!doctype\s+html\b|<(?:html|head|body|title|meta|h[1-6]|p|div|article|main|section)\b)/i;

function splitMimeEntity(raw: string): { headers: Map<string, string>; body: string } {
  const separator = MIME_HEADER_SEPARATOR.exec(raw);
  if (!separator || !/^[a-z0-9-]+:/i.test(raw)) {
    return { headers: new Map(), body: raw };
  }
  return {
    headers: parseMimeHeaders(raw.slice(0, separator.index)),
    body: raw.slice(separator.index + separator[0].length),
  };
}

function decodeMimeBody(body: string, encoding: string): Uint8Array {
  if (encoding === 'quoted-printable') return decodeQuotedPrintableToBytes(body);
  if (encoding === 'base64') {
    try {
      return latin1StringToBuffer(atob(body.replace(/\s/g, '')));
    } catch {
      return new Uint8Array(0);
    }
  }
  return latin1StringToBuffer(body);
}

function splitMultipartBody(body: string, boundary: string): string[] {
  const escaped = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const delimiter = new RegExp(`(?:^|\\r\\n|\\r|\\n)--${escaped}(--)?[ \\t]*(?=\\r\\n|\\r|\\n|$)`, 'g');
  const parts: string[] = [];
  let start: number | undefined;
  for (const match of body.matchAll(delimiter)) {
    if (start !== undefined) parts.push(body.slice(start, match.index).replace(/^\r\n|^\r|^\n/, ''));
    if (match[1]) return parts;
    start = match.index + match[0].length;
  }
  if (start !== undefined && start < body.length) parts.push(body.slice(start).replace(/^\r\n|^\r|^\n/, ''));
  return parts;
}

function inferBoundary(body: string): string | undefined {
  // Require a delimiter line followed by MIME headers, rather than matching prose.
  return /(?:^|\r\n|\r|\n)--([^\r\n]+?)[ \t]*(?:\r\n|\r|\n)(?=(?:content-[a-z-]+|mime-version):)/i.exec(body)?.[1];
}

function collectMimeParts(
  headers: Map<string, string>,
  body: string,
  parent?: ParsedMimePart,
  depth = 0,
): ParsedMimePart[] {
  if (depth > 24) return [];
  const { mimeType, charset, boundary } = parseContentType(headers.get('content-type') ?? '');
  const transferEncoding = headers.get('content-transfer-encoding')?.toLowerCase() ?? '7bit';
  const node: ParsedMimePart = {
    contentType: mimeType || 'application/octet-stream',
    charset,
    transferEncoding,
    location: headers.get('content-location'),
    contentId: normalizeContentId(headers.get('content-id')),
    bodyRaw: body,
    parent,
  };
  if (mimeType === 'message/rfc822') {
    const embedded = splitMimeEntity(bufferToLatin1String(decodeMimeBody(body, transferEncoding)));
    node.children = collectMimeParts(embedded.headers, embedded.body, node, depth + 1);
    return [node];
  }

  let parts = boundary ? splitMultipartBody(body, boundary) : [];
  if (!parts.length && (!mimeType || mimeType.startsWith('multipart/'))) {
    const inferred = inferBoundary(body);
    if (inferred && inferred !== boundary) parts = splitMultipartBody(body, inferred);
  }
  if (parts.length) {
    node.children = parts.flatMap((part) => {
      const entity = splitMimeEntity(part);
      return collectMimeParts(entity.headers, entity.body, node, depth + 1);
    });
  } else if (mimeType.startsWith('multipart/')) {
    return [];
  }
  return [node];
}

function mimeLeaves(nodes: ParsedMimePart[]): ParsedMimePart[] {
  return nodes.flatMap((node) => node.children ? mimeLeaves(node.children) : [node]);
}

function findMimePart(nodes: ParsedMimePart[], id: string): ParsedMimePart | undefined {
  for (const node of nodes) {
    if (node.contentId === id) return node;
    const found = node.children && findMimePart(node.children, id);
    if (found) return found;
  }
  return undefined;
}

function normalizeContentId(id?: string): string | undefined {
  return id?.trim().replace(/^cid:/i, '').replace(/^<|>$/g, '');
}

interface MimeResourceScope {
  resourceMap: Map<string, MhtResource>;
  coverImage?: string;
}

function indexMimeResources(parts: ParsedMimePart[]): Map<ParsedMimePart, MimeResourceScope> {
  const scopes = new Map<ParsedMimePart, MimeResourceScope>();
  for (const part of parts) {
    const isImage = part.contentType.startsWith('image/');
    const isCss = part.contentType === 'text/css';
    const isFont = part.contentType.includes('font');
    if (!part.parent || (!isImage && !isCss && !isFont)) continue;
    let scope = scopes.get(part.parent);
    if (!scope) {
      scope = { resourceMap: new Map() };
      scopes.set(part.parent, scope);
    }
    const { resourceMap } = scope;
    let dataUrl: string | undefined;
    let text: string | undefined;

    if (isImage || isFont) {
      const cleanB64 = part.transferEncoding === 'base64'
        ? part.bodyRaw.replace(/[\r\n\s]/g, '')
        : btoa(bufferToLatin1String(decodeMimeBody(part.bodyRaw, part.transferEncoding)));
      dataUrl = `data:${part.contentType};base64,${cleanB64}`;

      if (isImage) scope.coverImage ??= dataUrl;
    } else {
      text = decodeTextWithCharset(decodeMimeBody(part.bodyRaw, part.transferEncoding), part.charset || 'utf-8');
      dataUrl = `data:text/css;charset=utf-8;base64,${btoa(unescape(encodeURIComponent(text)))}`;
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

  return scopes;
}

function selectDocument(
  parts: ParsedMimePart[],
  preferredParts: ParsedMimePart[],
  rootLocation: string | undefined,
  defaultCharset: string | undefined,
  prepare: (part: ParsedMimePart, html: string) => string,
): { part: ParsedMimePart; inlinedHtml: string; cleanHtml: string } | undefined {
  const template = document.createElement('template');
  const isHtml = ({ contentType }: ParsedMimePart) =>
    contentType === 'text/html' || contentType === 'application/xhtml+xml';
  const decode = (part: ParsedMimePart) =>
    decodeTextWithCharset(decodeMimeBody(part.bodyRaw, part.transferEncoding), part.charset || defaultCharset);
  const checked = new Set<ParsedMimePart>();

  // A matched start container gets first choice, including its plain alternative.
  for (const group of [preferredParts, parts]) {
    const readable = group.filter((part) => part.bodyRaw.length > 0);
    const candidates = new Set([
      ...(rootLocation ? readable.filter((part) => part.location === rootLocation) : []),
      ...readable.filter(isHtml),
      ...readable,
    ]);
    for (const part of candidates) {
      if (checked.has(part)) continue;
      checked.add(part);
      const explicit = isHtml(part);
      if (!explicit && part.contentType !== 'application/octet-stream') continue;
      const html = decode(part);
      if (!html.trim() || (!explicit && !HTML_DOCUMENT_START.test(html))) continue;

      const inlinedHtml = prepare(part, html);
      const cleanHtml = sanitizeMhtReaderHtml(inlinedHtml);
      template.innerHTML = cleanHtml;
      if (template.content.textContent?.trim() || template.content.querySelector('img[src]')) {
        return { part, inlinedHtml, cleanHtml };
      }
    }

    for (const part of candidates) {
      if (part.contentType !== 'text/plain') continue;
      const text = decode(part);
      if (!text.trim()) continue;
      const inlinedHtml = `<p>${escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>')}</p>`;
      return { part, inlinedHtml, cleanHtml: sanitizeMhtReaderHtml(inlinedHtml) };
    }
  }
  return undefined;
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

  // Strip a UTF-8 BOM from the MIME envelope while keeping body bytes intact.
  const { headers: topHeaders, body } = splitMimeEntity(rawText.replace(/^(?:\uFEFF|\xEF\xBB\xBF)/, ''));
  const contentType = parseContentType(topHeaders.get('content-type') ?? '');
  const mimeTree = collectMimeParts(topHeaders, body);
  const startId = normalizeContentId(contentType.parameters.get('start'));
  const preferred = startId ? findMimePart(mimeTree, startId) : undefined;
  const parsedParts = mimeLeaves(mimeTree);
  if (parsedParts.length === 0) {
    throw new Error('Invalid MHTML archive: boundary delimiter not found or no valid MIME parts.');
  }

  const rootLocation = topHeaders.get('snapshot-content-location') || topHeaders.get('content-location');
  const scopes = indexMimeResources(parsedParts);
  const scopesFor = (part: ParsedMimePart): MimeResourceScope[] => {
    const visible: MimeResourceScope[] = [];
    for (let parent = part.parent; parent; parent = parent.parent) {
      const scope = scopes.get(parent);
      if (scope) visible.push(scope);
    }
    return visible;
  };
  const root = selectDocument(
    parsedParts, preferred ? mimeLeaves([preferred]) : [], rootLocation, options?.defaultCharset,
    (part, html) => {
      const visible = scopesFor(part);
      const baseUrl = part.location || rootLocation;
      return inlineResources(html, (url) => {
        for (const scope of visible) {
          const resource = findResource(url, scope.resourceMap, baseUrl);
          if (resource) return resource;
        }
        return null;
      });
    },
  );
  if (!root) {
    if (!topHeaders.size && !MIME_HEADER_SEPARATOR.test(rawText)) {
      throw new Error('Invalid MHTML file: missing top-level MIME header section.');
    }
    throw new Error('No readable HTML document found in the MHTML archive.');
  }
  const { part: rootHtmlPart, inlinedHtml, cleanHtml: cleanBodyHtml } = root;
  const baseUrl = rootHtmlPart.location || rootLocation;
  let coverImage = scopesFor(rootHtmlPart).find((scope) => scope.coverImage)?.coverImage;

  // Extract metadata from the selected document before sanitization.
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

  // Split the sanitized document into chapters.
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
