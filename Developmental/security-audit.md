# WebXReader security, robustness, and bug audit

Audit date: 2026-11-17. Scope: `src/`, `public/`, `index.html`, Vite and hosting configuration, `package.json`, and `package-lock.json`. This was a read-only source audit; no application code was changed. `npm audit --json` was run against the lockfile. Findings describe reachable code paths and their limits, not a claim that every payload was exercised in a browser.

## Executive summary

**Overall posture: elevated risk for untrusted EPUBs and large archives.** The regular HTML, Markdown, DOCX, FB2, MOBI, AZW3, RTF, DOC, and stored-chapter reading paths use a shared DOMPurify boundary. The standard epub.js rendition uses an iframe with scripts disabled. Those are meaningful protections. <!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:763cf26488b67fb312a1290eca599d640799f3a7b6c7f18815977e11a67449ae -->

The original audit found that two alternate EPUB views copied author CSS into the application's main DOM using `innerHTML`, allowing XML entity decoding to introduce a literal closing `</style>`. This issue has since been resolved as F01 (Phase 1) using `sanitizeBookCss` and DOM `textContent` assignment.

<!-- /coderabbit-ai-generated:v1 --> Archive extraction and rendering also lack consistent pre-extraction budgets, allowing a small malicious file to exhaust memory or block the UI thread. A strict network policy is absent, so a book can request remote resources despite the local-first claim.

| Severity | Count | Findings | Status |
| --- | ---: | --- | --- |
| Critical | 1 | F01 | ✅ Resolved (Phase 1) |
| High | 4 | F02–F05 | 🟡 F04 Resolved (Phase 1); F02, F03, F05 Pending |
| Medium | 9 | F06–F13, F17 | ⏳ Pending (Phase 2 & Phase 3) |
| Low | 2 | F14–F15 | ✅ Resolved (Phase 1) |
| Info / Bug | 1 | F16 | ℹ️ Verified Baseline |

## Remediation Roadmap & Phase Tracking

- **Phase 1: Critical Code Execution, Network Containment & Parser Hardening** (Completed on branch `fix/phase1-security-hardening`):
  - ✅ **F01 (Critical)**: Removed all raw EPUB author CSS interpolation from `innerHTML` in `EpubDoubleSidedReader.tsx` and `EpubHorizontalReader.tsx`. Implemented `sanitizeBookCss(...)` to eliminate `</style>` breakout, HTML comments, `@import`, legacy expressions, and external URLs. Styles are attached strictly via DOM `textContent`.
  - ✅ **F04 (High - Reader layer)**: Restricted reader image resolution and DOMPurify policies to local `blob:` and `data:` resources. Stripped outbound external `http:`, `https:`, and `//` URLs on embedded media (`<img>`, `<image>`, `srcset`) in all EPUB reader engines while preserving external user navigation links.
  - ✅ **F14 (Low)**: Replaced unsafe regex fallback in `sanitizeReaderHtml` with a fail-closed return (`return ''`) when DOMPurify is unavailable.
  - ✅ **F15 (Low)**: Escaped angle brackets via `escapeHtml(...)` when wrapping text nodes in `html-parser.ts`, `markdown-parser.ts`, and `mht-parser.ts`.
  - ✅ **Automated Regression Tests**: Added unit and integration tests in `src/test/reader-content-security.test.tsx` verifying CSS sanitization, breakout prevention, network containment, and text escaping (all 340 test suite tests pass).
- **Phase 2: Deployment Hardening & Offline Storage** (Upcoming):
  - ⏳ **F06 (Medium)**: Content Security Policy (CSP) and uniform HTTP security headers across Netlify, Vercel, and Firebase.
  - ⏳ **F17 (Medium)**: Service Worker same-origin cache restriction and byte limits.
- **Phase 3: Lifecycle Cleanup, Memory & Data Concurrency** (Upcoming):
  - ⏳ **F07 (Medium)**: Comic blob URL cache eviction and session revocation.
  - ⏳ **F08 (Medium)**: PDF.js import task destruction in `finally`.
  - ⏳ **F11 (Medium)**: Atomic progress writes and metadata edit race condition protection.
  - ⏳ **F13 (Medium)**: Remote cover streaming byte cap and removing permanent remote URL dependencies.
- **Phase 4: Archive Decompression Bombs & Dependency Upgrades** (Upcoming):
  - ⏳ **F02, F03, F10 (High / Medium)**: Pre-extraction byte, entry, and depth budgets for 7-Zip, RAR, CBZ, and DOCX.
  - ⏳ **F09, F12 (Medium)**: Top-level import size caps and chunked library backup streaming.
  - ⏳ **F05 (High)**: EPUB.js / `@xmldom/xmldom` dependency upgrade or overrides.

