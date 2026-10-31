/**
 * Shared Emscripten virtual filesystem helpers and types for 7z-wasm and RAR extraction.
 */

export interface SevenZipStat {
  mode: number;
  size: number;
  mtime?: number | Date;
}

export interface SevenZipFS {
  readdir: (path: string) => string[];
  stat: (path: string) => SevenZipStat;
  isDir: (mode: number) => boolean;
  isFile: (mode: number) => boolean;
  mkdir: (path: string) => void;
  rmdir: (path: string) => void;
  unlink: (path: string) => void;
  readFile: (path: string, options?: any) => any;
  writeFile: (path: string, data: any) => void;
}

export interface WalkItem {
  rel: string;
  full: string;
  isDir: boolean;
  size: number;
  mtime?: Date;
}

/**
 * Recursively removes a directory and all its files from Emscripten MEMFS.
 */
export function removeDirRecursive(FS: SevenZipFS, dir: string): void {
  try {
    const entries = FS.readdir(dir);
    for (const name of entries) {
      if (name === '.' || name === '..') continue;
      const full = `${dir}/${name}`;
      try {
        const stat = FS.stat(full);
        if (FS.isDir(stat.mode)) {
          removeDirRecursive(FS, full);
        } else {
          FS.unlink(full);
        }
      } catch {
        // Ignore individual unlink errors
      }
    }
    FS.rmdir(dir);
  } catch {
    // Ignore directory removal errors
  }
}

/**
 * Recursively walks a directory and returns relative and full paths of all files.
 */
export function walkDirectory(
  FS: SevenZipFS,
  dir: string,
  base: string = ''
): { rel: string; full: string }[] {
  const entries = FS.readdir(dir);
  const results: { rel: string; full: string }[] = [];

  for (const name of entries) {
    if (name === '.' || name === '..') continue;
    const full = `${dir}/${name}`;
    const rel = base ? `${base}/${name}` : name;
    try {
      const stat = FS.stat(full);
      if (FS.isDir(stat.mode)) {
        results.push(...walkDirectory(FS, full, rel));
      } else if (FS.isFile(stat.mode)) {
        results.push({ rel, full });
      }
    } catch {
      // Ignore individual read errors
    }
  }

  return results;
}

/**
 * Recursively walks a directory and collects metadata stats for entries.
 */
export function walkDirectoryWithStats(
  FS: SevenZipFS,
  dir: string,
  base: string = ''
): WalkItem[] {
  const entries = FS.readdir(dir);
  const results: WalkItem[] = [];

  for (const name of entries) {
    if (name === '.' || name === '..') continue;
    const full = `${dir}/${name}`;
    const rel = base ? `${base}/${name}` : name;
    try {
      const stat = FS.stat(full);
      const isDir = FS.isDir(stat.mode);
      results.push({
        rel,
        full,
        isDir,
        size: isDir ? 0 : stat.size,
        mtime: stat.mtime ? new Date(stat.mtime) : undefined,
      });
      if (isDir) {
        results.push(...walkDirectoryWithStats(FS, full, rel));
      }
    } catch {
      // Ignore individual read errors
    }
  }

  return results;
}
