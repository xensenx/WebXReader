import DOMPurify from 'dompurify';

/**
 * Sanitizes book HTML before it is persisted or inserted into the reader DOM.
 * Keep this allowlist shared by HTML/Markdown imports, backup restoration, and
 * the reader rendering boundary so stored content cannot become trusted later.
 */
export function sanitizeReaderHtml(content: unknown): string {
  if (typeof content !== 'string') return '';

  return DOMPurify.sanitize(content, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li',
      'blockquote', 'pre', 'code',
      'a',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'hr', 'div', 'span', 'sup', 'sub',
      'figure', 'figcaption', 'section', 'article',
    ],
    ALLOWED_ATTR: ['href', 'alt', 'title', 'class', 'id', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'img', 'iframe', 'object', 'embed', 'video', 'audio', 'source'],
  });
}
