# Security Findings

This document contains detailed security findings, threat models, affected code paths, evidence, reproduction conditions, and remediation recommendations.

## WXR-SEC-001 — Restored backup chapter HTML reaches an executable reader sink

- **Classification:** Security vulnerability — stored XSS
- **Severity:** Medium
- **Confidence:** High
- **Status:** Confirmed by source-to-sink trace; exploitation was not executed.

**Exact location:**
- Backup file parsing at `src/features/export/backup-service.ts:45`
- Restore content handling at `src/core/storage/database.ts:582` and `src/core/storage/database.ts:591`
- Reader insertion at `src/components/reader/ScrollReader.tsx:209` and `src/components/reader/PaginatedReader.tsx:351`

**Evidence:**
The restore UI parses a selected JSON file and passes it to `restoreBackup`. The backup validator checks a few top-level fields and basic book properties, but restored `contents[].chapters` are deserialized and stored without sanitizing `chapter.content`. `ReaderView` uses those stored chapters, and both scroll and paginated readers insert chapter HTML through `dangerouslySetInnerHTML`. Regular HTML and Markdown imports use DOMPurify, and TXT content is escaped. Those protections do not run on restored backup content.

**Trigger conditions:**
An attacker supplies a crafted backup file; the user selects it in the restore flow and opens the restored book.

**Reproduction steps:**
In an isolated local test, create a structurally valid version 2 backup with a new book and a chapter containing HTML such as `<img src="x" onerror="document.documentElement.dataset.audit='fired'">`. Restore it, then open the book in scroll or paginated mode. This was not run.

**Expected behaviour:**
Restored chapter content should be validated and sanitized before storage or before insertion into the DOM.

**Actual or predicted behaviour:**
Static tracing shows the stored string reaches an HTML injection sink unchanged. An event-handler payload can execute when the reader renders it.

**Impact:**
Code executing in the app origin can access or alter WebXReader’s IndexedDB and localStorage data, including book contents, bookmarks, progress, and preferences. It could also send data out of the browser if the deployment permits network requests.

**Root cause:**
Backup restore treats imported chapter HTML as trusted content, while reader components treat stored chapter strings as safe HTML.

**Recommended remediation:**
Validate backup records and sanitize chapter HTML with the same restrictive policy used for HTML/Markdown imports. Also protect the rendering boundary so legacy or restored content cannot bypass sanitization.

**Regression test:**
Restore a backup containing event handlers, scriptable elements, and unsafe URLs; verify rendered chapter DOM has no executable attributes or unsafe elements.

**Limitations:**
The source-to-sink path is confirmed, but a browser execution was not performed. Deployment-level CSP headers were not verified.

**Attack prerequisites and boundary:**
The attacker must get a backup file to the user and persuade them to restore it. The affected boundary is untrusted backup data entering same-origin HTML rendering. Exploitation was not demonstrated.

---

## WXR-SEC-002 — EPUB image references can retain external URLs

- **Classification:** Security vulnerability — privacy exposure
- **Severity:** Low
- **Confidence:** Medium
- **Status:** Strongly Supported; no browser network request was observed.

**Exact location:**
- `src/formats/engines/EpubReader.tsx:64`, `src/formats/engines/EpubReader.tsx:85`, `src/formats/engines/EpubReader.tsx:201`, `src/formats/engines/EpubReader.tsx:204`.
- The image hook is registered at `src/formats/engines/EpubReader.tsx:513`; the rendition disables scripted content at `src/formats/engines/EpubReader.tsx:505`.

**Evidence:**
`resolveEpubResource` returns no replacement for HTTP(S) URLs. The caller only changes an image’s `src` when a replacement exists, leaving an external source intact. The same pattern preserves unresolved `srcset` entries. Disabling scripted content does not itself block image requests.

**Attack prerequisites:**
An attacker supplies an EPUB containing an external image URL, and the user imports and opens it while online.

**Reproduction steps:**
In an isolated reader test with a controlled local endpoint, open an EPUB containing an image URL with a unique path and inspect the browser’s network requests. This was not run.

**Expected behaviour:**
Remote EPUB resources should be blocked or require explicit user consent, consistent with a local-first reader.

**Actual or predicted behaviour:**
The source code leaves unresolved remote image references in the EPUB document, so the browser may request them when displaying the page.

**Impact:**
A remote host may learn that the book was opened and receive the reader’s IP address and ordinary request metadata. No book contents are shown to be sent by this path.

**Root cause:**
The resource resolver declines external URLs but the caller does not remove them.

**Recommended remediation:**
Remove external `src` and `srcset` values when resolution fails, or require explicit opt-in. A restrictive content policy for EPUB frames can provide defense in depth.

**Regression test:**
Open an EPUB containing external `src` and `srcset` references with a controlled request monitor; verify no outbound request occurs by default.

**Limitations:**
epub.js may independently rewrite or filter some references, and deployment headers may add protections. Neither was verified dynamically. No production or external endpoint was contacted.

---

## WXR-SEC-003 — CBZ processing has no explicit archive or decompression limits

- **Classification:** Security vulnerability — client-side resource exhaustion
- **Severity:** Low
- **Confidence:** Medium
- **Status:** Strongly Supported; no resource-exhaustion input was generated or processed.

**Exact location:**
- `src/features/import/import-service.ts:120`, `src/features/import/import-service.ts:141`
- `src/components/library/ImportDialog.tsx:81`
- `src/formats/definitions/cbz.ts:28`
- `src/core/parsing/cbz-parser.ts:369`
- `src/formats/engines/CbzReader.tsx:294`

**Evidence:**
Import checks only for a zero-byte file before reading the entire file for hashing. The CBZ parser loads the archive with JSZip and extracts the cover without checking entry count or expanded size. The reader later decompresses pages to blobs. The import-size setting produces a warning, not a rejection or resource limit.

**Attack prerequisites:**
The user selects a malicious or unusually large CBZ. Resulting memory and CPU use depend on archive structure, browser, and device.

**Reproduction steps:**
No ZIP bomb or large archive was generated; this was intentionally not stress-tested. A safe verification would mock archive metadata and assert that configured file, entry-count, and expanded-size limits reject input before decompression.

**Expected behaviour:**
Apply bounded file, entry-count, decompressed-size, and image-dimension limits before processing or rendering.

**Actual or predicted behaviour:**
No such limits were found in the inspected import and CBZ paths; expensive reads and decompression can proceed.

**Impact:**
A sufficiently large or highly compressed archive may freeze the tab or cause the browser to terminate it.

**Root cause:**
Archive processing relies on JSZip and browser image decoding without application-level resource budgets.

**Recommended remediation:**
Add explicit limits and reject over-budget archives before decompressing entries; keep the existing size warning as a user aid, not the enforcement mechanism.

**Regression test:**
Use mocked archive entries with oversized declared output or excessive entry counts and verify rejection without invoking full decompression.

**Limitations:**
The actual failure threshold is device- and browser-dependent. No destructive resource test was performed.
