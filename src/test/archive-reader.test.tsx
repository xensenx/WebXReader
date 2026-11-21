import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import JSZip from 'jszip';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ArchiveReader, type ArchiveReaderHandle } from '../formats/engines/ZipReader';
import { DEFAULT_SETTINGS } from '../types/book';
import { createSyntheticRar, SAMPLE_JPEG } from './comic-test-helpers';

vi.mock('../core/parsing/pdf-init', () => ({
  pdfjsLib: {
    getDocument: () => ({
      destroy: async () => {},
      promise: Promise.resolve({
        numPages: 4,
        getPage: async () => ({ getViewport: () => ({ width: 600, height: 800 }) }),
      }),
    }),
  },
}));

async function archiveBytes(format: 'zip' | 'rar'): Promise<ArrayBuffer> {
  const files = [
    { name: 'folder/resume.txt', content: Buffer.from('Continue from this entry.') },
    { name: 'folder/second.txt', content: Buffer.from('Start a different entry.') },
  ];
  if (format === 'rar') return createSyntheticRar(files);
  const zip = new JSZip();
  for (const { name, content } of files) zip.file(name, content);
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('Archive navigation', () => {
  it.each(['zip', 'rar'] as const)('resumes an entry and opens file search matches in %s', async (format) => {
    const ref = createRef<ArchiveReaderHandle>();
    const onProgressUpdate = vi.fn();
    render(
      <ArchiveReader
        ref={ref} fileData={await archiveBytes(format)} archiveType={format}
        initialSubPath="folder/resume.txt" initialProgressFraction={0.55} initialProgressMode="scroll"
        readerSettings={{ ...DEFAULT_SETTINGS, readingMode: 'scroll' }} onProgressUpdate={onProgressUpdate}
      />,
    );

    expect(await screen.findByText('Continue from this entry.')).toBeInTheDocument();
    expect(onProgressUpdate).not.toHaveBeenCalledWith('folder/resume.txt', 0, 0);
    const matches = await ref.current?.searchEntries('second');
    expect(matches).toHaveLength(1);
    await act(async () => ref.current?.goToEntry(matches![0].chapterId));
    expect(await screen.findByText('Start a different entry.')).toBeInTheDocument();
    expect(onProgressUpdate).toHaveBeenCalledWith('folder/second.txt', 0, 0);
  });

  it('jumps to the saved viewport fraction after a nested PDF lays out', async () => {
    const archive = new JSZip();
    const path = 'folder/book.pdf';
    archive.file(path, new Uint8Array(64));
    const ref = createRef<ArchiveReaderHandle>();
    const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2500);
    const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
    try {
      const { container } = render(
        <ArchiveReader
          ref={ref} fileData={await archive.generateAsync({ type: 'arraybuffer' })} readingMode="scroll"
          readerSettings={{ ...DEFAULT_SETTINGS, readingMode: 'scroll' }}
        />,
      );
      await screen.findByText('folder');
      await act(async () => ref.current?.goToEntry(path, 0.6));
      await waitFor(() => {
        const viewport = container.querySelector('[data-reader-viewport="pdf-vertical-scroll"]');
        expect(viewport?.scrollTop).toBe(1200);
      });
    } finally {
      height.mockRestore();
      clientHeight.mockRestore();
    }
  });

  it('opens a nested comic bookmark at its saved page fraction and supports zero', async () => {
    const comic = new JSZip();
    for (let page = 1; page <= 5; page++) comic.file(`${page}.jpg`, SAMPLE_JPEG);
    const archive = new JSZip();
    const path = 'folder/book.cbz';
    archive.file(path, await comic.generateAsync({ type: 'uint8array' }));
    const ref = createRef<ArchiveReaderHandle>();
    const onProgressUpdate = vi.fn();
    const { container } = render(
      <ArchiveReader
        ref={ref} fileData={await archive.generateAsync({ type: 'arraybuffer' })} readingMode="paginated"
        readerSettings={{ ...DEFAULT_SETTINGS, readingMode: 'paginated' }} onProgressUpdate={onProgressUpdate}
      />,
    );
    await screen.findByText('folder');
    await act(async () => ref.current?.goToEntry(path, 0.75));
    await waitFor(() => expect(onProgressUpdate).toHaveBeenLastCalledWith(path, 0.75, 3));
    expect(onProgressUpdate).not.toHaveBeenCalledWith(path, 0, 0);
    await act(async () => ref.current?.goToEntry(path, 0));
    await waitFor(() => expect(container.querySelector('[data-comic-viewport="page"]')).toHaveAttribute('data-current-page', '1'));
  });
});
