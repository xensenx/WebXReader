/**
 * Core book data model types for WebXReader.
 * These types define the persistent data structures used by the app.
 */

/** Supported import formats */
export type BookFormat = 'epub' | 'txt' | 'markdown' | 'html' | 'pdf' | 'cbz' | 'cbr' | 'cb7' | 'rtf' | 'fb2' | 'mobi' | 'azw3' | 'docx' | 'doc' | 'djvu' | 'mht' | 'zip' | 'rar' | 'png' | 'jpeg';

/** Reading status of a book */
export type ReadingStatus = 'unread' | 'reading' | 'completed';

/** Reading mode preference */
export type ReadingMode = 'scroll' | 'paginated' | 'vertical';

/** Theme preference */
export type ThemeName = 'light' | 'dark' | 'sepia';

/** Sheet background color options */
export type ReaderSheetColor = 'paper' | 'archive' | 'dark';

/** Text alignment options */
export type TextAlignment = 'left' | 'center' | 'right' | 'justify';

/** Library layout preference */
export type LibraryLayout = 'grid' | 'list';

/** Sort field for library */
export type SortField = 'custom' | 'title' | 'author' | 'importedAt' | 'lastOpenedAt' | 'progress';

/** Sort direction */
export type SortDirection = 'asc' | 'desc';

/** Filter for library view */
export type LibraryFilter = 'all' | 'reading' | 'unread' | 'completed' | 'favorites' | 'archived';

/** Highlight color options */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange';

/** Comic reading direction */
export type ComicReadingDirection = 'ltr' | 'rtl';

/** Comic fit mode */
export type ComicFitMode = 'contain' | 'width' | 'height';

/**
 * Format-specific reader settings overrides.
 */
export interface FormatSettings {
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  paragraphSpacing?: number;
  letterSpacing?: number;
  textAlign?: TextAlignment;
  textIndent?: number;
  maxContentWidth?: number;
  contentMargin?: number;
  readingMode?: ReadingMode;
  comicReadingDirection?: ComicReadingDirection;
  comicFitMode?: ComicFitMode;
  rtfPreserveAlignment?: boolean;
  readerSheetColor?: ReaderSheetColor;
  expandContent?: boolean;
}

/**
 * A chapter/section within a book.
 */
export interface Chapter {
  /** Unique identifier within the book */
  id: string;
  /** Display title */
  title: string;
  /** Content of the chapter (for TXT/MD/HTML) */
  content?: string;
  /** EPUB href/spine reference */
  href?: string;
  /** Nesting level (0 = top-level) */
  level: number;
  /** Order index */
  order: number;
  /** Sub-chapters */
  children?: Chapter[];
}

/**
 * Metadata for an imported book.
 */
export interface BookMetadata {
  title: string;
  author: string;
  description: string;
  language: string;
  publisher: string;
  publicationDate: string;
  identifiers: Record<string, string>;
}

/**
 * Core Book entity stored in IndexedDB.
 */
export interface Book {
  /** Unique identifier (UUID) */
  id: string;
  /** Book title */
  title: string;
  /** Author name */
  author: string;
  /** Book description/synopsis */
  description: string;
  /** Language code (e.g., 'en', 'ja') */
  language: string;
  /** Publisher name */
  publisher: string;
  /** Publication date string */
  publicationDate: string;
  /** External identifiers (ISBN, etc.) */
  identifiers: Record<string, string>;
  /** Source file format */
  sourceFormat: BookFormat;
  /** Original filename at import */
  originalFilename: string;
  /** File size in bytes */
  fileSize: number;
  /** SHA-256 hash of file content for dedup */
  contentHash: string;
  /** Import timestamp */
  importedAt: number;
  /** Last modification timestamp */
  updatedAt: number;
  /** Cover image blob key or data URL */
  coverImage?: string;
  /** Cover image captured at import, preserved as the reset target for user-edited covers. */
  originalCoverImage?: string | null;
  /** User-assigned tags */
  userTags: string[];
  /** User rating (1-5 or null) */
  userRating: number | null;
  /** Marked as favorite */
  favorite: boolean;
  /** Archived (hidden from default view) */
  archived: boolean;
  /** Current reading status */
  readingStatus: ReadingStatus;
  /** Last opened timestamp */
  lastOpenedAt: number | null;
  /** Table of contents structure */
  tableOfContents: Chapter[];
  /** Total chapter count */
  totalChapters: number;
}

