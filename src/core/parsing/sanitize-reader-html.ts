import DOMPurify from 'dompurify';
import { ident, string, tokenize, tokenTypes, url } from 'css-tree';

// Match the URL parser's removal of embedded ASCII tab/newline characters.
export const normalizeReaderUrl = (value: string): string =>
  value.replace(/[\t\n\r]/g, '').trim().replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');

export interface SanitizeReaderHtmlOptions {
  allowImages?: boolean;
  allowSvg?: boolean;
}

let purifyInstance: any = null;
let isHookAttached = false;

function getPurifyInstance(): any {
  if (!purifyInstance) {
    if (typeof (DOMPurify as any)?.sanitize === 'function') {
      purifyInstance = DOMPurify;
    } else if (typeof DOMPurify === 'function' && typeof window !== 'undefined') {
      purifyInstance = (DOMPurify as any)(window);
    }
    if (purifyInstance && !isHookAttached && typeof purifyInstance.addHook === 'function') {
      purifyInstance.addHook('uponSanitizeAttribute', (node: any, data: any) => {
        const tag = node.tagName && String(node.tagName).toLowerCase();
        const attr = data.attrName && String(data.attrName).toLowerCase();
        // Disallow external network URLs on embedded media/images to enforce local-first privacy (F04)
        if (
          (tag === 'img' || tag === 'image') &&
          (attr === 'src' || attr === 'href' || attr === 'xlink:href' || attr === 'data-src')
        ) {
          const val = normalizeReaderUrl(data.attrValue || '');
          if (/^(?:https?:|\/\/)/i.test(val)) {
            data.keepAttr = false;
          }
        }
      });
      isHookAttached = true;
    }
  }
  return purifyInstance;
}

/**
 * Sanitizes book HTML before it is persisted or inserted into the reader DOM.
 * Keep this allowlist shared by HTML/Markdown imports, backup restoration, and
 * the reader rendering boundary so stored content cannot become trusted later.
 *
 * @param content - Untrusted HTML string or unknown content
 * @param options - Optional configuration to permit safe images and inline SVGs
 * @returns Sanitized, safe HTML string
 */
export function sanitizeReaderHtml(
  content: unknown,
  options?: SanitizeReaderHtmlOptions
): string {
  if (typeof content !== 'string') return '';

  const purify = getPurifyInstance();

  const allowImages = Boolean(options?.allowImages);
  const allowSvg = Boolean(options?.allowSvg);

  const allowedTags = [
    'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'pre', 'code',
    'a',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'hr', 'div', 'span', 'sup', 'sub',
    'figure', 'figcaption', 'section', 'article',
  ];

  const allowedAttrs = ['href', 'alt', 'title', 'class', 'id', 'target', 'rel'];
  const forbidTags = ['script', 'style', 'iframe', 'object', 'embed', 'video', 'audio', 'source'];

  if (allowImages) {
    allowedTags.push('img');
    allowedAttrs.push('src', 'width', 'height', 'loading', 'data-src');
  } else {
    forbidTags.push('img');
  }

  if (allowSvg) {
    allowedTags.push(
      'svg', 'image', 'g', 'path', 'circle', 'rect', 'line', 'polyline',
      'polygon', 'ellipse', 'defs', 'use', 'clippath', 'pattern', 'text', 'tspan'
    );
    allowedAttrs.push(
      'viewBox', 'xmlns', 'xmlns:xlink', 'xlink:href', 'fill', 'stroke',
      'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'transform',
      'preserveAspectRatio', 'x', 'y', 'width', 'height', 'opacity'
    );
  }

  if (purify && typeof purify.sanitize === 'function') {
    return purify.sanitize(content, {
      ALLOWED_TAGS: allowedTags,
      ALLOWED_ATTR: allowedAttrs,
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: forbidTags,
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|blob|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    });
  }

  // Fail closed: regex filtering is not safe sanitization.
  // If DOMPurify is unavailable the caller must not trust the output.
  console.error(
    'sanitizeReaderHtml: DOMPurify is unavailable — returning empty string for safety.',
  );
  return '';
}

