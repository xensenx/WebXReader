import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Book, LibraryLayout } from '../../types/book';

interface BookPointerDrag {
  bookId: string;
  pointerId: number;
  pointerType: string;
  captureElement: HTMLElement;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  width: number;
  height: number;
  active: boolean;
  order: string[];
  startOrder: string[];
}

export interface BookDragPreview {
  book: Book;
  width: number;
  height: number;
  left: number;
  top: number;
}

const TOUCH_SLOP_PX = 14;
const TOUCH_HOLD_DELAY_MS = 180;

interface BookLayoutRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

// FLIP animations translate cards visually while their layout slots have already
// moved. Use the untransformed layout box for hit testing so an in-flight
// animation cannot change the reorder decision underneath a slow pointer.
function getBookLayoutRect(element: HTMLElement): BookLayoutRect {
  const offsetParent = element.offsetParent;
  if (!(offsetParent instanceof HTMLElement)) {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }

  const parentRect = offsetParent.getBoundingClientRect();
  const left = parentRect.left + offsetParent.clientLeft + element.offsetLeft - offsetParent.scrollLeft;
  const top = parentRect.top + offsetParent.clientTop + element.offsetTop - offsetParent.scrollTop;
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

interface BookReorderOptions<T extends Book> {
  books: T[];
  layout: LibraryLayout;
  onCommit: (order: string[]) => void;
  enabled?: boolean;
}

/** Shared pointer-based reordering for library books and series volumes. */
export function useBookReorder<T extends Book>({ books, layout, onCommit, enabled = true }: BookReorderOptions<T>) {
  const [draggingBookId, setDraggingBookId] = useState<string | null>(null);
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const draggedIdRef = useRef<string | null>(null);
  const pointerDragRef = useRef<BookPointerDrag | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const autoScrollSpeedRef = useRef<number>(0);
  const [dragPreview, setDragPreview] = useState<BookDragPreview | null>(null);
  const dragPreviewElementRef = useRef<HTMLDivElement | null>(null);
  const suppressBookClickRef = useRef(false);
  const suppressBookClickTimerRef = useRef<number | null>(null);
  const bookItemsRef = useRef<HTMLDivElement | null>(null);
  const pendingReorderPositionsRef = useRef<Map<string, DOMRect> | null>(null);
  const reorderAnimationsRef = useRef(new WeakMap<HTMLElement, Animation>());

  const orderedBooks = useMemo(() => {
    if (!dragOrder) return books;
    const positions = new Map(dragOrder.map((id, index) => [id, index]));
    return [...books].sort((left, right) => (positions.get(left.id) ?? positions.size) - (positions.get(right.id) ?? positions.size));
  }, [books, dragOrder]);

  useLayoutEffect(() => {
    const previousPositions = pendingReorderPositionsRef.current;
    pendingReorderPositionsRef.current = null;
    const container = bookItemsRef.current;
    if (!previousPositions || !container || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const elementsById = new Map<string, HTMLElement>();
    container.querySelectorAll<HTMLElement>('[data-book-id]').forEach((element) => {
      if (element.dataset.bookId) elementsById.set(element.dataset.bookId, element);
    });

    for (const [bookId, previousRect] of previousPositions) {
      const element = elementsById.get(bookId);
      if (!element) continue;
      const nextRect = element.getBoundingClientRect();
      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;

      reorderAnimationsRef.current.get(element)?.cancel();
      const animation = element.animate(
        [
          { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        { duration: 190, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
      reorderAnimationsRef.current.set(element, animation);
    }
  }, [orderedBooks, layout]);

  const captureBookPositions = (bookIds?: ReadonlySet<string>) => {
    const positions = new Map<string, DOMRect>();
    bookItemsRef.current?.querySelectorAll<HTMLElement>('[data-book-id]').forEach((element) => {
      const id = element.dataset.bookId;
      if (id && (!bookIds || bookIds.has(id))) positions.set(id, element.getBoundingClientRect());
    });
    return positions;
  };

  const cancelBookReorderAnimations = (bookIds?: ReadonlySet<string>) => {
    bookItemsRef.current?.querySelectorAll<HTMLElement>('[data-book-id]').forEach((element) => {
      const id = element.dataset.bookId;
      if (!id || (bookIds && !bookIds.has(id))) return;
      reorderAnimationsRef.current.get(element)?.cancel();
      reorderAnimationsRef.current.delete(element);
    });
  };

  const getBookElementAtPoint = (clientX: number, clientY: number): HTMLElement | null => {
    const container = bookItemsRef.current;
    if (!container) return null;

    let closestElement: HTMLElement | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    container.querySelectorAll<HTMLElement>('[data-book-id]').forEach((element) => {
      if (element.dataset.bookId === draggedIdRef.current) return;
      const rect = getBookLayoutRect(element);
      const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
      const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
      const distance = Math.hypot(dx, dy);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestElement = element;
      }
    });

    return closestElement;
  };

  const getReorderForDropTarget = (targetElement: HTMLElement, clientX: number, clientY: number) => {
    const drag = pointerDragRef.current;
    const sourceId = drag?.bookId;
    const targetId = targetElement.dataset.bookId;
    if (!drag?.active || !sourceId || !targetId || sourceId === targetId) return null;

    const currentOrder = drag.order;
    const sourceIndex = currentOrder.indexOf(sourceId);
    const targetIndex = currentOrder.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return null;

    const targetRect = getBookLayoutRect(targetElement);
    const horizontalDeadZone = Math.max(12, Math.min(24, targetRect.width * 0.1));
    const verticalDeadZone = Math.max(12, Math.min(28, targetRect.height * 0.08));
    const columnCount = layout === 'grid' && bookItemsRef.current
      ? getComputedStyle(bookItemsRef.current).gridTemplateColumns.split(' ').filter(Boolean).length
      : 1;
    let pointerIsAfterTarget: boolean;
    if (columnCount > 1 && clientY < targetRect.top - verticalDeadZone) {
      pointerIsAfterTarget = false;
    } else if (columnCount > 1 && clientY > targetRect.bottom + verticalDeadZone) {
      pointerIsAfterTarget = true;
    } else if (columnCount > 1) {
      const horizontalOffset = clientX - (targetRect.left + targetRect.width / 2);
      if (Math.abs(horizontalOffset) <= horizontalDeadZone) return null;
      pointerIsAfterTarget = horizontalOffset > 0;
    } else {
      const verticalOffset = clientY - (targetRect.top + targetRect.height / 2);
      if (Math.abs(verticalOffset) <= verticalDeadZone) return null;
      pointerIsAfterTarget = verticalOffset > 0;
    }

    const nextOrder = [...currentOrder];
    nextOrder.splice(sourceIndex, 1);
    let insertAt = nextOrder.indexOf(targetId);
    if (insertAt < 0) return null;
    if (pointerIsAfterTarget) insertAt++;
    nextOrder.splice(insertAt, 0, sourceId);

    if (nextOrder.every((id, index) => id === currentOrder[index])) return null;

    const affectedStart = Math.min(sourceIndex, targetIndex);
    const affectedEnd = Math.max(sourceIndex, targetIndex);
    return {
      nextOrder,
      affectedIds: new Set(currentOrder.slice(affectedStart, affectedEnd + 1)),
    };
  };

  const updateBookDropPreview = (clientX: number, clientY: number) => {
    const containerRect = bookItemsRef.current?.getBoundingClientRect();
    if (!containerRect || clientX < containerRect.left || clientX > containerRect.right ||
      clientY < containerRect.top || clientY > containerRect.bottom) return;

    const target = getBookElementAtPoint(clientX, clientY);
    if (!target) return;
    const reorder = getReorderForDropTarget(target, clientX, clientY);
    if (!reorder) return;
    pendingReorderPositionsRef.current = captureBookPositions(reorder.affectedIds);
    // Capture the cards' current visual positions, then stop their old FLIP
    // transforms before React applies the next order. The following layout
    // effect can then animate from the captured position to the true new slot.
    cancelBookReorderAnimations(reorder.affectedIds);
    if (pointerDragRef.current) pointerDragRef.current.order = reorder.nextOrder;
    setDragOrder(reorder.nextOrder);
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const stopAutoScroll = () => {
    autoScrollSpeedRef.current = 0;
    if (autoScrollRafRef.current !== null) {
      window.cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
  };

  const triggerAutoScroll = (clientY: number) => {
    const edgeThreshold = 80;
    const maxScrollStep = 12;
    const viewportHeight = window.innerHeight;
    let scrollSpeed = 0;

    if (clientY < edgeThreshold) {
      const intensity = (edgeThreshold - Math.max(0, clientY)) / edgeThreshold;
      scrollSpeed = -Math.round(intensity * maxScrollStep);
    } else if (clientY > viewportHeight - edgeThreshold) {
      const intensity = (Math.min(viewportHeight, clientY) - (viewportHeight - edgeThreshold)) / edgeThreshold;
      scrollSpeed = Math.round(intensity * maxScrollStep);
    }

    autoScrollSpeedRef.current = scrollSpeed;

    if (scrollSpeed === 0) {
      stopAutoScroll();
      return;
    }

    if (autoScrollRafRef.current === null) {
      const step = () => {
        const currentDrag = pointerDragRef.current;
        const currentSpeed = autoScrollSpeedRef.current;
        if (!currentDrag?.active || currentSpeed === 0) {
          stopAutoScroll();
          return;
        }

        window.scrollBy(0, currentSpeed);
        updateBookDropPreview(currentDrag.currentX, currentDrag.currentY);
        autoScrollRafRef.current = window.requestAnimationFrame(step);
      };
      autoScrollRafRef.current = window.requestAnimationFrame(step);
    }
  };

  const handleBookPointerDown = (id: string, e: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || e.button !== 0 || pointerDragRef.current) return;
    if ((e.target as HTMLElement).closest('button, a, input, [role="menu"]')) return;

    clearLongPressTimer();
    stopAutoScroll();

    const previewSource = e.currentTarget.querySelector<HTMLElement>('[data-drag-preview]');
    const previewBounds = previewSource?.getBoundingClientRect() ?? e.currentTarget.getBoundingClientRect();
    const currentOrder = books.map((book) => book.id);
    const targetElement = e.currentTarget;
    const targetPointerId = e.pointerId;

    const drag: BookPointerDrag = {
      bookId: id,
      pointerId: targetPointerId,
      pointerType: e.pointerType,
      captureElement: targetElement,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      width: Math.max(1, previewBounds.width),
      height: Math.max(1, previewBounds.height),
      active: false,
      order: currentOrder,
      startOrder: currentOrder,
    };
    pointerDragRef.current = drag;

    if (e.pointerType === 'touch') {
      // Touch devices: wait for press-and-hold without moving to distinguish from scrolling
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        const currentDrag = pointerDragRef.current;
        if (!currentDrag || currentDrag.pointerId !== targetPointerId || currentDrag.active) return;

        currentDrag.active = true;
        draggedIdRef.current = currentDrag.bookId;
        pendingReorderPositionsRef.current = null;
        setDraggingBookId(currentDrag.bookId);

        // Lock document-level panning during active touch drag
        document.body.style.touchAction = 'none';
        document.body.style.userSelect = 'none';

        const draggedBook = books.find((b) => b.id === currentDrag.bookId);
        if (draggedBook) {
          setDragPreview({
            book: draggedBook,
            width: currentDrag.width,
            height: currentDrag.height,
            left: currentDrag.currentX - currentDrag.width / 2,
            top: currentDrag.currentY - currentDrag.height / 2,
          });
        }

        try {
          targetElement.setPointerCapture(targetPointerId);
        } catch {
          // ignore if already captured or failed
        }

        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try {
            navigator.vibrate(35);
          } catch {
            // vibration not supported or allowed
          }
        }

        suppressBookClickRef.current = true;
      }, TOUCH_HOLD_DELAY_MS);
    } else {
      // Mouse/pen: capture pointer immediately
      try {
        targetElement.setPointerCapture(e.pointerId);
      } catch {
        pointerDragRef.current = null;
      }
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    drag.currentX = e.clientX;
    drag.currentY = e.clientY;

    if (!drag.active) {
      const distance = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);

      if (drag.pointerType === 'touch') {
        // If finger moved > TOUCH_SLOP_PX before long press completed, user is scrolling
        if (distance > TOUCH_SLOP_PX) {
          clearLongPressTimer();
          pointerDragRef.current = null;
        }
        return;
      }

      if (distance < 6) return;

      drag.active = true;
      draggedIdRef.current = drag.bookId;
      pendingReorderPositionsRef.current = null;
      setDraggingBookId(drag.bookId);
      const draggedBook = books.find((book) => book.id === drag.bookId);
      if (draggedBook) {
        setDragPreview({
          book: draggedBook,
          width: drag.width,
          height: drag.height,
          left: e.clientX - drag.width / 2,
          top: e.clientY - drag.height / 2,
        });
      }
    }

    e.preventDefault();
    const left = e.clientX - drag.width / 2;
    const top = e.clientY - drag.height / 2;
    const previewElement = dragPreviewElementRef.current;
    if (previewElement) previewElement.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    updateBookDropPreview(e.clientX, e.clientY);
    triggerAutoScroll(e.clientY);
  };

  const clearBookClickSuppression = () => {
    suppressBookClickRef.current = false;
    if (suppressBookClickTimerRef.current !== null) {
      window.clearTimeout(suppressBookClickTimerRef.current);
      suppressBookClickTimerRef.current = null;
    }
  };

  const shouldSuppressBookClick = () => {
    if (!suppressBookClickRef.current) return false;
    clearBookClickSuppression();
    return true;
  };

  const finishBookPointerDrag = (e: ReactPointerEvent<HTMLDivElement>, canceled = false) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    clearLongPressTimer();
    stopAutoScroll();
    document.body.style.touchAction = '';
    document.body.style.userSelect = '';

    if (drag.active) {
      e.preventDefault();
      const containerRect = bookItemsRef.current?.getBoundingClientRect();
      const pointerInsideCollection = Boolean(containerRect &&
        e.clientX >= containerRect.left && e.clientX <= containerRect.right &&
        e.clientY >= containerRect.top && e.clientY <= containerRect.bottom);

      // Rechecking the same point against the reordered layout can change the displayed drop slot.
      const pointerMoved = e.clientX !== drag.currentX || e.clientY !== drag.currentY;
      if (!canceled && pointerInsideCollection && pointerMoved) {
        updateBookDropPreview(e.clientX, e.clientY);
      }

      const finalOrder = drag.order;
      const didReorder = finalOrder.some((bookId, index) => bookId !== drag.startOrder[index]);
      if (!canceled && pointerInsideCollection && didReorder) {
        onCommit(finalOrder);
      } else {
        pendingReorderPositionsRef.current = captureBookPositions();
        cancelBookReorderAnimations();

      }

      clearBookClickSuppression();
      suppressBookClickRef.current = true;
      suppressBookClickTimerRef.current = window.setTimeout(clearBookClickSuppression, 250);
    }

    try {
      if (drag.captureElement.hasPointerCapture(drag.pointerId)) {
        drag.captureElement.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // The browser may already have released capture after a canceled pointer sequence.
    }

    pointerDragRef.current = null;
    setDragOrder(null);
    draggedIdRef.current = null;
    setDraggingBookId(null);
    setDragPreview(null);
  };

  // Cleanup drag timers on unmount or blur, and intercept active touch moves
  useEffect(() => {
    const handleGlobalCancel = () => {
      clearBookClickSuppression();
      clearLongPressTimer();
      stopAutoScroll();
      document.body.style.touchAction = '';
      document.body.style.userSelect = '';
      if (pointerDragRef.current?.active) {
        pendingReorderPositionsRef.current = captureBookPositions();
        cancelBookReorderAnimations();
        setDragOrder(null);
      }
      pointerDragRef.current = null;
      draggedIdRef.current = null;
      setDraggingBookId(null);
      setDragPreview(null);
    };

    const handleWindowTouchMove = (e: TouchEvent) => {
      // When a touch drag is active, cancel native viewport scrolling so the drag stays
      // fully under application control and the browser does not abort via pointercancel.
      if (pointerDragRef.current?.active) {
        if (e.cancelable) {
          e.preventDefault();
        }
      }
    };

    window.addEventListener('touchmove', handleWindowTouchMove, { passive: false });
    window.addEventListener('blur', handleGlobalCancel);
    return () => {
      clearLongPressTimer();
      stopAutoScroll();
      if (pointerDragRef.current?.active) {
        document.body.style.touchAction = '';
        document.body.style.userSelect = '';
      }
      clearBookClickSuppression();
      window.removeEventListener('touchmove', handleWindowTouchMove);
      window.removeEventListener('blur', handleGlobalCancel);
    };
  }, []);

  return {
    orderedBooks,
    bookItemsRef,
    dragPreview,
    dragPreviewElementRef,
    draggingBookId,
    shouldSuppressBookClick,
    handleBookPointerDown,
    pointerHandlers: {
      onPointerMove: handlePointerMove,
      onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => finishBookPointerDrag(event),
      onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => finishBookPointerDrag(event, true),
      onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => {
        if (pointerDragRef.current) event.preventDefault();
      },
    },
  };
}
