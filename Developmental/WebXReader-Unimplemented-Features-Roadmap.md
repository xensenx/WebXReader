# WebXReader --- Unimplemented Features & Roadmap

A consolidated list of features discussed in our conversation that have
not yet been implemented or were still only proposed at the time of
writing.

> **Scope note:** This document records ideas and planned capabilities,
> not confirmed commitments. Features whose implementation status was
> not explicitly established are marked **Verify** rather than assumed
> to be missing. Existing functionality and resolved audit findings are
> intentionally excluded.

## 1. Reading statistics and activity dashboard

**Status:** Planned; not implemented.

A local reading-statistics area that helps readers understand their
reading habits.

Potential contents discussed:

-   Daily, weekly, and monthly reading activity.
-   Reading time over time.
-   Books completed and books currently being read.
-   Total pages or chapters read, where the format exposes reliable
    progress information.
-   Reading streaks.
-   Reading history and completion timelines.
-   Personal records, such as longest reading session, most active day,
    and most productive month.
-   Library statistics, including total books, series, formats, and
    storage consumed.

### Supporting requirement: reading-session tracking

Reading progress by itself is not sufficient to calculate meaningful
reading time. A lightweight session tracker would be needed.

Considerations:

-   Track active reading sessions locally.
-   Handle idle time and prolonged inactivity.
-   Avoid counting time when the tab is backgrounded or the reader is
    not actively being used.
-   Recover sensibly from accidental tab closure or interrupted
    sessions.
-   Keep statistics local-first and avoid sending reading activity to
    external services.

The intended direction is a useful statistics dashboard, not an overly
gamified experience.

## 2. Offline dictionary and vocabulary lookup

**Status:** Planned; not implemented.

Allow readers to look up words without leaving WebXReader.

Open questions and design considerations:

-   Select an offline dictionary dataset and verify its licence.
-   Decide how dictionary data is packaged, downloaded, or optionally
    installed.
-   Measure storage footprint and lookup performance.
-   Design a lookup interaction that works naturally while reading.
-   Keep lookup available offline after the required data has been
    installed.
-   Consider word definitions, pronunciation, and other metadata only
    where the chosen dataset supports them.

The source, licence, storage cost, and lookup UX still need to be
decided.

## 3. Keyboard navigation across reader formats

**Status:** Identified as missing; implementation pending.

Provide consistent keyboard navigation across the supported reader
formats.

The discussion specifically identified arrow-key navigation as missing
across formats.

Considerations:

-   Define shared navigation behaviour for previous/next page, chapter,
    or reading position as appropriate.
-   Keep behaviour consistent where formats permit it.
-   Avoid interfering with text selection, form controls, and normal
    browser shortcuts.
-   Make shortcuts discoverable and accessible.
-   Test the behaviour in each reader engine rather than assuming one
    implementation works everywhere.

## 4. Optional ambient audio and focus sounds

**Status:** Planned; not implemented.

An optional listening feature for reading sessions.

Initial sound categories discussed:

-   White noise.
-   Pink noise.
-   Brown noise.

Possible later additions:

-   Rain ambience.
-   Library ambience.
-   Night ambience.

Implementation direction discussed:

-   Prefer locally generated noise using the Web Audio API for the
    initial noise options.
-   Provide volume control.
-   Provide playback controls and a timer.
-   Keep the feature optional and unobtrusive.
-   Avoid requiring external audio services or copyrighted music for the
    initial implementation.

## 5. Further reading-experience improvements

**Status:** Ideas discussed; exact scope and implementation status need
verification.

Potential improvements mentioned in the conversation and roadmap
discussions:

-   Further improvements to reading progress and series-level progress
    tracking.
-   Better series management and guidance toward the next volume.
-   Continued improvements to bookmarks and annotations workflows.
-   Additional accessibility improvements.
-   Further reader customization where useful.
-   Improvements to import/export and backup workflows.
-   Additional format compatibility and import robustness.

Some underlying capabilities already exist in WebXReader. These entries
refer to possible extensions or refinements, not claims that the
foundational features are absent.

## 6. Research and design questions

These should be resolved before implementation:

  -----------------------------------------------------------------------
  Area                                Questions to settle
  ----------------------------------- -----------------------------------
  Statistics                          Which events count as active
                                      reading? How should time be
                                      calculated across tabs, devices,
                                      and interrupted sessions?

  Offline dictionary                  Which dataset and licence? How
                                      large is it? How is it installed
                                      and updated?

  Keyboard navigation                 Which keys map to which actions in
                                      each reader engine? How are
                                      conflicts with browser shortcuts
                                      handled?

  Ambient audio                       Which sounds are generated locally?
                                      What controls and timer behaviour
                                      are needed?

  Series progress                     How are volumes grouped, ordered,
                                      and identified across imported
                                      files?

  Accessibility                       Which specific workflows and reader
                                      components need improvement?

  Import/export                       Which concrete formats or backup
                                      scenarios are still unsupported?
  -----------------------------------------------------------------------

## 7. Explicit exclusions and already implemented work

The following were discussed but should **not** be treated as
unimplemented roadmap items based on the information available:

-   **CBZ support:** Reported as functionally complete.
-   **Custom library ordering and drag-and-drop:** Implemented and
    subsequently polished.
-   **Library scroll restoration:** Previously fixed.
-   **Storage separation and reset controls:** Implemented.
-   **Backup restore XSS / HTML sanitization issue:** Reported resolved
    and deployed.
-   **TTS:** Deliberately not planned. High-quality offline neural TTS
    was considered too demanding in terms of model/runtime setup and
    browser compatibility; basic browser TTS was not considered good
    enough to justify inclusion.

## 8. Separate outstanding audit investigations

These are not new features, but unresolved engineering findings from the
audit. They are included here so they are not confused with the feature
roadmap.

-   **EPUB external resources:** Verify whether unresolved external
    image and `srcset` references can generate network requests when
    opening an EPUB. Decide whether remote resources should be blocked
    by default or require consent.
-   **CBZ resource limits:** Investigate limits for compressed input
    size, archive entry count, expanded data size, and image dimensions.
-   **Version 2 backup completeness:** Verify and address the case where
    a backup contains book metadata without matching book content.
-   **Settings persistence failures:** Verify that failures in both
    persistence backends are surfaced to the user instead of being
    silently treated as success.

These investigations should be tracked separately from feature proposals
and should only be marked resolved after verification.

------------------------------------------------------------------------

## Suggested implementation order

This is a tentative order based on dependencies and the discussion, not
a final priority decision.

1.  Define and implement keyboard navigation consistently across reader
    engines.
2.  Design the reading-session tracker and statistics data model before
    building the dashboard.
3.  Research and select a licensed offline dictionary dataset, then
    prototype lookup UX.
4.  Implement locally generated ambient audio with minimal controls.
5.  Revisit series-level progress, accessibility, and import/export
    refinements based on concrete user needs.

## Maintenance notes

Update this document as features are implemented, rejected, deferred, or
substantially redesigned. Keep confirmed implementation status separate
from ideas and proposals. Before starting work on an item, inspect the
current codebase so that existing functionality is not accidentally
duplicated.
