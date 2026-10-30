import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { PaginatedReader } from '../components/reader/PaginatedReader';
import { ScrollReader } from '../components/reader/ScrollReader';
import { clearDatabase, getBookContent, listBooks, restoreBackup } from '../core/storage/database';
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
});
