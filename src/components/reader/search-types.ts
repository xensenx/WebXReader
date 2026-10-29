export interface ReaderSearchResult {
  chapterId: string;
  chapterTitle: string;
  before: string;
  match: string;
  after: string;
  offset: number;
  /** Zero-based occurrence of this query in the target chapter or page. */
  matchIndex: number;
  /** Spine href for EPUB results. */
  href?: string;
  /** One-based PDF page number. */
  pageNumber?: number;
}

export type ReaderSearchProvider = (query: string) => Promise<ReaderSearchResult[]>;
