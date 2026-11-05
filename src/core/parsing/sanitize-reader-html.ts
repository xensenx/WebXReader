import DOMPurify from 'dompurify';

export interface SanitizeReaderHtmlOptions {
  allowImages?: boolean;
  allowSvg?: boolean;
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

  const sanitizeFn =
    typeof (DOMPurify as any)?.sanitize === 'function'
      ? (DOMPurify as any).sanitize.bind(DOMPurify)
      : typeof DOMPurify === 'function' && typeof window !== 'undefined'
      ? (DOMPurify as any)(window).sanitize
      : null;

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

  if (sanitizeFn) {
    return sanitizeFn(content, {
      ALLOWED_TAGS: allowedTags,
      ALLOWED_ATTR: allowedAttrs,
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: forbidTags,
    });
  }

  // Fallback for non-browser/CLI environments without DOM window
  let fallback = content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/on\w+='[^']*'/gi, '');

  if (!allowImages) {
    fallback = fallback.replace(/<img\b[^>]*>/gi, '');
  }
  if (!allowSvg) {
    fallback = fallback.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');
  }
  return fallback;
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
