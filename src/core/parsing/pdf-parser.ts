/**
 * PDF parser for WebXReader.
 * Uses pdfjs-dist to extract metadata, table of contents (outline), and generate a cover image.
 */

import { pdfjsLib } from './pdf-init';
import type { Chapter, BookMetadata } from '../../types/book';
import { generateId } from '../../utils';

export interface PdfParseResult {
  metadata: Partial<BookMetadata>;
  tableOfContents: Chapter[];
  coverImage?: string;
  totalPages: number;
}

interface OutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items?: OutlineNode[];
}

/**
 * Extracts a thumbnail cover from the first page of the PDF.
 */
async function extractCoverFromPage1(page: any): Promise<string | undefined> {
  try {
    if (typeof document === 'undefined') return undefined;

    const viewport = page.getViewport({ scale: 1.0 });
    const desiredWidth = 360;
    const scale = Math.min(2.0, Math.max(0.4, desiredWidth / viewport.width));
    const thumbViewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(thumbViewport.width);
    canvas.height = Math.floor(thumbViewport.height);
    const context = canvas.getContext('2d');

    if (!context) return undefined;

    const renderTask = page.render({
      canvas,
      canvasContext: context,
      viewport: thumbViewport,
    });

    await renderTask.promise;
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (err) {
    console.warn('Could not extract PDF cover thumbnail:', err);
    return undefined;
  }
}

/**
 * Parses a PDF file from an ArrayBuffer.
 */
export async function parsePdf(arrayBuffer: ArrayBuffer): Promise<PdfParseResult> {
  // Use a sliced copy for parsing so the original ArrayBuffer does not get detached
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer.slice(0)),
    useSystemFonts: true,
  });

  const pdfDoc = await loadingTask.promise;
  const totalPages = pdfDoc.numPages;

  // 1. Extract metadata
  const metadata: Partial<BookMetadata> = {};
  try {
    const metaDataObj = await pdfDoc.getMetadata();
    const info = metaDataObj?.info as Record<string, unknown> | undefined;

    if (info) {
      if (typeof info.Title === 'string' && info.Title.trim()) {
        metadata.title = info.Title.trim();
      }
      if (typeof info.Author === 'string' && info.Author.trim()) {
        metadata.author = info.Author.trim();
      }
      if (typeof info.Subject === 'string' && info.Subject.trim()) {
        metadata.description = info.Subject.trim();
      }
      if (typeof info.Producer === 'string' && info.Producer.trim()) {
        metadata.publisher = info.Producer.trim();
      }
      if (typeof info.CreationDate === 'string') {
        metadata.publicationDate = info.CreationDate;
      }
    }
  } catch {
    // Non-critical: metadata might not exist
  }

  // 2. Extract outline / Table of Contents
  const tableOfContents: Chapter[] = [];
  try {
    const outline = (await pdfDoc.getOutline()) as OutlineNode[] | null;

    if (outline && outline.length > 0) {
      let order = 0;
      for (const item of outline) {
        let pageNum = 1;
        if (Array.isArray(item.dest) && item.dest.length > 0) {
          try {
            const pageIndex = await pdfDoc.getPageIndex(item.dest[0] as any);
            pageNum = pageIndex + 1;
          } catch {
            // fallback
          }
        } else if (typeof item.dest === 'string') {
          try {
            const destArr = await pdfDoc.getDestination(item.dest);
            if (destArr && destArr.length > 0) {
              const pageIndex = await pdfDoc.getPageIndex(destArr[0] as any);
              pageNum = pageIndex + 1;
            }
          } catch {
            // fallback
          }
        }

        tableOfContents.push({
          id: generateId(),
          title: item.title?.trim() || `Section ${order + 1}`,
          href: `${pageNum}`,
          level: 0,
          order: order++,
        });
      }
    }
  } catch {
    // Outline extraction failed or empty
  }

  // If no outline was available, build page list for chapters (up to 500 pages)
  if (tableOfContents.length === 0) {
    const step = totalPages > 100 ? 5 : 1;
    let order = 0;
    for (let p = 1; p <= totalPages; p += step) {
      tableOfContents.push({
        id: generateId(),
        title: step > 1 ? `Pages ${p}–${Math.min(totalPages, p + step - 1)}` : `Page ${p}`,
        href: `${p}`,
        level: 0,
        order: order++,
      });
    }
  }

  // 3. Extract cover image from page 1
  let coverImage: string | undefined;
  try {
    const page1 = await pdfDoc.getPage(1);
    coverImage = await extractCoverFromPage1(page1);
  } catch {
    // optional
  }

  return {
    metadata,
    tableOfContents,
    coverImage,
    totalPages,
  };
}
