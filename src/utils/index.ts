/**
 * Utility functions for WebXReader.
 */

/**
 * Generates a UUID v4.
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Computes SHA-256 hash of an ArrayBuffer.
 */
export async function computeHash(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Formats a byte size into a human-readable string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Formats a timestamp into a readable date string.
 */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  // Less than 1 minute
  if (diff < 60_000) return 'Just now';
  // Less than 1 hour
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  // Less than 24 hours
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  // Less than 7 days
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Formats reading time duration in seconds to readable string.
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Debounce function with flush capability.
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): T & { flush: () => void; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const debounced = function (this: unknown, ...args: Parameters<T>) {
    lastArgs = args;
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = null;
      fn.apply(this, args);
      lastArgs = null;
    }, delay);
  } as T & { flush: () => void; cancel: () => void };

  debounced.flush = () => {
    if (timeoutId && lastArgs) {
      clearTimeout(timeoutId);
      timeoutId = null;
      fn(...lastArgs);
      lastArgs = null;
    }
  };

  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
      lastArgs = null;
    }
  };

  return debounced;
}

/**
 * Throttle function.
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): T {
  let inThrottle = false;
  return function (this: unknown, ...args: Parameters<T>) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  } as T;
}

/**
 * Clamp a number between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Truncate text to a max length with ellipsis.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}

/**
 * Get the file extension from a filename.
 */
export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/**
 * Simple HTML sanitizer - removes script tags and event handlers.
 * For production, use DOMPurify or similar.
 */
export function sanitizeHtml(html: string): string {
  // Remove script tags and their content
  let cleaned = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // Remove on* event handlers
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '');
  // Remove javascript: URLs
  cleaned = cleaned.replace(/href\s*=\s*["']?\s*javascript:/gi, 'href="');
  // Remove data: URLs except for images
  cleaned = cleaned.replace(/src\s*=\s*["']?\s*data:(?!image\/)/gi, 'src="');
  return cleaned;
}

/**
 * Safely reads text from a File with encoding detection.
 */
export async function readFileAsText(file: File, encoding?: string): Promise<string> {
  const buffer = await readFileAsArrayBuffer(file);
  const selectedEncoding = encoding || 'UTF-8';
  try {
    const decoder = new TextDecoder(selectedEncoding, {
      // Do not silently turn a non-UTF-8 novel into replacement characters.
      // Callers can retry with an explicit legacy encoding when needed.
      fatal: selectedEncoding.toLowerCase() === 'utf-8',
    });
    const text = decoder.decode(buffer);
    if (!encoding && hasEncodingIssues(text)) {
      throw new Error('The file does not appear to be valid UTF-8. Choose UTF-8 or re-save the file with UTF-8 encoding and try again.');
    }
    return text;
  } catch (error) {
    if (error instanceof Error && error.message.includes('does not appear')) throw error;
    throw new Error(`Failed to decode file as ${selectedEncoding}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Reads a File as ArrayBuffer.
 */
export async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error(`Failed to read file: ${reader.error?.message}`));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Checks if text appears to have encoding issues (common mojibake patterns).
 */
export function hasEncodingIssues(text: string): boolean {
  // Common mojibake patterns
  const mojibakePatterns = /[\ufffd\u00c3\u00c2\u00e2\u0080]{3,}/;
  // High ratio of replacement characters
  const replacementCount = (text.match(/\ufffd/g) || []).length;
  const ratio = replacementCount / text.length;
  
  return mojibakePatterns.test(text.slice(0, 1000)) || ratio > 0.01;
}

/**
 * Escape HTML special characters.
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Convert a percentage (0-1) to a display string.
 */
export function formatProgress(progress: number): string {
  return `${Math.round(progress * 100)}%`;
}
