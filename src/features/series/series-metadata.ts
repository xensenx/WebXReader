import type { Book } from '../../types/book';
import { SERIES_TAGS_LIMIT, SERIES_TITLE_LIMIT } from './series';
import { stripVolumeNumber, volumeFilenameStem } from './volume-order';

function canonical(value: string) {
  return value.normalize('NFKC').toLowerCase();
}

/** Prefer shared metadata and use selection order when candidates are tied. */
function mostCommon(values: readonly string[]): string {
  const candidates = new Map<string, { label: string; count: number }>();
  for (const label of values) {
    if (!label) continue;
    const key = canonical(label);
    const existing = candidates.get(key);
    if (existing) existing.count++;
    else candidates.set(key, { label, count: 1 });
  }
  let best = { label: '', count: 0 };
  for (const entry of candidates.values()) if (entry.count > best.count) best = entry;
  return best.label;
}

function candidateTitle(book: Book) {
  const title = book.title.trim();
  const filename = volumeFilenameStem(book.originalFilename).replace(/_/g, ' ').trim();
  const fromTitle = stripVolumeNumber(title);
  const fromFilename = stripVolumeNumber(filename);
  return (fromTitle?.labeled && fromTitle.name) || (fromFilename?.labeled && fromFilename.name) ||
    fromTitle?.name || fromFilename?.name || (!fromTitle?.labeled && title) || (!fromFilename?.labeled ? filename : '');
}

export function suggestSeriesMetadata(books: readonly Book[]) {
  const title = mostCommon(books.map(candidateTitle)).slice(0, SERIES_TITLE_LIMIT).trim();
  const authors = books.map((book) => typeof book.author === 'string' ? book.author.trim() : '')
    .filter((author) => !/^unknown(?: author)?$/i.test(author));
  const author = mostCommon(authors).slice(0, SERIES_TITLE_LIMIT).trim();
  const tags = new Map<string, string>();
  let tagLength = 0;
  for (const book of books) {
    for (const raw of Array.isArray(book.userTags) ? book.userTags : []) {
      if (typeof raw !== 'string') continue;
      const tag = raw.trim();
      const key = canonical(tag);
      const nextLength = tagLength + (tags.size ? 2 : 0) + tag.length;
      if (tag && !tags.has(key) && nextLength <= SERIES_TAGS_LIMIT) {
        tags.set(key, tag);
        tagLength = nextLength;
      }
    }
  }
  return { title, author, tags: [...tags.values()].join(', ') };
}
