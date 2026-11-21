/** Use the browser's painted page as the turning leaf; keep a single live text layout. */
export function turnBookPage(direction: 'forward' | 'backward', update: () => void) {
  if (!document.startViewTransition || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    update();
    return undefined;
  }

  const root = document.documentElement;
  root.dataset.readerTurn = direction;
  const transition = document.startViewTransition(update);
  void transition.ready.catch(() => undefined);
  const clear = () => {
    if (root.dataset.readerTurn === direction) delete root.dataset.readerTurn;
  };
  void transition.finished.then(clear, clear);
  return transition;
}
