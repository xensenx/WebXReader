const SEARCH_HIGHLIGHT_NAME = 'webx-search-result';
export const SEARCH_HIGHLIGHT_DURATION_MS = 2200;

let activeCleanup: (() => void) | null = null;

function selectionContainsRange(selection: Selection, range: Range): boolean {
  if (selection.rangeCount !== 1) return false;
  const selected = selection.getRangeAt(0);
  return selected.startContainer === range.startContainer &&
    selected.startOffset === range.startOffset &&
    selected.endContainer === range.endContainer &&
    selected.endOffset === range.endOffset;
}

/** Briefly tint a search result without wrapping or mutating the book's DOM. */
export function showTransientSearchHighlight(
  range: Range,
  duration = SEARCH_HIGHLIGHT_DURATION_MS,
): void {
  activeCleanup?.();

  const document = range.startContainer.ownerDocument;
  if (!document) return;
  const view = document.defaultView;
  if (!view) return;

  type HighlightWindow = Window & {
    CSS?: typeof CSS;
    Highlight?: new (...ranges: Range[]) => Highlight;
  };
  const highlightWindow = view as HighlightWindow;
  const registry = highlightWindow.CSS?.highlights;
  const HighlightConstructor = highlightWindow.Highlight;
  const selection = view.getSelection();
  let highlight: Highlight | null = null;
  let timeoutId: number | null = null;
  let cleanup: () => void = () => {};

  if (registry && HighlightConstructor) {
    highlight = new HighlightConstructor(range);
    registry.set(SEARCH_HIGHLIGHT_NAME, highlight);
  } else if (selection) {
    selection.removeAllRanges();
    selection.addRange(range);
  }

  cleanup = () => {
    if (timeoutId !== null) view.clearTimeout(timeoutId);
    if (highlight && registry?.get(SEARCH_HIGHLIGHT_NAME) === highlight) {
      registry.delete(SEARCH_HIGHLIGHT_NAME);
    } else if (selection && selectionContainsRange(selection, range)) {
      selection.removeAllRanges();
    }
    if (activeCleanup === cleanup) activeCleanup = null;
  };

  activeCleanup = cleanup;
  timeoutId = view.setTimeout(cleanup, duration);
}

export function clearTransientSearchHighlight(): void {
  activeCleanup?.();
}
