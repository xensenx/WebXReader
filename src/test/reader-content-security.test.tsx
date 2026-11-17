import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { PaginatedReader } from '../components/reader/PaginatedReader';
import { ScrollReader } from '../components/reader/ScrollReader';
import { clearDatabase, getBookContent, listBooks, restoreBackup } from '../core/storage/database';
import { sanitizeBookCss, sanitizeReaderHtml } from '../core/parsing/sanitize-reader-html';
import { parseHtml } from '../core/parsing/html-parser';
import { isExternalNetworkUrl } from '../formats/engines/EpubReader';
import { DEFAULT_SETTINGS } from '../types/book';
import type { BackupData, Book, Chapter } from '../types/book';

const unsafeChapterHtml = [
  '<p onclick="alert(1)">Readable text</p>',
  '<script>alert(2)</script>',
  '<img src="x" onerror="alert(3)">',
  '<svg onload="alert(4)"><circle></circle></svg>',
  '<iframe srcdoc="&lt;script&gt;alert(5)&lt;/script&gt;"></iframe>',
  '<a href="javascript:alert(6)">unsafe link</a>',
].join('');

const book: Book = {
  id: 'security-book',
  title: 'Security Test Book',
  author: 'Test Author',
  description: '',
  language: 'en',
  publisher: '',
  publicationDate: '',
  identifiers: {},
  sourceFormat: 'html',
  originalFilename: 'security-test.html',
  fileSize: 1,
  contentHash: 'security-test-hash',
  importedAt: 1,
  updatedAt: 1,
  userTags: [],
  userRating: null,
  favorite: false,
  archived: false,
  readingStatus: 'unread',
  lastOpenedAt: null,
  tableOfContents: [],
  totalChapters: 1,
};

const chapter: Chapter = {
  id: 'security-chapter',
  title: 'Chapter 1',
  content: unsafeChapterHtml,
  level: 0,
  order: 0,
};

function makeBackup(chapters: Chapter[]): BackupData {
  return {
    version: 2,
    exportedAt: Date.now(),
    appVersion: 'test',
    books: [book],
    progress: [],
    bookmarks: [],
    annotations: [],
    settings: DEFAULT_SETTINGS,
    bookSettings: [],
    contents: [{ bookId: book.id, format: 'html', chapters }],
  };
}

function expectSafeChapterDom(element: Element | null): void {
  expect(element).not.toBeNull();
  expect(element?.querySelector('script, img, iframe, object, embed, video, audio, source, svg')).toBeNull();
  expect(element?.querySelector('[onclick], [onerror], [onload]')).toBeNull();
  expect(element?.querySelector('a')?.getAttribute('href')).toBeNull();
  expect(element?.textContent).toContain('Readable text');
}

