/**
 * Library View State Persistence
 *
 * Preserves the user's scroll position, active search query, filter,
 * and last-opened book across navigation, page refreshes, and all book formats.
 */

import type { LibraryFilter } from '../../types/book';

const STORAGE_KEY = 'webxreader_library_view_state';

export interface LibraryViewState {
  scrollY: number;
  lastOpenedBookId?: string | null;
  searchQuery: string;
  filter: LibraryFilter;
  timestamp: number;
}

// In-memory cache for synchronous access during React component lifecycles
let inMemoryState: LibraryViewState | null = null;

/**
 * Returns the current library view state from memory or sessionStorage.
 */
export function getLibraryViewState(): LibraryViewState {
  if (inMemoryState) {
    return inMemoryState;
  }

  try {
    const raw = typeof window !== 'undefined' ? window.sessionStorage?.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        inMemoryState = {
          scrollY: typeof parsed.scrollY === 'number' ? Math.max(0, parsed.scrollY) : 0,
          lastOpenedBookId: typeof parsed.lastOpenedBookId === 'string' ? parsed.lastOpenedBookId : null,
          searchQuery: typeof parsed.searchQuery === 'string' ? parsed.searchQuery : '',
          filter: typeof parsed.filter === 'string' ? (parsed.filter as LibraryFilter) : 'all',
          timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
        };
        return inMemoryState;
      }
    }
  } catch {
    // Ignore storage parse or quota errors
  }

  inMemoryState = {
    scrollY: 0,
    lastOpenedBookId: null,
    searchQuery: '',
    filter: 'all',
    timestamp: Date.now(),
  };

  return inMemoryState;
}

/**
 * Saves updates to the library view state in both memory and sessionStorage.
 */
export function saveLibraryViewState(partial: Partial<LibraryViewState>): void {
  const current = getLibraryViewState();
  const next: LibraryViewState = {
    ...current,
    ...partial,
    timestamp: Date.now(),
  };
  inMemoryState = next;

  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Ignore storage quota or access errors
  }
}

/**
 * Updates the recorded library scroll position.
 */
export function updateLibraryScroll(scrollY: number): void {
  const safeScroll = Math.max(0, Math.round(scrollY));
  if (inMemoryState) {
    inMemoryState.scrollY = safeScroll;
  }
  saveLibraryViewState({ scrollY: safeScroll });
}

/**
 * Clears the persisted library view state (useful for tests or full resets).
 */
export function clearLibraryViewState(): void {
  inMemoryState = null;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
}
