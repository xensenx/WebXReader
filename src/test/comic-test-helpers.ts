import zlib from 'node:zlib';
import { createSevenZipInstance } from '../core/parsing/sevenzip-init';

// Sample 1x1 valid JPEG bytes
export const SAMPLE_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
  0x00, 0x60, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
  0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
  0x00, 0xbf, 0x00, 0xff, 0xd9,
]);

export function crc32(buf: Buffer): number {
  return zlib.crc32(buf);
}

/**
 * Creates a valid RAR 4.0 stored archive in memory.
 */
export function createSyntheticRar(files: { name: string; content: Buffer }[]): ArrayBuffer {
  const parts: Buffer[] = [];

  // 1. Marker block (7 bytes)
  parts.push(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]));

  // 2. Archive header (MAIN_HEAD, type 0x73)
  const mainHeadBody = Buffer.alloc(11);
  mainHeadBody.writeUInt8(0x73, 0);
  mainHeadBody.writeUInt16LE(0x0000, 1);
  mainHeadBody.writeUInt16LE(13, 3);
  mainHeadBody.writeUInt16LE(0, 5);
  mainHeadBody.writeUInt32LE(0, 7);

  const mainHeadCrc = crc32(mainHeadBody) & 0xffff;
  const mainHead = Buffer.alloc(13);
  mainHead.writeUInt16LE(mainHeadCrc, 0);
  mainHeadBody.copy(mainHead, 2);
  parts.push(mainHead);

  // 3. File headers + contents
  for (const file of files) {
    const fileBytes = file.content;
    const fileNameBytes = Buffer.from(file.name, 'utf8');

    const bodySize = 7 - 2 + 25 + fileNameBytes.length;
    const headSize = bodySize + 2;

    const body = Buffer.alloc(bodySize);
    body.writeUInt8(0x74, 0); // FILE_HEAD
    body.writeUInt16LE(0x8000, 1); // flags
    body.writeUInt16LE(headSize, 3);
    body.writeUInt32LE(fileBytes.length, 5);
    body.writeUInt32LE(fileBytes.length, 9);
    body.writeUInt8(0x00, 13);
    body.writeUInt32LE(crc32(fileBytes), 14);
    body.writeUInt32LE(0x20000000, 18);
    body.writeUInt8(20, 22);
    body.writeUInt8(0x30, 23); // store method
    body.writeUInt16LE(fileNameBytes.length, 24);
    body.writeUInt32LE(0x20, 26);
    fileNameBytes.copy(body, 30);

    const headCrc = crc32(body) & 0xffff;
    const fileHead = Buffer.alloc(headSize);
    fileHead.writeUInt16LE(headCrc, 0);
    body.copy(fileHead, 2);

    parts.push(fileHead);
    parts.push(fileBytes);
  }

  // 4. End block
  const endBody = Buffer.alloc(5);
  endBody.writeUInt8(0x7b, 0);
  endBody.writeUInt16LE(0x0000, 1);
  endBody.writeUInt16LE(7, 3);
  const endCrc = crc32(endBody) & 0xffff;
  const endBlock = Buffer.alloc(7);
  endBlock.writeUInt16LE(endCrc, 0);
  endBody.copy(endBlock, 2);
  parts.push(endBlock);

  const finalBuffer = Buffer.concat(parts);
  return finalBuffer.buffer.slice(finalBuffer.byteOffset, finalBuffer.byteOffset + finalBuffer.byteLength);
}

/**
 * Creates a valid 7z / CB7 archive in memory using 7z-wasm CLI.
 */
export async function createSyntheticCb7(files: { name: string; content: Buffer }[]): Promise<ArrayBuffer> {
  const sevenZip = await createSevenZipInstance();
  const FS = sevenZip.FS;
  const id = `test_make_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  FS.mkdir(id);

  for (const file of files) {
    const segments = file.name.split('/');
    if (segments.length > 1) {
      let currentDir = id;
      for (let s = 0; s < segments.length - 1; s++) {
        currentDir += `/${segments[s]}`;
        try {
          FS.mkdir(currentDir);
        } catch {
          // ignore already created dir
        }
      }
    }
    FS.writeFile(`${id}/${file.name}`, file.content);
  }

  sevenZip.callMain(['a', `${id}/out.7z`, `./${id}/*`]);
  const data = FS.readFile(`${id}/out.7z`);

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
