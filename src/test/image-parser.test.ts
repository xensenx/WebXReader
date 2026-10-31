import { describe, it, expect } from 'vitest';
import {
  validateAndDetectImageFormat,
  parsePngHeader,
  parseJpegHeader,
  parseImage,
} from '../core/parsing/image-parser';
import { SAMPLE_JPEG } from './comic-test-helpers';

// Sample 2x2 RGBA PNG with alpha transparency
const SAMPLE_RGBA_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M/AwMDEwMDAAMYAAQMAA4d/nOIAAAAASUVORK5CYII=',
  'base64'
);

// Sample 1x1 8-bit Grayscale PNG without alpha
const SAMPLE_GRAY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNiAAAABgADNjd8qAAAAABJRU5ErkJggg==',
  'base64'
);

describe('Image Parser (PNG & JPEG)', () => {
  describe('Format Validation & Signature Detection', () => {
    it('detects PNG and JPEG signatures accurately', () => {
      expect(validateAndDetectImageFormat(SAMPLE_RGBA_PNG)).toBe('png');
      expect(validateAndDetectImageFormat(SAMPLE_JPEG)).toBe('jpeg');
    });

    it('rejects empty or truncated buffers', () => {
      expect(() => validateAndDetectImageFormat(new Uint8Array(0))).toThrow(/too small or truncated/i);
      expect(() => validateAndDetectImageFormat(new Uint8Array([0x89, 0x50, 0x4e]))).toThrow(/too small or truncated/i);
    });

    it('rejects unsupported or non-image binary files', () => {
      const dummy = Buffer.from('PK\x03\x04This is a zip file, not an image');
      expect(() => validateAndDetectImageFormat(dummy)).toThrow(/missing image file signature/i);
    });
  });

  describe('PNG Parsing & Metadata Extraction', () => {
    it('extracts dimensions, bit depth, and alpha transparency from RGBA PNG', () => {
      const meta = parsePngHeader(SAMPLE_RGBA_PNG);
      expect(meta.format).toBe('png');
      expect(meta.width).toBe(2);
      expect(meta.height).toBe(2);
      expect(meta.bitDepth).toBe(8);
      expect(meta.colorType).toBe('RGBA');
      expect(meta.hasAlpha).toBe(true);
    });

    it('correctly identifies grayscale PNG without alpha', () => {
      const meta = parsePngHeader(SAMPLE_GRAY_PNG);
      expect(meta.format).toBe('png');
      expect(meta.width).toBe(1);
      expect(meta.height).toBe(1);
      expect(meta.colorType).toBe('Grayscale');
      expect(meta.hasAlpha).toBe(false);
    });

    it('rejects corrupted PNG missing IHDR', () => {
      const corrupted = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x4e, 0x4f, 0x54, 0x50]),
        Buffer.alloc(16),
      ]);
      expect(() => parsePngHeader(corrupted)).toThrow(/missing IHDR/i);
    });
  });

  describe('JPEG Parsing & Metadata Extraction', () => {
    it('extracts dimensions and orientation from JPEG', () => {
      const meta = parseJpegHeader(SAMPLE_JPEG);
      expect(meta.format).toBe('jpeg');
      expect(meta.width).toBe(1);
      expect(meta.height).toBe(1);
      expect(meta.rawWidth).toBe(1);
      expect(meta.rawHeight).toBe(1);
      expect(meta.orientation).toBe(1);
      expect(meta.hasAlpha).toBe(false);
    });

    it('rejects corrupted JPEG missing SOF frame', () => {
      const corrupted = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);
      expect(() => parseJpegHeader(corrupted)).toThrow(/unable to locate SOF frame/i);
    });
  });

  describe('Full parseImage Integration', () => {
    it('parses PNG image into full WebXReader book structure', async () => {
      const result = await parseImage(SAMPLE_RGBA_PNG, { filename: 'artwork.png' });

      expect(result.metadata.title).toBe('artwork');
      expect(result.metadata.identifiers.format).toBe('png');
      expect(result.metadata.identifiers.width).toBe('2');
      expect(result.metadata.identifiers.height).toBe('2');
      expect(result.metadata.identifiers.hasAlpha).toBe('true');
      expect(result.tableOfContents.length).toBe(1);
      expect(result.coverImage).toContain('data:image/png;base64,');
      expect(result.originalFile.byteLength).toBe(SAMPLE_RGBA_PNG.byteLength);
    });

    it('parses JPEG image into full WebXReader book structure', async () => {
      const result = await parseImage(SAMPLE_JPEG, { filename: 'photo_scenery.jpg' });

      expect(result.metadata.title).toBe('photo scenery');
      expect(result.metadata.identifiers.format).toBe('jpeg');
      expect(result.metadata.identifiers.width).toBe('1');
      expect(result.metadata.identifiers.height).toBe('1');
      expect(result.tableOfContents.length).toBe(1);
      expect(result.coverImage).toContain('data:image/jpeg;base64,');
      expect(result.originalFile.byteLength).toBe(SAMPLE_JPEG.byteLength);
    });

    it('corrects mismatch when file extension does not match true binary format', async () => {
      // JPEG file intentionally given .png filename
      const result = await parseImage(SAMPLE_JPEG, { filename: 'sneaky_photo.png', expectedFormat: 'png' });
      expect(result.metadata.identifiers.format).toBe('jpeg');
      expect(result.coverImage).toContain('data:image/jpeg;base64,');
    });

    it('rejects empty input buffer', async () => {
      await expect(parseImage(new ArrayBuffer(0))).rejects.toThrow(/empty/i);
    });
  });
});
