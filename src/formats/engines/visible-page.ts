/** Find the first page intersecting the viewport's leading edge in reading order. */
export function findLeadingPage(
  pages: HTMLCollection,
  reachesViewport: (bounds: DOMRect) => boolean,
  reverse = false,
): Element | undefined {
  if (!pages.length) return undefined;
  const at = (index: number) => pages[reverse ? pages.length - 1 - index : index];
  let low = 0;
  let high = pages.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (reachesViewport(at(middle).getBoundingClientRect())) high = middle;
    else low = middle + 1;
  }
  const page = at(low);
  return reachesViewport(page.getBoundingClientRect()) ? page : undefined;
}