`npm audit --json` returned **2 vulnerable packages** (1 high, 1 moderate): `@xmldom/xmldom` 0.7.13 and its dependent `epubjs` 0.3.93. The audit output lists multiple XML injection and denial-of-service advisories for `@xmldom/xmldom`; the separate nested copy used by Mammoth is 0.8.15. No audit entries were reported for the other named direct parser dependencies at the installed versions. This is a registry advisory check, not proof that every vulnerable API is reachable here.

## Detailed findings

### F01 — EPUB author CSS can break out of a `<style>` element in alternate reader views

- **Status:** ✅ Resolved (Phase 1 — `sanitizeBookCss` + DOM `textContent` assignment implemented)
- **Severity:** Critical
- **Category:** HTML injection / potential XSS
- **Affected:** `src/formats/engines/EpubDoubleSidedReader.tsx:65-70,244-256,399-406,744-749`; `src/formats/engines/EpubHorizontalReader.tsx:390-397,568-573,1244-1245`.
- **Technical description:** The double-sided and horizontal readers take `style.textContent` from an untrusted EPUB spine document, wrap it with `scopeCss`, and interpolate it into `<style>…</style>` strings assigned to `innerHTML`. `scopeCss` only rewrites selectors; it does not make CSS safe for an HTML raw-text context. In an XML/XHTML spine, an author can encode `&lt;/style&gt;&lt;img src=x onerror=...&gt;` inside a style element. XML parsing decodes those entities in `textContent`; the later HTML parse then sees a real closing style tag and an active element in the app's main document. The horizontal view's React `<style>{...}</style>` should also be treated as a raw-text sink until verified against the target React/browser combination. DOMPurify protects `page.htmlContent`, but **does not cover `authorStyles`**.
- **Real-world impact:** Opening a crafted EPUB in one of these views can execute code with WebXReader's origin, potentially reading IndexedDB books and making network requests. This is a source-level exploit path; verify with a browser regression test before deployment.
- **Suggested fix:** Do not concatenate untrusted CSS into HTML. Prefer dropping author CSS in main-document views. If retained, parse and allowlist CSS declarations, reject `@import`, `url(...)`, and any HTML raw-text terminator, and assign the resulting CSS through DOM `textContent` after validating it. Keep a CSP as a second barrier.

  ```ts
  const style = document.createElement('style');
  style.textContent = sanitizeBookCss(authorStyles); // allowlisted CSS parser, no remote URLs
  pageEl.replaceChildren(style, safeContentNode);
  // Never use `<style>${authorStyles}</style>` with innerHTML.
  ```

### F02 — RAR/7z extraction expands before size checks, and comic extraction has no budget

- **Severity:** High
- **Category:** Archive bomb / UI denial of service
- **Affected:** `src/core/parsing/sevenzip-extractor.ts:47-79,116-145`; `src/core/parsing/rar-parser.ts:95-125,154-168,265-320`; `src/core/parsing/sevenzip-common.ts:60-85,90-121`.
- **Technical description:** Both comic session creation and RAR parsing call synchronous `sevenZip.callMain(['x', ...])` to expand all entries into MEMFS before walking or checking them. The RAR parser's 10,000-entry, 100 MB/entry, and 500 MB total limits run **after** extraction; `openRarArchiveSession` does not apply them at all. `extractComicArchive` then copies every image into a `Map`, duplicating expanded content. Recursive MEMFS walks/removal have no depth or node limit. `callMain` errors are mostly swallowed, so partially extracted data can appear successful.
- **Real-world impact:** A small RAR/CBR/CB7 file can allocate very large WASM and JS heaps, hang the main thread, crash a browser tab, or leave an incomplete book looking valid.
- **Suggested fix:** List archive metadata first; enforce entry count, depth, per-entry and cumulative expanded bytes before extraction, and stop extraction when actual written bytes exceed the budget. Run 7-Zip in a cancellable Worker with a memory/time budget and check its exit status. Keep cleanup in a `finally` around session creation.

  ```ts
  const limits = { entries: 2_000, depth: 32, entryBytes: 50 << 20, totalBytes: 300 << 20 };
  await worker.listAndValidate(input, limits);
  const session = await worker.extractWithByteBudget(input, limits, signal);
  ```

### F03 — CBZ, DOCX, and EPUB bypass the ZIP safety limits

