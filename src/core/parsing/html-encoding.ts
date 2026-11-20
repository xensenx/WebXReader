/** Decode local HTML using its BOM or in-document encoding declaration. */
export function decodeHtmlDocument(buffer: ArrayBuffer, encoding?: string): string {
  if (encoding) return new TextDecoder(encoding, { fatal: true }).decode(buffer);

  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes);

  const prefix = new TextDecoder('windows-1252').decode(bytes.subarray(0, 4096));
  const declarations = prefix.replace(/<!--[\s\S]*?-->/g, '').match(/<meta\b[^>]*>|^\s*<\?xml\b[^>]*\?>/gi) ?? [];
  for (const declaration of declarations) {
    const label = /\b(?:charset|encoding)\s*=\s*["']?([^\s;"'/>]+)/i.exec(declaration)?.[1];
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
