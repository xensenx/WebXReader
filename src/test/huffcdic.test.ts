import { describe, it, expect } from 'vitest';
import { HuffReader } from '../core/parsing/huffcdic';

describe('HUFF/CDIC Decompressor', () => {
  it('correctly unpacks HUFF and CDIC dictionary phrases', () => {
    // 1. Build CDIC record with 2 terminal phrases
    // Header (16 bytes): 'CDIC\0\0\0\x10', phrases=2, bits=2
    const phrase0 = Buffer.from('Hello');
    const phrase1 = Buffer.from(' World');

    const cdic = Buffer.alloc(16 + 4 + (2 + 5) + (2 + 6));
    cdic.write('CDIC', 0, 4, 'ascii');
    cdic.writeUInt32BE(0x10, 4);
    cdic.writeUInt32BE(2, 8); // phrases = 2
    cdic.writeUInt32BE(2, 12); // bits = 2

    // offset to phrase 0: 4 (from offset 16 -> at 20)
    cdic.writeUInt16BE(4, 16);
    // offset to phrase 1: 4 + 7 = 11 (from offset 16 -> at 27)
    cdic.writeUInt16BE(11, 18);

    // phrase 0 at 20 (bit 15 = 0x8000 signals terminal/plain-text slice)
    cdic.writeUInt16BE(0x8000 | phrase0.length, 20);
    phrase0.copy(cdic, 22);

    // phrase 1 at 27 (bit 15 = 0x8000 signals terminal/plain-text slice)
    cdic.writeUInt16BE(0x8000 | phrase1.length, 27);
    phrase1.copy(cdic, 29);

    // 2. Build HUFF record
    const off1 = 24;
    const off2 = 24 + 256 * 4;
    const huff = Buffer.alloc(off2 + 64 * 4, 0);
    huff.write('HUFF', 0, 4, 'ascii');
    huff.writeUInt32BE(0x18, 4);
    huff.writeUInt32BE(off1, 8);
    huff.writeUInt32BE(off2, 12);

    // dict1 entries (256 uint32s):
    // entry 0 (byte 0x00 -> phrase 0): codelen=8, term=0x80, rawMaxcode=0 -> v = (0 << 8) | 0x80 | 8 = 0x88
    huff.writeUInt32BE((0 << 8) | 0x80 | 8, off1 + 0 * 4);
    // entry 1 (byte 0x01 -> phrase 1): codelen=8, term=0x80, rawMaxcode=2 -> v = (2 << 8) | 0x80 | 8 = 0x288
    huff.writeUInt32BE((2 << 8) | 0x80 | 8, off1 + 1 * 4);

    const reader = new HuffReader(new Uint8Array(huff), [new Uint8Array(cdic)]);

    // Compressed stream containing bytes [0x00, 0x01]
    const compressed = new Uint8Array([0x00, 0x01]);
    const unpacked = reader.unpack(compressed);

    const str = new TextDecoder('utf-8').decode(unpacked);
    expect(str).toBe('Hello World');
  });
});
