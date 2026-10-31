/**
 * Standalone PNG and JPEG image parser & metadata extractor for WebXReader.
 *
 * Provides fast, zero-dependency binary parsing of image dimensions, color profiles,
 * alpha channels, and EXIF orientation/metadata.
 */

import type { Chapter } from '../../types/book';

export interface ImageMetadata {
  format: 'png' | 'jpeg';
  width: number;
  height: number;
  rawWidth: number;
  rawHeight: number;
  orientation: number;
  hasAlpha: boolean;
  bitDepth?: number;
  colorType?: string;
  title?: string;
  author?: string;
  description?: string;
}

export interface ImageParseResult {
  metadata: {
    title?: string;
    author?: string;
    description?: string;
    identifiers: Record<string, string>;
  };
  tableOfContents: Chapter[];
  originalFile: ArrayBuffer;
  coverImage?: string;
  imageDetails: ImageMetadata;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

/**
 * Validates and detects whether a buffer is a PNG or JPEG image based on magic bytes.
 */
export function validateAndDetectImageFormat(bytes: Uint8Array): 'png' | 'jpeg' {
  if (bytes.length < 8) {
    throw new Error('Image file is too small or truncated (fewer than 8 bytes).');
  }

  const isPng = PNG_SIGNATURE.every((byte, idx) => bytes[idx] === byte);
  if (isPng) return 'png';

  const isJpeg =
    bytes[0] === JPEG_SIGNATURE[0] &&
    bytes[1] === JPEG_SIGNATURE[1] &&
    bytes[2] === JPEG_SIGNATURE[2];
  if (isJpeg) return 'jpeg';

  throw new Error('File is not a valid PNG or JPEG image: missing image file signature.');
}

/**
 * Parses PNG binary header and chunks (IHDR, tRNS, tEXt).
 */
export function parsePngHeader(bytes: Uint8Array): ImageMetadata {
  if (bytes.length < 24) {
    throw new Error('Corrupted PNG image: file is truncated before IHDR chunk.');
  }

  // Check IHDR length (bytes 8..11 = 13) and type (bytes 12..15 = 'IHDR')
  const ihdrType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (ihdrType !== 'IHDR') {
    throw new Error('Corrupted PNG image: missing IHDR chunk.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawWidth = view.getUint32(16, false);
  const rawHeight = view.getUint32(20, false);
  const bitDepth = bytes[24];
  const colorTypeCode = bytes[25];

  if (rawWidth === 0 || rawHeight === 0) {
    throw new Error(`Invalid PNG image dimensions: ${rawWidth} × ${rawHeight}.`);
  }

  let colorType = 'RGB';
  let hasAlpha = false;

  switch (colorTypeCode) {
    case 0:
      colorType = 'Grayscale';
      break;
    case 2:
      colorType = 'RGB';
      break;
    case 3:
      colorType = 'Palette';
      break;
    case 4:
      colorType = 'Grayscale + Alpha';
      hasAlpha = true;
      break;
    case 6:
      colorType = 'RGBA';
      hasAlpha = true;
      break;
    default:
      colorType = `Type ${colorTypeCode}`;
  }

  let title: string | undefined;
  let author: string | undefined;
  let description: string | undefined;

  // Scan chunks for tRNS (alpha transparency) and tEXt metadata
  let offset = 8;
  const maxScan = Math.min(bytes.length, 128 * 1024); // scan up to 128KB for header metadata

  while (offset + 8 <= maxScan) {
    const chunkLength = view.getUint32(offset, false);
    const chunkType = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    const dataOffset = offset + 8;

    if (chunkType === 'IEND') break;

    if (chunkType === 'tRNS') {
      hasAlpha = true;
    } else if (chunkType === 'tEXt' && dataOffset + chunkLength <= bytes.length) {
      try {
        let nullIdx = -1;
        for (let i = 0; i < chunkLength; i++) {
          if (bytes[dataOffset + i] === 0) {
            nullIdx = i;
            break;
          }
        }
        if (nullIdx > 0) {
          const key = String.fromCharCode(...bytes.slice(dataOffset, dataOffset + nullIdx)).toLowerCase();
          const val = String.fromCharCode(...bytes.slice(dataOffset + nullIdx + 1, dataOffset + chunkLength)).trim();
          if (val) {
            if (key === 'title') title = val;
            else if (key === 'author' || key === 'artist') author = val;
            else if (key === 'description' || key === 'comment') description = val;
          }
        }
      } catch {
        // ignore malformed tEXt chunk
      }
    }

    offset += 12 + chunkLength; // 4 len + 4 type + data + 4 crc
  }

  return {
    format: 'png',
    width: rawWidth,
    height: rawHeight,
    rawWidth,
    rawHeight,
    orientation: 1,
    hasAlpha,
    bitDepth,
    colorType,
    title,
    author,
    description,
  };
}

/**
 * Parses JPEG frame headers and EXIF orientation metadata.
 */
export function parseJpegHeader(bytes: Uint8Array): ImageMetadata {
  if (bytes.length < 4) {
    throw new Error('Corrupted JPEG image: file is truncated.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2; // skip SOI 0xFF, 0xD8
  let rawWidth = 0;
  let rawHeight = 0;
  let orientation = 1;
  let title: string | undefined;
  let author: string | undefined;
  let description: string | undefined;
  let colorComponents = 3;

  const len = bytes.length;

  while (offset + 4 < len) {
    // Find next marker (0xFF followed by non-0xFF)
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }

    while (offset < len && bytes[offset] === 0xff) {
      offset++;
    }
    if (offset >= len) break;

    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) {
      // EOI (0xD9) or SOS (0xDA - start of compressed image data)
      break;
    }

    if (offset + 2 > len) break;
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > len) break;

    const payloadOffset = offset + 2;

    // Check APP1 for EXIF data
    if (marker === 0xe1 && segmentLength >= 14) {
      const isExif =
        bytes[payloadOffset] === 0x45 && // 'E'
        bytes[payloadOffset + 1] === 0x78 && // 'x'
        bytes[payloadOffset + 2] === 0x69 && // 'i'
        bytes[payloadOffset + 3] === 0x66 && // 'f'
        bytes[payloadOffset + 4] === 0x00 &&
        bytes[payloadOffset + 5] === 0x00;

      if (isExif) {
        try {
          const tiffStart = payloadOffset + 6;
          const isLittleEndian = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49; // 'II' vs 'MM'
          const ifd0Offset = view.getUint32(tiffStart + 4, isLittleEndian);

          if (tiffStart + ifd0Offset + 2 <= len) {
            const entryCount = view.getUint16(tiffStart + ifd0Offset, isLittleEndian);
            let entryOffset = tiffStart + ifd0Offset + 2;

            for (let i = 0; i < entryCount && entryOffset + 12 <= len; i++) {
              const tag = view.getUint16(entryOffset, isLittleEndian);
              if (tag === 0x0112) {
                // Orientation tag
                orientation = view.getUint16(entryOffset + 8, isLittleEndian);
              } else if (tag === 0x010e) {
                // ImageDescription tag
                const valOffset = view.getUint32(entryOffset + 8, isLittleEndian);
                const strLen = view.getUint32(entryOffset + 4, isLittleEndian);
                if (tiffStart + valOffset + strLen <= len && strLen < 500) {
                  description = String.fromCharCode(
                    ...bytes.slice(tiffStart + valOffset, tiffStart + valOffset + strLen - 1)
                  ).trim();
                }
              } else if (tag === 0x013b) {
                // Artist / Author tag
                const valOffset = view.getUint32(entryOffset + 8, isLittleEndian);
                const strLen = view.getUint32(entryOffset + 4, isLittleEndian);
                if (tiffStart + valOffset + strLen <= len && strLen < 500) {
                  author = String.fromCharCode(
                    ...bytes.slice(tiffStart + valOffset, tiffStart + valOffset + strLen - 1)
                  ).trim();
                }
              }
              entryOffset += 12;
            }
          }
        } catch {
          // ignore EXIF parsing errors
        }
      }
    }

    // Check COM marker (0xFE) for embedded comment / title
    if (marker === 0xfe && segmentLength > 2) {
      try {
        const commentBytes = bytes.slice(payloadOffset, payloadOffset + segmentLength - 2);
        const comment = new TextDecoder('utf-8').decode(commentBytes).trim();
        if (comment) {
          title = comment;
          description = description || comment;
        }
      } catch {
        // ignore decoding errors
      }
    }

    // Check SOF markers (Start of Frame)
    const isSof =
      marker === 0xc0 || // Baseline
      marker === 0xc1 || // Extended sequential
      marker === 0xc2 || // Progressive
      marker === 0xc3 || // Lossless
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf;

    if (isSof && segmentLength >= 7) {
      rawHeight = view.getUint16(payloadOffset + 1, false);
      rawWidth = view.getUint16(payloadOffset + 3, false);
      colorComponents = bytes[payloadOffset + 5] || 3;
      break;
    }

    offset += segmentLength;
  }

  if (rawWidth === 0 || rawHeight === 0) {
    throw new Error('Corrupted JPEG image: unable to locate SOF frame dimensions.');
  }

  // Account for EXIF rotation: orientations 5, 6, 7, 8 transpose width & height
  const isTransposed = orientation >= 5 && orientation <= 8;
  const visualWidth = isTransposed ? rawHeight : rawWidth;
  const visualHeight = isTransposed ? rawWidth : rawHeight;

  return {
    format: 'jpeg',
    width: visualWidth,
    height: visualHeight,
    rawWidth,
    rawHeight,
    orientation,
    hasAlpha: false,
    colorType: colorComponents === 1 ? 'Grayscale' : colorComponents === 4 ? 'CMYK' : 'YCbCr',
    title,
    author,
    description,
  };
}

/**
 * Fast, chunked base64 conversion without stack overflow on large buffers.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, len)));
  }
  return btoa(binary);
}

/**
 * Generates an efficient thumbnail data URL for the library view.
 * For images <= 1.5 MB or outside browsers, encodes directly.
 */
export async function createThumbnailDataUrl(
  bytes: Uint8Array,
  mimeType: string,
  maxWidth = 400,
  maxHeight = 600
): Promise<string> {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    bytes.byteLength <= 1.5 * 1024 * 1024
  ) {
    return `data:${mimeType};base64,${uint8ArrayToBase64(bytes)}`;
  }

  try {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy.buffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    return await new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const { width, height } = img;
        const scale = Math.min(1, maxWidth / width, maxHeight / height);
        const targetW = Math.max(1, Math.round(width * scale));
        const targetH = Math.max(1, Math.round(height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(`data:${mimeType};base64,${uint8ArrayToBase64(bytes)}`);
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL(mimeType === 'image/png' ? 'image/png' : 'image/jpeg', 0.85));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(`data:${mimeType};base64,${uint8ArrayToBase64(bytes)}`);
      };
      img.src = url;
    });
  } catch {
    return `data:${mimeType};base64,${uint8ArrayToBase64(bytes)}`;
  }
}

