import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { openBudgetedZip, readZipEntryLimited } from '../core/parsing/zip-budget';
import { validateSevenZipListing } from '../core/parsing/sevenzip-budget';
import { parseFb2 } from '../core/parsing/fb2-parser';

describe('archive expansion budgets', () => {
  it('limits actual ZIP entry output while preserving small pages', async () => {
    const zip = new JSZip();
    zip.file('safe/cover.png', new Uint8Array([1, 2, 3]));
    const loaded = await openBudgetedZip(await zip.generateAsync({ type: 'arraybuffer' }));
    expect((await readZipEntryLimited(loaded.file('safe/cover.png')!)).byteLength).toBe(3);
    await expect(readZipEntryLimited(loaded.file('safe/cover.png')!, 2)).rejects.toThrow('expanded byte limit');
  });

  it('rejects oversized 7-Zip listings before extraction', () => {
    const listing = ['----------', 'Path = page.png', 'Size = 60000000', 'Folder = -', ''];
    expect(() => validateSevenZipListing(listing)).toThrow('expanded size limit');
  });

  it('stops nested FB2 ZIP expansion at two levels', async () => {
    let payload: Uint8Array = new TextEncoder().encode('<FictionBook><body><section><p>text</p></section></body></FictionBook>');
    for (let level = 0; level < 3; level++) {
      const zip = new JSZip();
      zip.file('story.fb2', payload);
      payload = await zip.generateAsync({ type: 'uint8array' });
    }
    await expect(parseFb2(payload.buffer as ArrayBuffer)).rejects.toThrow('nesting limit');
  });
});
