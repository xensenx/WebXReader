# WebXReader — Local-First Web Novel Reader

**Version 1.0 — Production-Minded MVP**

WebXReader is a dedicated, desktop-class, private, local-first web novel reader that runs entirely inside modern web browsers. It allows users to import novels in multiple formats, organize a persistent personal bookshelf, and enjoy an immersive, customizable reading environment without requiring accounts, remote databases, external APIs, cloud servers, or active internet connections.

---

## 1. Product Principles & Architecture

- **Local Ownership:** All book contents, metadata, reading positions, bookmarks, and personal preferences remain strictly on the user's device in IndexedDB.
- **Reading First:** Refined editorial typography, smooth chapter navigation, distraction-free reading, and instant position restoration.
- **Persistence & Integrity:** IndexedDB storage with an explicit schema version, debounced writes (preventing battery/disk churn), and deduplication based on cryptographic SHA-256 hashes.
- **Offline Shell:** Progressive Web App (PWA) with a dedicated service worker that discovers and precaches the production application shell after the first successful online load.

### Module Architecture

```
src/
├── app/
│   └── providers/          # SettingsContext & global providers
├── components/
│   ├── common/             # Button, Modal, DropZone, SearchInput, EmptyState, ConfirmDialog
│   ├── library/            # BookCard, BookList, LibraryToolbar, ImportDialog, BookDetailsDialog, LibraryView
│   ├── reader/             # ScrollReader, PaginatedReader, VerticalReader, EpubReader,
│   │                       # ReaderSettings, TableOfContents, BookmarkPanel, SearchPanel, ProgressBar, ReaderView
│   └── settings/           # SettingsView (Preferences, Storage stats, Backup/Restore, Shortcuts)
├── core/
│   ├── parsing/            # TXT parser (chapter regexes), Markdown parser, HTML parser, EPUB parser
│   └── storage/            # Typed IndexedDB abstraction, migrations, transactions, deduplication
├── features/
│   ├── export/             # JSON backup export/restore, individual original book export
│   └── import/             # Import validation, deduplication, format dispatch, cover handling
├── hooks/                  # useBooks, useSettings, useReadingProgress, useBookmarks, useReaderSettings
├── styles/                 # globals.css (CSS Custom Properties design system)
├── types/                  # book.ts (Core entity models and settings)
└── utils/                  # Hashing, debouncing, formatting, sanitization
```

---

## 2. Supported File Formats

| Format | Extension | Capabilities |
|---|---|---|
| **Plain Text** | `.txt` | Line-ending normalization (`\r\n` / `\r` → `\n`), UTF-8 BOM removal, smart chapter detection (`Chapter X`, `Part X`, Roman numerals, ALL CAPS headings), fallback to unified document if no headings exist. |
| **EPUB** | `.epub` | EPUB 2 and EPUB 3 publications rendered via `epubjs` with full table of contents, embedded metadata, cover extraction, custom reader theme injection, and CFI-based location tracking. |
| **Markdown** | `.md`, `.markdown` | Rendered via `marked`, sanitized with `DOMPurify`, YAML frontmatter extraction (title, author, publisher, etc.), heading-based chapter hierarchy. |
| **HTML / XHTML** | `.html`, `.htm`, `.xhtml` | Sanitized with `DOMPurify` (stripping scripts, event handlers, unsafe URLs, and remote embedded resources), title extraction from `<title>` tags, chapter splits from `<h1>`/`<h2>` tags. |
| **PDF** | `.pdf` | Local fixed-layout viewing through `pdfjs-dist` with Vertical Scroll and single-page mode, lazy page rendering, page jump controls, zoom, page progress, and a generated first-page thumbnail. Scanned PDFs may have no extractable text. |

---

## 3. Storage Model & Data Schema

Persistent storage is managed by IndexedDB (`webxreader`, current schema version 1) with explicit object stores:

- **`books`**: Metadata (`id`, `title`, `author`, `description`, `sourceFormat`, `fileSize`, `contentHash`, `importedAt`, `lastOpenedAt`, `readingStatus`, `favorite`, `archived`, `userTags`, `tableOfContents`, etc.).
- **`bookContent`**: Separated large payloads (`originalFile` ArrayBuffer for EPUB/PDF re-export, parsed chapters for TXT/Markdown/HTML, raw text for reprocessing).
- **`progress`**: Reading progress records (`bookId`, `chapterId`, `chapterProgress`, `overallProgress`, `scrollPosition`, `pageIndex`, `readingMode`, `epubCfi`, `lastUpdatedAt`).
- **`bookmarks`**: User bookmarks (`id`, `bookId`, `chapterId`, `position`, `selectedText`, `label`, `createdAt`).
- **`annotations`**: User annotations (`id`, `bookId`, `chapterId`, `startOffset`, `endOffset`, `selectedText`, `note`, `highlightColor`, `createdAt`).
- **`settings`**: Global user configuration (`theme`, `fontFamily`, `fontSize`, `lineHeight`, `paragraphSpacing`, `maxContentWidth`, `defaultReadingMode`, etc.).
- **`bookSettings`**: Per-book presentation overrides.
- **`covers`**: Extracted or uploaded cover image data.

---

## 4. Reading Modes & Customization

The reader supports three reflowable reading modes:

| Format | Vertical Scroll | Pages | Double Sided |
|---|---:|---:|---:|
| TXT / Markdown / HTML | Yes | Yes | Yes |
| EPUB | Yes | Yes | Yes — rendered as an epub.js spread without forcing vertical writing |
| PDF | Yes — fixed-layout page stack | Page jumps and zoom | No |