/**
 * Parses a standalone PNG or JPEG image and prepares normalized WebXReader structures.
 */
export async function parseImage(
  buffer: ArrayBuffer | Uint8Array,
  options: { filename?: string; expectedFormat?: 'png' | 'jpeg' } = {}
): Promise<ImageParseResult> {
  const byteLength = buffer instanceof ArrayBuffer ? buffer.byteLength : buffer.length;
  if (!buffer || byteLength === 0) {
    throw new Error('Image file is empty (0 bytes).');
  }

  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const detectedFormat = validateAndDetectImageFormat(bytes);

  const imageDetails =
    detectedFormat === 'png' ? parsePngHeader(bytes) : parseJpegHeader(bytes);

  const mimeType = detectedFormat === 'png' ? 'image/png' : 'image/jpeg';
  const coverImage = await createThumbnailDataUrl(bytes, mimeType);

  const filename = options.filename || `Image.${detectedFormat === 'png' ? 'png' : 'jpg'}`;
  const baseTitle = filename.replace(/\.(png|jpe?g)$/i, '').replace(/[_\-.]+/g, ' ').trim() || 'Untitled';
  const displayTitle = imageDetails.title || baseTitle;

  const desc =
    imageDetails.description ||
    `${detectedFormat.toUpperCase()} image (${imageDetails.width} × ${imageDetails.height} px${
      imageDetails.hasAlpha ? ', alpha transparency' : ''
    }).`;

  let originalFile: ArrayBuffer;
  if (buffer instanceof ArrayBuffer) {
    originalFile = buffer;
  } else {
    const copy = new Uint8Array(buffer.byteLength);
    copy.set(buffer);
    originalFile = copy.buffer;
  }

  return {
    metadata: {
      title: displayTitle,
      author: imageDetails.author || 'Unknown Author',
      description: desc,
      identifiers: {
        width: String(imageDetails.width),
        height: String(imageDetails.height),
        rawWidth: String(imageDetails.rawWidth),
        rawHeight: String(imageDetails.rawHeight),
        orientation: String(imageDetails.orientation),
        format: detectedFormat,
        hasAlpha: String(imageDetails.hasAlpha),
      },
    },
    tableOfContents: [
      {
        id: 'image-1',
        title: displayTitle,
        level: 0,
        order: 0,
      },
    ],
    originalFile,
    coverImage,
    imageDetails,
  };
}
