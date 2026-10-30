# Functional and Data-Integrity Bugs

This document outlines detailed functional bugs, data-integrity issues, compatibility failures, reproduction steps, and regression-test proposals.

## WXR-BUG-001 — Dragging in a filtered library discards hidden books from custom order

- **Classification:** Functional bug / preference data-integrity defect
- **Severity:** Low. It changes saved shelf ordering, but does not delete books or reading data.
- **Confidence:** High
- **Status:** Confirmed by source review; browser drag interaction was not reproduced.

**Exact location:**
`src/components/library/LibraryView.tsx:361`, `src/components/library/LibraryView.tsx:365`, `src/components/library/LibraryView.tsx:380`, and `src/components/library/LibraryView.tsx:392`.

**Evidence:**
During drag-over, the handler filters the existing order down to `filteredBooks`, reorders that subset, then on drag end persists the resulting array as `customBookOrder`. IDs for books hidden by the current search or filter are dropped. When those books become visible again, they receive fallback positions based on import time.

**Trigger conditions:**
A custom order already exists; a search or filter hides one or more books; the user drags visible books.

**Reproduction steps:**
Create a custom order for several books, filter out one book, drag two visible books, then clear the filter and select custom order. This was not run in the UI.

**Expected behaviour:**
Reordering visible books should preserve the saved positions of books that are currently hidden.

**Actual or predicted behaviour:**
Hidden IDs are removed from the persisted array, so their prior positions are lost and they fall back to import-time ordering.

**Impact:**
Users can unintentionally lose custom arrangement for books outside the current view.

**Root cause:**
The drag handler rebuilds the entire saved order from only the currently visible IDs.

**Recommended remediation:**
Reorder visible IDs within the full saved order while retaining hidden IDs and their relative positions.

**Regression test:**
Exercise the production reorder handler with a filtered list; verify hidden IDs remain in the persisted order and retain their relative order.

**Limitations:**
The state transformation and persistence are directly visible in code, but no browser drag test was performed.

---

## WXR-DATA-001 — Version 2 backup without matching content creates unreadable book records

- **Classification:** Data-integrity defect
- **Severity:** Low. Restore is additive and does not overwrite existing books, but it can create library entries that cannot be opened.
- **Confidence:** High
- **Status:** Confirmed by source review; not dynamically reproduced.

**Exact location:**
- `src/core/storage/database.ts:519`, `src/core/storage/database.ts:553`, `src/core/storage/database.ts:604`, `src/core/storage/database.ts:607`, and `src/core/storage/database.ts:609`.
- The user-facing restore status is at `src/components/settings/SettingsView.tsx:149`.

**Evidence:**
Top-level validation does not require a contents array for version 2 backups. Restore writes each valid book record even when no matching content exists. It adds a missing-content error only for version 1 backups. The UI then reports the number of restored books.

**Trigger conditions:**
The user restores a version 2 backup with a valid book record but with contents missing or without content for that book.

**Reproduction steps:**
In an isolated test, restore a version 2 payload with the required top-level arrays and a realistic new book record but no matching content record. This was not run.

**Expected behaviour:**
Reject the incomplete backup or skip the affected book and report that its content is missing.

**Actual or predicted behaviour:**
The book metadata is stored and counted as restored; opening it later fails because the book content record is absent.

**Impact:**
The library can show an entry that cannot be read, and the restore status can imply success despite missing book content.

**Root cause:**
Version 2 content completeness is not validated, and the missing-content error branch is limited to version 1.

**Recommended remediation:**
Require matching content for each restored version 2 book, or explicitly skip and report books without content.

**Regression test:**
Restore version 2 payloads with missing contents and missing per-book content; verify no unreadable book is added and the user receives a clear error.

**Limitations:**
The defect is established from the restore code path. No malformed backup was submitted through the UI.

---

## WXR-BUG-002 — Settings persistence errors are swallowed, so reset can appear successful

- **Classification:** Functional bug
- **Severity:** Low. It requires both the localStorage write and IndexedDB fallback write to fail; preferences can then revert after reload.
- **Confidence:** High
- **Status:** Confirmed by source review; storage failures were not injected.

**Exact location:**
- `src/hooks/useSettings.ts:104`, `src/hooks/useSettings.ts:107`, `src/hooks/useSettings.ts:123`, `src/hooks/useSettings.ts:126`
- `src/components/settings/SettingsView.tsx:163`

**Evidence:**
Both `resetSettings` and `updateSettings` catch persistence errors and only log them. `SettingsView` has a catch path intended to report reset failures, but `resetSettings` resolves even when `saveSettings` fails, so that path is not reached.

**Trigger conditions:**
`localStorage.setItem` fails and the IndexedDB fallback write also fails, for example under a storage or quota failure.

**Reproduction steps:**
Mock both persistence backends to reject during a reset, then reload the app. This was not run.

**Expected behaviour:**
The reset flow should surface that preferences were not persisted and should not present the operation as complete.

**Actual or predicted behaviour:**
In-memory settings reset, the confirmation flow treats the call as successful, and the prior persisted settings can return on reload.

**Impact:**
Users may believe a reset or preference change is permanent when it was only applied in memory.

**Root cause:**
Storage failures are suppressed inside the settings hook instead of being returned to the caller.

**Recommended remediation:**
Propagate persistence failures or return an explicit success result so the UI can report failure. Apply the same behavior to ordinary settings updates.

**Regression test:**
Force localStorage and IndexedDB writes to fail; verify reset and update flows surface the failure and do not report persistence success.

**Limitations:**
The failure path is clear from the code, but both-backend failure behavior was not dynamically tested.
