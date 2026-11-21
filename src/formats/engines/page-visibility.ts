/** Share a viewport observer across the pages of one document. */
export function createPageVisibility() {
  type Callback = (visible: boolean) => void;
  const callbacks = new Map<Element, Callback>();
  let observer: IntersectionObserver | undefined;

  return {
    watch(root: Element, page: Element, callback: Callback) {
      if (typeof IntersectionObserver === 'undefined') return;
      observer ??= new IntersectionObserver((entries) => {
        for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting);
      }, { root, rootMargin: '280px 0px' });
      callbacks.set(page, callback);
      observer.observe(page);
      return () => {
        observer?.unobserve(page);
        callbacks.delete(page);
        if (!callbacks.size) {
          observer?.disconnect();
          observer = undefined;
        }
      };
    },
  };
}
