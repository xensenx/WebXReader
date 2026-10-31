import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  downloadLibraryBackup,
  restoreLibraryBackup,
  downloadOriginalBook,
} from '../features/export/backup-service';
import {
  addBook,
  saveBookContent,
  getBook,
  getBookContent,
  clearDatabase,
} from '../core/storage/database';
import type { Book, BookContent } from '../types/book';

function createMockBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'test-book-id',
    title: 'Test Book',
    author: 'Author',
    description: '',
    language: 'en',
    publisher: '',
    publicationDate: '',
    identifiers: {},
    sourceFormat: 'txt',
    originalFilename: 'book.txt',
    contentHash: 'hash-12345',
    fileSize: 100,
    importedAt: Date.now(),
    updatedAt: Date.now(),
    tableOfContents: [],
    favorite: false,
    archived: false,
    readingStatus: 'unread',
    userTags: [],
    userRating: 0,
    lastOpenedAt: null,
    totalChapters: 0,
    ...overrides,
  };
}

describe('Backup and Export Service', () => {
  let createdElements: HTMLAnchorElement[] = [];
  let clickedLinks: string[] = [];
  let originalCreateElement: typeof document.createElement;
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(async () => {
    await clearDatabase();
    createdElements = [];
    clickedLinks = [];

    originalCreateElement = document.createElement.bind(document);
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;

    URL.createObjectURL = vi.fn().mockImplementation(() => 'blob:mock-url-' + Math.random());
    URL.revokeObjectURL = vi.fn();

    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName === 'a') {
        const anchor = el as HTMLAnchorElement;
        anchor.click = vi.fn().mockImplementation(() => {
          clickedLinks.push(anchor.download || anchor.href);
        });
        createdElements.push(anchor);
      }
      return el;
    });
  });

  afterEach(async () => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
    await clearDatabase();
  });

  it('triggers browser download for complete library backup', async () => {
    const book = createMockBook({
      id: 'book-export-1',
      title: 'Export Test Book',
      contentHash: 'hash-exp-1',
    });
    await addBook(book);

    await downloadLibraryBackup();

    expect(createdElements.length).toBe(1);
    expect(clickedLinks.length).toBe(1);
    expect(clickedLinks[0]).toMatch(/^webxreader-backup-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('restores library backup from valid JSON File', async () => {
    const backupData = {
      version: 2,
      exportedAt: Date.now(),
      books: [
        createMockBook({
          id: 'restored-1',
          title: 'Restored Book',
          contentHash: 'hash-restored-1',
        }),
      ],
      contents: [
        {
          bookId: 'restored-1',
          format: 'txt',
          rawText: 'Restored raw text content.',
          chapters: [],
        },
      ],
      progress: [],
      bookmarks: [],
      annotations: [],
      bookSettings: [],
      settings: {
        theme: 'dark',
      },
    };

    const file = new File([JSON.stringify(backupData)], 'backup.json', { type: 'application/json' });
    const result = await restoreLibraryBackup(file);

    expect(result.booksRestored).toBe(1);
    const restoredBook = await getBook('restored-1');
    expect(restoredBook?.title).toBe('Restored Book');
    const restoredContent = await getBookContent('restored-1');
    expect(restoredContent?.rawText).toBe('Restored raw text content.');
  });

  it('rejects restoring corrupted or non-JSON backup file', async () => {
    const file = new File(['not valid json {{{'], 'bad.json', { type: 'application/json' });
    await expect(restoreLibraryBackup(file)).rejects.toThrow(/Failed to parse backup file/);
  });

  it('downloads original book with binary originalFile payload', async () => {
    const book = createMockBook({
      id: 'binary-book',
      title: 'Binary Book',
      originalFilename: 'novel.epub',
      sourceFormat: 'epub',
      contentHash: 'hash-bin-1',
    });
    const content: BookContent = {
      bookId: 'binary-book',
      format: 'epub',
      originalFile: new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer,
    };
    await addBook(book);
    await saveBookContent(content);

    const success = await downloadOriginalBook('binary-book');
    expect(success).toBe(true);
    expect(clickedLinks).toContain('novel.epub');
  });

  it('downloads original book reconstructed from chapters when original file is missing', async () => {
    const book = createMockBook({
      id: 'chapter-book',
      title: 'Chapter Novel',
      originalFilename: 'novel.html',
      sourceFormat: 'html',
      contentHash: 'hash-ch-1',
    });
    const content: BookContent = {
      bookId: 'chapter-book',
      format: 'html',
      chapters: [
        {
          id: 'c1',
          title: 'Prologue',
          content: '<p>The story begins here.</p>',
          level: 0,
          order: 0,
        },
      ],
    };
    await addBook(book);
    await saveBookContent(content);

    const success = await downloadOriginalBook('chapter-book');
    expect(success).toBe(true);
    expect(clickedLinks).toContain('novel.html');
  });

  it('throws when attempting to download non-existent book', async () => {
    await expect(downloadOriginalBook('non-existent')).rejects.toThrow('Book or book content not found');
  });
});
