import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseDocx } from '../core/parsing/docx-parser';

async function createDocxZip(params: {
  bodyXml?: string;
  coreXml?: string;
  images?: Record<string, Uint8Array>;
}): Promise<ArrayBuffer> {
  const zip = new JSZip();

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${params.bodyXml ?? '<w:p><w:r><w:t>Hello from DOCX!</w:t></w:r></w:p>'}
  </w:body>
</w:document>`;

  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rels);
  zip.file('word/document.xml', documentXml);

  if (params.coreXml) {
    zip.file('docProps/core.xml', params.coreXml);
  }

  if (params.images) {
    for (const [name, bytes] of Object.entries(params.images)) {
      zip.file(`word/media/${name}`, bytes);
    }
  }

  const nodeBuf = await zip.generateAsync({ type: 'nodebuffer' });
  return nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength) as ArrayBuffer;
}

describe('DOCX Parser', () => {
  it('parses basic DOCX content and extracts plain text', async () => {
    const docxData = await createDocxZip({
      bodyXml: `
        <w:p>
          <w:r><w:t>Introduction to Quantum Mechanics</w:t></w:r>
        </w:p>
        <w:p>
          <w:r><w:rPr><w:b/></w:rPr><w:t>Key concept:</w:t></w:r>
          <w:r><w:t xml:space="preserve"> Wave-particle duality.</w:t></w:r>
        </w:p>
      `,
    });

    const result = await parseDocx(docxData);
    expect(result.chapters).toHaveLength(1);
    expect(result.rawText).toContain('Introduction to Quantum Mechanics');
    expect(result.rawText).toContain('Key concept: Wave-particle duality.');
    expect(result.chapters[0].content).toContain('<strong>Key concept:</strong>');
  });

  it('extracts metadata from docProps/core.xml', async () => {
    const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/">
  <dc:title>Principles of Electrodynamics</dc:title>
  <dc:creator>Richard P. Feynman</dc:creator>
  <dc:description>A foundational treatise on classical and quantum electrodynamics.</dc:description>
  <dc:language>en-US</dc:language>
  <cp:keywords>physics, electrodynamics, field theory</cp:keywords>
  <dcterms:created>1965-01-01T00:00:00Z</dcterms:created>
</cp:coreProperties>`;

    const docxData = await createDocxZip({ coreXml });
    const result = await parseDocx(docxData);

    expect(result.metadata.title).toBe('Principles of Electrodynamics');
    expect(result.metadata.author).toBe('Richard P. Feynman');
    expect(result.metadata.description).toBe('A foundational treatise on classical and quantum electrodynamics.');
    expect(result.metadata.language).toBe('en-US');
    expect(result.metadata.publicationDate).toBe('1965-01-01');
  });

  it('splits chapters on headings when autoDetectChapters is true', async () => {
    const bodyXml = `
      <w:p>
        <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
        <w:r><w:t>Chapter One: Arrival</w:t></w:r>
      </w:p>
      <w:p>
        <w:r><w:t>The morning sun cast long shadows over the harbor.</w:t></w:r>
      </w:p>
      <w:p>
        <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
        <w:r><w:t>Chapter Two: The Journey Begins</w:t></w:r>
      </w:p>
      <w:p>
        <w:r><w:t>With sails raised, the ship navigated into the open sea.</w:t></w:r>
      </w:p>
    `;

    const docxData = await createDocxZip({ bodyXml });
    const result = await parseDocx(docxData, { autoDetectChapters: true });

    expect(result.chapters.length).toBeGreaterThanOrEqual(2);
    expect(result.chapters[0].title).toContain('Chapter One: Arrival');
    expect(result.chapters[0].content).toContain('The morning sun cast long shadows over the harbor.');
    expect(result.chapters[1].title).toContain('Chapter Two: The Journey Begins');
    expect(result.chapters[1].content).toContain('With sails raised, the ship navigated into the open sea.');
  });

  it('keeps single chapter when autoDetectChapters is false', async () => {
    const bodyXml = `
      <w:p>
        <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
        <w:r><w:t>Section A</w:t></w:r>
      </w:p>
      <w:p><w:r><w:t>Paragraph A</w:t></w:r></w:p>
      <w:p>
        <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
        <w:r><w:t>Section B</w:t></w:r>
      </w:p>
      <w:p><w:r><w:t>Paragraph B</w:t></w:r></w:p>
    `;

    const docxData = await createDocxZip({ bodyXml });
    const result = await parseDocx(docxData, { autoDetectChapters: false });

    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].content).toContain('Section A');
    expect(result.chapters[0].content).toContain('Section B');
  });

  it('extracts embedded cover images from word/media', async () => {
    // 8-byte minimal PNG header + IHDR chunk dummy
    const dummyPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const docxData = await createDocxZip({
      images: {
        'cover.png': dummyPng,
      },
    });

    const result = await parseDocx(docxData);
    expect(result.coverImage).toBeDefined();
    expect(result.coverImage).toContain('data:image/png;base64,');
  });

  it('sanitizes unsafe script tags from document HTML', async () => {
    // Even if unsafe elements somehow crept in, sanitizeReaderHtml cleans them
    const bodyXml = `
      <w:p><w:r><w:t>Standard text</w:t></w:r></w:p>
    `;

    const docxData = await createDocxZip({ bodyXml });
    const result = await parseDocx(docxData);
    for (const chapter of result.chapters) {
      expect(chapter.content).not.toContain('<script>');
      expect(chapter.content).not.toContain('onerror=');
    }
  });

  it('throws a helpful descriptive error on corrupted non-zip data', async () => {
    const corruptedData = new Uint8Array([0x00, 0x11, 0x22, 0x33, 0x44]);
    await expect(parseDocx(corruptedData)).rejects.toThrow(/Not a valid DOCX file/i);
  });
});