/**
 * Sanitizes untrusted CSS extracted from an EPUB/book document so it can be
 * safely placed inside a `<style>` element in the main application DOM.
 *
 * The critical threat is a `</style>` sequence (or case-variants / HTML-entity-
 * decoded equivalents) that terminates the style element and allows arbitrary
 * HTML injection. This function:
 *
 * 1. Strips any literal `</style` substring (case-insensitive).
 * 2. Removes `@import` rules that could load external stylesheets.
 * 3. Removes `url(...)` values that reference external `http:`, `https:`, or `//` resources
 *    (privacy leak vector — F04). `data:`, `blob:`, and bare fragment refs are kept.
 * 4. Removes `expression(...)` (legacy IE CSS expression attack surface).
 * 5. Removes `-moz-binding` (legacy Firefox XBL binding attack surface).
 *
 * This is NOT a full CSS parser; it is a defence-in-depth layer. The primary
 * protection is to never interpolate the output into an `innerHTML` string —
 * always assign it via `element.textContent` on a `<style>` element created
 * through the DOM API.
 *
 * @param cssText - Raw CSS text from an untrusted book document
 * @returns Sanitized CSS string safe for `style.textContent` assignment
 */
export function sanitizeBookCss(cssText: unknown): string {
  if (typeof cssText !== 'string' || !cssText.trim()) return '';

  let css = cssText;

  // 1. Remove any sequence that could close a <style> element or HTML comments.
  css = css.replace(/<\s*\/?\s*style/gi, '/* removed */');
  css = css.replace(/<\s*\/?[a-zA-Z]/g, '/* removed */');
  css = css.replace(/<!--/g, '/*').replace(/--\s*!?\s*>/g, '*/');

  // 2. Strip all @import rules (external stylesheet loading).
  css = css.replace(/@import\s+[^;{}]+;?/gi, '/* import-rule removed */');

  // 3. Inspect CSS tokens so escaped names and resource values are decoded.
  // Apply edits backwards to preserve the spelling of all safe CSS.
  const edits: { start: number; end: number; value: string }[] = [];
  const functions: { name: string; start: number; contentStart: number }[] = [];
  const isExternal = (value: string) => /^(?:https?:|\/\/)/i.test(normalizeReaderUrl(value));
  tokenize(css, (type, start, end) => {
    const token = css.slice(start, end);
    const parent = functions.at(-1);
    if (type === tokenTypes.Url) {
      if (isExternal(url.decode(token))) edits.push({ start, end, value: '/* url removed */' });
    } else if (type === tokenTypes.Function || type === tokenTypes.LeftParenthesis) {
      functions.push({
        name: type === tokenTypes.Function ? ident.decode(token.slice(0, -1)).toLowerCase() : '',
        start,
        contentStart: end,
      });
    } else if (type === tokenTypes.RightParenthesis) {
      const fn = functions.pop();
      if (fn?.name === 'url') {
        const content = css.slice(fn.contentStart, start).trim();
        const decoded = content.startsWith('"') || content.startsWith("'")
          ? string.decode(content)
          : url.decode(`url(${content})`);
        if (isExternal(decoded)) edits.push({ start: fn.start, end, value: '/* url removed */' });
      }
    } else if (type === tokenTypes.String && parent &&
      /^(?:image|(?:-webkit-)?image-set)$/.test(parent.name) && isExternal(string.decode(token))) {
      // A bare identifier is not an image source: invalidate the declaration,
      // keeping image()/image-set() in place rather than exposing its strings.
      edits.push({ start, end, value: 'invalid-external-image' });
    }
  });
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    css = css.slice(0, edit.start) + edit.value + css.slice(edit.end);
  }

  // 4. Remove expression() (legacy IE).
  css = css.replace(/expression\s*\(/gi, '/* expression removed */(');

  // 5. Remove -moz-binding (legacy Firefox XBL).
  css = css.replace(/-moz-binding\s*:/gi, '/* moz-binding removed */:');

  return css;
}

/**
 * Escapes special HTML characters in strings for safe insertion into markup text contexts.
 *
 * @param str - Input string
 * @returns Escaped text string safe against HTML tag injection
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escapes special characters in strings for safe insertion into HTML attribute values.
 *
 * @param str - Input string
 * @returns Escaped attribute string safe against quote breakout
 */
export function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
