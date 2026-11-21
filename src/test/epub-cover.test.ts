import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseEpub } from '../core/parsing/epub-parser';
import { extractEpubCover } from '../core/parsing/epub-cover';
import { openBudgetedZip } from '../core/parsing/zip-budget';
import { SAMPLE_JPEG } from './comic-test-helpers';

const jpeg = `data:image/jpeg;base64,${SAMPLE_JPEG.toString('base64')}`;
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M/AwMDEwMDAAMYAAQMAA4d/nOIAAAAASUVORK5CYII=';
const png = `data:image/png;base64,${pngBase64}`;

async function epub({ metadata = '', manifest = '', guide = '', firstPage = '<p>Chapter text</p>' } = {}) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', `
    <package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Cover Test</dc:title><dc:identifier id="id">test</dc:identifier>${metadata}
      </metadata>
      <manifest><item id="first" href="pages/start.xhtml" media-type="application/xhtml+xml"/>
        <item id="cover_fmt" href="images/Front%20Art.jpg" media-type="image/jpeg"/>
        <item id="other" href="images/other.png" media-type="image/png"/>${manifest}
      </manifest>
      <spine><itemref idref="first"/></spine><guide>${guide}</guide>
    </package>`);
  zip.file('OEBPS/pages/start.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Start</title></head><body>${firstPage}</body></html>`);
  zip.file('OEBPS/images/Front Art.jpg', SAMPLE_JPEG);
  zip.file('OEBPS/images/other.png', pngBase64, { base64: true });
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('EPUB cover extraction', () => {
  it('recovers an image from a guide cover page when the EPUB 2 metadata points to a missing ID', async () => {
    const bytes = await epub({
      metadata: '<meta name="cover" content="cover"/>',
      guide: '<reference type="cover" href="pages/start.xhtml#cover"/>',
      firstPage: '<img alt="Cover" src="../images/Front%20Art.jpg"/>',
    });
    expect((await parseEpub(bytes)).coverImage).toBe(jpeg);
  });

  it('prefers an EPUB 3 manifest declaration over the guide and legacy metadata', async () => {
    const bytes = await epub({
      metadata: '<meta name="cover" content="cover_fmt"/>',
      manifest: '<item id="modern" href="images/other.png" media-type="image/png" properties="nav cover-image"/>',
      guide: '<reference type="cover" href="pages/start.xhtml"/>',
      firstPage: '<img src="../images/Front%20Art.jpg"/>',
    });
    expect(await extractEpubCover(await openBudgetedZip(bytes))).toBe(png);
  });

  it('continues to the guide when the declared image cannot be read', async () => {
    const bytes = await epub({
      manifest: '<item id="broken" href="images/missing.jpg" media-type="image/jpeg" properties="cover-image"/>',
      guide: '<reference type="cover" href="pages/start.xhtml"/>',
      firstPage: '<img src="../images/Front%20Art.jpg"/>',
    });
    expect(await extractEpubCover(await openBudgetedZip(bytes))).toBe(jpeg);
  });

  it('uses an image-only SVG wrapper on the first spine page', async () => {
    const bytes = await epub({
      firstPage: '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="../images/Front%20Art.jpg"/></svg>',
    });
    expect(await extractEpubCover(await openBudgetedZip(bytes))).toBe(jpeg);
  });

  it('keeps the fallback when a chapter merely has an illustration or an external image', async () => {
    const verse = await epub({ firstPage: '<p>Chapter text</p><img src="../images/other.png"/>' });
    expect(await extractEpubCover(await openBudgetedZip(verse))).toBeUndefined();
    const external = await epub({ firstPage: '<img src="https://example.org/cover.jpg"/>' });
    expect(await extractEpubCover(await openBudgetedZip(external))).toBeUndefined();
  });
});
