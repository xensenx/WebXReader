/** Decode local HTML using its BOM or in-document encoding declaration. */
export function decodeHtmlDocument(buffer: ArrayBuffer, encoding?: string): string {
  if (encoding) return new TextDecoder(encoding).decode(buffer);

  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes);

  const prefix = new TextDecoder('windows-1252').decode(bytes.subarray(0, 4096));
  const xml = /^\s*<\?xml\s+([^>]*?)\?>/i.exec(prefix);
  const xmlEncoding = xml && /\sencoding\s*=\s*(["'])([^"']+)\1/i.exec(` ${xml[1]}`)?.[2];
  const template = document.createElement('template');
  template.innerHTML = prefix;
  const metaEncodings = Array.from(template.content.querySelectorAll('meta'), (meta) => {
    if (meta.hasAttribute('charset')) return meta.getAttribute('charset');
    if (meta.getAttribute('http-equiv')?.trim().toLowerCase() !== 'content-type') return null;
    const content = meta.getAttribute('content') ?? '';
    return /(?:^|;)\s*charset\s*=\s*["']?([^\s;"'/>]+)/i.exec(content)?.[1];
  });
  for (const label of [xmlEncoding, ...metaEncodings]) {
    if (!label) continue;
    try {
      const decoder = new TextDecoder(label, { fatal: true });
      if (!decoder.encoding.startsWith('utf-16')) return decoder.decode(bytes);
    } catch {
      // A stale or unsupported declaration can still be followed by valid UTF-8.
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
