import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { txtFormat } from '../formats/definitions/txt';
import {
  DEFAULT_TXT_COVER,
  DEFAULT_TXT_COVER_SVG,
  getBookCoverUrl,
} from '../assets/covers/txt-default-cover';
import { BookCard } from '../components/library/BookCard';
import { BookList } from '../components/library/BookList';
import { BookDetailsDialog } from '../components/library/BookDetailsDialog';
import { useBooks } from '../hooks/useBooks';
import { addBook, clearDatabase } from '../core/storage/database';
import type { Book } from '../types/book';

describe('TXT Default Cover Thumbnail', () => {
  const dummyTxtBook: Book = {
    id: 'test-txt-book-1',
    title: 'War of the Worlds',
    author: 'H. G. Wells',
    description: 'A science fiction novel.',
    language: 'en',
    publisher: 'Heinemann',
    publicationDate: '1898',
    identifiers: {},
    sourceFormat: 'txt',
    originalFilename: 'war_of_the_worlds.txt',
    fileSize: 10240,
    contentHash: 'hash123',
    importedAt: Date.now(),
    updatedAt: Date.now(),
    userTags: [],
    userRating: null,
    favorite: false,
    archived: false,
    readingStatus: 'reading',
    lastOpenedAt: Date.now(),
    tableOfContents: [],
    totalChapters: 5,
  };

  it('contains valid SVG markup with a blueish background gradient and path2 vector icon', () => {
    expect(DEFAULT_TXT_COVER_SVG).toContain('<svg');
    expect(DEFAULT_TXT_COVER_SVG).toContain('viewBox="0 0 300 450"');
    // Blueish background gradient
    expect(DEFAULT_TXT_COVER_SVG).toContain('linearGradient id="txtCoverBg"');
    expect(DEFAULT_TXT_COVER_SVG).toContain('#dbeafe');
    expect(DEFAULT_TXT_COVER_SVG).toContain('#60a5fa');
    // Icon paths from path2.svg
    expect(DEFAULT_TXT_COVER_SVG).toContain('id="path2"');
    expect(DEFAULT_TXT_COVER_SVG).toContain('id="path3"');
    expect(DEFAULT_TXT_COVER_SVG).toContain('id="path4"');
    expect(DEFAULT_TXT_COVER_SVG).toContain('id="path5"');

    // Data URI representation
    expect(DEFAULT_TXT_COVER).toMatch(/^data:image\/svg\+xml;utf8,/);
  });

  it('assigns DEFAULT_TXT_COVER during txtFormat.parse', async () => {
    const file = new File(['Chapter 1\nHello World'], 'sample.txt', { type: 'text/plain' });
    const parsed = await txtFormat.parse(file, {});

    expect(parsed.coverImage).toBe(DEFAULT_TXT_COVER);
  });

  it('getBookCoverUrl correctly resolves format default vs custom cover', () => {
    // 1. TXT book without coverImage returns DEFAULT_TXT_COVER
    expect(getBookCoverUrl(dummyTxtBook)).toBe(DEFAULT_TXT_COVER);

    // 2. TXT book with custom coverImage returns the custom image
    const customCoverBook: Book = {
      ...dummyTxtBook,
      coverImage: 'https://example.com/custom-cover.jpg',
    };
    expect(getBookCoverUrl(customCoverBook)).toBe('https://example.com/custom-cover.jpg');

    // 3. Non-TXT book without coverImage returns undefined (uses generic letter fallback)
    const epubBook: Book = {
      ...dummyTxtBook,
      sourceFormat: 'epub',
    };
    expect(getBookCoverUrl(epubBook)).toBeUndefined();
  });

  it('preserves an existing remote cover URL for a TXT book in useBooks', async () => {
    await clearDatabase();
    await addBook({
      ...dummyTxtBook,
      id: 'txt-with-remote-cover',
      coverImage: 'https://example.com/remote-cover.png',
    });

    const { result } = renderHook(() => useBooks());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const loaded = result.current.books.find((b) => b.id === 'txt-with-remote-cover');
    expect(loaded?.coverImage).toBe('https://example.com/remote-cover.png');
  });

  it('renders default TXT thumbnail in BookCard component', () => {
    const { container } = render(
      <BookCard
        book={dummyTxtBook}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onToggleFavorite={vi.fn()}
        onUpdateStatus={vi.fn()}
        onToggleArchive={vi.fn()}
        onExport={vi.fn()}
        onDelete={vi.fn()}
        selectionMode={false}
        selected={false}
        onToggleSelection={vi.fn()}
      />
    );

    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', DEFAULT_TXT_COVER);
    expect(screen.queryByText('W')).not.toBeInTheDocument(); // Does not show fallback initial
  });

  it('renders default TXT thumbnail in BookList component', () => {
    const { container } = render(
      <BookList
        book={dummyTxtBook}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onToggleFavorite={vi.fn()}
        onUpdateStatus={vi.fn()}
        onToggleArchive={vi.fn()}
        onExport={vi.fn()}
        onDelete={vi.fn()}
        selectionMode={false}
        selected={false}
        onToggleSelection={vi.fn()}
      />
    );

    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', DEFAULT_TXT_COVER);
  });

  it('displays default TXT thumbnail in BookDetailsDialog and supports custom override & reset', async () => {
    const handleSave = vi.fn();
    render(
      <BookDetailsDialog
        isOpen
        book={dummyTxtBook}
        onClose={vi.fn()}
        onSave={handleSave}
      />
    );

    // Initial cover image in dialog preview is the default TXT cover
    const coverImg = screen.getByRole('img', { name: /cover for war of the worlds/i });
    expect(coverImg).toHaveAttribute('src', DEFAULT_TXT_COVER);

    // Reset button is not shown initially because it is already default/original
    expect(screen.queryByRole('button', { name: /reset to (original|default)/i })).not.toBeInTheDocument();

    // Remove cover
    const removeBtn = screen.getByRole('button', { name: /remove/i });
    fireEvent.click(removeBtn);

    // Now reset button appears
    const resetBtn = screen.getByRole('button', { name: /reset to (original|default)/i });
    expect(resetBtn).toBeInTheDocument();

    // Clicking reset restores the default TXT cover
    fireEvent.click(resetBtn);
    expect(screen.getByRole('img', { name: /cover for war of the worlds/i })).toHaveAttribute('src', DEFAULT_TXT_COVER);
  });
});
