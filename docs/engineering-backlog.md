# WebXReader Engineering Backlog

This document serves as the canonical index of all confirmed findings, unverified technical concerns, and feature proposals for the WebXReader project.

## Critical and high-priority security concerns

None identified at this time.

## Other security and privacy concerns

- **WXR-SEC-001** - Restored backup chapter HTML reaches an executable reader sink
  - Status: Confirmed
  - Priority: Medium
  - Details: [security-findings.md#wxr-sec-001](security-findings.md#wxr-sec-001)

- **WXR-SEC-002** - EPUB image references can retain external URLs
  - Status: Strongly Supported (Unverified)
  - Priority: Low
  - Details: [security-findings.md#wxr-sec-002](security-findings.md#wxr-sec-002)

- **WXR-SEC-003** - CBZ processing has no explicit archive or decompression limits
  - Status: Strongly Supported (Unverified)
  - Priority: Low
  - Details: [security-findings.md#wxr-sec-003](security-findings.md#wxr-sec-003)

## Confirmed functional and data-integrity bugs

- **WXR-BUG-001** - Dragging in a filtered library discards hidden books from custom order
  - Status: Confirmed
  - Priority: Low
  - Details: [bug-findings.md#wxr-bug-001](bug-findings.md#wxr-bug-001)

- **WXR-DATA-001** - Version 2 backup without matching content creates unreadable book records
  - Status: Confirmed
  - Priority: Low
  - Details: [bug-findings.md#wxr-data-001](bug-findings.md#wxr-data-001)

- **WXR-BUG-002** - Settings persistence errors are swallowed, so reset can appear successful
  - Status: Confirmed
  - Priority: Low
  - Details: [bug-findings.md#wxr-bug-002](bug-findings.md#wxr-bug-002)

## Unverified technical concerns

*(See WXR-SEC-002 and WXR-SEC-003 in security and privacy concerns)*

## Performance, accessibility, and UX improvements

None identified at this time.

## Feature proposals

- See [feature-proposals.md](feature-proposals.md)

## Rejected or superseded findings

None at this time.
