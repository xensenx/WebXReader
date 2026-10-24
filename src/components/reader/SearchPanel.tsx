/**
 * In-book search panel with live match previews.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { X, Search as SearchIcon } from 'lucide-react';
import type { Chapter } from '../../types/book';
import { SearchInput } from '../common/SearchInput';
import styles from './SearchPanel.module.css';

interface SearchResult {
  chapterId: string;
  chapterTitle: string;
  before: string;
  match: string;
  after: string;
  offset: number;
}

interface SearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  chapters: Chapter[];
  onSelectResult: (chapterId: string, textSnippet?: string) => void;
}

export function SearchPanel({
  isOpen,
  onClose,
  chapters,
  onSelectResult,
}: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Strip HTML tags for clean text search
  const cleanChapters = useMemo(() => {
    return chapters.map((c) => {
      const text = (c.content || '').replace(/<[^>]+>/g, ' ');
      return {
        id: c.id,
        title: c.title || 'Untitled Chapter',
        text,
      };
    });
  }, [chapters]);

  // Perform search across all chapters
  const results = useMemo(() => {
    if (!query.trim() || query.length < 2) return [];

    const matches: SearchResult[] = [];
    const q = query.toLowerCase();
    const maxResults = 100;

    for (const c of cleanChapters) {
      let pos = 0;
      const lower = c.text.toLowerCase();

      while (pos < lower.length && matches.length < maxResults) {
        const idx = lower.indexOf(q, pos);
        if (idx === -1) break;

        const start = Math.max(0, idx - 40);
        const end = Math.min(c.text.length, idx + q.length + 40);

        matches.push({
          chapterId: c.id,
          chapterTitle: c.title,
          before: (start > 0 ? '…' : '') + c.text.slice(start, idx),
          match: c.text.slice(idx, idx + q.length),
          after: c.text.slice(idx + q.length, end) + (end < c.text.length ? '…' : ''),
          offset: idx,
        });

        pos = idx + q.length;
      }

      if (matches.length >= maxResults) break;
    }

    return matches;
  }, [cleanChapters, query]);

  if (!isOpen) return null;

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="In-book Search"
    >
      <div ref={panelRef} className={styles.panel}>
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
            placeholder="Type text to search…"
          />
        </div>

        {query.trim().length >= 2 && (
          <div className={styles.resultsHeader}>
            Found {results.length} {results.length === 1 ? 'result' : 'results'}
          </div>
        )}

        <div className={styles.resultsList}>
          {query.trim().length < 2 ? (
            <div className={styles.emptyState}>
              <SearchIcon size={32} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
              <p>Type at least 2 characters to search</p>
            </div>
          ) : results.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No matches found for "{query}"</p>
            </div>
          ) : (
            results.map((r, i) => (
              <div
                key={`${r.chapterId}-${r.offset}-${i}`}
                className={styles.resultItem}
                onClick={() => {
                  onSelectResult(r.chapterId, r.match);
                  onClose();
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onSelectResult(r.chapterId, r.match);
                    onClose();
                  }
                }}
              >
                <div className={styles.chapterName}>{r.chapterTitle}</div>
                <div className={styles.excerpt}>
                  <span>{r.before}</span>
                  <span className={styles.highlight}>{r.match}</span>
                  <span>{r.after}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