describe('Reader chapter HTML security', () => {
  afterEach(async () => {
    cleanup();
    await clearDatabase();
  });

  it('sanitizes chapter HTML when restoring a backup', async () => {
    await restoreBackup(makeBackup([chapter]));

    const restoredContent = await getBookContent(book.id);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = restoredContent?.chapters?.[0]?.content ?? '';
    expectSafeChapterDom(wrapper);
  });

  it('sanitizes legacy chapter HTML at both reader rendering boundaries', () => {
    const settings = {
      fontFamily: 'serif',
      fontSize: 18,
      lineHeight: 1.7,
      paragraphSpacing: 1,
      letterSpacing: 0,
      wordSpacing: 0,
      textAlign: 'left' as const,
      textIndent: 0,
      maxContentWidth: 720,
      contentMargin: 24,
      readingMode: 'scroll' as const,
      theme: 'light' as const,
      readerSheetColor: 'paper' as const,
      expandContent: false,
    };

    const scroll = render(
      <ScrollReader chapters={[chapter]} settings={settings} onProgressUpdate={vi.fn()} />,
    );
    expectSafeChapterDom(scroll.container.querySelector('[data-chapter-body="true"]'));
    scroll.unmount();

    const paginated = render(
      <PaginatedReader chapters={[chapter]} settings={settings} onProgressUpdate={vi.fn()} />,
    );
    expectSafeChapterDom(paginated.container.querySelector('[data-chapter-body="true"]'));
    paginated.unmount();
  });

  it('rejects malformed chapter records before storing restored books', async () => {
    const malformedBackup = makeBackup([
      { ...chapter, content: 123 as unknown as string },
    ]);

    await expect(restoreBackup(malformedBackup)).rejects.toThrow('Invalid content payload in backup');
    expect(await listBooks()).toHaveLength(0);
  });

  describe('F01: EPUB author CSS sanitization and <style> breakout protection', () => {
    it('neutralizes </style> breakout attempts and active markup in CSS', () => {
      const maliciousCss = `
        p { color: red; }
        </style><img src="x" onerror="alert(1)">
        body { font-size: 16px; }
      `;
      const sanitized = sanitizeBookCss(maliciousCss);

      expect(sanitized).not.toContain('</style');
      expect(sanitized).not.toContain('<img');
      expect(sanitized).toContain('color: red;');
      expect(sanitized).toContain('font-size: 16px;');
    });

    it('strips @import rules that could load remote stylesheets', () => {
      const maliciousCss = `
        @import url('https://attacker.com/evil.css');
        @import "http://attacker.com/leak.css";
        .chapter { margin: 10px; }
      `;
      const sanitized = sanitizeBookCss(maliciousCss);

      expect(sanitized).not.toContain('@import');
      expect(sanitized).not.toContain('attacker.com');
      expect(sanitized).toContain('margin: 10px;');
    });

    it('strips external network url() references from CSS', () => {
      const maliciousCss = `
        .bg-1 { background-image: url('https://attacker.com/track.png'); }
        .bg-2 { background-image: url("http://attacker.com/leak.jpg"); }
        .bg-3 { background-image: url(//attacker.com/proto.png); }
        .bg-safe-data { background-image: url(data:image/png;base64,iVBORw0KGgo=); }
        .bg-safe-blob { background-image: url('blob:http://localhost:5173/123'); }
      `;
      const sanitized = sanitizeBookCss(maliciousCss);

      expect(sanitized).not.toContain('https://attacker.com');
      expect(sanitized).not.toContain('http://attacker.com');
      expect(sanitized).not.toContain('//attacker.com');
      expect(sanitized).toContain('data:image/png;base64,iVBORw0KGgo=');
      expect(sanitized).toContain('blob:http://localhost:5173/123');
    });

    it('neutralizes HTML comments and legacy expression / -moz-binding constructs', () => {
      const complexCss = `
        <!-- HTML comment in CSS -->
        body { width: expression(alert(1)); }
        div { -moz-binding: url('http://evil.com/xbl'); }
      `;
      const sanitized = sanitizeBookCss(complexCss);

      expect(sanitized).not.toContain('<!--');
      expect(sanitized).not.toContain('-->');
      expect(sanitized).not.toContain('expression(');
      expect(sanitized).not.toContain('-moz-binding:');
    });
  });

  describe('F04: Reader network containment and local-first resource policy', () => {
    it('disallows external network URLs on embedded <img> elements while allowing blob and data URIs', () => {
      const htmlWithImages = `
        <img src="https://attacker.com/tracker.png" alt="tracker" />
        <img src="http://attacker.com/http-tracker.png" alt="http-tracker" />
        <img src="//attacker.com/proto-tracker.png" alt="proto-tracker" />
        <img src="blob:http://localhost:5173/local-page.jpg" alt="local-page" />
        <img src="data:image/png;base64,iVBORw0KGgo=" alt="data-page" />
      `;

      const sanitized = sanitizeReaderHtml(htmlWithImages, { allowImages: true });

      // External network URLs stripped of src attribute
      expect(sanitized).not.toContain('https://attacker.com');
      expect(sanitized).not.toContain('http://attacker.com');
      expect(sanitized).not.toContain('//attacker.com');

      // Safe local/inlined images retain their src
      expect(sanitized).toContain('blob:http://localhost:5173/local-page.jpg');
      expect(sanitized).toContain('data:image/png;base64,iVBORw0KGgo=');
    });

    it('disallows external network URLs on SVG <image> elements', () => {
      const svgWithImages = `
        <svg viewBox="0 0 100 100">
          <image href="https://attacker.com/leak.png" width="100" height="100" />
          <image href="blob:http://localhost:5173/safe-svg.png" width="100" height="100" />
        </svg>
      `;

      const sanitized = sanitizeReaderHtml(svgWithImages, { allowImages: true, allowSvg: true });

      expect(sanitized).not.toContain('https://attacker.com/leak.png');
      expect(sanitized).toContain('blob:http://localhost:5173/safe-svg.png');
    });

    it('preserves external hyperlinks for user-initiated navigation but strips javascript: URLs', () => {
      const links = `
        <a href="https://en.wikipedia.org/wiki/Special:Search" target="_blank" rel="noopener noreferrer">Wikipedia</a>
        <a href="javascript:alert(1)">Exploit</a>
      `;

      const sanitized = sanitizeReaderHtml(links);

      expect(sanitized).toContain('https://en.wikipedia.org/wiki/Special:Search');
      expect(sanitized).not.toContain('javascript:');
    });

    it('identifies external network URLs accurately via isExternalNetworkUrl', () => {
      expect(isExternalNetworkUrl('https://example.com/image.png')).toBe(true);
      expect(isExternalNetworkUrl('http://example.com/image.png')).toBe(true);
      expect(isExternalNetworkUrl('//example.com/image.png')).toBe(true);
      expect(isExternalNetworkUrl('blob:http://localhost:5173/uuid')).toBe(false);
      expect(isExternalNetworkUrl('data:image/png;base64,123')).toBe(false);
      expect(isExternalNetworkUrl('images/cover.jpg')).toBe(false);
      expect(isExternalNetworkUrl('../chapter1.xhtml')).toBe(false);
    });
  });

  describe('F15: Chapter splitting text node escaping', () => {
    it('escapes angle brackets in raw text nodes rather than reintroducing them as literal markup', () => {
      const htmlText = `
        <h1>Chapter 1</h1>
        &lt;img src="x" onerror="alert(1)"&gt;
        <p>Legitimate paragraph</p>
      `;

      const { chapters } = parseHtml(htmlText);
      expect(chapters.length).toBeGreaterThan(0);
      const chapterContent = chapters[0].content;

      // The raw text node was escaped with &lt; rather than becoming a live <img> tag
      expect(chapterContent).not.toContain('<img');
      expect(chapterContent).toContain('&lt;img');
    });
  });
});