- **Severity:** High
- **Category:** Decompression / resource exhaustion
- **Affected:** `src/core/parsing/cbz-parser.ts:48,62-69,99-102`; `src/formats/engines/CbzReader.tsx:437-456`; `src/core/parsing/docx-parser.ts:114-119,151-176`; `src/core/parsing/epub-parser.ts:90-95`; compare `src/core/parsing/zip-parser.ts:14-24,175-227`.
- **Technical description:** The general ZIP parser checks declared sizes and ratio, but CBZ directly loads JSZip and inflates page/cover images, DOCX directly loads JSZip then Mammoth reads package XML and media, and EPUB delegates to epub.js without applying the same budget. The CBZ reader repeats the unbounded extraction path when a saved comic is opened. The 100 MB per-entry and 500 MB total ZIP limits are therefore not a format-wide guard. An oversized DOCX image is base64-encoded as a cover before any pixel or byte limit. Even the general ZIP path checks JSZip private `_data` fields and therefore needs validation of actual output bytes.
- **Real-world impact:** A small crafted ZIP-family file can cause high memory use, repeated decompression, long main-thread stalls, or a browser tab crash during import or reading.
- **Suggested fix:** Centralize ZIP validation and route CBZ, DOCX, and EPUB through it. Check metadata before inflation, cap actual decompressed bytes while streaming, limit image pixels before conversion, and put parsing in Workers where possible.

  ```ts
  const archive = await openBudgetedZip(file, {
    maxEntries: 2_000, maxEntryBytes: 50 << 20, maxTotalBytes: 300 << 20,
  });
  const cover = await archive.readLimited(coverPath, 5 << 20);
  ```

### F04 — A book can initiate third-party requests despite the local-first claim

- **Status:** 🟡 Reader Layer Resolved (Phase 1 — `isExternalNetworkUrl` filtering + DOMPurify network URL stripping implemented; CSP headers follow in Phase 2)
- **Severity:** High
- **Category:** Privacy / network containment
- **Affected:** `src/formats/engines/EpubReader.tsx:89-90,405-429,1246-1261`; `src/formats/engines/EpubHorizontalReader.tsx:568-573,1244-1245`; `src/formats/engines/EpubDoubleSidedReader.tsx:744-749`; `src/core/parsing/sanitize-reader-html.ts:44-72`; `public/sw.js:58-105`.
- **Technical description:** `isInlineOrNetworkUrl` leaves `http:` and `https:` EPUB image URLs in place. The standard epub.js iframe blocks scripts but can still load image and CSS resources. Alternate views allow images and copy author CSS, including `@import`/`url(...)`, into the main document. The shared sanitizer strips style elements and event handlers from chapter HTML, but its allowed `href` and optional `src` attributes are not restricted to local book resources. No CSP or resource policy blocks outbound requests. The service worker forwards HTTP requests rather than filtering destinations. Source review found no analytics/telemetry SDK or automatic app telemetry call, but **zero third-party traffic during file parsing is not verified and is contradicted by these content paths**. User-initiated external links and remote cover URLs are separate, expected network features.
- **Real-world impact:** A malicious EPUB can leak the fact that a specific book was opened, the reader's IP address, and referrer information to an attacker-controlled endpoint. CSS selectors may reveal limited UI state depending on where styles land.
- **Suggested fix:** Rewrite EPUB resources to verified package-owned blobs, discard external URLs and remote author CSS, and enforce a CSP with `img-src`, `font-src`, and `connect-src` limited to self/blob/data as needed. Keep a visible opt-in for intentional remote cover fetching.

  ```ts
  const u = new URL(raw, location.href);
  if (u.protocol === 'http:' || u.protocol === 'https:') return undefined;
  return resolveVerifiedPackageResource(raw);
  ```

### F05 — Vulnerable `@xmldom/xmldom` is installed through EPUB.js

