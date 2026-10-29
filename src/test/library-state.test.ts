import { describe, it, expect, beforeEach } from 'vitest';
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
    expect(state.filter).toBe('all');
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
      filter: 'reading',
    });

    const state = getLibraryViewState();
    expect(state.scrollY).toBe(600);
    expect(state.lastOpenedBookId).toBe('book-uuid-123');
    expect(state.searchQuery).toBe('manga');
    expect(state.filter).toBe('reading');
  });

  it('restores state from sessionStorage across in-memory resets', () => {
    saveLibraryViewState({
      scrollY: 1250,
      lastOpenedBookId: 'book-uuid-999',
      searchQuery: 'solitary',
      filter: 'favorites',
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
    expect(restored.filter).toBe('favorites');
  });

  it('clears state cleanly on demand', () => {
    updateLibraryScroll(900);
    clearLibraryViewState();
    const fresh = getLibraryViewState();
    expect(fresh.scrollY).toBe(0);
    expect(fresh.lastOpenedBookId).toBeNull();
  });
});
