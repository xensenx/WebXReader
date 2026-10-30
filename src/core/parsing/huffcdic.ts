/**
 * HUFF/CDIC (Huffman + CDIC phrase dictionary) decompressor for Mobipocket and Kindle (KF8/AZW3) ebooks.
 * Handles compression type 17480 (0x4448, ASCII 'DH').
 */

interface Dict1Entry {
  codelen: number;
  term: boolean;
  maxcode: number;
}

interface CdicSlice {
  slice: Uint8Array;
  isCompound: boolean;
}

export class HuffReader {
  private dict1: Dict1Entry[] = [];
  private mincode: number[] = [];
  private maxcodeTable: number[] = [];
  private dictionary: CdicSlice[] = [];

  constructor(huffRecord: Uint8Array, cdicRecords: Uint8Array[]) {
    this.loadHuff(huffRecord);
    for (const cdic of cdicRecords) {
      this.loadCdic(cdic);
    }
  }

  private loadHuff(huff: Uint8Array): void {
    if (
      huff.length < 24 ||
      huff[0] !== 0x48 || // 'H'
      huff[1] !== 0x55 || // 'U'
      huff[2] !== 0x46 || // 'F'
      huff[3] !== 0x46 || // 'F'
      huff[4] !== 0x00 ||
      huff[5] !== 0x00 ||
      huff[6] !== 0x00 ||
      huff[7] !== 0x18
    ) {
      throw new Error('Invalid HUFF record header');
    }

    const view = new DataView(huff.buffer, huff.byteOffset, huff.byteLength);
    const off1 = view.getUint32(8, false);
    const off2 = view.getUint32(12, false);

    if (huff.length < off1 + 256 * 4 || huff.length < off2 + 64 * 4) {
      throw new Error('Truncated HUFF record: offset tables exceed record bounds');
    }

    // off1 points to 256 uint32 entries
    this.dict1 = [];
    for (let i = 0; i < 256; i++) {
      const v = view.getUint32(off1 + i * 4, false);
      const codelen = v & 0x1f;
      const term = (v & 0x80) !== 0;
      const rawMaxcode = v >>> 8;
      let maxcode = 0;
      if (codelen > 0 && codelen <= 32) {
        maxcode = (((rawMaxcode + 1) << (32 - codelen)) - 1) >>> 0;
      }
      this.dict1.push({ codelen, term, maxcode });
    }

    // off2 points to 64 uint32 entries (32 pairs of mincode, maxcode)
    this.mincode = [0];
    this.maxcodeTable = [0];

    for (let codelen = 1; codelen <= 32; codelen++) {
      const minVal = view.getUint32(off2 + (codelen - 1) * 8, false);
      const maxVal = view.getUint32(off2 + (codelen - 1) * 8 + 4, false);

      this.mincode.push((minVal << (32 - codelen)) >>> 0);
      this.maxcodeTable.push((((maxVal + 1) << (32 - codelen)) - 1) >>> 0);
    }
  }

  private loadCdic(cdic: Uint8Array): void {
    if (
      cdic.length < 16 ||
      cdic[0] !== 0x43 || // 'C'
      cdic[1] !== 0x44 || // 'D'
      cdic[2] !== 0x49 || // 'I'
      cdic[3] !== 0x43 || // 'C'
      cdic[4] !== 0x00 ||
      cdic[5] !== 0x00 ||
      cdic[6] !== 0x00 ||
      cdic[7] !== 0x10
    ) {
      throw new Error('Invalid CDIC record header');
    }

    const view = new DataView(cdic.buffer, cdic.byteOffset, cdic.byteLength);
    const phrases = view.getUint32(8, false);
    const bits = view.getUint32(12, false);
    const n = Math.min(1 << bits, phrases - this.dictionary.length);

    for (let i = 0; i < n; i++) {
      if (16 + i * 2 + 2 > cdic.length) break;
      const off = view.getUint16(16 + i * 2, false);
      if (16 + off + 2 > cdic.length) break;
      const blen = view.getUint16(16 + off, false);
      const len = blen & 0x7fff;
      const isCompound = (blen & 0x8000) !== 0;
      if (18 + off + len > cdic.length) break;
      const slice = cdic.subarray(18 + off, 18 + off + len);
      this.dictionary.push({ slice, isCompound });
    }
  }

  /**
   * Unpacks a single HUFF/CDIC-compressed record block.
   */
  public unpack(data: Uint8Array): Uint8Array {
    const chunks: Uint8Array[] = [];
    this.unpackInternal(data, chunks, 0);

    const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  private unpackInternal(data: Uint8Array, out: Uint8Array[], depth: number): void {
    if (depth > 64 || data.length === 0) {
      return;
    }

    // Pad with 8 zero bytes to safely read 64-bit blocks
    const padded = new Uint8Array(data.length + 8);
    padded.set(data);
    const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);

    let bitsleft = data.length * 8;
    let pos = 0;
    let x = view.getBigUint64(pos, false);
    let n = 32;

    while (true) {
      if (n <= 0) {
        pos += 4;
        if (pos + 8 <= padded.length) {
          x = view.getBigUint64(pos, false);
        } else {
          x = 0n;
        }
        n += 32;
      }

      const code = Number((x >> BigInt(n)) & 0xffffffffn) >>> 0;
      const d1 = this.dict1[code >>> 24];
      if (!d1) break;

      let codelen = d1.codelen;
      let maxcode = d1.maxcode;

      if (!d1.term) {
        while (codelen <= 32 && code < this.mincode[codelen]) {
          codelen++;
        }
        if (codelen > 32) break;
        maxcode = this.maxcodeTable[codelen];
      }

      bitsleft -= codelen;
      if (bitsleft < 0) {
        break;
      }
      n -= codelen;

      const r = Number((BigInt(maxcode >>> 0) - BigInt(code >>> 0)) >> BigInt(32 - codelen));
      if (r < 0 || r >= this.dictionary.length) {
        break;
      }

      const v = this.dictionary[r];
      if (v.isCompound) {
        this.unpackInternal(v.slice, out, depth + 1);
      } else {
        out.push(v.slice);
      }
    }
  }
}
