import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { getBookCoverSources, getDefaultBookCover } from '../assets/covers/default-book-cover';
import { getAllFormats } from '../formats/registry';
import { readFileSync } from 'node:fs';
import { BookCoverImage } from '../components/library/BookCoverImage';
import { BookCard } from '../components/library/BookCard';
import { BookList } from '../components/library/BookList';
import { BookDetailsDialog } from '../components/library/BookDetailsDialog';
import { invalidateBooksCache, useBooks } from '../hooks/useBooks';
import { addBook, clearDatabase, saveCover } from '../core/storage/database';
import type { Book } from '../types/book';

describe('Format fallback covers', () => {
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

  const txtCover = getDefaultBookCover('txt');

  it('maps all 20 registered formats to distinct portrait SVGs', () => {
    const formats = getAllFormats();
    const urls = formats.map(({ id }) => getBookCoverSources({ sourceFormat: id })[0]);
    expect(new Set(urls).size).toBe(20);
    for (const url of urls) {
      expect(url).toMatch(/^\/covers\/[a-z0-9]+-default-cover\.svg$/);
      const svg = readFileSync(`public${url}`, 'utf8');
      expect(svg).toContain('<svg');
      expect(svg).toMatch(/width="1200"[\s\S]*height="1800"|height="1800"[\s\S]*width="1200"/);
    }
  });

  it('tries the custom cover, extracted cover, and format SVG in that order', () => {
    const book = { sourceFormat: 'png' as const, coverImage: 'blob:custom', originalCoverImage: 'blob:original' };
    render(<BookCoverImage book={book} alt="PNG cover" placeholder={<span>Placeholder</span>} />);
    const img = () => screen.getByRole('img', { name: 'PNG cover' });
    expect(img()).toHaveAttribute('src', 'blob:custom');
    fireEvent.error(img());
    expect(img()).toHaveAttribute('src', 'blob:original');
    fireEvent.error(img());
    expect(img()).toHaveAttribute('src', '/covers/png-default-cover.svg');
    fireEvent.error(img());
    expect(screen.getByText('Placeholder')).toBeInTheDocument();
  });

  it('preserves an existing remote cover URL for a TXT book in useBooks', async () => {
    await clearDatabase();
    invalidateBooksCache();
    await addBook({
      ...dummyTxtBook,
      id: 'txt-with-remote-cover',
      coverImage: 'https://example.com/remote-cover.png',
    });

    await saveCover('txt-with-remote-cover', 'data:image/jpeg;base64,c3RhbGU=');

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
    expect(img).toHaveAttribute('src', txtCover);
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
    expect(img).toHaveAttribute('src', txtCover);
  });

  it('resets a custom cover to the format fallback without saving the built-in SVG', async () => {
    const handleSave = vi.fn();
    const book = { ...dummyTxtBook, coverImage: 'blob:custom', originalCoverImage: null };
    render(<BookDetailsDialog isOpen book={book} onClose={vi.fn()} onSave={handleSave} />);

    expect(screen.getByRole('img', { name: /cover for war of the worlds/i })).toHaveAttribute('src', 'blob:custom');
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(screen.getByRole('img', { name: /cover for war of the worlds/i })).toHaveAttribute('src', txtCover);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(handleSave).toHaveBeenCalledWith(expect.objectContaining({
      coverImage: undefined, originalCoverImage: null,
    })));
  });
});
