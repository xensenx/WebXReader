import { detectRasterMimeType } from './embedded-raster';
﻿import type JSZip from 'jszip';
import { normalizeReaderUrl } from './sanitize-reader-html';
import { bytesToBase64, readZipEntryLimited, ZIP_LIMITS } from './zip-budget';

const MAX_PACKAGE_BYTES = 1024 * 1024;
const MAX_COVER_PAGE_BYTES = 256 * 1024;
const MAX_IMAGE_CANDIDATES = 12;
const ARCHIVE_ORIGIN = 'https://epub.invalid';
const IMAGE_PATH = /\.(?:png|jpe?g|gif|webp|avif|svg)$/i;
const COVER_NAME = /(?:^|[\d._ -])(?:front[ _-]?)?cover(?:[._ -]|$)/i;

function archivePath(href: string | null, base = ''): string | undefined {
  if (!href) return undefined;
  const clean = normalizeReaderUrl(href);
  if (/^(?:[a-z][\w+.-]*:|\/\/)|\\|%(?:2f|5c)/i.test(clean)) return undefined;
  try {
    const url = new URL(clean, `${ARCHIVE_ORIGIN}/${base.split('/').map(encodeURIComponent).join('/')}`);
    if (url.origin === ARCHIVE_ORIGIN) return decodeURIComponent(url.pathname.slice(1));
  } catch {
    // Ignore malformed or unsupported references.
  }
  return undefined;
}

function elements(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', name));
}

function hasToken(value: string | null, token: string): boolean {
  return value?.trim().toLowerCase().split(/\s+/).includes(token) ?? false;
}

async function readText(zip: JSZip, path: string, limit: number): Promise<string | undefined> {
  const entry = zip.file(path);
  if (!entry) return undefined;
  try {
    const bytes = await readZipEntryLimited(entry, limit);
    const charset = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return undefined;
  }
}

function parseXml(markup: string): Document | undefined {
  const doc = new DOMParser().parseFromString(markup, 'application/xml');
  return elements(doc, 'parsererror').length ? undefined : doc;
}

function embeddedImage(href: string | null): string | undefined {
  const encoded = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,([a-z0-9+/=\s]+)$/i.exec(href ?? '')?.[1];
  if (!encoded || encoded.length > Math.ceil(ZIP_LIMITS.coverBytes / 3) * 4) return undefined;
  try {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const mime = detectRasterMimeType(bytes);
    return mime && bytes.length <= ZIP_LIMITS.coverBytes
      ? `data:${mime};base64,${bytesToBase64(bytes)}`
      : undefined;
  } catch {
    return undefined;
  }
}

function coverPageImages(markup: string): { hrefs: string[]; imageOnly: boolean } {
  // Keep document resources inert. Only read the image references from this fragment.
  const template = document.createElement('template');
  template.innerHTML = markup;
  const content = template.content;
  const images = content.querySelectorAll('img[src], svg image, object[data]');
  const hrefs = [...new Set(Array.from(images, (image) =>
    image.getAttribute('src') || image.getAttribute('href') || image.getAttribute('xlink:href') || image.getAttribute('data')
  ).filter((href): href is string => Boolean(href)))];
  content.querySelectorAll('title, style, script, object, svg').forEach((node) => node.remove());
  return { hrefs, imageOnly: !content.textContent?.trim() };
}

