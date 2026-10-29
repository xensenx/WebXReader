import { describe, it, expect } from 'vitest';
import {
  getFormat,
  getRequiredFormat,
  detectFormatFromFilename,
  getAllFormats,
  getAcceptAttribute,
  getFormatMimeType,
  isFixedLayout,
  formatSupportsFeature,
} from '../formats';

describe('Format Registry & System', () => {
  it('detects correct formats from filenames and extensions', () => {
    expect(detectFormatFromFilename('comic.cbz')?.id).toBe('cbz');
    expect(detectFormatFromFilename('DOCUMENT.PDF')?.id).toBe('pdf');
    expect(detectFormatFromFilename('book.epub')?.id).toBe('epub');
    expect(detectFormatFromFilename('notes.markdown')?.id).toBe('markdown');
    expect(detectFormatFromFilename('notes.md')?.id).toBe('markdown');
    expect(detectFormatFromFilename('page.html')?.id).toBe('html');
    expect(detectFormatFromFilename('page.htm')?.id).toBe('html');
    expect(detectFormatFromFilename('story.txt')?.id).toBe('txt');
    expect(detectFormatFromFilename('unknown.xyz')).toBeNull();
    expect(detectFormatFromFilename('no-extension')).toBeNull();
  });

  it('provides format definitions for all supported formats', () => {
    const formats = getAllFormats();
    expect(formats.length).toBe(6);

    const ids = formats.map((f) => f.id);
    expect(ids).toContain('epub');
    expect(ids).toContain('pdf');
    expect(ids).toContain('cbz');
    expect(ids).toContain('txt');
    expect(ids).toContain('markdown');
    expect(ids).toContain('html');

    const cbzDef = getRequiredFormat('cbz');
    expect(cbzDef.label).toBe('Comic Book Zip (CBZ)');
    expect(cbzDef.category).toBe('fixed-layout');
    expect(cbzDef.capabilities.readingDirection).toBe(true);
    expect(cbzDef.capabilities.pageGap).toBe(true);
    expect(cbzDef.capabilities.fitMode).toBe(true);
  });

  it('accurately identifies fixed layout formats', () => {
    expect(isFixedLayout('cbz')).toBe(true);
    expect(isFixedLayout('pdf')).toBe(true);
    expect(isFixedLayout('epub')).toBe(false);
    expect(isFixedLayout('txt')).toBe(false);
    expect(isFixedLayout('markdown')).toBe(false);
    expect(isFixedLayout('html')).toBe(false);
    expect(isFixedLayout(undefined)).toBe(false);
  });

  it('correctly checks format capabilities', () => {
    expect(formatSupportsFeature('cbz', 'readingDirection')).toBe(true);
    expect(formatSupportsFeature('pdf', 'readingDirection')).toBe(false);
    expect(formatSupportsFeature('epub', 'customTypography')).toBe(true);
    expect(formatSupportsFeature('cbz', 'customTypography')).toBe(false);
    expect(formatSupportsFeature('txt', 'continuousScroll')).toBe(true);
    expect(formatSupportsFeature('pdf', 'doubleSided')).toBe(false);
    expect(formatSupportsFeature('txt', 'doubleSided')).toBe(true);
    expect(formatSupportsFeature('epub', 'doubleSided')).toBe(false);
  });

  it('generates consistent accept attribute and MIME types', () => {
    const accept = getAcceptAttribute();
    expect(accept).toContain('.cbz');
    expect(accept).toContain('.pdf');
    expect(accept).toContain('.epub');
    expect(accept).toContain('.txt');
    expect(accept).toContain('.md');
    expect(accept).toContain('.markdown');
    expect(accept).toContain('.html');
    expect(accept).toContain('.htm');

    expect(getFormatMimeType('cbz')).toBe('application/vnd.comicbook+zip');
    expect(getFormatMimeType('pdf')).toBe('application/pdf');
    expect(getFormatMimeType('epub')).toBe('application/epub+zip');
    expect(getFormatMimeType('txt')).toBe('text/plain');
    expect(getFormatMimeType('markdown')).toBe('text/markdown');
    expect(getFormatMimeType('html')).toBe('text/html');
  });

  it('handles unknown formats gracefully', () => {
    expect(getFormat('xyz' as any)).toBeUndefined();
    expect(() => getRequiredFormat('xyz' as any)).toThrow();
  });
});
