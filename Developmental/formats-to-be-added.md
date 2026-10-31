# WebXReader Supported Formats Roadmap & Milestone Status

> **Milestone Status**: 🎉 **20 / 20 Formats Implemented (v1 Baseline Complete)**  
> All 20 target formats now have initial functional implementations in WebXReader. Future phases will focus on refinement, deeper feature integration, format optimizations, edge-case hardening, and comprehensive documentation.

---

## 1. Format Breakdown by Category (20 Total)

### 1. Plain Text & Markup (3 Formats)
- [x] **TXT** (`.txt`) — Continuous scroll and paginated reading modes with regex chapter detection and custom typography.
- [x] **Markdown** (`.md`, `.markdown`) — CommonMark parsing, custom styling, sanitized rendering.
- [x] **HTML** (`.html`, `.htm`, `.xhtml`) — DOM-based article extraction, sanitized reader rendering.

### 2. E-Book Formats (4 Formats)
- [x] **EPUB** (`.epub`) — Flowable and fixed-layout EPUB 2/3 reader via epubjs with TOC navigation, bookmarks, and pagination.
- [x] **FB2** (`.fb2`, `.fb2.zip`) — FictionBook XML parsing, metadata, inline covers, and chapter extraction.
- [x] **MOBI** (`.mobi`, `.prc`, `.azw`) — PalmDOC decompression, Huff/CDIC decoding, EXTH metadata, and cover extraction.
- [x] **AZW3** (`.azw3`, `.kf8`) — Amazon Kindle Format 8 parsing with PalmDOC/Huff/CDIC decompressor and HTML5/CSS3 chapter extraction.

### 3. Word-Processing Documents (3 Formats)
- [x] **DOCX** (`.docx`) — Office Open XML parsing via mammoth, preserving headings, lists, tables, and images.
- [x] **DOC** (`.doc`) — Legacy Microsoft Word binary format parsing via CFB/FIB text stream extraction.
- [x] **RTF** (`.rtf`) — Rich Text Format parser with control word tokenization, Unicode escapes, and chapter detection.

### 4. Fixed-Layout & Document Formats (3 Formats)
- [x] **PDF** (`.pdf`) — Canvas rasterization via pdfjs-dist with hardware-accelerated matrix preview zoom, pointer anchor preservation, and lazy loading.
- [x] **DjVu** (`.djvu`, `.djv`) — High-compression scanned document reader powered by djvu-wasm with canvas staging and anchor zoom.
- [x] **MHT / MHTML** (`.mht`, `.mhtml`) — MIME Multipart web archive parser with Content-Location/CID resource inlining and oversized chapter chunking.

### 5. Comic-Book Formats (3 Formats)
- [x] **CBZ** (`.cbz`) — ZIP comic archive extractor via JSZip with continuous vertical, single-page, and double-page spread (RTL) reading modes.
- [x] **CBR** (`.cbr`, `.rar`) — RAR comic archive extractor powered by 7z-wasm with natural filename page sorting and zoom anchoring.
- [x] **CB7** (`.cb7`, `.7z`) — 7-Zip comic archive extractor powered by 7z-wasm supporting LZMA/LZMA2 compression.

### 6. General Archive & Container Formats (2 Formats)
- [x] **ZIP** (`.zip`) — Multi-format container inspector with nested folder navigation, file info inspection, and on-demand reading delegation to underlying format engines.
- [x] **RAR** (`.rar`) — General-purpose RAR archive container inspector via 7z-wasm, supporting RAR4/RAR5 extraction and embedded file reading.

### 7. Standalone Image Formats (2 Formats)
- [x] **PNG** (`.png`) — Standalone image reader with fit-to-screen (contain, fit width, fit height), 1:1 pixel inspection, matrix preview zoom, drag-and-drop panning, rotation, and optional checkerboard backdrop.
- [x] **JPEG** (`.jpg`, `.jpeg`) — Standalone image reader with fit modes, matrix preview zoom, click-and-drag panning, rotation, and EXIF orientation rendering.

---

## 2. Summary Status Table

| # | Format | Extensions | Category | Parser / Engine | Status |
|---|--------|------------|----------|-----------------|--------|
| 1 | **TXT** | `.txt` | Plain Text | Native regex & encoding | ✅ Implemented (v1) |
| 2 | **Markdown** | `.md`, `.markdown` | Markup | Native DOM & markdown | ✅ Implemented (v1) |
| 3 | **HTML** | `.html`, `.htm`, `.xhtml` | Markup | DOMParser & sanitizer | ✅ Implemented (v1) |
| 4 | **EPUB** | `.epub` | E-book | epubjs | ✅ Implemented (v1) |
| 5 | **FB2** | `.fb2`, `.fb2.zip` | E-book | Native XML parser | ✅ Implemented (v1) |
| 6 | **MOBI** | `.mobi`, `.prc`, `.azw` | E-book | Native PalmDOC/HuffCDIC | ✅ Implemented (v1) |
| 7 | **AZW3** | `.azw3`, `.kf8` | E-book | Native KF8/PalmDOC | ✅ Implemented (v1) |
| 8 | **DOCX** | `.docx` | Word Processing | Mammoth & DOM | ✅ Implemented (v1) |
| 9 | **DOC** | `.doc` | Word Processing | CFB / FIB extractor | ✅ Implemented (v1) |
| 10 | **RTF** | `.rtf` | Word Processing | Native RTF tokenizer | ✅ Implemented (v1) |
| 11 | **PDF** | `.pdf` | Fixed Layout | pdfjs-dist | ✅ Implemented (v1) |
| 12 | **DjVu** | `.djvu`, `.djv` | Fixed Layout | djvu-wasm | ✅ Implemented (v1) |
| 13 | **MHT** | `.mht`, `.mhtml` | Web Archive | Native MIME multipart | ✅ Implemented (v1) |
| 14 | **CBZ** | `.cbz` | Comic Book | JSZip + CbzReader | ✅ Implemented (v1) |
| 15 | **CBR** | `.cbr`, `.rar` | Comic Book | 7z-wasm + CbzReader | ✅ Implemented (v1) |
| 16 | **CB7** | `.cb7`, `.7z` | Comic Book | 7z-wasm + CbzReader | ✅ Implemented (v1) |
| 17 | **ZIP** | `.zip` | Archive Container | JSZip + ZipReader | ✅ Implemented (v1) |
| 18 | **RAR** | `.rar` | Archive Container | 7z-wasm + ZipReader | ✅ Implemented (v1) |
| 19 | **PNG** | `.png` | Standalone Image | ImageReader & Parser | ✅ Implemented (v1) |
| 20 | **JPEG** | `.jpg`, `.jpeg` | Standalone Image | ImageReader & Parser | ✅ Implemented (v1) |

---

## 3. Progress Tracking

- **Total Planned Formats**: 20
- **Implemented So Far**: 20
- **Left to Implement**: 0
- **Remaining Formats**: None

---

## 4. Next Phase: Quality, Optimization & Refinement

With the initial 20-format foundation in place, upcoming work will focus on:
1. **Format-Specific Improvements & Revisits**: Edge-case handling, complex encoding edge cases, and layout parity.
2. **Performance & Memory Optimization**: Streaming parsers for massive archives and memory disposal for heavy wasm runtimes.
3. **UX Polish**: Seamless zoom, keyboard shortcuts, mobile gesture tuning, and unified reader preferences across all formats.
4. **Site & Infrastructure Improvements**: Testing coverage, offline caching, and PWA capabilities.
5. **Comprehensive Documentation**: Format-by-format architectural specifications, guides, and user documentation.
