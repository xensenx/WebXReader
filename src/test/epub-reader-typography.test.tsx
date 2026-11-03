import { describe, it, expect, vi } from 'vitest';
import {
  buildEpubThemeRules,
  buildEpubThemeCss,
  getEpubSheetColors,
  applyTypographyToDocument,
  applyWithScrollAnchor,
  type ScrollAnchorManager,
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

      // Universal paragraph spacing selectors to override publisher classes and adjacent siblings
      const universalSelector = 'html body p, html body p[class], html body [class*="calibre"] p, html body div[class*="para"], html body div[class*="paragraph"], html body div.paragraph, html body div.p, html body article p, html body section p';
      expect(rules[universalSelector]['margin-top']).toBe('0 !important');
      expect(rules[universalSelector]['margin-bottom']).toBe('1em !important');

      const siblingSelector = 'p + p, p + div, div + p, html body p + p, html body p + div, html body div + p, html body p[class] + p[class], html body div[class*="para"] + div[class*="para"]';
      expect(rules[siblingSelector]['margin-top']).toBe('0 !important');
      expect(rules[siblingSelector]['margin-bottom']).toBe('1em !important');

      const divParaSelector = 'div.paragraph, div[class*="para"], div[class*="paragraph"], div.p';
      expect(rules[divParaSelector]['margin-bottom']).toBe('1em !important');

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
      expect(css).toContain('html body p');
      expect(css).toContain('p + p');
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

    it('clears conflicting author inline style properties including margin shorthand on paragraphs and divs', () => {
      const doc = document.implementation.createHTMLDocument('EPUB Chapter');
      doc.body.innerHTML = `
        <div class="chapter">
          <p id="p1" style="font-family: BookAntiqua; line-height: 1.1; margin: 0; text-indent: 20px;">
            Chapter text with author inline margin shorthand.
          </p>
          <div id="para1" class="paragraph" style="margin-top: 2em; margin-bottom: 0px; font-family: Arial;">
            Div-based paragraph.
          </div>
          <p id="p2">Normal paragraph.</p>
        </div>
      `;

      const p1 = doc.getElementById('p1') as HTMLElement;
      const para1 = doc.getElementById('para1') as HTMLElement;

      expect(p1.style.fontFamily).toContain('BookAntiqua');
      expect(p1.style.lineHeight).toBe('1.1');
      expect(p1.style.margin).toBe('0px');

      applyTypographyToDocument(doc, '/* test */');

      // Author inline typography and margin overrides are cleared so reader settings take effect
      expect(p1.style.fontFamily).toBe('');
      expect(p1.style.lineHeight).toBe('');
      expect(p1.style.margin).toBe('');
      expect(p1.style.marginTop).toBe('');
      expect(p1.style.marginBottom).toBe('');
      expect(p1.style.textIndent).toBe('');

      expect(para1.style.fontFamily).toBe('');
      expect(para1.style.marginTop).toBe('');
      expect(para1.style.marginBottom).toBe('');
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

  describe('applyWithScrollAnchor', () => {
    it('compensates scroll drift when content expands so reading position is maintained', () => {
      // Mock scroll container
      const scrollSurface = document.createElement('div');
      scrollSurface.scrollTop = 500;
      Object.defineProperty(scrollSurface, 'clientHeight', { value: 800, configurable: true });
      scrollSurface.getBoundingClientRect = () => ({
        top: 0,
        bottom: 800,
        left: 0,
        right: 800,
        width: 800,
        height: 800,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Mock view and iframe
      const viewElement = document.createElement('div');
      Object.defineProperty(viewElement, 'isConnected', { value: true, configurable: true });

      const iframe = document.createElement('iframe');
      const iframeDoc = document.implementation.createHTMLDocument('Section');
      const p = iframeDoc.createElement('p');
      p.textContent = 'User reading this line';
      iframeDoc.body.appendChild(p);

      Object.defineProperty(iframe, 'contentDocument', { value: iframeDoc, configurable: true });
      Object.defineProperty(iframe, 'clientHeight', { value: 1200, configurable: true });

      // Anchor element starts at screen Y = 100
      let pTop = 50;
      let iframeTop = 50;
      iframe.getBoundingClientRect = () => ({
        top: iframeTop,
        bottom: iframeTop + 1200,
        left: 0,
        right: 800,
        width: 800,
        height: 1200,
        x: 0,
        y: iframeTop,
        toJSON: () => {},
      });
      viewElement.getBoundingClientRect = () => iframe.getBoundingClientRect();

      p.getBoundingClientRect = () => ({
        top: pTop,
        bottom: pTop + 40,
        left: 50,
        right: 400,
        width: 350,
        height: 40,
        x: 50,
        y: pTop,
        toJSON: () => {},
      });

      const manager: ScrollAnchorManager = {
        views: {
          all: () => [{ element: viewElement, iframe }],
        },
        counter: vi.fn(),
      };

      // Content above the reading anchor expands by 120px during typography adjustment
      applyWithScrollAnchor(scrollSurface, manager, () => {
        // Earlier content expanded, pushing p downwards by 120px
        pTop += 120;
      });

      // The 120px drift must be added to scrollTop (500 + 120 = 620)
      // to keep the reading position perfectly locked on screen
      expect(scrollSurface.scrollTop).toBe(620);
      expect(manager.ignore).toBe(true);
    });

    it('compensates scroll drift when content contracts so reading position is maintained', () => {
      const scrollSurface = document.createElement('div');
      scrollSurface.scrollTop = 800;
      Object.defineProperty(scrollSurface, 'clientHeight', { value: 800, configurable: true });
      scrollSurface.getBoundingClientRect = () => ({
        top: 0,
        bottom: 800,
        left: 0,
        right: 800,
        width: 800,
        height: 800,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      const viewElement = document.createElement('div');
      Object.defineProperty(viewElement, 'isConnected', { value: true, configurable: true });

      const iframe = document.createElement('iframe');
      const iframeDoc = document.implementation.createHTMLDocument('Section');
      const p = iframeDoc.createElement('p');
      p.textContent = 'Reading anchor';
      iframeDoc.body.appendChild(p);

      Object.defineProperty(iframe, 'contentDocument', { value: iframeDoc, configurable: true });
      Object.defineProperty(iframe, 'clientHeight', { value: 1200, configurable: true });

      let pTop = 150;
      let iframeTop = 50;
      iframe.getBoundingClientRect = () => ({
        top: iframeTop,
        bottom: iframeTop + 1200,
        left: 0,
        right: 800,
        width: 800,
        height: 1200,
        x: 0,
        y: iframeTop,
        toJSON: () => {},
      });
      viewElement.getBoundingClientRect = () => iframe.getBoundingClientRect();

      p.getBoundingClientRect = () => ({
        top: pTop,
        bottom: pTop + 40,
        left: 50,
        right: 400,
        width: 350,
        height: 40,
        x: 50,
        y: pTop,
        toJSON: () => {},
      });

      const manager: ScrollAnchorManager = {
        views: {
          all: () => [{ element: viewElement, iframe }],
        },
      };

      // Content contracts by 70px
      applyWithScrollAnchor(scrollSurface, manager, () => {
        pTop -= 70;
      });

      // ScrollTop must decrease by 70px (800 - 70 = 730)
      expect(scrollSurface.scrollTop).toBe(730);
    });
  });
});
