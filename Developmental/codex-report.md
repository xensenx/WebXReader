# WebXReader: prioritized improvement report

Prepared 30 October 2026. This is a short engineering shortlist, not a claim that every item is a confirmed defect. Verify each item against the current implementation before scheduling it.

## 1. Put firm safety limits around imports

Keep sanitization at both the import/restore boundary and the reader rendering boundary. Finish the open checks for remote resources in EPUBs and resource exhaustion in CBZ archives. Define practical limits for archive entry count, expanded size, and image dimensions, and explain rejected imports clearly. A local-first reader still needs to treat files as untrusted input.

## 2. Make library recovery dependable

Exercise IndexedDB quota and access failures, interrupted restores, schema upgrades, and backups with missing book content. Show whether an operation completed and what the user can do next. Backups are especially important because the library is stored in the browser and is not shared across deployment mirrors.

## 3. Protect reader behavior with a cross-format regression matrix

Cover EPUB, PDF, CBZ, TXT, Markdown, and HTML for the core tasks: open and resume, search and highlight, bookmarks, chapter/page navigation, zoom, and progress restoration. Include slow pointer reordering and mobile pinch gestures. Automate the interactions that can be reproduced reliably, and keep a short manual check for browser-specific canvas and touch behavior.

## 4. Improve keyboard and assistive-technology support

Define consistent previous/next navigation across reader formats, with shortcuts that do not interfere with typing or browser controls. Review focus order, visible focus, button names, and announcements for progress and search results. Check reduced-motion behavior and touch targets alongside keyboard use.

## 5. Measure large-library and long-book performance

Profile import, first open, chapter navigation, search, and library rendering with large real-world files. Use measurements to decide whether long lists, search results, or chapter content need virtualization or incremental processing; avoid adding complexity before identifying the slow path.

## Suggested order

1. Complete import security and resource-limit checks.
2. Verify backup and storage recovery paths.
3. Add the cross-format regression matrix, then use it for reader UX changes.
4. Address accessibility gaps and performance findings as they are measured.

The existing `WebXReader-Unimplemented-Features-Roadmap.md` remains the fuller feature and audit backlog. Update both documents when an item is verified, fixed, or intentionally deferred.
