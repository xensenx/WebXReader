/** Helpers for validating, resizing, and importing book cover images. */

export const MAX_COVER_FILE_SIZE = 20 * 1024 * 1024;
const MAX_COVER_EDGE = 1200;
const MAX_COVER_PIXELS = 40_000_000;

export interface CoverImageResult {
  data: string;
  width: number;
  height: number;
  isRemote: boolean;
}

function validateImageDimensions(width: number, height: number): void {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('This file does not contain a readable image.');
  }
  if (width * height > MAX_COVER_PIXELS) {
    throw new Error('This image is too large to process safely. Choose a smaller image.');
  }
}

async function readImageDimensions(src: string): Promise<{ width: number; height: number }> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Could not load an image from that URL. Check that it is a direct image link.'));
    image.src = src;
  });
  const { naturalWidth: width, naturalHeight: height } = image;
  validateImageDimensions(width, height);
  return { width, height };
}

async function optimizeImage(blob: Blob): Promise<Omit<CoverImageResult, 'isRemote'>> {
  if (blob.size > MAX_COVER_FILE_SIZE) {
    throw new Error('Choose an image smaller than 20 MB.');
  }
  if (blob.type && !blob.type.startsWith('image/')) {
    throw new Error('Choose a supported image file.');
  }

  let source: CanvasImageSource;
  let width: number;
  let height: number;
  let releaseSource: () => void = () => {};

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
    releaseSource = () => bitmap.close();
  } else {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('This file does not contain a readable image.'));
        image.src = objectUrl;
      });
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
    source = image;
    width = image.naturalWidth;
    height = image.naturalHeight;
    releaseSource = () => URL.revokeObjectURL(objectUrl);
  }

  try {
    validateImageDimensions(width, height);
    const scale = Math.min(1, MAX_COVER_EDGE / Math.max(width, height));
    const outputWidth = Math.max(1, Math.round(width * scale));
    const outputHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare this image for the library.');
    context.drawImage(source, 0, 0, outputWidth, outputHeight);
    const data = canvas.toDataURL('image/webp', 0.86);
    return { data, width, height };
  } finally {
    releaseSource();
  }
}

export async function prepareCoverFile(file: File): Promise<CoverImageResult> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose an image file such as JPG, PNG, or WebP.');
  }
  return { ...(await optimizeImage(file)), isRemote: false };
}

export async function importCoverFromUrl(rawUrl: string): Promise<CoverImageResult> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error('Enter a valid direct image URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use a public HTTP or HTTPS image URL.');
  }

  let response: Response;
  try {
    response = await fetch(url.href, { mode: 'cors', credentials: 'omit' });
  } catch {
    // Some image hosts allow display in an <img> but block cross-origin downloads.
    // Keep the validated URL in that case instead of preventing the cover change.
    const { width, height } = await readImageDimensions(url.href);
    return { data: url.href, width, height, isRemote: true };
  }

  if (!response.ok) {
    throw new Error(`The image could not be downloaded (HTTP ${response.status}).`);
  }
  const contentType = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
  if (!contentType.startsWith('image/')) {
    throw new Error('That link does not point directly to an image.');
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength > MAX_COVER_FILE_SIZE) {
    throw new Error('Choose an image smaller than 20 MB.');
  }
  const blob = await response.blob();
  const optimized = await optimizeImage(blob);
  return { ...optimized, isRemote: false };
}

export async function getCoverImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return readImageDimensions(src);
}