- **Severity:** High
- **Category:** Dependency / supply chain
- **Affected:** `package.json:51` (`epubjs` declaration); `package-lock.json:1391-1400,1713-1726,2402-2410`; `src/core/parsing/epub-parser.ts:90-95`.
- **Technical description:** The lockfile resolves `epubjs` 0.3.93 to `@xmldom/xmldom` 0.7.13. `npm audit --json` reports a high severity package entry with XML injection and quadratic-time/memory parsing advisories (for example [GHSA-wh4c-j3r5-mjhp](https://github.com/advisories/GHSA-wh4c-j3r5-mjhp) and [GHSA-965w-775f-mr7g](https://github.com/advisories/GHSA-965w-775f-mr7g)); `epubjs` receives a moderate dependent entry. Mammoth has a distinct 0.8.15 copy. The npm suggested fix is `epubjs` 0.4.2, a major version change.
- **Real-world impact:** Malformed EPUB XML may trigger excessive parse work, and vulnerable serialization APIs could permit markup injection if reached. Applicability of each individual advisory to WebXReader has not been proven.
- **Suggested fix:** Test EPUB.js 0.4.2 with the three reader engines, upgrade and lock the fixed transitive parser, and add crafted XML regression cases. If migration is delayed, evaluate a compatible override and confirm EPUB.js behavior in all modes.

  ```json
  { "dependencies": { "epubjs": "^0.4.2" } }
  ```

### F06 — CSP and common response security headers are absent on all hosts

- **Severity:** Medium
- **Category:** Deployment hardening
- **Affected:** `netlify.toml:1-4`; `vercel.json:1-3`; `firebase.json:1-11`; `index.html:59-86,90-114`; `vite.config.ts:18-28`.
- **Technical description:** None of the three hosting configs declares CSP, `X-Content-Type-Options`, `Referrer-Policy`, or `Permissions-Policy`. The inline service-worker bootstrap and JSON-LD script require CSP hashes or relocation. Vite emits source maps (`sourcemap: true`), potentially exposing readable application code on deployed hosts; this is not a secret leak by itself, but increases exploit research convenience. There is no iframe embedding policy. The epub.js iframe uses `sandbox="allow-same-origin"` with scripts disabled by default, which is a useful boundary, but a response CSP is still needed to constrain resources in both parent and content documents.
- **Real-world impact:** HTML/CSS injection paths have fewer browser-level barriers, third-party loads are unrestricted, and the site can be framed by other pages.
- **Suggested fix:** Apply the CSP and header examples below consistently on each host. Begin with `Content-Security-Policy-Report-Only` in a staging environment, then enforce after checking EPUB, PDF Worker, WASM, and offline mode. Move inline bootstrap to an external file or pin exact hashes.

  ```http
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  ```

### F07 — Comic Blob URLs are cached for the whole session and can outlive book switches

- **Severity:** Medium
- **Category:** Memory lifecycle / concurrency
- **Affected:** `src/formats/engines/CbzReader.tsx:368-405,409-478`; `src/formats/engines/ZipReader.tsx:150-162,385-417,828-843`.
- **Technical description:** CBZ Blob URLs are retained in a map until component unmount, with no near-page eviction or byte budget. A 200 MB comic can accumulate many inflated page Blobs plus decoded image surfaces during long sessions. On a `fileData` change while the same component instance remains mounted, the CBZ effect closes the old archive but does not clear its URL map; equal page indices can return old book images. Concurrent calls for one page can create duplicate URLs before either stores its result. ZIP image loading likewise inserts a URL after `await getEntryBlob` even if the collection closed or a new archive replaced it.
- **Real-world impact:** High memory use, stale pages after rapid book switching, and Blob URLs that are not reclaimed promptly.
- **Suggested fix:** Key caches by book/session generation, coalesce pending loads, retain only a small viewport window, and revoke URLs on each file/session change and late completion.

  ```ts
  const generation = ++generationRef.current;
  const blob = await loadPage(index);
  if (generation !== generationRef.current) return undefined;
  const url = URL.createObjectURL(blob);
  cache.set(index, url); // evict and revoke distant pages
  ```

### F08 — PDF import leaves the PDF.js loading task/document alive

- **Severity:** Medium
- **Category:** Worker and memory cleanup
- **Affected:** `src/core/parsing/pdf-parser.ts:59-67,152-167`; compare `src/formats/engines/PdfReader.tsx:378-402` and `src/formats/engines/PdfPageView.tsx:300-304`.
- **Technical description:** `parsePdf` creates a PDF.js loading task and document, renders a cover, and returns without destroying either in success or error paths. The interactive PDF reader does destroy its task on unmount, and page rendering cancels tasks, so this is specific to import. A malformed PDF that rejects `loadingTask.promise` also leaves cleanup to library internals.
- **Real-world impact:** Repeated imports can retain PDF Worker resources and large document buffers; large PDFs may compound memory pressure.
- **Suggested fix:** Use `finally` to destroy the task after all metadata and thumbnail work, including errors, and explicitly clean up page resources if required by the PDF.js version.

  ```ts
  const task = pdfjsLib.getDocument({ data: bytes });
  try {
    const doc = await task.promise;
    return await extractPdfSummary(doc);
  } finally {
    await task.destroy();
  }
  ```

### F09 — Import reads the full file more than once and has no top-level size cap

- **Severity:** Medium
- **Category:** Input bounds / browser freeze
- **Affected:** `src/features/import/import-service.ts:123-141,168-193,217-227`; representative parsers `src/formats/definitions/docx.ts:26-30`, `src/formats/definitions/pdf.ts:25-32`; `src/core/parsing/pdf-parser.ts:60-64`.
- **Technical description:** Only zero-byte files are rejected. Import reads the entire `File` into an ArrayBuffer for hashing, then most format definitions read it again to parse, and fixed-layout formats persist the original bytes. PDF parsing copies the buffer again. There is no global file cap, dynamic memory estimate, cancellation, or worker isolation. A normal 200 MB file can therefore create several simultaneous 200 MB allocations before any decompression or image decode.
- **Real-world impact:** Legitimate large books and malicious files can freeze or crash mobile and desktop tabs; the import dialog may offer no useful recovery.
- **Suggested fix:** Check a format-specific maximum before reading, hash as a stream where browser APIs allow, pass one buffer into the parser, avoid copies, and support abortable worker-based parsing.

  ```ts
  if (file.size > MAX_BYTES_BY_FORMAT[format.id]) {
    return { success: false, error: 'This file exceeds the safe size for this format.' };
  }
  return format.parseBuffer(arrayBuffer, { signal });
  ```

### F10 — ZIP entry checks do not impose a cumulative budget across nested formats

- **Severity:** Medium
- **Category:** Nested archive / resource exhaustion
- **Affected:** `src/core/parsing/zip-parser.ts:14-24,199-227,285-290`; `src/formats/engines/ZipReader.tsx:203-275,311-337`.
- **Technical description:** `parseZip` limits one archive to 500 MB declared expanded bytes, but an entry can be an EPUB, DOCX, CBZ, CBR, or CB7 and is handed to its parser with a fresh or absent limit. The reader does not recursively open a `.zip`/`.rar` entry as another archive, so an infinite archive-navigation loop was **not** found. Nested supported formats still multiply extraction work and memory. The ZIP cover path converts a potentially 100 MB image entry to base64; declared `_data` sizes are private JSZip fields and are not checked against actual decompressed output.
- **Real-world impact:** A ZIP that passes its own check can still trigger a second large decompression and peak-memory spike when an embedded document is opened.
- **Suggested fix:** Carry a shared byte and depth budget through every format parser; reject nested archive content that exceeds it, and cap cover bytes separately.

  ```ts
  const budget = new ParseBudget({ bytes: 300 << 20, depth: 2 });
  const entryBytes = await zip.readLimited(path, budget);
  await parseDetectedFormat(entryBytes, budget.child());
  ```

### F11 — Progress writes and metadata edits can race with deletion or each other

- **Severity:** Medium
- **Category:** IndexedDB concurrency / data integrity
- **Affected:** `src/hooks/useReadingProgress.ts:29-57,59-107`; `src/core/storage/database.ts:207-212,256-301,346-352`; `src/components/reader/ReaderView.tsx:298-356`.
- **Technical description:** A debounced progress write is flushed during unmount but runs asynchronously. `persistProgress` writes a progress row, then reads and overwrites a whole book record in a separate transaction. Deleting the book between these operations can recreate an orphan progress row; editing metadata or tags between the read and `updateBook` can be lost when the stale object is written. The reader's book loading effect has an `isMounted` guard, which handles ordinary route switches, but it does not serialize writes against delete/edit operations.
- **Real-world impact:** Progress can reappear after deletion, and simultaneous metadata edits can be overwritten by a page turn or tab switch.
- **Suggested fix:** Put progress and the book status update in one transaction, use a cursor/row existence check inside it, and update only intended fields from the latest stored record. On deletion, cancel or await pending saves for that book.

  ```ts
  const tx = db.transaction(['books', 'progress'], 'readwrite');
  const latest = await request(tx.objectStore('books').get(bookId));
  if (latest) {
    tx.objectStore('progress').put(progress);
    tx.objectStore('books').put({ ...latest, readingStatus: nextStatus });
  }
  ```

### F12 — Backup import/export materializes unbounded data in memory

- **Severity:** Medium
- **Category:** Storage / memory exhaustion
- **Affected:** `src/core/storage/database.ts:450-498,501-535,544-568,619-659`; `src/features/export/backup-service.ts:27-55`.
- **Technical description:** Export `getAll()`-loads all book content, base64-encodes every original file, builds one JSON object, and then `JSON.stringify`s the entire library. Restore reads a full JSON file into a string, parses it, validates recursive chapters to depth 100, decodes every original file to buffers, and then writes them. No backup byte, record-count, chapter-length, or aggregate decoded-size limit exists. The depth guard is useful but does not bound breadth or string size.
- **Real-world impact:** Backing up a library with a few 200 MB files or importing a crafted backup can exhaust memory and hang the UI. A backup can also fill IndexedDB quota after expensive decoding.
- **Suggested fix:** Set a backup size and aggregate decoded-byte cap, validate counts before decoding, and use a streamed/chunked export format rather than one JSON document.

  ```ts
  if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup is too large');
  validateBackupCounts(data, { books: 1_000, chapters: 100_000, bytes: 500 << 20 });
  ```

### F13 — Remote cover fallback bypasses the intended local copy and size controls

- **Severity:** Medium
- **Category:** Privacy / input validation
- **Affected:** `src/utils/cover-image.ts:23-32,98-132`; `src/components/library/BookCard.tsx:61,133-135`; `src/components/library/BookDetailsDialog.tsx:214-215`.
- **Technical description:** Cover URL import first tries CORS `fetch`; on any fetch failure it stores the remote URL directly after loading it in an `Image`. Subsequent library rendering re-requests that URL. The fallback cannot enforce the 20 MB response-size limit and may contact the host every time the library is opened. `response.blob()` in the successful branch also trusts a missing/false `Content-Length` and can buffer an arbitrarily large response before `optimizeImage` rejects it. This is user-triggered, but it should be explicit because it changes local-first behavior.
- **Real-world impact:** Repeated third-party requests reveal library activity and can consume bandwidth or memory through oversized remote images.
- **Suggested fix:** Remove the persistent URL fallback or require an explicit “keep remote cover” choice; cap bytes while streaming and make remote status visible in the library.

  ```ts
  const bytes = await readResponseWithLimit(response, 20 << 20);
  return optimizeImage(new Blob([bytes], { type: contentType }));
  ```

### F14 — Regex sanitizer fallback is unsafe if reused outside the browser

- **Status:** ✅ Resolved (Phase 1 — fail-closed return implemented when DOMPurify is unavailable)
- **Severity:** Low
- **Category:** Sanitization maintenance risk
- **Affected:** `src/core/parsing/sanitize-reader-html.ts:23-28,75-88`.
- **Technical description:** If DOMPurify cannot be initialized, `sanitizeReaderHtml` falls back to regexes that remove some quoted `on...` attributes and scripts/styles but leave unquoted handlers, URI schemes, and other active markup. In the current browser app DOMPurify should be present; this is primarily a future server/CLI/test reuse hazard. The fallback silently returns content that is materially less safe under the same function name.
- **Real-world impact:** A future non-browser importer or test harness could persist unsafe HTML and later trust it.
- **Suggested fix:** Fail closed or create a DOMPurify instance with an appropriate DOM implementation in that environment; never present regex filtering as equivalent sanitization.

  ```ts
  if (!sanitizeFn) throw new Error('HTML sanitizer is unavailable');
  return sanitizeFn(content, strictPolicy);
  ```

### F15 — Chapter splitting reintroduces text as markup after sanitization

- **Status:** ✅ Resolved (Phase 1 — `escapeHtml` wrapping on text nodes in `html-parser.ts`, `markdown-parser.ts`, and `mht-parser.ts`)
- **Severity:** Low
- **Category:** Encoding / latent injection bug
- **Affected:** `src/core/parsing/html-parser.ts:83-117`; `src/core/parsing/markdown-parser.ts:96-131`; `src/core/parsing/mht-parser.ts:418-457`.
- **Technical description:** After sanitization, each splitter wraps a `TEXT_NODE` using `` `<p>${node.textContent.trim()}</p>` `` without HTML escaping. Text such as `&lt;img ...&gt;` can become literal markup in the stored chapter. The current Scroll and Paginated readers sanitize again (`src/components/reader/ScrollReader.tsx:37`, `src/components/reader/PaginatedReader.tsx:54`), so this audit does **not** claim a current XSS through these paths. It does violate the parser's safe-output contract and may lose/misrender text; future consumers may omit the second boundary.
- **Real-world impact:** Corrupted display of angle-bracket text and a fragile security boundary for backup or future export/render paths.
- **Suggested fix:** Serialize text nodes or use the existing HTML escape helper before building markup; keep the reader-boundary sanitization.

  ```ts
  if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
    currentContent.push(`<p>${escapeHtml(node.textContent.trim())}</p>`);
  }
  ```

### F16 — Existing safety controls and scope limits

- **Severity:** Info / Bug
- **Category:** Verified protections and audit limitations
- **Affected:** `src/core/parsing/sanitize-reader-html.ts:33-72`; `src/components/reader/ScrollReader.tsx:37,258`; `src/components/reader/PaginatedReader.tsx:54,369`; `src/formats/engines/EpubReader.tsx:1246-1261`; `src/core/parsing/zip-parser.ts:125-141,175-227`; `src/core/storage/database.ts:232-253,256-301`; `public/sw.js:1-105`.
- **Technical description:** The common sanitizer allowlists HTML and attributes, forbids scripts, styles, iframes, objects, event handlers via DOMPurify, and strips SVG/MathML in its default mode. SVG is enabled only by alternate EPUB views and is passed through DOMPurify there; default DOMPurify URI rules still need a separate resource policy for network URLs. HTML, Markdown, DOCX and FB2 sanitize before storage, and normal reflow readers sanitize before `dangerouslySetInnerHTML`. The standard epub.js view explicitly disables scripted content; installed epub.js uses `sandbox="allow-same-origin"` without `allow-scripts` by default. General ZIP traversal checks and atomic IndexedDB bundle writes/deletes are present. No app telemetry code was found in source; external navigation and cover import are intentional features. These protections reduce exposure but do not cover F01–F15.
- **Real-world impact:** Gives maintainers a baseline for regression tests and avoids treating every `innerHTML`, `DOMParser`, or `blob:` reference as an independent exploit.
- **Suggested fix:** Preserve these boundaries while adding tests for encoded `</style>` EPUB CSS, `javascript:`/`data:`/`blob:` and external resource URLs, SVG/MathML and event attributes, compressed bombs, cancellation, and cleanup.

  ```ts
  expect(sanitizeReaderHtml('<svg onload=alert(1)></svg>')).not.toContain('onload');
  expect(sanitizeReaderHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
  ```

### F17 — The service worker caches unbounded successful requests

- **Severity:** Medium
- **Category:** Offline cache / storage exhaustion
- **Affected:** `public/sw.js:3-34,44-50,58-105`.
- **Technical description:** The fetch handler caches every successful request outside a small source/CSS bypass, with no same-origin test, pathname allowlist, response-size check, or cache entry cap. Third-party CORS responses with status 200 can enter the cache. Large resources requested by book content or user-selected remote covers can therefore occupy Cache Storage indefinitely until the cache version changes. `cache.put` promises in the network branches are not included in `respondWith`/`waitUntil`, so quota failures may become unhandled rejections. Activation also deletes every cache under the origin whose name differs from `webxreader-shell-v5`, including unrelated caches.
- **Real-world impact:** Offline storage can grow unexpectedly or evict IndexedDB data under browser quota pressure; cache writes may fail without useful feedback. Other same-origin apps' caches can be removed on activation.
- **Suggested fix:** Cache only known same-origin application shell assets and hashed bundles, reject opaque/cross-origin and large responses, cap entries/bytes, await cache writes safely, and delete only cache names with the WebXReader prefix.

  ```js
  if (url.origin !== self.location.origin || !isKnownShellAsset(url.pathname)) return;
  if (Number(response.headers.get('content-length') || 0) > MAX_CACHE_BYTES) return;
  event.waitUntil(cache.put(event.request, response.clone()).catch(() => {}));
  // During activate: if (key.startsWith('webxreader-') && key !== CACHE_NAME) ...
  ```

## Hardening and CSP recommendations

These examples assume **remote book resources are blocked** and the two existing inline scripts in `index.html` are retained with exact SHA-256 hashes. The hashes below match the audited file's current JSON-LD and service-worker bootstrap; recalculate after any whitespace/content edit. `wasm-unsafe-eval` is included for the WASM parsers. `style-src 'unsafe-inline'` is a compatibility concession for the app's inline styles and EPUB typography; remove it only after testing/refactoring. `frame-src 'self' blob:` supports epub.js `srcdoc`/Blob views; confirm browser behavior on all target hosts. Trial as Report-Only first, including offline mode, then enforce. A CSP alone does not fix F01 because inline style permission is currently needed.

Recommended policy value for each host:

```text
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self' 'wasm-unsafe-eval' 'sha256-pAhzgq746Wb1X9Oo5D9/1K6MlKiwTJ9S5jQU+5JUD/4=' 'sha256-wdjExacgIHVunnQDINHex2zNKa3u4Hk+MR+r3oi4PNU='; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; media-src 'none'; connect-src 'self' blob:; worker-src 'self' blob:; frame-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests
```

`netlify.toml`:

```toml
[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self' 'wasm-unsafe-eval' 'sha256-pAhzgq746Wb1X9Oo5D9/1K6MlKiwTJ9S5jQU+5JUD/4=' 'sha256-wdjExacgIHVunnQDINHex2zNKa3u4Hk+MR+r3oi4PNU='; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; media-src 'none'; connect-src 'self' blob:; worker-src 'self' blob:; frame-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "no-referrer"
    Permissions-Policy = "camera=(), microphone=(), geolocation=(), payment=()"
    X-Frame-Options = "DENY"
```

`vercel.json` (add `headers` beside the existing `ignoreCommand`):

```json
{
  "headers": [{
    "source": "/(.*)",
    "headers": [
      { "key": "Content-Security-Policy", "value": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self' 'wasm-unsafe-eval' 'sha256-pAhzgq746Wb1X9Oo5D9/1K6MlKiwTJ9S5jQU+5JUD/4=' 'sha256-wdjExacgIHVunnQDINHex2zNKa3u4Hk+MR+r3oi4PNU='; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; media-src 'none'; connect-src 'self' blob:; worker-src 'self' blob:; frame-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "no-referrer" },
      { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), payment=()" },
      { "key": "X-Frame-Options", "value": "DENY" }
    ]
  }]
}
```

`firebase.json` (add `headers` inside `hosting`):

```json
{
  "headers": [{
    "source": "**",
    "headers": [
      { "key": "Content-Security-Policy", "value": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self' 'wasm-unsafe-eval' 'sha256-pAhzgq746Wb1X9Oo5D9/1K6MlKiwTJ9S5jQU+5JUD/4=' 'sha256-wdjExacgIHVunnQDINHex2zNKa3u4Hk+MR+r3oi4PNU='; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; media-src 'none'; connect-src 'self' blob:; worker-src 'self' blob:; frame-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "no-referrer" },
      { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), payment=()" },
      { "key": "X-Frame-Options", "value": "DENY" }
    ]
  }]
}
```

`index.html`: HTTP response headers are authoritative for CSP, especially `frame-ancestors`; a meta tag cannot set that directive. After moving the inline service-worker bootstrap to a same-origin module, a defense-in-depth meta policy can be placed early in `<head>` on static hosts that cannot set headers. Keep it identical to the response policy except `frame-ancestors`, and remember it applies only after the parser reaches it:

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; object-src 'none'; base-uri 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-pAhzgq746Wb1X9Oo5D9/1K6MlKiwTJ9S5jQU+5JUD/4=' 'sha256-wdjExacgIHVunnQDINHex2zNKa3u4Hk+MR+r3oi4PNU='; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self' blob:; worker-src 'self' blob:; frame-src 'self' blob:">
<meta name="referrer" content="no-referrer">
```

For stricter isolation, remove `allow-same-origin` from untrusted EPUB iframes after adapting epub.js interaction code; the current reader reads their DOM directly, so this needs engineering work. Reject remote EPUB CSS/images before enabling the network-restricting policy. Consider disabling production sourcemaps if public source maps are not needed.

## Prioritized action checklist

- [x] **Phase 1 — Stop F01:** remove raw EPUB author CSS from main-document `innerHTML`; assign via DOM `textContent`; sanitize against `</style>`, comments, and active markup; add unit and integration regression tests.
- [x] **Phase 1 — Block book-initiated network traffic (F04 reader layer):** enforce local package-owned blob resolution; strip external network URLs on embedded media/images and in author CSS.
- [x] **Phase 1 — Keep sanitizer contracts explicit (F14, F15):** fail closed if DOMPurify is unavailable, escape text during chapter splitting with `escapeHtml(...)`, and preserve reader-boundary sanitization.
- [ ] **Phase 2 — Harden every host (F06):** add the common headers and CSP to Netlify, Vercel, and Firebase; recalculate CSP hashes whenever `index.html` changes.
- [ ] **Phase 2 — Restrict service worker caching (F17):** restrict service-worker caching to same-origin app shell assets with size caps.
- [ ] **Phase 3 — Fix lifecycle and races (F07, F08, F11, F13):** destroy import-time PDF.js tasks in `finally`, revoke/evict comic URLs on book changes, serialize progress updates with deletion and metadata edits, and cap remote cover streaming.
- [ ] **Phase 4 — Contain archive expansion (F02, F03, F10):** enforce pre-extraction and actual-output limits in 7-Zip and all ZIP-family formats, run heavy parsing off the main thread, and make cancellation/exit errors explicit.
- [ ] **Phase 4 — Upgrade EPUB.js / xmldom (F05):** test the 0.4.2 migration across all three EPUB engines and pin the fixed parser (or configure npm override).
- [ ] **Phase 4 — Bound input and backup memory (F09, F12):** size-check files before reading, reuse buffers, cap nested parse budgets and cover bytes, and stream large backups.

## Audit method and limitations

Reviewed source call sites for `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `DOMParser`, iframe usage, `DOMPurify`, URL creation/revocation, archive extraction, storage, network calls, Worker/PDF cleanup, and deployment configuration. `npm audit --json` completed against the installed lockfile. No application build was run, no live browser/network capture was performed, and no exploit payload or 200 MB archive was executed. Live response headers on deployed mirrors were not queried, so the configuration conclusion applies to the checked-in files; platform-level headers could differ.
