import { expect, it } from 'vitest';
import { inlineKindleImages } from '../core/parsing/kindle-images';
import { sanitizeBookChapter } from '../core/parsing/sanitize-reader-html';
import { SAMPLE_JPEG } from './comic-test-helpers';

it('keeps local MOBI and KF8 raster records through the reader sanitizer', () => {
  for (const [format, markup, record] of [
    ['mobi', '<img recindex="2" alt="Map">', 11],
    ['azw3', '<svg><image xlink:href="kindle:embed:000A?mime=image/jpeg"/></svg>', 19],
  ] as const) {
    const withInline = inlineKindleImages(markup + '<img src="https://example.org/remote.jpg">', 10,
      (index) => index === record ? SAMPLE_JPEG : null);
    const html = sanitizeBookChapter(withInline, format);
    expect(html).toContain('data:image/jpeg;base64,');
    expect(html).not.toContain('https://example.org');
  }
});
