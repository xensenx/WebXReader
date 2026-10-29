# WXR-AUDIT-REPORT.md

Delivered in this response because no output location was specified. No report or project files were created or modified.

## 1. Executive summary

The source review found one confirmed security vulnerability and three confirmed functional or data-integrity defects. It also identified two import risks that are strongly supported by the code but were not dynamically reproduced.

The most serious issue is a persistent same-origin XSS path through backup restore: imported backup chapter HTML is stored without sanitization and later inserted into the reader with dangerouslySetInnerHTML. Normal HTML and Markdown imports do sanitize content, so this finding is specific to the restore path.

The confirmed functional and data-integrity defects are:

- Dragging books while a search or filter is active removes hidden books from the saved custom order.
- A version 2 backup with missing book content can be reported as restored, leaving unreadable library entries.
- A settings persistence failure is caught and logged as success, so a reset can appear complete and revert after reload.

The worktree remained clean. Existing tests passed; lint exited successfully with warnings only.

## 2. Repository and environment details

- Branch and commit: jules/audit, f6d36ef
- Initial and final Git status: ## jules/audit...origin/jules/audit; no tracked or untracked changes.
- Runtime: Node v24.22.1, npm 11.19.1
- Key locked dependencies: DOMPurify 3.4.17, epub.js 0.3.93, JSZip 3.10.2, marked 18.1.1, pdfjs-dist 6.4.299, React 19.3.1, Vite 8.3.5, Vitest 5.0.5
- Application: React/Vite client-side reader using IndexedDB, localStorage, sessionStorage, and a service worker.
- Data handling: Books and reading data are stored locally; backup restore accepts a user-selected JSON file.
- Scope boundary: This was a repository source review. No live deployment, production browser data, secrets, credentials, or unrelated files were accessed.

## 3. Audit scope and coverage matrix

