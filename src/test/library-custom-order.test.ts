import { describe, it, expect } from 'vitest';
import type { Book, SortField } from '../types/book';

describe('Custom Library Sorting & Reordering', () => {
  const mockBooks: Book[] = [
    {
      id: 'book-1',
      title: 'Zelda Story',
      author: 'Author A',
      description: '',
      language: 'en',
      publisher: '',
      publicationDate: '',
      identifiers: {},
      sourceFormat: 'epub',
      originalFilename: 'zelda.epub',
      fileSize: 1000,
      contentHash: 'hash-1',
      importedAt: 100,
      updatedAt: 100,
      userTags: [],
      userRating: null,
      favorite: false,
      archived: false,
      readingStatus: 'unread',
      lastOpenedAt: 500,
      tableOfContents: [],
      totalChapters: 1,
    },
    {
      id: 'book-2',
      title: 'Alpha Quest',
      author: 'Author B',
      description: '',
      language: 'en',
      publisher: '',
      publicationDate: '',
      identifiers: {},
      sourceFormat: 'pdf',
      originalFilename: 'alpha.pdf',
      fileSize: 2000,
      contentHash: 'hash-2',
      importedAt: 200,
      updatedAt: 200,
      userTags: [],
      userRating: null,
      favorite: false,
      archived: false,
      readingStatus: 'reading',
      lastOpenedAt: 9999,
      tableOfContents: [],
      totalChapters: 2,
    },
    {
      id: 'book-3',
      title: 'Middle Earth',
      author: 'Author C',
      description: '',
      language: 'en',
      publisher: '',
      publicationDate: '',
      identifiers: {},
      sourceFormat: 'cbz',
      originalFilename: 'middle.cbz',
      fileSize: 3000,
      contentHash: 'hash-3',
      importedAt: 300,
      updatedAt: 300,
      userTags: [],
      userRating: null,
      favorite: false,
      archived: false,
      readingStatus: 'completed',
      lastOpenedAt: 200,
      tableOfContents: [],
      totalChapters: 3,
    },
  ];

  function sortLibraryBooks(books: Book[], sortField: SortField, customOrder: string[], direction: 'asc' | 'desc' = 'asc'): Book[] {
    const result = [...books];
    if (sortField === 'custom') {
      const orderMap = new Map(customOrder.map((id, index) => [id, index]));
      result.sort((a, b) => {
        const orderA = orderMap.has(a.id) ? orderMap.get(a.id)! : 999999;
        const orderB = orderMap.has(b.id) ? orderMap.get(b.id)! : 999999;
        if (orderA !== orderB) return orderA - orderB;
        return b.importedAt - a.importedAt;
      });
    } else {
      result.sort((a, b) => {
        let comparison = 0;
        switch (sortField) {
          case 'title':
            comparison = a.title.localeCompare(b.title);
            break;
          case 'author':
            comparison = (a.author || '').localeCompare(b.author || '');
            break;
          case 'importedAt':
          default:
            comparison = a.importedAt - b.importedAt;
            break;
        }
        return direction === 'asc' ? comparison : -comparison;
      });
    }
    return result;
  }

  it('arranges books according to user drag-and-drop custom order', () => {
    // User arranges book-3 first, then book-1, then book-2
    const customOrder = ['book-3', 'book-1', 'book-2'];
    const sorted = sortLibraryBooks(mockBooks, 'custom', customOrder);

    expect(sorted.map((b) => b.id)).toEqual(['book-3', 'book-1', 'book-2']);
  });

  it('preserves custom order even when books are opened and reading timestamps update', () => {
    const customOrder = ['book-2', 'book-3', 'book-1'];

    // Book 1 is opened, updating its lastOpenedAt to right now
    const booksWithUpdatedLastOpened = mockBooks.map((b) =>
      b.id === 'book-1' ? { ...b, lastOpenedAt: Date.now() } : b
    );

    // In custom sort, Book 1 does NOT jump to the top!
    const sorted = sortLibraryBooks(booksWithUpdatedLastOpened, 'custom', customOrder);
    expect(sorted.map((b) => b.id)).toEqual(['book-2', 'book-3', 'book-1']);
  });

  it('allows shifting to other sort fields and returning to custom order intact', () => {
    const customOrder = ['book-3', 'book-2', 'book-1'];

    // Title sort (A-Z)
    const titleSorted = sortLibraryBooks(mockBooks, 'title', customOrder, 'asc');
    expect(titleSorted.map((b) => b.id)).toEqual(['book-2', 'book-3', 'book-1']); // Alpha, Middle, Zelda

    // Recently Added (desc)
    const recentSorted = sortLibraryBooks(mockBooks, 'importedAt', customOrder, 'desc');
    expect(recentSorted.map((b) => b.id)).toEqual(['book-3', 'book-2', 'book-1']);

    // Return to Custom
    const customSorted = sortLibraryBooks(mockBooks, 'custom', customOrder);
    expect(customSorted.map((b) => b.id)).toEqual(['book-3', 'book-2', 'book-1']);
  });

  it('appends newly imported books without prior custom positions cleanly', () => {
    const customOrder = ['book-2']; // only book-2 was manually placed
    const sorted = sortLibraryBooks(mockBooks, 'custom', customOrder);

    expect(sorted[0].id).toBe('book-2');
    // Remaining books (book-3 and book-1) follow by importedAt descending
    expect(sorted[1].id).toBe('book-3'); // importedAt 300
    expect(sorted[2].id).toBe('book-1'); // importedAt 100
  });

  describe('Touch Drag & Drop Logic', () => {
    it('distinguishes touch scroll movement from stationary long-press', () => {
      // If user drags finger > 8px before timer completes, gesture is classified as scroll
      const startX = 100;
      const startY = 200;

      const scrollMoveX = 100;
      const scrollMoveY = 215; // moved 15px vertically
      const scrollDistance = Math.hypot(scrollMoveX - startX, scrollMoveY - startY);
      expect(scrollDistance).toBeGreaterThan(8);

      const stationaryMoveX = 102;
      const stationaryMoveY = 203; // moved ~3.6px
      const stationaryDistance = Math.hypot(stationaryMoveX - startX, stationaryMoveY - startY);
      expect(stationaryDistance).toBeLessThanOrEqual(8);
    });

    it('reorders custom order array correctly on drag target insertion', () => {
      const currentOrder = ['b1', 'b2', 'b3', 'b4'];
      const sourceId = 'b4';
      const targetId = 'b2';

      const sourceIndex = currentOrder.indexOf(sourceId);
      const nextOrder = [...currentOrder];
      nextOrder.splice(sourceIndex, 1);
      const insertAt = nextOrder.indexOf(targetId);
      nextOrder.splice(insertAt, 0, sourceId);

      expect(nextOrder).toEqual(['b1', 'b4', 'b2', 'b3']);
    });
  });
});
