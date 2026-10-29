export interface TextSearchMatch {
  start: number;
  end: number;
}

interface TextPosition {
  node: Text;
  start: number;
  end: number;
}

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TD', 'TH',
  'TR', 'UL',
]);

function normalizeWithOffsets(text: string, compactWhitespace: boolean) {
  let value = '';
  const starts: number[] = [];
  const ends: number[] = [];

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (compactWhitespace && /\s/.test(character)) continue;
    const normalizedCharacter = character.toLocaleLowerCase();
    value += normalizedCharacter;
    for (let part = 0; part < normalizedCharacter.length; part++) {
      starts.push(index);
      ends.push(index + 1);
    }
  }

  return { value, starts, ends };
}

function getSearchableDomText(root: Node, compactWhitespace: boolean) {
  const document = root.nodeType === Node.DOCUMENT_NODE ? root as Document : root.ownerDocument;
  if (!document) return { text: '', positions: [] as Array<TextPosition | null> };

  const positions: Array<TextPosition | null> = [];
  let text = '';
  let previousBlock: Element | Node | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();

  while (current) {
    const node = current as Text;
    const parent = node.parentElement;
    const hiddenAncestor = parent?.closest('script, style, noscript, template');
    if (!hiddenAncestor) {
      let block: Element | Node = root;
      let ancestor = parent;
      while (ancestor && ancestor !== root && !BLOCK_TAGS.has(ancestor.tagName)) {
        ancestor = ancestor.parentElement;
      }
      if (ancestor && ancestor !== root) block = ancestor;

      if (
        !compactWhitespace &&
        previousBlock &&
        previousBlock !== block &&
        text.length > 0 &&
        !/\s$/.test(text)
      ) {
        text += '\n';
        positions.push(null);
      }

      const value = node.nodeValue || '';
      for (let offset = 0; offset < value.length; offset++) {
        const character = value[offset];
        if (compactWhitespace && /\s/.test(character)) continue;
        text += character;
        positions.push({ node, start: offset, end: offset + 1 });
      }
      previousBlock = block;
    }
    current = walker.nextNode();
  }

  return { text, positions };
}

/** Extract visible DOM text while retaining natural breaks between block elements. */
export function extractDomText(root: Node): string {
  return getSearchableDomText(root, false).text;
}

/** Find case-insensitive matches and map normalized positions back to source offsets. */
export function findTextMatches(
  text: string,
  query: string,
  maxMatches = 100,
  compactWhitespace = false,
): TextSearchMatch[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const normalizedText = normalizeWithOffsets(text, compactWhitespace);
  const normalizedQuery = normalizeWithOffsets(trimmedQuery, compactWhitespace).value;
  if (!normalizedQuery) return [];

  const matches: TextSearchMatch[] = [];
  let cursor = 0;
  while (matches.length < maxMatches) {
    const index = normalizedText.value.indexOf(normalizedQuery, cursor);
    if (index < 0) break;
    const lastIndex = index + normalizedQuery.length - 1;
    const start = normalizedText.starts[index];
    const end = normalizedText.ends[lastIndex];
    if (start !== undefined && end !== undefined) matches.push({ start, end });
    cursor = index + Math.max(1, normalizedQuery.length);
  }
  return matches;
}

/** Locate a match in rendered text so callers can select and scroll to it. */
export function findTextRange(
  root: Node,
  query: string,
  occurrence = 0,
  compactWhitespace = false,
): Range | null {
  const { text, positions } = getSearchableDomText(root, compactWhitespace);
  const normalizedText = normalizeWithOffsets(text, compactWhitespace);
  const normalizedQuery = normalizeWithOffsets(query.trim(), compactWhitespace).value;
  if (!normalizedQuery) return null;

  let cursor = 0;
  let matchIndex = -1;
  let start = -1;
  let end = -1;
  while (matchIndex < occurrence) {
    const index = normalizedText.value.indexOf(normalizedQuery, cursor);
    if (index < 0) return null;
    matchIndex++;
    start = normalizedText.starts[index];
    end = normalizedText.ends[index + normalizedQuery.length - 1];
    cursor = index + Math.max(1, normalizedQuery.length);
  }

  const startPosition = positions[start];
  const endPosition = positions[end - 1];
  if (!startPosition || !endPosition) return null;
  const range = startPosition.node.ownerDocument.createRange();
  range.setStart(startPosition.node, startPosition.start);
  range.setEnd(endPosition.node, endPosition.end);
  return range;
}

export function createTextExcerpt(text: string, match: TextSearchMatch, radius = 42) {
  const start = Math.max(0, match.start - radius);
  const end = Math.min(text.length, match.end + radius);
  return {
    before: `${start > 0 ? '…' : ''}${text.slice(start, match.start)}`,
    match: text.slice(match.start, match.end),
    after: `${text.slice(match.end, end)}${end < text.length ? '…' : ''}`,
  };
}
