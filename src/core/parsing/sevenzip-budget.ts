import type { SevenZipModule } from './sevenzip-init';
import { walkDirectoryWithStats } from './sevenzip-common';

const MAX_ENTRIES = 2000;
const MAX_DEPTH = 32;
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;

export function runSevenZip(sevenZip: SevenZipModule, args: string[]): void {
  try {
    sevenZip.callMain(args);
  } catch (error) {
    const status = (error as { status?: unknown })?.status;
    if (status === 0) return;
    throw new Error(`Archive operation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Parse 7-Zip's technical listing before any archive member is extracted. */
export function validateSevenZipListing(lines: string[]): void {
  const output = lines.join('\n');
  const separator = output.indexOf('----------');
  if (separator < 0) throw new Error('Could not inspect archive entries safely.');
  const records = output.slice(separator + 10).split(/\n\s*\n/);
  let entries = 0;
  let total = 0;
  for (const record of records) {
    const path = /^Path = (.+)$/m.exec(record)?.[1];
    if (!path) continue;
    const normalized = path.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.split('/').some((part) => part === '.' || part === '..') || normalized.split('/').length > MAX_DEPTH) {
      throw new Error('Archive contains an unsafe entry path.');
    }
    entries++;
    if (entries > MAX_ENTRIES) throw new Error('Archive contains too many entries.');
    if (/^Folder = \+$/m.test(record)) continue;
    const sizeText = /^Size = (\d+)$/m.exec(record)?.[1];
    if (!sizeText) throw new Error('Archive entry has no declared size.');
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size > MAX_ENTRY_BYTES) throw new Error('Archive entry exceeds the expanded size limit.');
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new Error('Archive exceeds the expanded size limit.');
  }
  if (entries === 0) throw new Error('Archive contains no entries.');
}

export function inspectSevenZipArchive(sevenZip: SevenZipModule, inputFile: string, output: string[]): void {
  output.length = 0;
  runSevenZip(sevenZip, ['l', '-slt', inputFile]);
  validateSevenZipListing(output);
  output.length = 0;
}

/** Stop MEMFS writes as soon as actual inflated bytes exceed the declared budget. */
export function extractSevenZipWithBudget(sevenZip: SevenZipModule, outDir: string, args: string[]): void {
  const fs = sevenZip.FS;
  const originalWrite = fs.write;
  const fileSizes = new Map<string, number>();
  let total = 0;
  let limitExceeded = false;
  fs.write = (stream, buffer, offset, length, position, canOwn) => {
    const path = fs.getPath(stream.object);
    if (path.startsWith(`${outDir}/`)) {
      const previous = fileSizes.get(path) ?? 0;
      const start = position ?? (stream as typeof stream & { position?: number }).position ?? previous;
      const next = Math.max(previous, start + length);
      if (next > MAX_ENTRY_BYTES || total + next - previous > MAX_TOTAL_BYTES) {
        limitExceeded = true;
        throw new Error('Archive exceeded the actual expanded byte limit.');
      }
      fileSizes.set(path, next);
      total += next - previous;
    }
    return originalWrite.call(fs, stream, buffer, offset, length, position, canOwn);
  };
  try {
    runSevenZip(sevenZip, args);
    if (limitExceeded) throw new Error('Archive exceeded the actual expanded byte limit.');
    const items = walkDirectoryWithStats(fs, outDir);
    let totalBytes = 0;
    if (items.length > MAX_ENTRIES) throw new Error('Archive contains too many extracted entries.');
    for (const item of items) {
      if (item.rel.split('/').length > MAX_DEPTH || item.size > MAX_ENTRY_BYTES) {
        throw new Error('Archive extracted entry exceeds its limit.');
      }
      totalBytes += item.size;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Archive exceeds the actual expanded byte limit.');
    }
  } finally {
    fs.write = originalWrite;
  }
}