1. **Vertical Scroll Mode (`ScrollReader`)**:
   - Natural browser scrolling with smooth transitions between chapters.
   - Dynamic chapter headings and divider glyphs.
   - Scroll-position restoration and live progress calculation.
2. **Pages Mode (`PaginatedReader`)**:
   - CSS multi-column layout with fixed-width pages.
   - Native vertical scrolling is allowed within the current page when content overflows; crossing to another page requires a deliberate turn.
   - Navigation via keyboard (Arrow keys, Space, PageUp/PageDown), on-screen edge tap targets, or mobile touch swipes.
   - Dynamic page calculation and page count indicator (`Page X of Y`).
3. **Double Sided Mode (`DoubleSidedReader`)**:
   - Two CSS-layout pages are shown side by side as a book-like spread.
   - Spreads shift by deliberate page controls, keyboard commands, edge taps, or mobile swipes.

EPUB double-sided mode uses epub.js's spread layout while preserving the publication's own styles and
reading order. EPUB content is contained in a centered, paper-width reading surface in scroll and page
modes. PDF remains fixed-layout: Vertical Scroll
uses a stable page stack, while Pages shows one canvas at a time and allows scrolling within that page
before a deliberate turn.

### Customization Options
- **Themes:** Light (`#ffffff`), Dark (`#121212`), Warm Sepia (`#f4ecd8`).
- **Typography:** Serif (Georgia, Times New Roman, Palatino), Sans-Serif (System UI, Verdana), Monospace (Consolas).
- **Sizing & Spacing:** Font size (12px–36px), line spacing (1.2x–2.6x), paragraph spacing (0.4em–2.5em), letter spacing (-0.5px–2.5px), first-line indentation (0–3em).
- **Layout:** Content width (500px–1100px), margins (12px–64px), text alignment (Left, Center, Justify).

---

## 5. Keyboard Shortcuts

| Key | Action |
|---|---|
| <kbd>H</kbd> | Toggle header & distraction-free reading mode |
| <kbd>F</kbd> | Toggle browser fullscreen |
| <kbd>T</kbd> | Open Table of Contents drawer |
| <kbd>B</kbd> | Open Bookmarks panel |
| <kbd>S</kbd> | Open Reading Settings panel |
| <kbd>/</kbd> | Open in-book search |
| <kbd>→</kbd> / <kbd>Space</kbd> | Next page (in paginated mode) |
| <kbd>←</kbd> | Previous page (in paginated mode) |
| <kbd>Esc</kbd> | Close open panels or dialogs |

---

## 6. Backup & Restoration Instructions

### Exporting Backup
1. Click the **Settings** gear icon in the library header.
2. Navigate to the **Backup & Library Restoration** section.
3. Click **Export JSON**.
4. A versioned JSON file (`webxreader-backup-YYYY-MM-DD.json`) containing book metadata, stored content, reading positions, bookmarks, annotations, and settings will download. Binary EPUB/PDF source files are base64-encoded, so backups can be large.

### Restoring Backup
1. In the **Settings** view, under **Restore Library Backup**, click **Restore JSON**.
2. Select your previously downloaded backup file.
3. WebXReader validates the schema and restores non-duplicate books, content, reading progress, bookmarks, and settings transactionally. Existing books and their progress are left untouched.

### Exporting Individual Books
1. In the library bookshelf or list, click the `⋮` menu on any book card.
2. Select **Export File**. The original file (EPUB, TXT, MD, HTML) will be downloaded to your computer.

---

## 7. Development & Verification Commands

### Prerequisites
- Node.js 18+ (tested with Node 20 / 22)
- npm 9+

### Install Dependencies
```bash
npm install
```

### Run Local Development Server
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

### Run Automated Tests
```bash
npm test
```
Runs 22 automated tests covering parsers, storage operations, import deduplication, component rendering, backup content restoration, and the end-to-end reading lifecycle.

### Build Production Bundle
```bash
npm run build
```
Type-checks TypeScript with `tsc -b` and builds optimized static assets with code-splitting via Vite into `dist/`.

### Preview Production Build
```bash
npm run preview
```

---

## 8. Sample Fixtures

Sample fixtures are provided in the `fixtures/` directory:
- `fixtures/sample-novel.txt`: Multi-chapter fantasy novel with chapter headings.
- `fixtures/sample-novel.md`: Sci-fi novella with YAML frontmatter, headings, blockquotes, and lists.
- `fixtures/sample-novel.html`: Historical novella with `<title>`, author meta tag, and `<h1>` chapter headers.

You can drag and drop any of these files directly into WebXReader to test the import and reading experience.

---

## 9. Known limitations and honest boundaries

- The core bookmark workflow is implemented. Text highlights and editable annotations have storage types and backup support, but their selection UI is deferred until a stable cross-format location model is added.
- Double-sided spreads are implemented for normalized TXT/Markdown/HTML content and EPUBs through epub.js's spread layout. EPUB publications keep their own writing rules; the reader does not force vertical writing onto them. PDF is fixed-layout and supports both Vertical Scroll and single-page scrolling.
- Scanned PDFs without a text layer are viewable as fixed-layout pages but are not OCR'd.
- A production deployment needs one successful online load for the service worker to discover and cache its hashed JavaScript/CSS assets. Development mode deliberately unregisters service workers. Browser storage can still be cleared or evicted, so use the JSON backup for durable protection.
- A browser-level Playwright suite is not included in the current repository; the existing Vitest/Testing Library suite covers deterministic import, storage, parser, component, and lifecycle behavior.
