import { describe, it, expect } from 'vitest';
import CFB from 'cfb';
import { parseDoc } from '../core/parsing/doc-parser';

function createTestDoc({
  text = 'Hello Word Doc!',
  isUnicode = false,
  encrypted = false,
  invalidMagic = false,
  omitWordDocument = false,
  omitTable = false,
}: {
  text?: string;
  isUnicode?: boolean;
  encrypted?: boolean;
  invalidMagic?: boolean;
  omitWordDocument?: boolean;
  omitTable?: boolean;
} = {}): ArrayBuffer {
  const cfb = CFB.utils.cfb_new();

  if (!omitWordDocument) {
    const wordDoc = Buffer.alloc(0x0400 + text.length * 4);

    // Magic: 0xa5ec
    wordDoc.writeUInt16LE(invalidMagic ? 0x1234 : 0xa5ec, 0);

    // Flags: 0x0200 (1Table) + (encrypted ? 0x0100 : 0)
    const flags = 0x0200 | (encrypted ? 0x0100 : 0);
    wordDoc.writeUInt16LE(flags, 0x000a);

    // Text offset in WordDocument stream
    const textOffset = 0x0250;

    let compressedFc: number;
    if (isUnicode) {
      const textBuf = Buffer.from(text, 'utf16le');
      textBuf.copy(wordDoc, textOffset);
      // Bit 30 is 0 for Unicode UTF-16LE, fc is exact byte offset
      compressedFc = textOffset;
    } else {
      const textBuf = Buffer.from(text, 'latin1');
      textBuf.copy(wordDoc, textOffset);
      // Bit 30 is 1 for ANSI, offset is doubled
      compressedFc = (textOffset * 2) | 0x40000000;
    }

    // CLX Record in 1Table stream
    const fcClx = 0;
    // 1 piece: cb = (1 * 4) + 4 + (1 * 8) = 16 bytes
    const clxBuf = Buffer.alloc(1 + 4 + 16);
    clxBuf.writeUInt8(0x02, 0); // clxt = 0x02 (Plcfpcd)
    clxBuf.writeUInt32LE(16, 1); // cb = 16

    // CPs: CP0 = 0, CP1 = text.length
    clxBuf.writeUInt32LE(0, 5);
    clxBuf.writeUInt32LE(text.length, 9);

    // PCD: 8 bytes
    clxBuf.writeUInt16LE(0, 13); // reserved
    clxBuf.writeUInt32LE(compressedFc, 15); // fc
    clxBuf.writeUInt16LE(0, 19); // prm

    // FIB table locations
    wordDoc.writeUInt32LE(fcClx, 0x01a2);
    wordDoc.writeUInt32LE(clxBuf.length, 0x01a6);

    CFB.utils.cfb_add(cfb, '/WordDocument', wordDoc);

    if (!omitTable) {
      CFB.utils.cfb_add(cfb, '/1Table', clxBuf);
    }
  }

  const nodeBuf = CFB.write(cfb, { type: 'buffer' });
  return nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength);
}

describe('DOC Parser', () => {
  it('parses basic ANSI text from Word 97-2004 binary format', async () => {
    const docData = createTestDoc({
      text: 'First line of the story.\rSecond line with more details.\r',
    });

    const result = await parseDoc(docData);
    expect(result.chapters).toHaveLength(1);
    expect(result.rawText).toContain('First line of the story.');
    expect(result.rawText).toContain('Second line with more details.');
    expect(result.chapters[0].content).toContain('<p>First line of the story.</p>');
    expect(result.chapters[0].content).toContain('<p>Second line with more details.</p>');
  });

  it('parses Unicode UTF-16LE text from piece table', async () => {
    const docData = createTestDoc({
      text: 'Quantum Mechanics and Schrödinger’s Equation: ψ(x, t)',
      isUnicode: true,
    });

    const result = await parseDoc(docData);
    expect(result.rawText).toContain('Quantum Mechanics and Schrödinger’s Equation: ψ(x, t)');
    expect(result.chapters[0].content).toContain('Quantum Mechanics and Schrödinger’s Equation: ψ(x, t)');
  });

  it('translates Word control characters into proper HTML elements', async () => {
    // \x07 is table cell separator, \x0C is page break, \x0B is soft line break
    const docData = createTestDoc({
      text: 'Cell A\x07Cell B\rBreak before\x0Bline after\rPage 1\x0CPage 2',
    });

    const result = await parseDoc(docData, { autoDetectChapters: false });
    const content = result.chapters[0].content;

    // Check table cell rendering
    expect(content).toContain('<td>Cell A</td>');
    expect(content).toContain('<td>Cell B</td>');

    // Check soft line break
    expect(content).toContain('<br>');

    // Check page break
    expect(content).toContain('class="page-break"');
  });

  it('splits chapters on Form Feed (page break) characters', async () => {
    const docData = createTestDoc({
      text: 'Part One: The Journey Begins\rSome adventure text.\x0CPart Two: The Hidden Valley\rMore text here.',
    });

    const result = await parseDoc(docData, { autoDetectChapters: true });
    expect(result.chapters.length).toBeGreaterThanOrEqual(2);
    expect(result.chapters[0].title).toBe('Part One: The Journey Begins');
    expect(result.chapters[0].content).toContain('Some adventure text.');
    expect(result.chapters[1].title).toBe('Part Two: The Hidden Valley');
    expect(result.chapters[1].content).toContain('More text here.');
  });

  it('keeps single chapter when autoDetectChapters is false', async () => {
    const docData = createTestDoc({
      text: 'Chapter 1\rContent\x0CChapter 2\rMore content',
    });

    const result = await parseDoc(docData, { autoDetectChapters: false });
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].content).toContain('Chapter 1');
    expect(result.chapters[0].content).toContain('Chapter 2');
  });

  it('rejects files without valid OLE2 CFB signature', async () => {
    // Exactly 512 bytes with invalid signature
    const invalid512 = new Uint8Array(512);
    invalid512.fill(0xaa);
    await expect(parseDoc(invalid512)).rejects.toThrow(/missing OLE2 Compound/i);

    // Too small for header
    const tooSmall = new Uint8Array([0x01, 0x02, 0x03]);
    await expect(parseDoc(tooSmall)).rejects.toThrow(/smaller than CFBF header/i);
  });

  it('rejects OLE2 files lacking WordDocument stream', async () => {
    const docData = createTestDoc({ omitWordDocument: true });
    await expect(parseDoc(docData)).rejects.toThrow(/WordDocument stream not found/i);
  });

  it('rejects files with invalid FIB magic number', async () => {
    const docData = createTestDoc({ invalidMagic: true });
    await expect(parseDoc(docData)).rejects.toThrow(/unrecognized Word FIB magic/i);
  });

  it('detects encrypted / password-protected .doc documents', async () => {
    const docData = createTestDoc({ encrypted: true });
    await expect(parseDoc(docData)).rejects.toThrow(/password encryption/i);
  });
});
