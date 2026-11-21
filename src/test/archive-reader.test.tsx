import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import JSZip from 'jszip';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ArchiveReader, type ArchiveReaderHandle } from '../formats/engines/ZipReader';
import { DEFAULT_SETTINGS } from '../types/book';
import { createSyntheticRar } from './comic-test-helpers';

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
});