/** Extract one cover from a validated local EPUB archive without rendering a page or fetching URLs. */
export async function extractEpubCover(zip: JSZip): Promise<string | undefined> {
  const container = await readText(zip, 'META-INF/container.xml', MAX_COVER_PAGE_BYTES);
  const containerDoc = container && parseXml(container);
  if (!containerDoc) return undefined;

  const rootfiles = elements(containerDoc, 'rootfile').filter((item) => item.hasAttribute('full-path'));
  const packagePath = rootfiles
    .map((item) => archivePath(item.getAttribute('full-path')))
    .find((path) => path && zip.file(path));
  if (!packagePath) return undefined;
  const markup = await readText(zip, packagePath, MAX_PACKAGE_BYTES);
  const opf = markup && parseXml(markup);
  if (!opf) return undefined;

  const items = elements(opf, 'manifest').flatMap((manifest) => elements(manifest, 'item'));
  const byId = new Map(items.map((item) => [item.getAttribute('id'), item]));
  const hrefOf = (item?: Element) => archivePath(item?.getAttribute('href') ?? null, packagePath);
  const declared = items.filter((item) => hasToken(item.getAttribute('properties'), 'cover-image'));
  for (const meta of elements(opf, 'meta')) {
    if (meta.getAttribute('name')?.toLowerCase() !== 'cover') continue;
    const item = byId.get(meta.getAttribute('content')?.trim() ?? null);
    if (item) declared.push(item);
  }

  const attempted = new Set<string>();
  async function imageAt(path: string | undefined): Promise<string | undefined> {
    if (!path || attempted.has(path) || attempted.size >= MAX_IMAGE_CANDIDATES) return undefined;
    const entry = zip.file(path);
    if (!entry) return undefined;
    attempted.add(path);
    try {
      const bytes = await readZipEntryLimited(entry, ZIP_LIMITS.coverBytes);
      const mime = detectRasterMimeType(bytes);
      if (mime) return `data:${mime};base64,${bytesToBase64(bytes)}`;
      if (/\.svg$/i.test(path)) {
        const svg = new TextDecoder().decode(bytes);
        const doc = parseXml(svg);
        if (doc?.documentElement.localName !== 'svg') return undefined;
        const images = elements(doc, 'image');
        for (const image of images.slice(0, MAX_IMAGE_CANDIDATES)) {
          const href = image.getAttribute('href') || image.getAttribute('xlink:href');
          const inline = embeddedImage(href);
          if (inline) return inline;
          const rasterPath = archivePath(href, path);
          if (rasterPath && !/\.svg$/i.test(rasterPath)) {
            const cover = await imageAt(rasterPath);
            if (cover) return cover;
          }
        }
        if (images.length && !doc.querySelector('path, rect, circle, ellipse, line, polyline, polygon, text')) {
          return undefined;
        }
        // SVGs are used only in an HTML image element, with scripts and external resources disabled.
        return `data:image/svg+xml;base64,${bytesToBase64(bytes)}`;
      }
    } catch {
      // A broken or oversized candidate should not hide the next candidate.
    }
    return undefined;
  }

  async function coverAt(path: string | undefined, requireImageOnly = false): Promise<string | undefined> {
    if (!path) return undefined;
    if (IMAGE_PATH.test(path)) return imageAt(path);
    const page = await readText(zip, path, MAX_COVER_PAGE_BYTES);
    if (!page) return undefined;
    const { hrefs, imageOnly } = coverPageImages(page);
    if (requireImageOnly && (!imageOnly || hrefs.length !== 1)) return undefined;
    for (const href of hrefs.slice(0, MAX_IMAGE_CANDIDATES)) {
      const image = embeddedImage(href) ?? await imageAt(archivePath(href, path));
      if (image) return image;
    }
    return undefined;
  }

  const guide = elements(opf, 'reference').filter((item) => hasToken(item.getAttribute('type'), 'cover'));
  const explicitPaths = [
    ...declared.map(hrefOf),
    ...guide.map((item) => archivePath(item.getAttribute('href'), packagePath)),
  ];
  const navItem = items.find((item) => hasToken(item.getAttribute('properties'), 'nav'));
  const navPath = hrefOf(navItem);
  const coverInNavigation = async () => {
    if (!navPath) return undefined;
    const nav = await readText(zip, navPath, MAX_COVER_PAGE_BYTES);
    const navDoc = nav && parseXml(nav);
    if (!navDoc) return undefined;
    const landmarks = elements(navDoc, 'nav').find((element) => hasToken(element.getAttribute('epub:type'), 'landmarks'));
    const cover = landmarks && elements(landmarks, 'a').find((element) => hasToken(element.getAttribute('epub:type'), 'cover'));
    return cover ? archivePath(cover.getAttribute('href'), navPath) : undefined;
  };

  for (const path of [...new Set(explicitPaths)].slice(0, MAX_IMAGE_CANDIDATES)) {
    const cover = await coverAt(path);
    if (cover) return cover;
  }
  const landmarkCover = await coverAt(await coverInNavigation());
  if (landmarkCover) return landmarkCover;

  const firstSpine = elements(opf, 'itemref').find((item) => item.getAttribute('linear') !== 'no');
  const firstPath = firstSpine && hrefOf(byId.get(firstSpine.getAttribute('idref')));
  const firstCover = await coverAt(firstPath, true);
  if (firstCover) return firstCover;

  const namedImages = items.map(hrefOf).filter((path): path is string =>
    Boolean(path && IMAGE_PATH.test(path) && COVER_NAME.test(path.split('/').at(-1) ?? ''))
  );
  for (const path of namedImages.slice(0, MAX_IMAGE_CANDIDATES)) {
    const cover = await imageAt(path);
    if (cover) return cover;
  }
  return undefined;
}
