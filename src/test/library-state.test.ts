import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_LIBRARY_FILTERS } from '../features/library/library-filters';
import {
  getLibraryViewState,
  saveLibraryViewState,
  updateLibraryScroll,
  clearLibraryViewState,
} from '../features/library/library-state';

describe('Library View State Persistence', () => {
  beforeEach(() => {
    clearLibraryViewState();
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.clear();
    }
  });

  it('provides sensible default state when uninitialized', () => {
    const state = getLibraryViewState();
    expect(state.scrollY).toBe(0);
    expect(state.lastOpenedBookId).toBeNull();
    expect(state.searchQuery).toBe('');
    expect(state.filters).toEqual(DEFAULT_LIBRARY_FILTERS);
    expect(state.timestamp).toBeGreaterThan(0);
  });

  it('persists and updates scroll position correctly', () => {
    updateLibraryScroll(850);
    let state = getLibraryViewState();
    expect(state.scrollY).toBe(850);

    updateLibraryScroll(1420.7);
    state = getLibraryViewState();
    expect(state.scrollY).toBe(1421);
  });

  it('persists search query, filter, and opened book id', () => {
    saveLibraryViewState({
      scrollY: 600,
      lastOpenedBookId: 'book-uuid-123',
      searchQuery: 'manga',
      filters: { ...DEFAULT_LIBRARY_FILTERS, statuses: ['reading'], formats: ['epub', 'pdf'] },
    });

    const state = getLibraryViewState();
    expect(state.scrollY).toBe(600);
    expect(state.lastOpenedBookId).toBe('book-uuid-123');
    expect(state.searchQuery).toBe('manga');
    expect(state.filters.statuses).toEqual(['reading']);
    expect(state.filters.formats).toEqual(['epub', 'pdf']);
  });

  it('restores state from sessionStorage across in-memory resets', () => {
    saveLibraryViewState({
      scrollY: 1250,
      lastOpenedBookId: 'book-uuid-999',
      searchQuery: 'solitary',
      filtersOpen: true,
      filters: { ...DEFAULT_LIBRARY_FILTERS, favorite: true, tags: ['fiction'], initial: 'M', archive: 'all' },
    });

    // Clear only in-memory cache to simulate fresh page load
    const savedJson = window.sessionStorage.getItem('webxreader_library_view_state');
    expect(savedJson).toBeTruthy();

    clearLibraryViewState();
    window.sessionStorage.setItem('webxreader_library_view_state', savedJson!);

    const restored = getLibraryViewState();
    expect(restored.scrollY).toBe(1250);
    expect(restored.lastOpenedBookId).toBe('book-uuid-999');
    expect(restored.searchQuery).toBe('solitary');
    expect(restored.filtersOpen).toBe(true);
    expect(restored.filters).toMatchObject({ favorite: true, tags: ['fiction'], initial: 'M', archive: 'all' });
  });

  it.each([
    ['reading', { statuses: ['reading'] }],
    ['favorites', { favorite: true }],
    ['archived', { archive: 'archived' }],
    ['all', DEFAULT_LIBRARY_FILTERS],
  ])('migrates the old %s filter after refresh', (filter, expected) => {
    window.sessionStorage.setItem('webxreader_library_view_state', JSON.stringify({ filter, scrollY: 420 }));
    expect(getLibraryViewState().filters).toMatchObject(expected);
    expect(getLibraryViewState().scrollY).toBe(420);
  });

  it('clears state cleanly on demand', () => {
    updateLibraryScroll(900);
    clearLibraryViewState();
    const fresh = getLibraryViewState();
    expect(fresh.scrollY).toBe(0);
    expect(fresh.lastOpenedBookId).toBeNull();
  });
});