| Subsystem | Files inspected | Verification performed | Remaining gaps |
|---|---|---|---|
| Import and format registry | src/features/import/import-service.ts, src/formats/registry.ts, format definitions, src/core/parsing/* | Traced extension detection, file reads, parsing, hashing, persistence; ran existing import and parser tests | No hostile or oversized documents were processed |
| HTML, Markdown, and text rendering | src/core/parsing/html-parser.ts, src/core/parsing/markdown-parser.ts, src/core/parsing/txt-parser.ts, ScrollReader.tsx, PaginatedReader.tsx | Traced sanitization/escaping into reader sinks; Markdown sanitizer test passed | No browser XSS execution test |
| EPUB | epub-parser.ts, EpubReader.tsx, EPUB format definition | Reviewed script setting, resource resolution, image and srcset handling | No browser network capture; epub.js runtime behavior not dynamically verified |
| PDF | pdf-parser.ts, pdf-init.ts, PdfReader.tsx, PDF format definition | Reviewed parsing, worker configuration, text/page rendering; PDF import test passed | No malformed PDF or browser rendering test |
| CBZ | cbz-parser.ts, CbzReader.tsx, CBZ format definition | Reviewed archive entry selection, XML metadata, page loading and URL cleanup; parser/import tests passed | No ZIP bomb, malformed archive, or memory-limit test |
| Storage and data lifecycle | database.ts, storage hooks, types/book.ts | Reviewed schema, CRUD transactions, deletion, settings fallback, backup restore; fake IndexedDB tests passed | No real-browser quota, private-mode, migration, or multi-tab test |
| Backup and restore | backup-service.ts, database.ts, settings restore UI | Traced JSON parsing through validation and database writes; round-trip tests passed | No malformed or adversarial backup test |
| Library state and ordering | LibraryView.tsx, library-state.ts, scroll restoration, library tests | Reviewed search/filter/sort/order paths; existing helper tests passed | Drag-and-drop UI behavior not exercised in a browser |
| Settings reset and database clearing | SettingsView.tsx, useSettings.ts, settings context, database helpers | Compared reset and clear operations and their storage paths | No storage-write failure injection; no dedicated reset test |
| Browser, build, and deployment configuration | index.html, public/sw.js, Vite/Firebase config, GitHub workflow | Read source and configuration; verified deployment workflow is limited to pushes to main | No live hosting headers, Cloudflare configuration, or deployed service-worker behavior verified |
| Dependencies | package.json, package-lock.json | Checked locked versions and local installed tooling | No external vulnerability database or CVE lookup was used |

## 4. Confirmed security findings

### WXR-SEC-001 — Restored backup chapter HTML reaches an executable reader sink

Classification: Security vulnerability — stored XSS
Severity: Medium. Requires a user to restore an attacker-supplied backup and open the affected book, but execution then occurs in the WebXReader origin and can access the app’s local data.
Confidence: High
Status: Confirmed by source-to-sink trace; exploitation was not executed.

Exact location: Backup file parsing at backup-service.ts:45 (/F:/webxReader/src/features/export/backup-service.ts:45); restore content handling at database.ts:582 (/F:/webxReader/src/core/storage/database.ts:582) and database.ts:591 (/F:/webxReader/src/core/storage/database.ts:591); reader insertion at ScrollReader.tsx:209 (/F:/webxReader/src/components/reader/ScrollReader.tsx:209) and PaginatedReader.tsx:351 (/F:/webxReader/src/components/reader/PaginatedReader.tsx:351).

Evidence: The restore UI parses a selected JSON file and passes it to restoreBackup. The backup validator checks a few top-level fields and basic book properties, but restored contents[].chapters are deserialized and stored without sanitizing chapter.content. ReaderView uses those stored chapters, and both scroll and paginated readers insert chapter HTML through dangerouslySetInnerHTML.

Regular HTML and Markdown imports use DOMPurify, and TXT content is escaped. Those protections do not run on restored backup content.

Trigger conditions: An attacker supplies a crafted backup file; the user selects it in the restore flow and opens the restored book.

Reproduction steps: In an isolated local test, create a structurally valid version 2 backup with a new book and a chapter containing HTML such as <img src="x" onerror="document.documentElement.dataset.audit='fired'">. Restore it, then open the book in scroll or paginated mode. This was not run.

Expected behaviour: Restored chapter content should be validated and sanitized before storage or before insertion into the DOM.

Actual or predicted behaviour: Static tracing shows the stored string reaches an HTML injection sink unchanged. An event-handler payload can execute when the reader renders it.

Impact: Code executing in the app origin can access or alter WebXReader’s IndexedDB and localStorage data, including book contents, bookmarks, progress, and preferences. It could also send data out of the browser if the deployment permits network requests.

Root cause: Backup restore treats imported chapter HTML as trusted content, while reader components treat stored chapter strings as safe HTML.

Recommended remediation: Validate backup records and sanitize chapter HTML with the same restrictive policy used for HTML/Markdown imports. Also protect the rendering boundary so legacy or restored content cannot bypass sanitization.

Regression test: Restore a backup containing event handlers, scriptable elements, and unsafe URLs; verify rendered chapter DOM has no executable attributes or unsafe elements.

Limitations: The source-to-sink path is confirmed, but a browser execution was not performed. Deployment-level CSP headers were not verified.

Attack prerequisites and boundary: The attacker must get a backup file to the user and persuade them to restore it. The affected boundary is untrusted backup data entering same-origin HTML rendering. Exploitation was not demonstrated.

## 5. Confirmed functional and data-integrity bugs

### WXR-BUG-001 — Dragging in a filtered library discards hidden books from custom order

Classification: Functional bug / preference data-integrity defect
Severity: Low. It changes saved shelf ordering, but does not delete books or reading data.
Confidence: High
Status: Confirmed by source review; browser drag interaction was not reproduced.

Exact location: LibraryView.tsx:361 (/F:/webxReader/src/components/library/LibraryView.tsx:361), LibraryView.tsx:365 (/F:/webxReader/src/components/library/LibraryView.tsx:365), LibraryView.tsx:380 (/F:/webxReader/src/components/library/LibraryView.tsx:380), and LibraryView.tsx:392 (/F:/webxReader/src/components/library/LibraryView.tsx:392).

Evidence: During drag-over, the handler filters the existing order down to filteredBooks, reorders that subset, then on drag end persists the resulting array as customBookOrder. IDs for books hidden by the current search or filter are dropped. When those books become visible again, they receive fallback positions based on import time.

Trigger conditions: A custom order already exists; a search or filter hides one or more books; the user drags visible books.

Reproduction steps: Create a custom order for several books, filter out one book, drag two visible books, then clear the filter and select custom order. This was not run in the UI.

Expected behaviour: Reordering visible books should preserve the saved positions of books that are currently hidden.

Actual or predicted behaviour: Hidden IDs are removed from the persisted array, so their prior positions are lost and they fall back to import-time ordering.

Impact: Users can unintentionally lose custom arrangement for books outside the current view.

Root cause: The drag handler rebuilds the entire saved order from only the currently visible IDs.

Recommended remediation: Reorder visible IDs within the full saved order while retaining hidden IDs and their relative positions.

Regression test: Exercise the production reorder handler with a filtered list; verify hidden IDs remain in the persisted order and retain their relative order.

Limitations: The state transformation and persistence are directly visible in code, but no browser drag test was performed.

———

### WXR-DATA-001 — Version 2 backup without matching content creates unreadable book records

Classification: Data-integrity defect
Severity: Low. Restore is additive and does not overwrite existing books, but it can create library entries that cannot be opened.
Confidence: High
Status: Confirmed by source review; not dynamically reproduced.

Exact location: database.ts:519 (/F:/webxReader/src/core/storage/database.ts:519), database.ts:553 (/F:/webxReader/src/core/storage/database.ts:553), database.ts:604 (/F:/webxReader/src/core/storage/database.ts:604), database.ts:607 (/F:/webxReader/src/core/storage/database.ts:607), and database.ts:609 (/F:/webxReader/src/core/storage/database.ts:609). The user-facing restore status is at SettingsView.tsx:149 (/F:/webxReader/src/components/settings/SettingsView.tsx:149).

Evidence: Top-level validation does not require a contents array for version 2 backups. Restore writes each valid book record even when no matching content exists. It adds a missing-content error only for version 1 backups. The UI then reports the number of restored books.

Trigger conditions: The user restores a version 2 backup with a valid book record but with contents missing or without content for that book.

Reproduction steps: In an isolated test, restore a version 2 payload with the required top-level arrays and a realistic new book record but no matching content record. This was not run.

Expected behaviour: Reject the incomplete backup or skip the affected book and report that its content is missing.

Actual or predicted behaviour: The book metadata is stored and counted as restored; opening it later fails because the book content record is absent.

Impact: The library can show an entry that cannot be read, and the restore status can imply success despite missing book content.

Root cause: Version 2 content completeness is not validated, and the missing-content error branch is limited to version 1.

Recommended remediation: Require matching content for each restored version 2 book, or explicitly skip and report books without content.

Regression test: Restore version 2 payloads with missing contents and missing per-book content; verify no unreadable book is added and the user receives a clear error.

Limitations: The defect is established from the restore code path. No malformed backup was submitted through the UI.

———

### WXR-BUG-002 — Settings persistence errors are swallowed, so reset can appear successful

Classification: Functional bug
Severity: Low. It requires both the localStorage write and IndexedDB fallback write to fail; preferences can then revert after reload.
Confidence: High
Status: Confirmed by source review; storage failures were not injected.

Exact location: useSettings.ts:104 (/F:/webxReader/src/hooks/useSettings.ts:104), useSettings.ts:107 (/F:/webxReader/src/hooks/useSettings.ts:107), useSettings.ts:123 (/F:/webxReader/src/hooks/useSettings.ts:123), useSettings.ts:126 (/F:/webxReader/src/hooks/useSettings.ts:126), and SettingsView.tsx:163 (/F:/webxReader/src/components/settings/SettingsView.tsx:163).

Evidence: Both resetSettings and updateSettings catch persistence errors and only log them. SettingsView has a catch path intended to report reset failures, but resetSettings resolves even when saveSettings fails, so that path is not reached.

Trigger conditions: localStorage.setItem fails and the IndexedDB fallback write also fails, for example under a storage or quota failure.

Reproduction steps: Mock both persistence backends to reject during a reset, then reload the app. This was not run.

Expected behaviour: The reset flow should surface that preferences were not persisted and should not present the operation as complete.

Actual or predicted behaviour: In-memory settings reset, the confirmation flow treats the call as successful, and the prior persisted settings can return on reload.

Impact: Users may believe a reset or preference change is permanent when it was only applied in memory.

Root cause: Storage failures are suppressed inside the settings hook instead of being returned to the caller.

Recommended remediation: Propagate persistence failures or return an explicit success result so the UI can report failure. Apply the same behavior to ordinary settings updates.

Regression test: Force localStorage and IndexedDB writes to fail; verify reset and update flows surface the failure and do not report persistence success.

Limitations: The failure path is clear from the code, but both-backend failure behavior was not dynamically tested.

## 6. Strongly supported but unconfirmed concerns

### WXR-SEC-002 — EPUB image references can retain external URLs

Classification: Security vulnerability — privacy exposure
Severity: Low. It can expose request metadata and reading activity to an external host, but requires the user to open the EPUB.
Confidence: Medium
Status: Strongly Supported; no browser network request was observed.

Exact location: EpubReader.tsx:64 (/F:/webxReader/src/formats/engines/EpubReader.tsx:64), EpubReader.tsx:85 (/F:/webxReader/src/formats/engines/EpubReader.tsx:85), EpubReader.tsx:201 (/F:/webxReader/src/formats/engines/EpubReader.tsx:201), and EpubReader.tsx:204 (/F:/webxReader/src/formats/engines/EpubReader.tsx:204). The image hook is registered at EpubReader.tsx:513 (/F:/webxReader/src/formats/engines/EpubReader.tsx:513); the rendition disables scripted content at EpubReader.tsx:505 (/F:/webxReader/src/formats/engines/EpubReader.tsx:505).

Evidence: resolveEpubResource returns no replacement for HTTP(S) URLs. The caller only changes an image’s src when a replacement exists, leaving an external source intact. The same pattern preserves unresolved srcset entries. Disabling scripted content does not itself block image requests.

Attack prerequisites: An attacker supplies an EPUB containing an external image URL, and the user imports and opens it while online.

Reproduction steps: In an isolated reader test with a controlled local endpoint, open an EPUB containing an image URL with a unique path and inspect the browser’s network requests. This was not run.

Expected behaviour: Remote EPUB resources should be blocked or require explicit user consent, consistent with a local-first reader.

Actual or predicted behaviour: The source code leaves unresolved remote image references in the EPUB document, so the browser may request them when displaying the page.

Impact: A remote host may learn that the book was opened and receive the reader’s IP address and ordinary request metadata. No book contents are shown to be sent by this path.

Root cause: The resource resolver declines external URLs but the caller does not remove them.

Recommended remediation: Remove external src and srcset values when resolution fails, or require explicit opt-in. A restrictive content policy for EPUB frames can provide defense in depth.

Regression test: Open an EPUB containing external src and srcset references with a controlled request monitor; verify no outbound request occurs by default.

Limitations: epub.js may independently rewrite or filter some references, and deployment headers may add protections. Neither was verified dynamically. No production or external endpoint was contacted.

———

### WXR-SEC-003 — CBZ processing has no explicit archive or decompression limits

Classification: Security vulnerability — client-side resource exhaustion
Severity: Low. It requires a user to select the archive and primarily threatens that user’s browser tab.
Confidence: Medium
Status: Strongly Supported; no resource-exhaustion input was generated or processed.

Exact location: import-service.ts:120 (/F:/webxReader/src/features/import/import-service.ts:120), import-service.ts:141 (/F:/webxReader/src/features/import/import-service.ts:141), ImportDialog.tsx:81 (/F:/webxReader/src/components/library/ImportDialog.tsx:81), cbz.ts:28 (/F:/webxReader/src/formats/definitions/cbz.ts:28), cbz-parser.ts:369 (/F:/webxReader/src/core/parsing/cbz-parser.ts:369), and CbzReader.tsx:294 (/F:/webxReader/src/formats/engines/CbzReader.tsx:294).

Evidence: Import checks only for a zero-byte file before reading the entire file for hashing. The CBZ parser loads the archive with JSZip and extracts the cover without checking entry count or expanded size. The reader later decompresses pages to blobs. The import-size setting produces a warning, not a rejection or resource limit.

Attack prerequisites: The user selects a malicious or unusually large CBZ. Resulting memory and CPU use depend on archive structure, browser, and device.

Reproduction steps: No ZIP bomb or large archive was generated; this was intentionally not stress-tested. A safe verification would mock archive metadata and assert that configured file, entry-count, and expanded-size limits reject input before decompression.

Expected behaviour: Apply bounded file, entry-count, decompressed-size, and image-dimension limits before processing or rendering.

Actual or predicted behaviour: No such limits were found in the inspected import and CBZ paths; expensive reads and decompression can proceed.

Impact: A sufficiently large or highly compressed archive may freeze the tab or cause the browser to terminate it.

Root cause: Archive processing relies on JSZip and browser image decoding without application-level resource budgets.

Recommended remediation: Add explicit limits and reject over-budget archives before decompressing entries; keep the existing size warning as a user aid, not the enforcement mechanism.

Regression test: Use mocked archive entries with oversized declared output or excessive entry counts and verify rejection without invoking full decompression.

Limitations: The actual failure threshold is device- and browser-dependent. No destructive resource test was performed.

## 7. Informational observations and optional hardening

- Normal HTML and Markdown imports use DOMPurify and forbid images and active media; TXT content is escaped. The confirmed XSS path is the backup restore boundary.
- EPUB rendition sets allowScriptedContent: false. The remaining concern is external resource loading, not EPUB JavaScript execution.
- CBZ paths are read as in-memory archive entries; no archive paths are written to the filesystem, so no path-traversal-to-filesystem issue was identified.
- deleteBook deletes associated content, progress, bookmarks, annotations, book settings, and covers in one transaction. clearDatabase clears library stores while preserving general preferences. The inspected code and existing storage tests support that separation.
- No general telemetry or application data upload path was found in the inspected source. EPUB remote image requests and user-entered cover URLs are exceptions to local-only processing.
- The production build config enables source maps. This is not a secret exposure finding for this repository; consider whether deployed .map files are intended to be public.
- Locked dependencies were inspected, but no CVE or external vulnerability database check was performed. No dependency vulnerability is asserted.

## 8. Tests and diagnostic commands executed

- .\node_modules\.bin\vitest.cmd run --no-cache --no-fsModuleCache — passed: 11 test files, 45 tests. Vitest printed Not implemented: Window's scrollTo() method; it did not fail a test.
- npm run lint — completed successfully with warnings.
- .\node_modules\.bin\oxlint.cmd — exit code 0; 83 warning mentions and no errors. Warnings were primarily React effect/ref patterns and hook dependency warnings.
- node --version — v24.22.1.
- npm --version — 11.19.1.
- Inspected package lock for exact versions of the listed direct dependencies.
- Inspected Git history for the latest settings-reset and custom-order changes.
- git status --short --branch --untracked-files=all — clean at start and finish.

The Vitest run disabled its result and filesystem-module caches. Tests use JSDOM and fake IndexedDB; they did not touch a real browser profile. The build was not run because the configured build emits dist and TypeScript build metadata.

## 9. Areas not tested and limitations

- No browser-based reproduction of XSS, EPUB network requests, drag-and-drop ordering, or storage failures.
- No adversarial EPUB, PDF, CBZ, or malformed backup was processed.
- No real-browser quota, private-mode, legacy migration, or multi-tab concurrency testing.
- No cross-browser or responsive-layout testing.
- No production deployment headers, Cloudflare settings, or live service-worker behavior were inspected.
- No external dependency advisory or CVE database was queried.
- Tests validate several parser, storage, backup round-trip, and helper paths, but do not cover the reported bypasses or filtered drag interaction. Passing tests do not rule out these findings.

## 10. Prioritized remediation plan

1. Close the backup XSS path: sanitize restored chapter HTML and enforce safety at the reader rendering boundary.
2. Block external EPUB resource requests by default: remove unresolved HTTP(S) image and srcset references; add a restrictive frame content policy where deployment supports it.
3. Validate backup completeness: require matching content for version 2 books and report or skip incomplete records.
4. Add CBZ resource budgets: cap compressed input, archive entries, expanded bytes, and image dimensions before costly processing.
5. Preserve hidden IDs during custom reorder: update visible positions within the complete saved order and add a filtered-drag regression test.
6. Propagate settings write failures: let reset and update UI report persistence errors instead of logging and returning success.
  Worked for 7m 10s • 00:43