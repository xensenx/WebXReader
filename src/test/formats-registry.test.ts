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
    expect(detectFormatFromFilename('comic.cbr')?.id).toBe('cbr');
    expect(detectFormatFromFilename('COMIC.CBR')?.id).toBe('cbr');
    expect(detectFormatFromFilename('archive.rar')?.id).toBe('rar');
    expect(detectFormatFromFilename('ARCHIVE.RAR')?.id).toBe('rar');
    expect(detectFormatFromFilename('comic.cb7')?.id).toBe('cb7');
    expect(detectFormatFromFilename('COMIC.CB7')?.id).toBe('cb7');
    expect(detectFormatFromFilename('archive.7z')?.id).toBe('cb7');
    expect(detectFormatFromFilename('DOCUMENT.PDF')?.id).toBe('pdf');
    expect(detectFormatFromFilename('book.epub')?.id).toBe('epub');
    expect(detectFormatFromFilename('notes.markdown')?.id).toBe('markdown');
    expect(detectFormatFromFilename('notes.md')?.id).toBe('markdown');
    expect(detectFormatFromFilename('page.html')?.id).toBe('html');
    expect(detectFormatFromFilename('page.htm')?.id).toBe('html');
    expect(detectFormatFromFilename('story.txt')?.id).toBe('txt');
    expect(detectFormatFromFilename('document.rtf')?.id).toBe('rtf');
    expect(detectFormatFromFilename('DOCUMENT.RTF')?.id).toBe('rtf');
    expect(detectFormatFromFilename('novel.fb2')?.id).toBe('fb2');
    expect(detectFormatFromFilename('NOVEL.FB2')?.id).toBe('fb2');
    expect(detectFormatFromFilename('archive.fb2.zip')?.id).toBe('fb2');
    expect(detectFormatFromFilename('novel.mobi')?.id).toBe('mobi');
    expect(detectFormatFromFilename('NOVEL.MOBI')?.id).toBe('mobi');
    expect(detectFormatFromFilename('book.prc')?.id).toBe('mobi');
    expect(detectFormatFromFilename('book.azw')?.id).toBe('mobi');
    expect(detectFormatFromFilename('scarlet.azw3')?.id).toBe('azw3');
    expect(detectFormatFromFilename('SCARLET.AZW3')?.id).toBe('azw3');
    expect(detectFormatFromFilename('novel.kf8')?.id).toBe('azw3');
    expect(detectFormatFromFilename('document.docx')?.id).toBe('docx');
    expect(detectFormatFromFilename('DOCUMENT.DOCX')?.id).toBe('docx');
    expect(detectFormatFromFilename('legacy.doc')?.id).toBe('doc');
    expect(detectFormatFromFilename('LEGACY.DOC')?.id).toBe('doc');
    expect(detectFormatFromFilename('document.djvu')?.id).toBe('djvu');
    expect(detectFormatFromFilename('DOCUMENT.DJVU')?.id).toBe('djvu');
    expect(detectFormatFromFilename('archive.djv')?.id).toBe('djvu');
    expect(detectFormatFromFilename('ARCHIVE.DJV')?.id).toBe('djvu');
    expect(detectFormatFromFilename('article.mht')?.id).toBe('mht');
    expect(detectFormatFromFilename('ARTICLE.MHT')?.id).toBe('mht');
    expect(detectFormatFromFilename('archive.mhtml')?.id).toBe('mht');
    expect(detectFormatFromFilename('ARCHIVE.MHTML')?.id).toBe('mht');
    expect(detectFormatFromFilename('archive.zip')?.id).toBe('zip');
    expect(detectFormatFromFilename('ARCHIVE.ZIP')?.id).toBe('zip');
    expect(detectFormatFromFilename('unknown.xyz')).toBeNull();
    expect(detectFormatFromFilename('no-extension')).toBeNull();
  });

  it('provides format definitions for all supported formats', () => {
    const formats = getAllFormats();
    expect(formats.length).toBe(18);

    const ids = formats.map((f) => f.id);
    expect(ids).toContain('epub');
    expect(ids).toContain('pdf');
    expect(ids).toContain('cbz');
    expect(ids).toContain('cbr');
    expect(ids).toContain('cb7');
    expect(ids).toContain('txt');
    expect(ids).toContain('markdown');
    expect(ids).toContain('html');
    expect(ids).toContain('rtf');
    expect(ids).toContain('fb2');
    expect(ids).toContain('mobi');
    expect(ids).toContain('azw3');
    expect(ids).toContain('docx');
    expect(ids).toContain('doc');
    expect(ids).toContain('djvu');
    expect(ids).toContain('mht');
    expect(ids).toContain('zip');
    expect(ids).toContain('rar');

    const cbzDef = getRequiredFormat('cbz');
    expect(cbzDef.label).toBe('Comic Book Zip (CBZ)');
    expect(cbzDef.category).toBe('fixed-layout');
    expect(cbzDef.capabilities.readingDirection).toBe(true);
    expect(cbzDef.capabilities.pageGap).toBe(true);
    expect(cbzDef.capabilities.fitMode).toBe(true);

    const cbrDef = getRequiredFormat('cbr');
    expect(cbrDef.label).toBe('Comic Book RAR (CBR)');
    expect(cbrDef.category).toBe('fixed-layout');
    expect(cbrDef.capabilities.readingDirection).toBe(true);
    expect(cbrDef.capabilities.pageGap).toBe(true);
    expect(cbrDef.capabilities.fitMode).toBe(true);

    const cb7Def = getRequiredFormat('cb7');
    expect(cb7Def.label).toBe('Comic Book 7z (CB7)');
    expect(cb7Def.category).toBe('fixed-layout');
    expect(cb7Def.capabilities.readingDirection).toBe(true);
    expect(cb7Def.capabilities.pageGap).toBe(true);
    expect(cb7Def.capabilities.fitMode).toBe(true);

    const rtfDef = getRequiredFormat('rtf');
    expect(rtfDef.label).toBe('Rich Text Format');
    expect(rtfDef.category).toBe('reflowable');
    expect(rtfDef.capabilities.continuousScroll).toBe(true);
    expect(rtfDef.capabilities.customTypography).toBe(true);

    const fb2Def = getRequiredFormat('fb2');
    expect(fb2Def.label).toBe('FictionBook (FB2)');
    expect(fb2Def.category).toBe('reflowable');
    expect(fb2Def.capabilities.continuousScroll).toBe(true);
    expect(fb2Def.capabilities.customTypography).toBe(true);

    const mobiDef = getRequiredFormat('mobi');
    expect(mobiDef.label).toBe('Mobipocket / Kindle (MOBI)');
    expect(mobiDef.category).toBe('reflowable');
    expect(mobiDef.capabilities.continuousScroll).toBe(true);
    expect(mobiDef.capabilities.customTypography).toBe(true);

    const azw3Def = getRequiredFormat('azw3');
    expect(azw3Def.label).toBe('Kindle Format 8 (AZW3)');
    expect(azw3Def.category).toBe('reflowable');
    expect(azw3Def.capabilities.continuousScroll).toBe(true);
    expect(azw3Def.capabilities.customTypography).toBe(true);

    const mhtDef = getRequiredFormat('mht');
    expect(mhtDef.label).toBe('MHTML Web Archive');
    expect(mhtDef.category).toBe('reflowable');
    expect(mhtDef.capabilities.continuousScroll).toBe(true);
    expect(mhtDef.capabilities.customTypography).toBe(true);

    const zipDef = getRequiredFormat('zip');
    expect(zipDef.label).toBe('ZIP Archive');
    expect(zipDef.category).toBe('fixed-layout');
    expect(zipDef.capabilities.continuousScroll).toBe(true);

    const rarDef = getRequiredFormat('rar');
    expect(rarDef.label).toBe('RAR Archive');
    expect(rarDef.category).toBe('fixed-layout');
    expect(rarDef.capabilities.continuousScroll).toBe(true);
  });

  it('accurately identifies fixed layout formats', () => {
    expect(isFixedLayout('cbz')).toBe(true);
    expect(isFixedLayout('cbr')).toBe(true);
    expect(isFixedLayout('cb7')).toBe(true);
    expect(isFixedLayout('djvu')).toBe(true);
    expect(isFixedLayout('pdf')).toBe(true);
    expect(isFixedLayout('zip')).toBe(true);
    expect(isFixedLayout('rar')).toBe(true);
    expect(isFixedLayout('epub')).toBe(false);
    expect(isFixedLayout('txt')).toBe(false);
    expect(isFixedLayout('markdown')).toBe(false);
    expect(isFixedLayout('html')).toBe(false);
    expect(isFixedLayout('rtf')).toBe(false);
    expect(isFixedLayout('fb2')).toBe(false);
    expect(isFixedLayout('mobi')).toBe(false);
    expect(isFixedLayout('azw3')).toBe(false);
    expect(isFixedLayout('docx')).toBe(false);
    expect(isFixedLayout('doc')).toBe(false);
    expect(isFixedLayout('mht')).toBe(false);
    expect(isFixedLayout(undefined)).toBe(false);
  });

  it('correctly checks format capabilities', () => {
    expect(formatSupportsFeature('cbz', 'readingDirection')).toBe(true);
    expect(formatSupportsFeature('cbr', 'readingDirection')).toBe(true);
    expect(formatSupportsFeature('cb7', 'readingDirection')).toBe(true);
    expect(formatSupportsFeature('pdf', 'readingDirection')).toBe(false);
    expect(formatSupportsFeature('epub', 'customTypography')).toBe(true);
    expect(formatSupportsFeature('cbz', 'customTypography')).toBe(false);
    expect(formatSupportsFeature('cbr', 'customTypography')).toBe(false);
    expect(formatSupportsFeature('cb7', 'customTypography')).toBe(false);
    expect(formatSupportsFeature('txt', 'continuousScroll')).toBe(true);
    expect(formatSupportsFeature('rtf', 'continuousScroll')).toBe(true);
    expect(formatSupportsFeature('fb2', 'continuousScroll')).toBe(true);
    expect(formatSupportsFeature('mobi', 'continuousScroll')).toBe(true);
    expect(formatSupportsFeature('azw3', 'continuousScroll')).toBe(true);
    expect(formatSupportsFeature('docx', 'continuousScroll')).toBe(true);
    expect(formatSupportsFeature('doc', 'continuousScroll')).toBe(true);
    expect(formatSupportsFeature('djvu', 'continuousScroll')).toBe(true);
    expect(formatSupportsFeature('pdf', 'doubleSided')).toBe(false);
    expect(formatSupportsFeature('txt', 'doubleSided')).toBe(true);
    expect(formatSupportsFeature('rtf', 'doubleSided')).toBe(true);
    expect(formatSupportsFeature('fb2', 'doubleSided')).toBe(true);
    expect(formatSupportsFeature('mobi', 'doubleSided')).toBe(true);
    expect(formatSupportsFeature('azw3', 'doubleSided')).toBe(true);
    expect(formatSupportsFeature('epub', 'doubleSided')).toBe(false);
  });

  it('generates consistent accept attribute and MIME types', () => {
    const accept = getAcceptAttribute();
    expect(accept).toContain('.cbz');
    expect(accept).toContain('.cbr');
    expect(accept).toContain('.rar');
    expect(accept).toContain('.cb7');
    expect(accept).toContain('.7z');
    expect(accept).toContain('.pdf');
    expect(accept).toContain('.epub');
    expect(accept).toContain('.txt');
    expect(accept).toContain('.md');
    expect(accept).toContain('.markdown');
    expect(accept).toContain('.html');
    expect(accept).toContain('.htm');
    expect(accept).toContain('.rtf');
    expect(accept).toContain('.fb2');
    expect(accept).toContain('.mobi');
    expect(accept).toContain('.prc');
    expect(accept).toContain('.azw');
    expect(accept).toContain('.azw3');
    expect(accept).toContain('.kf8');
    expect(accept).toContain('.docx');
    expect(accept).toContain('.doc');
    expect(accept).toContain('.djvu');
    expect(accept).toContain('.djv');

    expect(getFormatMimeType('cbz')).toBe('application/vnd.comicbook+zip');
    expect(getFormatMimeType('cbr')).toBe('application/vnd.comicbook-rar');
    expect(getFormatMimeType('cb7')).toBe('application/x-cb7');
    expect(getFormatMimeType('pdf')).toBe('application/pdf');
    expect(getFormatMimeType('epub')).toBe('application/epub+zip');
    expect(getFormatMimeType('txt')).toBe('text/plain');
    expect(getFormatMimeType('markdown')).toBe('text/markdown');
    expect(getFormatMimeType('html')).toBe('text/html');
    expect(getFormatMimeType('rtf')).toBe('application/rtf');
    expect(getFormatMimeType('fb2')).toBe('application/x-fictionbook+xml');
    expect(getFormatMimeType('mobi')).toBe('application/x-mobipocket-ebook');
    expect(getFormatMimeType('azw3')).toBe('application/vnd.amazon.mobi8-ebook');
    expect(getFormatMimeType('docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(getFormatMimeType('doc')).toBe('application/msword');
    expect(getFormatMimeType('djvu')).toBe('image/vnd.djvu');
  });

  it('handles unknown formats gracefully', () => {
    expect(getFormat('xyz' as any)).toBeUndefined();
    expect(() => getRequiredFormat('xyz' as any)).toThrow();
  });
});