/**
 * Book content stored separately from metadata.
 * For TXT/MD/HTML: stores parsed chapter content.
 * For EPUB: stores the original file binary.
 */
export interface BookContent {
  /** Same as Book.id */
  bookId: string;
  /** Original file as ArrayBuffer (for EPUB, or for re-export) */
  originalFile?: ArrayBuffer;
  /** Parsed chapters with content (for TXT/MD/HTML) */
  chapters?: Chapter[];
  /** Original raw text (for TXT, allows reprocessing) */
  rawText?: string;
  /** Source format */
  format: BookFormat;
}

/** JSON-safe book content included in versioned backups. */
export interface BackupBookContent {
  bookId: string;
  format: BookFormat;
  rawText?: string;
  chapters?: Chapter[];
  originalFileBase64?: string;
}

/**
 * Reading progress for a book.
 */
export interface ReadingProgress {
  /** Book ID */
  bookId: string;
  /** Current chapter ID */
  chapterId: string;
  /** Position within chapter (0-1 fraction) */
  chapterProgress: number;
  /** Overall progress (0-1 fraction) */
  overallProgress: number;
  /** Scroll position (pixels from top, for scroll mode) */
  scrollPosition: number;
  /** Current page index (for paginated mode) */
  pageIndex: number;
  /** Last active reading mode */
  readingMode: ReadingMode;
  /** EPUB CFI location string */
  epubCfi?: string;
  /** Last updated timestamp */
  lastUpdatedAt: number;
}

/**
 * A user bookmark within a book.
 */
export interface Bookmark {
  /** Unique ID (UUID) */
  id: string;
  /** Book ID */
  bookId: string;
  /** Chapter ID */
  chapterId: string;
  /** Position within chapter */
  position: number;
  /** EPUB CFI if applicable */
  epubCfi?: string;
  /** Selected text excerpt */
  selectedText: string;
  /** User label */
  label: string;
  /** Creation timestamp */
  createdAt: number;
}

/**
 * A user annotation/highlight within a book.
 */
