import JSZip from 'jszip';

export const ZIP_LIMITS = {
  entries: 2000,
  depth: 32,
  entryBytes: 50 * 1024 * 1024,
  totalBytes: 300 * 1024 * 1024,
  coverBytes: 5 * 1024 * 1024,
} as const;

/** Validate central-directory sizes before a consumer can inflate any entry. */
export function validateZipArchive(zip: JSZip): void {
  const entries = Object.values(zip.files);
  if (entries.length > ZIP_LIMITS.entries) throw new Error('Archive contains too many entries.');
  let total = 0;
  for (const entry of entries) {
    const path = ((entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name).replace(/\\/g, '/');
    if (path.startsWith('/') || path.split('/').some((part) => part === '..' || part === '.') || path.split('/').length > ZIP_LIMITS.depth) {
      throw new Error('Archive contains an unsafe entry path.');
    }
    if (entry.dir) continue;
    const data = (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number; compressedSize?: number } })._data;
    const size = data?.uncompressedSize;
    const compressed = data?.compressedSize;
    if (!Number.isSafeInteger(size) || size! < 0 || size! > ZIP_LIMITS.entryBytes) {
      throw new Error(`Archive entry exceeds the ${ZIP_LIMITS.entryBytes / 1048576} MB limit.`);
    }
    if (Number.isSafeInteger(compressed) && compressed! > 0 && size! > 100 * 1024 && size! / compressed! > 100) {
      throw new Error('Archive entry has an unsafe compression ratio.');
    }
    total += size!;
    if (total > ZIP_LIMITS.totalBytes) throw new Error('Archive exceeds the expanded size limit.');
  }
}

/** JSZip's stream yields inflated chunks; reject before an oversized result is materialized. */
export function readZipEntryLimited(entry: JSZip.JSZipObject, limit = ZIP_LIMITS.entryBytes): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let finished = false;
    const stream = (entry as JSZip.JSZipObject & { internalStream: (type: 'uint8array') => JSZip.JSZipStreamHelper<Uint8Array> }).internalStream('uint8array');
    stream.on('data', (chunk: Uint8Array) => {
      if (finished) return;
      total += chunk.byteLength;
      if (total > limit) {
        finished = true;
        stream.pause();
        reject(new Error('Archive entry exceeded its expanded byte limit.'));
      } else chunks.push(chunk);
    });
    stream.on('error', (error: Error) => { if (!finished) { finished = true; reject(error); } });
    stream.on('end', () => {
      if (finished) return;
      finished = true;
      const output = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
      resolve(output);
    });
    stream.resume();
  });
}

export async function openBudgetedZip(data: ArrayBuffer | Uint8Array): Promise<JSZip> {
  const zip = await JSZip.loadAsync(data);
  validateZipArchive(zip);
  return zip;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
