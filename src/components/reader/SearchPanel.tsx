/** In-book search panel with chapter, EPUB, and PDF match previews. */

import { useEffect, useMemo, useState } from 'react';
import { X, Search as SearchIcon } from 'lucide-react';
import type { Chapter } from '../../types/book';
import { createTextExcerpt, extractDomText, findTextMatches } from '../../utils/text-search';
import { SearchInput } from '../common/SearchInput';
import type { ReaderSearchProvider, ReaderSearchResult } from './search-types';
import styles from './SearchPanel.module.css';

interface SearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  chapters: Chapter[];
  searchProvider?: ReaderSearchProvider;
  onSelectResult: (result: ReaderSearchResult, query: string) => void;
}

export function SearchPanel({
  isOpen,
  onClose,
  chapters,
  searchProvider,
  onSelectResult,
}: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [remoteResults, setRemoteResults] = useState<ReaderSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const normalizedQuery = query.trim();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && isOpen) onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const cleanChapters = useMemo(() => chapters
    .filter((chapter) => Boolean(chapter.content))
    .map((chapter) => {
      const document = new DOMParser().parseFromString(chapter.content || '', 'text/html');
      document.querySelectorAll('script, style, noscript, template').forEach((element) => element.remove());
      return {
        id: chapter.id,
        title: chapter.title || 'Untitled Chapter',
        text: extractDomText(document.body),
      };
    }), [chapters]);

  const localResults = useMemo(() => {
    if (!normalizedQuery || normalizedQuery.length < 2) return [];
    const matches: ReaderSearchResult[] = [];
    const maxResults = 100;

    for (const chapter of cleanChapters) {
      const chapterMatches = findTextMatches(
        chapter.text,
        normalizedQuery,
        maxResults - matches.length,
      );
      chapterMatches.forEach((match, matchIndex) => {
        const excerpt = createTextExcerpt(chapter.text, match);
        matches.push({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          ...excerpt,
          offset: match.start,
          matchIndex,
        });
      });
      if (matches.length >= maxResults) break;
    }
    return matches;
  }, [cleanChapters, normalizedQuery]);

  useEffect(() => {
    if (!searchProvider || !isOpen || normalizedQuery.length < 2) {
      setRemoteResults([]);
      setSearching(false);
      setSearchError(false);
      return;
    }

    let active = true;
    setRemoteResults([]);
    setSearching(true);
    setSearchError(false);
    const timer = window.setTimeout(() => {
      searchProvider(normalizedQuery)
        .then((results) => {
          if (active) setRemoteResults(results);
        })
        .catch(() => {
          if (active) setSearchError(true);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 220);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [isOpen, normalizedQuery, searchProvider]);

  if (!isOpen) return null;

  const results = searchProvider ? remoteResults : localResults;

  return (
    <div
      className={styles.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="In-book Search"
    >
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.title}>Search in Book</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close search"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <div className={styles.searchBox}>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search this book…"
          />
        </div>

        {normalizedQuery.length >= 2 && (
          <div className={styles.resultsHeader} aria-live="polite">
            {searching
              ? 'Searching book…'
              : `Found ${results.length} ${results.length === 1 ? 'result' : 'results'}`}
          </div>
        )}

        <div className={styles.resultsList}>
          {normalizedQuery.length < 2 ? (
            <div className={styles.emptyState}>
              <SearchIcon size={32} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
              <p>Type at least 2 characters to search</p>
            </div>
          ) : searching ? (
            <div className={styles.emptyState}>
              <p>Searching the book text…</p>
            </div>
          ) : searchError ? (
            <div className={styles.emptyState}>
              <p>Search could not read this book. Try another phrase.</p>
            </div>
          ) : results.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No matches found for “{normalizedQuery}”</p>
            </div>
          ) : (
            results.map((result, index) => (
              <div
                key={`${result.chapterId}-${result.offset}-${index}`}
                className={styles.resultItem}
                onClick={() => {
                  onSelectResult(result, normalizedQuery);
                  onClose();
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectResult(result, normalizedQuery);
                    onClose();
                  }
                }}
              >
                <div className={styles.chapterName}>{result.chapterTitle}</div>
                <div className={styles.excerpt}>
                  <span>{result.before}</span>
                  <span className={styles.highlight}>{result.match}</span>
                  <span>{result.after}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
