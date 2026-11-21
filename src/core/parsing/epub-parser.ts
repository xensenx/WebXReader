/**
 * EPUB parser for WebXReader.
 * Uses epubjs to load EPUB files and extract metadata, table of contents, and cover image.
 */

import ePub from 'epubjs';
import { openBudgetedZip } from './zip-budget';
import { extractEpubCover } from './epub-cover';
import type { Chapter, BookMetadata } from '../../types/book';
import { generateId } from '../../utils';

/** Result of parsing an EPUB file */
export interface EpubParseResult {
  metadata: Partial<BookMetadata>;
  tableOfContents: Chapter[];
  coverImage?: string;
}

/** Navigation item from epubjs */
interface NavItem {
  id: string;
  href: string;
  label: string;
  subitems?: NavItem[];
}

/**
 * Converts epubjs navigation items to our Chapter type recursively.
 */
function navItemsToChapters(items: NavItem[], startOrder: number = 0): Chapter[] {
  const chapters: Chapter[] = [];
  let order = startOrder;

  for (const item of items) {
    const chapter: Chapter = {
      id: generateId(),
      title: item.label.trim(),
      href: item.href,
      level: 0,
      order: order++,
    };

    if (item.subitems && item.subitems.length > 0) {
      chapter.children = navItemsToChapters(item.subitems, 0).map((child) => ({
        ...child,
        level: 1,
      }));
    }

    chapters.push(chapter);
  }

  return chapters;
}

/**
 * Parses an EPUB file from an ArrayBuffer.
 *
 * @param arrayBuffer - The EPUB file content as ArrayBuffer
 * @returns Parsed metadata, table of contents, and optional cover image
 */
export async function parseEpub(arrayBuffer: ArrayBuffer): Promise<EpubParseResult> {
  const zip = await openBudgetedZip(arrayBuffer);
  const book = ePub(arrayBuffer);

  try {
    await book.ready;

    // Extract metadata from the package
    const packageMeta = book.packaging?.metadata;
    const metadata: Partial<BookMetadata> = {};

    if (packageMeta) {
      if (packageMeta.title) metadata.title = packageMeta.title;
      if (packageMeta.creator) metadata.author = packageMeta.creator;
      if (packageMeta.description) metadata.description = packageMeta.description;
      if (packageMeta.language) metadata.language = packageMeta.language;
      if (packageMeta.publisher) metadata.publisher = packageMeta.publisher;
      if (packageMeta.pubdate) metadata.publicationDate = packageMeta.pubdate;

      // Extract identifiers
      const identifiers: Record<string, string> = {};
      if (packageMeta.identifier) {
        identifiers['identifier'] = packageMeta.identifier;
      }
      if (Object.keys(identifiers).length > 0) {
        metadata.identifiers = identifiers;
      }
    }

    // Extract table of contents from navigation
    const navigation = await book.loaded.navigation;
    let tableOfContents: Chapter[] = [];

    if (navigation && navigation.toc && navigation.toc.length > 0) {
      tableOfContents = navItemsToChapters(navigation.toc as NavItem[]);
    } else {
      // Fallback: create chapters from spine items
      const spine = book.spine;
      if (spine) {
        let order = 0;
        spine.each((item: { href: string; idref: string; index: number }) => {
          tableOfContents.push({
            id: generateId(),
            title: `Section ${order + 1}`,
            href: item.href,
            level: 0,
            order: order++,
          });
        });
      }
    }

    // Extract cover image
    const coverImage = await extractEpubCover(zip).catch(() => undefined);

    // Clean up
    book.destroy();

    return {
      metadata,
      tableOfContents,
      coverImage,
    };
  } catch (error) {
    // Clean up on error
    try {
      book.destroy();
    } catch {
      // Ignore cleanup errors
    }
    throw new Error(
      `Failed to parse EPUB: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
