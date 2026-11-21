import { embeddedRasterUrl } from './embedded-raster';

const MAX_EMBEDDED_IMAGE_CHARS = 24 * 1024 * 1024;

export function inlineKindleImages(
  html: string,
  firstImageRecord: number,
  readRecord: (index: number) => Uint8Array | null,
): string {
  if (firstImageRecord < 0 || !/<(?:img|image)\b/i.test(html)) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  const images = new Map<number, string | undefined>();
  let remaining = MAX_EMBEDDED_IMAGE_CHARS;

  for (const element of template.content.querySelectorAll('img, svg image')) {
    const recindex = element.getAttribute('recindex') ?? element.getAttribute('hirecindex');
    const href = element.getAttribute('src') ?? element.getAttribute('href') ?? element.getAttribute('xlink:href') ?? '';
    const embed = /^kindle:embed:([0-9a-v]+)(?:\?|$)/i.exec(href)?.[1];
    const reference = embed ? Number.parseInt(embed, 32)
      : recindex && /^\d+$/.test(recindex) ? Number(recindex) : 0;
    if (!Number.isSafeInteger(reference) || reference < 1) continue;
    const index = firstImageRecord + reference - 1;
    if (!images.has(index)) images.set(index, embeddedRasterUrl(readRecord(index)));
    const source = images.get(index);
    if (!source || source.length > remaining) continue;
    remaining -= source.length;

    if (element.localName === 'image') {
      const image = template.content.ownerDocument.createElement('img');
      image.src = source;
      element.replaceWith(image);
      // A Kindle SVG wrapper containing only one image is represented by a regular image.
      const parent = image.parentElement;
      if (parent?.localName === 'svg' && parent.children.length === 1) parent.replaceWith(image);
    } else {
      element.setAttribute('src', source);
    }
  }
  return template.innerHTML;
}