export interface Annotation {
  /** Unique ID (UUID) */
  id: string;
  /** Book ID */
  bookId: string;
  /** Chapter ID */
  chapterId: string;
  /** Start position in chapter content */
  startOffset: number;
  /** End position in chapter content */
  endOffset: number;
  /** EPUB CFI range if applicable */
  epubCfi?: string;
  /** Selected/highlighted text */
  selectedText: string;
  /** User note */
  note: string;
  /** Highlight color */
  highlightColor: HighlightColor;
  /** Context text (for recovery if positions shift) */
  contextBefore: string;
  /** Context text after */
  contextAfter: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

/**
 * Reading session history entry.
 */
export interface ReadingSession {
  /** Book ID */
  bookId: string;
  /** Session start timestamp */
  startedAt: number;
  /** Session end timestamp */
  endedAt: number;
  /** Duration in seconds */
  duration: number;
  /** Progress at start */
  progressAtStart: number;
  /** Progress at end */
  progressAtEnd: number;
}

/**
 * Global user settings.
 */
export interface UserSettings {
  /** Settings ID (always 'global') */
  id: string;
  /** Active theme */
  theme: ThemeName;
  /** Default reading mode */
  defaultReadingMode: ReadingMode;
  /** Font family name */
  fontFamily: string;
  /** Font size in pixels */
  fontSize: number;
  /** Line height multiplier */
  lineHeight: number;
  /** Paragraph spacing in ems */
  paragraphSpacing: number;
  /** Letter spacing in pixels */
  letterSpacing: number;
  /** Word spacing in pixels */
  wordSpacing: number;
  /** Text alignment */
  textAlign: TextAlignment;
  /** Text indent in ems */
  textIndent: number;
  /** Max content width in pixels */
  maxContentWidth: number;
  /** Content margin in pixels */
  contentMargin: number;
  /** Sheet background color */
  readerSheetColor: ReaderSheetColor;
  /** Whether content expands to fill full viewport width */
  expandContent: boolean;
  /** Format-specific reader settings overrides */
  formatSettings?: Partial<Record<BookFormat, FormatSettings>>;
  /** Library layout preference */
  libraryLayout: LibraryLayout;
  /** Library sort field preference */
  librarySortField: SortField;
  /** Library sort direction preference */
  librarySortDirection: SortDirection;
  /** Custom persistent order of book IDs */
  customBookOrder?: string[];
  /** Auto-detect chapters for TXT */
  autoDetectChapters: boolean;
  /** Auto-detect chapters for RTF */
  autoDetectChaptersRtf?: boolean;
  /** Auto-detect chapters for MOBI */
  autoDetectChaptersMobi?: boolean;
  /** Auto-detect chapters for AZW3 / KF8 */
  autoDetectChaptersAzw3?: boolean;
  /** Auto-detect chapters for DOCX */
  autoDetectChaptersDocx?: boolean;
  /** Auto-detect chapters for DOC */
  autoDetectChaptersDoc?: boolean;
  /** Whether to append footnotes as a reference chapter for FB2 */
  fb2IncludeNotes?: boolean;
  /** Import size warning threshold in MB */
  importSizeWarningMB: number;
  /** Last updated */
  updatedAt: number;
}

/**
 * Per-book settings overrides.
 */
export interface BookSettings {
  /** Whether custom book-specific overrides are active (isolates this book from universal format settings) */
  isCustomOverride?: boolean;
  /** Book ID */
  bookId: string;
  /** Override reading mode */
  readingMode?: ReadingMode;
  /** Override font family */
  fontFamily?: string;
  /** Override font size */
  fontSize?: number;
  /** Override line height */
  lineHeight?: number;
  /** Override paragraph spacing */
  paragraphSpacing?: number;
  /** Override letter spacing */
  letterSpacing?: number;
  /** Override text alignment */
  textAlign?: TextAlignment;
  /** Override text indent */
  textIndent?: number;
  /** Override max content width */
  maxContentWidth?: number;
  /** Override content margin */
  contentMargin?: number;
  /** Override sheet background color */
  readerSheetColor?: ReaderSheetColor;
  /** Override whether content expands to fill full viewport width */
  expandContent?: boolean;
  /** Override comic reading direction (ltr or rtl) */
  comicReadingDirection?: ComicReadingDirection;
  /** Override comic page fit mode */
  comicFitMode?: ComicFitMode;
  /** Override whether RTF document alignments are preserved */
  rtfPreserveAlignment?: boolean;
  /** Last updated */
  updatedAt: number;
}

/**
 * Backup data format.
 */
export interface BackupData {
  /** Backup format version */
  version: number;
  /** Export timestamp */
  exportedAt: number;
  /** Application version */
  appVersion: string;
  /** Books metadata (no content) */
  books: Book[];
  /** Reading progress records */
  progress: ReadingProgress[];
  /** Bookmarks */
  bookmarks: Bookmark[];
  /** Annotations */
  annotations: Annotation[];
  /** User settings */
  settings: UserSettings;
  /** Per-book settings */
  bookSettings: BookSettings[];
  /** Content payloads. Optional for backwards-compatible v1 backups. */
  contents?: BackupBookContent[];
}

/** Default user settings */
export const DEFAULT_SETTINGS: UserSettings = {
  id: 'global',
  theme: 'light',
  defaultReadingMode: 'scroll',
  fontFamily: 'Georgia, serif',
  fontSize: 18,
  lineHeight: 1.7,
  paragraphSpacing: 1.0,
  letterSpacing: 0,
  wordSpacing: 0,
  textAlign: 'left',
  textIndent: 0,
  maxContentWidth: 720,
  contentMargin: 24,
  readerSheetColor: 'paper',
  expandContent: false,
  formatSettings: {},
  libraryLayout: 'grid',
  librarySortField: 'importedAt',
  librarySortDirection: 'desc',
  customBookOrder: [],
  autoDetectChapters: true,
  autoDetectChaptersRtf: true,
  fb2IncludeNotes: true,
  autoDetectChaptersMobi: true,
  autoDetectChaptersAzw3: true,
  autoDetectChaptersDocx: true,
  autoDetectChaptersDoc: true,
  importSizeWarningMB: 50,
  updatedAt: Date.now(),
};
