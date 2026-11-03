import { describe, it, expect } from 'vitest';
import {
  buildEpubThemeRules,
  buildEpubThemeCss,
  getEpubSheetColors,
  applyTypographyToDocument,
} from '../formats/engines/EpubReader';
import type { EffectiveReaderSettings } from '../hooks/useReaderSettings';

describe('EPUB Reader Typography Enhancements', () => {
  const baseSettings: EffectiveReaderSettings = {
    fontFamily: 'Georgia, serif',
    fontSize: 18,
    lineHeight: 1.7,
    paragraphSpacing: 1.0,
    letterSpacing: 0,
    wordSpacing: 0,
    textAlign: 'left',
    textIndent: 0,
    maxContentWidth: 794,
    contentMargin: 24,
    readingMode: 'scroll',
    theme: 'light',
    readerSheetColor: 'paper',
    expandContent: false,
  };

  const colors = getEpubSheetColors('paper');

  describe('getEpubSheetColors', () => {
    it('returns paper colors by default', () => {
      const paper = getEpubSheetColors('paper');
      expect(paper.sheetBg).toBe('#ffffff');
      expect(paper.sheetFg).toBe('#1a1a1a');
      expect(paper.sheetBorder).toBe('#e2e8f0');
      expect(paper.sheetLink).toBe('#2563eb');
    });

    it('returns archive gold colors', () => {
      const archive = getEpubSheetColors('archive');
      expect(archive.sheetBg).toBe('#f6eedb');
      expect(archive.sheetFg).toBe('#3d3226');
      expect(archive.sheetBorder).toBe('#e7dbbe');
      expect(archive.sheetLink).toBe('#854d0e');
    });

    it('returns dark mode colors', () => {
      const dark = getEpubSheetColors('dark');
      expect(dark.sheetBg).toBe('#252528');
      expect(dark.sheetFg).toBe('#e4e4e7');
      expect(dark.sheetBorder).toBe('#38383c');
      expect(dark.sheetLink).toBe('#60a5fa');
    });
  });

  describe('buildEpubThemeRules', () => {
    it('sets font-family, line-height, and paragraph spacing with !important across body and text elements', () => {
      const rules = buildEpubThemeRules(baseSettings, colors, 18, 24, 0, 0);

      // Body typography
      expect(rules.body['font-family']).toBe('Georgia, serif !important');
      expect(rules.body['line-height']).toBe('1.7 !important');
      expect(rules.body['font-size']).toBe('18px !important');
      expect(rules.body['text-align']).toBe('left !important');
      expect(rules.body['letter-spacing']).toBe('0px !important');
      expect(rules.body['word-spacing']).toBe('0px !important');

      // Paragraph typography: explicitly set on <p> so author CSS targeting 'p' does not override body
      expect(rules.p['font-family']).toBe('Georgia, serif !important');
      expect(rules.p['line-height']).toBe('1.7 !important');
      expect(rules.p['margin-top']).toBe('0 !important');
      expect(rules.p['margin-bottom']).toBe('1em !important');
      expect(rules.p['text-indent']).toBe('0em !important');
      expect(rules.p['text-align']).toBe('left !important');

      // Divs and block containers
      expect(rules['div, article, section']['font-family']).toBe('Georgia, serif !important');
      expect(rules['div, article, section']['line-height']).toBe('1.7 !important');
      expect(rules['div:not([data-epub-image-view]):not(.epub-image-view)']['text-align']).toBe('left !important');

      // Lists, blockquotes
      expect(rules['li, blockquote, dd, dt']['font-family']).toBe('Georgia, serif !important');
      expect(rules['li, blockquote, dd, dt']['line-height']).toBe('1.7 !important');

      // Headings get matching font family
      expect(rules['h1, h2, h3, h4, h5, h6']['font-family']).toBe('Georgia, serif !important');

      // Spans inherit font-family and line-height so nested spans do not break typography
      expect(rules['span:not([class*="icon"]):not([class*="math"])']['font-family']).toBe('inherit !important');
      expect(rules['span:not([class*="icon"]):not([class*="math"])']['line-height']).toBe('inherit !important');
    });

    it('dynamically adapts to updated font family, line spacing, and paragraph spacing', () => {
      const customSettings: EffectiveReaderSettings = {
        ...baseSettings,
        fontFamily: "'Times New Roman', Times, serif",
        lineHeight: 2.2,
        paragraphSpacing: 1.5,
        textAlign: 'justify',
        textIndent: 1.5,
        fontSize: 22,
      };

      const rules = buildEpubThemeRules(customSettings, colors, 22, 24, 0, 0);

      // Font Family
      expect(rules.body['font-family']).toBe("'Times New Roman', Times, serif !important");
      expect(rules.p['font-family']).toBe("'Times New Roman', Times, serif !important");
      expect(rules['div, article, section']['font-family']).toBe("'Times New Roman', Times, serif !important");

      // Line Spacing
      expect(rules.body['line-height']).toBe('2.2 !important');
      expect(rules.p['line-height']).toBe('2.2 !important');
      expect(rules['div, article, section']['line-height']).toBe('2.2 !important');
      expect(rules['li, blockquote, dd, dt']['line-height']).toBe('2.2 !important');

      // Paragraph Spacing & Indent
      expect(rules.p['margin-top']).toBe('0 !important');
      expect(rules.p['margin-bottom']).toBe('1.5em !important');
      expect(rules.p['text-indent']).toBe('1.5em !important');

      // Text Alignment
      expect(rules.body['text-align']).toBe('justify !important');
      expect(rules.p['text-align']).toBe('justify !important');
      expect(rules['div:not([data-epub-image-view]):not(.epub-image-view)']['text-align']).toBe('justify !important');
    });
  });

  describe('buildEpubThemeCss', () => {
    it('serializes full CSS string containing selector blocks and !important declarations', () => {
      const css = buildEpubThemeCss(baseSettings, colors, 18, 24, 0, 0);

      expect(css).toContain('p {');
      expect(css).toContain('font-family: Georgia, serif !important;');
      expect(css).toContain('line-height: 1.7 !important;');
      expect(css).toContain('margin-top: 0 !important;');
      expect(css).toContain('margin-bottom: 1em !important;');
      expect(css).toContain('text-indent: 0em !important;');
      expect(css).toContain('text-align: left !important;');
      expect(css).toContain('span:not([class*="icon"]):not([class*="math"]) {');
      expect(css).toContain('font-family: inherit !important;');
      expect(css).toContain('line-height: inherit !important;');
    });
  });

  describe('applyTypographyToDocument', () => {
    it('injects or updates the style tag with generated CSS in document head', () => {
      const doc = document.implementation.createHTMLDocument('EPUB Chapter');
      const css = 'p { font-family: "Consolas" !important; line-height: 2 !important; }';

      applyTypographyToDocument(doc, css);

      const styleEl = doc.getElementById('webx-epub-typography') as HTMLStyleElement | null;
      expect(styleEl).not.toBeNull();
      expect(styleEl?.textContent).toBe(css);

      // Re-applying updates existing style tag
      const updatedCss = 'p { font-family: "Georgia" !important; line-height: 1.5 !important; }';
      applyTypographyToDocument(doc, updatedCss);
      expect(styleEl?.textContent).toBe(updatedCss);
    });

    it('clears conflicting author inline style properties on <p> elements', () => {
      const doc = document.implementation.createHTMLDocument('EPUB Chapter');
      doc.body.innerHTML = `
        <div class="chapter">
          <p id="p1" style="font-family: BookAntiqua; line-height: 1.1; margin-top: 2em; margin-bottom: 0px; text-indent: 20px;">
            Chapter text with author inline styles.
          </p>
          <p id="p2">Normal paragraph.</p>
        </div>
      `;

      const p1 = doc.getElementById('p1') as HTMLElement;
      expect(p1.style.fontFamily).toContain('BookAntiqua');
      expect(p1.style.lineHeight).toBe('1.1');
      expect(p1.style.marginTop).toBe('2em');

      applyTypographyToDocument(doc, '/* test */');

      // Author inline typography overrides are cleared so reader settings take effect
      expect(p1.style.fontFamily).toBe('');
      expect(p1.style.lineHeight).toBe('');
      expect(p1.style.marginTop).toBe('');
      expect(p1.style.marginBottom).toBe('');
      expect(p1.style.textIndent).toBe('');
    });

    it('leaves standalone image sections untouched', () => {
      const doc = document.implementation.createHTMLDocument('Cover Page');
      doc.body.classList.add('epub-image-only-section');
      doc.body.innerHTML = `
        <p id="cover-caption" style="font-family: CoverFont; margin-top: 10px;">Cover Title</p>
      `;

      const p = doc.getElementById('cover-caption') as HTMLElement;
      applyTypographyToDocument(doc, '/* test */');

      // Image only section body is not stripped
      expect(p.style.fontFamily).toContain('CoverFont');
      expect(p.style.marginTop).toBe('10px');
    });
  });
});
