import { describe, expect, it } from 'vitest';
import { decodeHtmlDocument } from '../core/parsing/html-encoding';
import { parseHtml } from '../core/parsing/html-parser';

describe('HTML import', () => {
  it('keeps explicitly requested legacy decoding when a final character is incomplete', () => {
    expect(decodeHtmlDocument(Uint8Array.of(0x82, 0xa0, 0x82).buffer, 'shift_jis')).toBe('あ�');
  });

  it.each([
    ['<meta data-charset="windows-1252" title="charset=windows-1252">', 'é'],
    ['<meta content="text/html; charset=windows-1252">', 'é'],
    ['<meta content="text/html; charset=windows-1252" http-equiv="Content-Type">', 'Ã©'],
    ['<meta title="a > b" charset=windows-1252>', 'Ã©'],
    ['<?xml version="1.0" encoding="windows-1252"?>', 'Ã©'],
  ])('reads encoding declarations from real attributes in %s', (prefix, expected) => {
    const bytes = new TextEncoder().encode(prefix + '<p>é</p>');
    expect(decodeHtmlDocument(bytes.buffer)).toContain('<p>' + expected + '</p>');
  });

  it.each(['', '</body></html>'])('extracts a body with a greater-than sign in an attribute', (closing) => {
    const { chapters } = parseHtml('<html><head><title>Document</title></head><body title="a > b"><p>Body</p>' + closing);
    expect(chapters[0].content).toBe('<p>Body</p>');
  });

  it('rejects encoded whitespace but accepts structural content', () => {
    expect(() => parseHtml('<p>&nbsp;&#160;</p>')).toThrow(/No readable HTML body/);
    expect(parseHtml('<hr>').chapters[0].content).toBe('<hr>');
    expect(parseHtml('<table><tr><td></td></tr></table>').chapters[0].content).toContain('<table>');
  });
});
